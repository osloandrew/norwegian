let activeAudio = [];
let currentWord;
let correctTranslation;
// Identifies which scheduler queue supplied the current question. Correct
// filler/early-review answers do not lengthen an interval, while due, new,
// and deliberate relearning answers do.
let currentWordQueueType = null;
let correctLevelAnswers = 0; // Track correct answers per level
let correctCount = 0; // Tracks the total number of correct answers
let correctStreak = 0; // Track the current streak of correct answers
// CEFR labels remain purely descriptive metadata on individual words/stories
// (see CEFR_DIFFICULTY_ANCHOR below) — the learner's own ability is a
// continuous, invisible estimate, not an ordinal "level" to climb or fall
// from. CEFR_LEVEL_ORDER is kept only as the canonical band ordering used to
// build that anchor table and to interpolate difficulty-scaled constants.
const CEFR_LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C"];
// Word classes excluded from cloze/distractor generation — too grammatically
// constrained (e.g. a numeral rarely substitutes for another numeral in
// context) to make plausible-but-wrong answer choices.
const BANNED_WORD_CLASSES = ["numeral", "pronoun", "possessive", "determiner"];

const ABILITY_STORAGE_KEY = "norwegian-dictionary-ability-v1";
const LEGACY_GAME_LEVEL_STORAGE_KEY = "norwegian-dictionary-game-level-v1";
const ABILITY_MIN = 0;
const ABILITY_MAX = 1000;
// Evenly spaced anchors give every CEFR-tagged word and story a numeric
// difficulty for proximity-based selection. This is a v1 simplification —
// it doesn't account for the corpus being much denser in B2/C than A1/A2 —
// but the wide proximity sigma used everywhere below means adjacent bands
// overlap generously, so sparse bands still draw from their neighbors
// rather than starving.
const CEFR_DIFFICULTY_ANCHOR = Object.freeze({
  A1: 100,
  A2: 300,
  B1: 500,
  B2: 700,
  C: 900,
});
// How quickly ability-based selection weight falls off with distance from
// the learner's estimated ability. ~140 means a word one full CEFR band
// away still gets meaningful practice share; two bands away is effectively
// excluded without a hard cliff.
const ABILITY_PROXIMITY_SIGMA = 140;
// How far a single answer nudges the ability estimate. Small on purpose —
// this replaces the old batch rise/fall thresholds with a smooth,
// per-answer drift instead of a discrete "level up" event.
const ABILITY_K_FACTOR = 24;
// Spread of the logistic curve used to predict success probability from
// (word difficulty − ability). Larger = gentler, more forgiving curve.
const ABILITY_LOGISTIC_SCALE = 220;

function clampAbility(value) {
  return Math.min(ABILITY_MAX, Math.max(ABILITY_MIN, value));
}

let abilityState = loadAbilityState();
let abilityScore = abilityState.score; // null until placement is completed
let placementCompleted = abilityState.placementCompleted;
let gameActive = false;

// A "round" is the intro-screen-driven session wrapper around the game:
// either a bounded number of words to learn, or an infinite drill. This is
// distinct from CEFR level progression above, which continues to work
// exactly as before within whichever round is active.
const WORD_GAME_SESSION_WORD_COUNTS = [10, 20, 50];
const DAILY_PRACTICE_STORAGE_KEY = "norwegian-dictionary-daily-practice-v2";
const DAILY_QUEST_ROUND_TARGET = 10;
const DAILY_QUESTS = Object.freeze([
  Object.freeze({
    reward: "emerald",
    title: "Emerald round",
    description: "Recognize Norwegian meanings",
    exercise: "recognition",
  }),
  Object.freeze({
    reward: "ruby",
    title: "Ruby round",
    description: "Complete Norwegian sentences",
    exercise: "context",
  }),
  Object.freeze({
    reward: "sapphire",
    title: "Sapphire round",
    description: "Recall words and listen",
    exercise: "recall",
  }),
]);
const BONUS_ROUND_SEQUENCE = Object.freeze([
  "cloze",
  "listening",
  "typed-reverse",
  "cloze",
  "typed-reverse",
  "listening",
  "cloze",
  "typed-reverse",
  "listening",
  "typed-reverse",
]);
let wordGameRoundActive = false; // false until the intro screen's mode is chosen
let wordGameMode = null; // "session" | "infinite"
let wordGameIsTodayPracticeRound = false;
let wordGameIsBonusRound = false;
let wordGameTodayPracticeDate = null;
let wordGameDailyQuestIndex = null;
let wordGameEarnedDailyQuest = null;
let wordGameSessionTarget = 0; // distinct correct words needed to finish a "session" round
let wordGameSessionCorrectWords = new Set(); // distinct words answered correctly this round
// Every distinct word ever shown as a genuinely new question this round
// (not a reintroduction). Capped at wordGameSessionTarget — see
// fetchRandomWord(): once this hits the target, no further new words are
// pulled from the wider dictionary, so a round of N always introduces
// exactly N words, never more.
let wordGameSessionIntroducedWords = new Set();
let wordGameSessionQuestionsAnswered = 0;
let wordGameSessionCorrectAnswers = 0;
let wordGameSessionIncorrectAnswers = 0;
let wordGameSessionStartedAt = 0;
// Distinct words answered incorrectly at least once this round — shown in
// the "Words to review" list on the round summary screen. A word stays
// listed even if later answered correctly, since it was still worth a
// second look.
let wordGameSessionMissedWords = new Set();

function getDailyPracticeDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDailyPracticeState(value, dateKey = getDailyPracticeDateKey()) {
  const completedRounds =
    value?.date === dateKey && Number.isFinite(value.completedRounds)
      ? Math.min(
          DAILY_QUESTS.length,
          Math.max(0, Math.floor(value.completedRounds)),
        )
      : 0;
  const earnedRewards = DAILY_QUESTS.slice(0, completedRounds).map(
    (quest) => quest.reward,
  );

  return {
    date: dateKey,
    completedRounds,
    earnedRewards,
  };
}

function loadDailyPracticeState() {
  try {
    const stored = JSON.parse(
      window.localStorage?.getItem(DAILY_PRACTICE_STORAGE_KEY) || "null",
    );
    return normalizeDailyPracticeState(stored);
  } catch (_error) {
    return normalizeDailyPracticeState(null);
  }
}

function saveDailyPracticeState(state, { syncRemote = true } = {}) {
  const normalized = normalizeDailyPracticeState(state);
  try {
    window.localStorage?.setItem(
      DAILY_PRACTICE_STORAGE_KEY,
      JSON.stringify(normalized),
    );
  } catch (_error) {
    // Private browsing/storage restrictions should not block the game.
  }

  // Let myWordsAuth.js know quest progress changed, so it can sync to
  // Firestore when a user is signed in. syncRemote is false when the
  // change came from a remote merge, to avoid immediately writing it back.
  window.dispatchEvent(
    new CustomEvent("daily-quest:updated", {
      detail: { dailyPractice: normalized, syncRemote },
    }),
  );

  return normalized;
}

// Applied when a remote (Firestore) value should become the local truth —
// a fresh sign-in merge, or a live update from another signed-in device.
// normalizeDailyPracticeState resets completedRounds to 0 if the remote
// value's date doesn't match today, same as any other stale local read.
function replaceDailyPracticeState(remoteState) {
  const normalized = saveDailyPracticeState(remoteState, { syncRemote: false });

  // renderLandingDailyQuests() is a no-op unless the landing view's quest
  // widget is actually in the DOM, so it's safe to call unconditionally
  // here.
  renderLandingDailyQuests();

  return normalized;
}

function getDailyPracticeProgress(state = loadDailyPracticeState()) {
  return Math.min(state.completedRounds, DAILY_QUESTS.length);
}

function getDailyQuestStates(state = loadDailyPracticeState()) {
  const progress = getDailyPracticeProgress(state);
  return DAILY_QUESTS.map((quest, index) => {
    const complete = index < progress;
    const unlocked = index <= progress;
    return {
      ...quest,
      complete,
      unlocked,
    };
  });
}

function getDailyQuestQuestionMode(
  questIndex,
  questionsAnswered = 0,
  hasAudio = false,
) {
  const exercise = DAILY_QUESTS[questIndex]?.exercise;
  if (exercise === "recognition") return "forward";
  if (exercise === "context") return "cloze";
  if (exercise === "recall") {
    return hasAudio && questionsAnswered % 2 === 1 ? "listening" : "reverse";
  }
  return null;
}

// Once all three gems are earned, the optional ten-word bonus round should
// feel like a genuine step up rather than an unlabeled generic session. Its
// exercise sequence is deterministic so every bonus round contains the same
// intentional balance: three context questions, three listening questions,
// and four typed English-to-Norwegian recall questions. Vocabulary difficulty
// still comes from the learner's saved CEFR level and the adaptive scheduler.
function getBonusRoundQuestionMode(questionsAnswered = 0, hasAudio = false) {
  const index = Math.max(0, Math.floor(Number(questionsAnswered) || 0));
  const mode = BONUS_ROUND_SEQUENCE[index % BONUS_ROUND_SEQUENCE.length];
  return mode === "listening" && !hasAudio ? "typed-reverse" : mode;
}

function completeDailyQuestRound() {
  const state = loadDailyPracticeState();
  const quest = DAILY_QUESTS[state.completedRounds] || null;
  if (!quest) return null;
  state.completedRounds += 1;
  const savedState = saveDailyPracticeState(state);
  return savedState.earnedRewards.includes(quest.reward) ? quest : null;
}
let incorrectCount = 0; // Tracks the total number of incorrect answers
// Short in-session relearning queue. Durable state and its due timestamp live
// in WordStrengthAPI; this queue only supplies enough intervening questions
// before a retry and remembers which exercise form was missed.
let incorrectWordQueue = [];
// Linearly interpolates a CEFR-band-keyed table (e.g.
// REVERSE_FLASHCARD_PROBABILITY below) against the continuous ability
// score, instead of snapping to whichever discrete band the score is
// nearest to. Keeps the underlying curriculum ramp (more reverse-recall
// and listening practice as ability grows) continuous rather than
// stepping abruptly at band boundaries — consistent with there being no
// user-visible "level" to step between.
function interpolateByAbility(score, table) {
  if (!Number.isFinite(score)) return null;

  const points = CEFR_LEVEL_ORDER.map((level) => ({
    x: CEFR_DIFFICULTY_ANCHOR[level],
    y: table[level],
  }));

  if (score <= points[0].x) return points[0].y;
  if (score >= points[points.length - 1].x) return points[points.length - 1].y;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (score >= a.x && score <= b.x) {
      const t = (score - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }

  return points[points.length - 1].y;
}
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
// Productive recall is introduced as a ladder, not as a sudden replacement
// for recognition practice. Sentence-scaffolded typing begins first; fully
// unaided English-to-Norwegian recall follows only once a word is stronger.
// A missed typed answer is first reintroduced by the relearning queue as a
// multiple-choice scaffold, then must be typed correctly before that word can
// leave the queue or the round can finish.
const TYPED_RECALL_PROBABILITY = Object.freeze({
  cloze: Object.freeze({ 2: 0.25, 3: 0.5, 4: 0.75, 5: 1 }),
  reverse: Object.freeze({ 3: 0.35, 4: 0.65, 5: 0.9 }),
});
let previousWord = null;
let recentAnswers = []; // Track the last X answers, 1 for correct, 0 for incorrect
let reintroduceThreshold = 10; // Intervening answers before an Endless retry

// Bounded rounds use their selected size as the cap on distinct words, while
// Endless mode can keep discovering words after all currently due work is
// clear. Failed words use this shorter scaled gap so retries remain feasible
// inside a 10/20/50-word round without becoming immediate repetition.
function getWordGameReintroduceThreshold() {
  if (wordGameMode !== "session") {
    return reintroduceThreshold;
  }

  return Math.min(6, Math.max(2, Math.round(wordGameSessionTarget / 5)));
}

function applyCorrectRelearningResult(queueEntry, wasTyped, answeredQuestions) {
  if (!queueEntry) return "none";

  if (queueEntry.requiresTypedMastery && !wasTyped) {
    queueEntry.forceTypedRetry = true;
    queueEntry.shown = false;
    queueEntry.availableAfterQuestion = answeredQuestions + 1;
    return "keep-for-typing";
  }

  return "remove";
}

let totalQuestions = 0; // Track total questions per level
let wordDataStore = [];
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
    ? `<div class="game-cefr-label ${cefrClass}" title="${getCefrTooltip(cefrLevel)}">${cefrLevel}</div>`
    : "";
}

