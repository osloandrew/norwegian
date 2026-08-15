let activeAudio = [];
let currentWord;
let correctTranslation;
let correctlyAnsweredWords = new Set(); // Track exact dictionary entries already answered correctly
let correctLevelAnswers = 0; // Track correct answers per level
let correctCount = 0; // Tracks the total number of correct answers
let correctStreak = 0; // Track the current streak of correct answers
const GAME_LEVEL_STORAGE_KEY = "norwegian-dictionary-game-level-v1";
const CEFR_LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C"];
// Word classes excluded from cloze/distractor generation — too grammatically
// constrained (e.g. a numeral rarely substitutes for another numeral in
// context) to make plausible-but-wrong answer choices.
const BANNED_WORD_CLASSES = ["numeral", "pronoun", "possessive", "determiner"];

let currentCEFR = loadGameLevel(); // Resumes at the saved level; defaults to A1
let levelCorrectAnswers = 0;
let levelTotalQuestions = 0;
let gameActive = false;

// A "round" is the intro-screen-driven session wrapper around the game:
// either a bounded number of words to learn, or an infinite drill. This is
// distinct from CEFR level progression above, which continues to work
// exactly as before within whichever round is active.
const WORD_GAME_SESSION_WORD_COUNTS = [10, 20, 50];
let wordGameRoundActive = false; // false until the intro screen's mode is chosen
let wordGameMode = null; // "session" | "infinite"
let wordGameSessionTarget = 0; // distinct correct words needed to finish a "session" round
let wordGameSessionCorrectWords = new Set(); // distinct words answered correctly this round
let wordGameSessionQuestionsAnswered = 0;
let wordGameSessionCorrectAnswers = 0;
let wordGameSessionIncorrectAnswers = 0;
let wordGameSessionStartedAt = 0;
let incorrectCount = 0; // Tracks the total number of incorrect answers
let incorrectWordQueue = []; // Queue for storing incorrect words with counters
const levelThresholds = {
  A1: { up: 0.85, down: null }, // Starting level — can't go lower
  A2: { up: 0.9, down: 0.6 },
  B1: { up: 0.94, down: 0.7 },
  B2: { up: 0.975, down: 0.8 },
  C: { up: null, down: 0.9 }, // Final level — can fall from here, but not climb higher
};
// Reverse flashcards (English shown, Norwegian recalled from memory) test
// productive vocabulary knowledge — meaningfully harder than the forward
// flashcard's receptive recognition (Norwegian shown, English recognized
// from a handful of options). Ramping this share up with CEFR level
// mirrors how language curricula shift emphasis from receptive to
// productive skill as proficiency grows, rather than handing beginners
// the hardest recall direction before they've built a receptive base.
// This only governs the non-cloze half of questions — cloze's own 50%
// share (a different, sentence-scaffolded kind of Norwegian recall) is
// unaffected.
const REVERSE_FLASHCARD_PROBABILITY = {
  A1: 0.1,
  A2: 0.2,
  B1: 0.35,
  B2: 0.45,
  C: 0.5,
};
// Listening comprehension draws on a different skill (auditory
// segmentation, not recall direction) that's worth practicing from the
// very start — CEFR listening "can-do" statements begin at A1 alongside
// reading, unlike productive recall. So this ramps gently rather than
// following the steep receptive-to-productive curve above; the audio is
// always freely replayable, which softens the "one-shot" difficulty a
// pure listening test would otherwise have.
const LISTENING_PROBABILITY = {
  A1: 0.2,
  A2: 0.25,
  B1: 0.3,
  B2: 0.35,
  C: 0.4,
};
let previousWord = null;
let recentAnswers = []; // Track the last X answers, 1 for correct, 0 for incorrect
let reintroduceThreshold = 10; // Set how many words to show before reintroducing incorrect ones
// Progression checks every 20 questions and requires the incorrect-word
// queue to be empty. The old target of 10 here (on top of the 10-question
// reintroduceThreshold gate above) meant a single miss took ~20+ questions
// just to be shown again, routinely missing that same evaluation window and
// blocking an otherwise-qualifying level-up for a full extra cycle. Lowering
// the target gives it a reliable chance to clear within one 20-question
// window while still keeping some spacing before the retry.
const INCORRECT_WORD_REINTRODUCE_COUNTER_TARGET = 3;
let totalQuestions = 0; // Track total questions per level
let wordsSinceLastIncorrect = 0; // Counter to track words shown since the last incorrect word
let wordDataStore = [];
let questionsAtCurrentLevel = 0; // Track questions answered at current level
let goodChime = new Audio("Resources/Audio/goodChime.wav");
let badChime = new Audio("Resources/Audio/badChime.wav");
let popChime = new Audio("Resources/Audio/popChime.wav");

goodChime.volume = 0.2;
badChime.volume = 0.2;
popChime.volume = 0.2;

const gameContainer = document.getElementById("results-container"); // Assume this is where you'll display the game
const statsContainer = document.getElementById("game-session-stats"); // New container for session stats

// Reuses scripts.js's getCefrClass (easy/medium/hard) so the word-game's
// own CEFR badge stays in sync with the rest of the app's CEFR styling.
function getGameCefrLabelHTML(cefrLevel) {
  const cefrClass = getCefrClass(cefrLevel);
  return cefrClass
    ? `<div class="game-cefr-label ${cefrClass}">${cefrLevel}</div>`
    : "";
}

// Shared by renderWordGameUI and renderClozeGameUI's gender/word-class badge.
function getGameGenderLabel(gender) {
  if (
    gender.startsWith("en") ||
    gender.startsWith("et") ||
    gender.startsWith("ei")
  ) {
    return "N - " + gender;
  }
  if (gender.startsWith("adjective")) return "Adj";
  if (gender.startsWith("adverb")) return "Adv";
  if (gender.startsWith("conjunction")) return "Conj";
  if (gender.startsWith("determiner")) return "Det";
  if (gender.startsWith("expression")) return "Exp";
  if (gender.startsWith("interjection")) return "Inter";
  if (gender.startsWith("numeral")) return "Num";
  if (gender.startsWith("possessive")) return "Poss";
  if (gender.startsWith("preposition")) return "Prep";
  if (gender.startsWith("pronoun")) return "Pron";
  return gender;
}

// Getting a CSS transition to restart reliably after a class toggle turned
// out to be genuinely unreliable here — a forced reflow (offsetHeight),
// double requestAnimationFrame, and a short setTimeout were all tried and
// each either collapsed into an instant jump or fired far later than their
// nominal delay. The Web Animations API sidesteps that whole class of
// timing bug: it animates directly on its own explicit timeline instead of
// depending on the browser noticing a style change between two frames, so
// there's nothing to "restart" and nothing to race.
function setGameContainerHTML(html) {
  gameContainer.innerHTML = html;

  // Deliberately not gated behind prefers-reduced-motion — a subtle
  // opacity fade, not motion (no parallax/zoom/movement), and this
  // should play for everyone regardless of that OS-level setting.
  //
  // Only fade the word/sentence card and each answer choice — the stats
  // bar and Next Word button don't change content, so leaving them out
  // means each click flashes just the new question, not the whole screen.
  // Starting from 0.15 rather than 0 keeps content from ever going fully
  // blank, which is most of what made the full-screen version feel jarring.
  const fadeTargets = gameContainer.querySelectorAll(
    ".game-word-card, .game-translation-card",
  );

  fadeTargets.forEach((el) => {
    el.animate([{ opacity: 0.15 }, { opacity: 1 }], {
      duration: 300,
      easing: "ease-out",
    });
  });
}

// Centralized banner handler
const banners = {
  congratulations: "game-congratulations-banner",
  fallback: "game-fallback-banner",
  streak: "game-streak-banner", // New banner for 10-word streak
  clearedPracticeWords: "game-cleared-practice-banner", // New banner for clearing reintroduced words
};

const clearedPracticeMessages = [
  "🎉 Awesome! You've cleared all practice words!",
  "👏 Great job! Practice makes perfect.",
  "🌟 Stellar effort! Practice words completed.",
  "🏆 Victory! Practice session conquered.",
  "🚀 You're ready for the next challenge!",
  "🎓 Practice complete! Onward to new words.",
  "🔥 Practice words? Done and dusted!",
  "💡 Bright work! Practice session finished.",
  "🎯 Target achieved! Practice words cleared.",
  "🧠 Brainpower at its best! Practice complete.",
];

const congratulationsMessages = [
  "🎉 Fantastic work! You've reached level {X}!",
  "🏅 Congratulations! Level {X} achieved!",
  "🌟 You're shining bright at level {X}!",
  "🚀 Level up! Welcome to level {X}!",
  "👏 Great job! You've advanced to level {X}!",
  "🎯 Target hit! Now at level {X}!",
  "🎓 Smart move! Level {X} unlocked!",
  "🔥 Keep it up! Level {X} is yours!",
  "💡 Brilliant! You've made it to level {X}!",
  "🏆 Victory! Level {X} reached!",
];

const fallbackMessages = [
  "🔄 Don't worry! You're back at level {X}. Keep going!",
  "💪 Stay strong! Level {X} is a chance to improve.",
  "🌱 Growth time! Revisit level {X} and conquer it.",
  "🎯 Aim steady! Level {X} is your new target.",
  "🚀 Regroup at level {X} and launch again!",
  "🔥 Keep the fire alive! Level {X} awaits.",
  "🧠 Sharpen your skills at level {X}.",
  "🎓 Learning is a journey. Level {X} is part of it.",
  "🏗️ Rebuild your streak starting at level {X}.",
  "💡 Reflect and rise! Level {X} is your step forward.",
];

const lockToggleMessages = {
  locked: ["🔒 Level lock enabled. You won’t advance or fall back."],
  unlocked: ["🚀 Level lock disabled. Progression is active."],
};

const streakMessages = [
  "🔥 You're on fire with a {X}-word streak!",
  "💪 Power streak! That's {X} in a row!",
  "🎯 Precision mode: {X} correct straight!",
  "🎉 Amazing! You've hit a {X}-word streak!",
  "👏 Well done! {X} correct answers without a miss!",
  "🌟 Stellar performance! {X} consecutive correct answers!",
  "🚀 You're soaring! {X} right answers in a row!",
  "🏆 Champion streak! {X} correct answers and counting!",
  "🎓 Scholar level: {X} correct answers straight!",
  "🧠 Brainpower unleashed! {X} correct answers consecutively!",
];

const savedWordMessages = [
  "⭐ “{word}” was added to My Words.",
  "📚 “{word}” joined your study list.",
  "🧠 Saved “{word}” for future practice.",
  "🌱 You can practise “{word}” again in My Words.",
  "📌 “{word}” is ready for another round.",
];

const removedWordMessages = [
  "☆ “{word}” was removed from My Words.",
  "📖 “{word}” left your study list.",
  "🧹 “{word}” is no longer saved.",
  "✅ Removed “{word}” from future My Words practice.",
  "↩️ You can always save “{word}” again later.",
];

