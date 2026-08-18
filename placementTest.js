(function () {
  "use strict";

  // Seeds a starting ability estimate from a plain-language self-rating —
  // no CEFR jargon shown to the learner — then a short adaptive quiz
  // (staircase: right answer -> harder word, wrong -> easier, with a
  // shrinking step size) converges on a real estimate before regular play
  // starts. Runs once for a brand-new learner (gated in wordGame.js's
  // startWordGame()) and is re-offered later via "Retake placement test"
  // on the word-game intro screen, since a first guess can be wrong and
  // ability legitimately changes over time.
  const SELF_ASSESSMENT_OPTIONS = [
    { label: "I don't know any Norwegian yet", anchor: 60 },
    { label: "I know a handful of words and phrases", anchor: 220 },
    { label: "I can have simple everyday conversations", anchor: 420 },
    { label: "I can discuss familiar topics in some detail", anchor: 600 },
    { label: "I can follow most conversations and read comfortably", anchor: 780 },
    { label: "I'm effectively fluent", anchor: 920 },
  ];

  const QUIZ_LENGTH = 13;
  const INITIAL_STEP = 220;
  const STEP_DECAY = 0.72;
  const MIN_STEP = 30;
  const ANSWER_PAUSE_MS = 550;

  let quiz = null; // { estimate, step, index, usedWords }

  function getResultsContainer() {
    return document.getElementById("results-container");
  }

  function getWordDifficulty(entry) {
    const cefr = String(entry?.CEFR ?? "").trim().toUpperCase();
    const anchors = window.WordGameHelpers?.getCefrAnchors?.() ?? {};
    return anchors[cefr] ?? 500;
  }

  // Nearest-difficulty untried word to the current estimate, with a small
  // random jitter so repeated near-ties don't always resolve to the same
  // handful of words.
  function pickNearestWord(targetDifficulty, excludeSet) {
    let best = null;
    let bestDistance = Infinity;

    for (const entry of results) {
      const norwegianWord = String(entry?.ord ?? "").trim();
      const englishTranslation = String(entry?.engelsk ?? "").trim();
      const gender = String(entry?.gender ?? "").trim();
      const cefr = String(entry?.CEFR ?? "").trim();

      if (!norwegianWord || !englishTranslation || !gender || !cefr) continue;
      if (excludeSet.has(entry)) continue;

      const displayedNorwegian = normalizeGameAnswer(
        getPrimaryNorwegianForm(norwegianWord),
      );
      const displayedEnglish = normalizeGameAnswer(
        getDisplayedAnswer(englishTranslation),
      );
      if (displayedNorwegian === displayedEnglish) continue;

      const distance =
        Math.abs(getWordDifficulty(entry) - targetDifficulty) +
        Math.random() * 15;

      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    }

    return best;
  }

  function renderSelfAssessment() {
    const container = getResultsContainer();
    if (!container) return;

    container.innerHTML = `
      <div class="game-intro-card placement-card">
        <h2 class="game-intro-heading">How much Norwegian do you know?</h2>
        <p class="game-intro-subheading">This just gives us a starting point — a short quiz right after will fine-tune it.</p>
        <div class="placement-option-list">
          ${SELF_ASSESSMENT_OPTIONS.map(
            (option, index) => `
            <button type="button" class="placement-option-btn" data-index="${index}">
              ${escapeGameHTML(option.label)}
            </button>
          `,
          ).join("")}
        </div>
      </div>
    `;

    container.querySelectorAll(".placement-option-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const option = SELF_ASSESSMENT_OPTIONS[Number(button.dataset.index)];
        startQuiz(option.anchor);
      });
    });
  }

  function startQuiz(initialEstimate) {
    quiz = {
      estimate: initialEstimate,
      step: INITIAL_STEP,
      index: 0,
      usedWords: new Set(),
    };
    renderQuizQuestion();
  }

  function renderQuizQuestion() {
    if (!quiz) return;

    if (quiz.index >= QUIZ_LENGTH) {
      finishQuiz();
      return;
    }

    const entry = pickNearestWord(quiz.estimate, quiz.usedWords);

    // Ran out of untried words (shouldn't happen against a ~29k-entry
    // dictionary) — finish early with whatever the estimate has converged
    // to so far rather than getting stuck.
    if (!entry) {
      finishQuiz();
      return;
    }

    quiz.usedWords.add(entry);

    const correctTranslation = entry.engelsk;
    const incorrectTranslations =
      window.WordGameHelpers?.fetchIncorrectTranslations?.(
        entry.gender,
        correctTranslation,
        entry.CEFR,
      ) ?? [];
    const choices = shuffleArray([correctTranslation, ...incorrectTranslations]);
    const displayedWord = getPrimaryNorwegianForm(entry);

    const container = getResultsContainer();
    if (!container) return;

    container.innerHTML = `
      <div class="game-intro-card placement-card">
        <p class="placement-progress">Question ${quiz.index + 1} of ${QUIZ_LENGTH}</p>
        <p class="game-instruction">What does this word mean?</p>
        <div class="game-word-card">
          <div class="game-word"><h2>${escapeGameHTML(displayedWord)}</h2></div>
        </div>
        <div class="game-grid">
          ${choices
            .map(
              (choice, index) => `
            <button type="button" class="game-translation-card" data-index="${index}">
              ${escapeGameHTML(getDisplayedAnswer(choice))}
            </button>
          `,
            )
            .join("")}
        </div>
      </div>
    `;

    const cards = container.querySelectorAll(".game-translation-card");
    cards.forEach((card, index) => {
      card.addEventListener("click", () => {
        cards.forEach((c) => {
          c.disabled = true;
        });

        const isCorrect = choices[index] === correctTranslation;
        card.classList.add(isCorrect ? "game-correct-card" : "game-incorrect-card");
        if (!isCorrect) {
          cards.forEach((c, i) => {
            if (choices[i] === correctTranslation) {
              c.classList.add("game-correct-card");
            }
          });
        }

        answerQuizQuestion(isCorrect);
      });
    });
  }

  function answerQuizQuestion(isCorrect) {
    quiz.estimate = Math.min(
      1000,
      Math.max(0, quiz.estimate + (isCorrect ? quiz.step : -quiz.step)),
    );
    quiz.step = Math.max(MIN_STEP, quiz.step * STEP_DECAY);
    quiz.index += 1;

    window.setTimeout(renderQuizQuestion, ANSWER_PAUSE_MS);
  }

  function finishQuiz() {
    const finalScore = quiz?.estimate ?? 500;
    quiz = null;
    window.WordGameHelpers?.completePlacement?.(finalScore);
    window.WordGameHelpers?.startWordGame?.();
  }

  window.PlacementTestAPI = Object.freeze({
    start: renderSelfAssessment,
  });
})();