// Shared by renderWordGameUI and renderClozeGameUI's gender/word-class badge.
function getGameGenderLabel(gender) {
  if (WordClass.isNounGender(gender)) {
    return "N - " + WordClass.stripNounPrefix(gender);
  }
  const normalizedGender = String(gender ?? "").toLowerCase();
  if (normalizedGender.startsWith("adjective")) return "Adj";
  if (normalizedGender.startsWith("adverb")) return "Adv";
  if (normalizedGender.startsWith("conjunction")) return "Conj";
  if (normalizedGender.startsWith("determiner")) return "Det";
  if (normalizedGender.startsWith("expression")) return "Exp";
  if (normalizedGender.startsWith("interjection")) return "Inter";
  if (normalizedGender.startsWith("numeral")) return "Num";
  if (normalizedGender.startsWith("possessive")) return "Poss";
  if (normalizedGender.startsWith("preposition")) return "Prep";
  if (normalizedGender.startsWith("pronoun")) return "Pron";
  return String(gender ?? "");
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
    ".game-word-card, .game-translation-card, .game-typed-answer-form",
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

  if (type === "streak") {
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
  }

  if (bannerPlaceholder) {
    bannerPlaceholder.innerHTML = bannerHTML;
  }
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

// Track correct/incorrect answers for each question, and nudge the ability
// estimate from this one data point. This runs after every answer in every
// mode — there's no batch evaluation window and no discrete "level" event,
// just a continuous drift toward wherever the evidence points.
function updateRecentAnswers(isCorrect, wordObj) {
  recentAnswers.push(isCorrect ? 1 : 0);
  updateAbilityScore(wordObj, isCorrect);
}

function getWordDifficultyAnchor(entry) {
  const cefr = String(entry?.CEFR ?? "").trim().toUpperCase();
  return CEFR_DIFFICULTY_ANCHOR[cefr] ?? CEFR_DIFFICULTY_ANCHOR.B1;
}

// Elo/logistic-style update: predicts the probability the learner gets a
// word of this difficulty right given their current ability, then moves
// ability toward the actual outcome by a small, fixed step. Replaces the
// old 20-question batch accuracy check with something that adapts after
// every single answer, in both bounded and endless rounds.
function getExpectedSuccessProbability(wordDifficulty, ability) {
  return 1 / (1 + Math.exp((wordDifficulty - ability) / ABILITY_LOGISTIC_SCALE));
}

function updateAbilityScore(wordObj, isCorrect) {
  if (abilityScore === null || !wordObj) return;

  const wordDifficulty = getWordDifficultyAnchor(wordObj);
  const expected = getExpectedSuccessProbability(wordDifficulty, abilityScore);
  const actual = isCorrect ? 1 : 0;

  abilityScore = clampAbility(
    abilityScore + ABILITY_K_FACTOR * (actual - expected),
  );
  saveAbilityState();
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

// Shared by every one-off audio-clip playback in the app (word/sentence
// audio here, and the pronunciation-icon click handler in scripts.js) —
// creates the clip, tracks it in activeAudio so stopAllAudio() can halt it
// later, and plays it.
function playTrackedAudio(url) {
  const audio = new Audio(url);
  activeAudio.push(audio);
  audio.play().catch((err) => console.warn("Audio playback failed:", err));
  return audio;
}

function playWordAudio(wordObj) {
  if (!wordObj || !wordObj.ord) return;
  const cleanWord = wordObj.ord.split(",")[0].trim();
  playTrackedAudio(buildWordAudioUrl(cleanWord));
}

function playSentenceAudio(exampleSentence) {
  if (!exampleSentence) return;
  const cleanSentence = exampleSentence.replace(/<[^>]*>/g, "").trim();
  playTrackedAudio(buildPronAudioUrl(cleanSentence));
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

  // Purely descriptive of recent accuracy, not relative to any level
  // threshold — there's nothing here to rise or fall from.
  let fillColor = "#c7e3b6"; // default green
  let fontColor = "#6b9461";

  if (total === 0) {
    // Before the user answers any question
    fillColor = "#ddd"; // neutral gray
    fontColor = "#444"; // dark gray text
  } else if (correctPercentage < 60) {
    fillColor = "#e9a895"; // red
    fontColor = "#b5634d";
  } else if (correctPercentage < 85) {
    fillColor = "#f2e29b"; // yellow
    fontColor = "#a0881c";
  }

  const isSessionRound = wordGameRoundActive && wordGameMode === "session";

  // Session rounds swap the recent-accuracy bar for one filling toward the
  // round's own "Word X of N" progress instead, so completing a round
  // *feels* like progress the same way the infinite-mode bar does. Infinite
  // mode keeps the accuracy bar, plus an optional way to stop and see stats.
  // Available in every mode now, not just infinite — a learner might just
  // as well want to stop partway through a bounded round and see how
  // they've done so far. Ending early this way is exactly why
  // recordStreakActivity() (streak.js) is gated on having gotten at least
  // 10 words correct: without that floor, tapping this the instant a
  // round starts would count as a full day's practice.
  //
  // The control itself is #game-end-session-btn, a static button in the
  // toolbar (index.html, in .cefr-filter-group) shown and wired once via
  // updateEndSessionToolbarButtonVisibility() below, not re-rendered per
  // question like the rest of this stats row is.
  const middleContentHTML = isSessionRound
    ? `<div class="game-stats-progress-wrapper" style="flex-grow: 1;">
         <p class="game-stat-label">Round progress</p>
         <div class="game-stats-accuracy-row">
           <div class="game-session-progress-bg" style="border-radius: 10px; overflow: hidden; position: relative; display: flex; align-items: center;">
             <div class="game-session-progress-fill" id="game-session-progress-fill"
               style="position: absolute; top: 0; left: 0; bottom: 0; width: ${getWordGameSessionProgressPercent()}%;"></div>
             <p class="game-session-progress-label" id="game-session-progress"
               style="position: relative; width: 100%; text-align: center; margin: 0; user-select: none;
                      font-family: 'Noto Sans', sans-serif; font-size: 14px; font-weight: 500;
                      z-index: 1; color: #444;">
               ${getWordGameSessionProgressLabel()}
             </p>
           </div>
         </div>
       </div>`
    : `<div class="game-stats-progress-wrapper" style="flex-grow: 1;">
         <p class="game-stat-label">Recent accuracy</p>
         <div class="game-stats-accuracy-row">
           <div class="level-progress-bar-bg" style="border-radius: 10px; overflow: hidden; position: relative;">
             <div class="level-progress-bar-fill"
               style="width: 0%; background-color: ${fillColor}; height: 100%;"></div>
             <p class="level-progress-label"
               style="position: absolute; width: 100%; text-align: center; margin: 0; user-select: none;
                      font-family: 'Noto Sans', sans-serif; font-size: 18px; font-weight: 500;
                      z-index: 1; color: ${fontColor}; line-height: 38px;">
               ${Math.round(correctPercentage)}%
             </p>
           </div>
         </div>
       </div>`;

  // Inject HTML only if it hasn't been rendered yet for this question.
  // .game-stats-wrapper (rather than .level-progress-bar-fill, which only
  // exists in infinite mode's layout) is the marker here since it's
  // present in both session and infinite layouts.
  if (!statsContainer.querySelector(".game-stats-wrapper")) {
    // #game-session-stats (statsContainer itself) is also a
    // .game-stats-content flex row, so the round-progress row needs its
    // own plain block wrapper — otherwise it becomes a flex sibling of
    // the stats row below instead of stacking underneath it.
    statsContainer.innerHTML = `
      <div class="game-stats-wrapper">
        <div class="game-stats-content" style="width: 100%;">
          <div class="game-stats-correct-box">
            <p class="game-stat-label">Correct in a row</p>
            <p id="streak-count">${correctStreak}</p>
          </div>
          ${middleContentHTML}
          <div class="game-stats-incorrect-box">
            <p class="game-stat-label">Words to review</p>
            <p id="review-count">${wordsToReview}</p>
          </div>
        </div>
      </div>
    `;
  }

  // Update existing elements only
  const fillEl = statsContainer.querySelector(".level-progress-bar-fill");
  const labelEl = statsContainer.querySelector(".level-progress-label");
  const streakEl = statsContainer.querySelector("#streak-count");
  const reviewEl = statsContainer.querySelector("#review-count");
  const progressFillEl = statsContainer.querySelector(
    "#game-session-progress-fill",
  );
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
  if (progressFillEl) {
    progressFillEl.style.width = `${getWordGameSessionProgressPercent()}%`;
  }
  if (progressEl) {
    progressEl.textContent = getWordGameSessionProgressLabel();
  }
}

function normalizeGameWhitespace(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGameAnswer(value) {
  return normalizeGameWhitespace(value).toLocaleLowerCase("nb-NO");
}

function startsWithUppercaseLetter(value) {
  const firstLetter = String(value ?? "").match(/\p{L}/u)?.[0] || "";
  return (
    firstLetter !== "" &&
    firstLetter === firstLetter.toLocaleUpperCase("nb-NO") &&
    firstLetter !== firstLetter.toLocaleLowerCase("nb-NO")
  );
}

function getDisplayedAnswer(value) {
  return normalizeGameWhitespace(String(value ?? "").split(",")[0]);
}

function escapeGameHTML(value) {
  if (typeof escapeHTML === "function") return escapeHTML(value);
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getPrimaryNorwegianForm(entryOrValue) {
  const value =
    typeof entryOrValue === "object" ? entryOrValue?.ord : entryOrValue;
  return getDisplayedAnswer(value);
}

function expandSlashVariant(variant) {
  let combinations = [""];
  for (const token of normalizeGameWhitespace(variant).split(" ")) {
    const options = token.split("/").filter(Boolean);
    combinations = combinations.flatMap((prefix) =>
      options.map((option) => (prefix ? `${prefix} ${option}` : option)),
    );
  }
  return combinations;
}

function getNorwegianEntryVariants(entry) {
  return [
    ...new Set(
      String(entry?.ord ?? "")
        .split(",")
        .flatMap(expandSlashVariant)
        .map(normalizeGameWhitespace)
        .filter(Boolean),
    ),
  ];
}

function getTypedRecallProbability(wordObj, mode) {
  const probabilities = TYPED_RECALL_PROBABILITY[mode];
  if (!probabilities) return 0;

  const snapshot = window.WordStrengthAPI?.getSnapshot?.(wordObj);
  // New and relearning words stay supported by choices. This also makes the
  // feature a no-op when durable study data is unavailable.
  if (!snapshot || snapshot.queue === "new" || snapshot.queue === "relearning") {
    return 0;
  }

  return probabilities[snapshot.strength] ?? 0;
}

function shouldUseTypedRecall(wordObj, mode, randomValue = Math.random()) {
  return randomValue < getTypedRecallProbability(wordObj, mode);
}

function getTypedAcceptedAnswers(wordObj, isCloze, correctAnswer) {
  if (isCloze) return [normalizeGameWhitespace(correctAnswer)];

  const acceptedAnswers = new Set(getNorwegianEntryVariants(wordObj));
  const targetEnglish = normalizeGameAnswer(
    getDisplayedAnswer(wordObj?.engelsk),
  );
  if (!targetEnglish || typeof results === "undefined") {
    return [...acceptedAnswers];
  }

  // The English prompt can legitimately have more than one Norwegian answer
  // (bad/baderom for "bathroom"). Accept only synonyms the user's dictionary
  // itself presents with that same displayed sense and compatible grammatical
  // category. Gender compatibility is especially important for nouns: an
  // answer has to support one of the articles shown on the question card.
  for (const candidate of results) {
    if (
      normalizeGameAnswer(getDisplayedAnswer(candidate?.engelsk)) !==
        targetEnglish ||
      !WordClass.hasCompatibleGender(wordObj?.gender, candidate?.gender)
    ) {
      continue;
    }
    getNorwegianEntryVariants(candidate).forEach((variant) =>
      acceptedAnswers.add(variant),
    );
  }

  return [...acceptedAnswers];
}

function getGameSentenceTranslations(wordObj) {
  return String(wordObj?.sentenceTranslation ?? "")
    .split(/(?<=[.!?])\s+/)
    .map(normalizeGameWhitespace)
    .filter(Boolean);
}

function getGameSentenceTranslation(wordObj, sentenceIndex = 0) {
  return getGameSentenceTranslations(wordObj)[sentenceIndex] || "";
}

function uppercaseFirstNorwegian(value) {
  const characters = Array.from(String(value ?? ""));
  if (characters.length === 0) return "";
  characters[0] = characters[0].toLocaleUpperCase("nb-NO");
  return characters.join("");
}

function restoreDictionaryCase(value, dictionaryForm) {
  const normalizedValue = normalizeGameWhitespace(value);
  const reference = normalizeGameWhitespace(dictionaryForm);
  if (!normalizedValue || !reference) return normalizedValue;

  const foldedValue = normalizeGameAnswer(normalizedValue);
  const foldedReference = normalizeGameAnswer(reference);
  if (foldedValue.startsWith(foldedReference)) {
    return reference + normalizedValue.slice(reference.length);
  }

  const referenceTokens =
    reference.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || [];
  let tokenIndex = 0;
  return normalizedValue.replace(
    /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu,
    (token) => {
      const referenceToken = referenceTokens[tokenIndex++] || "";
      if (!referenceToken) return token;
      if (
        referenceToken === referenceToken.toLocaleUpperCase("nb-NO") &&
        referenceToken !== referenceToken.toLocaleLowerCase("nb-NO")
      ) {
        return token.toLocaleUpperCase("nb-NO");
      }
      return /^[\p{Lu}]/u.test(referenceToken)
        ? uppercaseFirstNorwegian(token)
        : token;
    },
  );
}

function getIndexedClozeTokens(text) {
  return Array.from(
    String(text ?? "").matchAll(
      /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu,
    ),
    (match) => ({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    }),
  );
}

function getClozePatternTokens(value) {
  return (
    normalizeGameWhitespace(value).match(
      /\.{3}|[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu,
    ) || []
  );
}

function getParadigmSlotsForLemma(lemma, surface, wordClass, gender = "") {
  const paradigm = window.Inflections?.getParadigmForLemma(
    normalizeGameAnswer(lemma),
    wordClass,
    gender,
  );
  const normalizedSurface = normalizeGameAnswer(surface);
  return paradigm
    ? paradigm.slots.flatMap((forms, index) =>
        forms.includes(normalizedSurface) ? [index] : [],
      )
    : [];
}

function getAdjectiveAgreementSlotsFromNounGender(gender) {
  const articles = new Set(
    WordClass.stripNounPrefix(gender).split("-").filter(Boolean),
  );
  const slots = [];
  if (articles.has("en")) slots.push(0);
  if (articles.has("ei")) slots.push(1);
  if (articles.has("et")) slots.push(2);
  return slots;
}

let gameNounGenderIndexSource = null;
let gameNounGendersByLemma = new Map();

function getGameNounGendersByLemma() {
  if (typeof results === "undefined") return new Map();
  if (gameNounGenderIndexSource === results) return gameNounGendersByLemma;

  const nextIndex = new Map();
  for (const entry of results) {
    if (!WordClass.isNounGender(entry?.gender)) continue;
    for (const variant of getNorwegianEntryVariants(entry)) {
      const tokens = getClozePatternTokens(variant);
      if (
        tokens.length !== 1 ||
        normalizeGameAnswer(tokens[0]) !== normalizeGameAnswer(variant)
      ) {
        continue;
      }
      const lemma = normalizeGameAnswer(variant);
      const genders = nextIndex.get(lemma) || [];
      genders.push(entry.gender);
      nextIndex.set(lemma, genders);
    }
  }

  gameNounGenderIndexSource = results;
  gameNounGendersByLemma = nextIndex;
  return gameNounGendersByLemma;
}

function hasCompetingAdjectiveEntry(wordObj, lemma) {
  if (typeof results === "undefined") return false;
  const normalizedLemma = normalizeGameAnswer(lemma);
  return results.some(
    (entry) =>
      entry !== wordObj &&
      WordClass.getWordClass(entry?.gender) === "adjective" &&
      getNorwegianEntryVariants(entry).some(
        (variant) => normalizeGameAnswer(variant) === normalizedLemma,
      ),
  );
}

function refineAdjectiveSlotIndexes(
  slotIndexes,
  sentenceTokens,
  firstTokenIndex,
  endTokenIndex,
) {
  if (slotIndexes.length < 2) return slotIndexes;

  const precedingToken = normalizeGameAnswer(
    sentenceTokens[firstTokenIndex - 1]?.text,
  );
  const determinerSlot = {
    en: 0,
    ei: 1,
    et: 2,
    den: 3,
    det: 3,
    de: 4,
  }[precedingToken];
  if (Number.isInteger(determinerSlot) && slotIndexes.includes(determinerSlot)) {
    return [determinerSlot];
  }

  // An uninflected adjective can occupy several official singular slots
  // (koreansk is identical in masculine, feminine, and neuter). When the
  // following token is an exact dictionary noun lemma, its declared article
  // resolves that agreement without suffix guessing. If several noun senses
  // remain possible, retain all compatible slots and let distractor selection
  // require a form that is valid for every one of them.
  const followingToken = normalizeGameAnswer(sentenceTokens[endTokenIndex]?.text);
  if (!followingToken || typeof results === "undefined") return slotIndexes;

  const nounAgreementSlots = new Set();
  const matchingNounGenders =
    getGameNounGendersByLemma().get(followingToken) || [];
  for (const nounGender of matchingNounGenders) {
    for (const slot of getAdjectiveAgreementSlotsFromNounGender(nounGender)) {
      nounAgreementSlots.add(slot);
    }
  }

  const refinedSlots = slotIndexes.filter((slot) => nounAgreementSlots.has(slot));
  return refinedSlots.length > 0 ? refinedSlots : slotIndexes;
}

function matchesClozePatternToken(patternToken, surfaceToken, wordObj, isSingle) {
  if (normalizeGameAnswer(patternToken) === normalizeGameAnswer(surfaceToken)) {
    return true;
  }

  const entryWordClass = WordClass.getWordClass(wordObj.gender);
  if (
    isSingle &&
    ["noun", "adjective", "verb"].includes(entryWordClass)
  ) {
    return (
      getParadigmSlotsForLemma(
        patternToken,
        surfaceToken,
        entryWordClass,
        entryWordClass === "noun" ? wordObj.gender : "",
      ).length > 0
    );
  }

  // A complex expression does not declare the grammatical class of each
  // component. Try every inflectable class, but still require an exact
  // official paradigm form; this supports "gå på skinner" -> "går på
  // skinner" without reviving prefix or suffix guesses.
  return ["verb", "adjective", "noun"].some(
    (wordClass) =>
      getParadigmSlotsForLemma(patternToken, surfaceToken, wordClass).length >
      0,
  );
}

function matchClozePatternAt(patternTokens, sentenceTokens, startIndex, wordObj) {
  const isSingle =
    patternTokens.length === 1 && patternTokens[0] !== "...";

  const walk = (patternIndex, sentenceIndex) => {
    if (patternIndex === patternTokens.length) return sentenceIndex;
    if (sentenceIndex >= sentenceTokens.length) return -1;

    const patternToken = patternTokens[patternIndex];
    if (patternToken === "...") {
      const minimumRemaining = patternTokens
        .slice(patternIndex + 1)
        .filter((token) => token !== "...").length;
      const latestNextIndex = sentenceTokens.length - minimumRemaining;
      for (
        let nextIndex = sentenceIndex + 1;
        nextIndex <= latestNextIndex;
        nextIndex++
      ) {
        const endIndex = walk(patternIndex + 1, nextIndex);
        if (endIndex >= 0) return endIndex;
      }
      return -1;
    }

    if (
      !matchesClozePatternToken(
        patternToken,
        sentenceTokens[sentenceIndex].text,
        wordObj,
        isSingle,
      )
    ) {
      return -1;
    }
    return walk(patternIndex + 1, sentenceIndex + 1);
  };

  return walk(0, startIndex);
}

function getPhraseSlotDescriptor(
  wordObj,
  patternTokens,
  matchedSentenceTokens,
) {
  if (
    patternTokens.includes("...") ||
    patternTokens.length !== matchedSentenceTokens.length
  ) {
    return null;
  }

  const entryWordClass = WordClass.getWordClass(wordObj.gender);
  const createDescriptor = (componentIndex, wordClass, gender = "") => {
    const slotIndexes = getParadigmSlotsForLemma(
      patternTokens[componentIndex],
      matchedSentenceTokens[componentIndex].text,
      wordClass,
      gender,
    );
    if (slotIndexes.length === 0) return null;
    return {
      componentIndex,
      position:
        componentIndex === 0
          ? "first"
          : componentIndex === patternTokens.length - 1
            ? "last"
            : "index",
      wordClass,
      slotIndexes,
    };
  };

  if (["noun", "adjective", "verb"].includes(entryWordClass)) {
    const componentIndex = entryWordClass === "noun" ? patternTokens.length - 1 : 0;
    return createDescriptor(
      componentIndex,
      entryWordClass,
      entryWordClass === "noun" ? wordObj.gender : "",
    );
  }

  // Expressions do not identify the class of each component. A visibly
  // inflected component can still be aligned to an official slot; a fully
  // unchanged fixed expression needs no synthetic inflection at all and is
  // left as a phrase instead of assigning a random noun/verb role to one of
  // its unchanged words.
  const componentOrder = patternTokens
    .map((token, index) => ({
      index,
      changed:
        normalizeGameAnswer(token) !==
        normalizeGameAnswer(matchedSentenceTokens[index].text),
    }))
    .filter(({ changed }) => changed)
    .sort((a, b) => Number(b.changed) - Number(a.changed));
  for (const { index } of componentOrder) {
    for (const wordClass of ["verb", "adjective", "noun"]) {
      const descriptor = createDescriptor(index, wordClass);
      if (descriptor) return descriptor;
    }
  }
  return null;
}

function createClozeTarget(
  wordObj,
  sentence,
  sentenceIndex,
  sentenceTokens,
  firstTokenIndex,
  endTokenIndex,
  variant,
  patternTokens,
) {
  const startIndex = sentenceTokens[firstTokenIndex].start;
  const endIndex = sentenceTokens[endTokenIndex - 1].end;
  const surfaceForm = sentence.slice(startIndex, endIndex);
  const wordClass = WordClass.getWordClass(wordObj.gender);
  const isLexical =
    patternTokens.length === 1 &&
    patternTokens[0] !== "..." &&
    ["noun", "adjective", "verb"].includes(wordClass);
  const targetLemma = patternTokens.find((token) => token !== "...") || "";
  let slotIndexes = isLexical
    ? getParadigmSlotsForLemma(
        targetLemma,
        surfaceForm,
        wordClass,
        wordClass === "noun" ? wordObj.gender : "",
      )
    : [];
  if (isLexical && wordClass === "adjective") {
    slotIndexes = refineAdjectiveSlotIndexes(
      slotIndexes,
      sentenceTokens,
      firstTokenIndex,
      endTokenIndex,
    );
  }
  const matchedSentenceTokens = sentenceTokens.slice(
    firstTokenIndex,
    endTokenIndex,
  );
  const phraseSlot = isLexical
    ? null
    : getPhraseSlotDescriptor(wordObj, patternTokens, matchedSentenceTokens);

  // If a noun and adjective share the same dictionary spelling, a bare noun
  // lemma immediately modifying another noun is an adjective use. Rejecting
  // that source row is safer than teaching noun distractors in an adjective
  // context; the correctly classified adjective entry remains eligible for
  // its own cloze question. Punctuation blocks this check, so appositives are
  // not mistaken for attributive adjectives.
  const followingSentenceToken = sentenceTokens[endTokenIndex];
  const nounUsedAttributively =
    isLexical &&
    wordClass === "noun" &&
    normalizeGameAnswer(surfaceForm) === normalizeGameAnswer(targetLemma) &&
    followingSentenceToken &&
    /^\s*$/u.test(sentence.slice(endIndex, followingSentenceToken.start)) &&
    getGameNounGendersByLemma().has(
      normalizeGameAnswer(followingSentenceToken.text),
    ) &&
    hasCompetingAdjectiveEntry(wordObj, targetLemma);
  if (nounUsedAttributively) return null;

  return {
    sentence,
    sentenceIndex,
    surfaceForm,
    startIndex,
    endIndex,
    startsSentence: /^[^\p{L}\p{N}]*$/u.test(
      sentence.slice(0, startIndex),
    ),
    slotIndexes,
    targetLemma,
    wordClass,
    wordCount: endTokenIndex - firstTokenIndex,
    kind: isLexical ? "lexical" : "phrase",
    template: variant,
    templateTokens: patternTokens,
    phraseSlot,
    requiresInflectionAgreement:
      !isLexical && ["noun", "adjective", "verb"].includes(wordClass),
  };
}

function refineExpressionVerbSlotIndexes(slotIndexes, sentence, startIndex) {
  const accepted = [...new Set(slotIndexes || [])];
  if (accepted.length <= 1) return accepted;
  const precedingTokens = getIndexedClozeTokens(sentence.slice(0, startIndex));
  const preceding = normalizeGameAnswer(
    precedingTokens[precedingTokens.length - 1]?.text || "",
  );
  if (["har", "hadde"].includes(preceding) && accepted.includes(3)) {
    return [3];
  }
  if (
    ["å", "kan", "kunne", "må", "måtte", "skal", "skulle", "vil", "ville", "bør", "burde"].includes(
      preceding,
    ) &&
    accepted.includes(0)
  ) {
    return [0];
  }
  if (["ble", "blir", "er", "var"].includes(preceding)) {
    const participial = accepted.filter((slot) => [6, 7, 8, 9, 10].includes(slot));
    if (participial.length > 0) return participial;
  }
  // With no auxiliary immediately before it, a surface shared by the weak
  // past and participle paradigms is functioning as a finite past verb.
  if (accepted.includes(2)) return [2];
  return accepted;
}

function refineExpressionAdjectiveSlotIndexes(
  slotIndexes,
  sentence,
  startIndex,
  endIndex,
) {
  const sentenceTokens = getIndexedClozeTokens(sentence);
  const firstTokenIndex = sentenceTokens.findIndex(
    (token) => token.start === startIndex,
  );
  const endTokenIndex = sentenceTokens.findIndex(
    (token) => token.end >= endIndex,
  );
  if (firstTokenIndex < 0 || endTokenIndex < firstTokenIndex) {
    return [...new Set(slotIndexes || [])];
  }
  return refineAdjectiveSlotIndexes(
    [...new Set(slotIndexes || [])],
    sentenceTokens,
    firstTokenIndex,
    endTokenIndex + 1,
  );
}

function createNounGenitiveForm(form) {
  const value = String(form ?? "");
  if (!value) return "";
  return /[sxz]$/iu.test(value) ? `${value}'` : `${value}s`;
}

function getExpressionNounCase(anchorSpan, slotIndexes) {
  if (anchorSpan?.node?.selected?.wordClass !== "noun") return "base";
  const normalizeCaseForm = (value) =>
    normalizeGameAnswer(value).replace(/’/gu, "'");
  const surface = normalizeCaseForm(anchorSpan.surface);
  const paradigm = anchorSpan.node.selected.paradigm;
  const baseForms = [
    ...new Set(
      (slotIndexes || []).flatMap(
        (slotIndex) => paradigm?.slots?.[slotIndex] || [],
      ),
    ),
  ];
  if (baseForms.some((form) => normalizeCaseForm(form) === surface)) {
    return "base";
  }
  return baseForms.some(
    (form) => normalizeCaseForm(createNounGenitiveForm(form)) === surface,
  )
    ? "genitive"
    : "base";
}

function getExpressionAnchorSpan(match) {
  const priority = { verb: 0, noun: 1, adjective: 2 };
  return match.spans
    .map((span, index) => ({
      span,
      index,
      wordClass: span.node.selected?.wordClass || "",
      changed:
        normalizeGameAnswer(span.surface) !==
        normalizeGameAnswer(span.node.selected?.lemma || span.node.text),
    }))
    .filter(
      ({ span, wordClass }) =>
        Number.isInteger(priority[wordClass]) &&
        span.slotIndexes.some(Number.isInteger),
    )
    .sort(
      (left, right) =>
        priority[left.wordClass] - priority[right.wordClass] ||
        Number(right.changed) - Number(left.changed) ||
        left.index - right.index,
    )[0]?.span;
}

async function findExpressionClozeTarget(wordObj, preferredForm = "") {
  const analysis = await window.ExpressionPatterns?.getAnalysis(wordObj);
  const exampleText = normalizeGameWhitespace(wordObj?.eksempel);
  if (!analysis || !exampleText) return null;
  const sentences = exampleText
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.trim() !== "");
  const normalizedPreferredForm = normalizeGameAnswer(preferredForm);
  let firstMatch = null;

  for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex++) {
    const sentence = sentences[sentenceIndex];
    const match = analysis.matcher.find(sentence);
    if (!match) continue;

    // Keep the expression's fixed words, objects, and reflexives in the
    // sentence while blanking one recognized inflectable component. Its word
    // class and exact paradigm slot then constrain every distractor. This is
    // what turns "kastet henne til ulvene" into "___ henne til ulvene", and
    // also supports noun- and adjective-headed expressions.
    const anchorSpan = getExpressionAnchorSpan(match);
    let target;
    if (anchorSpan) {
      const anchorWordClass = anchorSpan.node.selected.wordClass;
      let slotIndexes = [...new Set(anchorSpan.slotIndexes)].filter(
        Number.isInteger,
      );
      if (anchorWordClass === "verb") {
        slotIndexes = refineExpressionVerbSlotIndexes(
          slotIndexes,
          sentence,
          anchorSpan.start,
        );
      } else if (anchorWordClass === "adjective") {
        slotIndexes = refineExpressionAdjectiveSlotIndexes(
          slotIndexes,
          sentence,
          anchorSpan.start,
          anchorSpan.end,
        );
      }
      target = {
        sentence,
        sentenceIndex,
        surfaceForm: anchorSpan.surface,
        startIndex: anchorSpan.start,
        endIndex: anchorSpan.end,
        startsSentence: /^[^\p{L}\p{N}]*$/u.test(
          sentence.slice(0, anchorSpan.start),
        ),
        slotIndexes,
        targetLemma: anchorSpan.node.selected.lemma,
        targetGender:
          anchorWordClass === "noun"
            ? anchorSpan.node.selected.paradigm?.gender || ""
            : anchorWordClass,
        nounCase: getExpressionNounCase(anchorSpan, slotIndexes),
        wordClass: anchorWordClass,
        wordCount: 1,
        kind: "expression-anchor",
        template: anchorSpan.node.text,
        templateTokens: [anchorSpan.node.text],
        phraseSlot: null,
        requiresInflectionAgreement: true,
        expressionAnalysis: analysis,
      };
    } else {
      const hasSelectedInflectableComponent = match.spans.some(
        (span) => span.node.selected?.wordClass,
      );
      if (hasSelectedInflectableComponent) continue;
      target = {
        sentence,
        sentenceIndex,
        surfaceForm: sentence.slice(match.start, match.end),
        startIndex: match.start,
        endIndex: match.end,
        startsSentence: /^[^\p{L}\p{N}]*$/u.test(
          sentence.slice(0, match.start),
        ),
        slotIndexes: [],
        targetLemma: "",
        wordClass: "expression",
        wordCount: match.spans.length,
        kind: "phrase",
        template: match.pattern.display,
        templateTokens: getClozePatternTokens(match.pattern.display),
        phraseSlot: null,
        requiresInflectionAgreement: false,
        expressionAnalysis: analysis,
      };
    }

    if (
      normalizedPreferredForm &&
      normalizeGameAnswer(target.surfaceForm) === normalizedPreferredForm
    ) {
      return target;
    }
    firstMatch ||= target;
  }
  return firstMatch;
}

async function findClozeTarget(wordObj, preferredForm = "") {
  if (WordClass.getWordClass(wordObj?.gender) === "expression") {
    return findExpressionClozeTarget(wordObj, preferredForm);
  }
  const exampleText = normalizeGameWhitespace(wordObj?.eksempel);
  const variants = getNorwegianEntryVariants(wordObj)
    .map((variant) => ({
      variant,
      tokens: getClozePatternTokens(variant),
    }))
    .filter((candidate) => candidate.tokens.length > 0)
    .sort((a, b) => b.tokens.length - a.tokens.length);
  if (!exampleText || variants.length === 0) return null;

  const sentences = exampleText
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.trim() !== "");
  const normalizedPreferredForm = normalizeGameAnswer(preferredForm);
  let firstMatch = null;

  for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex++) {
    const sentence = sentences[sentenceIndex];
    const sentenceTokens = getIndexedClozeTokens(sentence);

    for (let firstTokenIndex = 0; firstTokenIndex < sentenceTokens.length; firstTokenIndex++) {
      for (const { variant, tokens: patternTokens } of variants) {
        const endTokenIndex = matchClozePatternAt(
          patternTokens,
          sentenceTokens,
          firstTokenIndex,
          wordObj,
        );
        if (endTokenIndex <= firstTokenIndex) continue;

        const target = createClozeTarget(
          wordObj,
          sentence,
          sentenceIndex,
          sentenceTokens,
          firstTokenIndex,
          endTokenIndex,
          variant,
          patternTokens,
        );
        if (!target) continue;
        if (
          normalizedPreferredForm &&
          normalizeGameAnswer(target.surfaceForm) === normalizedPreferredForm
        ) {
          return target;
        }
        firstMatch ||= target;
      }
    }
  }

  return firstMatch;
}

function formatCorrectClozeChoice(wordObj, clozeTarget) {
  let choice = restoreDictionaryCase(
    clozeTarget.surfaceForm,
    clozeTarget.template || getPrimaryNorwegianForm(wordObj),
  );
  if (clozeTarget.startsSentence) {
    choice = uppercaseFirstNorwegian(choice);
  }
  return choice;
}

function prepareClozeChoices(wordObj, clozeTarget, distractors) {
  const correctChoice = formatCorrectClozeChoice(wordObj, clozeTarget);
  const formattedDistractors = distractors.map((choice) =>
    clozeTarget.startsSentence ? uppercaseFirstNorwegian(choice) : choice,
  );
  const choices = ensureUniqueDisplayedValues(
    shuffleArray([correctChoice, ...formattedDistractors]),
    true,
  );
  return { correctChoice, choices };
}

// Shown every time the word game is (re)entered, before any question is
// fetched — lets the learner choose a bounded round (a specific number of
// words to learn, with missed words requeued until answered correctly —
// see handleTranslationClick) or an unbounded, endless drill.
function getTodayPracticeQueueSummary() {
  const eligibleEntries = getEligibleGameWords("", {
    ignorePrevious: true,
  });
  const queues = buildGameWordQueues(eligibleEntries);
  return {
    due: queues.relearning.length + queues.due.length,
    newWords: queues.new.length,
  };
}

function getDailyQuestMarkup(state) {
  return getDailyQuestStates(state)
    .map((quest, index) => {
      const status = quest.complete
        ? "complete"
        : quest.unlocked
          ? "active"
          : "locked";
      const statusText = quest.complete
        ? "Earned"
        : quest.unlocked
          ? "Ready · 10 words"
          : `Complete ${DAILY_QUESTS[index - 1]?.reward ?? "the prior round"} first`;

      return `
        <li class="game-daily-quest game-daily-quest--${status} game-daily-quest--${quest.reward}">
          <span class="game-daily-quest-gem game-daily-quest-gem--${quest.reward}" aria-hidden="true"></span>
          <span class="game-daily-quest-copy">
            <span class="game-daily-quest-title">${quest.title}</span>
            <span class="game-daily-quest-target">${quest.description}</span>
          </span>
          <span class="game-daily-quest-status">${statusText}</span>
        </li>
      `;
    })
    .join("");
}

function renderLandingDailyQuests() {
  const container = document.getElementById("landing-daily-quests");
  if (!container) return;

  const state = loadDailyPracticeState();
  const progress = getDailyPracticeProgress(state);
  const complete = progress >= DAILY_QUESTS.length;
  const activeQuest = DAILY_QUESTS[progress] || null;
  const actionLabel = complete
    ? "Start bonus round"
    : `Start ${activeQuest.reward} round`;
  const nextHeading = complete
    ? "Bonus round"
    : `Next: ${activeQuest.title}`;
  const nextDescription = complete
    ? `A harder mix of context, listening, and typed recall · ${DAILY_QUEST_ROUND_TARGET} words`
    : `${activeQuest.description} · ${DAILY_QUEST_ROUND_TARGET} words`;

  container.innerHTML = `
    <div class="landing-daily-quests-header">
      <div>
        <p class="landing-daily-quests-eyebrow">Daily vocabulary challenge</p>
        <h3 id="landing-daily-quests-heading">Today’s quests</h3>
        <p class="landing-daily-quests-intro">Complete three increasingly challenging vocabulary rounds to earn an emerald, ruby, and sapphire.</p>
      </div>
      <strong class="landing-daily-quests-count">${progress} of ${DAILY_QUESTS.length}</strong>
    </div>
    <div class="landing-daily-quest-track" aria-label="Daily quest progress">
      ${DAILY_QUESTS.map((quest, index) => {
        const status = index < progress
          ? "complete"
          : index === progress
            ? "active"
            : "locked";
        return `
          <span class="landing-daily-quest-step landing-daily-quest-step--${status}">
            <span class="game-daily-quest-gem landing-daily-quest-gem game-daily-quest-gem--${quest.reward}" aria-hidden="true"></span>
            <span>${uppercaseFirstNorwegian(quest.reward)}</span>
          </span>
        `;
      }).join("")}
    </div>
    <div class="landing-daily-quests-action">
      <div>
        <strong>${nextHeading}</strong>
        <span>${nextDescription}</span>
      </div>
      <button type="button" id="landing-daily-quests-start"${complete ? ' class="is-bonus"' : ""}>${complete ? '<i class="fas fa-star" aria-hidden="true"></i>' : ""}${actionLabel}</button>
    </div>
  `;

  document
    .getElementById("landing-daily-quests-start")
    ?.addEventListener("click", startDailyQuestFromLanding);

  renderLandingProgressSummary();
}

// Consolidated classification of a word's progress — the single source of
// truth shared by the landing dashboard and the Word List's strength
// filter (wordList.js). This intentionally is NOT just a five-way split of
// the raw 0-5 strength number (see createWordStrengthCell in wordList.js,
// the SpacedRepetition-computed strength value shown per row). Two things
// make that unsafe as the sole basis for a "New -> Mastered" ladder:
//
// 1. A word's first-ever correct answer already scores strength 1, not 0
//    (see scheduleCorrect's null-record branch in spacedRepetition.js —
//    stabilityDays starts at 1, not 0). Strength 0 is reachable almost
//    exclusively in the moments right after a MISS (relearning), which is
//    a transient "just failed" state, not a starting point — so a bucket
//    literally labeled "New" pinned to strength 0 sits empty in ordinary
//    play, which is exactly the bug this replaced.
// 2. Strength alone can't tell "just started" apart from "recently
//    slipped": missing a long-mastered word shrinks its interval
//    (scheduleIncorrect multiplies stabilityDays by 0.35, not to zero) but
//    can still leave its strength reading high, even while the scheduler
//    has it queued for an immediate short-term retry.
//
// So this instead builds on the same queue/state concept the scheduler
// itself already uses (WordStrengthAPI/SpacedRepetition's due/relearning
// bookkeeping — see buildGameWordQueues below) to split off "unpracticed"
// and "relearning" as their own explicit states, and only applies the 1-5
// ladder to words that have actually graduated past their first correct
// answer.
const VOCAB_LADDER_TIERS = Object.freeze([
  Object.freeze({ id: "learning", label: "Learning" }),
  Object.freeze({ id: "developing", label: "Developing" }),
  Object.freeze({ id: "strengthening", label: "Strengthening" }),
  Object.freeze({ id: "strong", label: "Strong" }),
  Object.freeze({ id: "mastered", label: "Mastered" }),
]);
// No record at all — WordStrengthAPI only has a strength value once a
// word's been answered at least once. The landing dashboard never needs
// this bucket (it only ever iterates existing records), but the Word
// List's filter does: almost every entry in the ~29k-word All Words view
// has never been asked.
const VOCAB_UNPRACTICED_TIER_ID = "unpracticed";
// Missed at least once and still awaiting its short-term retry — see
// scheduleIncorrect in spacedRepetition.js. Kept off the 1-5 ladder
// entirely (see the block comment above) since strength alone can't be
// trusted to flag this state.
const VOCAB_RELEARNING_TIER_ID = "relearning";
// Dashboard order: relearning first (it's what the word game's own
// scheduler treats as highest priority — see getNextGameQueueName below),
// then the ladder low to high.
const VOCAB_DASHBOARD_TIERS = Object.freeze([
  Object.freeze({ id: VOCAB_RELEARNING_TIER_ID, label: "Relearning" }),
  ...VOCAB_LADDER_TIERS,
]);

// snapshot: the object returned by SpacedRepetition.getSnapshot() /
// WordStrengthAPI.getSnapshot() — { record, queue, isDue, retrievability,
// strength }.
function getWordProgressTierId(snapshot) {
  if (!snapshot || snapshot.strength === null) return VOCAB_UNPRACTICED_TIER_ID;
  if (snapshot.record?.state === "relearning") return VOCAB_RELEARNING_TIER_ID;

  // A word that's graduated past its first correct answer effectively
  // never reads 0 here in ordinary play (see the block comment above) —
  // the only way to see 0 outside relearning is a "review"-state word left
  // unopened for months, decayed far past its short original interval.
  // That belongs at the bottom rung of the ladder, not off it.
  const ladderIndex = Math.max(1, snapshot.strength) - 1;
  return VOCAB_LADDER_TIERS[ladderIndex]?.id ?? VOCAB_LADDER_TIERS[0].id;
}

// Entry-based (not record-based) sibling of getWordProgressTierId,
// mirroring WordStrengthAPI.getSnapshot's own entry-based lookup — this is
// what wordList.js's strength filter calls per dictionary entry.
function getWordStrengthFilterId(entry, now = Date.now()) {
  return getWordProgressTierId(window.WordStrengthAPI?.getSnapshot?.(entry, now));
}

// The full option list for wordList.js's strength filter dropdown: the
// unpracticed bucket first (the common case in All Words), then relearning,
// then the same five ladder tiers and labels the landing dashboard uses, so
// a learner only has to learn this vocabulary once.
function getVocabStrengthFilterOptions() {
  return [
    { id: VOCAB_UNPRACTICED_TIER_ID, label: "Not practiced yet" },
    { id: VOCAB_RELEARNING_TIER_ID, label: "Relearning" },
    ...VOCAB_LADDER_TIERS.map(({ id, label }) => ({ id, label })),
  ];
}

function getVocabProgressSummary(now = Date.now()) {
  const records = Object.values(window.WordStrengthAPI?.getAll?.() ?? {});
  const counts = VOCAB_DASHBOARD_TIERS.map(() => 0);
  let dueCount = 0;

  for (const record of records) {
    const snapshot = window.SpacedRepetition?.getSnapshot?.(record, now);
    if (!snapshot || snapshot.strength === null) continue;

    if (snapshot.isDue) dueCount++;

    const tierId = getWordProgressTierId(snapshot);
    const tierIndex = VOCAB_DASHBOARD_TIERS.findIndex((tier) => tier.id === tierId);
    if (tierIndex !== -1) counts[tierIndex]++;
  }

  return { total: records.length, counts, dueCount };
}

// Landing-page rollup of every word the learner has ever answered at least
// once, grouped into the same strength tiers shown per-row elsewhere.
// Deliberately distinct from the ability score (abilityScore/CEFR anchors
// above) — ability is an intentionally invisible difficulty dial, not
// something to show the learner (see CEFR_DIFFICULTY_ANCHOR's comment).
// This widget instead surfaces durable retention count, closer to a
// savings balance than a grade, so it doesn't reintroduce a level to
// climb or fall from.
// Builds just the bar-and-legend markup for a vocab-progress breakdown —
// shared by the landing page's compact widget and the full My Stats page
// (myStats.js), so the two can never drift apart on tier order, labels, or
// colors. counts must be in the same order as VOCAB_DASHBOARD_TIERS (see
// getVocabProgressSummary).
function buildVocabProgressBarMarkup(counts, total) {
  const barSegmentsHTML = VOCAB_DASHBOARD_TIERS.map((tier, index) => {
    const count = counts[index];
    if (count === 0) return "";
    const percent = (count / total) * 100;
    return `<span class="landing-progress-segment landing-progress-segment--${index}" style="width: ${percent}%;" title="${tier.label}: ${count}"></span>`;
  }).join("");

  const legendHTML = VOCAB_DASHBOARD_TIERS.map(
    (tier, index) => `
      <span class="landing-progress-legend-item">
        <span class="landing-progress-legend-dot landing-progress-legend-dot--${index}" aria-hidden="true"></span>
        ${tier.label}
        <strong>${counts[index]}</strong>
      </span>
    `,
  ).join("");

  const barLabel = VOCAB_DASHBOARD_TIERS.map(
    (tier, index) => `${tier.label}: ${counts[index]}`,
  ).join(", ");

  return `
    <div class="landing-progress-bar" role="img" aria-label="${escapeGameHTML(barLabel)}">
      ${barSegmentsHTML}
    </div>
    <div class="landing-progress-legend">
      ${legendHTML}
    </div>
  `;
}

function getVocabDueLabel(dueCount) {
  if (dueCount === 0) return "You're caught up on reviews";
  return dueCount === 1
    ? "1 word due for review"
    : `${dueCount} words due for review`;
}

function renderLandingProgressSummary() {
  const container = document.getElementById("landing-progress-summary");
  if (!container) return;

  const { total, counts, dueCount } = getVocabProgressSummary();

  if (total === 0) {
    container.innerHTML = `
      <div class="landing-progress-summary-header">
        <div>
          <p class="landing-progress-summary-eyebrow">Your progress</p>
          <h3 id="landing-progress-summary-heading">Vocabulary profile</h3>
        </div>
      </div>
      <p class="landing-progress-summary-empty">Play the Word Game to start building your vocabulary profile — words you practice will show up here, grouped by how well you know them.</p>
    `;
    return;
  }

  container.innerHTML = `
    <div class="landing-progress-summary-header">
      <div>
        <p class="landing-progress-summary-eyebrow">Your progress</p>
        <h3 id="landing-progress-summary-heading">Vocabulary profile</h3>
      </div>
      <strong class="landing-progress-summary-count">${total.toLocaleString("en-US")} word${total === 1 ? "" : "s"}</strong>
    </div>
    <p class="landing-progress-summary-intro">Words you’ve practiced, grouped by how well you know them.</p>
    ${buildVocabProgressBarMarkup(counts, total)}
    <div class="landing-progress-summary-action">
      <span>${getVocabDueLabel(dueCount)}</span>
      <button type="button" id="landing-progress-summary-btn">See full stats</button>
    </div>
  `;

  document
    .getElementById("landing-progress-summary-btn")
    ?.addEventListener("click", () => {
      selectType("my-stats");
    });
}

function startDailyQuestFromLanding() {
  selectType("word-game");
  beginTodayPracticeRound();
}

function beginTodayPracticeRound() {
  const progress = getDailyPracticeProgress();

  if (progress >= DAILY_QUESTS.length) {
    beginWordGameRound("session", DAILY_QUEST_ROUND_TARGET, {
      bonusRound: true,
    });
    return;
  }

  beginWordGameRound("session", DAILY_QUEST_ROUND_TARGET, {
    dailyQuestIndex: progress,
    todayPractice: true,
  });
}

function renderWordGameIntro() {
  const dailyState = loadDailyPracticeState();
  const dailyProgress = getDailyPracticeProgress(dailyState);
  const dailyComplete = dailyProgress >= DAILY_QUESTS.length;
  const dailyProgressPercent =
    (dailyProgress / DAILY_QUESTS.length) * 100;
  const activeQuest = DAILY_QUESTS[dailyProgress] || null;
  const queueSummary = getTodayPracticeQueueSummary();
  const reviewLabel =
    queueSummary.due === 1
      ? "1 review due"
      : `${queueSummary.due} reviews due`;
  const nextLabel =
    queueSummary.due > 0
      ? `${reviewLabel} · due words come first`
      : queueSummary.newWords > 0
        ? "You’re caught up · new words are ready"
        : "You’re caught up · review your nearest words";
  const dailyButtonLabel = dailyComplete
    ? "Start bonus round"
    : `Start ${activeQuest.reward} round`;

  setGameContainerHTML(`
    <div class="game-intro-card">
      <section class="game-today-practice game-today-practice--${activeQuest?.reward ?? "complete"}" aria-labelledby="game-today-practice-heading">
        <div class="game-today-practice-heading-row">
          <div>
            <p class="game-today-practice-eyebrow">Recommended</p>
            <h2 class="game-intro-heading" id="game-today-practice-heading">Today’s practice</h2>
          </div>
          <strong class="game-today-practice-count">${dailyProgress} / ${DAILY_QUESTS.length} rounds</strong>
        </div>
        <p class="game-today-practice-note">${nextLabel}</p>
        <div
          class="game-today-practice-progress"
          role="progressbar"
          aria-label="Today’s practice progress"
          aria-valuemin="0"
          aria-valuemax="${DAILY_QUESTS.length}"
          aria-valuenow="${dailyProgress}"
        >
          <span style="width: ${dailyProgressPercent}%"></span>
        </div>
        <button type="button" class="game-today-practice-btn${dailyComplete ? " is-bonus" : ""}" id="game-today-practice-btn">
          ${dailyComplete ? '<i class="fas fa-star" aria-hidden="true"></i>' : ""}
          ${dailyButtonLabel}
        </button>
      </section>

      <section class="game-daily-quests" aria-labelledby="game-daily-quests-heading">
        <div class="game-daily-quests-heading-row">
          <h3 id="game-daily-quests-heading">Daily quests</h3>
          <span>Resets each day</span>
        </div>
        <ol class="game-daily-quest-list">
          ${getDailyQuestMarkup(dailyState)}
        </ol>
      </section>

      <div class="game-intro-divider"><span>Choose another round</span></div>
      <p class="game-intro-subheading">Pick a goal, or keep going for as long as you like.</p>
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
      <button type="button" id="retake-placement-btn" class="placement-retake-link">
        Retake placement test
      </button>
    </div>
  `);

  document
    .getElementById("game-today-practice-btn")
    ?.addEventListener("click", beginTodayPracticeRound);

  document
    .getElementById("retake-placement-btn")
    ?.addEventListener("click", () => {
      window.PlacementTestAPI?.start?.();
    });

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

  if (wordGameIsTodayPracticeRound) {
    const quest = DAILY_QUESTS[wordGameDailyQuestIndex];
    const questName = quest
      ? uppercaseFirstNorwegian(quest.reward)
      : "Daily quest";
    if (correctSoFar >= wordGameSessionTarget && pendingReview > 0) {
      const word = pendingReview === 1 ? "word" : "words";
      return `${questName}: ${wordGameSessionTarget} of ${wordGameSessionTarget} — ${pendingReview} ${word} to review`;
    }
    return `${questName}: Word ${correctSoFar} of ${wordGameSessionTarget}`;
  }

  if (wordGameIsBonusRound) {
    if (correctSoFar >= wordGameSessionTarget && pendingReview > 0) {
      const word = pendingReview === 1 ? "word" : "words";
      return `Bonus: ${wordGameSessionTarget} of ${wordGameSessionTarget} — ${pendingReview} ${word} to review`;
    }
    return `Bonus: Word ${correctSoFar} of ${wordGameSessionTarget}`;
  }

  if (correctSoFar >= wordGameSessionTarget && pendingReview > 0) {
    const word = pendingReview === 1 ? "word" : "words";
    return `${wordGameSessionTarget} of ${wordGameSessionTarget} — ${pendingReview} ${word} to review`;
  }

  return `Word ${correctSoFar} of ${wordGameSessionTarget}`;
}

// Fill width for the session progress bar (see renderStats) — same
// correctSoFar/target fraction the label text is built from, so the two
// always agree.
function getWordGameSessionProgressPercent() {
  if (!wordGameSessionTarget) return 0;

  const correctSoFar = Math.min(
    wordGameSessionCorrectWords.size,
    wordGameSessionTarget,
  );

  return (correctSoFar / wordGameSessionTarget) * 100;
}

// Shows/hides the two static toolbar controls that only make sense while
// an actual question is on screen — "Quit & see stats" and "Report an
// issue" (in .cefr-filter-group, the same spot the CEFR filter used to
// occupy before the word game hid it) — on every screen size. Both are
// only ever created once, so their visibility has to be toggled explicitly
// wherever wordGameRoundActive changes, rather than just following whether
// they got rendered this time. The report button in particular has no
// question to report on outside a round (landing screen, daily quest
// picker, placement test), so it follows the exact same lifecycle.
function updateEndSessionToolbarButtonVisibility() {
  document
    .getElementById("game-end-session-btn")
    ?.classList.toggle("hidden", !wordGameRoundActive);
  document
    .getElementById("game-report-issue")
    ?.classList.toggle("hidden", !wordGameRoundActive);
}

// The dictionary CSV (several MB) is still fetching/parsing for the first
// few seconds after page load. Word Game's own entry screen (the mode
// picker rendered by renderWordGameIntro) needs no dictionary data, so a
// visitor can reach it immediately — but actually starting a round needs
// `results` populated to pick words/distractors from. Mirrors the
// "Loading vocabulary" guard wordList.js and myStats.js already show in
// the same situation, rather than proceeding into selection logic that
// assumes data is there and silently producing an empty/broken round.
function renderWordGameLoadingMessage() {
  setGameContainerHTML(`
    <div class="game-intro-card">
      <h2 class="game-intro-heading">Loading vocabulary</h2>
      <p class="game-today-practice-note">The vocabulary data hasn't finished loading yet — try again in a moment.</p>
    </div>
  `);
}

// Resets round-scoped state (distinct from CEFR level progression, which
// is untouched here and keeps working the same within whichever round is
// active) and kicks off the first question.
function beginWordGameRound(mode, targetWords = 0, options = {}) {
  if (!Array.isArray(results) || results.length === 0) {
    renderWordGameLoadingMessage();
    return;
  }

  wordGameMode = mode;
  wordGameIsTodayPracticeRound = Boolean(options.todayPractice);
  wordGameIsBonusRound =
    !wordGameIsTodayPracticeRound && Boolean(options.bonusRound);
  wordGameTodayPracticeDate = wordGameIsTodayPracticeRound
    ? getDailyPracticeDateKey()
    : null;
  wordGameDailyQuestIndex = wordGameIsTodayPracticeRound
    ? Math.min(
        DAILY_QUESTS.length - 1,
        Math.max(0, Number(options.dailyQuestIndex) || 0),
      )
    : null;
  wordGameEarnedDailyQuest = null;
  wordGameSessionTarget = mode === "session" ? targetWords : 0;
  wordGameSessionCorrectWords = new Set();
  wordGameSessionIntroducedWords = new Set();
  wordGameSessionMissedWords = new Set();
  wordGameSessionQuestionsAnswered = 0;
  wordGameSessionCorrectAnswers = 0;
  wordGameSessionIncorrectAnswers = 0;
  wordGameSessionStartedAt = Date.now();
  wordGameRoundActive = true;
  updateEndSessionToolbarButtonVisibility();

  resetGame();
  startWordGame();
}

function resetTodayPracticeRoundAfterMidnight(wordObj) {
  if (!wordGameIsTodayPracticeRound) return;

  const today = getDailyPracticeDateKey();
  if (wordGameTodayPracticeDate === today) return;

  // A round left open across midnight belongs to the new day's ten-word
  // goal. Reset only round counters; the already-rendered question remains
  // answerable and becomes the first word of the new day.
  wordGameTodayPracticeDate = today;
  wordGameSessionTarget = DAILY_QUEST_ROUND_TARGET;
  wordGameSessionCorrectWords = new Set();
  wordGameSessionIntroducedWords = new Set(wordObj ? [wordObj] : []);
  wordGameSessionMissedWords = new Set();
  wordGameSessionQuestionsAnswered = 0;
  wordGameSessionCorrectAnswers = 0;
  wordGameSessionIncorrectAnswers = 0;
  wordGameSessionStartedAt = Date.now();
  incorrectWordQueue = [];
  recentAnswers = [];
  correctStreak = 0;
}

// Shown when a bounded round hits its word-count target, or when the
// learner manually ends an infinite round via the "Quit & see stats"
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
  const wasTodayPractice = wordGameIsTodayPracticeRound;
  const wasBonusRound = wordGameIsBonusRound;
  const roundWasComplete = isWordGameRoundComplete();
  const earnedDailyQuest =
    wasTodayPractice && roundWasComplete
      ? wordGameEarnedDailyQuest || completeDailyQuestRound()
      : null;

  wordGameRoundActive = false;
  wordGameIsTodayPracticeRound = false;
  wordGameIsBonusRound = false;
  wordGameTodayPracticeDate = null;
  wordGameDailyQuestIndex = null;
  wordGameEarnedDailyQuest = null;
  updateEndSessionToolbarButtonVisibility();

  // Counts toward the day streak only once at least 10 distinct words have
  // been answered correctly this round — the same floor a bounded round's
  // smallest option (10 words) already enforces just by requiring you to
  // finish it. Without this, "Quit & see stats" (available in every mode,
  // including right at the start of an infinite round) would let a single
  // click count as a full day's practice. See recordStreakActivity() in
  // streak.js for the extend/grace/reset rules themselves.
  const streakResult =
    wordGameSessionCorrectWords.size >= 10
      ? window.StreakAPI?.recordActivity?.()
      : null;
  const streakBannerHTML =
    streakResult && streakResult.count > 0
      ? `
    <div class="game-summary-streak">
      <i class="fas fa-fire" aria-hidden="true"></i>
      <span class="game-summary-streak-count">${streakResult.count} day streak</span>
      ${
        streakResult.status === "grace-used"
          ? `<p class="game-summary-streak-note">Your free grace day covered a missed day — streak saved!</p>`
          : ""
      }
    </div>
  `
      : "";

  const missedWords = Array.from(wordGameSessionMissedWords);
  const MAX_MISSED_WORDS_SHOWN = 20;
  // The rows themselves are real Word List / My Words table rows (built by
  // window.WordListAPI.createRow after this markup is inserted, see below)
  // so missed words look and behave exactly like they do on those pages —
  // same word-class/CEFR badges, strength meter, and My Words star.
  const missedWordsHTML =
    missedWords.length > 0
      ? `
    <div class="game-summary-missed">
      <h3 class="game-summary-missed-heading">Words to review</h3>
      <div class="word-list-table-container game-summary-missed-table-container">
        <table class="word-list-table" aria-label="Words to review">
          <tbody id="game-summary-missed-table-body"></tbody>
        </table>
      </div>
      ${
        missedWords.length > MAX_MISSED_WORDS_SHOWN
          ? `<p class="game-summary-missed-more">+ ${missedWords.length - MAX_MISSED_WORDS_SHOWN} more</p>`
          : ""
      }
    </div>
  `
      : "";

  setGameContainerHTML(`
    <div class="game-summary-card">
      <div class="game-summary-icon"><i class="fas fa-trophy" aria-hidden="true"></i></div>
      <h2 class="game-summary-heading">${
        earnedDailyQuest
          ? `${uppercaseFirstNorwegian(earnedDailyQuest.reward)} earned!`
          : wasBonusRound && roundWasComplete
            ? "Bonus round complete!"
          : wasBoundedRound && roundWasComplete
            ? "Round complete!"
            : "Nice work!"
      }</h2>
      ${streakBannerHTML}
      ${
        earnedDailyQuest
          ? `<div class="game-summary-gems" aria-label="Daily quests complete">
              <span class="game-summary-gem">
                <span class="game-daily-quest-gem game-daily-quest-gem--${earnedDailyQuest.reward}" aria-hidden="true"></span>
                <span>${uppercaseFirstNorwegian(earnedDailyQuest.reward)}</span>
              </span>
            </div>`
          : ""
      }
      <div class="game-summary-stats">
        <div class="game-summary-stat">
          <p class="game-summary-stat-value">${wordGameSessionCorrectWords.size}</p>
          <p class="game-summary-stat-label">Words practiced</p>
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
      ${missedWordsHTML}
      <button type="button" class="game-summary-primary-btn" id="game-summary-restart-btn">
        Start a new round
      </button>
    </div>
  `);

  // Built as real DOM rows via WordListAPI rather than a template string,
  // since createWordListRow() returns <tr> elements (with click-to-open
  // and My Words star listeners already wired up), not HTML text.
  const missedWordsTableBody = document.getElementById(
    "game-summary-missed-table-body",
  );
  if (missedWordsTableBody && window.WordListAPI?.createRow) {
    const fragment = document.createDocumentFragment();
    missedWords.slice(0, MAX_MISSED_WORDS_SHOWN).forEach((wordObj) => {
      fragment.appendChild(window.WordListAPI.createRow(wordObj));
    });
    missedWordsTableBody.appendChild(fragment);
  }

  document
    .getElementById("game-summary-restart-btn")
    ?.addEventListener("click", () => {
      renderWordGameIntro();
    });

  // A completed/ended round is the first moment a signed-out visitor has
  // something worth protecting (a streak, saved word progress) — see
  // maybeShowSignInNudge() in myWordsAuth.js, which no-ops after the first
  // time it's ever shown, or if the visitor is already signed in.
  window.SignInNudgeAPI?.maybeShow?.();
}