function showBanner(type, level) {
  const bannerPlaceholder = document.getElementById("game-banner-placeholder");
  let bannerHTML = "";
  let message = "";

  if (type === "congratulations") {
    const randomIndex = Math.floor(
      Math.random() * congratulationsMessages.length,
    );
    message = congratulationsMessages[randomIndex].replace("{X}", level);
    bannerHTML = `<div class="game-congratulations-banner"><p>${message}</p></div>`;
  } else if (type === "fallback") {
    const randomIndex = Math.floor(Math.random() * fallbackMessages.length);
    message = fallbackMessages[randomIndex].replace("{X}", level);
    bannerHTML = `<div class="game-fallback-banner"><p>${message}</p></div>`;
  } else if (type === "streak") {
    const randomIndex = Math.floor(Math.random() * streakMessages.length);
    message = streakMessages[randomIndex].replace("{X}", level);
    bannerHTML = `<div class="game-streak-banner"><p>${message}</p></div>`;
  } else if (type === "clearedPracticeWords") {
    const randomIndex = Math.floor(
      Math.random() * clearedPracticeMessages.length,
    );
    message = clearedPracticeMessages[randomIndex];
    bannerHTML = `<div class="game-cleared-practice-banner"><p>${message}</p></div>`;
  } else if (type === "savedWord") {
    const randomIndex = Math.floor(Math.random() * savedWordMessages.length);

    message = savedWordMessages[randomIndex].replace("{word}", level);

    bannerHTML = `
      <div class="game-saved-word-banner">
        <p>${message}</p>
      </div>
    `;
  } else if (type === "removedWord") {
    const randomIndex = Math.floor(Math.random() * removedWordMessages.length);

    message = removedWordMessages[randomIndex].replace("{word}", level);

    bannerHTML = `
      <div class="game-removed-word-banner">
        <p>${message}</p>
      </div>
    `;
  } else if (type === "levelLock") {
    const messages =
      level === "locked"
        ? lockToggleMessages.locked
        : lockToggleMessages.unlocked;
    const randomIndex = Math.floor(Math.random() * messages.length);
    message = messages[randomIndex];
    bannerHTML = `<div class="game-lock-banner"><p>${message}</p></div>`;
  }

  bannerPlaceholder.innerHTML = bannerHTML;
}

function hideAllBanners() {
  const bannerPlaceholder = document.getElementById("game-banner-placeholder");

  if (bannerPlaceholder) {
    // Check if the element exists
    bannerPlaceholder.innerHTML = ""; // Clear the banner placeholder
  } else {
    console.warn("Banner placeholder not found in the DOM.");
  }
}

// Track correct/incorrect answers for each question
function updateRecentAnswers(isCorrect) {
  recentAnswers.push(isCorrect ? 1 : 0);
  if (isCorrect) {
    levelCorrectAnswers++;
  }
  levelTotalQuestions++;
}

function toggleGameEnglish() {
  const englishSelect = document.getElementById("game-english-select");
  const translationElement = document.querySelector(
    ".game-cefr-spacer .game-english-translation",
  );

  if (translationElement) {
    translationElement.style.display =
      englishSelect.value === "show-english" ? "block" : "none";
  }
}

function playWordAudio(wordObj) {
  if (!wordObj || !wordObj.ord) return;
  const cleanWord = wordObj.ord.split(",")[0].trim();
  const url = buildWordAudioUrl(cleanWord);
  const audio = new Audio(url);
  activeAudio.push(audio); // track it
  audio.play().catch((err) => console.warn("Word audio failed:", err));
}

function playSentenceAudio(exampleSentence) {
  if (!exampleSentence) return;
  const cleanSentence = exampleSentence.replace(/<[^>]*>/g, "").trim();
  const audioUrl = buildPronAudioUrl(cleanSentence);
  const audio = new Audio(audioUrl);
  activeAudio.push(audio); // track it
  audio.play().catch((err) => console.warn("Sentence audio failed:", err));
}

function stopAllAudio() {
  activeAudio.forEach((a) => {
    a.pause();
    a.currentTime = 0;
  });
  activeAudio = [];
}

function renderStats() {
  const statsContainer = document.getElementById("game-session-stats");
  if (!statsContainer) return;

  const total = recentAnswers.length;
  const correctCount = recentAnswers.reduce((a, b) => a + b, 0);
  const correctPercentage = total > 0 ? (correctCount / total) * 100 : 0;
  const wordsToReview = incorrectWordQueue.length;

  const currentThresholds = levelThresholds[currentCEFR];
  let fillColor = "#c7e3b6"; // default green
  let fontColor = "#6b9461";

  if (total === 0) {
    // Before the user answers any question
    fillColor = "#ddd"; // neutral gray
    fontColor = "#444"; // dark gray text
  } else if (
    currentThresholds.down !== null &&
    correctPercentage < currentThresholds.down * 100
  ) {
    fillColor = "#e9a895"; // red
    fontColor = "#b5634d";
  } else if (
    currentThresholds.up !== null &&
    correctPercentage < currentThresholds.up * 100
  ) {
    fillColor = "#f2e29b"; // yellow
    fontColor = "#a0881c";
  }

  // Session round progress ("Word 4 of 20") or, in infinite mode, an
  // optional way to stop and see stats without forcing it.
  const roundRowHTML =
    wordGameRoundActive && wordGameMode === "session"
      ? `<p class="game-session-progress" id="game-session-progress">${getWordGameSessionProgressLabel()}</p>`
      : wordGameRoundActive && wordGameMode === "infinite"
        ? `<button type="button" id="game-end-session-btn" class="game-end-session-btn">End &amp; see stats</button>`
        : "";

  // Inject HTML only if it hasn't been rendered yet
  if (!statsContainer.querySelector(".level-progress-bar-fill")) {
    // #game-session-stats (statsContainer itself) is also a
    // .game-stats-content flex row, so the round-progress row needs its
    // own plain block wrapper — otherwise it becomes a flex sibling of
    // the stats row below instead of stacking underneath it.
    statsContainer.innerHTML = `
      <div class="game-stats-wrapper">
        <div class="game-stats-content" style="width: 100%;">
          <div class="game-stats-correct-box"><p id="streak-count">${correctStreak}</p></div>

          <div class="level-progress-bar-bg" style="flex-grow: 1; border-radius: 10px; overflow: hidden; position: relative;">
            <div class="level-progress-bar-fill"
              style="width: 0%; background-color: ${fillColor}; height: 100%;"></div>
            <p class="level-progress-label"
              style="position: absolute; width: 100%; text-align: center; margin: 0; user-select: none;
                     font-family: 'Noto Sans', sans-serif; font-size: 18px; font-weight: 500;
                     z-index: 1; color: ${fontColor}; line-height: 38px;">
              ${Math.round(correctPercentage)}%
            </p>
          </div>

          <div class="game-stats-incorrect-box"><p id="review-count">${wordsToReview}</p></div>
        </div>
        ${roundRowHTML}
      </div>
    `;

    document
      .getElementById("game-end-session-btn")
      ?.addEventListener("click", () => {
        showWordGameRoundSummary();
      });
  }

  // Update existing elements only
  const fillEl = statsContainer.querySelector(".level-progress-bar-fill");
  const labelEl = statsContainer.querySelector(".level-progress-label");
  const streakEl = statsContainer.querySelector("#streak-count");
  const reviewEl = statsContainer.querySelector("#review-count");
  const progressEl = statsContainer.querySelector("#game-session-progress");

  if (fillEl) {
    fillEl.style.width = `${correctPercentage}%`;
    fillEl.style.backgroundColor = fillColor;
  }

  if (labelEl) {
    labelEl.textContent = `${Math.round(correctPercentage)}%`;
    labelEl.style.color = fontColor;
  }

  if (streakEl) streakEl.textContent = correctStreak;
  if (reviewEl) reviewEl.textContent = wordsToReview;
  if (progressEl) {
    progressEl.textContent = getWordGameSessionProgressLabel();
  }
}

function findClozeTarget(wordObj, preferredForm = "") {
  const exampleText = String(wordObj?.eksempel ?? "").trim();

  const baseWord = String(wordObj?.ord ?? "")
    .split(",")[0]
    .trim()
    .normalize("NFC")
    .toLocaleLowerCase("nb-NO");

  if (!exampleText || !baseWord) {
    return null;
  }

  const sentences = exampleText
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.trim() !== "");

  const normalizeClozeText = (value) =>
    String(value ?? "")
      .normalize("NFC")
      .toLocaleLowerCase("nb-NO")
      .replace(/\s+/g, " ")
      .trim();

  const getIndexedTokens = (sentence) =>
    Array.from(sentence.matchAll(/[\p{L}]+(?:-[\p{L}]+)*/gu), (match) => ({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    }));

  const createTarget = (
    sentence,
    sentenceIndex,
    tokens,
    firstTokenIndex,
    lastTokenIndex,
  ) => {
    const startIndex = tokens[firstTokenIndex].start;
    const endIndex = tokens[lastTokenIndex].end;

    return {
      sentence,
      sentenceIndex,
      surfaceForm: sentence.slice(startIndex, endIndex),
      startIndex,
      endIndex,
      startsSentence: sentence.slice(0, startIndex).trim() === "",
    };
  };

  /*
   * When a missed cloze question is shown again, first try to find
   * the exact surface form that appeared in the original question.
   */
  const normalizedPreferredForm = normalizeClozeText(preferredForm);

  if (normalizedPreferredForm) {
    const preferredTokenCount =
      preferredForm.match(/[\p{L}]+(?:-[\p{L}]+)*/gu)?.length || 1;

    for (
      let sentenceIndex = 0;
      sentenceIndex < sentences.length;
      sentenceIndex++
    ) {
      const sentence = sentences[sentenceIndex];
      const tokens = getIndexedTokens(sentence);

      for (
        let firstTokenIndex = 0;
        firstTokenIndex <= tokens.length - preferredTokenCount;
        firstTokenIndex++
      ) {
        const lastTokenIndex = firstTokenIndex + preferredTokenCount - 1;

        const startIndex = tokens[firstTokenIndex].start;
        const endIndex = tokens[lastTokenIndex].end;
        const surfaceForm = sentence.slice(startIndex, endIndex);

        if (normalizeClozeText(surfaceForm) === normalizedPreferredForm) {
          return createTarget(
            sentence,
            sentenceIndex,
            tokens,
            firstTokenIndex,
            lastTokenIndex,
          );
        }
      }
    }
  }

  /*
   * Find the target once and preserve its precise location.
   */
  const baseParts = baseWord.split(/\s+/);

  for (
    let sentenceIndex = 0;
    sentenceIndex < sentences.length;
    sentenceIndex++
  ) {
    const sentence = sentences[sentenceIndex];
    const tokens = getIndexedTokens(sentence);

    /*
     * Handle multiword expressions such as "rydde ut".
     */
    if (baseParts.length > 1) {
      for (
        let firstTokenIndex = 0;
        firstTokenIndex <= tokens.length - baseParts.length;
        firstTokenIndex++
      ) {
        const firstToken = tokens[firstTokenIndex];

        const firstPartMatches = matchesInflectedForm(
          baseParts[0],
          normalizeClozeText(firstToken.text),
          "verb",
        );

        const remainingPartsMatch = baseParts
          .slice(1)
          .every(
            (part, partIndex) =>
              normalizeClozeText(
                tokens[firstTokenIndex + partIndex + 1].text,
              ) === part,
          );

        if (firstPartMatches && remainingPartsMatch) {
          return createTarget(
            sentence,
            sentenceIndex,
            tokens,
            firstTokenIndex,
            firstTokenIndex + baseParts.length - 1,
          );
        }
      }

      continue;
    }

    /*
     * Handle ordinary single-word entries.
     */
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
      const token = tokens[tokenIndex];

      if (
        matchesInflectedForm(
          baseWord,
          normalizeClozeText(token.text),
          wordObj.gender,
        )
      ) {
        return createTarget(
          sentence,
          sentenceIndex,
          tokens,
          tokenIndex,
          tokenIndex,
        );
      }
    }
  }

  return null;
}

// Shown every time the word game is (re)entered, before any question is
// fetched — lets the learner choose a bounded round (a specific number of
// words to learn, with missed words requeued until answered correctly —
// see handleTranslationClick) or an unbounded, endless drill.
function renderWordGameIntro() {
  setGameContainerHTML(`
    <div class="game-intro-card">
      <h2 class="game-intro-heading">How do you want to practice?</h2>
      <p class="game-intro-subheading">
        Pick a round to work toward, or keep going for as long as you like.
      </p>
      <div class="game-intro-options">
        ${WORD_GAME_SESSION_WORD_COUNTS.map(
          (count) => `
          <button
            type="button"
            class="game-intro-option"
            data-mode="session"
            data-count="${count}"
          >
            <span class="game-intro-option-count">${count}</span>
            <span class="game-intro-option-label">words</span>
          </button>
        `,
        ).join("")}
        <button
          type="button"
          class="game-intro-option game-intro-option-infinite"
          data-mode="infinite"
        >
          <i class="fas fa-infinity" aria-hidden="true"></i>
          <span class="game-intro-option-label">Endless</span>
        </button>
      </div>
    </div>
  `);

  document.querySelectorAll(".game-intro-option").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.mode;
      const targetWords =
        mode === "session" ? parseInt(button.dataset.count, 10) : 0;

      beginWordGameRound(mode, targetWords);
    });
  });
}

