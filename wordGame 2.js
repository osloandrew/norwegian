/* ─────────────────────────────────────────────────────────────
   WORD GAME — single-file layout
   Editing rule: comment-only refactors first; no behavior changes.
   Sections:
     1) Globals & State
     2) DOM Refs
     3) UI Messages & Constants
     4) Banner Helpers
     5) UI Builders (labels/cards/cloze)
     6) Event Handlers
     7) Game Flow
     8) Data & Selection Logic
   ──────────────────────────────────────────────────────────── */

// ───────────────── 1) Globals & State ─────────────────
let activeAudio = [];
let currentWord;
let correctTranslation;
let correctlyAnsweredWords = []; // Array to store correctly answered words
let correctLevelAnswers = 0; // Track correct answers per level
let correctCount = 0; // Tracks the total number of correct answers
let correctStreak = 0; // Track the current streak of correct answers
let currentCEFR = "A1"; // Start at A1 by default
let levelCorrectAnswers = 0;
let levelTotalQuestions = 0;
let gameActive = false;
let incorrectCount = 0; // Tracks the total number of incorrect answers
let incorrectWordQueue = []; // Queue for storing incorrect words with counters
// --- Repair Mode (auto): enter at 8 unresolved, exit at 4 ---
let repairMode = false;
const REPAIR_ENTER = 8;
const REPAIR_EXIT = 4;
const levelThresholds = {
  A1: { up: 0.85, down: null }, // Starting level — can't go lower
  A2: { up: 0.9, down: 0.6 },
  B1: { up: 0.94, down: 0.7 },
  B2: { up: 0.975, down: 0.8 },
  C: { up: null, down: 0.9 }, // Final level — can fall from here, but not climb higher
};
let previousWord = null;
let recentAnswers = []; // Track the last X answers, 1 for correct, 0 for incorrect
let reintroduceThreshold = 10; // Set how many words to show before reintroducing incorrect ones
let totalQuestions = 0; // Track total questions per level
let wordsSinceLastIncorrect = 0; // Counter to track words shown since the last incorrect word
let wordDataStore = [];
let questionsAtCurrentLevel = 0; // Track questions answered at current level
let goodChime = new Audio("Resources/Audio/goodChime.wav");
let badChime = new Audio("Resources/Audio/badChime.wav");
let popChime = new Audio("Resources/Audio/popChime.wav");

goodChime.volume = 0.2;
badChime.volume = 0.2;

// ───────────────── 2) DOM Refs ─────────────────

const gameContainer = document.getElementById("results-container"); // Assume this is where you'll display the game
const statsContainer = document.getElementById("game-session-stats"); // New container for session stats

// ───────────────── 3) UI Messages & Constants ─────────────────