async function startWordGame() {
  const searchContainerInner = document.getElementById(
    "search-container-inner",
  ); // The container to update
  const searchBarWrapper = document.getElementById("search-bar-wrapper");
  const randomBtn = document.getElementById("my-words-nav-btn");

  // Filter containers for POS and Genre
  const posFilterContainer = document.querySelector(".pos-filter");
  const genreFilterContainer = document.getElementById("genre-filter"); // Get the Genre filter container
  // The shared CEFR filter/lock control is browse-only in Word List and
  // Stories — the word game itself has no CEFR control at all, since
  // ability is an invisible, continuously-adaptive estimate rather than
  // something the learner sets directly. Hidden here rather than merely
  // disabled so it isn't shown at all while in this view. Note: this
  // targets .cefr-filter itself, NOT its parent .cefr-filter-group — the
  // group also contains #game-end-session-btn and #game-report-issue,
  // which the word game does need and manages via their own visibility
  // logic (updateEndSessionToolbarButtonVisibility() and the
  // word-game-active CSS rule respectively).
  const cefrFilter = document.querySelector(".cefr-filter");
  const gameEnglishFilterContainer = document.querySelector(
    ".game-english-filter",
  );

  // Filter dropdowns for POS and Genre
  const posSelect = document.getElementById("pos-select");
  const gameEnglishSelect = document.getElementById("game-english-select");

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

  if (cefrFilter) cefrFilter.style.display = "none";

  // No round chosen yet (fresh entry into the word game, or just finished
  // a round) — show the mode picker instead of fetching a question. Once
  // beginWordGameRound() sets wordGameRoundActive, it calls this function
  // again itself to actually fetch the first question.
  if (!wordGameRoundActive) {
    if (!placementCompleted) {
      window.PlacementTestAPI?.start?.();
    } else {
      renderWordGameIntro();
    }
    return;
  }

  // Cloze questions use synchronous exact-form lookups once a question is
  // selected. Resolve the compact official snapshot once up front; a pending
  // background preload is reused, and a failed load simply makes cloze fall
  // back to the ordinary flashcard format.
  await window.Inflections?.preload();
  if (!gameActive || !wordGameRoundActive) return;

  // A miss enters an explicit short-term relearning queue. Its availability
  // is measured in intervening answered questions, while WordStrengthAPI's
  // timestamped record independently ensures it remains due across sessions.
  const firstWordInQueue = incorrectWordQueue.find(
    (queued) =>
      wordGameSessionQuestionsAnswered >= queued.availableAfterQuestion,
  );

  if (firstWordInQueue) {
    currentWordQueueType = "relearning";
    // Play the popChime when reintroducing an incorrect word
    popChime.currentTime = 0; // Reset audio to the beginning
    popChime.play(); // Play the pop sound

    // Reintroduce the word
    currentWord = firstWordInQueue.wordObj.ord;
    correctTranslation = firstWordInQueue.wordObj.engelsk;
    firstWordInQueue.shown = true;

    if (firstWordInQueue.forceTypedRetry) {
      const randomWordObj = firstWordInQueue.wordObj;
      if (firstWordInQueue.wasCloze) {
        const clozeTarget = await findClozeTarget(
          randomWordObj,
          firstWordInQueue.clozedForm,
        );
        if (clozeTarget) {
          renderClozeGameUI(
            randomWordObj,
            [],
            firstWordInQueue.clozedForm,
            true,
            clozeTarget,
            true,
          );
        } else {
          renderWordGameUI(randomWordObj, [], true, "typed-reverse");
        }
      } else {
        renderWordGameUI(randomWordObj, [], true, "typed-reverse");
      }
      renderStats();
      return;
    }

    if (firstWordInQueue.wasCloze) {
      const randomWordObj = firstWordInQueue.wordObj;

      /*
       * Locate the same surface form that was used in the
       * original cloze question.
       */
      const clozeTarget = await findClozeTarget(
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
        const distractors = generateClozeDistractors(
          randomWordObj,
          clozeTarget,
        );
        if (distractors.length < 3) {
          renderClozeGameUI(
            randomWordObj,
            [],
            firstWordInQueue.clozedForm,
            true,
            null,
          );
          return;
        }

        const { correctChoice, choices } = prepareClozeChoices(
          randomWordObj,
          clozeTarget,
          distractors,
        );
        if (choices.length < 4) {
          renderClozeGameUI(
            randomWordObj,
            [],
            firstWordInQueue.clozedForm,
            true,
            null,
          );
          return;
        }

        renderClozeGameUI(
          randomWordObj,
          choices,
          correctChoice,
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

    // Render the updated stats box
    renderStats();
    return;
  }

  // Defensive fallback only — startWordGame() routes to the placement test
  // before any question is ever fetched without an ability estimate.
  if (abilityScore === null) {
    abilityScore = CEFR_DIFFICULTY_ANCHOR.A1;
    placementCompleted = false;
    saveAbilityState();
  }

  // Fetch a random word that respects CEFR and POS filters
  const randomWordObj = await fetchRandomWord();

  // If no words match the filters, stop the game
  if (!randomWordObj) return;

  currentWord = randomWordObj;
  correctTranslation = randomWordObj.engelsk;

  const structuredQuestionMode = wordGameIsTodayPracticeRound
    ? getDailyQuestQuestionMode(
        wordGameDailyQuestIndex,
        wordGameSessionQuestionsAnswered,
        randomWordObj.wordAudio === "X",
      )
    : wordGameIsBonusRound
      ? getBonusRoundQuestionMode(
          Math.max(0, wordGameSessionIntroducedWords.size - 1),
          randomWordObj.wordAudio === "X",
        )
      : null;
  const forceTypedReverse = structuredQuestionMode === "typed-reverse";
  const isClozeQuestion =
    structuredQuestionMode === "cloze" ||
    (structuredQuestionMode === null && Math.random() < 0.5);
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
    (structuredQuestionMode === "listening" ||
      (structuredQuestionMode === null &&
        Math.random() <
          (interpolateByAbility(abilityScore, LISTENING_PROBABILITY) ?? 0.25)));
  // Only applies to the non-cloze, non-listening remainder — see
  // REVERSE_FLASHCARD_PROBABILITY above for why this scales with level
  // instead of being a flat coin flip.
  const isReverseQuestion =
    !isClozeQuestion &&
    !isListeningQuestion &&
    (structuredQuestionMode === "reverse" ||
      forceTypedReverse ||
      (structuredQuestionMode === null &&
        Math.random() <
          (interpolateByAbility(abilityScore, REVERSE_FLASHCARD_PROBABILITY) ??
            0.25)));

  // Fetch incorrect translations from the same band as the word actually
  // being asked about (not the learner's own ability) — distractors need to
  // be plausible peers of the target word, and since word selection is no
  // longer confined to a single CEFR band, those two are no longer the same
  // thing.
  const incorrectTranslations = fetchIncorrectTranslations(
    randomWordObj.gender,
    correctTranslation,
    randomWordObj.CEFR,
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
    const clozeTarget = await findClozeTarget(randomWordObj);

    if (!clozeTarget) {
      console.warn(
        "No reliable cloze target was found. Falling back to flashcard.",
        randomWordObj,
      );

      renderWordGameUI(randomWordObj, uniqueDisplayedTranslations, false);

      return;
    }

    if (
      getGameSentenceTranslation(randomWordObj, clozeTarget.sentenceIndex) &&
      shouldUseTypedRecall(randomWordObj, "cloze")
    ) {
      renderClozeGameUI(
        randomWordObj,
        [],
        formatCorrectClozeChoice(randomWordObj, clozeTarget),
        false,
        clozeTarget,
        true,
      );
      return;
    }

    const distractors = generateClozeDistractors(randomWordObj, clozeTarget);
    if (distractors.length < 3) {
      console.warn(
        "Not enough same-slot official distractors were found. Falling back to flashcard.",
        randomWordObj,
      );
      renderWordGameUI(randomWordObj, uniqueDisplayedTranslations, false);
      return;
    }

    const { correctChoice, choices } = prepareClozeChoices(
      randomWordObj,
      clozeTarget,
      distractors,
    );
    if (choices.length < 4) {
      renderWordGameUI(randomWordObj, uniqueDisplayedTranslations, false);
      return;
    }

    renderClozeGameUI(
      randomWordObj,
      choices,
      correctChoice,
      false,
      clozeTarget,
    );
  } else if (isReverseQuestion) {
    if (
      getGameSentenceTranslation(randomWordObj, 0) &&
      (forceTypedReverse || shouldUseTypedRecall(randomWordObj, "reverse"))
    ) {
      renderWordGameUI(randomWordObj, [], false, "typed-reverse");
      return;
    }

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

function ensureUniqueDisplayedValues(translations, preserveFullValue = false) {
  const uniqueTranslations = [];
  const displayedSet = new Set();

  translations.forEach((translation) => {
    const displayedPart = preserveFullValue
      ? normalizeGameWhitespace(translation)
      : getDisplayedAnswer(translation);
    const identity = normalizeGameAnswer(displayedPart);
    if (identity && !displayedSet.has(identity)) {
      displayedSet.add(identity);
      uniqueTranslations.push(translation);
    }
  });

  return uniqueTranslations;
}

function fetchIncorrectTranslations(gender, correctTranslation, currentCEFR) {
  const correctDisplayedTranslation = getDisplayedAnswer(correctTranslation);
  const correctIdentity = normalizeGameAnswer(correctDisplayedTranslation);
  const isCapitalized = startsWithUppercaseLetter(correctDisplayedTranslation);
  const targetWordClass = WordClass.getWordClass(gender);
  const displayedTranslationsSet = new Set([correctIdentity]);
  const incorrectTranslations = [];

  const collect = (pool) => {
    for (const entry of shuffleArray([...pool])) {
      if (incorrectTranslations.length >= 3) return;
      const displayedTranslation = getDisplayedAnswer(entry.engelsk);
      const identity = normalizeGameAnswer(displayedTranslation);
      if (!identity || displayedTranslationsSet.has(identity)) continue;
      incorrectTranslations.push(entry.engelsk);
      displayedTranslationsSet.add(identity);
    }
  };

  const eligible = results.filter((entry) => {
    const displayedTranslation = getDisplayedAnswer(entry?.engelsk);
    return (
      displayedTranslation &&
      normalizeGameAnswer(displayedTranslation) !== correctIdentity &&
      startsWithUppercaseLetter(displayedTranslation) === isCapitalized &&
      !noRandom.includes(normalizeGameAnswer(entry.ord))
    );
  });

  collect(
    eligible.filter(
      (entry) =>
        entry.CEFR === currentCEFR &&
        WordClass.hasCompatibleGender(gender, entry.gender),
    ),
  );
  if (incorrectTranslations.length < 3) {
    collect(
      eligible.filter((entry) =>
        WordClass.hasCompatibleGender(gender, entry.gender),
      ),
    );
  }
  if (incorrectTranslations.length < 3) {
    collect(
      eligible.filter(
        (entry) => WordClass.getWordClass(entry.gender) === targetWordClass,
      ),
    );
  }
  if (incorrectTranslations.length < 3) collect(eligible);

  return incorrectTranslations;
}

function fetchIncorrectNorwegianWords(correctWord, CEFR, gender) {
  const correctDisplay = getPrimaryNorwegianForm(correctWord);
  const correctIdentity = normalizeGameAnswer(correctDisplay);
  const correctIsCapitalized = startsWithUppercaseLetter(correctDisplay);
  const targetWordClass = WordClass.getWordClass(gender);

  const collect = (pool, seen, incorrectWords) => {
    for (const entry of shuffleArray([...pool])) {
      if (incorrectWords.length >= 3) return;
      const word = getPrimaryNorwegianForm(entry);
      const identity = normalizeGameAnswer(word);
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      incorrectWords.push(word);
    }
  };

  const seen = new Set([correctIdentity]);
  const incorrectWords = [];
  const eligible = results.filter((entry) => {
    const word = getPrimaryNorwegianForm(entry);
    return (
      word &&
      normalizeGameAnswer(word) !== correctIdentity &&
      !noRandom.includes(normalizeGameAnswer(entry.ord))
    );
  });

  collect(
    eligible.filter(
      (entry) =>
        entry.CEFR === CEFR &&
        WordClass.hasCompatibleGender(gender, entry.gender) &&
        startsWithUppercaseLetter(getPrimaryNorwegianForm(entry)) ===
          correctIsCapitalized,
    ),
    seen,
    incorrectWords,
  );
  if (incorrectWords.length < 3) {
    collect(
      eligible.filter(
        (entry) =>
          WordClass.hasCompatibleGender(gender, entry.gender) &&
          startsWithUppercaseLetter(getPrimaryNorwegianForm(entry)) ===
            correctIsCapitalized,
      ),
      seen,
      incorrectWords,
    );
  }
  if (incorrectWords.length < 3) {
    collect(
      eligible.filter((entry) =>
        WordClass.hasCompatibleGender(gender, entry.gender),
      ),
      seen,
      incorrectWords,
    );
  }
  if (incorrectWords.length < 3) {
    collect(
      eligible.filter(
        (entry) => WordClass.getWordClass(entry.gender) === targetWordClass,
      ),
      seen,
      incorrectWords,
    );
  }
  if (incorrectWords.length < 3) collect(eligible, seen, incorrectWords);

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

// States what a question is asking for, since a bare word/sentence plus
// four choices didn't say what to do with them.
function getGameInstructionText(mode) {
  switch (mode) {
    case "typed-reverse":
      return "Type the Norwegian word";
    case "typed-cloze":
      return "Type the word that completes the sentence";
    case "reverse":
      return "Choose the Norwegian word";
    case "listening":
      return "Listen and choose the meaning";
    case "cloze":
      return "Choose the word that completes the sentence";
    default:
      return "Choose the English meaning";
  }
}

function getGamePromptLengthClass(value) {
  const length = Array.from(normalizeGameWhitespace(value)).length;
  if (length >= 160) return "game-prompt-extra-long";
  if (length >= 90) return "game-prompt-long";
  // Cloze sentences routinely land well under the 90-char "long" cutoff
  // above (full words/phrases, not just single vocab words) but still
  // overflowed the card at the default size — this tier catches them.
  if (length >= 45) return "game-prompt-medium";
  return "";
}

function getTypedAnswerMarkup(wordId) {
  return `
    <div class="game-grid game-typed-grid">
      <form class="game-typed-answer-form" data-id="${wordId}">
        <div class="game-typed-answer-row">
          <input
            id="game-typed-answer-input"
            class="game-typed-answer-input"
            type="text"
            lang="nb"
            aria-label="Your answer in Norwegian"
            autocomplete="off"
            autocapitalize="sentences"
            autocorrect="off"
            spellcheck="false"
            enterkeyhint="done"
            placeholder="Type in Norwegian"
          >
          <button class="game-typed-submit" type="submit">Check</button>
        </div>
      </form>
    </div>
  `;
}

function getGameAnswerStatusMarkup() {
  return '<p id="game-answer-status" class="game-answer-status" role="status" aria-live="polite"></p>';
}

function attachTypedAnswerForm(
  wordObj,
  {
    isCloze = false,
    clozeSentence = "",
    isReverse = false,
    exampleSentenceIndex = null,
  } = {},
) {
  const form = document.querySelector(".game-typed-answer-form");
  const input = document.getElementById("game-typed-answer-input");
  if (!form || !input) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const selectedAnswer = normalizeGameWhitespace(input.value);
    if (!selectedAnswer || !gameActive) {
      input.focus();
      return;
    }

    handleTranslationClick(
      selectedAnswer,
      wordObj,
      isCloze,
      clozeSentence,
      isReverse,
      false,
      getTypedAcceptedAnswers(wordObj, isCloze, correctTranslation),
      exampleSentenceIndex,
      true,
    );
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      if (form.classList.contains("is-answered")) {
        const nextButton = document.getElementById("game-next-word-button");
        if (nextButton && !nextButton.disabled) {
          nextButton.click();
        }
        return;
      }
      form.requestSubmit();
    }
  });

  // This is the only control needed to answer a typed question. Focusing it
  // avoids an otherwise unnecessary click while preventScroll keeps the page
  // visually still as questions change.
  requestAnimationFrame(() => input.focus({ preventScroll: true }));
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
  const isTyped = mode === "typed-reverse";
  const isReverse = mode === "reverse" || isTyped;
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
    correctTranslation = getPrimaryNorwegianForm(wordObj);
  }

  // Split the word at the comma and use the first part. Listening shows
  // no word text at all pre-answer (see the prompt markup below) — this
  // is only used post-answer once revealListeningWordText swaps it in.
  let displayedWord = isReverse
    ? getDisplayedAnswer(wordObj.engelsk)
    : getPrimaryNorwegianForm(wordObj);
  const promptLengthClass = getGamePromptLengthClass(displayedWord);
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

        <p class="game-instruction">${getGameInstructionText(mode)}</p>
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
              class="game-word${isReverse ? "" : " game-word-audio"}${promptLengthClass ? ` ${promptLengthClass}` : ""}"
              ${
                isReverse
                  ? ""
                  : `role="button"
              tabindex="0"
              aria-label="${escapeGameHTML(isListening ? "Play word audio" : `Play pronunciation of ${displayedWord}`)}"
              title="${isListening ? "Play word audio" : "Play pronunciation"}"`
              }
            >
                ${
                  isListening
                    ? '<i class="fas fa-volume-up game-listening-icon" aria-hidden="true"></i>'
                    : `<h2>${escapeGameHTML(displayedWord)}</h2>`
                }
            </div>
            <div class="game-cefr-spacer"></div>
        </div>

        <!-- Answer Section -->
        ${
          isTyped
            ? getTypedAnswerMarkup(wordId)
            : `<div class="game-grid">
            ${translations
              .map(
                (translation, index) => `
                <button type="button" class="game-translation-card" lang="${isReverse ? "nb" : "en"}" data-id="${wordId}" data-index="${index}" aria-keyshortcuts="${index + 1}">
                    ${escapeGameHTML(getDisplayedAnswer(translation))}
                </button>
            `,
              )
              .join("")}
        </div>`
        }
        ${getGameAnswerStatusMarkup()}
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

  if (isTyped) {
    attachTypedAnswerForm(wordObj, {
      isReverse: true,
      exampleSentenceIndex: 0,
    });
  } else {
    // Native buttons preserve the exact card presentation while adding Tab,
    // Enter, Space, and screen-reader behavior without custom key emulation.
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
  }

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
  useTypedRecall = false,
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
  const promptLengthClass = getGamePromptLengthClass(sentenceWithBlank);

  setGameContainerHTML(`
    <!-- Session Stats Section -->
    <div class="game-stats-content" id="game-session-stats">
      <!-- Stats will be updated dynamically in renderStats() -->
    </div>
  
    <p class="game-instruction">${getGameInstructionText(useTypedRecall ? "typed-cloze" : "cloze")}</p>
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

      <div class="game-word${promptLengthClass ? ` ${promptLengthClass}` : ""}">
      <h2 id="cloze-sentence">${escapeGameHTML(sentenceWithBlank)}</h2>
      </div>
  
      <div class="game-cefr-spacer"></div>
    </div>

    <!-- Answer Section -->
    ${
      useTypedRecall
        ? getTypedAnswerMarkup(wordId)
        : `<div class="game-grid">
      ${translations
        .map(
          (translation, index) => `
          <button type="button" class="game-translation-card" lang="nb" data-id="${wordId}" data-index="${index}" aria-keyshortcuts="${index + 1}">
            ${escapeGameHTML(translation)}
          </button>
        `,
        )
        .join("")}
    </div>`
    }
    ${getGameAnswerStatusMarkup()}
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

  if (useTypedRecall) {
    attachTypedAnswerForm(wordObj, {
      isCloze: true,
      clozeSentence: clozeTarget.sentence,
      exampleSentenceIndex: clozeTarget.sentenceIndex,
    });
  } else {
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
          false,
          false,
          [],
          clozeTarget.sentenceIndex,
        );
      });
    });
  }

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
  // Answer choices are disabled as soon as they are graded. Re-enable just
  // the correct reverse-answer button when it becomes an audio control.
  if (element instanceof HTMLButtonElement) {
    element.disabled = false;
  }
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
    // A typed-answer field owns Enter after grading so it can advance to the
    // next question. Its earlier keydown handler prevents the event; respect
    // that instead of also replaying pronunciation from this audio control.
    if (event.defaultPrevented) return;
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
  const correctCardElement = document.querySelector(
    ".game-correct-card, .game-typed-answer-form.is-answered .game-typed-answer-input",
  );
  if (
    !correctCardElement ||
    correctCardElement.classList.contains("game-word-audio")
  ) {
    return;
  }

  const displayedWord = getPrimaryNorwegianForm(wordObj);
  if (correctCardElement instanceof HTMLInputElement) {
    const displayedAnswer = normalizeGameAnswer(correctCardElement.value);
    const entryForms = new Set(
      getNorwegianEntryVariants(wordObj).map(normalizeGameAnswer),
    );
    // A same-gender dictionary synonym can be accepted for typed recall.
    // Do not make that synonym field play the target lemma's different audio.
    if (!entryForms.has(displayedAnswer)) return;
  }

  makeAudioReplayable(
    correctCardElement,
    `Play pronunciation of ${displayedWord}`,
    () => {
      stopAllAudio();
      playWordAudio(wordObj);
    },
  );
}

function updateTypedAnswerFeedback(isCorrect, correctAnswer) {
  const form = document.querySelector(".game-typed-answer-form");
  const input = document.getElementById("game-typed-answer-input");
  const submit = form?.querySelector(".game-typed-submit");
  if (!form || !input) return;

  // Keep the answer in the same visual card the learner typed into. On a
  // miss, replace their text with the correction instead of growing a second
  // "Correct answer" row underneath and shifting the Next button downward.
  if (!isCorrect) {
    input.value = correctAnswer;
  }
  input.readOnly = true;
  if (submit) submit.disabled = true;
  input.setAttribute("aria-invalid", String(!isCorrect));
  input.setAttribute(
    "aria-label",
    isCorrect ? "Correct answer" : `Correct answer: ${correctAnswer}`,
  );
  form.classList.add("is-answered");
  form.classList.toggle("is-correct", isCorrect);
  form.classList.toggle("is-incorrect", !isCorrect);
}

function announceGameAnswer(isCorrect, correctAnswer) {
  const status = document.getElementById("game-answer-status");
  if (!status) return;
  status.textContent = isCorrect
    ? "Correct"
    : `Incorrect. Correct answer: ${correctAnswer}`;
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

  const displayedWord = getPrimaryNorwegianForm(wordObj);

  promptElement.innerHTML = `<h2>${escapeGameHTML(displayedWord)}</h2>`;
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
  acceptedAnswers = [],
  exampleSentenceIndex = null,
  wasTyped = false,
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
    card.disabled = true;
  });

  // Forward/reverse cards deliberately display only the first comma-separated
  // dictionary alternative. A cloze answer, however, may itself contain a
  // comma (for example a wildcard expression spanning a clause), so preserve
  // the complete surface form there.
  const correctTranslationPart = isCloze
    ? normalizeGameWhitespace(correctTranslation)
    : getDisplayedAnswer(correctTranslation);
  const selectedTranslationPart = isCloze
    ? normalizeGameWhitespace(selectedTranslation)
    : getDisplayedAnswer(selectedTranslation);
  const acceptedAnswerIdentities = new Set(
    acceptedAnswers.map(normalizeGameAnswer).filter(Boolean),
  );
  const answerWasCorrect =
    acceptedAnswerIdentities.size > 0
      ? acceptedAnswerIdentities.has(normalizeGameAnswer(selectedTranslationPart))
      : selectedTranslationPart === correctTranslationPart;

  resetTodayPracticeRoundAfterMidnight(wordObj);
  totalQuestions++; // Increment total questions for this level
  const { exampleSentence, sentenceTranslation } =
    await fetchExampleSentence(wordObj, exampleSentenceIndex);
  announceGameAnswer(answerWasCorrect, correctTranslationPart);
  const activeQueueEntry = incorrectWordQueue.find(
    (queued) => queued.wordObj === wordObj && queued.shown,
  );

  if (answerWasCorrect) {
    playSentenceAudio(exampleSentence);
    goodChime.currentTime = 0; // Reset audio to the beginning
    goodChime.play(); // Play the chime sound when correct
    // Mark the selected card as green (correct)
    cards.forEach((card) => {
      const cardText = isCloze
        ? normalizeGameWhitespace(card.innerText)
        : getDisplayedAnswer(card.innerText);
      if (cardText === selectedTranslationPart) {
        card.classList.add("game-correct-card");
      } else if (cardText !== correctTranslationPart) {
        card.classList.add("distractor-muted");
      }
    });
    correctCount++; // Increment correct count globally
    correctStreak++; // Increment the streak
    correctLevelAnswers++; // Increment correct count for this level
    updateRecentAnswers(true, wordObj); // Track this correct answer
    window.WordStrengthAPI?.recordResult?.(wordObj, true, {
      // A bounded-round filler or voluntary early review is not a spaced
      // retrieval and therefore must not lengthen the durable interval.
      credit: !["session-filler", "scheduled"].includes(
        currentWordQueueType,
      ) && !(activeQueueEntry?.requiresTypedMastery && !wasTyped),
    });
    if (wordGameRoundActive) {
      wordGameSessionQuestionsAnswered++;
      wordGameSessionCorrectAnswers++;
      wordGameSessionCorrectWords.add(wordObj);
    }
    if (isCloze) {
      completeClozeSentence(clozeSentence);
    }
    updateTypedAnswerFeedback(true, correctTranslationPart);
    if (isReverse) {
      revealReverseWordAudio(wordObj);
    }
    if (isListening) {
      revealListeningWordText(wordObj);
    }

    // If the word was in the review queue and the user answered it correctly, remove it
    const indexInQueue = activeQueueEntry
      ? incorrectWordQueue.indexOf(activeQueueEntry)
      : -1;
    let removedFromQueue = false;
    const relearningResult = applyCorrectRelearningResult(
      activeQueueEntry,
      wasTyped,
      wordGameSessionQuestionsAnswered,
    );
    if (relearningResult === "remove" && indexInQueue !== -1) {
      incorrectWordQueue.splice(indexInQueue, 1);
      removedFromQueue = true;
    }
    // Trigger the streak banner if the user reaches a streak. Suppressed
    // in session mode — a 10-streak is barely reachable in a small bounded
    // round (often only hittable by finishing flawlessly, at which point
    // it'd fire in the same instant as "round complete"), so the round
    // summary is the one celebration moment there instead.
    if (wordGameMode !== "session" && correctStreak % 10 === 0) {
      showBanner("streak", correctStreak);
    }
    // Trigger the cleared practice words banner ONLY if the queue is now empty
    if (incorrectWordQueue.length === 0 && removedFromQueue) {
      showBanner("clearedPracticeWords"); // Show the cleared practice words banner
    }
  } else {
    playSentenceAudio(exampleSentence);
    badChime.currentTime = 0; // Reset audio to the beginning
    badChime.play(); // Play the chime sound when incorrect
    // Mark the incorrect card as red
    cards.forEach((card) => {
      const cardText = isCloze
        ? normalizeGameWhitespace(card.innerText)
        : getDisplayedAnswer(card.innerText);

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
    updateRecentAnswers(false, wordObj); // Track this correct answer
    window.WordStrengthAPI?.recordResult?.(wordObj, false);
    if (wordGameRoundActive) {
      wordGameSessionQuestionsAnswered++;
      wordGameSessionIncorrectAnswers++;
      wordGameSessionMissedWords.add(wordObj);
    }

    if (isCloze) {
      completeClozeSentence(clozeSentence);
    }
    updateTypedAnswerFeedback(false, correctTranslationPart);
    if (isReverse) {
      revealReverseWordAudio(wordObj);
    }
    if (isListening) {
      revealListeningWordText(wordObj);
    }

    // Keep the durable lapse in WordStrengthAPI and also schedule a short
    // retry after intervening questions in this active round. Repeat misses
    // get a modestly longer gap without blocking other ready queue entries.
    const existingQueueEntry = incorrectWordQueue.find(
      (incorrectWord) => incorrectWord.wordObj === wordObj,
    );
    const baseGap = getWordGameReintroduceThreshold();

    if (existingQueueEntry) {
      existingQueueEntry.reviewAttempts += 1;
      existingQueueEntry.availableAfterQuestion =
        wordGameSessionQuestionsAnswered +
        baseGap * Math.min(2, existingQueueEntry.reviewAttempts);
      existingQueueEntry.shown = false;
      existingQueueEntry.wasCloze = isCloze;
      existingQueueEntry.wasReverse = isReverse;
      existingQueueEntry.wasListening = isListening;
      existingQueueEntry.clozedForm = isCloze ? correctTranslation : null;
      existingQueueEntry.requiresTypedMastery =
        existingQueueEntry.requiresTypedMastery || wasTyped;
      // Once the learner has passed the recognition scaffold, any further
      // miss happened on the required typed retry, so keep retrying typing.
      existingQueueEntry.forceTypedRetry =
        existingQueueEntry.requiresTypedMastery &&
        existingQueueEntry.forceTypedRetry;
    } else {
      incorrectWordQueue.push({
        wordObj,
        availableAfterQuestion:
          wordGameSessionQuestionsAnswered + baseGap,
        reviewAttempts: 1,
        shown: false,
        wasCloze: isCloze,
        wasReverse: isReverse,
        wasListening: isListening,
        clozedForm: isCloze ? correctTranslation : null,
        requiresTypedMastery: wasTyped,
        forceTypedRetry: false,
      });
    }
  }

  enableGameControls();

  // If this answer just finished a bounded round, relabel the button so
  // it's clear the next click leads to results, not another question —
  // the actual branching happens in the click handler itself (see
  // attachGameControls), checked fresh at click time.
  const roundIsComplete = isWordGameRoundComplete();
  if (
    roundIsComplete &&
    wordGameIsTodayPracticeRound &&
    !wordGameEarnedDailyQuest
  ) {
    wordGameEarnedDailyQuest = completeDailyQuestRound();
  }
  if (roundIsComplete) {
    const nextButton = document.getElementById("game-next-word-button");
    if (nextButton) {
      nextButton.textContent = "See Results";
    }
  }

  // Update the stats after the answer
  renderStats();

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

async function fetchExampleSentence(wordObj, preferredIndex = null) {
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

  if (
    Number.isInteger(preferredIndex) &&
    preferredIndex >= 0 &&
    preferredIndex < exampleSentences.length
  ) {
    return {
      exampleSentence: exampleSentences[preferredIndex],
      sentenceTranslation: translations[preferredIndex] || "",
    };
  }

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

function getEligibleGameWords(
  selectedPOS,
  { ignorePrevious = false } = {},
) {
  const queuedForReintroduction = new Set(
    incorrectWordQueue.map((queued) => queued.wordObj),
  );
  const dailyExercise = wordGameIsTodayPracticeRound
    ? DAILY_QUESTS[wordGameDailyQuestIndex]?.exercise
    : null;
  const bonusExercise = wordGameIsBonusRound
    ? getBonusRoundQuestionMode(wordGameSessionIntroducedWords.size, true)
    : null;

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

    // No CEFR gate here by design: word selection is a smooth,
    // ability-proximity-weighted draw (see getGameWordWeight), not a hard
    // per-level cutoff. A word far from the learner's ability isn't
    // excluded outright, just made vanishingly unlikely to be drawn.

    if (noRandom.includes(normalizeGameAnswer(norwegianWord))) {
      return false;
    }

    /*
     * Avoid displaying the same spelling twice in a row.
     */
    if (!ignorePrevious && norwegianWord === previousWord) {
      return false;
    }

    if (
      (dailyExercise === "context" || bonusExercise === "cloze") &&
      (!String(entry?.eksempel ?? "").trim() ||
        BANNED_WORD_CLASSES.some((wordClass) =>
          gender.toLowerCase().startsWith(wordClass),
        ))
    ) {
      return false;
    }

    if (bonusExercise === "listening" && entry.wordAudio !== "X") {
      return false;
    }

    // Typed bonus questions always include the English sentence, matching
    // ordinary productive-recall questions. Do not select an entry that
    // would have to degrade into a context-free typing prompt.
    if (
      bonusExercise === "typed-reverse" &&
      !getGameSentenceTranslation(entry, 0)
    ) {
      return false;
    }

    // A bounded round promises N distinct words. Scheduler state already
    // prevents ordinary due/new repeats after an answer; this also excludes
    // early scheduled reviews already introduced during the same round.
    if (
      wordGameMode === "session" &&
      wordGameSessionIntroducedWords.size < wordGameSessionTarget &&
      wordGameSessionIntroducedWords.has(entry)
    ) {
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
      const isNoun = WordClass.isNounGender(normalizedGender);

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
    const displayedNorwegian = normalizeGameAnswer(
      getPrimaryNorwegianForm(norwegianWord),
    );

    const displayedEnglish = normalizeGameAnswer(
      getDisplayedAnswer(englishTranslation),
    );

    return displayedNorwegian !== displayedEnglish;
  });
}

const STRENGTH_WEIGHT_CEILING = 6; // WordStrengthAPI values are 0-5
const STRENGTH_WEIGHT_EXPONENT = 2; // squared — retune here if the curve needs adjusting

// The scheduler first chooses an explicit queue (relearning, due, new, or
// scheduled fallback). Strength and My Words then influence only the draw
// *within that queue*, so an undrilled new word can no longer jump ahead of
// an overdue review merely because its scalar weight is larger.
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

// A Gaussian falloff centered on the learner's ability, in word-difficulty
// units — this is what stands in for the old hard CEFR-level cutoff. A word
// right at the estimated ability gets full weight; one further away fades
// out smoothly rather than being excluded outright.
function getAbilityProximityWeight(entry) {
  if (abilityScore === null) return 1;

  const distance = getWordDifficultyAnchor(entry) - abilityScore;
  return Math.exp(
    -(distance * distance) / (2 * ABILITY_PROXIMITY_SIGMA * ABILITY_PROXIMITY_SIGMA),
  );
}

function getGameWordWeight(entry) {
  const strength = window.WordStrengthAPI?.get?.(entry) ?? 0;
  const strengthWeight = Math.pow(
    STRENGTH_WEIGHT_CEILING - strength,
    STRENGTH_WEIGHT_EXPONENT,
  );

  return strengthWeight * getAbilityProximityWeight(entry);
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

function buildGameWordQueues(eligibleEntries, now = Date.now()) {
  const queues = {
    relearning: [],
    due: [],
    new: [],
    scheduled: [],
  };

  for (const entry of eligibleEntries) {
    const queue =
      window.WordStrengthAPI?.getSnapshot?.(entry, now)?.queue ?? "new";

    queues[queue]?.push(entry);
  }

  return queues;
}

function getNextGameQueueName(queues) {
  return ["relearning", "due", "new", "scheduled"].find(
    (queueName) => queues[queueName]?.length > 0,
  );
}

// When somebody deliberately starts a round with no due or new material,
// let them practice rather than showing an empty screen. Only the nearest
// upcoming reviews are considered, minimizing how far the scheduler is
// pulled forward; correct answers in this fallback do not extend intervals.
function pickNearestScheduledGameWord(entries) {
  const nearest = entries
    .map((entry) => ({
      entry,
      dueAt:
        window.WordStrengthAPI?.getRecord?.(entry)?.dueAt ??
        Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) => left.dueAt - right.dueAt)
    .slice(0, Math.min(50, entries.length))
    .map(({ entry }) => entry);

  return pickPrioritizedGameWord(nearest);
}

// Once a session round has introduced its full target word count, every
// further "new question" slot reviews one already-introduced word instead
// of pulling a brand-new one from the dictionary — this is what keeps a
// round of N to exactly N distinct words (see fetchRandomWord). Prefers
// words already answered correctly (pure review); words still awaiting
// their own scheduled reintroduction are left to that timing, which is
// handled separately at the top of startWordGame().
function pickWordGameSessionFillerWord() {
  const queuedWords = new Set(
    incorrectWordQueue.map((entry) => entry.wordObj),
  );
  const reviewCandidates = Array.from(wordGameSessionCorrectWords).filter(
    (entry) => !queuedWords.has(entry),
  );

  if (reviewCandidates.length > 0) {
    return pickWeightedGameWord(
      reviewCandidates,
      reviewCandidates.map(getGameWordWeight),
    );
  }

  // Nothing correct yet to review (e.g. every introduced word so far has
  // been missed) — pick from all introduced words rather than returning
  // nothing, even if that means showing one slightly ahead of its own
  // scheduled reintroduction.
  const introduced = Array.from(wordGameSessionIntroducedWords);

  return introduced.length > 0
    ? introduced[Math.floor(Math.random() * introduced.length)]
    : null;
}

async function fetchRandomWord() {
  if (
    wordGameMode === "session" &&
    wordGameSessionIntroducedWords.size >= wordGameSessionTarget
  ) {
    currentWordQueueType = "session-filler";
    return pickWordGameSessionFillerWord();
  }

  const selectedPOS = document.getElementById("pos-select")
    ? document.getElementById("pos-select").value.toLowerCase()
    : "";

  let eligibleEntries = getEligibleGameWords(selectedPOS);

  /*
   * This matters only if there is exactly one eligible entry.
   * It permits that entry to appear again when no alternative exists.
   */
  if (eligibleEntries.length === 0 && previousWord !== null) {
    previousWord = null;

    eligibleEntries = getEligibleGameWords(selectedPOS);
  }

  if (eligibleEntries.length === 0) {
    return null;
  }

  const queues = buildGameWordQueues(eligibleEntries);
  const queueName = getNextGameQueueName(queues);
  currentWordQueueType = queueName;
  const selectedEntry =
    queueName === "scheduled"
      ? pickNearestScheduledGameWord(queues.scheduled)
      : pickPrioritizedGameWord(queues[queueName] ?? []);

  if (!selectedEntry) {
    return null;
  }

  previousWord = selectedEntry.ord;

  if (wordGameRoundActive) {
    wordGameSessionIntroducedWords.add(selectedEntry);
  }

  /*
   * Return the original dictionary entry. Do not create a partial copy.
   */
  return selectedEntry;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// hasCompatibleGender lives in wordClass.js (window.WordClass), shared
// with scripts.js/wordList.js — see that file for its rationale.

function getPhraseChoiceDisplay(value) {
  return getPrimaryNorwegianForm(value).replace(/[.!?]+$/u, "").trim();
}

function getPhraseCandidateTemplates(entry) {
  return [
    ...new Set(
      getNorwegianEntryVariants(entry)
        .map(getPhraseChoiceDisplay)
        .filter(
          (choice) =>
            choice && !getClozePatternTokens(choice).includes("..."),
        ),
    ),
  ];
}

function getPhraseShape(value) {
  const tokens = getClozePatternTokens(value);
  return {
    tokenCount: tokens.filter((token) => token !== "...").length,
    wildcardCount: tokens.filter((token) => token === "...").length,
  };
}

function generatePhraseClozeDistractors(wordObj, clozeTarget) {
  if (clozeTarget.requiresInflectionAgreement && !clozeTarget.phraseSlot) {
    return [];
  }

  const correctAnswer = normalizeGameAnswer(clozeTarget.surfaceForm);
  const targetTemplate = clozeTarget.template || getPrimaryNorwegianForm(wordObj);
  const targetShape = getPhraseShape(
    clozeTarget.surfaceForm || targetTemplate,
  );
  const targetWordClass = WordClass.getWordClass(wordObj.gender);
  const targetCapitalized = startsWithUppercaseLetter(targetTemplate);
  const seen = new Set([
    correctAnswer,
    normalizeGameAnswer(getPhraseChoiceDisplay(targetTemplate)),
  ]);
  const distractors = [];

  const candidateChoices = (entry) => {
    const templates = getPhraseCandidateTemplates(entry);
    if (!clozeTarget.phraseSlot) return templates;

    const descriptor = clozeTarget.phraseSlot;
    return templates.flatMap((choice) => {
      const tokens = getClozePatternTokens(choice);
      const componentIndex =
        descriptor.position === "first"
          ? 0
          : descriptor.position === "last"
            ? tokens.length - 1
            : descriptor.componentIndex;
      if (componentIndex < 0 || componentIndex >= tokens.length) return [];

      const candidateWordClass = WordClass.getWordClass(entry.gender);
      const nounGender =
        descriptor.wordClass === "noun" && candidateWordClass === "noun"
          ? entry.gender
          : "";
      const paradigm = window.Inflections?.getParadigmForLemma(
        normalizeGameAnswer(tokens[componentIndex]),
        descriptor.wordClass,
        nounGender,
      );
      if (!paradigm) return [];

      const compatibleForms = descriptor.slotIndexes.reduce(
        (accepted, slotIndex) => {
          const slotForms = paradigm.slots[slotIndex] || [];
          if (accepted === null) return [...slotForms];
          const currentSlot = new Set(slotForms);
          return accepted.filter((form) => currentSlot.has(form));
        },
        null,
      );

      return (compatibleForms || []).map((form) => {
        const inflectedTokens = [...tokens];
        inflectedTokens[componentIndex] = restoreDictionaryCase(
          form,
          tokens[componentIndex],
        );
        return inflectedTokens.join(" ");
      });
    });
  };

  const eligible = results.filter((entry) => {
    const templates = getPhraseCandidateTemplates(entry);
    const candidateWordClass = WordClass.getWordClass(entry.gender);
    return (
      entry !== wordObj &&
      templates.length > 0 &&
      candidateWordClass === targetWordClass &&
      (targetWordClass !== "noun" ||
        WordClass.hasCompatibleGender(wordObj.gender, entry.gender)) &&
      (templates.some((choice) => getPhraseShape(choice).tokenCount > 1) ||
        !["noun", "adjective", "verb"].includes(
          candidateWordClass,
        )) &&
      !noRandom.includes(normalizeGameAnswer(entry.ord))
    );
  });

  const hasSimilarShape = (entry) => {
    const tolerance = Math.max(2, Math.ceil(targetShape.tokenCount * 0.4));
    return getPhraseCandidateTemplates(entry).some(
      (choice) => {
        const shape = getPhraseShape(choice);
        return (
          shape.wildcardCount === targetShape.wildcardCount &&
          Math.abs(shape.tokenCount - targetShape.tokenCount) <= tolerance
        );
      },
    );
  };

  const collect = (entries) => {
    for (const entry of shuffleArray([...entries])) {
      if (distractors.length >= 3) return;
      for (const choice of shuffleArray(candidateChoices(entry))) {
        const identity = normalizeGameAnswer(choice);
        if (!identity || seen.has(identity)) continue;
        seen.add(identity);
        distractors.push(choice);
        break;
      }
    }
  };

  const sameCapitalization = (entry) =>
    startsWithUppercaseLetter(getPhraseChoiceDisplay(entry)) ===
    targetCapitalized;

  collect(
    eligible.filter(
      (entry) =>
        entry.CEFR === wordObj.CEFR &&
        sameCapitalization(entry) &&
        hasSimilarShape(entry),
    ),
  );
  if (distractors.length < 3) {
    collect(
      eligible.filter(
        (entry) =>
          sameCapitalization(entry) &&
          hasSimilarShape(entry),
      ),
    );
  }
  if (distractors.length < 3) {
    collect(eligible.filter(hasSimilarShape));
  }
  if (distractors.length < 3) collect(eligible);

  return distractors;
}

function generateClozeDistractors(wordObj, clozeTarget) {
  if (clozeTarget?.kind === "phrase") {
    return generatePhraseClozeDistractors(wordObj, clozeTarget);
  }

  const slotIndexes = [...new Set(clozeTarget?.slotIndexes || [])].filter(
    Number.isInteger,
  );
  if (slotIndexes.length === 0) return [];
  const baseExpression = normalizeGameAnswer(getPrimaryNorwegianForm(wordObj));
  const targetWordClass = clozeTarget.wordClass;
  const targetGender = clozeTarget.targetGender || wordObj.gender;
  const correctAnswer = normalizeGameAnswer(clozeTarget.surfaceForm);
  const targetCapitalized = startsWithUppercaseLetter(
    clozeTarget.targetLemma || getPrimaryNorwegianForm(wordObj),
  );
  const seen = new Set([correctAnswer]);
  const distractors = [];

  const candidateForms = (entry) => {
    const displayExpression = getPrimaryNorwegianForm(entry);
    const expression = normalizeGameAnswer(displayExpression);
    if (!expression || expression === baseExpression || entry === wordObj) {
      return [];
    }
    const parts = getClozePatternTokens(expression);
    if (parts.length !== 1 || parts[0] === "...") return [];
    if (WordClass.getWordClass(entry.gender) !== targetWordClass) return [];

    const paradigm = window.Inflections?.getParadigmForLemma(
      parts[0],
      targetWordClass,
      entry.gender,
    );
    if (!paradigm) return [];
    const compatibleForms = slotIndexes.reduce((accepted, slotIndex) => {
      const slotForms = paradigm.slots[slotIndex] || [];
      if (accepted === null) return [...slotForms];
      const currentSlot = new Set(slotForms);
      return accepted.filter((form) => currentSlot.has(form));
    }, null);
    return (compatibleForms || [])
      .map((form) =>
        clozeTarget.nounCase === "genitive"
          ? createNounGenitiveForm(form)
          : form,
      )
      .map((form) => restoreDictionaryCase(form, displayExpression))
      .filter(
        (form) =>
          normalizeGameAnswer(form) !== correctAnswer &&
          /^[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*$/u.test(form),
      );
  };

  const collect = (entries) => {
    for (const entry of shuffleArray([...entries])) {
      for (const form of shuffleArray(candidateForms(entry))) {
        if (distractors.length >= 3) return;
        const identity = normalizeGameAnswer(form);
        if (seen.has(identity)) continue;
        seen.add(identity);
        distractors.push(form);
        break; // At most one displayed alternative per dictionary entry.
      }
    }
  };

  const eligible = results.filter(
    (entry) =>
      entry?.ord &&
      !BANNED_WORD_CLASSES.some((banned) =>
        entry.gender?.toLowerCase().startsWith(banned),
      ) &&
      WordClass.getWordClass(entry.gender) === targetWordClass &&
      (targetWordClass !== "noun" ||
        !targetGender ||
        WordClass.hasCompatibleGender(targetGender, entry.gender)),
  );

  collect(
    eligible.filter(
      (entry) =>
        entry.CEFR === wordObj.CEFR &&
        (targetWordClass !== "noun" ||
          !targetGender ||
          WordClass.hasCompatibleGender(targetGender, entry.gender)) &&
        startsWithUppercaseLetter(getPrimaryNorwegianForm(entry)) ===
          targetCapitalized,
    ),
  );
  if (distractors.length < 3) {
    collect(
      eligible.filter(
        (entry) =>
          (targetWordClass !== "noun" ||
            !targetGender ||
            WordClass.hasCompatibleGender(targetGender, entry.gender)) &&
          startsWithUppercaseLetter(getPrimaryNorwegianForm(entry)) ===
            targetCapitalized,
      ),
    );
  }
  if (distractors.length < 3) collect(eligible);

  return distractors;
}

function loadAbilityState() {
  try {
    const stored = window.localStorage.getItem(ABILITY_STORAGE_KEY);

    if (stored) {
      const parsed = JSON.parse(stored);

      if (Number.isFinite(parsed?.score)) {
        return {
          score: clampAbility(parsed.score),
          placementCompleted: Boolean(parsed.placementCompleted),
        };
      }
    }
  } catch (error) {
    console.warn("Ability score could not be loaded.", error);
  }

  // First run after upgrading from the old ordinal CEFR rise/fall system:
  // silently carry the saved level forward as a starting estimate instead
  // of sending an existing player through the placement flow.
  try {
    const legacy = window.localStorage.getItem(LEGACY_GAME_LEVEL_STORAGE_KEY);

    if (legacy) {
      const parsedLegacy = JSON.parse(legacy);

      if (CEFR_LEVEL_ORDER.includes(parsedLegacy.level)) {
        return {
          score: CEFR_DIFFICULTY_ANCHOR[parsedLegacy.level],
          placementCompleted: true,
        };
      }
    }
  } catch (error) {
    console.warn("Legacy game level could not be migrated.", error);
  }

  return { score: null, placementCompleted: false };
}

function saveAbilityState({ syncRemote = true } = {}) {
  try {
    window.localStorage.setItem(
      ABILITY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        score: abilityScore,
        placementCompleted,
      }),
    );
  } catch (error) {
    console.warn("Ability score could not be saved.", error);
  }

  // Let myWordsAuth.js know the ability score changed, so it can sync to
  // Firestore when a user is signed in. syncRemote is false when the
  // change came from a remote merge, to avoid immediately writing it back.
  window.dispatchEvent(
    new CustomEvent("ability:updated", {
      detail: { score: abilityScore, placementCompleted, syncRemote },
    }),
  );
}

// Used by the placement test to seed/finalize the estimate, and available
// for a learner to retake later — the only two ways abilityScore is ever
// set directly, as opposed to the small per-answer drift in
// updateAbilityScore.
function completePlacementTest(score) {
  abilityScore = clampAbility(Math.round(score));
  placementCompleted = true;
  saveAbilityState();
}

function replaceAbilityState(remoteScore, remotePlacementCompleted) {
  abilityScore = clampAbility(remoteScore);
  placementCompleted = Boolean(remotePlacementCompleted);
  saveAbilityState({ syncRemote: false });
}

function resetGame(resetStreak = true) {
  currentWordQueueType = null;
  previousWord = null;
  correctCount = 0; // Reset correct answers count
  correctLevelAnswers = 0; // Reset correct answers for the current level
  if (resetStreak) {
    correctStreak = 0; // Reset the streak if the flag is true
  }
  incorrectCount = 0; // Reset incorrect answers count
  incorrectWordQueue = [];
  recentAnswers = []; // Clear the recent answers array
  totalQuestions = 0; // Reset total questions for the current level
  renderStats(); // Re-render the stats display to reflect the reset
}

document.addEventListener("keydown", function (event) {
  if (document.getElementById("type-select").value !== "word-game") return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;

  const target = event.target;
  const isTextEntry =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target?.isContentEditable;
  if (isTextEntry) return;

  // Number keys select the same four cards without adding any visible chrome
  // or changing the established layout. The buttons themselves remain fully
  // usable with Tab, Enter, and Space.
  if (gameActive && /^[1-4]$/.test(event.key)) {
    const card = document.querySelectorAll(".game-translation-card")[
      Number(event.key) - 1
    ];
    if (card && !card.disabled) {
      event.preventDefault();
      card.click();
    }
    return;
  }

  if (event.key !== "Enter" || target instanceof HTMLButtonElement) return;

  const nextWordButton = document.getElementById("game-next-word-button");
  if (
    nextWordButton &&
    !nextWordButton.disabled &&
    window.getComputedStyle(nextWordButton).display !== "none"
  ) {
    event.preventDefault();
    nextWordButton.click();
  }
});

// Static (not re-rendered per question), so it only needs wiring once, here
// at load time — visibility is handled separately by
// updateEndSessionToolbarButtonVisibility().
document.getElementById("game-end-session-btn")?.addEventListener("click", () => {
  showWordGameRoundSummary();
});

window.DailyQuestAPI = Object.freeze({
  renderLanding: renderLandingDailyQuests,
  start: startDailyQuestFromLanding,
  getState: loadDailyPracticeState,
  replaceState: replaceDailyPracticeState,
  normalize: normalizeDailyPracticeState,
});
window.WordGameHelpers = Object.freeze({
  playWordAudio,
  stopAllAudio,
  fetchIncorrectTranslations,
  getTypedRecallProbability,
  shouldUseTypedRecall,
  getTypedAcceptedAnswers,
  shuffleArray,
  getAbilityScore: () => abilityScore,
  isPlacementCompleted: () => placementCompleted,
  getCefrAnchors: () => ({ ...CEFR_DIFFICULTY_ANCHOR }),
  getWordDifficulty: getWordDifficultyAnchor,
  completePlacement: completePlacementTest,
  replaceAbility: replaceAbilityState,
  startWordGame,
  getVocabStrengthFilterOptions,
  getWordStrengthFilterId,
  getVocabProgressSummary,
  buildVocabProgressBarMarkup,
  getVocabDueLabel,
});

// Keeps the vocabulary profile widget live if strength records change while
// the learner is already sitting on the landing page (e.g. a remote merge
// on sign-in) — renderLandingDailyQuests() only re-renders it on the paths
// that already touch daily-quest state, which word-strength updates don't.
window.addEventListener("word-strength:updated", () => {
  renderLandingProgressSummary();
});

renderLandingDailyQuests();