// A session round isn't actually done just because N distinct words have
// been answered correctly at some point — a word that was missed and
// requeued (see incorrectWordQueue in handleTranslationClick) has to be
// answered correctly too before the round can end, or a miss could get
// silently left behind unlearned.
function isWordGameRoundComplete() {
  return (
    wordGameMode === "session" &&
    wordGameSessionCorrectWords.size >= wordGameSessionTarget &&
    incorrectWordQueue.length === 0
  );
}

// "Word X of N" normally, but once X reaches N with a miss still pending
// retry, says so explicitly — otherwise it reads as finished when clicking
// Next Word won't actually end the round yet (see isWordGameRoundComplete).
function getWordGameSessionProgressLabel() {
  const correctSoFar = Math.min(
    wordGameSessionCorrectWords.size,
    wordGameSessionTarget,
  );
  const pendingReview = incorrectWordQueue.length;

  if (correctSoFar >= wordGameSessionTarget && pendingReview > 0) {
    const word = pendingReview === 1 ? "word" : "words";
    return `${wordGameSessionTarget} of ${wordGameSessionTarget} — ${pendingReview} ${word} to review`;
  }

  return `Word ${correctSoFar} of ${wordGameSessionTarget}`;
}

// Resets round-scoped state (distinct from CEFR level progression, which
// is untouched here and keeps working the same within whichever round is
// active) and kicks off the first question.
function beginWordGameRound(mode, targetWords = 0) {
  wordGameMode = mode;
  wordGameSessionTarget = mode === "session" ? targetWords : 0;
  wordGameSessionCorrectWords = new Set();
  wordGameSessionQuestionsAnswered = 0;
  wordGameSessionCorrectAnswers = 0;
  wordGameSessionIncorrectAnswers = 0;
  wordGameSessionStartedAt = Date.now();
  wordGameRoundActive = true;

  resetGame();
  startWordGame();
}

// Shown when a bounded round hits its word-count target, or when the
// learner manually ends an infinite round via the "End & see stats"
// button (see renderStats). wordGameRoundActive is cleared so the next
// entry into the word game shows the intro screen again.
function showWordGameRoundSummary() {
  stopAllAudio();
  hideAllBanners();

  const elapsedSeconds = Math.max(
    1,
    Math.round((Date.now() - wordGameSessionStartedAt) / 1000),
  );
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const timeLabel = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  const accuracy =
    wordGameSessionQuestionsAnswered > 0
      ? Math.round(
          (wordGameSessionCorrectAnswers / wordGameSessionQuestionsAnswered) *
            100,
        )
      : 0;
  const wasBoundedRound = wordGameMode === "session";

  wordGameRoundActive = false;

  setGameContainerHTML(`
    <div class="game-summary-card">
      <div class="game-summary-icon"><i class="fas fa-trophy" aria-hidden="true"></i></div>
      <h2 class="game-summary-heading">${wasBoundedRound ? "Round complete!" : "Nice work!"}</h2>
      <div class="game-summary-stats">
        <div class="game-summary-stat">
          <p class="game-summary-stat-value">${wordGameSessionCorrectWords.size}</p>
          <p class="game-summary-stat-label">Words learned</p>
        </div>
        <div class="game-summary-stat">
          <p class="game-summary-stat-value">${accuracy}%</p>
          <p class="game-summary-stat-label">Accuracy</p>
        </div>
        <div class="game-summary-stat">
          <p class="game-summary-stat-value">${wordGameSessionQuestionsAnswered}</p>
          <p class="game-summary-stat-label">Questions</p>
        </div>
        <div class="game-summary-stat">
          <p class="game-summary-stat-value">${timeLabel}</p>
          <p class="game-summary-stat-label">Time</p>
        </div>
      </div>
      <button type="button" class="game-summary-primary-btn" id="game-summary-restart-btn">
        Start a new round
      </button>
    </div>
  `);

  document
    .getElementById("game-summary-restart-btn")
    ?.addEventListener("click", () => {
      renderWordGameIntro();
    });
}

async function startWordGame() {
  document.getElementById("lock-icon").style.display = "inline";
  const searchContainerInner = document.getElementById(
    "search-container-inner",
  ); // The container to update
  const searchBarWrapper = document.getElementById("search-bar-wrapper");
  const randomBtn = document.getElementById("my-words-nav-btn");

  // Filter containers for POS, Genre, and CEFR
  const posFilterContainer = document.querySelector(".pos-filter");
  const genreFilterContainer = document.getElementById("genre-filter"); // Get the Genre filter container
  const cefrFilterContainer = document.querySelector(".cefr-filter"); // Get the CEFR filter container
  const gameEnglishFilterContainer = document.querySelector(
    ".game-english-filter",
  );

  // Filter dropdowns for POS, Genre, and CEFR
  const posSelect = document.getElementById("pos-select");
  const cefrSelect = document.getElementById("cefr-select");
  const gameEnglishSelect = document.getElementById("game-english-select");

  // Keep the dropdown in sync with the (possibly persisted/resumed) level
  // whenever the word-game view is entered or re-entered.
  updateCEFRSelection();

  gameActive = true;
  showLandingCard(false);
  hideAllBanners(); // Hide banners before starting the new word

  searchBarWrapper.style.display = "none"; // Hide search-bar-wrapper
  randomBtn.style.display = "none"; // Hide random button

  searchContainerInner.classList.add("word-game-active"); // Indicate word game is active

  // Handle "word-game" option
  showLandingCard(false);

  genreFilterContainer.style.display = "none";

  gameEnglishSelect.style.display = "inline-flex"; // Hide random button
  gameEnglishFilterContainer.style.display = "inline-flex";

  posSelect.value = ""; // Reset to "Part of Speech" option
  posFilterContainer.style.display = "none";

  cefrSelect.disabled = false;
  cefrFilterContainer.classList.remove("disabled");

  // No round chosen yet (fresh entry into the word game, or just finished
  // a round) — show the mode picker instead of fetching a question. Once
  // beginWordGameRound() sets wordGameRoundActive, it calls this function
  // again itself to actually fetch the first question.
  if (!wordGameRoundActive) {
    renderWordGameIntro();
    return;
  }

  // First, check if there is an incorrect word to reintroduce
  if (
    incorrectWordQueue.length > 0 &&
    wordsSinceLastIncorrect >= reintroduceThreshold
  ) {
    const firstWordInQueue = incorrectWordQueue[0];
    if (firstWordInQueue.counter >= firstWordInQueue.requiredCounter) {
      // Play the popChime when reintroducing an incorrect word
      popChime.currentTime = 0; // Reset audio to the beginning
      popChime.play(); // Play the pop sound

      // Reintroduce the word
      currentWord = firstWordInQueue.wordObj.ord;
      correctTranslation = firstWordInQueue.wordObj.engelsk;

      if (firstWordInQueue.wasCloze) {
        const randomWordObj = firstWordInQueue.wordObj;

        const baseWord = randomWordObj.ord.split(",")[0].trim().toLowerCase();

        /*
         * Locate the same surface form that was used in the
         * original cloze question.
         */
        const clozeTarget = findClozeTarget(
          randomWordObj,
          firstWordInQueue.clozedForm,
        );

        if (!clozeTarget) {
          /*
           * renderClozeGameUI will safely convert this into
           * a reintroduced flashcard.
           */
          renderClozeGameUI(
            randomWordObj,
            [],
            firstWordInQueue.clozedForm,
            true,
            null,
          );
        } else {
          /*
           * Begin with lowercase choices. Capitalization is
           * restored below when the blank starts the sentence.
           */
          let formattedClozed =
            clozeTarget.surfaceForm.charAt(0).toLowerCase() +
            clozeTarget.surfaceForm.slice(1);

          const distractors = generateClozeDistractors(
            baseWord,
            formattedClozed,
            randomWordObj.CEFR,
            randomWordObj.gender,
          );

          let allWords = shuffleArray([formattedClozed, ...distractors]);

          let uniqueWords = ensureUniqueDisplayedValues(allWords);

          if (clozeTarget.startsSentence) {
            uniqueWords = uniqueWords.map(
              (word) => word.charAt(0).toUpperCase() + word.slice(1),
            );

            formattedClozed =
              formattedClozed.charAt(0).toUpperCase() +
              formattedClozed.slice(1);
          }

          renderClozeGameUI(
            randomWordObj,
            uniqueWords,
            formattedClozed,
            true,
            clozeTarget,
          );
        }
      } else if (firstWordInQueue.wasReverse) {
        // Rebuild incorrect Norwegian-word options for the reintroduced
        // reverse flashcard — same widening behavior as the translation
        // fallback above (same gender/CEFR, then same gender, then any
        // word) if the narrow pool is too small.
        const randomWordObj = firstWordInQueue.wordObj;

        const incorrectNorwegianWords = fetchIncorrectNorwegianWords(
          randomWordObj.ord,
          randomWordObj.CEFR,
          randomWordObj.gender,
        );

        const allNorwegianOptions = shuffleArray([
          randomWordObj.ord,
          ...incorrectNorwegianWords,
        ]);

        const uniqueNorwegianOptions =
          ensureUniqueDisplayedValues(allNorwegianOptions);

        renderWordGameUI(
          randomWordObj,
          uniqueNorwegianOptions,
          true,
          "reverse",
        );
      } else {
        // Shared by forward and listening reintroduction — both use
        // English answer options, built the same way; only the render
        // mode differs. This already widens its own search — same
        // gender across all CEFR levels, then any word at all —
        // internally if the same-CEFR pool is too small, so no separate
        // cross-level fallback call is needed here.
        const incorrectTranslations = fetchIncorrectTranslations(
          firstWordInQueue.wordObj.gender,
          correctTranslation,
          firstWordInQueue.wordObj.CEFR,
        );

        const allTranslations = shuffleArray([
          correctTranslation,
          ...incorrectTranslations,
        ]);

        const uniqueDisplayedTranslations =
          ensureUniqueDisplayedValues(allTranslations);

        renderWordGameUI(
          firstWordInQueue.wordObj,
          uniqueDisplayedTranslations,
          true,
          firstWordInQueue.wasListening ? "listening" : "forward",
        );
      }

      // Do not remove the word from the queue yet. It will be removed when answered correctly.
      firstWordInQueue.shown = true; // Mark that this word has been shown again

      // Reset counter for new words shown
      wordsSinceLastIncorrect = 0;

      // Render the updated stats box
      renderStats();
      return;
    } else {
      // Increment the counter for this word
      incorrectWordQueue.forEach((word) => word.counter++);
    }
  }

  wordsSinceLastIncorrect++; // Increment counter for words since last incorrect word

  // Use the currentCEFR directly, since it's dynamically updated when the user selects a new CEFR level
  if (!currentCEFR) {
    setGameLevel("A1"); // Default to A1 if no level is set
  }

  // Fetch a random word that respects CEFR and POS filters
  const randomWordObj = await fetchRandomWord();

  // If no words match the filters, stop the game
  if (!randomWordObj) return;

  currentWord = randomWordObj;
  correctTranslation = randomWordObj.engelsk;

  const isClozeQuestion = Math.random() < 0.5; // 50% chance to show a cloze question
  // Decided ahead of isReverseQuestion so the two don't compete for the
  // same slot — see LISTENING_PROBABILITY above for why this scales more
  // gently than the reverse-flashcard ramp. Requires the word to actually
  // have a recorded audio file (nearly all do, but a listening question
  // with a silent prompt and no visible text would be unanswerable) —
  // falls through to a forward flashcard for the rare word that lacks
  // one, same as the cloze fallbacks above.
  const isListeningQuestion =
    !isClozeQuestion &&
    randomWordObj.wordAudio === "X" &&
    Math.random() < (LISTENING_PROBABILITY[currentCEFR] ?? 0.25);
  // Only applies to the non-cloze, non-listening remainder — see
  // REVERSE_FLASHCARD_PROBABILITY above for why this scales with level
  // instead of being a flat coin flip.
  const isReverseQuestion =
    !isClozeQuestion &&
    !isListeningQuestion &&
    Math.random() < (REVERSE_FLASHCARD_PROBABILITY[currentCEFR] ?? 0.25);

  // Fetch incorrect translations with the same gender
  const incorrectTranslations = fetchIncorrectTranslations(
    randomWordObj.gender,
    correctTranslation,
    currentCEFR,
  );

  // Shuffle correct and incorrect translations into an array
  const allTranslations = shuffleArray([
    correctTranslation,
    ...incorrectTranslations,
  ]);

  // Ensure no duplicate displayed values
  const uniqueDisplayedTranslations =
    ensureUniqueDisplayedValues(allTranslations);
  // Skip cloze if the selected word is in a banned class
  if (
    isClozeQuestion &&
    BANNED_WORD_CLASSES.some((b) =>
      randomWordObj.gender?.toLowerCase().startsWith(b),
    )
  ) {
    renderWordGameUI(randomWordObj, uniqueDisplayedTranslations, false);
    return;
  }

  if (isClozeQuestion) {
    const baseWord = randomWordObj.ord.split(",")[0].trim().toLowerCase();

    const clozeTarget = findClozeTarget(randomWordObj);

    if (!clozeTarget) {
      console.warn(
        "No reliable cloze target was found. Falling back to flashcard.",
        randomWordObj,
      );

      renderWordGameUI(randomWordObj, uniqueDisplayedTranslations, false);

      return;
    }

    const clozedForm = clozeTarget.surfaceForm;
    // Format the clozed word and get its final letter
    const formatCase = (word) => word.charAt(0).toLowerCase() + word.slice(1);

    let formattedClozed = formatCase(clozedForm);
    const wasCapitalizedFromLowercase =
      !/^[A-ZÆØÅ]/.test(baseWord) && /^[A-ZÆØÅ]/.test(clozedForm);
    const distractors = generateClozeDistractors(
      baseWord,
      formattedClozed,
      randomWordObj.CEFR,
      randomWordObj.gender,
    );

    let allWords = shuffleArray([formattedClozed, ...distractors]);
    let uniqueWords = ensureUniqueDisplayedValues(allWords);

    if (wasCapitalizedFromLowercase) {
      uniqueWords = uniqueWords.map(
        (word) => word.charAt(0).toUpperCase() + word.slice(1),
      );
      formattedClozed =
        formattedClozed.charAt(0).toUpperCase() + formattedClozed.slice(1);
    }

    renderClozeGameUI(
      randomWordObj,
      uniqueWords,
      formattedClozed,
      false,
      clozeTarget,
    );
  } else if (isReverseQuestion) {
    const incorrectNorwegianWords = fetchIncorrectNorwegianWords(
      randomWordObj.ord,
      currentCEFR,
      randomWordObj.gender,
    );

    const allNorwegianOptions = shuffleArray([
      randomWordObj.ord,
      ...incorrectNorwegianWords,
    ]);

    const uniqueNorwegianOptions =
      ensureUniqueDisplayedValues(allNorwegianOptions);

    renderWordGameUI(randomWordObj, uniqueNorwegianOptions, false, "reverse");
  } else if (isListeningQuestion) {
    renderWordGameUI(
      randomWordObj,
      uniqueDisplayedTranslations,
      false,
      "listening",
    );
  } else {
    renderWordGameUI(randomWordObj, uniqueDisplayedTranslations, false);
  }

  // Render the updated stats box
  renderStats();
  // Skipped for reverse and listening questions: this shows the
  // Norwegian word's own phonetic transcription, which would hint at
  // the not-yet-revealed answer the same way playing its audio (or, for
  // listening, showing its text) early would.
  if (!isClozeQuestion && !isReverseQuestion && !isListeningQuestion) {
    displayPronunciation(currentWord);
  }
}

