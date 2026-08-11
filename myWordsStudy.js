(function () {
  "use strict";

  const STUDY_STORAGE_KEY = "norwegian-dictionary-my-words-study-v1";
  const DAY_IN_MS = 24 * 60 * 60 * 1000;
  const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60];

  const MAX_WORDS_PER_SESSION = 15;
  const MAX_NEW_WORDS_PER_SESSION = 5;
  const REQUEUE_GAP = 4;

  const QUESTION_MODES = Object.freeze({
    RECOGNITION: "recognition",
    RECALL: "recall",
    CLOZE: "cloze",
  });

  let session = null;

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function stripHTML(value) {
    const temporaryElement = document.createElement("div");
    temporaryElement.innerHTML = String(value ?? "");
    return temporaryElement.textContent || "";
  }

  function normalizeAnswer(value, locale = "nb-NO") {
    return String(value ?? "")
      .trim()
      .toLocaleLowerCase(locale)
      .normalize("NFC")
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .replace(/\s*-\s*/g, "-");
  }

  function firstValue(value) {
    return String(value ?? "")
      .split(",")[0]
      .trim();
  }

  function firstSentence(value) {
    const cleanValue = stripHTML(value).trim();

    if (!cleanValue) {
      return "";
    }

    return cleanValue.split(/(?<=[.!?])\s+/)[0].trim();
  }

  function splitNorwegianAnswers(value) {
    return String(value ?? "")
      .split(",")
      .map((answer) => answer.trim())
      .filter(Boolean);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function loadStudyStore() {
    try {
      const storedValue = window.localStorage.getItem(STUDY_STORAGE_KEY);

      if (!storedValue) {
        return { version: 2, records: {} };
      }

      const parsedValue = JSON.parse(storedValue);

      if (
        !parsedValue ||
        typeof parsedValue !== "object" ||
        !parsedValue.records ||
        typeof parsedValue.records !== "object"
      ) {
        return { version: 2, records: {} };
      }

      return { version: 2, records: parsedValue.records };
    } catch (error) {
      console.warn("My Words study progress could not be loaded.", error);
      return { version: 2, records: {} };
    }
  }

  function saveStudyStore(store) {
    try {
      store.version = 2;
      window.localStorage.setItem(STUDY_STORAGE_KEY, JSON.stringify(store));
    } catch (error) {
      console.warn("My Words study progress could not be saved.", error);
    }
  }

  function createDefaultRecord() {
    return {
      stage: 0,
      successfulSessions: 0,
      lapses: 0,
      dueAt: 0,
      lastReviewedAt: 0,
      lastResult: "new",
      lastMode: "",
      state: "new",
    };
  }

  function getRecord(entryId) {
    if (!session.store.records[entryId]) {
      session.store.records[entryId] = createDefaultRecord();
    }

    return session.store.records[entryId];
  }

  function shuffleCopy(values) {
    const copy = values.slice();
    const helpers = window.WordGameHelpers;

    if (helpers && typeof helpers.shuffleArray === "function") {
      return helpers.shuffleArray(copy);
    }

    for (let index = copy.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
    }

    return copy;
  }

  function locallyMatchesInflectedForm(baseWord, candidateWord) {
    const base = normalizeAnswer(baseWord);
    const candidate = normalizeAnswer(candidateWord);

    if (!base || !candidate) {
      return false;
    }

    if (candidate === base) {
      return true;
    }

    if (candidate.startsWith(base) && candidate.length - base.length <= 6) {
      return true;
    }

    if (base.endsWith("e")) {
      const shortenedBase = base.slice(0, -1);

      if (
        shortenedBase.length >= 3 &&
        candidate.startsWith(shortenedBase) &&
        candidate.length - shortenedBase.length <= 6
      ) {
        return true;
      }
    }

    return false;
  }

  function matchesInflectedForm(baseWord, candidateWord, gender) {
    const sharedMatcher = window.WordGameHelpers?.matchesInflectedForm;

    if (typeof sharedMatcher === "function") {
      return sharedMatcher(baseWord, candidateWord, gender);
    }

    return locallyMatchesInflectedForm(baseWord, candidateWord);
  }

  function findExactPhrase(sentence, phrase) {
    const escapedPhrase = escapeRegExp(phrase);
    const expression = new RegExp(
      `(^|[^\\p{L}])(${escapedPhrase})(?=$|[^\\p{L}])`,
      "iu",
    );
    const match = expression.exec(sentence);

    if (!match) {
      return null;
    }

    const prefix = match[1] || "";

    return {
      answer: match[2],
      start: match.index + prefix.length,
    };
  }

  function findInflectedToken(sentence, baseWord, gender) {
    const tokenExpression = /[\p{L}]+(?:-[\p{L}]+)*/gu;

    for (const match of sentence.matchAll(tokenExpression)) {
      if (matchesInflectedForm(baseWord, match[0], gender)) {
        return {
          answer: match[0],
          start: match.index,
        };
      }
    }

    return null;
  }

  function createClozeQuestion(entry) {
    const sentence = firstSentence(entry.eksempel);
    const sentenceTranslation = firstSentence(entry.sentenceTranslation);
    const gender = String(entry.gender ?? "").toLocaleLowerCase("nb-NO");
    const bannedClasses = ["numeral", "pronoun", "possessive", "determiner"];

    if (
      !sentence ||
      bannedClasses.some((wordClass) => gender.startsWith(wordClass))
    ) {
      return null;
    }

    const baseAnswers = splitNorwegianAnswers(entry.ord).sort(
      (first, second) => second.length - first.length,
    );
    let target = null;

    for (const baseAnswer of baseAnswers) {
      target = findExactPhrase(sentence, baseAnswer);

      if (target) {
        break;
      }
    }

    if (!target) {
      for (const baseAnswer of baseAnswers) {
        if (baseAnswer.includes(" ")) {
          continue;
        }

        target = findInflectedToken(sentence, baseAnswer, entry.gender);

        if (target) {
          break;
        }
      }
    }

    if (!target) {
      return null;
    }

    const prompt =
      sentence.slice(0, target.start) +
      "_____" +
      sentence.slice(target.start + target.answer.length);

    return {
      answer: target.answer,
      baseAnswer: firstValue(entry.ord),
      prompt,
      sentence,
      sentenceTranslation,
    };
  }

  function createStudyItem(savedEntry, store) {
    const existingRecord = store.records[savedEntry.entryId];
    const isNew =
      !existingRecord || Number(existingRecord.successfulSessions) === 0;
    const stage = Number(existingRecord?.stage) || 0;
    const clozeQuestion =
      !isNew && stage >= 2 ? createClozeQuestion(savedEntry.entry) : null;
    const graduationMode = clozeQuestion
      ? QUESTION_MODES.CLOZE
      : QUESTION_MODES.RECALL;

    return {
      entryId: savedEntry.entryId,
      entry: savedEntry.entry,
      isNew,
      clozeQuestion,
      graduationMode,
      currentMode: null,
      modeQueue: isNew
        ? [
            QUESTION_MODES.RECOGNITION,
            QUESTION_MODES.RECALL,
            QUESTION_MODES.RECALL,
          ]
        : [graduationMode],
      hadFailure: false,
    };
  }

  function buildSessionItems(savedEntries, store) {
    const now = Date.now();
    const dueEntries = [];
    const newEntries = [];

    savedEntries.forEach((savedEntry) => {
      if (!savedEntry.entry?.ord || !savedEntry.entry?.engelsk) {
        return;
      }

      const record = store.records[savedEntry.entryId];

      if (!record) {
        newEntries.push(savedEntry);
        return;
      }

      const dueAt = Number(record.dueAt) || 0;

      if (dueAt <= now) {
        dueEntries.push({ ...savedEntry, dueAt });
      }
    });

    dueEntries.sort((first, second) => first.dueAt - second.dueAt);

    const selectedEntries = dueEntries.slice(0, MAX_WORDS_PER_SESSION);
    const spacesRemaining = MAX_WORDS_PER_SESSION - selectedEntries.length;
    const newWordLimit = Math.min(MAX_NEW_WORDS_PER_SESSION, spacesRemaining);

    selectedEntries.push(...newEntries.slice(0, newWordLimit));

    return selectedEntries.map((savedEntry) =>
      createStudyItem(savedEntry, store),
    );
  }

  function getDisplayedWordClass(entry) {
    const value = String(entry.gender ?? "").trim();
    const lowerValue = value.toLocaleLowerCase("nb-NO");

    if (/^(en|ei|et)(?:$|[-/,\s])/.test(lowerValue)) {
      return `N - ${lowerValue.replace(/^noun\s*-\s*/, "")}`;
    }

    const shortLabels = {
      adjective: "Adj",
      adverb: "Adv",
      conjunction: "Conj",
      determiner: "Det",
      expression: "Exp",
      interjection: "Inter",
      numeral: "Num",
      possessive: "Poss",
      preposition: "Prep",
      pronoun: "Pron",
      verb: "Verb",
    };
    const matchingKey = Object.keys(shortLabels).find((key) =>
      lowerValue.startsWith(key),
    );

    return matchingKey ? shortLabels[matchingKey] : value || "Word";
  }

  function getCEFRMarkup(entry) {
    const level = String(entry.CEFR ?? "")
      .trim()
      .toUpperCase();

    if (!level) {
      return "";
    }

    let levelClass = "hard";

    if (level === "A1" || level === "A2") {
      levelClass = "easy";
    } else if (level === "B1" || level === "B2") {
      levelClass = "medium";
    }

    return `<div class="game-cefr-label ${levelClass}">${escapeHTML(level)}</div>`;
  }

  function buildTranslationChoices(entry) {
    const correctTranslation = String(entry.engelsk ?? "").trim();
    const correctDisplay = firstValue(correctTranslation);
    let incorrectTranslations = [];

    try {
      incorrectTranslations = window.WordGameHelpers.fetchIncorrectTranslations(
        entry.gender,
        correctTranslation,
        entry.CEFR,
      );
    } catch (error) {
      console.warn("Distractors could not be generated for this word.", error);
    }

    const uniqueChoices = [];
    const seenChoices = new Set();

    [correctTranslation, ...incorrectTranslations].forEach((translation) => {
      const displayedTranslation = firstValue(translation);
      const normalizedTranslation = normalizeAnswer(displayedTranslation, "en");

      if (!displayedTranslation || seenChoices.has(normalizedTranslation)) {
        return;
      }

      seenChoices.add(normalizedTranslation);
      uniqueChoices.push(displayedTranslation);
    });

    if (!seenChoices.has(normalizeAnswer(correctDisplay, "en"))) {
      uniqueChoices.unshift(correctDisplay);
    }

    return shuffleCopy(uniqueChoices.slice(0, 4));
  }

  function hideWordListControlsForStudy() {
    [
      "#search-bar-wrapper",
      "#random-btn",
      ".pos-filter",
      ".cefr-filter",
      "#genre-filter",
      "#game-english-filter",
    ].forEach((selector) => {
      const element = document.querySelector(selector);
      if (element) element.style.display = "none";
    });

    document
      .getElementById("search-container-inner")
      ?.classList.add("my-words-study-active");
  }

  function returnToMyWords() {
    window.WordGameHelpers?.stopAllAudio?.();
    session = null;

    document
      .getElementById("search-container-inner")
      ?.classList.remove("my-words-study-active");

    window.MyWordsAPI?.returnToMyWords?.();
  }

  function renderShell() {
    const resultsContainer = document.getElementById("results-container");

    if (!resultsContainer) {
      return false;
    }

    resultsContainer.innerHTML = `
      <div class="my-words-study-toolbar">
        <button
          type="button"
          id="my-words-study-back"
          class="word-list-export-button"
        >
          <i class="fas fa-chevron-left" aria-hidden="true"></i>
          Back to My Words
        </button>
        <p id="my-words-study-progress" class="my-words-study-progress"></p>
      </div>
      <div id="my-words-study-content"></div>
    `;

    document
      .getElementById("my-words-study-back")
      ?.addEventListener("click", returnToMyWords);

    return true;
  }

  function updateProgress() {
    const progress = document.getElementById("my-words-study-progress");

    if (!progress || !session) {
      return;
    }

    const accuracy =
      session.answerCount > 0
        ? Math.round((session.correctAnswerCount / session.answerCount) * 100)
        : 0;
    const accuracyText =
      session.answerCount > 0 ? ` · ${accuracy}% correct` : "";

    progress.textContent =
      `${session.completedCount} of ${session.totalCount} learned` +
      accuracyText;
  }

  function getNextDueDate(savedEntries, store) {
    const now = Date.now();
    const futureDates = savedEntries
      .map(({ entryId }) => Number(store.records[entryId]?.dueAt))
      .filter((dueAt) => Number.isFinite(dueAt) && dueAt > now);

    if (futureDates.length === 0) {
      return "";
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(Math.min(...futureDates)));
  }

  function renderMessage(title, message, showRestartButton = false) {
    const content = document.getElementById("my-words-study-content");

    if (!content) {
      return;
    }

    content.innerHTML = `
      <section class="definition multiple-results-definition my-words-study-message">
        <h2>${escapeHTML(title)}</h2>
        <p>${escapeHTML(message)}</p>
        ${
          showRestartButton
            ? `<button
                 type="button"
                 id="my-words-study-again"
                 class="word-list-export-button"
               >Study More Words</button>`
            : ""
        }
      </section>
    `;

    document
      .getElementById("my-words-study-again")
      ?.addEventListener("click", startMyWordsStudy);
  }

  function getModeLabel(item) {
    if (item.hadFailure) {
      return "Relearning";
    }

    if (item.currentMode === QUESTION_MODES.RECOGNITION) {
      return "First look";
    }

    if (item.currentMode === QUESTION_MODES.CLOZE) {
      return "Use in context";
    }

    return item.isNew ? "Type from memory" : "Review";
  }

  function createStudyCardMarkup(item, promptMarkup, showAudio) {
    const displayedWord = firstValue(item.entry.ord);

    return `
      <div class="game-word-card my-words-study-word-card">
        <div class="game-labels-container">
          <div class="game-label-subgroup">
            <div class="game-gender">
              ${escapeHTML(getDisplayedWordClass(item.entry))}
            </div>
            ${getCEFRMarkup(item.entry)}
          </div>

          <button
            type="button"
            id="my-words-study-audio"
            class="my-words-study-audio"
            aria-label="Play pronunciation of ${escapeHTML(displayedWord)}"
            title="Play pronunciation"
            style="visibility: ${showAudio ? "visible" : "hidden"};"
          >
            <i class="fas fa-volume-high" aria-hidden="true"></i>
          </button>

          <div class="game-label-subgroup">
            <div class="my-words-study-pass-label">
              ${escapeHTML(getModeLabel(item))}
            </div>
          </div>
        </div>

        <div class="game-word my-words-study-prompt">
          ${promptMarkup}
        </div>

        <div
          id="my-words-study-feedback"
          class="game-cefr-spacer my-words-study-feedback"
          aria-live="polite"
        ></div>
      </div>
    `;
  }

  function attachAudioButton(entry) {
    document
      .getElementById("my-words-study-audio")
      ?.addEventListener("click", () => {
        window.WordGameHelpers.stopAllAudio();
        window.WordGameHelpers.playWordAudio(entry);
      });
  }

  function revealAndPlayAnswerAudio(entry) {
    const audioButton = document.getElementById("my-words-study-audio");

    if (audioButton) {
      audioButton.style.visibility = "visible";
    }

    window.WordGameHelpers.stopAllAudio();
    window.WordGameHelpers.playWordAudio(entry);
  }

  function getFeedbackContext(item) {
    const norwegianSentence =
      item.clozeQuestion?.sentence || firstSentence(item.entry.eksempel);
    const englishSentence =
      item.clozeQuestion?.sentenceTranslation ||
      firstSentence(item.entry.sentenceTranslation);

    if (!norwegianSentence) {
      return "";
    }

    return `
      <div class="my-words-study-context">
        <p lang="no">${escapeHTML(norwegianSentence)}</p>
        ${
          englishSentence
            ? `<p class="game-english-translation" lang="en">
                 ${escapeHTML(englishSentence)}
               </p>`
            : ""
        }
      </div>
    `;
  }

  function showFeedback(item, isCorrect) {
    const feedback = document.getElementById("my-words-study-feedback");

    if (!feedback) {
      return;
    }

    let answerExplanation;

    if (item.currentMode === QUESTION_MODES.RECOGNITION) {
      answerExplanation = `${firstValue(item.entry.ord)} means ${firstValue(
        item.entry.engelsk,
      )}.`;
    } else if (item.currentMode === QUESTION_MODES.CLOZE) {
      const clozeAnswer = item.clozeQuestion.answer;
      const baseAnswer = item.clozeQuestion.baseAnswer;

      answerExplanation =
        normalizeAnswer(clozeAnswer) === normalizeAnswer(baseAnswer)
          ? `The missing word is ${clozeAnswer}.`
          : `The missing form is ${clozeAnswer}, from ${baseAnswer}.`;
    } else {
      answerExplanation = `The Norwegian word is ${firstValue(item.entry.ord)}.`;
    }

    feedback.innerHTML = `
      <div class="my-words-study-feedback-content">
        <p>
          <strong>${isCorrect ? "Correct." : "Not quite."}</strong>
          ${escapeHTML(answerExplanation)}
        </p>
        ${getFeedbackContext(item)}
      </div>
    `;
  }

  function recordIncorrectAnswer(item) {
    const record = getRecord(item.entryId);
    const now = Date.now();

    record.stage = Math.max(0, (Number(record.stage) || 0) - 1);
    record.lapses = (Number(record.lapses) || 0) + 1;
    record.dueAt = now;
    record.lastReviewedAt = now;
    record.lastResult = "incorrect";
    record.lastMode = item.currentMode;
    record.state = "learning";

    saveStudyStore(session.store);
  }

  function setRecoveryPlan(item) {
    item.modeQueue =
      item.graduationMode === QUESTION_MODES.CLOZE
        ? [QUESTION_MODES.RECALL, QUESTION_MODES.CLOZE]
        : [QUESTION_MODES.RECALL, QUESTION_MODES.RECALL];
  }

  function evaluateAttempt(item, isCorrect) {
    session.answerCount += 1;

    if (isCorrect) {
      session.correctAnswerCount += 1;
      session.pendingAction =
        item.modeQueue.length === 0 ? "complete" : "requeue";
      return;
    }

    if (!item.hadFailure) {
      recordIncorrectAnswer(item);
    }

    item.hadFailure = true;
    setRecoveryPlan(item);
    session.pendingAction = "requeue";
  }

  function updateNextButton(isCorrect) {
    const nextButton = document.getElementById("game-next-word-button");

    if (!nextButton) {
      return;
    }

    nextButton.disabled = false;

    if (session.pendingAction === "complete") {
      nextButton.textContent = "Next Word";
    } else if (isCorrect) {
      nextButton.textContent = "Practice Again Later";
    } else {
      nextButton.textContent = "Relearn Later";
    }

    nextButton.focus();
  }

  function completeItem(item) {
    const record = getRecord(item.entryId);
    const oldStage = Math.max(
      0,
      Math.min(REVIEW_INTERVAL_DAYS.length - 1, Number(record.stage) || 0),
    );
    const now = Date.now();
    let intervalDays;

    if (item.hadFailure) {
      record.stage = Math.min(oldStage, 1);
      intervalDays = 1;
      record.lastResult = "relearned";
    } else {
      intervalDays = REVIEW_INTERVAL_DAYS[oldStage];
      record.stage = Math.min(oldStage + 1, REVIEW_INTERVAL_DAYS.length);
      record.lastResult = "correct";
    }

    record.successfulSessions = (Number(record.successfulSessions) || 0) + 1;
    record.dueAt = now + intervalDays * DAY_IN_MS;
    record.lastReviewedAt = now;
    record.lastMode = item.graduationMode;
    record.state = record.stage >= 5 ? "mastered" : "review";

    saveStudyStore(session.store);
    session.completedCount += 1;
  }

  function requeueCurrentItem() {
    if (!session?.currentItem) {
      return;
    }

    const insertionIndex = Math.min(REQUEUE_GAP, session.queue.length);
    session.queue.splice(insertionIndex, 0, session.currentItem);
  }

  function finishCurrentAnswer() {
    if (!session?.currentItem || !session.pendingAction) {
      return;
    }

    window.WordGameHelpers.stopAllAudio();

    if (session.pendingAction === "complete") {
      completeItem(session.currentItem);
    } else {
      session.currentItem.currentMode = null;
      requeueCurrentItem();
    }

    session.currentItem = null;
    session.pendingAction = null;
    renderNextQuestion();
  }

  function handleRecognitionChoice(choice, selectedButton) {
    if (!session?.currentItem || session.answerLocked) {
      return;
    }

    session.answerLocked = true;

    const item = session.currentItem;
    const correctAnswer = firstValue(item.entry.engelsk);
    const isCorrect =
      normalizeAnswer(choice, "en") === normalizeAnswer(correctAnswer, "en");

    document.querySelectorAll(".my-words-study-choice").forEach((button) => {
      const buttonIsCorrect =
        normalizeAnswer(button.dataset.choice, "en") ===
        normalizeAnswer(correctAnswer, "en");

      button.disabled = true;

      if (buttonIsCorrect) {
        button.classList.add("game-correct-card");
      } else if (button === selectedButton) {
        button.classList.add("game-incorrect-card");
      } else {
        button.classList.add("distractor-muted");
      }
    });

    evaluateAttempt(item, isCorrect);
    showFeedback(item, isCorrect);
    revealAndPlayAnswerAudio(item.entry);
    updateProgress();
    updateNextButton(isCorrect);
  }

  function getTypedAnswers(item) {
    if (item.currentMode === QUESTION_MODES.CLOZE) {
      return [item.clozeQuestion.answer];
    }

    return splitNorwegianAnswers(item.entry.ord);
  }

  function handleTypedAnswer(forceIncorrect = false) {
    if (!session?.currentItem || session.answerLocked) {
      return;
    }

    const item = session.currentItem;
    const input = document.getElementById("my-words-study-answer");
    const submittedAnswer = input?.value.trim() || "";

    if (!forceIncorrect && !submittedAnswer) {
      input?.focus();
      return;
    }

    session.answerLocked = true;

    const acceptedAnswers = getTypedAnswers(item);
    const isCorrect =
      !forceIncorrect &&
      acceptedAnswers.some(
        (answer) =>
          normalizeAnswer(answer) === normalizeAnswer(submittedAnswer),
      );

    document
      .querySelectorAll(
        "#my-words-study-answer, #my-words-study-check, #my-words-study-dont-know",
      )
      .forEach((control) => {
        control.disabled = true;
      });

    input?.classList.add(
      isCorrect
        ? "my-words-study-answer-correct"
        : "my-words-study-answer-incorrect",
    );

    evaluateAttempt(item, isCorrect);
    showFeedback(item, isCorrect);
    revealAndPlayAnswerAudio(item.entry);
    updateProgress();
    updateNextButton(isCorrect);
  }

  function renderRecognitionQuestion(item) {
    const content = document.getElementById("my-words-study-content");
    const displayedWord = firstValue(item.entry.ord);
    const choices = buildTranslationChoices(item.entry);

    content.innerHTML = `
      ${createStudyCardMarkup(
        item,
        `<div><p class="my-words-study-kicker">Choose the English meaning</p>
         <h2 lang="no">${escapeHTML(displayedWord)}</h2></div>`,
        true,
      )}

      <div class="game-grid" aria-label="Choose the English meaning">
        ${choices
          .map(
            (choice) => `
              <button
                type="button"
                class="game-translation-card my-words-study-choice"
                data-choice="${escapeHTML(choice)}"
              >${escapeHTML(choice)}</button>`,
          )
          .join("")}
      </div>

      <div class="game-next-button-container">
        <button type="button" id="game-next-word-button" disabled>
          Choose an Answer
        </button>
      </div>
    `;

    document.querySelectorAll(".my-words-study-choice").forEach((button) => {
      button.addEventListener("click", () => {
        handleRecognitionChoice(button.dataset.choice, button);
      });
    });

    document
      .getElementById("game-next-word-button")
      ?.addEventListener("click", finishCurrentAnswer);

    attachAudioButton(item.entry);
    window.WordGameHelpers.stopAllAudio();
    window.WordGameHelpers.playWordAudio(item.entry);
  }

  function renderTypedQuestion(item) {
    const content = document.getElementById("my-words-study-content");
    const isCloze = item.currentMode === QUESTION_MODES.CLOZE;
    const promptMarkup = isCloze
      ? `<div>
           <p class="my-words-study-kicker">Complete the Norwegian sentence</p>
           <h2 id="my-words-study-cloze-sentence" lang="no">
             ${escapeHTML(item.clozeQuestion.prompt)}
           </h2>
         </div>`
      : `<div>
           <p class="my-words-study-kicker">Type the Norwegian word</p>
           <h2 lang="en">${escapeHTML(firstValue(item.entry.engelsk))}</h2>
         </div>`;
    const inputLabel = isCloze ? "Missing Norwegian form" : "Norwegian word";

    content.innerHTML = `
      ${createStudyCardMarkup(item, promptMarkup, false)}

      <form id="my-words-study-answer-form" class="my-words-study-answer-panel">
        <label for="my-words-study-answer">${inputLabel}</label>
        <div class="my-words-study-answer-row">
          <input
            type="text"
            id="my-words-study-answer"
            autocomplete="off"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
          />
          <button
            type="submit"
            id="my-words-study-check"
            class="word-list-export-button"
          >Check Answer</button>
        </div>
        <button
          type="button"
          id="my-words-study-dont-know"
          class="my-words-study-dont-know"
        >I don’t know</button>
      </form>

      <div class="game-next-button-container">
        <button type="button" id="game-next-word-button" disabled>
          Enter an Answer
        </button>
      </div>
    `;

    document
      .getElementById("my-words-study-answer-form")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        handleTypedAnswer(false);
      });

    document
      .getElementById("my-words-study-dont-know")
      ?.addEventListener("click", () => handleTypedAnswer(true));

    document
      .getElementById("game-next-word-button")
      ?.addEventListener("click", finishCurrentAnswer);

    attachAudioButton(item.entry);
    window.WordGameHelpers.stopAllAudio();
    document.getElementById("my-words-study-answer")?.focus();
  }

  function renderQuestion(item) {
    if (item.currentMode === QUESTION_MODES.RECOGNITION) {
      renderRecognitionQuestion(item);
    } else {
      renderTypedQuestion(item);
    }
  }

  function renderNextQuestion() {
    if (!session) {
      return;
    }

    updateProgress();

    if (session.queue.length === 0) {
      const nextDueDate = getNextDueDate(session.savedEntries, session.store);
      const accuracy =
        session.answerCount > 0
          ? Math.round((session.correctAnswerCount / session.answerCount) * 100)
          : 0;
      const message = nextDueDate
        ? `You completed ${session.completedCount} words with ${accuracy}% accuracy. ` +
          `Your next review is due ${nextDueDate}.`
        : `You completed ${session.completedCount} words with ${accuracy}% accuracy.`;

      renderMessage("Session complete", message, true);
      return;
    }

    session.currentItem = session.queue.shift();
    session.currentItem.currentMode = session.currentItem.modeQueue.shift();
    session.answerLocked = false;
    session.pendingAction = null;

    renderQuestion(session.currentItem);
  }

  function startMyWordsStudy() {
    const api = window.MyWordsAPI;
    const helpers = window.WordGameHelpers;

    if (!api?.getSavedEntries || !api?.returnToMyWords) {
      console.error("MyWordsAPI is not available.");
      return;
    }

    if (
      !helpers?.fetchIncorrectTranslations ||
      !helpers?.playWordAudio ||
      !helpers?.stopAllAudio
    ) {
      console.error("WordGameHelpers is not available.");
      return;
    }

    helpers.stopAllAudio();
    hideWordListControlsForStudy();

    if (typeof showLandingCard === "function") {
      showLandingCard(false);
    }

    const savedEntries = api.getSavedEntries();
    const store = loadStudyStore();
    const queue = buildSessionItems(savedEntries, store);

    session = {
      savedEntries,
      store,
      queue,
      currentItem: null,
      answerLocked: false,
      pendingAction: null,
      completedCount: 0,
      totalCount: queue.length,
      answerCount: 0,
      correctAnswerCount: 0,
    };

    if (!renderShell()) {
      return;
    }

    updateProgress();

    if (savedEntries.length === 0) {
      renderMessage(
        "No saved words yet",
        "Return to All Words and use the star to add words to My Words.",
      );
    } else if (queue.length === 0) {
      const nextDueDate = getNextDueDate(savedEntries, store);
      const message = nextDueDate
        ? `Your next review is due ${nextDueDate}.`
        : "There are no words due for review right now.";

      renderMessage("You’re all caught up", message, true);
    } else {
      renderNextQuestion();
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  window.startMyWordsStudy = startMyWordsStudy;
})();