// Centralized banner handler
const banners = {
  congratulations: "game-congratulations-banner",
  fallback: "game-fallback-banner",
  streak: "game-streak-banner", // New banner for 10-word streak
  clearedPracticeWords: "game-cleared-practice-banner", // New banner for clearing reintroduced words
  enterRepair: "game-repair-enter-banner",
  exitRepair: "game-repair-exit-banner",
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

const enterRepairMessages = [
  "🧩 Repair Mode activated — focusing on your toughest words!",
  "⚙️ Time to polish those tricky items!",
  "🔧 Repair Mode on — let's lock in what you’ve learned.",
  "🧠 Deep focus: tackling your hard words now.",
  "🪛 Repair Mode engaged — sharpen your weakest links!",
];

const exitRepairMessages = [
  "✅ Repair Mode complete — back to new words!",
  "🎯 You’ve stabilized those tough ones — onward!",
  "🚀 All set! Exiting Repair Mode with stronger recall.",
  "🌟 Great work — fresh words unlocked again!",
  "🏁 Repair cycle finished — let’s keep progressing!",
];

// ───────────────── 4) Banner Helpers ─────────────────

const bannerConfig = {
  congratulations: {
    class: "game-congratulations-banner",
    messages: congratulationsMessages,
  },
  fallback: {
    class: "game-fallback-banner",
    messages: fallbackMessages,
  },
  streak: {
    class: "game-streak-banner",
    messages: streakMessages,
  },
  clearedPracticeWords: {
    class: "game-cleared-practice-banner",
    messages: clearedPracticeMessages,
  },
  levelLockLocked: {
    class: "game-lock-banner",
    messages: lockToggleMessages.locked,
  },
  levelLockUnlocked: {
    class: "game-lock-banner",
    messages: lockToggleMessages.unlocked,
  },
  enterRepair: {
    class: "game-repair-enter-banner",
    messages: enterRepairMessages,
  },
  exitRepair: {
    class: "game-repair-exit-banner",
    messages: exitRepairMessages,
  },
};

function showBanner(type, level) {
  const bannerPlaceholder = document.getElementById("game-banner-placeholder");
  if (!bannerPlaceholder) return;

  // Special handling for lock toggle
  const key =
    type === "levelLock"
      ? level === "locked"
        ? "levelLockLocked"
        : "levelLockUnlocked"
      : type;

  const config = bannerConfig[key];
  if (!config) return;

  let message = pickRandom(config.messages);
  if (level) message = message.replace("{X}", level);

  bannerPlaceholder.innerHTML = `
    <div class="${config.class}">
      <p>${message}</p>
    </div>`;
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

function isBaseForm(word, baseWord) {
  return word.toLowerCase() === baseWord.toLowerCase();
}

function toggleGameEnglish() {
  const englishSelect = document.getElementById("game-english-select");
  const translationElement = document.querySelector(
    ".game-cefr-spacer .game-english-translation"
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

  // Inject HTML only if it hasn't been rendered yet
  if (!statsContainer.querySelector(".level-progress-bar-fill")) {
    statsContainer.innerHTML = `
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
    `;
  }

  // Update existing elements only
  const fillEl = statsContainer.querySelector(".level-progress-bar-fill");
  const labelEl = statsContainer.querySelector(".level-progress-label");
  const streakEl = statsContainer.querySelector("#streak-count");
  const reviewEl = statsContainer.querySelector("#review-count");

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
}

// ───────────────── 7) Game Flow ─────────────────

function prepareGameUI() {
  // Show lock icon visual
  const lockIcon = document.getElementById("lock-icon");
  if (lockIcon) lockIcon.style.display = "inline";
  // Quick DOM utilities
  const el = (id) => document.getElementById(id);
  // Collect refs (unchanged names from your function)
  const refs = {
    searchContainerInner: el("search-container-inner"),
    searchBarWrapper: el("search-bar-wrapper"),
    randomBtn: el("random-btn"),
    posFilterContainer: document.querySelector(".pos-filter"),
    genreFilterContainer: el("genre-filter"),
    cefrFilterContainer: document.querySelector(".cefr-filter"),
    gameEnglishFilterContainer: document.querySelector(".game-english-filter"),
    posSelect: el("pos-select"),
    cefrSelect: el("cefr-select"),
    gameEnglishSelect: el("game-english-select"),
  };

  // Behavior identical to current code
  showLandingCard(false);
  hideAllBanners();

  // Hide/search controls as before
  if (refs.searchBarWrapper) refs.searchBarWrapper.style.display = "none";
  if (refs.randomBtn) refs.randomBtn.style.display = "none";
  if (refs.genreFilterContainer)
    refs.genreFilterContainer.style.display = "none";
  if (refs.posFilterContainer) refs.posFilterContainer.style.display = "none";
  if (refs.cefrSelect) refs.cefrSelect.disabled = false;
  if (refs.cefrFilterContainer)
    refs.cefrFilterContainer.classList.remove("disabled");
  if (refs.gameEnglishSelect)
    refs.gameEnglishSelect.style.display = "inline-flex";
  if (refs.gameEnglishFilterContainer)
    refs.gameEnglishFilterContainer.style.display = "inline-flex";
  if (refs.searchContainerInner)
    refs.searchContainerInner.classList.add("word-game-active");
  // Reset POS select like before
  if (refs.posSelect) refs.posSelect.value = "";
  return refs;
}

function toggleRepairModeAuto() {
  if (!repairMode && incorrectWordQueue.length >= REPAIR_ENTER) {
    enterRepairMode();
  } else if (repairMode && incorrectWordQueue.length <= REPAIR_EXIT) {
    exitRepairMode();
  }
}

function serveFromQueue_repairMode(firstWordInQueue) {
  // Rotate so we cycle through all wrong words
  const item = incorrectWordQueue.shift();
  incorrectWordQueue.push(item);

  currentWord = item.wordObj.ord;
  correctTranslation = item.wordObj.engelsk;

  if (item.exerciseType === "cloze") {
    const randomWordObj = item.wordObj;
    const baseWord = randomWordObj.ord.split(",")[0].trim().toLowerCase();
    const matchingEntry = results.find(
      (r) =>
        r.ord.toLowerCase() === randomWordObj.ord.toLowerCase() &&
        r.gender === randomWordObj.gender &&
        r.CEFR === randomWordObj.CEFR
    );
    const exampleText = matchingEntry?.eksempel || "";
    const firstSentence = exampleText.split(/(?<=[.!?])\s+/)[0];

    let clozedForm = item.clozedForm;
    const formattedClozed = clozedForm.toLowerCase();

    const distractors = generateClozeDistractors(
      baseWord,
      clozedForm,
      randomWordObj.CEFR,
      randomWordObj.gender
    );

    let allWords = shuffleArray([formattedClozed, ...distractors]);
    let uniqueWords = ensureUniqueDisplayedValues(allWords);

    if (/^\p{Lu}/u.test(clozedForm)) {
      uniqueWords = uniqueWords.map(
        (word) => word.charAt(0).toUpperCase() + word.slice(1)
      );
    }

    if (uniqueWords.length < 4) {
      const fallbackPool = results
        .map((r) => r.ord.split(",")[0].trim().toLowerCase())
        .filter(
          (w) =>
            w &&
            w !== formattedClozed &&
            !uniqueWords.includes(w) &&
            !noRandom.includes(w)
        );
      while (uniqueWords.length < 4 && fallbackPool.length > 0) {
        const candidate = pickRandom(fallbackPool);
        if (!uniqueWords.includes(candidate)) uniqueWords.push(candidate);
      }
    }
    renderClozeGameUI(randomWordObj, uniqueWords, clozedForm, true);
  } else if (item.exerciseType === "listening") {
    let incorrectTranslations = fetchIncorrectTranslations(
      item.wordObj.gender,
      correctTranslation,
      item.wordObj.CEFR
    );
    if (incorrectTranslations.length < 3) {
      const additionalTranslations =
        fetchIncorrectTranslationsFromOtherCEFRLevels(
          item.wordObj.gender,
          correctTranslation
        );
      incorrectTranslations = incorrectTranslations.concat(
        additionalTranslations
      );
    }
    const allTranslations = shuffleArray([
      correctTranslation,
      ...incorrectTranslations,
    ]);
    const uniqueDisplayedTranslations =
      ensureUniqueDisplayedValues(allTranslations);
    renderListeningGameUI(item.wordObj, uniqueDisplayedTranslations, true);
  } else {
    let incorrectTranslations = fetchIncorrectTranslations(
      item.wordObj.gender,
      correctTranslation,
      item.wordObj.CEFR
    );
    if (incorrectTranslations.length < 3) {
      const additionalTranslations =
        fetchIncorrectTranslationsFromOtherCEFRLevels(
          item.wordObj.gender,
          correctTranslation
        );
      incorrectTranslations = incorrectTranslations.concat(
        additionalTranslations
      );
    }
    const allTranslations = shuffleArray([
      correctTranslation,
      ...incorrectTranslations,
    ]);
    const uniqueDisplayedTranslations =
      ensureUniqueDisplayedValues(allTranslations);
    renderWordGameUI(item.wordObj, uniqueDisplayedTranslations, true);
  }

  item.shown = true;
  // Do NOT advance wordsSinceLastIncorrect in Repair Mode
  renderStats();
}

function serveFromQueue_nonRepairMode(firstWordInQueue) {
  // pop sound only when counter >= 10
  popChime.currentTime = 0;
  popChime.play();

  currentWord = firstWordInQueue.wordObj.ord;
  correctTranslation = firstWordInQueue.wordObj.engelsk;

  if (firstWordInQueue.exerciseType === "cloze") {
    const randomWordObj = firstWordInQueue.wordObj;
    const baseWord = randomWordObj.ord.split(",")[0].trim().toLowerCase();
    const matchingEntry = results.find(
      (r) =>
        r.ord.toLowerCase() === randomWordObj.ord.toLowerCase() &&
        r.gender === randomWordObj.gender &&
        r.CEFR === randomWordObj.CEFR
    );
    const exampleText = matchingEntry?.eksempel || "";
    const firstSentence = exampleText.split(/(?<=[.!?])\s+/)[0];

    let clozedForm = firstWordInQueue.clozedForm;
    const formattedClozed = clozedForm.toLowerCase();

    const distractors = generateClozeDistractors(
      baseWord,
      clozedForm,
      randomWordObj.CEFR,
      randomWordObj.gender
    );

    let allWords = shuffleArray([formattedClozed, ...distractors]);
    let uniqueWords = ensureUniqueDisplayedValues(allWords);

    if (/^\p{Lu}/u.test(clozedForm)) {
      uniqueWords = uniqueWords.map(
        (word) => word.charAt(0).toUpperCase() + word.slice(1)
      );
    }

    if (uniqueWords.length < 4) {
      const fallbackPool = results
        .map((r) => r.ord.split(",")[0].trim().toLowerCase())
        .filter(
          (w) =>
            w &&
            w !== formattedClozed &&
            !uniqueWords.includes(w) &&
            !noRandom.includes(w)
        );

      while (uniqueWords.length < 4 && fallbackPool.length > 0) {
        const candidate = pickRandom(fallbackPool);
        if (!uniqueWords.includes(candidate)) uniqueWords.push(candidate);
      }
    }

    renderClozeGameUI(firstWordInQueue.wordObj, uniqueWords, clozedForm, true);
  } else if (firstWordInQueue.exerciseType === "listening") {
    let incorrectTranslations = fetchIncorrectTranslations(
      firstWordInQueue.wordObj.gender,
      correctTranslation,
      firstWordInQueue.wordObj.CEFR
    );
    if (incorrectTranslations.length < 3) {
      const additionalTranslations =
        fetchIncorrectTranslationsFromOtherCEFRLevels(
          firstWordInQueue.wordObj.gender,
          correctTranslation
        );
      incorrectTranslations = incorrectTranslations.concat(
        additionalTranslations
      );
    }
    const allTranslations = shuffleArray([
      correctTranslation,
      ...incorrectTranslations,
    ]);
    const uniqueDisplayedTranslations =
      ensureUniqueDisplayedValues(allTranslations);
    renderListeningGameUI(
      firstWordInQueue.wordObj,
      uniqueDisplayedTranslations,
      true
    );
  } else {
    let incorrectTranslations = fetchIncorrectTranslations(
      firstWordInQueue.wordObj.gender,
      correctTranslation,
      firstWordInQueue.wordObj.CEFR
    );

    if (incorrectTranslations.length < 3) {
      const additionalTranslations =
        fetchIncorrectTranslationsFromOtherCEFRLevels(
          firstWordInQueue.wordObj.gender,
          correctTranslation
        );
      incorrectTranslations = incorrectTranslations.concat(
        additionalTranslations
      );
    }

    const allTranslations = shuffleArray([
      correctTranslation,
      ...incorrectTranslations,
    ]);
    const uniqueDisplayedTranslations =
      ensureUniqueDisplayedValues(allTranslations);

    renderWordGameUI(
      firstWordInQueue.wordObj,
      uniqueDisplayedTranslations,
      true
    );
  }

  firstWordInQueue.shown = true;
  wordsSinceLastIncorrect = 0;
  renderStats();
}

function maybeServeFromRepairQueue() {
  if (incorrectWordQueue.length === 0) return false;

  if (repairMode) {
    serveFromQueue_repairMode(incorrectWordQueue[0]);
    return true;
  }

  if (wordsSinceLastIncorrect >= reintroduceThreshold) {
    const firstWordInQueue = incorrectWordQueue[0];
    if (firstWordInQueue.counter >= 10) {
      serveFromQueue_nonRepairMode(firstWordInQueue);
      return true;
    } else {
      // increment counters if threshold reached but not ready to pop
      incorrectWordQueue.forEach((w) => w.counter++);
    }
  }

  return false;
}

function pickQuestionType(cefr) {
  const questionWeights = {
    A1: { cloze: 0.2, listening: 0.25 }, // matching 0.55
    A2: { cloze: 0.35, listening: 0.25 }, // matching 0.40
    B1: { cloze: 0.5, listening: 0.25 }, // matching 0.25
    B2: { cloze: 0.6, listening: 0.25 }, // matching 0.15
    C: { cloze: 0.7, listening: 0.2 }, // matching 0.10
  };
  const weights = questionWeights[cefr] || questionWeights["A1"];
  const r = Math.random();
  if (r < weights.cloze) return "cloze";
  if (r < weights.cloze + weights.listening) return "listening";
  return "flashcard";
}

async function renderClozeQuestion(randomWordObj, uniqueDisplayedTranslations) {
  const baseWord = randomWordObj.ord.split(",")[0].trim().toLowerCase();
  const matchingEntry = results.find(
    (r) =>
      r.ord.toLowerCase() === randomWordObj.ord.toLowerCase() &&
      r.gender === randomWordObj.gender &&
      r.CEFR === randomWordObj.CEFR
  );
  const exampleText = matchingEntry?.eksempel || "";
  const firstSentence = exampleText.split(/(?<=[.!?])\s+/)[0];
  const tokens = firstSentence.match(/\p{L}+/gu) || [];

  let clozedForm = null;
  const baseWordTokens = baseWord.split(/\s+/);

  // original nested search
  for (let start = 0; start < tokens.length; start++) {
    for (let end = start + 1; end <= tokens.length; end++) {
      const group = tokens.slice(start, end);
      const joinedWithSpace = group.join(" ").toLowerCase();
      const joinedWithHyphen = group.join("-").toLowerCase();

      if (
        matchesInflectedForm(baseWord, joinedWithSpace, randomWordObj.gender)
      ) {
        clozedForm = group.join(" ");
        break;
      }
      if (
        matchesInflectedForm(baseWord, joinedWithHyphen, randomWordObj.gender)
      ) {
        clozedForm = group.join("-");
        break;
      }
    }
    if (clozedForm) break;
  }

  if (!clozedForm) {
    const cleanedTokens = tokens.map((t) =>
      t.toLowerCase().replace(/[.,!?;:()"]/g, "")
    );
    const normalizedTokens = cleanedTokens;
    const normalizedBase = baseWord;

    let fallbackClozed = null;
    for (let len = normalizedBase.length; len > 2; len--) {
      const prefix = normalizedBase.slice(0, len);
      const matchIndex = normalizedTokens.findIndex((t) =>
        t.startsWith(prefix)
      );
      if (matchIndex !== -1) {
        const endIndex = matchIndex + baseWordTokens.length - 1;
        const matchedTokens = tokens.slice(matchIndex, endIndex + 1);

        const restOfBase = baseWordTokens.slice(1).join(" ");
        const restOfSentence = matchedTokens.slice(1).join(" ").toLowerCase();

        if (restOfSentence === restOfBase) {
          fallbackClozed = matchedTokens.join(" ");
        } else {
          fallbackClozed = tokens[matchIndex];
        }
        break;
      }
    }

    if (fallbackClozed) {
      clozedForm = fallbackClozed;
    } else {
      // fallback to flashcard if cloze not possible
      renderWordGameUI(randomWordObj, uniqueDisplayedTranslations, false);
      return;
    }
  }

  const formatCase = (w) => w.charAt(0).toLowerCase() + w.slice(1);
  let formattedClozed = formatCase(clozedForm);
  const wasCapitalizedFromLowercase =
    !/^\p{Lu}/u.test(baseWord) && /^\p{Lu}/u.test(clozedForm);

  const distractors = generateClozeDistractors(
    baseWord,
    formattedClozed,
    randomWordObj.CEFR,
    randomWordObj.gender
  );

  let allWords = shuffleArray([formattedClozed, ...distractors]);
  let uniqueWords = ensureUniqueDisplayedValues(allWords);

  if (wasCapitalizedFromLowercase) {
    uniqueWords = uniqueWords.map(
      (word) => word.charAt(0).toUpperCase() + word.slice(1)
    );
    formattedClozed =
      formattedClozed.charAt(0).toUpperCase() + formattedClozed.slice(1);
  }

  if (uniqueWords.length < 4) {
    const fallbackPool = results
      .map((r) => r.ord.split(",")[0].trim().toLowerCase())
      .filter(
        (w) =>
          w &&
          w !== formattedClozed &&
          !uniqueWords.includes(w) &&
          !noRandom.includes(w)
      );

    while (uniqueWords.length < 4 && fallbackPool.length > 0) {
      const candidate = pickRandom(fallbackPool);
      if (!uniqueWords.includes(candidate)) {
        uniqueWords.push(candidate);
      }
    }
  }

  await renderClozeGameUI(randomWordObj, uniqueWords, formattedClozed, false);
}

async function serveNewWord() {
  // Keep this exactly like before
  wordsSinceLastIncorrect++;

  if (!currentCEFR) currentCEFR = "A1";

  const randomWordObj = await fetchRandomWord();
  if (!randomWordObj) return;

  currentWord = randomWordObj;
  correctTranslation = randomWordObj.engelsk;

  const questionType = pickQuestionType(randomWordObj.CEFR);
  console.log("Question type:", questionType);

  const bannedWordClasses = ["numeral", "pronoun", "possessive", "determiner"];

  const incorrectTranslations = fetchIncorrectTranslations(
    randomWordObj.gender,
    correctTranslation,
    currentCEFR
  );

  const allTranslations = shuffleArray([
    correctTranslation,
    ...incorrectTranslations,
  ]);
  const uniqueDisplayedTranslations =
    ensureUniqueDisplayedValues(allTranslations);

  // Skip cloze for banned classes
  if (
    questionType === "cloze" &&
    bannedWordClasses.some((b) =>
      randomWordObj.gender?.toLowerCase().startsWith(b)
    )
  ) {
    renderWordGameUI(randomWordObj, uniqueDisplayedTranslations, false);
    return;
  }

  // Logging parity
  console.log(
    "Showing " +
      (questionType === "cloze"
        ? "CLOZE"
        : questionType === "listening"
        ? "LISTENING"
        : "FLASHCARD") +
      " question for:",
    randomWordObj.ord
  );
  if (questionType === "cloze") {
    console.log(
      `[CLOZE] Attempting cloze for: "${randomWordObj.ord}" (${randomWordObj.gender}, ${randomWordObj.CEFR})`
    );
  } else {
    console.log(
      `[FLASHCARD] Showing regular question for: "${randomWordObj.ord}"`
    );
  }

  if (questionType === "cloze") {
    await renderClozeQuestion(randomWordObj, uniqueDisplayedTranslations);
  } else if (questionType === "listening") {
    renderListeningGameUI(randomWordObj, uniqueDisplayedTranslations, false);
  } else {
    renderWordGameUI(randomWordObj, uniqueDisplayedTranslations, false);
  }

  renderStats();
}

async function startWordGame() {
  const refs = prepareGameUI();
  gameActive = true;

  toggleRepairModeAuto();

  // If we served a queued item (repair or non-repair), stop here
  if (maybeServeFromRepairQueue()) return;

  // Otherwise, serve a fresh word
  await serveNewWord();
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

// ───────────────── 5) UI Builders ─────────────────

function buildCEFRLabel(level) {
  const classMap = {
    A1: "easy",
    A2: "easy",
    B1: "medium",
    B2: "medium",
    C: "hard",
  };
  const cls = classMap[level] || "unknown";
  return `<div class="game-cefr-label ${cls}">${level}</div>`;
}

function pickRandom(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortGenderLabel(gender = "") {
  const map = {
    noun: "Noun",
    en: "N - En",
    ei: "N - Ei",
    et: "N - Et",
    "en-et": "N - En-Et",
    "en-ei-et": "N - En-Ei-Et",
    adjective: "Adj",
    adverb: "Adv",
    conjunction: "Conj",
    determiner: "Det",
    expression: "Exp",
    interjection: "Inter",
    numeral: "Num",
    particle: "Part",
    possessive: "Poss",
    preposition: "Prep",
    pronoun: "Pron",
  };
  const key = Object.keys(map).find((k) => gender.startsWith(k));
  return map[key] || gender;
}

function smoothReplace(contentHTML) {
  gameContainer.classList.remove("show");
  gameContainer.classList.add("game-fade");

  // Fade out
  gameContainer.style.opacity = "0";

  setTimeout(() => {
    gameContainer.innerHTML = contentHTML;
    // Fade in
    requestAnimationFrame(() => {
      gameContainer.style.opacity = "1";
      gameContainer.classList.add("show");
    });
  }, 250); // 250ms fade-out before showing new content
}

function renderGameUI({
  mode, // "flashcard" | "cloze" | "listening"
  wordObj,
  translations, // array of strings
  isReintroduced = false,
  clozedWordForm = "", // only for cloze
  englishTranslation = "", // optional
  sentenceWithBlank = "",
}) {
  const wordId = wordDataStore.push(wordObj) - 1;
  const cefrLabel = buildCEFRLabel(wordObj.CEFR);
  const displayedGender = shortGenderLabel(wordObj.gender);
  const tricky = isReintroduced
    ? '<div class="game-tricky-word visible"><i class="fa fa-repeat" aria-hidden="true"></i></div>'
    : '<div class="game-tricky-word" style="visibility:hidden;"><i class="fa fa-repeat" aria-hidden="true"></i></div>';

  // 1) Mode-specific inner content for the .game-word area
  let wordAreaHTML = "";
  if (mode === "flashcard") {
    const displayedWord = wordObj.ord.split(",")[0].trim();
    wordAreaHTML = `<h2>${displayedWord}</h2>`;
  } else if (mode === "cloze") {
    const shown = sentenceWithBlank || "___";
    wordAreaHTML = `<h2 id="cloze-sentence">${shown}</h2>`; // no English in cloze UI
  } else if (mode === "listening") {
    const hidden = wordObj.ord.split(",")[0].trim();
    wordAreaHTML = `
  <div style="display:flex;justify-content:center;align-items:center;min-height:100px;">
    <div id="listening-audio-button" class="audio-button" title="Play pronunciation">
      <img src="Resources/Photos/pronunciation.svg" alt="Play pronunciation" />
    </div>
    <h2 id="hidden-word" style="display:none;">${hidden}</h2>
  </div>
`;
  }

  // 2) Build HTML shell once
  gameContainer.innerHTML = `
    <div class="game-stats-content" id="game-session-stats"></div>

    <div class="game-word-card">
      <div class="game-labels-container">
        <div class="game-label-subgroup">
          <div class="game-gender">${displayedGender}</div>
          ${cefrLabel}
        </div>
        <div id="game-banner-placeholder"></div>
        <div class="game-label-subgroup">
          ${tricky}
        </div>
      </div>

      <div class="game-word">
        ${wordAreaHTML}
      </div>

      <div class="game-cefr-spacer"></div>
    </div>

    <div class="game-grid">
      ${translations
        .map(
          (t, i) => `
          <div class="game-translation-card" data-id="${wordId}" data-index="${i}">
            ${t.split(",")[0].trim()}
          </div>`
        )
        .join("")}
    </div>

    <div class="game-next-button-container">
      <button id="game-next-word-button" disabled>Next Word</button>
    </div>
  `;

  // 3) Common bindings
  document
    .getElementById("game-next-word-button")
    .addEventListener("click", async () => {
      stopAllAudio();
      hideAllBanners();
      await startWordGame();
    });

  // Mode-specific bindings
  if (mode === "listening") {
    const cardEl = document.querySelector(".game-word-card");
    const playBtn = document.getElementById("listening-audio-button");
    if (cardEl && playBtn) {
      cardEl.style.cursor = "pointer";
      cardEl.addEventListener("click", () => {
        playBtn.classList.add("clicked");
        setTimeout(() => playBtn.classList.remove("clicked"), 200);
        playWordAudio(wordObj);
      });
    }
  }

  // 4) Card click handlers mapped by mode
  document.querySelectorAll(".game-translation-card").forEach((card) => {
    card.addEventListener("click", function () {
      const id = this.getAttribute("data-id");
      const selected = this.innerText.trim();
      const wo = wordDataStore[id];

      if (mode === "listening") {
        handleListeningAnswer(selected, wo);
      } else {
        // pass the questionType so the cloze behavior after a correct answer still updates the sentence
        const qType = mode === "cloze" ? "cloze" : "flashcard";
        handleTranslationClick(selected, wo, qType);
      }
    });
  });

  renderStats();

  // 5) Auto audio behavior parity with existing functions
  if (mode === "listening") {
    playWordAudio(wordObj);
  } else if (mode === "flashcard") {
    playWordAudio(wordObj); // ✅ restore word audio for flashcards
  } else {
  }
}

function renderWordGameUI(wordObj, translations, isReintroduced = false) {
  renderGameUI({
    mode: "flashcard",
    wordObj,
    translations,
    isReintroduced,
  });
}

async function renderClozeGameUI(
  wordObj,
  translations,
  clozedWordForm,
  isReintroduced = false,
  englishTranslation = ""
) {
  // 1) Get the best example sentence + its translation (if present)
  const baseWord = wordObj.ord.split(",")[0].trim();
  let exampleSentence = "";
  let sentenceTranslation = "";

  try {
    const fetched = await fetchExampleSentence(wordObj); // returns { exampleSentence, sentenceTranslation }
    if (fetched) {
      exampleSentence = fetched.exampleSentence || "";
      sentenceTranslation = fetched.sentenceTranslation || "";
    }
  } catch (e) {
    // silently continue; we'll fall back below
  }

  // 2) Build the cloze sentence: prefer the actual clozed form; fall back to base lemma
  let sentenceWithBlank = "";
  if (exampleSentence) {
    const candidates = [clozedWordForm, baseWord].filter(Boolean);
    let s = exampleSentence;

    for (const c of candidates) {
      // Match any inflected or hyphenated form containing the base
      const re = new RegExp(
        `(?<!\\p{L})${escapeRegExp(c)}\\p{L}*(?!\\p{L})`,
        "iu"
      );
      if (re.test(s)) {
        s = s.replace(re, "___");
        break;
      }
    }

    // Guarantee at least one blank
    if (!s.includes("___")) {
      const words = s.split(/\s+/);
      if (words.length > 0) {
        s = s.replace(words[0], "___");
      }
    }

    sentenceWithBlank = s || "";
  }

  // 3) Prefer the function’s englishTranslation arg, otherwise use paired sentenceTranslation
  const english =
    englishTranslation && englishTranslation.trim()
      ? englishTranslation
      : sentenceTranslation;

  // ✅ Ensure sentenceWithBlank really contains the blank
  if (sentenceWithBlank && !sentenceWithBlank.includes("___")) {
    const base = clozedWordForm || wordObj.ord.split(",")[0].trim();
    const re = new RegExp(`\\b${escapeRegExp(base)}\\b`, "i");
    sentenceWithBlank = sentenceWithBlank.replace(re, "___");
  }

  // 4) Make sure the evaluator compares Croatian→Croatian
  wordObj.clozeAnswer = clozedWordForm;

  // 5) Delegate to the unified renderer
  renderGameUI({
    mode: "cloze",
    wordObj,
    translations,
    isReintroduced,
    clozedWordForm,
    englishTranslation: english,
    sentenceWithBlank,
  });
}

// ───────────────── 6) Event Handlers ─────────────────

async function handleTranslationClick(
  selectedTranslation,
  wordObj,
  questionType
) {
  if (!gameActive) return; // Prevent further clicks if the game is not active

  gameActive = false; // Disable further clicks until the next word is generated

  const cards = document.querySelectorAll(".game-translation-card");

  // Reset all cards to their default visual state
  cards.forEach((card) => {
    card.classList.remove(
      "game-correct-card",
      "game-incorrect-card",
      "distractor-muted"
    );
  });

  // Extract the part before the comma for both correct and selected translations
  const correctTranslationPart = (wordObj.clozeAnswer || correctTranslation)
    .split(",")[0]
    .trim();
  const selectedTranslationPart = selectedTranslation.split(",")[0].trim();

  totalQuestions++; // Increment total questions for this level
  questionsAtCurrentLevel++; // Increment questions at this level
  const { exampleSentence, sentenceTranslation } = await fetchExampleSentence(
    wordObj
  );
  console.log("Fetched example sentence:", exampleSentence);

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
    // Add the word to the correctly answered words array to exclude it from future questions
    correctlyAnsweredWords.push(wordObj.ord);

    if (questionType === "cloze") {
      const fullSentence =
        results.find(
          (r) =>
            r.ord.toLowerCase() === wordObj.ord.toLowerCase() &&
            r.gender === wordObj.gender &&
            r.CEFR === wordObj.CEFR
        )?.eksempel || "";

      const firstSentence = fullSentence.split(/(?<=[.!?])\s+/)[0];
      const sentenceElement = document.getElementById("cloze-sentence");
      if (sentenceElement && firstSentence) {
        sentenceElement.textContent = firstSentence;
      }
    }

    const indexInQueue = incorrectWordQueue.findIndex(
      (incorrectWord) =>
        incorrectWord.wordObj.ord === wordObj.ord && incorrectWord.shown
    );
    if (indexInQueue !== -1) {
      incorrectWordQueue.splice(indexInQueue, 1);

      // --- Auto-exit rule: drop Repair Mode when backlog is down to 4 ---
      if (repairMode && incorrectWordQueue.length <= REPAIR_EXIT) {
        exitRepairMode();
      }
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

    if (questionType === "cloze") {
      const fullSentence =
        results.find(
          (r) =>
            r.ord.toLowerCase() === wordObj.ord.toLowerCase() &&
            r.gender === wordObj.gender &&
            r.CEFR === wordObj.CEFR
        )?.eksempel || "";

      const firstSentence = fullSentence.split(/(?<=[.!?])\s+/)[0];
      const sentenceElement = document.getElementById("cloze-sentence");
      if (sentenceElement && firstSentence) {
        sentenceElement.textContent = firstSentence;
      }
    }

    // If the word isn't already in the review queue, add it
    const inQueueAlready = incorrectWordQueue.some(
      (incorrectWord) => incorrectWord.wordObj.ord === wordObj.ord
    );
    if (!inQueueAlready) {
      incorrectWordQueue.push({
        wordObj: {
          ord: wordObj.ord, // explicitly using wordObj.ord here
          engelsk: correctTranslation,
          gender: wordObj.gender,
          CEFR: wordObj.CEFR,
          uttale: wordObj.uttale,
          eksempel: wordObj.eksempel, // needed to rebuild sentence
        },
        counter: 0, // Start counter for this word
        exerciseType: questionType,
        clozedForm: wordObj.clozeAnswer || wordObj.ord.split(",")[0].trim(), // ✅, // << STORE the clozed form separately!
      });
      // --- trigger Repair Mode immediately on 8th wrong word ---
      if (!repairMode && incorrectWordQueue.length >= REPAIR_ENTER) {
        enterRepairMode();
      }
    }
  }

  // Enable the "Next Word" button
  document.getElementById("game-next-word-button").disabled = false;

  // Update the stats after the answer
  renderStats();

  // Only evaluate progression if at least 20 questions have been answered at the current level
  if (questionsAtCurrentLevel >= 20) {
    evaluateProgression();
    questionsAtCurrentLevel = 0; // Reset the counter after progression evaluation
  }
  if (exampleSentence && questionType !== "cloze") {
    const completedSentence = exampleSentence;

    const translationHTML = `
      <p class="game-english-translation" style="display: ${
        document.getElementById("game-english-select").value === "show-english"
          ? "inline-block"
          : "none"
      };">${sentenceTranslation}</p>`;

    document.querySelector(".game-cefr-spacer").innerHTML = `
      <div class="sentence-pair">
        <p>${completedSentence}</p>
        ${translationHTML}
      </div>
    `;
  } else if (exampleSentence && questionType === "cloze") {
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

  document.getElementById("game-next-word-button").style.display = "block";
}

async function handleListeningAnswer(selectedTranslation, wordObj) {
  // 🚫 Prevent multiple clicks after answering
  if (document.getElementById("game-next-word-button").disabled === false) {
    return; // already answered
  }

  const cards = document.querySelectorAll(".game-translation-card");
  const correctPart = wordObj.engelsk.split(",")[0].trim();
  const selectedPart = selectedTranslation.split(",")[0].trim();

  if (selectedPart === correctPart) {
    goodChime.currentTime = 0;
    goodChime.play();
    cards.forEach((c) => {
      if (c.innerText.trim() === selectedPart)
        c.classList.add("game-correct-card");
      else c.classList.add("distractor-muted");
    });
    correctCount++;
    correctStreak++;
    updateRecentAnswers(true);

    totalQuestions++;
    questionsAtCurrentLevel++;

    correctlyAnsweredWords.push(wordObj.ord);

    // ✅ Outside repair mode — remove if it was reintroduced
    const indexInQueue = incorrectWordQueue.findIndex(
      (incorrectWord) =>
        incorrectWord.wordObj.ord === wordObj.ord && incorrectWord.shown
    );
    if (indexInQueue !== -1) {
      incorrectWordQueue.splice(indexInQueue, 1);

      // --- Auto-exit rule: drop Repair Mode when backlog is down to 4 ---
      if (repairMode && incorrectWordQueue.length <= REPAIR_EXIT) {
        exitRepairMode();
      }
    }
  } else {
    badChime.currentTime = 0;
    badChime.play();
    cards.forEach((c) => {
      const text = c.innerText.trim();
      if (text === selectedPart) c.classList.add("game-incorrect-card");
      else if (text === correctPart) c.classList.add("game-correct-card");
      else c.classList.add("distractor-muted");
    });
    incorrectCount++;
    correctStreak = 0;
    updateRecentAnswers(false);

    totalQuestions++;
    questionsAtCurrentLevel++;

    const inQueue = incorrectWordQueue.some(
      (q) => q.wordObj.ord === wordObj.ord
    );
    if (!inQueue) {
      incorrectWordQueue.push({
        wordObj,
        counter: 0,
        exerciseType: "listening",
      });
    }
  }

  // Swap icon → word (no layout shift)
  const audioButton = document.getElementById("listening-audio-button");
  const wordElement = document.getElementById("hidden-word");
  if (audioButton && wordElement) {
    audioButton.style.display = "none";
    wordElement.style.display = "block";
  }

  // Reveal the word after answering
  document.getElementById("hidden-word").style.visibility = "visible";
  document.getElementById("game-next-word-button").disabled = false;
  renderStats();
  // Swap icon → word
  if (audioButton && wordElement) {
    audioButton.style.display = "none";
    wordElement.style.display = "block";
  }

  // Enable next button
  document.getElementById("game-next-word-button").disabled = false;
  renderStats();

  // 🗣️ Show example sentence and play its audio
  const { exampleSentence, sentenceTranslation } = await fetchExampleSentence(
    wordObj
  );
  if (exampleSentence) {
    const cefrSpacer = document.querySelector(".game-cefr-spacer");
    if (cefrSpacer) {
      const translationHTML = `
      <p class="game-english-translation" style="display: ${
        document.getElementById("game-english-select").value === "show-english"
          ? "inline-block"
          : "none"
      };">${sentenceTranslation}</p>`;

      cefrSpacer.innerHTML = `
      <div class="sentence-pair">
        <p class="game-croatian-sentence">${exampleSentence}</p>
        ${translationHTML}
      </div>
    `;
    }

    // 🔊 Auto-play sentence audio (same as other modes)
    playSentenceAudio(exampleSentence);
  } else {
    document.querySelector(".game-cefr-spacer").innerHTML = "";
  }
}

async function fetchExampleSentence(wordObj) {
  console.log("Fetching example sentence for:", wordObj);

  // Ensure gender and CEFR are defined before performing the search
  if (!wordObj.gender || !wordObj.CEFR || !wordObj.ord) {
    console.warn("Missing required fields for search:", wordObj);
    return null;
  }

  // Find the exact matching word object based on 'ord', 'definisjon', 'gender', and 'CEFR'
  let matchingEntry = results.find(
    (result) =>
      result.ord.toLowerCase() === wordObj.ord.toLowerCase() &&
      result.gender === wordObj.gender &&
      result.CEFR === wordObj.CEFR
  );

  // Log the matching entry or lack thereof
  if (matchingEntry) {
    console.log("Matching entry found:", matchingEntry);
    console.log("Example sentence found:", matchingEntry.eksempel);
  } else {
    console.warn(`No matching entry found for word: ${wordObj.ord}`);
  }

  // Step 2: Check if the matching entry has an example sentence
  if (
    !matchingEntry ||
    !matchingEntry.eksempel ||
    matchingEntry.eksempel.trim() === ""
  ) {
    console.log(
      `No example sentence available for word: ${wordObj.ord} with specified gender and CEFR.`
    );

    // Step 3: Search for another entry with the same 'ord' but without considering 'gender' or 'CEFR'
    matchingEntry = results.find(
      (result) =>
        result.eksempel &&
        result.eksempel.toLowerCase().startsWith(wordObj.ord.toLowerCase())
    );
    if (matchingEntry) {
      console.log(
        "Found example sentence from another word entry:",
        matchingEntry.eksempel
      );
    } else {
      console.warn(
        `No example sentence found in the entire dataset containing the word: ${wordObj.ord}`
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

function renderListeningGameUI(wordObj, translations, isReintroduced = false) {
  renderGameUI({
    mode: "listening",
    wordObj,
    translations,
    isReintroduced,
  });
}

// ───────────────── 8) Data & Selection Logic ─────────────────

async function fetchRandomWord() {
  const selectedPOS = document.getElementById("pos-select")
    ? document.getElementById("pos-select").value.toLowerCase()
    : "";

  // Always use the current CEFR level, whether it's A1 by default or selected by the user
  const cefrLevel = currentCEFR;

  // Filter results based on CEFR, POS, and excluding the previous word
  let filteredResults = results.filter(
    (r) =>
      r.engelsk &&
      !noRandom.includes(r.ord.toLowerCase()) &&
      r.ord !== previousWord &&
      r.CEFR === cefrLevel && // Ensure the word belongs to the same CEFR level
      !correctlyAnsweredWords.includes(r.ord) // Exclude words already answered correctly
  );

  if (selectedPOS) {
    filteredResults = filteredResults.filter((r) => {
      const gender = r.gender ? r.gender.toLowerCase() : "";

      // Handle nouns: Include "en", "et", "ei" but exclude "pronoun"
      if (selectedPOS === "noun") {
        return (
          (gender.startsWith("noun") ||
            gender.startsWith("en") ||
            gender.startsWith("ei") ||
            gender.startsWith("et")) &&
          gender !== "pronoun"
        );
      }

      // For non-noun POS, filter based on the selectedPOS value
      return gender.startsWith(selectedPOS);
    });
  }

  if (cefrLevel) {
    // Filter by CEFR level if selected
    filteredResults = filteredResults.filter(
      (r) => r.CEFR && r.CEFR.toUpperCase() === cefrLevel
    );
  }

  // Filter out words where the Croatian word and its English translation are identical
  filteredResults = filteredResults.filter((r) => {
    // Split and trim the Croatian word (handle comma-separated words)
    const croatianWord = r.ord.split(",")[0].trim().toLowerCase();

    // Split and trim the English translation (handle comma-separated translations)
    const englishTranslation = r.engelsk.split(",")[0].trim().toLowerCase();

    // Return true if the Croatian and English words are not the same
    return croatianWord !== englishTranslation;
  });

  // If no words match the filters, return a message
  if (filteredResults.length === 0) {
    console.log("No words found matching the selected CEFR and POS filters.");
    return null;
  }

  // Randomly select a result from the filtered results
  const randomResult = pickRandom(filteredResults);
  previousWord = randomResult.ord; // Update the previous word

  return {
    ord: randomResult.ord,
    engelsk: randomResult.engelsk,
    gender: randomResult.gender, // Add gender
    CEFR: randomResult.CEFR, // Make sure CEFR is returned here
    uttale: randomResult.uttale, // Ensure uttale is included here
    eksempel: randomResult.eksempel, // ⬅️ ADD THIS LINE
  };
}

function advanceToNextLevel() {
  if (incorrectWordQueue.length > 0) {
    // Block level advancement if there are still incorrect words
    console.log(
      "The user must review all incorrect words before advancing to the next level."
    );
    return;
  }

  let nextLevel = "";
  if (currentCEFR === "A1") nextLevel = "A2";
  else if (currentCEFR === "A2") nextLevel = "B1";
  else if (currentCEFR === "B1") nextLevel = "B2";
  else if (currentCEFR === "B2") nextLevel = "C";

  // Only advance if we are not already at the next level
  if (currentCEFR !== nextLevel && nextLevel) {
    currentCEFR = nextLevel;
    resetGame(false); // Preserve streak when progressing
    showBanner("congratulations", nextLevel); // Show the banner
    updateCEFRSelection();
  }
}

function fallbackToPreviousLevel() {
  let previousLevel = "";
  if (currentCEFR === "A2") previousLevel = "A1";
  else if (currentCEFR === "B1") previousLevel = "A2";
  else if (currentCEFR === "B2") previousLevel = "B1";
  else if (currentCEFR === "C") previousLevel = "B2";

  // Only change the level if it is actually falling back to a previous level
  if (currentCEFR !== previousLevel && previousLevel) {
    currentCEFR = previousLevel; // Update the current level to the previous one
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
  }
  showBanner("levelLock", levelLocked ? "locked" : "unlocked");
}

function enterRepairMode() {
  if (repairMode) return;
  repairMode = true;
  const btn = document.getElementById("game-next-word-button");
  if (btn) btn.textContent = "Next Review";
  showBanner("enterRepair");
}

function exitRepairMode() {
  if (!repairMode) return;
  repairMode = false;
  const btn = document.getElementById("game-next-word-button");
  if (btn) btn.textContent = "Next Word";
  showBanner("exitRepair");
}

// Check if the user can level up or fall back
function evaluateProgression() {
  if (levelLocked) return;

  if (levelTotalQuestions >= 10) {
    const accuracy = levelCorrectAnswers / levelTotalQuestions;
    const { up, down } = levelThresholds[currentCEFR];
    console.log(`Evaluating: Accuracy is ${Math.round(accuracy * 100)}%`);

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
  // normalize to the last lexical token (ignore "se")
  const tok =
    form
      .toLowerCase()
      .replace(/\bse\b/g, "")
      .trim()
      .split(/\s+/)
      .pop() || form.toLowerCase();

  // VERB endings (present, l-participle slices, infinitive)
  const verbEndings = [
    "amo",
    "emo",
    "imo",
    "ate",
    "ete",
    "ite",
    "aju",
    "ju",
    "am",
    "em",
    "im",
    "aš",
    "eš",
    "iš",
    "a",
    "e",
    "i",
    "u",
    "ao",
    "la",
    "lo",
    "li",
    "le",
    "ti",
    "ći",
  ];

  // NOUN/ADJ endings (common case/number markers)
  const nomAdjEndings = [
    "og",
    "om",
    "oj",
    "im",
    "ima",
    "ama",
    "em",
    "u",
    "a",
    "e",
    "i",
    "o",
  ];

  // pick the longest matching known ending
  const all = [...verbEndings, ...nomAdjEndings].sort(
    (a, b) => b.length - a.length
  );
  const hit = all.find((suf) => tok.endsWith(suf));

  // precise pattern if we found a grammar ending; otherwise fall back to last 2 chars
  return hit
    ? new RegExp(hit + "$", "i")
    : new RegExp((tok.slice(-2) || tok.slice(-1)) + "$", "i");
}

function matchesInflectedForm(base, token, gender) {
  if (!base || !token) return false;

  const lowerBase = base.toLowerCase();
  const lowerToken = token.toLowerCase();

  // --- 1. Exact match ---
  if (lowerToken === lowerBase) return true;

  // --- 2. Skip prefix heuristics for short words (avoid "Ana" → "a") ---
  if (lowerBase.length <= 2) return false;

  // --- 3. Nouns (comprehensive Croatian declension logic) ---
  if (
    gender.startsWith("noun") ||
    gender.startsWith("en") ||
    gender.startsWith("ei") ||
    gender.startsWith("et")
  ) {
    const lemma = lowerBase;
    const token = lowerToken;

    // feminine -a nouns (juha → juhu, žena → ženu, knjiga → knjigu)
    if (lemma.endsWith("a") && gender.startsWith("feminine")) {
      const stem = lemma.slice(0, -1);
      const femEndings = [
        "a", // N sg
        "e", // G sg, N pl
        "i", // D sg, L sg
        "u", // A sg
        "o", // V sg
        "om", // I sg
        "ama", // D/L/I pl
      ];
      if (femEndings.some((e) => token === stem + e)) return true;
    }

    // feminine non-a nouns (noć → noći, stvar → stvarima)
    if (!lemma.endsWith("a") && gender.startsWith("feminine")) {
      const femAltEndings = ["", "i", "ju", "ima", "ima", "i", "ju"];
      if (femAltEndings.some((e) => token === lemma + e)) return true;
    }

    // neuter -o nouns (selo → selu, sela)
    if (lemma.endsWith("o") && gender.startsWith("neuter")) {
      const stem = lemma.slice(0, -1);
      const neutEndings = ["o", "a", "u", "om", "ima", "u", "m"];
      if (neutEndings.some((e) => token === stem + e)) return true;
    }

    // neuter -e nouns (more → mora, moru)
    if (lemma.endsWith("e") && gender.startsWith("neuter")) {
      const stem = lemma.slice(0, -1);
      const neutEndings = ["e", "a", "u", "em", "ima", "u", "m"];
      if (neutEndings.some((e) => token === stem + e)) return true;
    }

    // masculine consonant nouns (stol, student)
    if (gender.startsWith("en") || /[bcčćdđfghjklmnprsštvzž]$/.test(lemma)) {
      const stem = lemma;
      const mascEndings = [
        "", // N sg
        "a", // G sg, A sg animate
        "u", // D/L sg
        "om", // I sg
        "e", // V sg
        "i", // N pl
        "ovi",
        "evi", // N pl variants
        "ima", // D/L/I pl
        "e", // A pl
        "a", // G pl
      ];
      if (mascEndings.some((e) => token === stem + e)) return true;
    }

    // fallback catch-all: if token is same stem + frequent endings
    const genericEndings = [
      "",
      "a",
      "e",
      "i",
      "o",
      "u",
      "om",
      "em",
      "ama",
      "ima",
      "ovi",
      "evi",
      "ju",
    ];
    if (genericEndings.some((e) => token === lemma + e)) return true;
  }

  // --- 4. Adjectives ---
  if (gender.startsWith("adjective")) {
    const adjStem = lowerBase.replace(/(an|en|on|in|ar|er|or)$/, "");
    const adjEndings = [
      "",
      "i",
      "a",
      "o",
      "e",
      "og",
      "om",
      "u",
      "oj",
      "ima",
      "ri",
      "ra",
      "ro",
      "rog",
      "rom",
      "ru",
    ];
    if (adjEndings.some((ending) => lowerToken === adjStem + ending))
      return true;
  }

  // --- 5. Verbs (comprehensive) ---
  if (gender.startsWith("verb")) {
    const verbEndings = [
      "ti",
      "ći",
      "m",
      "š",
      "",
      "mo",
      "te",
      "ju",
      "e",
      "la",
      "li",
      "lo",
      "le",
      "o",
      "ao",
      "ala",
      "ali",
      "ale",
    ];

    // --- 5a. Handle -jeti verbs (voljeti, željeti, vidjeti) comprehensively ---
    if (/jeti$/.test(lowerBase)) {
      const jetiStem = lowerBase.replace(/jeti$/, "");

      // Two common stems: volj- / volj → volj + endings (used for voljeti: voliš, vole)
      // and vowel-shifted stem: volj → vol(i) (used for volim)
      const altStems = [
        jetiStem.endsWith("je") ? jetiStem.slice(0, -2) + "i" : jetiStem + "i", // vowel change stem
        jetiStem.replace(/je$/, ""), // plain je-drop stem
        jetiStem, // raw stem
      ];

      // Extended verb endings: present, infinitive, participles
      const jetiEndings = [
        "m",
        "š",
        "",
        "mo",
        "te",
        "ju", // present
        "o",
        "la",
        "li",
        "le",
        "lo", // past
        "ti",
        "ći", // infinitive variants
      ];

      if (
        altStems.some((stem) =>
          jetiEndings.some((end) => lowerToken === stem + end)
        )
      )
        return true;
    }
    // --- 5b. Base and simple stem ---
    const baseStem = lowerBase.replace(/(ti|ći)$/, "");
    if (verbEndings.some((ending) => lowerToken === baseStem + ending))
      return true;

    // --- 5c. Handle je → ije alternation (razumjeti → razumijem) ---
    const altStem1 = baseStem.replace(/je$/, "ije");
    if (verbEndings.some((ending) => lowerToken === altStem1 + ending))
      return true;

    // --- 5d. Handle -ovati / -evati verbs (putovati → putujem, kupovati → kupujem) ---
    if (/(ovati|evati)$/.test(lowerBase)) {
      const ovStem = lowerBase.replace(/(ovati|evati)$/, "uj");
      const ovEndings = [
        "em",
        "eš",
        "e",
        "emo",
        "ete",
        "u",
        "o",
        "la",
        "li",
        "le",
        "lo",
      ];
      if (ovEndings.some((e) => lowerToken === ovStem + e)) return true;
    }

    // --- 5d. Handle stem alternations for broad verb families ---
    // Covers zvati→zovem, brijati→brijem, bojati→bojim, sjesti→sjednem, etc.

    const altVerbPatterns = [
      // zvati-type (a → o shift)
      {
        regex: /^(.*)vati$/,
        replacements: ["$1ov"],
        endings: [
          "em",
          "eš",
          "e",
          "emo",
          "ete",
          "u",
          "o",
          "la",
          "li",
          "le",
          "lo",
        ],
      },

      // -jati verbs that insert j before endings (brijati → brijem)
      {
        regex: /^(.*)jati$/,
        replacements: ["$1j"],
        endings: [
          "em",
          "eš",
          "e",
          "emo",
          "ete",
          "u",
          "o",
          "la",
          "li",
          "le",
          "lo",
        ],
      },

      // -jati verbs that shift to -jim pattern (bojati → bojim)
      {
        regex: /^(.*)jati$/,
        replacements: ["$1"],
        endings: [
          "im",
          "iš",
          "i",
          "imo",
          "ite",
          "e",
          "io",
          "ila",
          "ili",
          "ile",
          "ilo",
        ],
      },

      // sjesti, leći, ležati, etc. (insert je/jeđ)
      {
        regex: /^(.*)sti$/,
        replacements: ["$1jed", "$1jeđ"],
        endings: [
          "nem",
          "neš",
          "ne",
          "nemo",
          "nete",
          "nu",
          "o",
          "la",
          "li",
          "le",
          "lo",
        ],
      },
    ];

    for (const pattern of altVerbPatterns) {
      const match = lowerBase.match(pattern.regex);
      if (match) {
        const stemBase = match[1];
        for (const repl of pattern.replacements) {
          const altStem = repl.replace(/\$1/g, stemBase);
          if (pattern.endings.some((e) => lowerToken === altStem + e))
            return true;
        }
      }
    }

    // --- 5e. Handle irregular frequent verbs ---
    const irregularMap = {
      biti: [
        "sam",
        "si",
        "je",
        "smo",
        "ste",
        "su",
        "bio",
        "bila",
        "bilo",
        "bili",
        "bile",
      ],
      imati: [
        "imam",
        "imaš",
        "ima",
        "imamo",
        "imate",
        "imaju",
        "imao",
        "imala",
      ],
      moći: ["mogu", "možeš", "može", "možemo", "možete", "mogu"],
      htjeti: [
        "hoću",
        "hoćeš",
        "hoće",
        "hoćemo",
        "hoćete",
        "će",
        "ću",
        "ćeš",
        "će",
        "ćemo",
        "ćete",
      ],
      ići: ["idem", "ideš", "ide", "idemo", "idete", "idu", "išao", "išla"],
      reći: ["rekao", "rekla", "rekli", "rečeš", "kaže", "kažem"],
    };
    if (irregularMap[lowerBase] && irregularMap[lowerBase].includes(lowerToken))
      return true;

    // --- 5e-bis. Handle -sati / -zati / -tati verbs (pisati→piše, plesati→pleše, gaziti→gazi etc.) ---
    if (/(sati|zati|tati)$/.test(lowerBase)) {
      // drop the final 'ati' and add 'še' or 'ze' depending on the stem
      const sStem = lowerBase.replace(/sati$/, "š");
      const zStem = lowerBase.replace(/zati$/, "ž");
      const tStem = lowerBase.replace(/tati$/, "t");
      const presentEndings = ["em", "eš", "e", "emo", "ete", "u"];

      if (
        presentEndings.some(
          (e) =>
            lowerToken === sStem + e ||
            lowerToken === zStem + e ||
            lowerToken === tStem + e
        )
      )
        return true;
    }

    // --- 5f. Fallback heuristic ---
    if (lowerToken.startsWith(baseStem.slice(0, -1))) return true;
  }

  // --- 6. Expressions (including "se" verbs) ---
  if (gender.startsWith("expression")) {
    if (lowerBase.endsWith(" se")) {
      const verbBase = lowerBase.replace(/\s+se$/, "");
      if (token === "se") return true;
      if (matchesInflectedForm(verbBase, token, "verb")) return true;
    }
    return lowerToken === lowerBase;
  }

  return false;
}

function applyInflection(base, gender, targetTokenInSentence) {
  if (!base) return base;

  let lemma = base.toLowerCase().trim();
  const token = targetTokenInSentence?.toLowerCase?.() || null;

  // -------------------- helpers --------------------
  const endsWithCons = (s) => /[bcčćdđfghjklmnprsštvzž]$/.test(s);
  const strip = (s, re) => s.replace(re, "");
  const pick = (arr, i) => (i >= 0 && i < arr.length ? arr[i] : arr[0]);

  // Detect features from a seen token (very approximate but systematic)
  function guessVerbFeatures(tok) {
    if (!tok) return null;
    // present persons
    if (/(amo|emo|imo)$/.test(tok))
      return { tense: "pres", person: 1, number: "pl" };
    if (/(ate|ete|ite)$/.test(tok))
      return { tense: "pres", person: 2, number: "pl" };
    if (/(aju|ju|u)$/.test(tok))
      return { tense: "pres", person: 3, number: "pl" };
    if (/(am|em|im)$/.test(tok))
      return { tense: "pres", person: 1, number: "sg" };
    if (/(aš|eš|iš)$/.test(tok))
      return { tense: "pres", person: 2, number: "sg" };
    if (/(a|e|i)$/.test(tok)) return { tense: "pres", person: 3, number: "sg" };
    // l-participle (past)
    if (/(ao|o)$/.test(tok))
      return { tense: "past_l", gender: "m", number: "sg" };
    if (/la$/.test(tok)) return { tense: "past_l", gender: "f", number: "sg" };
    if (/lo$/.test(tok)) return { tense: "past_l", gender: "n", number: "sg" };
    if (/li$/.test(tok)) return { tense: "past_l", gender: "m", number: "pl" };
    if (/le$/.test(tok)) return { tense: "past_l", gender: "f", number: "pl" };
    // bare infinitive
    if (/(ti|ći)$/.test(tok)) return { tense: "inf" };
    return null;
  }
  function guessNounFeatures(tok) {
    if (!tok) return null;
    // frequent sg endings
    if (/^.+a$/.test(tok))
      return { number: "sg", kase: "acc_or_gen_or_nom_fem" }; // fem-a ambiguous
    if (/^.+u$/.test(tok))
      return { number: "sg", kase: "dat_loc_acc_fem_or_masc" };
    if (/^.+om$/.test(tok)) return { number: "sg", kase: "inst_masc_neut" };
    if (/^.+em$/.test(tok))
      return { number: "sg", kase: "inst_neut_alt_or_dat" };
    if (/^.+i$/.test(tok))
      return { number: "sg", kase: "dat_loc_fem_or_nom_pl_masc" };
    if (/^.+e$/.test(tok))
      return { number: "sg", kase: "voc_sg_masc_or_nom_pl_fem" };
    // frequent pl endings
    if (/^.+i$/.test(tok)) return { number: "pl", kase: "nom_pl_masc" };
    if (/^.+e$/.test(tok)) return { number: "pl", kase: "nom_acc_pl_fem_neut" };
    if (/^.+a$/.test(tok)) return { number: "pl", kase: "gen_pl_masc_neut" };
    if (/^.+ima$/.test(tok))
      return { number: "pl", kase: "dat_loc_inst_pl_all" };
    if (/^.+ama$/.test(tok))
      return { number: "pl", kase: "dat_loc_inst_pl_fem_a" };
    return null;
  }
  function guessAdjFeatures(tok) {
    if (!tok) return null;
    // hard adj patterns (short)
    if (/i$/.test(tok)) return { gender: "m", kase: "nom", number: "sg" };
    if (/a$/.test(tok)) return { gender: "f", kase: "nom", number: "sg" };
    if (/o$/.test(tok)) return { gender: "n", kase: "nom", number: "sg" };
    if (/e$/.test(tok))
      return { gender: "f", kase: "acc_or_nom_pl", number: "sg" };
    if (/og$/.test(tok)) return { gender: "m", kase: "gen", number: "sg" };
    if (/om$/.test(tok))
      return { gender: "m", kase: "dat_loc_inst", number: "sg" };
    if (/oj$/.test(tok)) return { gender: "f", kase: "dat_loc", number: "sg" };
    if (/ima$/.test(tok))
      return { gender: "x", kase: "dat_loc_inst", number: "pl" };
    if (/i$/.test(tok)) return { gender: "x", kase: "nom", number: "pl" };
    return null;
  }

  // -------------------- reflexives --------------------
  if (lemma.endsWith(" se")) {
    const v = lemma.replace(/\s+se$/, "");
    const features = guessVerbFeatures(token);
    const inf = inflectVerb(v, features);
    const seFirst = token && /^se\b/.test(token);
    return seFirst ? `se ${inf}` : `${inf} se`;
  }

  // ====================================================
  // ================ VERB INFLECTION ===================
  // ====================================================
  function classifyVerb(lem) {
    if (/irati$/.test(lem)) return { cls: "IRATI", stem: lem.slice(0, -5) };
    if (/ovati$/.test(lem)) return { cls: "OVATI", stem: lem.slice(0, -5) };
    if (/evati$/.test(lem)) return { cls: "EVATI", stem: lem.slice(0, -5) };
    if (/sati$/.test(lem)) return { cls: "SATI", stem: lem.slice(0, -4) };
    if (/zati$/.test(lem)) return { cls: "ZATI", stem: lem.slice(0, -4) };
    if (/tati$/.test(lem)) return { cls: "TATI", stem: lem.slice(0, -4) };
    if (/jeti$/.test(lem)) return { cls: "JETI", stem: lem.slice(0, -4) }; // voljeti/vidjeti buckets handled later
    if (/eti$/.test(lem)) return { cls: "ETI", stem: lem.slice(0, -3) };
    if (/iti$/.test(lem)) return { cls: "ITI", stem: lem.slice(0, -3) };
    if (/ati$/.test(lem)) return { cls: "ATI", stem: lem.slice(0, -3) };
    if (/ći$/.test(lem)) return { cls: "CI", stem: lem.slice(0, -2) };
    return { cls: "OTHER", stem: lem.replace(/(ti|ći)$/, "") };
  }

  function buildPresent(lem) {
    const irregularPresent = {
      biti: ["sam", "si", "je", "smo", "ste", "su"],
      imati: ["imam", "imaš", "ima", "imamo", "imate", "imaju"],
      moći: ["mogu", "možeš", "može", "možemo", "možete", "mogu"],
      htjeti: ["hoću", "hoćeš", "hoće", "hoćemo", "hoćete", "hoće"],
      ići: ["idem", "ideš", "ide", "idemo", "idete", "idu"],
      reći: ["kažem", "kažeš", "kaže", "kažemo", "kažete", "kažu"],
      doći: ["dođem", "dođeš", "dođe", "dođemo", "dođete", "dođu"],
      poći: ["pođem", "pođeš", "pođe", "pođemo", "pođete", "pođu"],
      ući: ["uđem", "uđeš", "uđe", "uđemo", "uđete", "uđu"],
      vidjeti: ["vidim", "vidiš", "vidi", "vidimo", "vidite", "vide"],
      željeti: ["želim", "želiš", "želi", "želimo", "želite", "žele"],
      voljeti: ["volim", "voliš", "voli", "volimo", "volite", "vole"],
      razumjeti: [
        "razumijem",
        "razumiješ",
        "razumije",
        "razumijemo",
        "razumijete",
        "razumiju",
      ],
      jesti: ["jedem", "jedeš", "jede", "jedemo", "jedete", "jedu"],
      piti: ["pijem", "piješ", "pije", "pijemo", "pijete", "piju"],
      znati: ["znam", "znaš", "zna", "znamo", "znate", "znaju"],
      dati: ["dam", "daš", "da", "damo", "date", "daju"],
      sjesti: [
        "sjednem",
        "sjedneš",
        "sjedne",
        "sjednemo",
        "sjednete",
        "sjednu",
      ],
      leći: ["legnem", "legneš", "legne", "legnemo", "legnete", "legnu"],
      peći: ["pečem", "pečeš", "peče", "pečemo", "pečete", "peku"],
      pisati: ["pišem", "pišeš", "piše", "pišemo", "pišete", "pišu"],
    };

    // Return all 6 present forms (for internal feature mapping)
    if (irregularPresent[lem]) return irregularPresent[lem].slice();

    const { cls, stem } = classifyVerb(lem);

    // IRATI: organizirati → organiziram
    if (cls === "IRATI")
      return [
        stem + "iram",
        stem + "iraš",
        stem + "ira",
        stem + "iramo",
        stem + "irate",
        stem + "iraju",
      ];

    // OVATI/EVATI: putovati/kupovati → putujem/kupujem
    if (cls === "OVATI" || cls === "EVATI") {
      const s = stem + "uj";
      return [s + "em", s + "eš", s + "e", s + "emo", s + "ete", s + "u"];
    }

    // SATI/ZATI/TATI: plesati→plešem, gaziti/zazati mix→gažem; tati→ćem (approx)
    if (cls === "SATI") {
      const s = stem.slice(0, -1) + "š"; // drop s + š
      return [s + "em", s + "eš", s + "e", s + "emo", s + "ete", s + "u"];
    }
    if (cls === "ZATI") {
      const s = stem.slice(0, -1) + "ž";
      return [s + "em", s + "eš", s + "e", s + "emo", s + "ete", s + "u"];
    }
    if (cls === "TATI") {
      const s = stem + "ć"; // rough
      return [s + "em", s + "eš", s + "e", s + "emo", s + "ete", s + "u"];
    }

    // JETI family: split into voljeti/željeti/razumjeti type vs vidjeti type
    if (cls === "JETI") {
      if (/(volj|želj|razumj)/.test(stem)) {
        const s = stem.replace(/je?$/, "ij");
        return [s + "em", s + "eš", s + "e", s + "emo", s + "ete", s + "u"];
      } else {
        // vidjeti → vidim pattern
        const s = stem.replace(/je?$/, "i");
        return [s + "m", s + "š", s + "", s + "mo", s + "te", s + "e"];
      }
    }

    // ETI: generalize to -em paradigm
    if (cls === "ETI") {
      return [
        stem + "em",
        stem + "eš",
        stem + "e",
        stem + "emo",
        stem + "ete",
        stem + "u",
      ];
    }

    // ITI: -im paradigm
    if (cls === "ITI") {
      return [
        stem + "im",
        stem + "iš",
        stem + "i",
        stem + "imo",
        stem + "ite",
        stem + "e",
      ];
    }

    // ATI: default -am
    if (cls === "ATI") {
      return [
        stem + "am",
        stem + "aš",
        stem + "a",
        stem + "amo",
        stem + "ate",
        stem + "ju",
      ];
    }

    // CI: approximate as -đem set
    if (cls === "CI") {
      const s = stem + "đ";
      return [s + "em", s + "eš", s + "e", s + "emo", s + "ete", s + "u"];
    }

    // OTHER: fall back to -em
    return [
      stem + "em",
      stem + "eš",
      stem + "e",
      stem + "emo",
      stem + "ete",
      stem + "u",
    ];
  }

  function buildLParticiple(lem, g = "m", n = "sg") {
    // approximate past "l" participle from infinitive
    const baseStem = lem.replace(/(ti|ći)$/, "");
    // -ati: -ao/-la/-lo/-li/-le
    if (/ati$/.test(lem))
      return g === "m"
        ? n === "sg"
          ? baseStem + "ao"
          : baseStem + "ali"
        : g === "f"
        ? n === "sg"
          ? baseStem + "la"
          : baseStem + "le"
        : n === "sg"
        ? baseStem + "lo"
        : baseStem + "la"; // neuter pl rare; map to f-pl
    // -jeti: vidjeti→vidio; voljeti→volio
    if (/jeti$/.test(lem)) {
      const s = baseStem + "o";
      return g === "m"
        ? n === "sg"
          ? s
          : baseStem + "li"
        : g === "f"
        ? n === "sg"
          ? baseStem + "la"
          : baseStem + "le"
        : n === "sg"
        ? baseStem + "lo"
        : baseStem + "la";
    }
    // -iti/-eti/-ći/-ovati/-evati/-irati: default -o / -la / -lo / -li / -le
    const m = n === "sg" ? baseStem + "o" : baseStem + "li";
    const f = n === "sg" ? baseStem + "la" : baseStem + "le";
    const neut = n === "sg" ? baseStem + "lo" : baseStem + "la";
    return g === "m" ? m : g === "f" ? f : neut;
  }

  function inflectVerb(lem, feat) {
    const present = buildPresent(lem);
    if (feat && feat.tense === "pres") {
      const idx = feat.person - 1 + (feat.number === "pl" ? 3 : 0);
      return pick(present, idx);
    }
    if (feat && feat.tense === "past_l") {
      return buildLParticiple(lem, feat.gender || "m", feat.number || "sg");
    }
    if (feat && feat.tense === "inf") return lem;
    // default: 1sg present
    return present[0];
  }

  // ====================================================
  // =============== NOUN DECLENSION ====================
  // ====================================================
  function nounForms(lem, g) {
    // returns a small paradigm slice: sg {nom,gen,dat/loc,acc,inst,voc} + pl {nom,gen,dat/loc/inst,acc}
    const forms = { sg: {}, pl: {} };
    if (g.startsWith("feminine") && lem.endsWith("a")) {
      const s = lem.slice(0, -1);
      forms.sg.nom = lem; // žena
      forms.sg.gen = s + "e"; // žene
      forms.sg.dat = s + "i"; // ženi
      forms.sg.acc = s + "u"; // ženu
      forms.sg.inst = s + "om"; // ženom
      forms.sg.loc = s + "i"; // ženi
      forms.sg.voc = s + "o"; // ženo
      forms.pl.nom = s + "e"; // žene
      forms.pl.acc = s + "e";
      forms.pl.gen = s + "a"; // žena (gen pl)
      forms.pl.dat = s + "ama"; // ženama
      forms.pl.loc = s + "ama";
      forms.pl.inst = s + "ama";
      return forms;
    }
    if (g.startsWith("feminine")) {
      // soft fem: noć/stvar
      forms.sg.nom = lem;
      forms.sg.gen = lem + "i";
      forms.sg.dat = lem + "i";
      forms.sg.acc = lem;
      forms.sg.inst = lem + "ju";
      forms.sg.loc = lem + "i";
      forms.sg.voc = lem + "i";
      forms.pl.nom = lem + "i";
      forms.pl.acc = lem + "i";
      forms.pl.gen = lem + "i"; // varies; placeholder
      forms.pl.dat = lem + "ima";
      forms.pl.loc = lem + "ima";
      forms.pl.inst = lem + "ima";
      return forms;
    }
    if (g.startsWith("en")) {
      // consonant-ending default, animate/inanimate ambiguity: use -a gen, acc=gen for animate is not inferable here
      forms.sg.nom = lem; // stol
      forms.sg.gen = lem + "a"; // stola
      forms.sg.dat = lem + "u"; // stolu
      forms.sg.acc = lem; // inanimate default
      forms.sg.inst = lem + "om"; // stolom
      forms.sg.loc = lem + "u"; // stolu
      forms.sg.voc = lem + "e"; // stole (approx)
      // pl
      const npl = endsWithCons(lem)
        ? [lem + "ovi", lem + "evi", lem + "i"]
        : [lem + "i"];
      forms.pl.nom = npl[0];
      forms.pl.acc = npl[0];
      forms.pl.gen = lem + "a";
      forms.pl.dat = lem + "ima";
      forms.pl.loc = lem + "ima";
      forms.pl.inst = lem + "ima";
      return forms;
    }
    if (g.startsWith("neuter")) {
      if (/(o|e)$/.test(lem)) {
        const s = lem.slice(0, -1);
        forms.sg.nom = lem; // selo/more
        forms.sg.gen = s + "a"; // sela/mora
        forms.sg.dat = s + "u"; // selu/moru
        forms.sg.acc = lem; // =
        forms.sg.inst = s + (lem.endsWith("o") ? "m" : "m"); // selom/morem
        forms.sg.loc = s + "u";
        forms.sg.voc = lem;
        forms.pl.nom = s + "a"; // sela/mora
        forms.pl.acc = s + "a";
        forms.pl.gen = s + "a"; // variable; approximation
        forms.pl.dat = s + "ima";
        forms.pl.loc = s + "ima";
        forms.pl.inst = s + "ima";
        return forms;
      }
    }
    // fallback neutral
    forms.sg.nom = lem;
    forms.sg.acc = lem;
    forms.pl.nom = lem;
    forms.pl.acc = lem;
    return forms;
  }

  // ====================================================
  // ============== ADJECTIVE ENDINGS ===================
  // ====================================================
  function adjForms(lem) {
    // Hard adjective pattern (velik)
    // Return minimal but comprehensive grid for agreement
    const stem = lem.replace(/(an|en|on)$/, "").replace(/(ik|ak|ek|ok)$/, "");
    function hardAdjBase() {
      // if it already ends with -an/-en/-on, keep it
      if (/(an|en|on)$/.test(lem)) return lem.slice(0, -1); // → -a~-e~-o handled via endings
      if (/(ski|ni|ji)$/.test(lem)) return lem; // invariant-ish stems
      if (/(ik|ak|ek|ok)$/.test(lem)) return lem; // velik
      return lem; // fallback
    }
    const b = hardAdjBase();
    const out = { sg: { m: {}, f: {}, n: {} }, pl: { m: {}, f: {}, n: {} } };

    // nominatives
    out.sg.m.nom = /(ik|ak|ek|ok|an|en|on|ski|ni|ji)$/.test(b)
      ? b.replace(/n?$/, "i")
      : b + "i";
    out.sg.f.nom = b.replace(/i?$/, "a");
    out.sg.n.nom = b.replace(/i?$/, "o");

    // accusatives (animacy ignored; keep mnemonic)
    out.sg.m.acc = out.sg.m.nom;
    out.sg.f.acc = out.sg.f.nom.replace(/a$/, "u");
    out.sg.n.acc = out.sg.n.nom;

    // genitives
    out.sg.m.gen = b + "og";
    out.sg.f.gen = b + "e";
    out.sg.n.gen = b + "og";

    // dat/loc
    out.sg.m.dat = b + "om";
    out.sg.f.dat = b + "oj";
    out.sg.n.dat = b + "om";
    out.sg.m.loc = out.sg.m.dat;
    out.sg.f.loc = out.sg.f.dat;
    out.sg.n.loc = out.sg.n.dat;

    // instrumental
    out.sg.m.inst = b + "im";
    out.sg.f.inst = b + "om";
    out.sg.n.inst = b + "im";

    // plural (common)
    out.pl.m.nom = b + "i";
    out.pl.f.nom = b + "e";
    out.pl.n.nom = b + "a";
    out.pl.m.acc = out.pl.m.nom;
    out.pl.f.acc = out.pl.f.nom;
    out.pl.n.acc = out.pl.n.nom;
    out.pl.m.gen = b + "ih";
    out.pl.f.gen = b + "ih";
    out.pl.n.gen = b + "ih";
    out.pl.m.dat = b + "im";
    out.pl.f.dat = b + "im";
    out.pl.n.dat = b + "im";
    out.pl.m.loc = out.pl.m.dat;
    out.pl.f.loc = out.pl.f.dat;
    out.pl.n.loc = out.pl.n.dat;
    out.pl.m.inst = b + "im";
    out.pl.f.inst = b + "im";
    out.pl.n.inst = b + "im";

    return out;
  }

  // ====================================================
  // =============== MAIN DISPATCH ======================
  // ====================================================

  if (gender.startsWith("verb")) {
    const feat = guessVerbFeatures(token) || {
      tense: "pres",
      person: 1,
      number: "sg",
    };
    return inflectVerb(lemma, feat);
  }

  if (
    gender.startsWith("noun") ||
    gender.startsWith("en") ||
    gender.startsWith("ei") ||
    gender.startsWith("et")
  ) {
    const grid = nounForms(lemma, gender);
    // choose by guessed case/number if token present
    if (token) {
      const nf = guessNounFeatures(token);
      if (nf) {
        // map guessed bucket to an actual slot
        if (nf.number === "sg") {
          if (nf.kase === "acc_or_gen_or_nom_fem")
            return grid.sg.acc || grid.sg.gen || grid.sg.nom;
          if (nf.kase === "dat_loc_acc_fem_or_masc")
            return grid.sg.dat || grid.sg.loc || grid.sg.acc || lemma;
          if (nf.kase === "inst_masc_neut") return grid.sg.inst || lemma;
          if (nf.kase === "inst_neut_alt_or_dat")
            return grid.sg.inst || grid.sg.dat || lemma;
          if (nf.kase === "dat_loc_fem_or_nom_pl_masc")
            return grid.sg.dat || grid.sg.loc || grid.pl.nom || lemma;
          if (nf.kase === "voc_sg_masc_or_nom_pl_fem")
            return grid.sg.voc || grid.pl.nom || lemma;
        } else if (nf.number === "pl") {
          if (nf.kase === "nom_pl_masc") return grid.pl.nom || lemma;
          if (nf.kase === "nom_acc_pl_fem_neut")
            return grid.pl.acc || grid.pl.nom || lemma;
          if (nf.kase === "gen_pl_masc_neut") return grid.pl.gen || lemma;
          if (
            nf.kase === "dat_loc_inst_pl_all" ||
            nf.kase === "dat_loc_inst_pl_fem_a"
          )
            return grid.pl.dat || grid.pl.loc || grid.pl.inst || lemma;
        }
      }
    }
    // defaults by gender
    if (gender.startsWith("ei") && lemma.endsWith("a")) return grid.sg.acc;
    if (gender.startsWith("en")) return grid.sg.gen;
    if (gender.startsWith("et")) return grid.sg.nom;
    return grid.sg.nom || lemma;
  }

  if (gender.startsWith("adjective")) {
    const grid = adjForms(lemma);
    const af = token ? guessAdjFeatures(token) : null;
    if (af) {
      if (af.number === "sg") {
        if (af.kase === "nom") return grid.sg[af.gender || "m"].nom;
        if (af.kase === "gen")
          return af.gender === "m" || af.gender === "n"
            ? grid.sg.m.gen
            : grid.sg.f.gen;
        if (af.kase === "dat_loc")
          return af.gender === "m" || af.gender === "n"
            ? grid.sg.m.dat
            : grid.sg.f.dat;
        if (af.kase === "dat_loc_inst") return grid.sg.m.dat; // approx
        if (af.kase === "acc_or_nom_pl") return grid.sg.f.nom; // fallback
      } else {
        if (af.kase === "nom") return grid.pl.m.nom; // generic pl-nom
        if (af.kase === "dat_loc_inst") return grid.pl.m.dat;
      }
    }
    // default: nom sg masc
    return grid.sg.m.nom;
  }

  if (gender.startsWith("expression")) {
    // expressions without "se": keep as-is unless token suggests a verb core
    return lemma;
  }

  return lemma;
}

function generateClozeDistractors(baseWord, clozedForm, CEFR, gender) {
  const formattedClozed = clozedForm.toLowerCase();
  const formattedBase = baseWord.toLowerCase();
  const isUninflected = clozedForm.trim() === baseWord.trim(); // key fix

  // --- derive a dynamic ending pattern from the actual clozed form ---
  const dynamicEnding = formattedClozed.match(/([a-zćčđšž]{1,4})$/i);
  const dynamicEndingPattern = dynamicEnding
    ? new RegExp(dynamicEnding[1] + "$", "i")
    : null;

  // fallback to your existing general heuristic
  const endingPattern =
    dynamicEndingPattern || getEndingPattern(formattedClozed);

  const bannedWordClasses = ["numeral", "pronoun", "possessive", "determiner"];
  let strictDistractors = [];
  const pos = (gender || "").toLowerCase();
  const baseCandidates = results.filter((r) => {
    const g = (r.gender || "").toLowerCase();
    if (!g.startsWith(pos)) return false;
    if (noRandom.includes(r.ord.toLowerCase())) return false; // ← add this
    let ord = r.ord.split(",")[0].trim().toLowerCase();
    if (r.gender.startsWith("expression") && r.ord.includes(" ")) {
      ord = r.ord.trim().toLowerCase();
    }
    if (!ord || ord === formattedBase) return false;
    if (ord.includes(" ") && !gender.startsWith("expression")) return false;
    if (ord.length > 12) return false;
    if (
      r.gender &&
      !r.gender.toLowerCase().startsWith(gender.slice(0, 2).toLowerCase())
    )
      return false;
    if (bannedWordClasses.some((b) => r.gender?.toLowerCase().startsWith(b)))
      return false;
    return true;
  });

  const inflected = baseCandidates
    .map((r) => {
      const raw = r.ord.split(",")[0].trim().toLowerCase();
      let inflectedForm = isUninflected
        ? raw
        : applyInflection(raw, gender, formattedClozed);

      return inflectedForm;
    })
    .filter(
      (w) =>
        w !== formattedClozed &&
        /^[a-zA-ZæøåÆØÅ]/.test(w) &&
        (isUninflected || endingPattern.test(w))
    );

  strictDistractors = shuffleArray(inflected).slice(0, 3);

  if (strictDistractors.length < 3) {
    const relaxed = results
      .filter((r) => {
        const raw = r.ord.split(",")[0].trim().toLowerCase();
        return (
          raw !== formattedBase &&
          r.gender === gender &&
          !bannedWordClasses.some((b) => r.gender?.toLowerCase().startsWith(b))
        );
      })
      .map((r) => {
        const raw = r.ord.split(",")[0].trim().toLowerCase();
        let inflectedForm = isUninflected
          ? raw
          : applyInflection(raw, gender, formattedClozed);

        return inflectedForm;
      })
      .filter(
        (w) =>
          w !== formattedClozed &&
          /^[a-zA-ZæøåÆØÅ]/.test(w) &&
          (isUninflected || endingPattern.test(w))
      );

    strictDistractors = strictDistractors
      .concat(shuffleArray(relaxed))
      .slice(0, 3);
  }

  // --- Final fallback: use real existing lemmas only, no fabricated strings ---
  if (strictDistractors.length < 3) {
    const extra = results
      .filter((r) => r.gender?.toLowerCase().startsWith(gender.toLowerCase())) // ← add this
      .map((r) => r.ord.split(",")[0].trim().toLowerCase())
      .filter(
        (w) =>
          w &&
          w !== formattedBase &&
          w !== formattedClozed &&
          /^[\p{L}-]+$/u.test(w) &&
          !w.includes(" ") &&
          !bannedWordClasses.some((b) =>
            (gender || "").toLowerCase().startsWith(b)
          )
      );

    strictDistractors = strictDistractors
      .concat(shuffleArray(extra))
      .slice(0, 3);
  }

  // --- Special handling for reflexive expressions ending in " se" ---
  if (gender.startsWith("expression") && baseWord.endsWith(" se")) {
    const reference = (
      typeof correctTranslation === "string"
        ? correctTranslation
        : formattedClozed
    )
      .toLowerCase()
      .trim();
    const isPrefixSe = reference.startsWith("se ");

    // 1️⃣ Pull distractors ONLY from other expressions ending in " se"
    let reflexivePool = results
      .filter(
        (r) =>
          r.gender?.toLowerCase().startsWith("expression") &&
          r.ord.toLowerCase() !== baseWord &&
          r.ord.toLowerCase().endsWith(" se") &&
          r.CEFR === CEFR
      )
      .map((r) => r.ord.trim().toLowerCase());

    // 2️⃣ If not enough, pad with any other "expression" from same CEFR
    if (reflexivePool.length < 3) {
      const fallbackPool = results
        .filter(
          (r) =>
            r.gender?.toLowerCase().startsWith("expression") &&
            r.ord.toLowerCase() !== baseWord &&
            r.CEFR === CEFR
        )
        .map((r) => r.ord.trim().toLowerCase());
      reflexivePool = reflexivePool.concat(fallbackPool);
    }

    // 3️⃣ Randomize and take 3 unique distractors
    strictDistractors = shuffleArray(reflexivePool)
      .filter((d) => d !== formattedClozed)
      .slice(0, 3);

    // 4️⃣ Align "se" position (prefix vs suffix)
    strictDistractors = strictDistractors.map((d) => {
      const clean = d.replace(/\bse\b/g, "").trim();
      const reflexiveForm = isPrefixSe ? `se ${clean}` : `${clean} se`;
      return reflexiveForm.trim();
    });
  }

  return strictDistractors;
}

function updateCEFRSelection() {
  const cefrSelect = document.getElementById("cefr-select");
  // Update the actual selected value in the dropdown to reflect the current CEFR level
  cefrSelect.value = currentCEFR;
}

function resetGame(resetStreak = true) {
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
    currentCEFR = selectedCEFR; // Set the current CEFR level to the new one
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