function ensureUniqueDisplayedValues(translations) {
  const uniqueTranslations = [];
  const displayedSet = new Set(); // To track displayed parts

  translations.forEach((translation) => {
    const displayedPart = translation.split(",")[0].trim();
    if (!displayedSet.has(displayedPart)) {
      displayedSet.add(displayedPart);
      uniqueTranslations.push(translation);
    }
  });

  return uniqueTranslations;
}

function fetchIncorrectTranslations(gender, correctTranslation, currentCEFR) {
  const isCapitalized = /^[A-Z]/.test(correctTranslation); // Check if the current word starts with a capital letter

  let incorrectResults = results.filter((r) => {
    const isMatchingCase = /^[A-Z]/.test(r.engelsk) === isCapitalized; // Check if the word's case matches
    return (
      r.gender === gender &&
      r.engelsk !== correctTranslation &&
      r.CEFR === currentCEFR && // Ensure CEFR matches
      isMatchingCase && // Ensure the case matches
      !noRandom.includes(r.ord.toLowerCase())
    );
  });

  // Shuffle the incorrect results to ensure randomness
  incorrectResults = shuffleArray(incorrectResults);

  // Use a Set to track the displayed parts of translations to avoid duplicates
  const displayedTranslationsSet = new Set();
  const incorrectTranslations = [];

  // First, try to collect translations from the same CEFR level
  for (
    let i = 0;
    i < incorrectResults.length && incorrectTranslations.length < 3;
    i++
  ) {
    const displayedTranslation = incorrectResults[i].engelsk
      .split(",")[0]
      .trim();
    if (!displayedTranslationsSet.has(displayedTranslation)) {
      incorrectTranslations.push(incorrectResults[i].engelsk);
      displayedTranslationsSet.add(displayedTranslation);
    }
  }

  // If we still don't have enough, broaden the search to include words of the same gender but any CEFR level
  if (incorrectTranslations.length < 4) {
    let additionalResults = results.filter((r) => {
      const isMatchingCase = /^[A-Z]/.test(r.engelsk) === isCapitalized; // Ensure case matches for fallback
      return (
        r.gender === gender &&
        r.engelsk !== correctTranslation && // Exclude the correct translation
        isMatchingCase && // Ensure the case matches
        !noRandom.includes(r.ord.toLowerCase()) &&
        !displayedTranslationsSet.has(r.engelsk.split(",")[0].trim())
      ); // Ensure no duplicates
    });

    for (
      let i = 0;
      i < additionalResults.length && incorrectTranslations.length < 3;
      i++
    ) {
      const displayedTranslation = additionalResults[i].engelsk
        .split(",")[0]
        .trim();
      if (!displayedTranslationsSet.has(displayedTranslation)) {
        incorrectTranslations.push(additionalResults[i].engelsk);
        displayedTranslationsSet.add(displayedTranslation);
      }
    }
  }

  // If we still don't have enough, broaden the search to include any word, ignoring CEFR and gender
  if (incorrectTranslations.length < 4) {
    let fallbackResults = results.filter((r) => {
      const isMatchingCase = /^[A-Z]/.test(r.engelsk) === isCapitalized; // Ensure case matches for fallback
      return (
        r.engelsk !== correctTranslation && // Exclude the correct translation
        isMatchingCase && // Ensure the case matches
        !noRandom.includes(r.ord.toLowerCase()) &&
        !displayedTranslationsSet.has(r.engelsk.split(",")[0].trim())
      ); // Ensure no duplicates
    });

    for (
      let i = 0;
      i < fallbackResults.length && incorrectTranslations.length < 3;
      i++
    ) {
      const displayedTranslation = fallbackResults[i].engelsk
        .split(",")[0]
        .trim();
      if (!displayedTranslationsSet.has(displayedTranslation)) {
        incorrectTranslations.push(fallbackResults[i].engelsk);
        displayedTranslationsSet.add(displayedTranslation);
      }
    }
  }

  return incorrectTranslations;
}

function fetchIncorrectNorwegianWords(correctWord, CEFR, gender) {
  const baseWord = correctWord.split(",")[0].trim().toLowerCase();

  const collect = (pool, seen, incorrectWords) => {
    for (let i = 0; i < pool.length && incorrectWords.length < 3; i++) {
      const word = pool[i].ord.split(",")[0].trim();
      if (!seen.has(word)) {
        seen.add(word);
        incorrectWords.push(word);
      }
    }
  };

  const seen = new Set();
  const incorrectWords = [];

  let sameLevelResults = results.filter((r) => {
    const word = r.ord.split(",")[0].trim().toLowerCase();
    return (
      word !== baseWord &&
      r.CEFR === CEFR &&
      r.gender === gender &&
      !noRandom.includes(r.ord.toLowerCase())
    );
  });
  collect(shuffleArray(sameLevelResults), seen, incorrectWords);

  // If the same gender/CEFR pool is too small (rare word classes at some
  // levels), widen to the same gender across all CEFR levels.
  if (incorrectWords.length < 3) {
    let sameGenderResults = results.filter((r) => {
      const word = r.ord.split(",")[0].trim();
      return (
        word.toLowerCase() !== baseWord &&
        r.gender === gender &&
        !noRandom.includes(r.ord.toLowerCase()) &&
        !seen.has(word)
      );
    });
    collect(shuffleArray(sameGenderResults), seen, incorrectWords);
  }

  // Last resort: any word at all.
  if (incorrectWords.length < 3) {
    let fallbackResults = results.filter((r) => {
      const word = r.ord.split(",")[0].trim();
      return (
        word.toLowerCase() !== baseWord &&
        !noRandom.includes(r.ord.toLowerCase()) &&
        !seen.has(word)
      );
    });
    collect(shuffleArray(fallbackResults), seen, incorrectWords);
  }

  return incorrectWords;
}

function displayPronunciation(word) {
  const pronunciationContainer = document.querySelector(
    "#game-banner-placeholder",
  );
  if (pronunciationContainer && word.uttale) {
    const uttaleText = word.uttale.split(",")[0].trim(); // Get the part before the first comma
    pronunciationContainer.innerHTML = `
      <p class="game-pronunciation">${uttaleText}</p>
    `;
  } else if (pronunciationContainer) {
    pronunciationContainer.innerHTML = ""; // Clear if no pronunciation
  } else {
  }
}

function getGameMyWordsStarMarkup() {
  return `
    <button
      type="button"
      id="game-my-words-star"
      class="word-list-favorite-button game-my-words-star"
      aria-pressed="false"
      disabled
    >
      <i class="far fa-star" aria-hidden="true"></i>
    </button>
  `;
}

function updateGameMyWordsStar(button, wordObj) {
  if (!button) {
    return;
  }

  const isSaved = window.MyWordsAPI?.isSaved?.(wordObj) === true;

  const word = String(wordObj?.ord ?? "")
    .split(",")[0]
    .trim();

  const action = isSaved ? "Remove" : "Add";
  const destination = isSaved ? "from My Words" : "to My Words";

  button.classList.toggle("is-saved", isSaved);
  button.dataset.saved = String(isSaved);
  button.setAttribute("aria-pressed", String(isSaved));
  button.setAttribute("aria-label", `${action} ${word} ${destination}`);
  button.title = `${action} ${word} ${destination}`;

  const icon = button.querySelector("i");

  if (icon) {
    icon.className = `${isSaved ? "fas" : "far"} fa-star`;
  }
}

function attachGameControls(wordObj, isCloze = false) {
  const starButton = document.getElementById("game-my-words-star");
  const reportButton = document.getElementById("game-report-issue");

  const nextButton = document.getElementById("game-next-word-button");

  updateGameMyWordsStar(starButton, wordObj);

  starButton?.addEventListener("click", () => {
    if (starButton.disabled) {
      return;
    }

    const savedState = window.MyWordsAPI?.toggle?.(wordObj);

    if (typeof savedState !== "boolean") {
      console.warn("The My Words state could not be changed.");

      return;
    }

    updateGameMyWordsStar(starButton, wordObj);
    const displayedWord = String(wordObj?.ord ?? "")
      .split(",")[0]
      .trim();

    showBanner(savedState ? "savedWord" : "removedWord", displayedWord);
  });

  // Unlike the star, this is enabled from the moment the question loads:
  // a broken audio clip or garbled sentence is noticed before answering,
  // and making the learner answer first just to report it would be
  // backwards.
  //
  // This button lives permanently in the toolbar (not regenerated per
  // question like the rest of the card), so its handler is overwritten
  // via assignment rather than addEventListener — otherwise every
  // question transition would stack another listener bound to a
  // now-stale wordObj.
  if (reportButton) {
    reportButton.onclick = () => {
      openFeedbackDialog({
        source: isCloze ? "Word Game · Cloze" : "Word Game · Flashcard",
        word: wordObj.ord,
        pos: wordObj.gender,
        cefr: wordObj.CEFR,
        // The cloze sentence hides this exact word until answered —
        // showing it in the dialog title would give away the answer.
        showWordInTitle: false,
        triggerElement: reportButton,
      });
    };
  }

  nextButton?.addEventListener("click", async () => {
    stopAllAudio();
    hideAllBanners();

    if (isWordGameRoundComplete()) {
      showWordGameRoundSummary();
      return;
    }

    await startWordGame();
  });
}

function enableGameControls() {
  const nextButton = document.getElementById("game-next-word-button");

  const starButton = document.getElementById("game-my-words-star");

  if (nextButton) {
    nextButton.disabled = false;
  }

  if (starButton && typeof window.MyWordsAPI?.toggle === "function") {
    starButton.disabled = false;
  }
}

// mode: "forward" (Norwegian shown, recognize English — the default),
// "reverse" (English shown, recall Norwegian), or "listening" (Norwegian
// audio only, recognize English — the word's own text is hidden until
// answered).
function renderWordGameUI(
  wordObj,
  translations,
  isReintroduced = false,
  mode = "forward",
) {
  const isReverse = mode === "reverse";
  const isListening = mode === "listening";

  // Each render replaces the previous question entirely, so nothing still
  // references earlier entries — reset instead of growing forever.
  wordDataStore = [];
  const wordId = wordDataStore.push(wordObj) - 1;

  // Reverse flashcards show the English meaning and ask the learner to
  // recall the Norwegian word — the answer options (and so the "correct"
  // value handleTranslationClick checks against) are Norwegian words
  // instead of English translations. Mirrors renderClozeGameUI reassigning
  // this same global to the clozed Norwegian form. Listening's correct
  // answer is English, same as forward, so it needs no reassignment here.
  if (isReverse) {
    correctTranslation = wordObj.ord.split(",")[0].trim();
  }

  // Split the word at the comma and use the first part. Listening shows
  // no word text at all pre-answer (see the prompt markup below) — this
  // is only used post-answer once revealListeningWordText swaps it in.
  let displayedWord = isReverse
    ? String(wordObj.engelsk ?? "").split(",")[0].trim()
    : wordObj.ord.split(",")[0].trim();
  const displayedGender = getGameGenderLabel(wordObj.gender);

  // Check if CEFR is selected; if not, add a label based on wordObj.CEFR
  let cefrLabel = "";
  const firstTrickyLabelPlaceholder =
    '<div class="game-tricky-word" style="visibility: hidden;"><i class="fa fa-repeat" aria-hidden="true"></i></div>';
  const secondTrickyLabel = isReintroduced
    ? '<div class="game-tricky-word visible"><i class="fa fa-repeat" aria-hidden="true"></i></div>'
    : '<div class="game-tricky-word" style="visibility: hidden;"><i class="fa fa-repeat" aria-hidden="true"></i></div>';

  // Always show the CEFR label if CEFR is available
  cefrLabel = getGameCefrLabelHTML(wordObj.CEFR);
  if (!cefrLabel) {
    console.warn("CEFR value is missing for this word:", wordObj);
  }

  // Create placeholder for banners (this will be dynamically updated when banners are shown)
  let bannerPlaceholder = '<div id="game-banner-placeholder"></div>';

  setGameContainerHTML(`
        <!-- Session Stats Section -->
        <div class="game-stats-content" id="game-session-stats">
            <!-- Stats will be updated dynamically in renderStats() -->
        </div>

        <div class="game-word-card">
            <div class="game-labels-container">
              <div class="game-label-subgroup">
              <div class="game-gender">${displayedGender}</div>
                ${cefrLabel}  <!-- Add the CEFR label here if applicable -->
              </div>
                ${bannerPlaceholder}  <!-- This is where banners will appear dynamically -->
<div
  class="
    game-label-subgroup
    game-card-actions-subgroup
  "
>
  ${secondTrickyLabel}
  ${getGameMyWordsStarMarkup()}
</div>
            </div>
            <div
              class="game-word${isReverse ? "" : " game-word-audio"}"
              ${
                isReverse
                  ? ""
                  : `role="button"
              tabindex="0"
              aria-label="${isListening ? "Play word audio" : `Play pronunciation of ${displayedWord}`}"
              title="${isListening ? "Play word audio" : "Play pronunciation"}"`
              }
            >
                ${
                  isListening
                    ? '<i class="fas fa-volume-up game-listening-icon" aria-hidden="true"></i>'
                    : `<h2>${displayedWord}</h2>`
                }
            </div>
            <div class="game-cefr-spacer"></div>
        </div>

        <!-- Translations Grid Section -->
        <div class="game-grid">
            ${translations
              .map(
                (translation, index) => `
                <div class="game-translation-card" lang="${isReverse ? "nb" : "en"}" data-id="${wordId}" data-index="${index}">
                    ${translation.split(",")[0].trim()}
                </div>
            `,
              )
              .join("")}
        </div>
<div class="game-next-button-container">
  <button
    type="button"
    id="game-next-word-button"
    disabled
  >
    Next Word
  </button>
</div>
    `);

  // Add event listeners for translation cards
  document.querySelectorAll(".game-translation-card").forEach((card) => {
    card.addEventListener("click", function () {
      const wordId = this.getAttribute("data-id"); // Retrieve the word ID
      const selectedTranslation = this.innerText.trim();
      const wordObj = wordDataStore[wordId]; // Get the word object from the data store

      handleTranslationClick(
        selectedTranslation,
        wordObj,
        false,
        "",
        isReverse,
        isListening,
      );
    });
  });

  // Forward flashcards: let the user replay the word's pronunciation by
  // clicking it, whether they've answered yet or not — seeing and hearing
  // the Norwegian word together is just reinforcement here, since the
  // word itself is already fully shown. Reverse flashcards deliberately
  // skip this wiring (see revealReverseWordAudio) — the prompt is the
  // English meaning, so unlocking Norwegian audio before answering would
  // let the learner match sounds instead of recalling the word.
  if (!isReverse) {
    const gameWordElement = document.querySelector(".game-word-audio");

    gameWordElement?.addEventListener("click", () => {
      playAudioTapFeedback(gameWordElement);
      stopAllAudio();
      playWordAudio(wordObj);
    });

    gameWordElement?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        playAudioTapFeedback(gameWordElement);
        stopAllAudio();
        playWordAudio(wordObj);
      }
    });
  }

  attachGameControls(wordObj, false);

  renderStats(); // Ensure stats are drawn once DOM is fully loaded
  if (!isReverse) {
    playWordAudio(wordObj);
  }
}

function renderClozeGameUI(
  wordObj,
  translations,
  clozedWordForm,
  isReintroduced = false,
  clozeTarget = null,
) {
  const blank = "___";
  // Each render replaces the previous question entirely, so nothing still
  // references earlier entries — reset instead of growing forever.
  wordDataStore = [];
  const wordId = wordDataStore.push(wordObj) - 1;
  const cefrLabel = getGameCefrLabelHTML(wordObj.CEFR);
  correctTranslation = clozedWordForm;

  if (!clozeTarget) {
    console.warn(
      "No saved cloze target was provided. Falling back to flashcard.",
      wordObj,
    );

    correctTranslation = wordObj.engelsk;

    const incorrectTranslations = fetchIncorrectTranslations(
      wordObj.gender,
      wordObj.engelsk,
      wordObj.CEFR,
    );

    const allTranslations = shuffleArray([
      wordObj.engelsk,
      ...incorrectTranslations,
    ]);

    const uniqueDisplayedTranslations =
      ensureUniqueDisplayedValues(allTranslations);

    renderWordGameUI(wordObj, uniqueDisplayedTranslations, isReintroduced);

    return;
  }

  const sentenceWithBlank =
    clozeTarget.sentence.slice(0, clozeTarget.startIndex) +
    blank +
    clozeTarget.sentence.slice(clozeTarget.endIndex);

  setGameContainerHTML(`
    <!-- Session Stats Section -->
    <div class="game-stats-content" id="game-session-stats">
      <!-- Stats will be updated dynamically in renderStats() -->
    </div>
  
    <div class="game-word-card">
      <div class="game-labels-container">
        <div class="game-label-subgroup">
      <div class="game-gender">${getGameGenderLabel(wordObj.gender)}</div>          ${cefrLabel}
        </div>
        <div id="game-banner-placeholder"></div>
<div
  class="
    game-label-subgroup
    game-card-actions-subgroup
  "
>
  <div
    class="game-tricky-word"
    style="${isReintroduced ? "visibility: visible;" : "visibility: hidden;"}"
  >
    <i
      class="fa fa-repeat"
      aria-hidden="true"
    ></i>
  </div>

  ${getGameMyWordsStarMarkup()}
</div>

        </div>
  
      <div class="game-word">
      <h2 id="cloze-sentence">${sentenceWithBlank}</h2>
      </div>
  
      <div class="game-cefr-spacer"></div>
    </div>
  
    <!-- Translations Grid Section -->
    <div class="game-grid">
      ${translations
        .map(
          (translation, index) => `
          <div class="game-translation-card" lang="nb" data-id="${wordId}" data-index="${index}">
            ${translation}
          </div>
        `,
        )
        .join("")}
    </div>
  <div class="game-next-button-container">
  <button
    type="button"
    id="game-next-word-button"
    disabled
  >
    Next Word
  </button>
</div>
  `);

  document.querySelectorAll(".game-translation-card").forEach((card) => {
    card.addEventListener("click", function () {
      const wordId = this.getAttribute("data-id");
      const selectedTranslation = this.innerText.trim();
      const wordObj = wordDataStore[wordId];
      handleTranslationClick(
        selectedTranslation,
        wordObj,
        true,
        clozeTarget.sentence,
      );
    });
  });

  // Deliberately NOT clickable yet: the sentence still has its blank, and
  // letting someone hear the complete sentence before answering would let
  // them listen for the answer instead of reasoning about which word fits.
  // handleTranslationClick() makes it clickable once the sentence is whole.

  attachGameControls(wordObj, true);

  renderStats(); // Ensure stats bar is present after cloze loads too
}

// Shared by the cloze sentence and the reverse-flashcard prompt: both
// start deliberately non-interactive (no audio affordance) so hearing the
// Norwegian answer early can't substitute for actually recalling it, and
// only become click/keyboard-replayable once something has made that
// audio fair game (the sentence is complete, or the question's been
// answered).
// A brief, deliberately subtle bounce so tapping the big listening-exercise
// audio button gives some visible acknowledgment beyond just the sound
// starting. Only targets .game-listening-icon — words and sentences are
// also click-to-replay audio, but they already show a text change/highlight
// on interaction, so bouncing that text as well just reads as jumpy rather
// than as feedback — not gated behind prefers-reduced-motion, matching this
// game's other animations (see setGameContainerHTML).
function playAudioTapFeedback(element) {
  const target = element?.querySelector?.(".game-listening-icon");
  if (!target) return;

  target.animate(
    [
      { transform: "scale(0.88)" },
      { transform: "scale(1.06)" },
      { transform: "scale(1)" },
    ],
    { duration: 220, easing: "ease-out" },
  );
}

function makeAudioReplayable(element, label, replay) {
  if (!element) return;

  element.classList.add("game-word-audio");
  element.setAttribute("role", "button");
  element.setAttribute("tabindex", "0");
  element.setAttribute("aria-label", label);
  element.title = label;

  const replayWithFeedback = () => {
    playAudioTapFeedback(element);
    replay();
  };

  element.addEventListener("click", replayWithFeedback);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      replayWithFeedback();
    }
  });
}

// Fills in the blank and, only now that the sentence is actually complete,
// makes it clickable to replay its audio — matching the flashcard word's
// click-to-replay, but deliberately withheld until after answering so
// hearing the sentence early can't be used to skip reasoning about which
// word fits the blank.
function makeSentenceClickable(element, sentenceText) {
  if (!sentenceText) return;

  makeAudioReplayable(element, "Play sentence audio", () => {
    stopAllAudio();
    playSentenceAudio(sentenceText);
  });
}

// Reverse flashcards show the English meaning and ask for the Norwegian
// word — unlike the forward flashcard, the prompt starts with no audio
// affordance at all (hearing the Norwegian pronunciation before answering
// would just let the learner match sounds instead of recalling the word).
// Once answered, the audio unlocks on the correct-answer card (which is
// where the Norwegian word itself is now visible) rather than on the
// prompt — the prompt is English text with no English audio behind it,
// so making it look clickable would promise a sound that doesn't exist.
function revealReverseWordAudio(wordObj) {
  const correctCardElement = document.querySelector(".game-correct-card");
  if (
    !correctCardElement ||
    correctCardElement.classList.contains("game-word-audio")
  ) {
    return;
  }

  const displayedWord = String(wordObj?.ord ?? "")
    .split(",")[0]
    .trim();

  makeAudioReplayable(
    correctCardElement,
    `Play pronunciation of ${displayedWord}`,
    () => {
      stopAllAudio();
      playWordAudio(wordObj);
    },
  );
}

// Listening questions hide the Norwegian word's text (only its audio,
// already freely replayable from the moment the question loads — see
// renderWordGameUI) until the question's been answered. This swaps the
// speaker-icon placeholder for the actual word once it's fair to show it;
// the click/keyboard audio wiring from the initial render is untouched
// and still valid, since it already plays this same wordObj regardless of
// what's currently visible.
function revealListeningWordText(wordObj) {
  const promptElement = document.querySelector(".game-word");
  if (!promptElement) return;

  const displayedWord = String(wordObj?.ord ?? "")
    .split(",")[0]
    .trim();

  promptElement.innerHTML = `<h2>${displayedWord}</h2>`;
  promptElement.setAttribute(
    "aria-label",
    `Play pronunciation of ${displayedWord}`,
  );
  promptElement.title = "Play pronunciation";
}

function completeClozeSentence(clozeSentence) {
  const sentenceElement = document.getElementById("cloze-sentence");
  if (!sentenceElement || !clozeSentence) return;

  sentenceElement.textContent = clozeSentence;

  const wordElement = sentenceElement.closest(".game-word");
  if (!wordElement || wordElement.classList.contains("game-word-audio")) {
    return;
  }

  makeSentenceClickable(wordElement, clozeSentence);
}

async function handleTranslationClick(
  selectedTranslation,
  wordObj,
  isCloze = false,
  clozeSentence = "",
  isReverse = false,
  isListening = false,
) {
  if (!gameActive) return; // Prevent further clicks if the game is not active

  gameActive = false; // Disable further clicks until the next word is generated

  const cards = document.querySelectorAll(".game-translation-card");

  // Reset all cards to their default visual state
  cards.forEach((card) => {
    card.classList.remove(
      "game-correct-card",
      "game-incorrect-card",
      "distractor-muted",
    );
  });

  // Extract the part before the comma for both correct and selected translations
  const correctTranslationPart = correctTranslation.split(",")[0].trim();
  const selectedTranslationPart = selectedTranslation.split(",")[0].trim();

  totalQuestions++; // Increment total questions for this level
  questionsAtCurrentLevel++; // Increment questions at this level
  const { exampleSentence, sentenceTranslation } =
    await fetchExampleSentence(wordObj);

  if (selectedTranslationPart === correctTranslationPart) {
    playSentenceAudio(exampleSentence);
    goodChime.currentTime = 0; // Reset audio to the beginning
    goodChime.play(); // Play the chime sound when correct
    // Mark the selected card as green (correct)
    cards.forEach((card) => {
      const cardText = card.innerText.trim();
      if (cardText === selectedTranslationPart) {
        card.classList.add("game-correct-card");
      } else if (cardText !== correctTranslationPart) {
        card.classList.add("distractor-muted");
      }
    });
    correctCount++; // Increment correct count globally
    correctStreak++; // Increment the streak
    correctLevelAnswers++; // Increment correct count for this level
    updateRecentAnswers(true); // Track this correct answer
    window.WordStrengthAPI?.recordResult?.(wordObj, true);
    // Add the word to the correctly answered words array to exclude it from future questions
    correctlyAnsweredWords.add(wordObj);
    if (wordGameRoundActive) {
      wordGameSessionQuestionsAnswered++;
      wordGameSessionCorrectAnswers++;
      wordGameSessionCorrectWords.add(wordObj);
    }
    if (isCloze) {
      completeClozeSentence(clozeSentence);
    }
    if (isReverse) {
      revealReverseWordAudio(wordObj);
    }
    if (isListening) {
      revealListeningWordText(wordObj);
    }

    // If the word was in the review queue and the user answered it correctly, remove it
    const indexInQueue = incorrectWordQueue.findIndex(
      (incorrectWord) =>
        incorrectWord.wordObj.ord === wordObj.ord && incorrectWord.shown,
    );
    if (indexInQueue !== -1) {
      incorrectWordQueue.splice(indexInQueue, 1); // Remove from review queue once answered correctly
    }
    // Trigger the streak banner if the user reaches a streak
    if (correctStreak % 10 === 0) {
      showBanner("streak", correctStreak);
    }
    // Trigger the cleared practice words banner ONLY if the queue is now empty
    if (incorrectWordQueue.length === 0 && indexInQueue !== -1) {
      showBanner("clearedPracticeWords"); // Show the cleared practice words banner
    }
  } else {
    playSentenceAudio(exampleSentence);
    badChime.currentTime = 0; // Reset audio to the beginning
    badChime.play(); // Play the chime sound when incorrect
    // Mark the incorrect card as red
    cards.forEach((card) => {
      const cardText = card.innerText.trim();

      if (cardText === selectedTranslationPart) {
        card.classList.add("game-incorrect-card");
      } else if (cardText === correctTranslationPart) {
        card.classList.add("game-correct-card");
      } else {
        card.classList.add("distractor-muted");
      }
    });
    incorrectCount++; // Increment incorrect count
    correctStreak = 0; // Reset the streak
    updateRecentAnswers(false); // Track this correct answer
    window.WordStrengthAPI?.recordResult?.(wordObj, false);
    if (wordGameRoundActive) {
      wordGameSessionQuestionsAnswered++;
      wordGameSessionIncorrectAnswers++;
    }

    if (isCloze) {
      completeClozeSentence(clozeSentence);
    }
    if (isReverse) {
      revealReverseWordAudio(wordObj);
    }
    if (isListening) {
      revealListeningWordText(wordObj);
    }

    // If the word is already in the review queue, missing it again means
    // it needs a longer runway before its next reintroduction attempt.
    // Otherwise, add it to the queue for the first time.
    const existingQueueEntry = incorrectWordQueue.find(
      (incorrectWord) => incorrectWord.wordObj.ord === wordObj.ord,
    );
    if (existingQueueEntry) {
      existingQueueEntry.counter = 0;
      existingQueueEntry.requiredCounter +=
        INCORRECT_WORD_REINTRODUCE_COUNTER_TARGET;
      existingQueueEntry.wasCloze = isCloze;
      existingQueueEntry.wasReverse = isReverse;
      existingQueueEntry.wasListening = isListening;
      existingQueueEntry.clozedForm = isCloze ? correctTranslation : null;
    } else {
      incorrectWordQueue.push({
        wordObj,
        counter: 0,
        requiredCounter: INCORRECT_WORD_REINTRODUCE_COUNTER_TARGET,
        wasCloze: isCloze,
        wasReverse: isReverse,
        wasListening: isListening,
        clozedForm: isCloze ? correctTranslation : null,
      });
    }
  }

  enableGameControls();

  // If this answer just finished a bounded round, relabel the button so
  // it's clear the next click leads to results, not another question —
  // the actual branching happens in the click handler itself (see
  // attachGameControls), checked fresh at click time.
  if (isWordGameRoundComplete()) {
    const nextButton = document.getElementById("game-next-word-button");
    if (nextButton) {
      nextButton.textContent = "See Results";
    }
  }

  // Update the stats after the answer
  renderStats();

  // Only evaluate progression if at least 20 questions have been answered at the current level
  if (questionsAtCurrentLevel >= 20) {
    evaluateProgression();
    questionsAtCurrentLevel = 0; // Reset the counter after progression evaluation
  }
  if (exampleSentence && !isCloze) {
    const completedSentence = exampleSentence;

    const translationHTML = `
      <p class="game-english-translation" style="display: ${
        document.getElementById("game-english-select").value === "show-english"
          ? "inline-block"
          : "none"
      };">${sentenceTranslation}</p>`;

    document.querySelector(".game-cefr-spacer").innerHTML = `
      <div class="sentence-pair">
        <p class="game-example-sentence">${completedSentence}</p>
        ${translationHTML}
      </div>
    `;

    const sentenceElement = document.querySelector(
      ".game-cefr-spacer .game-example-sentence",
    );
    makeSentenceClickable(sentenceElement, completedSentence);
  } else if (exampleSentence && isCloze) {
    const translationHTML = `
      <p class="game-english-translation" style="display: ${
        document.getElementById("game-english-select").value === "show-english"
          ? "inline-block"
          : "none"
      };">${sentenceTranslation}</p>`;

    document.querySelector(".game-cefr-spacer").innerHTML = `
      <div class="sentence-pair">
        ${translationHTML}
      </div>
    `;
  } else {
    document.querySelector(".game-cefr-spacer").innerHTML = "";
  }
}

async function fetchExampleSentence(wordObj) {
  if (!wordObj || !wordObj.ord) {
    console.warn("Missing required fields for search:", wordObj);
    return null;
  }

  // wordObj is already the exact dictionary entry the question was built
  // from — use its own example sentence directly. Re-deriving "the"
  // matching entry by ord+gender+CEFR (as this used to) is ambiguous
  // whenever two senses of the same word share a gender and CEFR level
  // (e.g. "råk" meaning "trail" vs. "crack", both ei/B2): .find() would
  // silently return whichever row happens to come first in the data,
  // which can be a completely different sense with its own unrelated
  // example sentence — playing back audio/text that doesn't match what
  // the user actually just answered.
  let matchingEntry = wordObj;

  // Only fall back to searching the rest of the dataset if this exact
  // entry has no example sentence of its own.
  if (!matchingEntry.eksempel || matchingEntry.eksempel.trim() === "") {
    matchingEntry = results.find(
      (result) =>
        result.eksempel &&
        result.eksempel.toLowerCase().startsWith(wordObj.ord.toLowerCase()),
    );
    if (!matchingEntry) {
      console.warn(
        `No example sentence found in the entire dataset containing the word: ${wordObj.ord}`,
      );
      return null; // No example sentence found at all
    }
  }

  // Split example sentences and remove any empty entries
  const exampleSentences = matchingEntry.eksempel
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.trim() !== "");

  const translations = matchingEntry.sentenceTranslation
    ? matchingEntry.sentenceTranslation
        .split(/(?<=[.!?])\s+/)
        .filter((translation) => translation.trim() !== "")
    : [];

  // If there is only one sentence, return it with its translation if available
  if (exampleSentences.length === 1) {
    return {
      exampleSentence: exampleSentences[0],
      sentenceTranslation: translations[0] || "",
    };
  }

  // If there are multiple sentences, pick one at random
  const randomIndex = Math.floor(Math.random() * exampleSentences.length);
  const exampleSentence = exampleSentences[randomIndex];
  const sentenceTranslation = translations[randomIndex] || ""; // Provide an empty string if translation is unavailable
  return { exampleSentence, sentenceTranslation };
}

function getEligibleGameWords(selectedPOS, cefrLevel) {
  const queuedForReintroduction = new Set(
    incorrectWordQueue.map((queued) => queued.wordObj),
  );

  return results.filter((entry) => {
    const norwegianWord = String(entry?.ord ?? "").trim();
    const englishTranslation = String(entry?.engelsk ?? "").trim();
    const gender = String(entry?.gender ?? "").trim();
    const entryCEFR = String(entry?.CEFR ?? "")
      .trim()
      .toUpperCase();

    /*
     * The game renderers require all four of these values.
     */
    if (!norwegianWord || !englishTranslation || !gender || !entryCEFR) {
      return false;
    }

    /*
     * Only include entries at the user's current CEFR level.
     */
    if (entryCEFR !== cefrLevel) {
      return false;
    }

    if (noRandom.includes(norwegianWord.toLowerCase())) {
      return false;
    }

    /*
     * Avoid displaying the same spelling twice in a row.
     */
    if (norwegianWord === previousWord) {
      return false;
    }

    /*
     * An exact dictionary entry is excluded after a correct answer.
     */
    if (correctlyAnsweredWords.has(entry)) {
      return false;
    }

    /*
     * Already queued for its own deliberate, delayed reintroduction —
     * don't let the normal weighted draw surface it early.
     */
    if (queuedForReintroduction.has(entry)) {
      return false;
    }

    const normalizedGender = gender.toLowerCase();

    if (selectedPOS === "noun") {
      const isNoun =
        normalizedGender.startsWith("en") ||
        normalizedGender.startsWith("et") ||
        normalizedGender.startsWith("ei");

      if (!isNoun || normalizedGender === "pronoun") {
        return false;
      }
    } else if (selectedPOS && !normalizedGender.startsWith(selectedPOS)) {
      return false;
    }

    /*
     * Do not ask questions where the displayed Norwegian and English
     * answers are identical.
     */
    const displayedNorwegian = norwegianWord.split(",")[0].trim().toLowerCase();

    const displayedEnglish = englishTranslation
      .split(",")[0]
      .trim()
      .toLowerCase();

    return displayedNorwegian !== displayedEnglish;
  });
}

const STRENGTH_WEIGHT_CEILING = 6; // WordStrengthAPI values are 0-5
const STRENGTH_WEIGHT_EXPONENT = 2; // squared — retune here if the curve needs adjusting

// My Words used to be a separate pool with a flat 2/3 chance of being
// drawn from whenever the user had saved *any* eligible word — regardless
// of how many words were saved or how well they already knew them. That
// made a small saved list feel overwhelming and let a fully mastered word
// keep crowding out words the user was actually struggling with.
//
// Instead, every eligible word (saved or not) now competes in a single
// weighted draw. A word's weight is its strength weight (below) times
// MY_WORDS_BOOST if it's saved, times 1 otherwise — so "is it saved" and
// "how well do I know it" pull against each other on the same axis,
// rather than being decided in two disconnected steps.
//
// MY_WORDS_BOOST=100 means saving about 1% of a level's word pool earns
// roughly half of practice time going to saved words (before strength
// pulls that back down as they're learned): with N saved words (weight w
// each) against M other words (weight w each), the saved share works out
// to N*BOOST / (N*BOOST + M), which is already a small share for a
// handful of saved words and grows on its own as the list grows — no
// separate scaling curve needed.
const MY_WORDS_BOOST = 100;

// Even a large, mostly-untried saved list shouldn't be able to crowd out
// every other word — cap My Words' combined share of the draw so there's
// always some chance of practicing a word that hasn't been saved.
const MY_WORDS_MAX_SHARE = 0.85;

function getGameWordWeight(entry) {
  const strength = window.WordStrengthAPI?.get?.(entry) ?? 0;

  return Math.pow(STRENGTH_WEIGHT_CEILING - strength, STRENGTH_WEIGHT_EXPONENT);
}

/*
 * Favors low-strength (weak or never-tried) words over high-strength
 * (mastered) ones, without ever fully excluding a mastered word. Takes a
 * pre-computed weights array (same length/order as entries) rather than a
 * weight function, so callers that need each entry's weight for more than
 * just this draw (see pickPrioritizedGameWord) only compute it once.
 */
function pickWeightedGameWord(entries, weights) {
  if (entries.length === 0) {
    return null;
  }

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let target = Math.random() * totalWeight;

  for (let i = 0; i < entries.length; i++) {
    target -= weights[i];
    if (target < 0) {
      return entries[i];
    }
  }

  return entries[entries.length - 1]; // floating-point rounding fallback
}

function pickPrioritizedGameWord(eligibleEntries) {
  const savedRecords = window.MyWordsAPI?.getSavedEntries?.() ?? [];

  /*
   * getSavedEntries() returns objects shaped like:
   * { entryId, entry }
   */
  const savedEntries = new Set(
    savedRecords.map((savedRecord) => savedRecord.entry).filter(Boolean),
  );

  // Each entry's strength weight involves a WordStrengthAPI lookup — worth
  // computing exactly once per entry rather than re-deriving it for the
  // pool totals below and again for the draw itself.
  const strengthWeights = eligibleEntries.map(getGameWordWeight);

  if (savedEntries.size === 0) {
    return pickWeightedGameWord(eligibleEntries, strengthWeights);
  }

  const isSaved = eligibleEntries.map((entry) => savedEntries.has(entry));

  let myWordsTotal = 0;
  let otherTotal = 0;

  for (let i = 0; i < eligibleEntries.length; i++) {
    if (isSaved[i]) {
      myWordsTotal += strengthWeights[i] * MY_WORDS_BOOST;
    } else {
      otherTotal += strengthWeights[i];
    }
  }

  // All-saved or all-unsaved eligible pool: nothing to balance against,
  // so the cap below doesn't apply.
  if (myWordsTotal === 0 || otherTotal === 0) {
    const weights = strengthWeights.map((weight, i) =>
      isSaved[i] ? weight * MY_WORDS_BOOST : weight,
    );

    return pickWeightedGameWord(eligibleEntries, weights);
  }

  // If My Words would naturally pull in more than MY_WORDS_MAX_SHARE of
  // the draw, scale every saved word's weight down by the same factor so
  // the combined total lands exactly at the cap. This only rebalances
  // saved vs. not-saved — each saved word's weight *relative to other
  // saved words* (i.e. its own strength) is unchanged.
  const uncappedShare = myWordsTotal / (myWordsTotal + otherTotal);
  const scale =
    uncappedShare > MY_WORDS_MAX_SHARE
      ? (MY_WORDS_MAX_SHARE * otherTotal) /
        ((1 - MY_WORDS_MAX_SHARE) * myWordsTotal)
      : 1;

  const weights = strengthWeights.map((weight, i) =>
    isSaved[i] ? weight * MY_WORDS_BOOST * scale : weight,
  );

  return pickWeightedGameWord(eligibleEntries, weights);
}

async function fetchRandomWord() {
  const selectedPOS = document.getElementById("pos-select")
    ? document.getElementById("pos-select").value.toLowerCase()
    : "";

  const cefrLevel = String(currentCEFR || "A1").toUpperCase();

  let eligibleEntries = getEligibleGameWords(selectedPOS, cefrLevel);

  /*
   * If every eligible entry at this level has been answered,
   * start a new cycle.
   */
  if (eligibleEntries.length === 0 && correctlyAnsweredWords.size > 0) {
    correctlyAnsweredWords.clear();

    eligibleEntries = getEligibleGameWords(selectedPOS, cefrLevel);
  }

  /*
   * This matters only if a level has one eligible entry.
   * It permits that entry to appear again when no alternative exists.
   */
  if (eligibleEntries.length === 0 && previousWord !== null) {
    previousWord = null;

    eligibleEntries = getEligibleGameWords(selectedPOS, cefrLevel);
  }

  if (eligibleEntries.length === 0) {
    return null;
  }

  const selectedEntry = pickPrioritizedGameWord(eligibleEntries);

  if (!selectedEntry) {
    return null;
  }

  previousWord = selectedEntry.ord;

  /*
   * Return the original dictionary entry. Do not create a partial copy.
   */
  return selectedEntry;
}

function advanceToNextLevel() {
  if (incorrectWordQueue.length > 0) {
    // Block level advancement if there are still incorrect words
    return;
  }

  const nextLevel =
    CEFR_LEVEL_ORDER[CEFR_LEVEL_ORDER.indexOf(currentCEFR) + 1] || "";

  // Only advance if we are not already at the next level
  if (currentCEFR !== nextLevel && nextLevel) {
    setGameLevel(nextLevel);
    resetGame(false); // Preserve streak when progressing
    showBanner("congratulations", nextLevel); // Show the banner
    updateCEFRSelection();
  }
}

function fallbackToPreviousLevel() {
  const previousLevel =
    CEFR_LEVEL_ORDER[CEFR_LEVEL_ORDER.indexOf(currentCEFR) - 1] || "";

  // Only change the level if it is actually falling back to a previous level
  if (currentCEFR !== previousLevel && previousLevel) {
    setGameLevel(previousLevel);
    resetGame(false); // Preserve streak when progressing
    incorrectWordQueue = []; // Reset the incorrect word queue on fallback
    showBanner("fallback", previousLevel); // Show the fallback banner
    updateCEFRSelection(); // Update the CEFR selection to reflect the new level
  }
}

let levelLocked = false;

function toggleLevelLock() {
  levelLocked = !levelLocked;
  const icon = document.getElementById("lock-icon");
  if (icon) {
    icon.className = levelLocked ? "fas fa-lock" : "fas fa-lock-open";
    icon.title = levelLocked ? "Level is locked" : "Level is unlocked";
    icon.setAttribute("aria-pressed", String(levelLocked));
  }
  showBanner("levelLock", levelLocked ? "locked" : "unlocked");
}

// Check if the user can level up or fall back
function evaluateProgression() {
  if (levelLocked) return;

  if (levelTotalQuestions >= 10) {
    const accuracy = levelCorrectAnswers / levelTotalQuestions;
    const { up, down } = levelThresholds[currentCEFR];
    if (accuracy >= up && incorrectWordQueue.length === 0) {
      advanceToNextLevel();
    } else if (accuracy < down) {
      fallbackToPreviousLevel();
    }
    resetLevelStats();
  }
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function getEndingPattern(form) {
  if (form.match(/ene$/)) return /ene$/i;
  if (form.match(/en$/)) return /en$/i;
  if (form.match(/a$/)) return /a$/i;
  if (form.match(/te$/)) return /te$/i;
  if (form.match(/et$/)) return /et$/i;
  if (form.match(/er$/)) return /er$/i;
  if (form.match(/e$/)) return /e$/i;
  if (form.match(/t$/)) return /t$/i;
  if (form.match(/r$/)) return /r$/i; // ⬅️ New line you add
  return new RegExp(form.slice(-1) + "$", "i"); // fallback
}

function matchesInflectedForm(base, token, gender) {
  if (!base || !token) return false;

  const lowerBase = base.toLowerCase();
  const lowerToken = token.toLowerCase();

  // ✅ Exact match
  if (lowerToken === lowerBase) return true;

  // ✅ Token starts with base
  if (lowerToken.startsWith(lowerBase)) return true;

  // ✅ Special feminine noun trick: "jente" → "jenta"
  if (lowerBase.endsWith("e")) {
    const baseWithoutE = lowerBase.slice(0, -1);
    if (lowerToken.startsWith(baseWithoutE)) return true;
  }

  return false;
}

function applyInflection(base, clozedForm, gender) {
  if (!base || !clozedForm || !gender) return base;

  const lowerBase = base.toLowerCase();
  const lowerClozed = clozedForm.toLowerCase();
  const stripFinalE = (word) => (word.endsWith("e") ? word.slice(0, -1) : word);
  const endsWith = (ending) => lowerBase.endsWith(ending);

  // ✅ Universal rule: Never add "t" to adjectives ending in "ig" or "sk"
  if (
    lowerClozed.endsWith("t") &&
    (lowerBase.endsWith("ig") || lowerBase.endsWith("sk"))
  ) {
    return base;
  }

  // ✅ Adjective inflection
  if (gender.startsWith("adjective")) {
    if (lowerClozed.endsWith("t")) {
      return base + "t"; // stor → stort, ren → rent
    }
    if (lowerClozed.endsWith("e")) {
      return base + "e"; // stor → store
    }
    if (lowerClozed.endsWith("ere")) {
      return endsWith("e") ? base.slice(0, -1) + "ere" : base + "ere"; // rare → rarere, fin → finere
    }
    if (lowerClozed.endsWith("est")) {
      return endsWith("e") ? base.slice(0, -1) + "est" : base + "est"; // rare → rarest, fin → finest
    }
  }

  // ✅ Verb inflection
  if (gender.startsWith("verb")) {
    if (lowerClozed.endsWith("er")) {
      return endsWith("e") ? base.slice(0, -1) + "er" : base + "er"; // spise → spiser
    }
    if (lowerClozed.endsWith("r")) {
      return endsWith("e") ? base.slice(0, -1) + "r" : base + "r";
    }
    if (lowerClozed.endsWith("et")) {
      return endsWith("e") ? base.slice(0, -1) + "et" : base + "et"; // snakke → snakket
    }
    if (lowerClozed.endsWith("te")) {
      return endsWith("e") ? base.slice(0, -1) + "te" : base + "te"; // bygge → bygget
    }
    if (lowerClozed.endsWith("t")) {
      return endsWith("e") ? base.slice(0, -1) + "t" : base + "t"; // dø → dødd
    }
    if (lowerClozed.endsWith("s")) {
      return endsWith("e") ? base.slice(0, -1) + "s" : base + "s"; // oppbevare → oppbevares
    }
  }

  // ✅ Noun inflection (en/et/ei nouns)
  if (
    gender.startsWith("en") ||
    gender.startsWith("et") ||
    gender.startsWith("ei") ||
    gender.startsWith("noun") ||
    gender.startsWith("substantiv")
  ) {
    if (lowerClozed.endsWith("en")) {
      return endsWith("e") ? base + "n" : base + "en"; // bok → boken
    }
    if (lowerClozed.endsWith("n")) {
      return base + "n"; // katt → katten
    }
    if (lowerClozed.endsWith("et")) {
      return endsWith("e") ? base + "t" : base + "et"; // hus → huset
    }
    if (lowerClozed.endsWith("t")) {
      return base + "t"; // barn → barnet
    }
    if (lowerClozed.endsWith("a")) {
      return base + "a"; // ku → kua
    }
    if (lowerClozed.endsWith("er")) {
      return endsWith("e") ? base + "r" : base + "er"; // jente → jenter, bok → bøker (irregular cases not handled)
    }
    if (lowerClozed.endsWith("r")) {
      return base + "r"; // lilje → liljer
    }
    if (lowerClozed.endsWith("ene")) {
      return base + "ene"; // katten → kattene
    }
  }

  // ✅ Default fallback
  return base;
}

// Word class ("gender" in the CSV) is either a single POS token
// (e.g. "adjective", "preposition") or, for nouns, one or more grammatical
// genders joined by hyphens (e.g. "en", "en-et"). Comparing by shared prefix
// used to conflate "adjective"/"adverb" and "preposition"/"pronoun" (both
// pairs share their first two letters), offering distractors of the wrong
// grammatical class. Comparing token sets instead fixes that while still
// treating a compound noun gender like "en-et" as compatible with "en".
function hasCompatibleGender(targetGender, candidateGender) {
  if (!candidateGender) return false;
  const targetTokens = targetGender.toLowerCase().split("-");
  const candidateTokens = candidateGender.toLowerCase().split("-");
  return targetTokens.some((token) => candidateTokens.includes(token));
}

function generateClozeDistractors(baseWord, clozedForm, CEFR, gender) {
  const formattedClozed = clozedForm.toLowerCase();
  const formattedBase = baseWord.toLowerCase();

  const isUninflected = clozedForm.trim() === baseWord.trim(); // key fix

  const matchCapitalization = /^[A-ZÆØÅ]/.test(clozedForm);
  const endingPattern = getEndingPattern(formattedClozed);

  let strictDistractors = [];

  const baseCandidates = results.filter((r) => {
    const ord = r.ord.split(",")[0].trim().toLowerCase();
    if (!ord || ord === formattedBase) return false;
    if (ord.includes(" ")) return false;
    if (ord.length < 3 || ord.length > 12) return false;
    if (r.gender && !hasCompatibleGender(gender, r.gender)) return false;
    if (r.CEFR !== CEFR) return false;
    if (BANNED_WORD_CLASSES.some((b) => r.gender?.toLowerCase().startsWith(b)))
      return false;
    return true;
  });

  const inflected = baseCandidates
    .map((r) => {
      const raw = r.ord.split(",")[0].trim().toLowerCase();
      return isUninflected
        ? raw
        : applyInflection(raw, formattedClozed, gender);
    })
    .filter(
      (w) =>
        w !== formattedClozed &&
        /^[a-zA-ZæøåÆØÅ]/.test(w) &&
        (isUninflected || endingPattern.test(w)),
    );

  strictDistractors = shuffleArray(inflected).slice(0, 3);

  if (strictDistractors.length < 3) {
    const relaxed = results
      .filter((r) => {
        const raw = r.ord.split(",")[0].trim().toLowerCase();
        return (
          raw !== formattedBase &&
          hasCompatibleGender(gender, r.gender) &&
          !BANNED_WORD_CLASSES.some((b) => r.gender?.toLowerCase().startsWith(b))
        );
      })
      .map((r) => {
        const raw = r.ord.split(",")[0].trim().toLowerCase();
        return isUninflected
          ? raw
          : applyInflection(raw, formattedClozed, gender);
      })
      .filter(
        (w) =>
          w !== formattedClozed &&
          /^[a-zA-ZæøåÆØÅ]/.test(w) &&
          (isUninflected || endingPattern.test(w)),
      );

    strictDistractors = strictDistractors
      .concat(shuffleArray(relaxed))
      .slice(0, 3);
  }

  if (strictDistractors.length < 3) {
    const extra = results
      .map((r) => {
        const raw = r.ord.split(",")[0].trim();
        return isUninflected
          ? raw
          : applyInflection(raw.toLowerCase(), formattedClozed, gender);
      })
      .filter(
        (w) =>
          w &&
          w.toLowerCase() !== formattedClozed &&
          endingPattern.test(w.toLowerCase()) &&
          /^[a-zA-ZæøåÆØÅ]/.test(w) === matchCapitalization,
      );

    strictDistractors = strictDistractors
      .concat(shuffleArray(extra))
      .slice(0, 3);
  }

  return strictDistractors;
}

function updateCEFRSelection() {
  const cefrSelect = document.getElementById("cefr-select");
  // Update the actual selected value in the dropdown to reflect the current CEFR level
  cefrSelect.value = currentCEFR;
}

function loadGameLevel() {
  try {
    const storedValue = window.localStorage.getItem(GAME_LEVEL_STORAGE_KEY);

    if (!storedValue) {
      return "A1";
    }

    const parsedValue = JSON.parse(storedValue);

    return CEFR_LEVEL_ORDER.includes(parsedValue.level)
      ? parsedValue.level
      : "A1";
  } catch (error) {
    console.warn("Game level could not be loaded.", error);
    return "A1";
  }
}

function saveGameLevel({ syncRemote = true } = {}) {
  try {
    window.localStorage.setItem(
      GAME_LEVEL_STORAGE_KEY,
      JSON.stringify({ version: 1, level: currentCEFR }),
    );
  } catch (error) {
    console.warn("Game level could not be saved.", error);
  }

  // Let myWordsAuth.js know the level changed, so it can sync to Firestore
  // when a user is signed in. syncRemote is false when the change came
  // from a remote merge, to avoid immediately writing it back.
  window.dispatchEvent(
    new CustomEvent("game-level:updated", {
      detail: { level: currentCEFR, syncRemote },
    }),
  );
}

// Only level progression persists — streak, the incorrect-word queue, and
// per-level accuracy counters stay session-only (resetGame() already
// leaves currentCEFR untouched, and continues to).
function setGameLevel(newLevel) {
  currentCEFR = newLevel;
  saveGameLevel();
}

function replaceGameLevel(newLevel) {
  currentCEFR = newLevel;
  saveGameLevel({ syncRemote: false });

  // Only touch the shared CEFR dropdown if Word Game is the view actually
  // on screen right now. This runs after an async sign-in merge, which
  // often resolves while the user is looking at Words/Sentences/etc. —
  // writing to the dropdown then would visibly hijack whatever filter
  // they had selected there for a moment, even though it has nothing to
  // do with the game level.
  const typeSelect = document.getElementById("type-select");

  if (typeSelect?.value === "word-game") {
    updateCEFRSelection();
  }
}

function resetGame(resetStreak = true) {
  correctlyAnsweredWords.clear();
  previousWord = null;
  wordsSinceLastIncorrect = 0;
  correctCount = 0; // Reset correct answers count
  correctLevelAnswers = 0; // Reset correct answers for the current level
  if (resetStreak) {
    correctStreak = 0; // Reset the streak if the flag is true
  }
  levelCorrectAnswers = 0;
  incorrectCount = 0; // Reset incorrect answers count
  incorrectWordQueue = [];
  levelTotalQuestions = 0; // Reset this here too
  questionsAtCurrentLevel = 0; // Reset questions counter for the level
  recentAnswers = []; // Clear the recent answers array
  totalQuestions = 0; // Reset total questions for the current level
  renderStats(); // Re-render the stats display to reflect the reset
}

// Reset level stats after progression or fallback
function resetLevelStats() {
  levelCorrectAnswers = 0;
  levelTotalQuestions = 0;
}

document.getElementById("cefr-select").addEventListener("change", function () {
  const typeValue = document.getElementById("type-select").value; // Get the current value of the type selector

  if (typeValue === "word-game") {
    const selectedCEFR = this.value.toUpperCase(); // Get the newly selected CEFR level
    setGameLevel(selectedCEFR); // Set and persist the new CEFR level
    resetGame(); // Reset the game stats
    startWordGame(); // Start the game with the new CEFR level
  }
});

document.addEventListener("keydown", function (event) {
  if (
    event.key === "Enter" &&
    document.getElementById("type-select").value === "word-game"
  ) {
    const nextWordButton = document.getElementById("game-next-word-button");

    // Check if the button exists and is visible using computed styles
    if (
      nextWordButton &&
      window.getComputedStyle(nextWordButton).display !== "none"
    ) {
      nextWordButton.click(); // Simulate a click on the next word button
    }
  }
});

window.toggleLevelLock = toggleLevelLock;
window.WordGameHelpers = Object.freeze({
  playWordAudio,
  stopAllAudio,
  fetchIncorrectTranslations,
  shuffleArray,
  getCurrentLevel: () => currentCEFR,
  getLevelOrder: () => CEFR_LEVEL_ORDER.slice(),
  replaceLevel: replaceGameLevel,
});
