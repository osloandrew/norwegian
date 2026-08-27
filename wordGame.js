let activeAudio = [];
let currentWord;
let correctTranslation;
// The ordinary selector now chooses a word and exercise together. This holds
// the exercise half of that pair until startWordGame renders the selected
// word. Renderers overwrite currentQuestionPrediction with the mode they
// actually show, so cloze fallbacks and relearning remain correctly measured.
let plannedQuestionMode = null;
let currentQuestionPrediction = null;
// Identifies which scheduler queue supplied the current question. Correct
// pure-filler/scheduled-fallback answers do not lengthen an interval, while
// due, approaching, new, and deliberate relearning answers do.
let currentWordQueueType = null;
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
const PLACEMENT_PRACTICE_WORD_COUNT = 10;
const PLACEMENT_CALIBRATION_ANSWER_COUNT = 7;
const PLACEMENT_CALIBRATION_INITIAL_STEP = 150;
const PLACEMENT_CALIBRATION_STEP_DECAY = 0.72;
const PLACEMENT_CALIBRATION_MIN_STEP = 30;
// Placement is a short diagnostic embedded in a useful first practice
// session, not a vocabulary exam. Start with familiar multiple-choice
// recognition, then sample listening and productive recall after the
// estimate has had a few chances to adjust. Each next word is still drawn
// around the continually updated estimate, so the plan is adaptive in both
// difficulty and skill rather than being a fixed ten-item quiz.
//
// Keep three forward questions at the beginning: a learner who genuinely has
// no Norwegian should not meet dictation before they have seen the game
// once. The later forward checkpoints help separate a broad vocabulary gap
// from a weaker listening or production skill without making one difficult
// modality dominate the general ability estimate.
const PLACEMENT_QUESTION_PLAN = Object.freeze([
  "forward",
  "forward",
  "forward",
  "listening",
  "reverse",
  "listening",
  "typed-reverse",
  "forward",
  "typed-reverse",
  "typed-listening",
]);
// A sub-second four-choice answer is useful evidence, but can also be a
// lucky click. Match the predictor's existing likely-guess threshold and
// give a fast correct multiple-choice response partial, rather than full,
// placement influence. Typed answers deliberately never take this path.
const PLACEMENT_LIKELY_GUESS_OUTCOME = 0.65;
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

// The CSV's wordAudio flag is broader than the set of files that can
// actually be played. In particular, paired expressions written with an
// ellipsis (for example "jo ... jo") and the interjection "hrmf" have no
// single-word recording even though their rows are flagged. Keep those data
// quirks out of listening and dictation questions, where audio is the only
// prompt.
function hasPlayableWordAudio(wordObj) {
  const word = String(wordObj?.ord ?? "").trim();
  return (
    wordObj?.wordAudio === "X" &&
    word.length > 0 &&
    word.toLowerCase() !== "hrmf" &&
    !word.includes("...") &&
    !word.includes("…")
  );
}

let wordGameRoundActive = false; // false until the intro screen's mode is chosen
let wordGameMode = null; // "session" | "infinite"
let wordGameIsTodayPracticeRound = false;
let wordGameIsBonusRound = false;
let wordGameIsPlacementRound = false;
let wordGamePlacementCalibrationEnabled = false;
let wordGamePlacementCalibrationStep = PLACEMENT_CALIBRATION_INITIAL_STEP;
let wordGamePlacementCalibrationWords = new Set();
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
let wordGameMyWordsMixQuestionCount = 0;
let wordGameMyWordsMixSavedQuestionCount = 0;
let wordGameReviewPortfolioQuestionCount = 0;
let wordGameReviewPortfolioReviewCount = 0;
// A round snapshots its current A0 support intensity so its pacing does not
// visibly change halfway through. The next round recomputes it from durable
// SRS history, which makes the overall transition smooth without a separate
// A0 mode or completion flag.
let wordGameA0SupportIntensity = 0;
let wordGameA0PacingQuestionCount = 0;
let wordGameA0ReinforcementQuestionCount = 0;
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
  // Lifetime count of quest gems earned, broken down by type (My Stats'
  // "Gems earned" section) -- unlike completedRounds/earnedRewards above,
  // these are carried through regardless of date instead of resetting
  // each day.
  const gemCounts = {};
  for (const quest of DAILY_QUESTS) {
    const raw = value?.gemCounts?.[quest.reward];
    gemCounts[quest.reward] = Number.isFinite(raw)
      ? Math.max(0, Math.floor(raw))
      : 0;
  }

  return {
    date: dateKey,
    completedRounds,
    earnedRewards,
    gemCounts,
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
  state.gemCounts = {
    ...state.gemCounts,
    [quest.reward]: (state.gemCounts?.[quest.reward] || 0) + 1,
  };
  const savedState = saveDailyPracticeState(state);
  return savedState.earnedRewards.includes(quest.reward) ? quest : null;
}
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
// leave the queue or the round can finish. listening's typed variant (true
// dictation — hear the word, type what you heard, no English shown at all)
// ramps on the same shape as reverse: it's unaided production too, just from
// audio instead of an English gloss.
const TYPED_RECALL_READINESS = Object.freeze({
  cloze: Object.freeze({ start: 0.72, full: 0.9, maximum: 1 }),
  reverse: Object.freeze({ start: 0.78, full: 0.94, maximum: 0.9 }),
  listening: Object.freeze({ start: 0.78, full: 0.94, maximum: 0.9 }),
});

// --- Game-mode registry ---------------------------------------------------
// One entry per exercise mode, gradually growing to hold everything that's
// specific to that mode (today: selection eligibility/odds, instruction
// text, and top-level rendering dispatch; answer-checking still lives where
// it always has — see handleTranslationClick()). "forward", "typed-reverse",
// "typed-cloze", and "typed-listening" don't define isEligible/
// matchesStructuredMode/freePlayProbability: they aren't top-level selection
// outcomes — forward is selectQuestionMode()'s implicit default, and the
// three typed variants are sub-decisions made after cloze/reverse/listening
// are already chosen (see shouldUseTypedRecall) — so those fields would
// never be consulted for them. Likewise only cloze/listening/reverse/forward
// define renderQuestion: those are the only values selectQuestionMode() can
// actually return: the typed variants are chosen *inside* renderQuestion for
// cloze/reverse/listening, not looked up separately.
const GAME_MODES = Object.freeze({
  cloze: Object.freeze({
    // No pre-check here: cloze eligibility (a usable example sentence, a
    // non-banned word class, enough same-slot distractors) can only be
    // confirmed by actually attempting to build the question — see
    // renderQuestion below, which falls back to a forward flashcard on
    // failure rather than trying a different mode.
    isEligible: () => true,
    matchesStructuredMode: (structuredMode) => structuredMode === "cloze",
    freePlayProbability: () => 0.5,
    instructionText: () => "Choose the word that completes the sentence",
    // Moved verbatim from startWordGame's old inline cloze branch — same
    // fallback-to-forward-flashcard behavior on every failure path,
    // preserved exactly per the "don't change the fallback quirk" call.
    async renderQuestion({
      wordObj,
      fallbackTranslations,
      plannedMode = null,
    }) {
      if (
        BANNED_WORD_CLASSES.some((b) =>
          wordObj.gender?.toLowerCase().startsWith(b),
        )
      ) {
        renderWordGameUI(wordObj, fallbackTranslations, false);
        return;
      }

      const clozeTarget = await findPracticeClozeTarget(wordObj);
      if (!clozeTarget) {
        console.warn(
          "No reliable cloze target was found. Falling back to flashcard.",
          wordObj,
        );
        renderWordGameUI(wordObj, fallbackTranslations, false);
        return;
      }

      const a0SupportIntensity = getActiveA0SupportIntensity();
      if (a0SupportIntensity > 0.05) {
        const sentenceVocabularySuccess =
          await getRenderedSentenceVocabularySuccess(clozeTarget);
        // At the start of learning, a cloze sentence should mostly contain
        // words the learner can already follow. This gate fades away with
        // A0 support and simply uses the normal forward card when no safe
        // context is available.
        const minimumSentenceSuccess = 0.55 + 0.25 * a0SupportIntensity;
        if (
          Number.isFinite(sentenceVocabularySuccess) &&
          sentenceVocabularySuccess < minimumSentenceSuccess
        ) {
          renderWordGameUI(wordObj, fallbackTranslations, false);
          return;
        }
      }

      const correctChoice = formatCorrectClozeChoice(wordObj, clozeTarget);
      const typedPredictionExercise = getClozeTargetTranslation(
        wordObj,
        clozeTarget,
      )
        ? await buildRenderedClozePredictionExercise(
            wordObj,
            "typed-cloze",
            clozeTarget,
            [],
            correctChoice,
          )
        : null;
      if (
        typedPredictionExercise &&
        (plannedMode === "typed-cloze" ||
          (plannedMode === null &&
            shouldUseTypedRecall(
              wordObj,
              "cloze",
              Math.random(),
              typedPredictionExercise,
            )))
      ) {
        await renderClozeGameUI(
          wordObj,
          [],
          correctChoice,
          false,
          clozeTarget,
          true,
          typedPredictionExercise,
        );
        return;
      }

      const distractors = generateClozeDistractors(wordObj, clozeTarget);
      if (distractors.length < 3) {
        console.warn(
          "Not enough same-slot official distractors were found. Falling back to flashcard.",
          wordObj,
        );
        renderWordGameUI(wordObj, fallbackTranslations, false);
        return;
      }

      const { choices } = prepareClozeChoices(
        wordObj,
        clozeTarget,
        distractors,
      );
      if (choices.length < 4) {
        renderWordGameUI(wordObj, fallbackTranslations, false);
        return;
      }

      await renderClozeGameUI(
        wordObj,
        choices,
        correctChoice,
        false,
        clozeTarget,
      );
    },
  }),
  listening: Object.freeze({
    isEligible: (ctx) => ctx.hasAudio,
    matchesStructuredMode: (structuredMode) => structuredMode === "listening",
    freePlayProbability: (ctx) =>
      interpolateByAbility(ctx.ability, LISTENING_PROBABILITY) ?? 0.25,
    instructionText: () => "Listen and choose the meaning",
    // True dictation: no English shown at all, nothing to gate on (unlike
    // cloze/reverse's typed variants, which need a saved sentence
    // translation as the learner's only semantic anchor) — the audio itself
    // is the whole prompt, replayable as many times as needed.
    async renderQuestion({
      wordObj,
      fallbackTranslations,
      plannedMode = null,
    }) {
      if (
        plannedMode === "typed-listening" ||
        (plannedMode === null && shouldUseTypedRecall(wordObj, "listening"))
      ) {
        renderWordGameUI(wordObj, [], false, "typed-listening");
        return;
      }
      renderWordGameUI(wordObj, fallbackTranslations, false, "listening");
    },
  }),
  reverse: Object.freeze({
    isEligible: () => true,
    matchesStructuredMode: (structuredMode, ctx) =>
      structuredMode === "reverse" || ctx.forceTypedReverse,
    freePlayProbability: (ctx) =>
      interpolateByAbility(ctx.ability, REVERSE_FLASHCARD_PROBABILITY) ?? 0.25,
    instructionText: () => "Choose the Norwegian word",
    async renderQuestion({
      wordObj,
      forceTypedReverse,
      plannedMode = null,
    }) {
      if (
        getGameSentenceTranslation(wordObj, 0) &&
        (forceTypedReverse ||
          plannedMode === "typed-reverse" ||
          (plannedMode === null && shouldUseTypedRecall(wordObj, "reverse")))
      ) {
        renderWordGameUI(wordObj, [], false, "typed-reverse");
        return;
      }

      const incorrectNorwegianWords = fetchIncorrectNorwegianWords(
        wordObj.ord,
        wordObj.CEFR,
        wordObj.gender,
      );
      const allNorwegianOptions = shuffleArray([
        wordObj.ord,
        ...incorrectNorwegianWords,
      ]);
      const uniqueNorwegianOptions =
        ensureUniqueDisplayedValues(allNorwegianOptions);

      renderWordGameUI(wordObj, uniqueNorwegianOptions, false, "reverse");
    },
  }),
  forward: Object.freeze({
    instructionText: () => "Choose the English meaning",
    async renderQuestion({ wordObj, fallbackTranslations }) {
      renderWordGameUI(wordObj, fallbackTranslations, false);
    },
  }),
  "typed-reverse": Object.freeze({
    instructionText: () => "Type the Norwegian word",
  }),
  "typed-cloze": Object.freeze({
    instructionText: () => "Type the word that completes the sentence",
  }),
  "typed-listening": Object.freeze({
    instructionText: () => "Type the word you hear",
  }),
});

// Fixed priority order for free play — see the mutual-exclusion comment on
// each probability table above for why cloze goes first, listening second,
// reverse last. "forward" isn't listed: it's whatever's left once nothing
// above claims the slot.
const SELECTION_ORDER = Object.freeze(["cloze", "listening", "reverse"]);

function selectQuestionMode({
  structuredQuestionMode = null,
  forceTypedReverse = false,
  ability = null,
  hasAudio = false,
} = {}) {
  const ctx = { ability, hasAudio, forceTypedReverse };

  for (const modeId of SELECTION_ORDER) {
    const mode = GAME_MODES[modeId];
    if (!mode.isEligible(ctx)) continue;

    if (mode.matchesStructuredMode(structuredQuestionMode, ctx)) {
      return modeId;
    }

    if (
      structuredQuestionMode === null &&
      Math.random() < mode.freePlayProbability(ctx)
    ) {
      return modeId;
    }
  }

  return "forward";
}

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

function configureRelearningEntryMode(queueEntry, mode) {
  queueEntry.nextMode = mode;
  queueEntry.wasCloze = mode === "cloze" || mode === "typed-cloze";
  queueEntry.wasReverse = mode === "reverse" || mode === "typed-reverse";
  queueEntry.wasListening =
    mode === "listening" || mode === "typed-listening";
  queueEntry.forceTypedRetry = mode.startsWith("typed-");
}

function applyCorrectRelearningResult(
  queueEntry,
  wasTyped,
  answeredQuestions,
  answeredMode = queueEntry?.nextMode ?? null,
) {
  if (!queueEntry) return "none";

  // A scaffold demonstrates useful supporting knowledge, but never repairs
  // the skill that actually failed. Schedule the original exercise after a
  // longer gap and require success there before removing the word.
  if (
    queueEntry.requiresOriginalSuccess &&
    queueEntry.originalMode &&
    answeredMode !== queueEntry.originalMode
  ) {
    configureRelearningEntryMode(queueEntry, queueEntry.originalMode);
    queueEntry.requiresOriginalSuccess = false;
    queueEntry.shown = false;
    queueEntry.availableAfterQuestion =
      answeredQuestions + (queueEntry.originalRetryGap || 4);
    return "keep-for-original";
  }

  if (queueEntry.requiresTypedMastery && !wasTyped) {
    configureRelearningEntryMode(
      queueEntry,
      queueEntry.originalMode || "typed-reverse",
    );
    queueEntry.shown = false;
    queueEntry.availableAfterQuestion =
      answeredQuestions +
      (queueEntry.originalMode ? queueEntry.originalRetryGap || 4 : 1);
    return "keep-for-typing";
  }

  return "remove";
}

function scheduleAdaptiveRecovery({
  queueEntry = null,
  wordObj,
  failedMode,
  predictedSuccess = 0.5,
  responseTimeMs = null,
  answeredQuestions,
  baseGap,
  clozedForm = null,
  clozeSentence = "",
  clozeSentenceTranslation = "",
}) {
  const reviewAttempts = (queueEntry?.reviewAttempts || 0) + 1;
  const originalMode = queueEntry?.originalMode || failedMode;
  const failedScaffold = Boolean(
    queueEntry && failedMode !== originalMode,
  );
  const plan = window.WordGamePolicy.getRecoveryPlan({
    failedMode: failedScaffold ? failedMode : originalMode,
    predictedSuccess,
    responseTimeMs,
    reviewAttempts,
    baseGap,
  });
  const entry = queueEntry || { wordObj };

  entry.originalMode = originalMode;
  entry.reviewAttempts = reviewAttempts;
  entry.shown = false;
  entry.originalRetryGap = plan.originalRetryGap;
  entry.requiresTypedMastery = originalMode.startsWith("typed-");
  if (clozedForm) entry.clozedForm = clozedForm;
  if (clozeSentence) {
    entry.clozeSentence = clozeSentence;
    entry.clozeSentenceTranslation = clozeSentenceTranslation;
  }

  if (failedScaffold) {
    // Failing the easier step is evidence to repeat that same scaffold; the
    // original failed mode remains the graduation requirement.
    entry.requiresOriginalSuccess = true;
    configureRelearningEntryMode(entry, failedMode);
  } else {
    entry.requiresOriginalSuccess = plan.requiresOriginalSuccess;
    configureRelearningEntryMode(entry, plan.nextMode);
  }
  entry.availableAfterQuestion = answeredQuestions + plan.initialGap;
  return entry;
}
let wordDataStore = [];
// MP3s, not WAVs — encoded at LAME -V2 (~91% smaller with no audible
// difference for a short UI chime), since all six are instantiated
// unconditionally for every visitor on every page, not just word-game
// players. goodChime/badChime/queueClearedChime/roundCompleteChime/
// streakChime share one synthesized bell voice and a common C-major tonal
// palette (goodChime/queueClearedChime/roundCompleteChime/streakChime all
// resolve upward through the same family of intervals; badChime is the one
// deliberately falling, duller motif) so they read as one cohesive kit.
// popChime is the original pre-existing file — kept as-is by request after
// a synthesized replacement was tried and rejected as too high and chirpy.
let goodChime = new Audio("Resources/Audio/goodChime.mp3?v=cd9567be7c");
let badChime = new Audio("Resources/Audio/badChime.mp3?v=b14562da64");
let popChime = new Audio("Resources/Audio/popChime.mp3?v=e74ec8eaaa");
// Milestone chimes: rarer, bigger moments (streak, queue cleared, round
// complete) than the per-answer three above, but same voice and palette.
let streakChime = new Audio("Resources/Audio/streakChime.mp3?v=abda44554f");
let queueClearedChime = new Audio(
  "Resources/Audio/queueClearedChime.mp3?v=9a05e08c72",
);
let roundCompleteChime = new Audio(
  "Resources/Audio/roundCompleteChime.mp3?v=0a276b8d1c",
);

goodChime.volume = 0.2;
badChime.volume = 0.2;
popChime.volume = 0.2;
streakChime.volume = 0.2;
queueClearedChime.volume = 0.2;
roundCompleteChime.volume = 0.2;

// Two chimes should never play at once — a rarer, bigger moment (a streak,
// the round ending) needs to win outright over a routine one (the plain
// per-answer ding) rather than get muddied by playing on top of it. Higher
// number wins; a lower- or equal-priority chime already playing gets cut off
// by anything ranked higher, and a lower-priority request arriving while a
// higher one is still playing is simply dropped rather than queued.
const CHIME_PRIORITY = {
  pop: 1,
  answer: 2, // goodChime / badChime — routine per-answer feedback
  queueCleared: 3,
  streak: 4,
  roundComplete: 5, // the round just ended; nothing should step on this
};
let activeChime = null;
let activeChimePriority = -Infinity;
function playChime(audio, priority) {
  if (
    activeChime &&
    activeChime !== audio &&
    !activeChime.paused &&
    !activeChime.ended &&
    activeChimePriority >= priority
  ) {
    return;
  }
  if (activeChime && activeChime !== audio) {
    activeChime.pause();
  }
  audio.currentTime = 0;
  // Interrupting a chime (the .pause() above) rejects its own in-flight
  // play() promise with an AbortError — expected once chimes can cut each
  // other off, not a real failure, so it's swallowed rather than left as an
  // unhandled rejection.
  audio.play().catch(() => {});
  activeChime = audio;
  activeChimePriority = priority;
}

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
    return "noun - " + WordClass.stripNounPrefix(gender);
  }
  const normalizedGender = String(gender ?? "").toLowerCase();
  if (normalizedGender.startsWith("adjective")) return "adjective";
  if (normalizedGender.startsWith("adverb")) return "adverb";
  if (normalizedGender.startsWith("conjunction")) return "conjunction";
  if (normalizedGender.startsWith("determiner")) return "determiner";
  if (normalizedGender.startsWith("expression")) return "expression";
  if (normalizedGender.startsWith("interjection")) return "interjection";
  if (normalizedGender.startsWith("numeral")) return "numeral";
  if (normalizedGender.startsWith("possessive")) return "possessive";
  if (normalizedGender.startsWith("preposition")) return "preposition";
  if (normalizedGender.startsWith("pronoun")) return "pronoun";
  return String(gender ?? "");
}

function focusGameQuestionPrompt({ typed = false } = {}) {
  if (typed) return;
  window.requestAnimationFrame(() => {
    const prompt = document.querySelector(".game-instruction, .game-word");
    if (!prompt) return;
    const suppliedTabIndex = prompt.hasAttribute("tabindex");
    if (!suppliedTabIndex) prompt.setAttribute("tabindex", "-1");
    prompt.focus({ preventScroll: true });
    if (!suppliedTabIndex) {
      prompt.addEventListener(
        "blur",
        () => prompt.removeAttribute("tabindex"),
        { once: true },
      );
    }
  });
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
  "🎉 Awesome! You've cleared all your review words!",
  "👏 Great job! Practice makes perfect.",
  "🌟 Stellar effort! Review words completed.",
  "🏆 Victory! Review words conquered.",
  "🚀 You're ready for the next challenge!",
  "🎓 Review complete! Onward to new words.",
  "🔥 Review words? Done and dusted!",
  "💡 Bright work! Review session finished.",
  "🎯 Target achieved! Review words cleared.",
  "🧠 Brainpower at its best! Review complete.",
];

// Deliberately avoids the bare word "streak" — My Stats' Day Streak /
// Longest Streak already uses that word for a completely different thing
// (consecutive calendar days practiced), while this banner is about
// consecutive correct answers within the current round. "in a row" /
// "run" phrasing keeps the celebration without the naming collision.
const streakMessages = [
  "🔥 You're on fire — {X} correct answers in a row!",
  "💪 Power run! That's {X} in a row!",
  "🎯 Precision mode: {X} correct straight!",
  "🎉 Amazing! {X} correct answers in a row!",
  "👏 Well done! {X} correct answers without a miss!",
  "🌟 Stellar performance! {X} consecutive correct answers!",
  "🚀 You're soaring! {X} right answers in a row!",
  "🏆 Champion run! {X} correct answers and counting!",
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
    playChime(streakChime, CHIME_PRIORITY.streak);
  } else if (type === "clearedPracticeWords") {
    const randomIndex = Math.floor(
      Math.random() * clearedPracticeMessages.length,
    );
    message = clearedPracticeMessages[randomIndex];
    bannerHTML = `<div class="game-cleared-practice-banner"><p>${message}</p></div>`;
    playChime(queueClearedChime, CHIME_PRIORITY.queueCleared);
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
  // Called defensively on several screen transitions, including ones that
  // happen before the word-game screen (and its banner placeholder) has
  // ever been rendered, so a missing element here is routine, not an error.
  const bannerPlaceholder = document.getElementById("game-banner-placeholder");
  if (bannerPlaceholder) bannerPlaceholder.innerHTML = "";
}

// Track correct/incorrect answers for each question, and nudge the ability
// estimate from this one data point. The mode and its learner-specific bias
// let a difficult productive/listening miss count as weaker evidence against
// general vocabulary ability than the same miss in recognition mode.
function updateRecentAnswers(
  isCorrect,
  wordObj,
  mode = "forward",
  learnedExerciseBias = 0,
  outcomeValue = isCorrect ? 1 : 0,
  placementEvidence = null,
) {
  recentAnswers.push(isCorrect ? 1 : 0);
  updateAbilityScore(
    wordObj,
    isCorrect,
    mode,
    learnedExerciseBias,
    outcomeValue,
    placementEvidence,
  );
}

// Normalizes to one of CEFR_DIFFICULTY_ANCHOR's five keys, falling back to
// B1 for anything missing/unrecognized — shared by getWordDifficultyAnchor
// (the numeric anchor) and countEntriesByCefr (per-band draw-pool tallies,
// see NEW_WORD_FLOOR_WEIGHT_BUDGET) so the two can never disagree about
// which band a given entry belongs to.
function getWordCefrLabel(entry) {
  const cefr = String(entry?.CEFR ?? "").trim().toUpperCase();
  return CEFR_DIFFICULTY_ANCHOR[cefr] !== undefined ? cefr : "B1";
}

// How far a per-word frequency-based nudge may move a word within its own
// CEFR band, in the same units as CEFR_DIFFICULTY_ANCHOR. CEFR bands are
// hand-curated ground truth for real difficulty (grammar, abstractness);
// frequency only refines *position within* a band, since a word's frequency
// alone can't be trusted to reorder bands (a common but grammatically
// advanced word shouldn't get rated as easy as an actual A1 word). Kept
// safely under half the 200-unit spacing between band centers (leaving a
// 40-unit gap even at both bands' extremes), so a nudged word can never
// numerically cross into a neighboring band.
const DIFFICULTY_BAND_NUDGE_RANGE = 80;

// The band anchor is the primary difficulty signal; a word's blended
// frequency rank (see VOCABULARY_FREQUENCY_DATA.md), when available, nudges
// it within the band via bandPercentile — a 0-1 position among only the
// other words in the *same* band, not the whole dictionary. This single
// function feeds the Elo-style ability rating (updateAbilityScore), exercise
// selection (predictQuestionSuccess), and word-selection weighting
// (getRawAbilityProximity/getCoreVocabularyCandidatePool) — refining it here
// refines all three at once. Words with no frequency record at all fall
// back to the plain band center, exactly as before.
function getWordDifficultyAnchor(entry) {
  const bandCenter = CEFR_DIFFICULTY_ANCHOR[getWordCefrLabel(entry)];
  const bandPercentile = getVocabularyFrequencyRecord(entry)?.bandPercentile;
  if (!Number.isFinite(bandPercentile)) return bandCenter;

  return bandCenter - (bandPercentile - 0.5) * 2 * DIFFICULTY_BAND_NUDGE_RANGE;
}

// Elo/logistic-style update: predicts the probability the learner gets a
// word of this difficulty right given their current ability, then moves
// ability toward the actual outcome by a small, fixed step. Replaces the
// old 20-question batch accuracy check with something that adapts after
// every single answer, in both bounded and endless rounds.
function getExpectedSuccessProbability(wordDifficulty, ability) {
  return window.WordGamePolicy.getExpectedSuccessProbability(
    wordDifficulty,
    ability,
    ABILITY_LOGISTIC_SCALE,
  );
}

function updateAbilityScore(
  wordObj,
  isCorrect,
  mode = "forward",
  learnedExerciseBias = 0,
  outcomeValue = isCorrect ? 1 : 0,
  placementEvidence = null,
) {
  if (abilityScore === null || !wordObj) return;

  // Placement now happens inside the learner's first real practice round.
  // Its first seven distinct words need to move the self-assessed starting
  // estimate more quickly than ordinary long-term play, while retries of a
  // missed word must not count as fresh placement evidence. After those
  // seven words, the normal small Elo-style updates resume automatically.
  const isFreshPlacementCalibrationWord =
    typeof wordGameIsPlacementRound !== "undefined" &&
    wordGameIsPlacementRound &&
    wordGamePlacementCalibrationEnabled &&
    wordGamePlacementCalibrationWords.size <
      PLACEMENT_CALIBRATION_ANSWER_COUNT &&
    !wordGamePlacementCalibrationWords.has(wordObj);

  if (isFreshPlacementCalibrationWord) {
    wordGamePlacementCalibrationWords.add(wordObj);
    const likelyGuessedMultipleChoice = Boolean(
      placementEvidence?.possiblyGuessed && !placementEvidence?.wasTyped,
    );
    const placementOutcome =
      likelyGuessedMultipleChoice && isCorrect
        ? Math.min(outcomeValue, PLACEMENT_LIKELY_GUESS_OUTCOME)
        : outcomeValue;

    // Unlike the old +/- step, this uses the same exercise bias as ordinary
    // play. A miss on the short typed-production sample therefore says less
    // about general vocabulary knowledge than a miss on recognition, while
    // the mode and skill predictors retain their own calibration evidence.
    abilityScore = window.WordGamePolicy.getAbilityAfterAnswer({
      ability: abilityScore,
      wordDifficulty: getWordDifficultyAnchor(wordObj),
      isCorrect,
      outcomeValue: placementOutcome,
      kFactor: wordGamePlacementCalibrationStep,
      logisticScale: ABILITY_LOGISTIC_SCALE,
      exerciseBias:
        (window.WordGamePolicy.DEFAULT_MODE_BIASES[mode] ?? 0) +
        learnedExerciseBias,
      minimum: ABILITY_MIN,
      maximum: ABILITY_MAX,
    });
    wordGamePlacementCalibrationStep = Math.max(
      PLACEMENT_CALIBRATION_MIN_STEP,
      wordGamePlacementCalibrationStep * PLACEMENT_CALIBRATION_STEP_DECAY,
    );
    saveAbilityState({ syncRemote: false, cloudPending: true });
    return;
  }

  abilityScore = window.WordGamePolicy.getAbilityAfterAnswer({
    ability: abilityScore,
    wordDifficulty: getWordDifficultyAnchor(wordObj),
    isCorrect,
    outcomeValue,
    kFactor: ABILITY_K_FACTOR,
    logisticScale: ABILITY_LOGISTIC_SCALE,
    exerciseBias:
      (window.WordGamePolicy.DEFAULT_MODE_BIASES[mode] ?? 0) +
      learnedExerciseBias,
    minimum: ABILITY_MIN,
    maximum: ABILITY_MAX,
  });
  // Keep the continuously-adaptive estimate durable locally after every
  // answer, but send it to Firestore once for the completed round below.
  saveAbilityState({ syncRemote: false, cloudPending: true });
}

function updateGameEnglishTranslationVisibility() {
  document
    .querySelectorAll(".game-cefr-spacer .game-english-translation")
    .forEach((translationElement) => {
      if (
        translationElement.classList.contains(
          "game-english-translation-required",
        )
      ) {
        translationElement.style.display = "inline-block";
        return;
      }

      translationElement.style.display = isEnglishVisible
        ? "inline-block"
        : "none";
    });
}

function syncGameEnglishControls() {
  const englishSelect = document.getElementById("game-english-select");
  if (englishSelect) {
    englishSelect.value = isEnglishVisible ? "show-english" : "hide-english";
  }

  const toggleButton = document.getElementById("game-english-toggle-btn");
  if (!toggleButton) return;

  const action = isEnglishVisible ? "Hide" : "Show";
  const label = `${action} example translations`;
  toggleButton.setAttribute("aria-label", label);
  toggleButton.setAttribute("aria-pressed", String(isEnglishVisible));
  toggleButton.title = label;
  const visibleLabel = toggleButton.querySelector(
    ".game-english-toggle-label",
  );
  if (visibleLabel) {
    visibleLabel.textContent = `${action} translations`;
  }
}

function toggleGameEnglish() {
  const englishSelect = document.getElementById("game-english-select");
  if (!englishSelect) return;
  setEnglishVisible(englishSelect.value === "show-english");
  syncGameEnglishControls();
  updateGameEnglishTranslationVisibility();
}

function toggleGameEnglishButton() {
  setEnglishVisible(!isEnglishVisible);
  syncGameEnglishControls();
  updateGameEnglishTranslationVisibility();
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

// `instructionHTML`, when given, is only used the first time this question's
// stats box is built (see the .game-stats-wrapper guard below) -- every
// caller that isn't the initial render from renderWordGameUI/
// renderClozeGameUI omits it, which is fine, since by then the instruction
// line these two functions render is already in the DOM.
function renderStats(instructionHTML = "") {
  const statsContainer = document.getElementById("game-session-stats");
  if (!statsContainer) return;

  const total = recentAnswers.length;
  const correctCount = recentAnswers.reduce((a, b) => a + b, 0);
  const correctPercentage = total > 0 ? (correctCount / total) * 100 : 0;
  const wordsToReview = incorrectWordQueue.length;

  // Purely descriptive of recent accuracy, not relative to any level
  // threshold — there's nothing here to rise or fall from. Colors are
  // literal (a plain JS var can't read a CSS custom property) but kept in
  // sync with 00-foundations-and-game.css's tokens by name in each comment.
  let fillColor = "#d7ecc9"; // matches --color-success-bg
  let fontColor = "#254a1d"; // matches --color-success-text

  if (total === 0) {
    // Before the user answers any question
    fillColor = "#e0e0e0"; // matches --color-surface-strong
    fontColor = "#4a4a4a"; // matches --color-text-strong
  } else if (correctPercentage < 60) {
    fillColor = "#f0c1b3"; // matches --color-danger-bg
    fontColor = "#6b2814"; // matches --color-danger-text
  } else if (correctPercentage < 85) {
    fillColor = "#f2d96b"; // matches --color-level-mid
    fontColor = "#b3541e"; // matches --color-streak-text
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
  // instructionHTML (the question prompt, e.g. "Choose the English
  // meaning") is nested inside this same column, right under the bar,
  // rather than being a separate row spanning the whole stats block --
  // that separate row used to leave a blank gutter beside the (shorter)
  // correct/incorrect boxes, pushing the word card down for no reason.
  // Stacking it in here instead means the row's total height is just
  // whichever column is naturally tallest, with no leftover dead space.
  const instructionMarkup = instructionHTML
    ? `<p class="game-instruction">${instructionHTML}</p>`
    : "";

  const middleContentHTML = isSessionRound
    ? `<div class="game-stats-progress-wrapper" style="flex-grow: 1;">
         <p class="game-stat-label">Round progress</p>
         <div class="game-stats-accuracy-row">
           <div class="game-session-progress-bg" style="display: flex; align-items: center;">
             <div class="game-session-progress-fill" id="game-session-progress-fill"
               style="position: absolute; top: 0; left: 0; bottom: 0; width: ${getWordGameSessionProgressPercent()}%;"></div>
             <p class="game-session-progress-label" id="game-session-progress"
               style="position: relative; width: 100%; text-align: center; margin: 0; user-select: none;
                      font-family: 'Noto Sans', sans-serif; font-size: 14px; font-weight: 500;
                      z-index: 1; color: var(--color-text-strong);">
               ${getWordGameSessionProgressLabel()}
             </p>
           </div>
         </div>
         ${instructionMarkup}
       </div>`
    : `<div class="game-stats-progress-wrapper" style="flex-grow: 1;">
         <p class="game-stat-label">Recent accuracy</p>
         <div class="game-stats-accuracy-row">
           <div class="level-progress-bar-bg">
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
         ${instructionMarkup}
       </div>`;

  // Placement is assessment, not mastery practice. A miss helps tune the
  // starting level and is saved for later review, but the live placement UI
  // should never frame it as a debt that blocks completion. Gated on
  // calibration actually being enabled, not just wordGameIsPlacementRound —
  // "skip placement" still starts this same round shape, but with no
  // assessment happening, it should look and behave like ordinary practice.
  const leftStatHTML = wordGamePlacementCalibrationEnabled
    ? ""
    : `<div class="game-stats-correct-box">
         <p class="game-stat-label">Correct in a row</p>
         <p id="streak-count">${correctStreak}</p>
       </div>`;
  const rightStatHTML = wordGamePlacementCalibrationEnabled
    ? ""
    : `<div class="game-stats-incorrect-box">
         <p class="game-stat-label">Words to review</p>
         <p id="review-count">${wordsToReview}</p>
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
          ${leftStatHTML}
          ${middleContentHTML}
          ${rightStatHTML}
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

// Excludes both vulgar headwords (noRandom.js) and single-letter alphabet
// entries (noRandomLetters.js, e.g. "å" glossed as just "the letter å") from
// random selection — quizzing a learner on either isn't a useful vocabulary
// question. Story hints intentionally do NOT use this: they only apply the
// vulgar-word half, since a story needs "å"'s real senses (infinitive
// marker, "ah", "stream"), just not its random-pick eligibility. See
// resolveStoryWordEntries in stories.js.
function isExcludedFromRandomSelection(ord) {
  const normalized = normalizeGameAnswer(ord);
  return noRandom.includes(normalized) || noRandomLetters.includes(normalized);
}

// Folds the three Norwegian letters a learner is most likely to type without
// their special character — æ/ø/å typed as ae/o/a on a keyboard that lacks
// them — plus any other combining diacritic (accented loanwords), so those
// near-misses fold to the same comparison key as the correctly-spelled
// answer. Only ever consulted as a fallback after an exact match already
// failed (see isCloseEnoughTypedAnswer) — never loosens what a correctly
// spelled wrong word compares equal to.
function foldGameDiacritics(value) {
  return String(value ?? "")
    .toLocaleLowerCase("nb-NO")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// True once the running edit distance between a and b is certain to exceed
// maxDistance, so isCloseEnoughTypedAnswer can bail out of a wildly
// different guess without finishing the full O(len(a)*len(b)) table.
function levenshteinWithinDistance(a, b, maxDistance) {
  if (Math.abs(a.length - b.length) > maxDistance) return false;

  let previousRow = Array.from({ length: b.length + 1 }, (_, j) => j);

  for (let i = 1; i <= a.length; i++) {
    const currentRow = [i];
    let rowMin = i;

    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previousRow[j] + 1, // deletion
        currentRow[j - 1] + 1, // insertion
        previousRow[j - 1] + substitutionCost, // substitution
      );
      currentRow.push(value);
      rowMin = Math.min(rowMin, value);
    }

    if (rowMin > maxDistance) return false; // every cell in this row already overshoots
    previousRow = currentRow;
  }

  return previousRow[b.length] <= maxDistance;
}

// A typed recall answer is graded a match if it's exactly right (after the
// usual whitespace/case normalization, handled by the caller), or if it's a
// near-miss: the same word missing its æ/ø/å, or within a small edit-distance
// budget that scales with word length. The game is testing recall of the
// word, not spelling precision, and an exact-string requirement penalizes
// learners for keyboard limitations or minor typos rather than not knowing
// the word. Never applied to multiple-choice answers — a click always
// reproduces the option's exact displayed text, so a mismatch there always
// means a different word was chosen, not a typo.
function isCloseEnoughTypedAnswer(typedAnswer, acceptedAnswer) {
  if (!typedAnswer || !acceptedAnswer) return false;
  if (typedAnswer === acceptedAnswer) return true;
  if (foldGameDiacritics(typedAnswer) === foldGameDiacritics(acceptedAnswer)) {
    return true;
  }

  // Same ASCII-keyboard spellings Word Search already accepts (scripts.js'
  // getNorwegianKeyboardVariants/resolveWordSearchQuery) — å/æ/ø typed as
  // aa/ae/oe, not just the single-letter a/o fold above. "aapen" should be
  // accepted for "åpen" here the same way searching "aapen" already
  // resolves to it.
  if (
    typeof getNorwegianKeyboardVariants === "function" &&
    typeof normalizeSearchText === "function" &&
    getNorwegianKeyboardVariants(acceptedAnswer).includes(
      normalizeSearchText(typedAnswer),
    )
  ) {
    return true;
  }

  const maxDistance =
    acceptedAnswer.length <= 4 ? 0 : acceptedAnswer.length <= 8 ? 1 : 2;
  if (maxDistance === 0) return false;

  return levenshteinWithinDistance(typedAnswer, acceptedAnswer, maxDistance);
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

function getEnglishEntryVariants(entry) {
  return String(entry?.engelsk ?? "")
    .split(",")
    .map(normalizeGameAnswer)
    .filter(Boolean);
}

// scripts.js (which defines escapeHTML) always loads before this file — see
// index.html's script order.
function escapeGameHTML(value) {
  return escapeHTML(value);
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

function getTypedRecallProbability(wordObj, mode, exercise = null) {
  const readiness = TYPED_RECALL_READINESS[mode];
  if (!readiness) return 0;

  const a0SupportIntensity =
    typeof getActiveA0SupportIntensity === "function"
      ? getActiveA0SupportIntensity()
      : 0;
  if (
    a0SupportIntensity > 0.05 &&
    typeof getA0RecognitionEvidence === "function" &&
    getA0RecognitionEvidence(wordObj) < 2
  ) {
    return 0;
  }

  const skill = getQuestionSkillForMode(mode);
  const snapshot =
    window.WordStrengthAPI?.getSkillSnapshot?.(wordObj, skill) ??
    window.WordStrengthAPI?.getSnapshot?.(wordObj);
  // A word that's failed unusually often relative to how many times it's
  // actually been tested (see SpacedRepetition.isChronicallyStruggling)
  // stays in scaffolded multiple-choice/cloze form regardless of its
  // current strength reading — strength can bounce back up quickly after
  // just one lucky correct guess (scheduleCorrect's "learning" branch), so
  // a chronic pattern wouldn't otherwise show up here until strength
  // dropped again too. Free play only: a structured round (daily quest/
  // bonus) that forces a typed question via forceTypedReverse bypasses this
  // function entirely, matching those rounds' own fixed-recipe design.
  const predictedSuccess = predictQuestionSuccess(
    wordObj,
    mode,
    Date.now(),
    exercise,
  );
  return window.WordGamePolicy.getTypedRecallProbability(
    predictedSuccess,
    readiness,
    {
      isRelearning: snapshot?.queue === "relearning",
      isChronicallyStruggling: Boolean(
        window.SpacedRepetition?.isChronicallyStruggling?.(snapshot?.record),
      ),
    },
  );
}

function shouldUseTypedRecall(
  wordObj,
  mode,
  randomValue = Math.random(),
  exercise = null,
) {
  return randomValue < getTypedRecallProbability(wordObj, mode, exercise);
}

// --- On-device word/exercise success prediction --------------------------
// This predictor deliberately stays small and inspectable. It combines the
// ability estimate, skill-specific SRS retrievability, format/word/context
// difficulty, and separate mode and skill calibration. Response time, near
// misses, and likely guesses refine that calibration locally; no answer
// history leaves the device, and storage failure degrades to static priors.
const QUESTION_PAIR_PREDICTOR_STORAGE_KEY =
  "norwegian-dictionary-question-pair-predictor-v1";
const PREDICTION_EVALUATION_STORAGE_KEY =
  "norwegian-dictionary-prediction-evaluation-v1";
const QUESTION_PAIR_PREDICTOR_VERSION = 2;
const PREDICTION_EVALUATION_VERSION = 1;
const QUESTION_PAIR_TARGET_SUCCESS = 0.85;
const QUESTION_PAIR_TARGET_SIGMA = 0.1;
const QUESTION_PAIR_CHALLENGE_FLOOR = 0.1;
const QUESTION_PAIR_CALIBRATION_LIMIT = 1.5;
const QUESTION_PAIR_MODE_BIAS = window.WordGamePolicy.DEFAULT_MODE_BIASES;

function getQuestionSkillForMode(mode) {
  return window.WordGamePolicy.getQuestionSkill(mode);
}

function normalizeQuestionPairPredictorState(value) {
  return window.WordGamePolicy.normalizePredictorState(value, {
    version: QUESTION_PAIR_PREDICTOR_VERSION,
    modeBiases: QUESTION_PAIR_MODE_BIAS,
    calibrationLimit: QUESTION_PAIR_CALIBRATION_LIMIT,
  });
}

function loadQuestionPairPredictorState() {
  try {
    const stored = JSON.parse(
      window.localStorage?.getItem(QUESTION_PAIR_PREDICTOR_STORAGE_KEY) ||
        "null",
    );
    if (
      stored?.version === 1 ||
      stored?.version === QUESTION_PAIR_PREDICTOR_VERSION
    ) {
      return normalizeQuestionPairPredictorState(stored);
    }
  } catch (_error) {
    // A private/restricted storage context should not block the game.
  }
  return normalizeQuestionPairPredictorState(null);
}

let questionPairPredictorState = loadQuestionPairPredictorState();

function loadPredictionEvaluationState() {
  try {
    const stored = JSON.parse(
      window.localStorage?.getItem(PREDICTION_EVALUATION_STORAGE_KEY) ||
        "null",
    );
    return window.WordGamePolicy.normalizePredictionEvaluationState(
      stored?.version === PREDICTION_EVALUATION_VERSION ? stored : null,
      PREDICTION_EVALUATION_VERSION,
    );
  } catch (_error) {
    return window.WordGamePolicy.normalizePredictionEvaluationState(
      null,
      PREDICTION_EVALUATION_VERSION,
    );
  }
}

let predictionEvaluationState = loadPredictionEvaluationState();

function saveQuestionPairPredictorState() {
  try {
    window.localStorage?.setItem(
      QUESTION_PAIR_PREDICTOR_STORAGE_KEY,
      JSON.stringify(questionPairPredictorState),
    );
  } catch (_error) {
    // The in-memory calibration still improves this visit.
  }
}

function savePredictionEvaluationState() {
  try {
    window.localStorage?.setItem(
      PREDICTION_EVALUATION_STORAGE_KEY,
      JSON.stringify(predictionEvaluationState),
    );
  } catch (_error) {
    // Evaluation is diagnostic only; prediction and gameplay continue.
  }
}

function getPredictionDifficultyBucket(wordDifficulty) {
  const value = Number(wordDifficulty);
  if (!Number.isFinite(value)) return "unknown";
  if (value < 200) return "0-199";
  if (value < 400) return "200-399";
  if (value < 600) return "400-599";
  if (value < 800) return "600-799";
  return "800-1000";
}

function getPredictionCalibrationReport() {
  return window.WordGamePolicy.getPredictionEvaluationReport(
    predictionEvaluationState,
    PREDICTION_EVALUATION_VERSION,
  );
}

function resetPredictionCalibrationReport() {
  predictionEvaluationState =
    window.WordGamePolicy.normalizePredictionEvaluationState(
      null,
      PREDICTION_EVALUATION_VERSION,
    );
  savePredictionEvaluationState();
  return getPredictionCalibrationReport();
}

function getQuestionLearnedBias(wordObj, mode, exercise = null) {
  const skill = getQuestionSkillForMode(mode);
  const modeState = questionPairPredictorState.modes[mode];
  const skillState = questionPairPredictorState.skills[skill];
  const renderedForm = exercise?.form || getPrimaryNorwegianForm(wordObj);
  const renderedSentence = exercise?.sentence ?? wordObj?.eksempel;
  return (
    (modeState?.bias ?? 0) +
    (skillState?.bias ?? 0) +
    0.5 *
      (window.WordGamePolicy.getCalibrationEvidenceBias(modeState, mode) +
        window.WordGamePolicy.getCalibrationEvidenceBias(skillState, mode)) +
    window.WordGamePolicy.getQuestionComplexityBias({
      mode,
      formLength: Array.from(renderedForm).length,
      formTokenCount: normalizeGameWhitespace(
        renderedForm,
      ).split(" ").length,
      sentenceTokenCount: normalizeGameWhitespace(renderedSentence)
        .split(" ")
        .filter(Boolean).length,
      sentenceVocabularySuccess: exercise?.sentenceVocabularySuccess,
      targetContextCoverage: exercise?.targetContextCoverage,
      distractorSimilarity: exercise?.distractorSimilarity,
      translationAvailable: exercise?.translationAvailable,
      audioAvailable: exercise?.audioAvailable,
    })
  );
}

function predictQuestionSuccess(
  wordObj,
  mode,
  now = Date.now(),
  exercise = null,
) {
  const effectiveAbility = Number.isFinite(abilityScore)
    ? abilityScore
    : CEFR_DIFFICULTY_ANCHOR.A1;
  const abilityProbability = getExpectedSuccessProbability(
    getWordDifficultyAnchor(wordObj),
    effectiveAbility,
  );
  const skill = getQuestionSkillForMode(mode);
  const snapshot =
    window.WordStrengthAPI?.getSkillSnapshot?.(wordObj, skill, now) ??
    window.WordStrengthAPI?.getSnapshot?.(wordObj, now);
  const hasPersonalMemory = Boolean(snapshot?.record);
  const retrievability = Number(snapshot?.retrievability);
  const modeBias = QUESTION_PAIR_MODE_BIAS[mode] ?? 0;
  const learnedBias = getQuestionLearnedBias(wordObj, mode, exercise);

  return window.WordGamePolicy.predictSuccess({
    abilityProbability,
    hasPersonalMemory,
    retrievability,
    modeBias,
    learnedBias,
  });
}

function getQuestionPairChallengeFit(predictedSuccess) {
  return window.WordGamePolicy.getChallengeFit(predictedSuccess, {
    targetSuccess: QUESTION_PAIR_TARGET_SUCCESS,
    sigma: QUESTION_PAIR_TARGET_SIGMA,
    floor: QUESTION_PAIR_CHALLENGE_FLOOR,
  });
}

const QUESTION_MODE_PREREQUISITE =
  window.WordGamePolicy.DEFAULT_MODE_PREREQUISITES;
const QUESTION_PROGRESSION_FLOOR = 0.15;
const QUESTION_PROGRESSION_START = 0.65;
const QUESTION_PROGRESSION_FULL = 0.9;

function getQuestionProgressionWeight(wordObj, mode) {
  const prerequisiteMode = QUESTION_MODE_PREREQUISITE[mode];
  if (!prerequisiteMode) return 1;

  const prerequisiteSuccess = predictQuestionSuccess(
    wordObj,
    prerequisiteMode,
  );
  return window.WordGamePolicy.getProgressionWeight(prerequisiteSuccess, {
    floor: QUESTION_PROGRESSION_FLOOR,
    start: QUESTION_PROGRESSION_START,
    full: QUESTION_PROGRESSION_FULL,
  });
}

function getQuestionSkillUrgencyWeight(wordObj, mode, now = Date.now()) {
  const overall = window.WordStrengthAPI?.getSnapshot?.(wordObj, now);
  const skill = getQuestionSkillForMode(mode);
  const snapshot =
    window.WordStrengthAPI?.getSkillSnapshot?.(wordObj, skill, now) ?? overall;
  return window.WordGamePolicy.getSkillUrgencyWeight(overall, snapshot);
}

function beginQuestionPrediction(wordObj, mode, exercise = null) {
  const wordDifficulty = getWordDifficultyAnchor(wordObj);
  currentQuestionPrediction = {
    mode,
    skill: getQuestionSkillForMode(mode),
    predictedSuccess: predictQuestionSuccess(
      wordObj,
      mode,
      Date.now(),
      exercise,
    ),
    wordDifficulty,
    difficultyBucket: getPredictionDifficultyBucket(wordDifficulty),
    exercise,
    startedAt: Date.now(),
  };
}

function recordQuestionPredictionOutcome(
  wasCorrect,
  {
    nearMiss = false,
    morphologyNearMiss = false,
    wasTyped = false,
    wasScaffolded = false,
  } = {},
) {
  const prediction = currentQuestionPrediction;
  if (!prediction || !(prediction.mode in QUESTION_PAIR_MODE_BIAS)) return null;

  const responseTimeMs = Math.max(0, Date.now() - prediction.startedAt);
  const possiblyGuessed = !wasTyped && responseTimeMs < 900;
  const evidenceWeight =
    (possiblyGuessed ? 0.5 : 1) *
    (wasScaffolded ? 0.7 : 1) *
    (nearMiss || morphologyNearMiss ? 0.8 : 1);
  const outcomeValue = nearMiss
    ? 0.8
    : morphologyNearMiss
      ? 0.4
      : wasCorrect
        ? 1
        : 0;
  const calibrationOptions = {
    calibrationLimit: QUESTION_PAIR_CALIBRATION_LIMIT,
    evidenceWeight: evidenceWeight * 0.5,
    outcomeValue,
    responseTimeMs,
    nearMiss: nearMiss || morphologyNearMiss,
    possiblyGuessed,
  };

  questionPairPredictorState.modes[prediction.mode] =
    window.WordGamePolicy.updateCalibrationMode(
      questionPairPredictorState.modes[prediction.mode],
      prediction.predictedSuccess,
      wasCorrect,
      calibrationOptions,
    );
  questionPairPredictorState.skills[prediction.skill] =
    window.WordGamePolicy.updateCalibrationMode(
      questionPairPredictorState.skills[prediction.skill],
      prediction.predictedSuccess,
      wasCorrect,
      calibrationOptions,
    );
  predictionEvaluationState =
    window.WordGamePolicy.recordPredictionEvaluation(
      predictionEvaluationState,
      {
        mode: prediction.mode,
        difficultyBucket: prediction.difficultyBucket,
        predictedSuccess: prediction.predictedSuccess,
        wasCorrect,
        nearMiss: nearMiss || morphologyNearMiss,
      },
      PREDICTION_EVALUATION_VERSION,
    );
  currentQuestionPrediction = null;
  saveQuestionPairPredictorState();
  savePredictionEvaluationState();
  return {
    ...prediction,
    responseTimeMs,
    nearMiss,
    morphologyNearMiss,
    possiblyGuessed,
  };
}

let predictionEntryIndex = null;
let predictionEntryIndexSource = null;

function getPredictionEntryIndex() {
  if (typeof results === "undefined") return null;
  if (predictionEntryIndex && predictionEntryIndexSource === results) {
    return predictionEntryIndex;
  }

  const index = new Map();
  for (const entry of results) {
    const wordClass = WordClass.getWordClass(entry?.gender);
    for (const lemma of getNorwegianEntryVariants(entry)) {
      const key = `${wordClass}:${normalizeGameAnswer(lemma)}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(entry);
    }
  }
  predictionEntryIndex = index;
  predictionEntryIndexSource = results;
  return index;
}

async function getRenderedSentenceVocabularySuccess(clozeTarget) {
  if (
    !clozeTarget?.sentence ||
    typeof window.Inflections?.findLemmas !== "function"
  ) {
    return null;
  }

  const tokens = Array.from(
    clozeTarget.sentence.matchAll(
      /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu,
    ),
    (match) => ({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    }),
  ).filter(
    (token) =>
      token.end <= clozeTarget.startIndex ||
      token.start >= clozeTarget.endIndex,
  );
  if (tokens.length === 0) return null;

  const entryIndex = getPredictionEntryIndex();
  if (!entryIndex) return null;

  const resolved = await Promise.all(
    tokens.map((token) =>
      window.Inflections.findLemmas(token.text).catch(() => null),
    ),
  );
  const tokenSuccesses = resolved.map((resolution) => {
    const entries = (resolution?.matches || []).flatMap(
      ({ lemma, wordClass }) =>
        entryIndex.get(`${wordClass}:${normalizeGameAnswer(lemma)}`) || [],
    );
    if (entries.length === 0) return null;
    // If a visible form has several dictionary senses, comprehension only
    // requires the easiest plausible one. This also prevents a rare
    // homograph from making an otherwise elementary sentence look hard.
    return Math.max(
      ...entries.map((entry) =>
        getExpectedSuccessProbability(
          getWordDifficultyAnchor(entry),
          Number.isFinite(abilityScore)
            ? abilityScore
            : CEFR_DIFFICULTY_ANCHOR.A1,
        ),
      ),
    );
  });
  const known = tokenSuccesses.filter(Number.isFinite);
  if (known.length === 0) return null;

  const knownMean = known.reduce((sum, value) => sum + value, 0) / known.length;
  const coverage = known.length / tokenSuccesses.length;
  // Unresolved tokens are neutral rather than automatically "hard": names,
  // numbers, and transparent compounds are common in otherwise easy prose.
  return knownMean * coverage + 0.75 * (1 - coverage);
}

function getRenderedTargetContextCoverage(clozeTarget) {
  if (!clozeTarget?.sentence) return null;
  const tokens = Array.from(
    clozeTarget.sentence.matchAll(
      /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu,
    ),
    (match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }),
  );
  const before = tokens.filter(
    (token) => token.end <= clozeTarget.startIndex,
  ).length;
  const after = tokens.filter(
    (token) => token.start >= clozeTarget.endIndex,
  ).length;
  return (Math.min(before, 3) + Math.min(after, 3)) / 6;
}

function getRenderedChoiceSimilarity(correctChoice, choices) {
  const correct = normalizeGameAnswer(correctChoice);
  const alternatives = (choices || [])
    .map(normalizeGameAnswer)
    .filter((choice) => choice && choice !== correct);
  if (!correct || alternatives.length === 0) return null;

  const getBigrams = (value) => {
    const characters = Array.from(value);
    if (characters.length < 2) return new Set(characters);
    return new Set(
      characters.slice(0, -1).map((character, index) =>
        character + characters[index + 1],
      ),
    );
  };
  const correctBigrams = getBigrams(correct);
  const similarities = alternatives.map((choice) => {
    const choiceBigrams = getBigrams(choice);
    const overlap = [...correctBigrams].filter((part) =>
      choiceBigrams.has(part),
    ).length;
    const dice =
      correctBigrams.size + choiceBigrams.size > 0
        ? (2 * overlap) / (correctBigrams.size + choiceBigrams.size)
        : 0;
    const lengthSimilarity =
      Math.min(Array.from(correct).length, Array.from(choice).length) /
      Math.max(Array.from(correct).length, Array.from(choice).length, 1);
    return 0.75 * dice + 0.25 * lengthSimilarity;
  });
  return similarities.reduce((sum, value) => sum + value, 0) /
    similarities.length;
}

async function buildRenderedClozePredictionExercise(
  wordObj,
  mode,
  clozeTarget,
  choices,
  correctChoice,
) {
  const sentenceTranslation = getClozeTargetTranslation(wordObj, clozeTarget);
  return {
    form: correctChoice,
    sentence: clozeTarget.sentence,
    sentenceVocabularySuccess:
      await getRenderedSentenceVocabularySuccess(clozeTarget),
    targetContextCoverage: getRenderedTargetContextCoverage(clozeTarget),
    distractorSimilarity: getRenderedChoiceSimilarity(correctChoice, choices),
    translationAvailable:
      mode === "typed-cloze" && Boolean(sentenceTranslation),
    // Cloze sentence audio is intentionally locked until after grading, so
    // it is not an available pre-answer cue even when the source has audio.
    audioAvailable: false,
    isVariedContext: Boolean(clozeTarget.isVariedContext),
  };
}

function addQuestionModeCandidate(candidates, mode, weight) {
  if (!(weight > 0)) return;
  const existing = candidates.find((candidate) => candidate.mode === mode);
  if (existing) {
    existing.weight += weight;
  } else {
    candidates.push({ mode, weight });
  }
}

function splitTypedQuestionMode(candidates, wordObj, mode, weight) {
  const typedProbability = getTypedRecallProbability(wordObj, mode);
  const typedMode = `typed-${mode}`;
  const typedIsUsable =
    mode === "listening" || Boolean(getGameSentenceTranslation(wordObj, 0));
  if (!typedIsUsable || !(typedMode in QUESTION_PAIR_MODE_BIAS)) {
    addQuestionModeCandidate(candidates, mode, weight);
    return;
  }
  addQuestionModeCandidate(
    candidates,
    typedMode,
    weight * typedProbability,
  );
  addQuestionModeCandidate(
    candidates,
    mode,
    weight * (1 - typedProbability),
  );
}

function getPlacementQuestionMode(wordObj) {
  const questionIndex = Math.max(
    0,
    Math.floor(Number(wordGameSessionQuestionsAnswered) || 0),
  );
  const plannedMode =
    PLACEMENT_QUESTION_PLAN[questionIndex] ?? "forward";

  // The normal renderer can safely fall back from a failed cloze build, but
  // listening and typed recall need a usable prompt before rendering. Keep
  // the placement's promised skill sample whenever the data supports it and
  // use a meaningful lower-friction alternative when it does not.
  if (
    (plannedMode === "listening" || plannedMode === "typed-listening") &&
    !hasPlayableWordAudio(wordObj)
  ) {
    return "forward";
  }
  if (
    plannedMode === "typed-reverse" &&
    !getGameSentenceTranslation(wordObj, 0)
  ) {
    return "reverse";
  }

  return plannedMode;
}

function getStructuredQuestionModeForWord(wordObj) {
  const hasAudio = hasPlayableWordAudio(wordObj);
  if (wordGameIsPlacementRound) return getPlacementQuestionMode(wordObj);
  if (wordGameIsTodayPracticeRound) {
    return getDailyQuestQuestionMode(
      wordGameDailyQuestIndex,
      wordGameSessionQuestionsAnswered,
      hasAudio,
    );
  }
  if (wordGameIsBonusRound) {
    return getBonusRoundQuestionMode(
      wordGameSessionIntroducedWords.size,
      hasAudio,
    );
  }
  return null;
}

function getQuestionModeCandidates(wordObj) {
  const candidates = [];
  const structuredMode = getStructuredQuestionModeForWord(wordObj);
  if (structuredMode === "typed-reverse") {
    return [{ mode: "typed-reverse", weight: 1 }];
  }
  if (structuredMode) {
    // Placement's modes are deliberately prescribed. In particular, its two
    // listening samples are multiple choice and its short production samples
    // are typed; allowing ordinary typed-readiness randomness here could turn
    // a first listening exposure into dictation or omit production entirely.
    if (wordGameIsPlacementRound) {
      return [{ mode: structuredMode, weight: 1 }];
    }
    if (["cloze", "listening", "reverse"].includes(structuredMode)) {
      splitTypedQuestionMode(candidates, wordObj, structuredMode, 1);
    } else {
      addQuestionModeCandidate(candidates, structuredMode, 1);
    }
    return candidates;
  }

  const hasAudio = hasPlayableWordAudio(wordObj);
  const listeningProbability = hasAudio
    ? interpolateByAbility(abilityScore, LISTENING_PROBABILITY) ?? 0.25
    : 0;
  const reverseProbability =
    interpolateByAbility(abilityScore, REVERSE_FLASHCARD_PROBABILITY) ?? 0.25;
  let clozeWeight = 0.5;
  let listeningWeight = 0.5 * listeningProbability;
  let reverseWeight =
    0.5 * (1 - listeningProbability) * reverseProbability;
  const a0SupportIntensity =
    typeof getActiveA0SupportIntensity === "function"
      ? getActiveA0SupportIntensity()
      : 0;
  if (a0SupportIntensity > 0.05) {
    const recognitionEvidence =
      typeof getA0RecognitionEvidence === "function"
        ? getA0RecognitionEvidence(wordObj)
        : 0;
    // A completely new word remains recognition-only. Once recognition has
    // begun to stick, the other modes gain their ordinary share smoothly;
    // typed recall has its own stricter readiness gate below.
    if (recognitionEvidence < 1) {
      return [{ mode: "forward", weight: 1 }];
    }
    const familiarity = Math.min(1, recognitionEvidence / 2);
    clozeWeight *= 1 - a0SupportIntensity * (1 - familiarity);
    listeningWeight *= familiarity;
    reverseWeight *= familiarity;
  }
  let forwardWeight = 1 - clozeWeight - listeningWeight - reverseWeight;
  const canAttemptCloze =
    Boolean(String(wordObj?.eksempel ?? "").trim()) &&
    !BANNED_WORD_CLASSES.some((wordClass) =>
      String(wordObj?.gender ?? "").toLowerCase().startsWith(wordClass),
    );

  if (canAttemptCloze) {
    splitTypedQuestionMode(candidates, wordObj, "cloze", clozeWeight);
  } else {
    forwardWeight += clozeWeight;
  }
  splitTypedQuestionMode(
    candidates,
    wordObj,
    "listening",
    listeningWeight,
  );
  splitTypedQuestionMode(candidates, wordObj, "reverse", reverseWeight);
  addQuestionModeCandidate(candidates, "forward", forwardWeight);
  return candidates;
}

function getQuestionPairPlan(wordObj) {
  return window.WordGamePolicy.buildQuestionPairPlan(
    getQuestionModeCandidates(wordObj),
    {
      predict: (mode) => predictQuestionSuccess(wordObj, mode),
      challengeFit: getQuestionPairChallengeFit,
      progressionWeight: (mode) =>
        getQuestionProgressionWeight(wordObj, mode),
      urgencyWeight: (mode) =>
        getQuestionSkillUrgencyWeight(wordObj, mode),
    },
  );
}

function chooseQuestionModeFromPlan(plan) {
  if (!plan?.candidates?.length) return "forward";
  const weights = plan.candidates.map((candidate) => candidate.pairWeight);
  return pickWeightedGameWord(plan.candidates, weights)?.mode ?? "forward";
}

function getClozeSynonymForms(wordObj, clozeTarget) {
  if (
    clozeTarget?.kind !== "lexical" ||
    !["noun", "adjective", "verb"].includes(clozeTarget.wordClass) ||
    typeof results === "undefined"
  ) {
    return [];
  }

  const slotIndexes = [...new Set(clozeTarget.slotIndexes || [])].filter(
    Number.isInteger,
  );
  const targetEnglish = normalizeGameAnswer(
    getDisplayedAnswer(wordObj?.engelsk),
  );
  if (!targetEnglish || slotIndexes.length === 0) return [];

  const targetWordClass = clozeTarget.wordClass;
  const targetGender = clozeTarget.targetGender || wordObj?.gender;
  const acceptedAnswers = new Set();

  for (const candidate of results) {
    if (
      !getEnglishEntryVariants(candidate).includes(targetEnglish) ||
      WordClass.getWordClass(candidate?.gender) !== targetWordClass ||
      (targetWordClass === "noun" &&
        !WordClass.hasCompatibleGender(targetGender, candidate?.gender))
    ) {
      continue;
    }

    for (const variant of getNorwegianEntryVariants(candidate)) {
      const parts = getClozePatternTokens(normalizeGameAnswer(variant));
      if (parts.length !== 1 || parts[0] === "...") continue;

      const paradigm = window.Inflections?.getParadigmForLemma(
        parts[0],
        targetWordClass,
        targetWordClass === "noun" ? candidate.gender : "",
      );
      if (!paradigm) continue;

      // A surface form can occasionally match more than one grammatical
      // slot. Only accept a synonym form that is valid in every remaining
      // slot, so a present-tense cloze cannot accidentally accept a past or
      // infinitive form (and noun/adjective agreement remains exact too).
      const compatibleForms = slotIndexes.reduce((forms, slotIndex) => {
        const slotForms = paradigm.slots[slotIndex] || [];
        if (forms === null) return [...slotForms];
        const currentSlot = new Set(slotForms);
        return forms.filter((form) => currentSlot.has(form));
      }, null);

      for (const form of compatibleForms || []) {
        acceptedAnswers.add(
          clozeTarget.nounCase === "genitive"
            ? createNounGenitiveForm(form)
            : form,
        );
      }
    }
  }

  return [...acceptedAnswers];
}

const MORPHOLOGY_SLOT_LABELS = Object.freeze({
  noun: Object.freeze([
    "indefinite singular",
    "definite singular",
    "indefinite plural",
    "definite plural",
  ]),
  adjective: Object.freeze([
    "masculine form",
    "feminine form",
    "neuter form",
    "definite singular",
    "plural",
    "comparative",
    "superlative",
    "definite superlative",
  ]),
  verb: Object.freeze([
    "the infinitive",
    "present tense",
    "past tense",
    "the present-perfect participle",
    "the imperative",
  ]),
});

function getTypedMorphologyCandidateEntries(
  wordObj,
  { isCloze = false, isListening = false, clozeTarget = null } = {},
) {
  const targetWordClass = isCloze
    ? clozeTarget?.wordClass
    : WordClass.getWordClass(wordObj?.gender);
  if (!["noun", "adjective", "verb"].includes(targetWordClass)) return [];
  if (isCloze && clozeTarget?.kind !== "lexical") return [];
  if (isListening || typeof results === "undefined") return [wordObj];

  const targetEnglish = normalizeGameAnswer(
    getDisplayedAnswer(wordObj?.engelsk),
  );
  if (!targetEnglish) return [wordObj];
  const targetGender = clozeTarget?.targetGender || wordObj?.gender;
  return results.filter(
    (candidate) =>
      getEnglishEntryVariants(candidate).includes(targetEnglish) &&
      WordClass.getWordClass(candidate?.gender) === targetWordClass &&
      (targetWordClass !== "noun" ||
        WordClass.hasCompatibleGender(targetGender, candidate?.gender)),
  );
}

function getMorphologyRequiredForms(paradigm, slotIndexes, clozeTarget) {
  const forms = slotIndexes.reduce((accepted, slotIndex) => {
    const slotForms = paradigm.slots[slotIndex] || [];
    if (accepted === null) return [...slotForms];
    const currentSlot = new Set(slotForms);
    return accepted.filter((form) => currentSlot.has(form));
  }, null);
  return (forms || []).map((form) =>
    clozeTarget?.nounCase === "genitive"
      ? createNounGenitiveForm(form)
      : form,
  );
}

async function classifyTypedMorphologyNearMiss(
  wordObj,
  selectedAnswer,
  {
    isCloze = false,
    isReverse = false,
    isListening = false,
    clozeTarget = null,
    correctAnswer = "",
  } = {},
) {
  const normalizedSelected = normalizeGameAnswer(selectedAnswer);
  if (
    !normalizedSelected ||
    (!isCloze && !isReverse && !isListening) ||
    typeof window.Inflections?.findLemmas !== "function"
  ) {
    return null;
  }

  const candidates = getTypedMorphologyCandidateEntries(wordObj, {
    isCloze,
    isListening,
    clozeTarget,
  });
  const analyses = [];
  for (const candidate of candidates) {
    const wordClass = isCloze
      ? clozeTarget.wordClass
      : WordClass.getWordClass(candidate?.gender);
    const requiredSlots = isCloze
      ? [...new Set(clozeTarget?.slotIndexes || [])].filter(Number.isInteger)
      : [0];
    if (requiredSlots.length === 0) continue;

    for (const variant of getNorwegianEntryVariants(candidate)) {
      const parts = getClozePatternTokens(normalizeGameAnswer(variant));
      if (parts.length !== 1 || parts[0] === "...") continue;
      const paradigm = window.Inflections.getParadigmForLemma(
        parts[0],
        wordClass,
        wordClass === "noun" ? candidate.gender : "",
      );
      if (!paradigm) continue;
      const selectedSlots = paradigm.slots.flatMap((forms, slotIndex) =>
        forms.includes(normalizedSelected) ? [slotIndex] : [],
      );
      if (
        selectedSlots.length === 0 ||
        requiredSlots.every((slot) => selectedSlots.includes(slot))
      ) {
        continue;
      }
      const requiredForms = getMorphologyRequiredForms(
        paradigm,
        requiredSlots,
        clozeTarget,
      );
      if (requiredForms.length === 0) continue;
      analyses.push({
        lemma: parts[0],
        wordClass,
        selectedSlots,
        requiredSlots,
        requiredForms,
      });
    }
  }
  if (analyses.length === 0) return null;

  const resolution = await window.Inflections.findLemmas(selectedAnswer);
  if (!["exact", "possessive"].includes(resolution?.matchType)) return null;
  const relevantKeys = new Set(
    analyses.map(({ lemma, wordClass }) => `${wordClass}:${lemma}`),
  );
  const resolutionKeys = new Set(
    (resolution.matches || []).map(
      ({ lemma, wordClass }) =>
        `${wordClass}:${normalizeGameAnswer(lemma)}`,
    ),
  );
  if (![...resolutionKeys].some((key) => relevantKeys.has(key))) return null;
  const relevantWordClasses = new Set(
    analyses.map(({ wordClass }) => wordClass),
  );
  const contextualResolutionKeys = new Set(
    (resolution.matches || [])
      .filter(({ wordClass }) => relevantWordClasses.has(wordClass))
      .map(
        ({ lemma, wordClass }) =>
          `${wordClass}:${normalizeGameAnswer(lemma)}`,
      ),
  );

  let correction = analyses[0].requiredForms[0] || correctAnswer;
  if (isCloze && clozeTarget?.startsSentence) {
    correction = uppercaseFirstNorwegian(correction);
  }
  const selectedLabels = new Set(
    analyses.flatMap(({ selectedSlots, wordClass }) =>
      selectedSlots
        .map((slot) => MORPHOLOGY_SLOT_LABELS[wordClass]?.[slot])
        .filter(Boolean),
    ),
  );
  const requiredLabels = new Set(
    analyses.flatMap(({ requiredSlots, wordClass }) =>
      requiredSlots
        .map((slot) => MORPHOLOGY_SLOT_LABELS[wordClass]?.[slot])
        .filter(Boolean),
    ),
  );
  const isUnambiguous =
    contextualResolutionKeys.size === 1 &&
    selectedLabels.size === 1 &&
    requiredLabels.size === 1;
  let message = `Almost — this exercise needs “${correction}”.`;
  if (isUnambiguous) {
    const selectedLabel = [...selectedLabels][0];
    if (!isCloze && analyses[0].requiredSlots.includes(0)) {
      message = `Almost — “${selectedAnswer}” is ${selectedLabel}. This exercise asks for the dictionary form: “${correction}”.`;
    } else {
      const requiredLabel = [...requiredLabels][0];
      message = `Almost — “${selectedAnswer}” is ${selectedLabel}. This sentence needs ${requiredLabel}: “${correction}”.`;
    }
  }

  return {
    outcomeValue: 0.4,
    correction,
    message,
    selectedLabels: [...selectedLabels],
    requiredLabels: [...requiredLabels],
    isUnambiguous,
  };
}

function getTypedAcceptedAnswers(
  wordObj,
  isCloze,
  correctAnswer,
  clozeTarget = null,
) {
  if (isCloze) {
    return [
      ...new Set([
        normalizeGameWhitespace(correctAnswer),
        ...getClozeSynonymForms(wordObj, clozeTarget),
      ]),
    ];
  }

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
      !getEnglishEntryVariants(candidate).includes(targetEnglish) ||
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

function getClozeTargetTranslation(wordObj, clozeTarget) {
  if (clozeTarget && Object.hasOwn(clozeTarget, "sentenceTranslation")) {
    return normalizeGameWhitespace(clozeTarget.sentenceTranslation);
  }
  return getGameSentenceTranslation(wordObj, clozeTarget?.sentenceIndex ?? 0);
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
    sentenceTranslation: getGameSentenceTranslation(wordObj, sentenceIndex),
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
        sentenceTranslation: getGameSentenceTranslation(wordObj, sentenceIndex),
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
        sentenceTranslation: getGameSentenceTranslation(wordObj, sentenceIndex),
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

const variedGameContextTargets = new WeakMap();

function getGameHomographEntries(wordObj) {
  if (!wordObj || typeof results === "undefined") return [wordObj].filter(Boolean);
  const selectedLemmas = new Set(
    getNorwegianEntryVariants(wordObj).map(normalizeGameAnswer).filter(Boolean),
  );
  return results.filter((entry) =>
    getNorwegianEntryVariants(entry).some((variant) =>
      selectedLemmas.has(normalizeGameAnswer(variant)),
    ),
  );
}

function hasCompetingGameHomograph(wordObj) {
  return getGameHomographEntries(wordObj).some((entry) => entry !== wordObj);
}

async function isVariedClozeTargetUnambiguous(wordObj, clozeTarget) {
  if (!wordObj || !clozeTarget) return false;
  if (WordClass.getWordClass(wordObj.gender) === "expression") return true;
  if (typeof window.Inflections?.findLemmas !== "function") return false;

  // Resolve across every word class. Asking only for the intended class
  // would hide precisely the cross-class homographs this gate must catch.
  const resolution = await window.Inflections.findLemmas(
    clozeTarget.surfaceForm,
  );
  if (!["exact", "possessive"].includes(resolution?.matchType)) return false;

  const selectedLemmas = new Set(
    getNorwegianEntryVariants(wordObj).map(normalizeGameAnswer).filter(Boolean),
  );
  const matches = resolution.matches || [];
  return (
    matches.length > 0 &&
    matches.every(
      (match) =>
        match.wordClass === clozeTarget.wordClass &&
        selectedLemmas.has(normalizeGameAnswer(match.lemma)),
    )
  );
}

async function buildVariedGameContextTargets(wordObj) {
  // Morphology can distinguish many surface forms, but it cannot distinguish
  // two dictionary senses with the same lemma. In that situation even a
  // perfectly matched sentence form is not evidence for the intended sense,
  // so variation stays disabled and the entry-owned sentence remains stable.
  if (
    !wordObj?.ord ||
    hasCompetingGameHomograph(wordObj) ||
    typeof window.SentenceFormMatching?.collectExamples !== "function"
  ) {
    return [];
  }

  const isExpression = WordClass.getWordClass(wordObj.gender) === "expression";
  const homographs = getGameHomographEntries(wordObj);
  let matcher;
  let candidateEntries = results;

  if (isExpression) {
    const analysis = await window.ExpressionPatterns?.getAnalysis(wordObj);
    if (!analysis?.matcher) return [];
    matcher = analysis.matcher;
    if (typeof getExpressionSentenceCandidates === "function") {
      candidateEntries = getExpressionSentenceCandidates(wordObj, analysis);
    }
  } else {
    const forms = await window.Inflections?.getSupplementalSentenceForms?.(
      wordObj,
      homographs,
    );
    if (!forms?.length) return [];
    matcher = window.SentenceFormMatching.createMatcher(forms);
  }

  const { supplemental } = window.SentenceFormMatching.collectExamples(
    wordObj,
    candidateEntries,
    matcher,
    40,
    homographs.filter((entry) => entry !== wordObj),
  );
  const targets = [];
  for (const example of supplemental) {
    const exampleEntry = {
      ...wordObj,
      eksempel: example.eksempel,
      sentenceTranslation: example.sentenceTranslation || "",
      sentenceAudio: example.sentenceAudio || "",
    };
    const target = await findClozeTarget(exampleEntry);
    if (!target || !(await isVariedClozeTargetUnambiguous(wordObj, target))) {
      continue;
    }
    target.isVariedContext = true;
    targets.push(target);
    if (targets.length >= 12) break;
  }
  return targets;
}

function getVariedGameContextTargets(wordObj) {
  if (!wordObj || (typeof wordObj !== "object" && typeof wordObj !== "function")) {
    return Promise.resolve([]);
  }
  if (!variedGameContextTargets.has(wordObj)) {
    variedGameContextTargets.set(
      wordObj,
      buildVariedGameContextTargets(wordObj).catch((error) => {
        console.warn("Could not build verified varied contexts.", error);
        return [];
      }),
    );
  }
  return variedGameContextTargets.get(wordObj);
}

async function findPracticeClozeTarget(wordObj) {
  const stableTarget = await findClozeTarget(wordObj);
  if (!stableTarget) return null;

  const contextSnapshot =
    window.WordStrengthAPI?.getSkillSnapshot?.(wordObj, "context") ?? null;
  if (!window.WordGamePolicy.shouldUseVariedContext(contextSnapshot)) {
    return stableTarget;
  }

  const variedTargets = await getVariedGameContextTargets(wordObj);
  const index = window.WordGamePolicy.getVariedContextIndex(
    contextSnapshot,
    variedTargets.length,
  );
  return index >= 0 ? variedTargets[index] : stableTarget;
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

// One geometric drawing and one set of facet roles keep every reward crisp
// and consistent at any size. Reward classes supply only the palette; quest
// state classes control whether the marker is locked, active, or earned.
function getDailyQuestGemMarkup(reward, extraClasses = "") {
  const safeReward = ["emerald", "ruby", "sapphire"].includes(reward)
    ? reward
    : "sapphire";
  const classNames = [
    "game-daily-quest-gem",
    `game-daily-quest-gem--${safeReward}`,
    extraClasses,
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <svg class="${classNames}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path class="quest-gem-frame" d="M16 9h32l12 16-28 32L4 25 16 9Z"></path>
      <path class="quest-gem-facet quest-gem-facet--top-left" d="M16 9h16l-8 16H4L16 9Z"></path>
      <path class="quest-gem-facet quest-gem-facet--top-center" d="M32 9 40 25H24L32 9Z"></path>
      <path class="quest-gem-facet quest-gem-facet--top-right" d="M32 9h16l12 16H40L32 9Z"></path>
      <path class="quest-gem-facet quest-gem-facet--lower-left" d="M4 25h20l8 32L4 25Z"></path>
      <path class="quest-gem-facet quest-gem-facet--lower-center" d="M24 25h16l-8 32-8-32Z"></path>
      <path class="quest-gem-facet quest-gem-facet--lower-right" d="M40 25h20L32 57l8-32Z"></path>
      <path class="quest-gem-highlight" d="m17 14-6 8h6l5-8h-5Z"></path>
      <g class="quest-gem-earned-mark">
        <circle cx="51" cy="13" r="9"></circle>
        <path d="m47 13 2.6 2.6 5.2-5.2"></path>
      </g>
    </svg>
  `;
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
          ${getDailyQuestGemMarkup(quest.reward)}
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
            ${getDailyQuestGemMarkup(quest.reward, "landing-daily-quest-gem")}
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
// So this instead splits off "unpracticed" (which has no record yet), then
// applies the 1-5 ladder to every practiced word. The scheduler's transient
// relearning state stays internal: a just-missed word still has a meaningful
// visible strength and should not jump into a separate user-facing category
// while it waits for its short retry.
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
const VOCAB_DASHBOARD_TIERS = VOCAB_LADDER_TIERS;

// snapshot: the object returned by SpacedRepetition.getSnapshot() /
// WordStrengthAPI.getSnapshot() — { record, queue, isDue, retrievability,
// strength }.
function getWordProgressTierId(snapshot) {
  if (!snapshot || snapshot.strength === null) return VOCAB_UNPRACTICED_TIER_ID;

  // Strength 0 can appear after a miss or after a short-interval word has
  // decayed for a long time. Both belong at the bottom rung of the visible
  // proficiency ladder; the retry queue remains an internal concern.
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
// unpracticed bucket first (the common case in All Words), then the same five
// ladder tiers and labels the landing dashboard uses.
function getVocabStrengthFilterOptions() {
  return [
    { id: VOCAB_UNPRACTICED_TIER_ID, label: "Not practiced yet" },
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
    container.hidden = true;
    container.innerHTML = "";
    return;
  }

  container.hidden = false;
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
  // selectType() enters startWordGame(), which renders placement for a
  // first-time learner. Do not immediately replace that screen with the
  // requested daily round; choosing a starting point will launch the new
  // learner's calibrated first practice round instead.
  if (!placementCompleted) return;
  beginTodayPracticeRound();
}

function beginTodayPracticeRound() {
  const progress = getDailyPracticeProgress();

  if (progress >= DAILY_QUESTS.length) {
    window.trackEvent?.("quest_started", { bonus: true });
    beginWordGameRound("session", DAILY_QUEST_ROUND_TARGET, {
      bonusRound: true,
    });
    return;
  }

  window.trackEvent?.("quest_started", { bonus: false, quest_index: progress });
  beginWordGameRound("session", DAILY_QUEST_ROUND_TARGET, {
    dailyQuestIndex: progress,
    todayPractice: true,
  });
}

function renderWordGameIntro() {
  // The intro screen only ever renders when no round is active (see
  // startWordGame's early-return gate), so this is the single choke point
  // to resync the toolbar's Quit/Report buttons to hidden — regardless of
  // how we got here (a fresh visit, quitting a round, or navigating away to
  // another top-nav view and back mid-round, which otherwise left them
  // stuck visible since nothing else on that path ever re-hides them).
  updateEndSessionToolbarButtonVisibility();

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
  const hasSavedMyWords =
    (window.MyWordsAPI?.getSavedEntries?.() ?? []).length > 0;
  const dailyButtonLabel = dailyComplete
    ? "Start bonus round"
    : `Start ${activeQuest.reward} round`;
  const morePracticeWasOpen = Boolean(
    document.querySelector(".game-more-practice")?.open,
  );
  const myWordsMixSummary =
    wordGameMyWordsShare === 0
      ? "Off"
      : `${getMyWordsShareValueLabel(wordGameMyWordsShare)} · ${getMyWordsShareDescriptionLabel(wordGameMyWordsShare)}`;

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
        <p class="game-today-practice-note">${nextLabel} · 10 questions</p>
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

      <details class="game-more-practice"${morePracticeWasOpen ? " open" : ""}>
        <summary>More practice options</summary>
        <div class="game-more-practice-content">
          ${
            hasSavedMyWords
              ? `
          <section class="game-my-words-mix" aria-labelledby="game-my-words-mix-heading">
            <div class="game-option-heading-row">
              <div>
                <h3 id="game-my-words-mix-heading">My Words in practice</h3>
                <p>Saved words: <strong>${myWordsMixSummary}</strong></p>
              </div>
            </div>
            <div class="game-my-words-options">
              ${MY_WORDS_SHARE_LEVELS.map(
                (share) => `
                <button
                  type="button"
                  class="game-my-words-option${share === wordGameMyWordsShare ? " is-selected" : ""}"
                  data-share="${share}"
                  aria-pressed="${share === wordGameMyWordsShare}"
                >
                  <span class="game-my-words-option-value">${getMyWordsShareValueLabel(share)}</span>
                  <span class="game-my-words-option-label">${getMyWordsShareDescriptionLabel(share)}</span>
                </button>
              `,
              ).join("")}
            </div>
          </section>
          `
              : ""
          }

          <section class="game-custom-rounds" aria-labelledby="game-custom-rounds-heading">
            <div class="game-option-heading-row">
              <div>
                <h3 id="game-custom-rounds-heading">Custom round</h3>
                <p>Choose a length, or keep going.</p>
              </div>
            </div>
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
          </section>

          <!-- Minimal pairs is deliberately separate from spaced repetition:
               it is a short listening drill and does not change progress. -->
          <section class="game-secondary-drill" aria-labelledby="game-secondary-drill-heading">
            <div class="game-option-heading-row">
              <div>
                <h3 id="game-secondary-drill-heading">Listening drill</h3>
                <p>Hear a word and choose between similar sounds.</p>
              </div>
              <button type="button" class="game-secondary-drill-btn" id="game-minimal-pairs-btn">
                <i class="fas fa-headphones" aria-hidden="true"></i>
                Minimal pairs
              </button>
            </div>
          </section>

          <button type="button" id="retake-placement-btn" class="placement-retake-link">
            Retake placement test
          </button>
        </div>
      </details>
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

  document
    .getElementById("game-minimal-pairs-btn")
    ?.addEventListener("click", startMinimalPairsGame);

  // A whole-screen re-render on click (rather than just toggling classes)
  // matches how every other choice on this screen behaves, and keeps the
  // selected-state bookkeeping in one place (the template above) instead of
  // duplicating it here.
  document.querySelectorAll(".game-my-words-option[data-share]").forEach((button) => {
    button.addEventListener("click", () => {
      const share = Number(button.dataset.share);
      if (!MY_WORDS_SHARE_LEVELS.includes(share)) return;

      wordGameMyWordsShare = share;
      wordGameMyWordsMixQuestionCount = 0;
      wordGameMyWordsMixSavedQuestionCount = 0;
      saveMyWordsShare(share);
      renderWordGameIntro();
    });
  });

  // Scoped to [data-mode], the attribute this handler actually needs — the
  // only .game-intro-option elements are the round-size/Endless buttons.
  document.querySelectorAll(".game-intro-option[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.mode;
      const targetWords =
        mode === "session" ? parseInt(button.dataset.count, 10) : 0;

      beginWordGameRound(mode, targetWords);
    });
  });
}

// --- Minimal Pairs -------------------------------------------------------
// A small, deliberately separate listening-discrimination game: hear a
// word, pick which of two similar-sounding words it was. Unlike the rest of
// the word game, this has no ability score, no SRS/relearning queue, and no
// My Words — right/wrong only matters for the current 10-question round,
// discarded the moment it ends. Reuses the main game's shared rendering,
// audio, and card-styling helpers wherever they're generic enough to fit
// (setGameContainerHTML, playTrackedAudio, shuffleArray, escapeGameHTML,
// announceGameAnswer, goodChime/badChime, the .game-word-card/
// .game-translation-card markup and CSS), but owns its own small, separate
// state instead of touching wordGameMode/wordGameRoundActive/etc.

const MINIMAL_PAIRS_ROUND_LENGTH = 10;

// Mirrors the STORY_FEEDBACK_CATEGORIES pattern in scripts.js (a dedicated
// list for a content type FEEDBACK_CATEGORIES' defaults don't fit) — most
// of that default list (CEFR level, word inflections, translations, example
// sentences) has no equivalent here, since a minimal pair is just two
// spellings and a recording, not a dictionary entry.
const MINIMAL_PAIRS_FEEDBACK_CATEGORIES = [
  "Audio doesn't match either word",
  "Audio quality issue",
  "Word spelling looks wrong",
  "Sound-difference category seems wrong",
  "Something else",
];

let minimalPairsDataPromise = null;
// A FIFO queue of pairs not yet answered correctly, not a fixed list — a
// miss pushes its pair back onto the end (see handleMinimalPairAnswer)
// instead of just moving on, so the round can't finish until every pair
// has been gotten right at least once. minimalPairsCurrentPair holds
// whichever one is on screen, taken off the queue while it's being asked.
let minimalPairsQueue = [];
let minimalPairsCurrentPair = null;
let minimalPairsTotalPairs = 0;
let minimalPairsMasteredCount = 0;
let minimalPairsQuestionsAnswered = 0;
let minimalPairsMissed = [];
// True once the current question has been graded. Both answer cards get an
// answer-click listener (see renderMinimalPairQuestion), but only one of
// them is ever actually clicked to answer — the other card's listener
// stays armed and *will* still fire the first time that card is clicked
// for audio replay after answering, which is expected. This guard keeps
// that from grading a second time (double-scoring, or re-coloring cards
// with a different selectedWord) — handleMinimalPairAnswer becomes a no-op
// for the rest of the question once this is true.
let minimalPairsAnswered = false;

// Loaded lazily on first use and cached — this is a separate, much smaller
// CSV (~300 rows) than the main dictionary, so it doesn't need that
// corpus's caching/worker/Google-Sheets-fallback machinery (see
// fetchAndLoadDictionaryData in scripts.js), just a plain fetch.
function loadMinimalPairsData() {
  if (minimalPairsDataPromise) return minimalPairsDataPromise;

  // Anchored to APP_ROOT_URL (scripts.js) — a bare relative path here
  // resolves against document.baseURI, which pushState drags along with
  // it after any in-app navigation on the base-tag-less app shell.
  minimalPairsDataPromise = fetch(new URL("norwegianSounds.csv", APP_ROOT_URL))
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return response.text();
    })
    .then(
      (csvText) =>
        new Promise((resolve, reject) => {
          Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: (parsed) => {
              const pairs = parsed.data
                .map((row) => ({
                  differenceType: String(row["Difference Type"] ?? "").trim(),
                  word1: String(row["Word 1"] ?? "").trim().normalize("NFC"),
                  word2: String(row["Word 2"] ?? "").trim().normalize("NFC"),
                }))
                .filter((pair) => pair.word1 && pair.word2);
              resolve(pairs);
            },
            error: reject,
          });
        }),
    )
    .catch((error) => {
      console.error("Error loading minimal pairs data:", error);
      minimalPairsDataPromise = null; // allow a later click to retry
      return [];
    });

  return minimalPairsDataPromise;
}

// This game's audio is a separate, newer recording batch from the rest of
// the app's ~29,000-file word-audio corpus, and — unlike that corpus, which
// has always been precomposed NFC — some of these files were saved in
// decomposed NFD form instead (å as "a" + combining ring, rather than one
// precomposed character): same word, different bytes, so an exact-match
// fetch for one form 404s against a file saved in the other. Try NFC first
// (matches the app's existing convention, works for most of these files
// too) and silently retry once as NFD rather than special-casing this
// dataset's inconsistency into buildWordAudioUrl itself, which is used
// everywhere else and has never needed this. Neither normalize() call
// touches letter case — Kjell stays Kjell, skjell stays skjell — so a
// capitalized word and its lowercase counterpart are never conflated here.
function playMinimalPairWordAudio(word) {
  const audio = playTrackedAudio(buildWordAudioUrl(word.normalize("NFC")));
  audio.addEventListener(
    "error",
    () => {
      audio.src = buildWordAudioUrl(word.normalize("NFD"));
      audio.play().catch((err) => console.warn("Audio playback failed:", err));
    },
    { once: true },
  );
  return audio;
}

function renderMinimalPairsMessage(heading, note) {
  setGameContainerHTML(`
    <div class="game-intro-card">
      <h2 class="game-intro-heading">${escapeGameHTML(heading)}</h2>
      <p class="game-today-practice-note">${escapeGameHTML(note)}</p>
    </div>
  `);
}

async function startMinimalPairsGame() {
  stopAllAudio();
  hideAllBanners();

  const allPairs = await loadMinimalPairsData();
  if (allPairs.length === 0) {
    renderMinimalPairsMessage(
      "Couldn't load sound pairs",
      "There was a problem loading this data — try again in a moment.",
    );
    return;
  }

  minimalPairsQueue = shuffleArray(allPairs).slice(
    0,
    Math.min(MINIMAL_PAIRS_ROUND_LENGTH, allPairs.length),
  );
  minimalPairsTotalPairs = minimalPairsQueue.length;
  minimalPairsMasteredCount = 0;
  minimalPairsQuestionsAnswered = 0;
  minimalPairsMissed = [];

  advanceToNextMinimalPair();
}

// The only place a question actually advances: pulls the next pair off the
// front of the queue, or ends the round once nothing's left in it. A pair
// only ever leaves the queue for good by being answered correctly — see
// handleMinimalPairAnswer, which pushes a miss right back onto the end
// rather than dropping it, so this is also what enforces "can't finish
// without getting everything right."
function advanceToNextMinimalPair() {
  if (minimalPairsQueue.length === 0) {
    showMinimalPairsResults();
    return;
  }

  minimalPairsCurrentPair = minimalPairsQueue.shift();
  renderMinimalPairQuestion();
}

function renderMinimalPairQuestion() {
  minimalPairsAnswered = false;
  const pair = minimalPairsCurrentPair;
  const targetWord = Math.random() < 0.5 ? pair.word1 : pair.word2;
  const choices = shuffleArray([pair.word1, pair.word2]);

  setGameContainerHTML(`
    <p class="game-intro-subheading" style="text-align: center;">
      Mastered ${minimalPairsMasteredCount} of ${minimalPairsTotalPairs}
    </p>
    <div class="game-word-card">
      <div
        class="game-word game-word-audio"
        role="button"
        tabindex="0"
        aria-label="Play word audio"
        title="Play word audio"
      >
        <i class="fas fa-volume-up game-listening-icon" aria-hidden="true"></i>
      </div>
    </div>
    <!-- min-height override: .game-grid's own 159px default assumes the
         regular game's usual two rows of four choices. Minimal pairs only
         ever has one row of two, so that reserved height would otherwise
         sit empty below the buttons, pushing Next visibly far away. -->
    <div class="game-grid" style="min-height: auto;">
      ${choices
        .map(
          (word, index) => `
        <button type="button" class="game-translation-card" lang="nb" data-index="${index}" aria-keyshortcuts="${index + 1}">
          ${escapeGameHTML(word)}
        </button>
      `,
        )
        .join("")}
    </div>
    ${getGameAnswerStatusMarkup()}
    <div class="game-next-button-container">
      <!-- Reuses #game-next-word-button's id (not a new class) purely to
           pick up its existing CSS as-is — this screen and the regular
           game's never coexist in the DOM, so there's no id collision. -->
      <button type="button" id="game-next-word-button" disabled>
        Next
      </button>
    </div>
  `);

  // Shown/wired per question, hidden again on the results screen — mirrors
  // how the regular game only offers this while an actual question is on
  // screen. Assigned via .onclick (not addEventListener) since this is a
  // persistent toolbar button reused across questions, not part of the
  // markup setGameContainerHTML just replaced — an addEventListener here
  // would stack a new listener, bound to this question's pair, on top of
  // every previous question's, every time.
  const reportButton = document.getElementById("game-report-issue");
  if (reportButton) {
    reportButton.classList.remove("hidden");
    reportButton.onclick = () => {
      openFeedbackDialog({
        source: "Word Game · Minimal Pairs",
        word: `${pair.word1} / ${pair.word2}`,
        dialogTitle: "Report an issue with this pair",
        categories: MINIMAL_PAIRS_FEEDBACK_CATEGORIES,
        categoryQuestion: "What's wrong with this pair?",
        detailsPlaceholder: "What's wrong with the audio or the words?",
        triggerElement: reportButton,
      });
    };
  }

  // Minimal Pairs is deliberately separate from wordGameRoundActive's SRS
  // bookkeeping, but its question-report action still belongs in the same
  // compact overflow affordance as every other live question.
  const roundMenu = document.getElementById("game-round-menu");
  roundMenu?.classList.remove("hidden");
  document.body.classList.add("word-game-round-active");

  const wordElement = document.querySelector(".game-word-audio");
  const replay = () => {
    playAudioTapFeedback(wordElement);
    stopAllAudio();
    playMinimalPairWordAudio(targetWord);
  };
  wordElement?.addEventListener("click", replay);
  wordElement?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      replay();
    }
  });

  document.querySelectorAll(".game-translation-card").forEach((card, index) => {
    // { once: true }: this listener's only job is grading the answer, and
    // it must be gone by the time handleMinimalPairAnswer re-enables these
    // same buttons for audio replay below — otherwise a second click would
    // re-score the question instead of just playing a sound.
    card.addEventListener(
      "click",
      () => {
        handleMinimalPairAnswer(choices[index], targetWord, pair);
      },
      { once: true },
    );
  });

  document
    .getElementById("game-next-word-button")
    ?.addEventListener("click", advanceToNextMinimalPair);

  focusGameQuestionPrompt();
  playMinimalPairWordAudio(targetWord);
}

function handleMinimalPairAnswer(selectedWord, targetWord, pair) {
  // See minimalPairsAnswered's own comment: the other card's original
  // answer-click listener is still armed and will fire this function again
  // the first time that card is clicked for audio replay. Grading must
  // happen exactly once per question.
  if (minimalPairsAnswered) return;
  minimalPairsAnswered = true;

  const cards = document.querySelectorAll(".game-translation-card");
  const isCorrect = selectedWord === targetWord;

  cards.forEach((card) => {
    card.disabled = true;
    const cardText = card.textContent.trim();
    if (cardText === targetWord) {
      card.classList.add("game-correct-card");
    } else if (cardText === selectedWord) {
      card.classList.add("game-incorrect-card");
    } else {
      // Not .distractor-muted — see that class's own stylesheet comment.
      card.classList.add("game-minimal-pairs-unselected");
    }
    // Once graded, both words become individually replayable — comparing
    // how each one actually sounds, now that the answer is known, is the
    // whole point of a minimal-pairs exercise. makeAudioReplayable
    // re-enables the button itself (see its own definition), which is safe
    // here only because the answer-choice listener above was attached with
    // { once: true } and is already gone.
    makeAudioReplayable(card, `Play pronunciation of ${cardText}`, () => {
      stopAllAudio();
      playMinimalPairWordAudio(cardText);
    });
  });

  minimalPairsQuestionsAnswered++;

  if (isCorrect) {
    minimalPairsMasteredCount++;
    playChime(goodChime, CHIME_PRIORITY.answer);
  } else {
    // Back of the queue, not dropped — this pair will come up again later
    // in the round instead of just being logged and moved past. Combined
    // with advanceToNextMinimalPair only ever ending the round once the
    // queue is empty, a pair genuinely cannot leave the round any other way
    // than eventually being answered correctly.
    minimalPairsQueue.push(pair);
    // Recorded once per pair even if it's missed more than once before it's
    // finally mastered — a "pairs to revisit" list showing the same pair
    // three times would just be noise.
    const alreadyMissed = minimalPairsMissed.some(
      (m) => m.word1 === pair.word1 && m.word2 === pair.word2,
    );
    if (!alreadyMissed) {
      minimalPairsMissed.push({ ...pair, targetWord, selectedWord });
    }
    playChime(badChime, CHIME_PRIORITY.answer);
  }

  announceGameAnswer(isCorrect, targetWord);

  const nextButton = document.getElementById("game-next-word-button");
  if (nextButton) {
    if (minimalPairsQueue.length === 0) {
      nextButton.textContent = "See Results";
    }
    nextButton.disabled = false;
    // Moves focus onto Next the moment it becomes usable, so the browser's
    // own "Enter/Space activates the focused button" behavior is all that's
    // needed to advance — no separate keydown listener required. If the
    // learner clicks a word afterward to hear it again, focus naturally
    // follows that click instead, which is fine — pressing Enter at that
    // point re-plays the same word rather than advancing, and clicking
    // Next directly still always works regardless of focus.
    nextButton.focus();
  }
}

function showMinimalPairsResults() {
  stopAllAudio();
  document.getElementById("game-report-issue")?.classList.add("hidden");
  document.getElementById("game-round-menu")?.classList.add("hidden");
  document.body.classList.remove("word-game-round-active");

  // Only reachable once the queue is empty, which — since a miss requeues
  // instead of being dropped (see handleMinimalPairAnswer) — means every
  // pair was eventually answered correctly. "Mastered" is therefore always
  // minimalPairsTotalPairs/minimalPairsTotalPairs here and not worth its
  // own stat; accuracy across every attempt it actually took is the number
  // that varies and says something about how the round went.
  const accuracy = minimalPairsQuestionsAnswered
    ? Math.round(
        (minimalPairsMasteredCount / minimalPairsQuestionsAnswered) * 100,
      )
    : 0;

  const missedListHTML = minimalPairsMissed.length
    ? `
    <div class="game-summary-missed">
      <h3 class="game-summary-missed-heading">Pairs to revisit</h3>
      <ul class="game-minimal-pairs-missed-list">
        ${minimalPairsMissed
          .map(
            (m) => `
          <li>
            ${escapeGameHTML(m.word1)} / ${escapeGameHTML(m.word2)} —
            you heard “${escapeGameHTML(m.targetWord)}”, picked “${escapeGameHTML(m.selectedWord)}”
          </li>
        `,
          )
          .join("")}
      </ul>
    </div>
  `
    : "";

  setGameContainerHTML(`
    <div class="game-summary-card">
      <div class="game-summary-hero">
        <span class="game-summary-check game-summary-check--listening" aria-hidden="true"><i class="fas fa-headphones"></i></span>
        <p class="game-summary-eyebrow">Listening drill complete</p>
      </div>
      <h2 class="game-summary-heading">Minimal Pairs complete!</h2>
      <div class="game-summary-stats">
        <div class="game-summary-stat">
          <p class="game-summary-stat-value">${minimalPairsTotalPairs}</p>
          <p class="game-summary-stat-label">Pairs mastered</p>
        </div>
        <div class="game-summary-stat">
          <p class="game-summary-stat-value">${minimalPairsQuestionsAnswered}</p>
          <p class="game-summary-stat-label">Questions</p>
        </div>
        <div class="game-summary-stat">
          <p class="game-summary-stat-value">${accuracy}%</p>
          <p class="game-summary-stat-label">Accuracy</p>
        </div>
      </div>
      <div class="game-summary-actions">
        <button type="button" class="game-summary-primary-btn" id="game-minimal-pairs-again-btn">
          Play again
        </button>
        <button type="button" class="game-summary-secondary-btn" id="game-minimal-pairs-back-btn">
          Practice menu
        </button>
      </div>
      ${missedListHTML}
    </div>
  `);

  document
    .getElementById("game-minimal-pairs-again-btn")
    ?.addEventListener("click", startMinimalPairsGame);
  document
    .getElementById("game-minimal-pairs-back-btn")
    ?.addEventListener("click", renderWordGameIntro);
}

// Ordinary practice isn't done just because N distinct words were answered
// correctly at some point: requeued misses must be cleared too. Placement is
// intentionally different. A miss is assessment evidence, so ten answered
// questions complete it regardless of correctness. Only while calibration is
// actually enabled, though — "skip placement" reuses this same round shape
// with nothing being measured, so it should complete like ordinary practice
// instead (requeuing misses until they're answered correctly).
function isWordGameRoundComplete() {
  if (wordGamePlacementCalibrationEnabled) {
    return (
      wordGameMode === "session" &&
      wordGameSessionQuestionsAnswered >= wordGameSessionTarget
    );
  }

  if (typeof hasActiveA0Support === "function" && hasActiveA0Support()) {
    return (
      wordGameMode === "session" &&
      wordGameSessionCorrectAnswers >= wordGameSessionTarget &&
      incorrectWordQueue.length === 0
    );
  }

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
  if (wordGamePlacementCalibrationEnabled) {
    const answered = Math.min(
      wordGameSessionQuestionsAnswered,
      wordGameSessionTarget,
    );
    return `Question ${answered} of ${wordGameSessionTarget}`;
  }

  const correctSoFar = Math.min(
    wordGameSessionCorrectWords.size,
    wordGameSessionTarget,
  );
  const pendingReview = incorrectWordQueue.length;

  if (typeof hasActiveA0Support === "function" && hasActiveA0Support()) {
    const a0CorrectSoFar = Math.min(
      wordGameSessionCorrectAnswers,
      wordGameSessionTarget,
    );
    if (a0CorrectSoFar >= wordGameSessionTarget && pendingReview > 0) {
      const word = pendingReview === 1 ? "word" : "words";
      return `${a0CorrectSoFar} of ${wordGameSessionTarget} — ${pendingReview} ${word} to review`;
    }
    return `Practice: ${a0CorrectSoFar} of ${wordGameSessionTarget}`;
  }

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

// Fill width for the session progress bar (see renderStats). Unlike the
// "Word X of N" label (which tracks raw correct-answer count, including
// words that still owe the queue another rep — see
// getWordGameSessionProgressLabel), the bar weighs each outstanding review
// as real remaining work: a word only leaves incorrectWordQueue once it
// satisfies applyCorrectRelearningResult, which can demand a further
// correct rep after the one that made it "correct" here. So the words
// still sitting in the queue are excluded from the numerator (they're not
// actually finished) and added to the denominator (they're work still to
// do), the same way isWordGameRoundComplete itself requires the queue to
// be empty. That guarantees the bar can only hit 100 exactly when the
// round can actually end, while still crediting mastered words as soon as
// they're truly done rather than freezing at an arbitrary cap.
function getWordGameSessionProgressPercent() {
  if (!wordGameSessionTarget) return 0;

  if (wordGamePlacementCalibrationEnabled) {
    return (
      (Math.min(wordGameSessionQuestionsAnswered, wordGameSessionTarget) /
        wordGameSessionTarget) *
      100
    );
  }

  if (typeof hasActiveA0Support === "function" && hasActiveA0Support()) {
    const completed = Math.min(
      wordGameSessionCorrectAnswers,
      wordGameSessionTarget,
    );
    return (
      (completed / (wordGameSessionTarget + incorrectWordQueue.length)) * 100
    );
  }

  const queuedWords = new Set(
    incorrectWordQueue.map((entry) => entry.wordObj),
  );
  const masteredCount = Math.min(
    wordGameSessionTarget,
    Array.from(wordGameSessionCorrectWords).filter(
      (wordObj) => !queuedWords.has(wordObj),
    ).length,
  );
  const totalUnits = wordGameSessionTarget + incorrectWordQueue.length;

  return (masteredCount / totalUnits) * 100;
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
  document.body.classList.toggle(
    "word-game-round-active",
    wordGameRoundActive,
  );
  document
    .getElementById("game-end-session-btn")
    ?.classList.toggle("hidden", !wordGameRoundActive);
  document
    .getElementById("game-report-issue")
    ?.classList.toggle("hidden", !wordGameRoundActive);
  document
    .getElementById("game-english-toggle-btn")
    ?.classList.toggle("hidden", !wordGameRoundActive);
  // The translations toggle pill only means something once a round is
  // actually asking questions — the intro/placement screen and the round
  // summary have nothing to translate. .hidden's !important beats
  // startWordGame()'s own inline display:inline-flex, which still runs
  // unconditionally on every word-game entry.
  document
    .querySelector(".game-english-filter")
    ?.classList.toggle("hidden", !wordGameRoundActive);

  document
    .getElementById("game-round-menu")
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
  // Universal round-start gate. Most first-time entry points already pass
  // through startWordGame() and render placement there, but keeping the
  // same check at the round engine boundary covers homepage CTAs, daily
  // quest actions, round-size buttons, and any future shortcut that calls
  // beginWordGameRound() directly.
  if (!placementCompleted && !options.placementRound) {
    wordGameRoundActive = false;
    updateEndSessionToolbarButtonVisibility();
    window.PlacementTestAPI?.start?.();
    return;
  }

  if (!Array.isArray(results) || results.length === 0) {
    renderWordGameLoadingMessage();
    return;
  }

  window.reportTimeToFirstExercise?.();

  wordGameMode = mode;
  wordGameIsTodayPracticeRound = Boolean(options.todayPractice);
  wordGameIsBonusRound =
    !wordGameIsTodayPracticeRound && Boolean(options.bonusRound);
  wordGameIsPlacementRound =
    !wordGameIsTodayPracticeRound &&
    !wordGameIsBonusRound &&
    Boolean(options.placementRound);
  wordGamePlacementCalibrationEnabled =
    wordGameIsPlacementRound && options.placementCalibration !== false;
  wordGamePlacementCalibrationStep = PLACEMENT_CALIBRATION_INITIAL_STEP;
  wordGamePlacementCalibrationWords = new Set();
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
  wordGameMyWordsMixQuestionCount = 0;
  wordGameMyWordsMixSavedQuestionCount = 0;
  wordGameReviewPortfolioQuestionCount = 0;
  wordGameReviewPortfolioReviewCount = 0;
  wordGameA0SupportIntensity =
    typeof getA0SupportIntensity === "function" ? getA0SupportIntensity() : 0;
  wordGameA0PacingQuestionCount = 0;
  wordGameA0ReinforcementQuestionCount = 0;
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
  wordGameMyWordsMixQuestionCount = 0;
  wordGameMyWordsMixSavedQuestionCount = 0;
  wordGameReviewPortfolioQuestionCount = 0;
  wordGameReviewPortfolioReviewCount = 0;
  wordGameA0SupportIntensity =
    typeof getA0SupportIntensity === "function" ? getA0SupportIntensity() : 0;
  wordGameA0PacingQuestionCount = 0;
  wordGameA0ReinforcementQuestionCount = 0;
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
  const wasPlacementRound = wordGameIsPlacementRound;
  const completedRoundMode = wordGameMode;
  const completedRoundTarget = wordGameSessionTarget;
  const completedDailyQuestIndex = wordGameDailyQuestIndex;
  const roundWasComplete = isWordGameRoundComplete();
  if (roundWasComplete) {
    playChime(roundCompleteChime, CHIME_PRIORITY.roundComplete);
  }
  const earnedDailyQuest =
    wasTodayPractice && roundWasComplete
      ? wordGameEarnedDailyQuest || completeDailyQuestRound()
      : null;
  // Choosing a self-assessed starting point only seeds placement; it does
  // not complete it. Commit completion only after all ten assessment
  // questions have actually been answered. An early quit leaves the flag
  // false, so every later Word Game entry returns to placement.
  finalizePlacementCompletion(wasPlacementRound, roundWasComplete);
  const wordsPracticedCount = wasPlacementRound
    ? Math.min(wordGameSessionQuestionsAnswered, wordGameSessionTarget)
    : wordGameSessionCorrectWords.size;

  // One cloud profile update per round instead of one per answer. Streak and
  // daily-practice events fired during this summary share the same debounce
  // window in myWordsAuth.js, so all three fields become a single write.
  saveAbilityState();
  window.dispatchEvent(new CustomEvent("progress:round-complete"));

  window.trackEvent?.("word_game_round_complete", {
    mode: wasBonusRound
      ? "bonus"
      : wasTodayPractice
        ? "daily_quest"
        : wasPlacementRound
          ? "placement_practice"
          : wasBoundedRound
            ? "bounded"
            : "infinite",
    round_complete: roundWasComplete,
    words_practiced: wordsPracticedCount,
    questions_answered: wordGameSessionQuestionsAnswered,
    accuracy,
  });
  if (earnedDailyQuest) {
    window.trackEvent?.("daily_quest_complete", {
      reward: earnedDailyQuest.reward,
    });
  }
  if (wasPlacementRound) {
    window.trackEvent?.(
      roundWasComplete ? "tutorial_complete" : "placement_abandoned",
      { content_type: "placement", questions_answered: wordGameSessionQuestionsAnswered },
    );
  }

  wordGameRoundActive = false;
  wordGameIsTodayPracticeRound = false;
  wordGameIsBonusRound = false;
  wordGameIsPlacementRound = false;
  wordGamePlacementCalibrationEnabled = false;
  wordGamePlacementCalibrationStep = PLACEMENT_CALIBRATION_INITIAL_STEP;
  wordGamePlacementCalibrationWords = new Set();
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
    !wasPlacementRound && missedWords.length > 0
      ? `
    <details class="game-summary-missed">
      <summary>Words to review <span>${missedWords.length}</span></summary>
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
    </details>
  `
      : "";

  const nextDailyQuest = DAILY_QUESTS[getDailyPracticeProgress()];
  let primaryActionLabel = "Keep practicing";
  let primaryActionKind = "repeat";
  if (wasTodayPractice && roundWasComplete) {
    primaryActionLabel = nextDailyQuest
      ? `Start ${nextDailyQuest.reward} round`
      : "Start bonus round";
    primaryActionKind = "next-daily";
  } else if (wasTodayPractice) {
    const quest = DAILY_QUESTS[completedDailyQuestIndex];
    primaryActionLabel = `Repeat ${quest?.reward ?? "daily"} round`;
    primaryActionKind = "repeat-daily";
  } else if (wasBonusRound) {
    primaryActionLabel = "Repeat bonus round";
    primaryActionKind = "repeat-bonus";
  } else if (wasPlacementRound) {
    primaryActionLabel = roundWasComplete
      ? "Start today’s practice"
      : "Continue placement";
    primaryActionKind = roundWasComplete ? "next-daily" : "placement";
  } else if (completedRoundMode === "session") {
    primaryActionLabel = `Repeat ${completedRoundTarget}-word round`;
  }

  const summaryEyebrow = earnedDailyQuest
    ? "Daily quest complete"
    : wasPlacementRound
      ? "Your first practice session"
      : roundWasComplete
        ? "Practice complete"
        : "Practice summary";
  const summaryIcon = earnedDailyQuest
    ? getDailyQuestGemMarkup(earnedDailyQuest.reward, "game-summary-reward-gem")
    : `<span class="game-summary-check" aria-hidden="true"><i class="fas fa-check"></i></span>`;

  setGameContainerHTML(`
    <div class="game-summary-card">
      <div class="game-summary-hero">
        ${summaryIcon}
        <p class="game-summary-eyebrow">${summaryEyebrow}</p>
      </div>
      <h2 class="game-summary-heading">${
        earnedDailyQuest
          ? `${uppercaseFirstNorwegian(earnedDailyQuest.reward)} earned!`
          : wasBonusRound && roundWasComplete
            ? "Bonus round complete!"
          : wasPlacementRound && roundWasComplete
            ? "First practice complete!"
          : wasPlacementRound
            ? "Good start!"
          : wasBoundedRound && roundWasComplete
            ? "Round complete!"
            : "Nice work!"
      }</h2>
      ${streakBannerHTML}
      <div class="game-summary-stats">
        <div class="game-summary-stat">
          <p class="game-summary-stat-value">${wordsPracticedCount}</p>
          <p class="game-summary-stat-label">${wasPlacementRound ? "Words assessed" : "Words practiced"}</p>
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
      <div class="game-summary-actions">
        <button type="button" class="game-summary-primary-btn" id="game-summary-restart-btn">
          ${primaryActionLabel}
        </button>
        <button type="button" class="game-summary-secondary-btn" id="game-summary-menu-btn">
          Practice menu
        </button>
      </div>
      ${missedWordsHTML}
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
      switch (primaryActionKind) {
        case "next-daily":
          beginTodayPracticeRound();
          break;
        case "repeat-daily":
          beginWordGameRound("session", DAILY_QUEST_ROUND_TARGET, {
            todayPractice: true,
          });
          break;
        case "repeat-bonus":
          beginWordGameRound("session", DAILY_QUEST_ROUND_TARGET, {
            bonusRound: true,
          });
          break;
        case "placement":
          window.PlacementTestAPI?.start?.();
          break;
        default:
          beginWordGameRound(completedRoundMode, completedRoundTarget);
      }
    });

  document
    .getElementById("game-summary-menu-btn")
    ?.addEventListener("click", renderWordGameIntro);

  // Every completed/ended round is a chance the signed-out visitor now has
  // more worth protecting (a longer streak, more saved words) than they did
  // last time — see maybeShowSignInNudge() in myWordsAuth.js, which only
  // actually shows the banner on a new streak/My-Words milestone (subject to
  // its own re-show cooldown), or no-ops entirely once signed in.
  window.SignInNudgeAPI?.maybeShow?.();
}

async function startWordGame() {
  const searchContainerInner = document.getElementById(
    "search-container-inner",
  ); // The container to update
  const searchBarWrapper = document.getElementById("search-bar-wrapper");

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

  // A direct Word Game link shows scripts.js's route shell while the
  // dictionary loads. This function is only reached with usable vocabulary,
  // so remove the page-level busy state as soon as the real game UI takes
  // over (the placement screen replaces the shell without calling
  // clearContainer()).
  if (results.length > 0) {
    clearVocabularyLoadingState();
  }

  gameActive = true;
  showLandingCard(false);
  hideAllBanners(); // Hide banners before starting the new word

  searchBarWrapper.style.display = "none"; // Hide search-bar-wrapper

  searchContainerInner.classList.add("word-game-active"); // Indicate word game is active

  // Handle "word-game" option
  showLandingCard(false);

  genreFilterContainer.style.display = "none";

  gameEnglishSelect.style.display = "inline-flex"; // Hide random button
  gameEnglishFilterContainer.style.display = "inline-flex";
  // Reflect the shared show/hide-English setting (also used by Sentence
  // Search, Pronunciation, and Stories) instead of always defaulting to
  // "show-english".
  gameEnglishSelect.value = isEnglishVisible ? "show-english" : "hide-english";
  syncGameEnglishControls();

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

  // A new question must never inherit the unrendered plan or calibration
  // record from a question the learner left midway through.
  plannedQuestionMode = null;
  currentQuestionPrediction = null;

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
    playChime(popChime, CHIME_PRIORITY.pop);

    // Reintroduce the word
    currentWord = firstWordInQueue.wordObj.ord;
    correctTranslation = firstWordInQueue.wordObj.engelsk;
    firstWordInQueue.shown = true;
    if (!wordGamePlacementCalibrationEnabled) {
      recordMyWordsMixQuestion(isMyWordsEntry(firstWordInQueue.wordObj));
    }

    if (firstWordInQueue.forceTypedRetry) {
      const randomWordObj = firstWordInQueue.wordObj;
      if (firstWordInQueue.wasCloze) {
        const retryContextEntry = firstWordInQueue.clozeSentence
          ? {
              ...randomWordObj,
              eksempel: firstWordInQueue.clozeSentence,
              sentenceTranslation:
                firstWordInQueue.clozeSentenceTranslation || "",
            }
          : randomWordObj;
        const clozeTarget = await findClozeTarget(
          retryContextEntry,
          firstWordInQueue.clozedForm,
        );
        if (clozeTarget) {
          await renderClozeGameUI(
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
      } else if (firstWordInQueue.wasListening) {
        // A dictation miss (typed-listening) scaffolds down to plain
        // listening's multiple-choice form first (see the non-forced branch
        // below, which already renders "listening" for any wasListening
        // entry) — once that's answered correctly, it comes back here for
        // the required typed retry, same word, same audio.
        renderWordGameUI(randomWordObj, [], true, "typed-listening");
      } else {
        renderWordGameUI(randomWordObj, [], true, "typed-reverse");
      }
      renderStats();
      return;
    }

    if (firstWordInQueue.wasCloze) {
      const randomWordObj = firstWordInQueue.wordObj;
      const retryContextEntry = firstWordInQueue.clozeSentence
        ? {
            ...randomWordObj,
            eksempel: firstWordInQueue.clozeSentence,
            sentenceTranslation:
              firstWordInQueue.clozeSentenceTranslation || "",
          }
        : randomWordObj;

      /*
       * Locate the same surface form that was used in the
       * original cloze question.
       */
      const clozeTarget = await findClozeTarget(
        retryContextEntry,
        firstWordInQueue.clozedForm,
      );

      if (!clozeTarget) {
        /*
         * renderClozeGameUI will safely convert this into
         * a reintroduced flashcard.
         */
        await renderClozeGameUI(
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
          await renderClozeGameUI(
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
          await renderClozeGameUI(
            randomWordObj,
            [],
            firstWordInQueue.clozedForm,
            true,
            null,
          );
          return;
        }

        await renderClozeGameUI(
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
    saveAbilityState({ syncRemote: false });
  }

  // Fetch a random word that respects CEFR and POS filters
  const randomWordObj = await fetchRandomWord();

  // If no words match the filters, stop the game
  if (!randomWordObj) return;

  currentWord = randomWordObj;
  correctTranslation = randomWordObj.engelsk;
  const hasAudio = hasPlayableWordAudio(randomWordObj);

  // Keep the first practice round in recognition mode. It still uses the
  // full game feedback and scheduler, but a consistent question format
  // makes the seven calibration answers comparable and avoids dropping a
  // brand-new learner straight into cloze or productive recall.
  // fetchRandomWord chose this exercise together with the word. Keep the old
  // selector as a defensive fallback for a direct/legacy caller that returns
  // a word without a plan.
  const structuredQuestionMode = getStructuredQuestionModeForWord(
    randomWordObj,
  );
  const selectedPlannedMode = plannedQuestionMode;
  const forceTypedReverse =
    selectedPlannedMode === "typed-reverse" ||
    structuredQuestionMode === "typed-reverse";
  const plannedTopLevelMode = selectedPlannedMode?.startsWith("typed-")
    ? selectedPlannedMode.slice("typed-".length)
    : selectedPlannedMode;
  const questionMode =
    plannedTopLevelMode ??
    selectQuestionMode({
      structuredQuestionMode,
      forceTypedReverse,
      ability: abilityScore,
      hasAudio,
    });
  const isClozeQuestion = questionMode === "cloze";
  const isListeningQuestion = questionMode === "listening";
  const isReverseQuestion = questionMode === "reverse";

  // Fetch incorrect translations from the same band as the word actually
  // being asked about (not the learner's own ability) — distractors need to
  // be plausible peers of the target word, and since word selection is no
  // longer confined to a single CEFR band, those two are no longer the same
  // thing. Shared prep for whichever mode ends up rendering an
  // English-options question (forward, listening, or cloze's own
  // fallback-to-forward) — reverse/typed-reverse build Norwegian-word
  // options instead (see GAME_MODES.reverse.renderQuestion) and never touch
  // this.
  const incorrectTranslations = fetchIncorrectTranslations(
    randomWordObj.gender,
    correctTranslation,
    randomWordObj.CEFR,
  );
  const allTranslations = shuffleArray([
    correctTranslation,
    ...incorrectTranslations,
  ]);
  const fallbackTranslations = ensureUniqueDisplayedValues(allTranslations);

  // See GAME_MODES above for each mode's actual rendering logic, including
  // cloze's own multi-step fallback-to-forward-flashcard chain (banned word
  // class, no cloze target, too few distractors). A renderQuestion may
  // render a *different* mode's markup than questionMode says (that
  // fallback) without questionMode/isClozeQuestion below changing to match
  // — they stay tied to what was actually selected, which is what the
  // displayPronunciation guard needs.
  await GAME_MODES[questionMode].renderQuestion({
    wordObj: randomWordObj,
    fallbackTranslations,
    forceTypedReverse,
    plannedMode: selectedPlannedMode,
  });

  // Render the updated stats box. Safe to call unconditionally even though
  // renderQuestion's own renderWordGameUI/renderClozeGameUI call already
  // did this once: renderStats() only fully (re)builds the stats markup the
  // first time per question, guarded by .game-stats-wrapper's presence —
  // every call after that just refreshes the numeric bits (streak, review
  // count, progress bar), which is exactly what belongs here regardless of
  // which branch rendered the question.
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
      !isExcludedFromRandomSelection(entry.ord)
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
      !isExcludedFromRandomSelection(entry.ord)
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

// Only offered when the report follows a graded typed-answer miss (see
// attachGameControls's reportButton handler below) — multiple-choice
// questions have no equivalent, since the learner picked from pre-supplied
// options rather than typing their own.
const TYPED_ANSWER_MISS_FEEDBACK_CATEGORIES = [
  ...FEEDBACK_CATEGORIES.slice(0, -1),
  "My answer should have been accepted",
  "Something else",
];

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
      // Read live at click time, not closure time: this handler is bound
      // once when the question loads, but the typed-answer form (if any)
      // is only graded — and only carries a stashed userAnswer — after the
      // learner submits, which happens later.
      const missedTypedForm = document.querySelector(
        ".game-typed-answer-form.is-incorrect",
      );
      // wordObj.ord is the target Norwegian answer, not what was actually
      // on screen — a reverse question shows the English meaning and a
      // cloze question shows a sentence with a blank, either of which a
      // reviewer needs to judge "should this answer have been accepted"
      // (e.g. the shown English gloss maps to more than one Norwegian
      // synonym, or the blank's surrounding words support a different
      // inflection). Only worth capturing for an actual typed miss — every
      // other report path already has the full question context via the
      // dialog's own "word" field.
      const missedPrompt = missedTypedForm
        ? document.querySelector(".game-word")?.textContent?.trim()
        : undefined;

      openFeedbackDialog({
        source: isCloze ? "Word Game · Cloze" : "Word Game · Flashcard",
        word: wordObj.ord,
        pos: wordObj.gender,
        cefr: wordObj.CEFR,
        prompt: missedPrompt,
        // The cloze sentence hides this exact word until answered —
        // showing it in the dialog title would give away the answer.
        showWordInTitle: false,
        categories: missedTypedForm
          ? TYPED_ANSWER_MISS_FEEDBACK_CATEGORIES
          : FEEDBACK_CATEGORIES,
        userAnswer: missedTypedForm?.dataset.userAnswer,
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
  return (GAME_MODES[mode] ?? GAME_MODES.forward).instructionText();
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
    clozeTarget = null,
    isReverse = false,
    isListening = false,
    exampleSentenceIndex = null,
    exampleSentenceTranslation = "",
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

    // Stashed before grading, since a miss overwrites input.value with the
    // correct answer (see updateTypedAnswerFeedback) — the report dialog's
    // "My answer should have been accepted" option needs what the learner
    // actually typed, not the correction.
    form.dataset.userAnswer = selectedAnswer;

    handleTranslationClick(
      selectedAnswer,
      wordObj,
      isCloze,
      clozeSentence,
      isReverse,
      isListening,
      getTypedAcceptedAnswers(
        wordObj,
        isCloze,
        correctTranslation,
        clozeTarget,
      ),
      exampleSentenceIndex,
      true,
      exampleSentenceTranslation,
      clozeTarget,
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
// "reverse"/"typed-reverse" (English shown, recall Norwegian), "listening"
// (Norwegian audio only, recognize English from options — the word's own
// text is hidden until answered), or "typed-listening" (true dictation:
// Norwegian audio only, type the Norwegian word you heard — no English
// anywhere on screen).
function renderWordGameUI(
  wordObj,
  translations,
  isReintroduced = false,
  mode = "forward",
) {
  // Dictation ("typed-listening"): hear the word, type what you heard — no
  // English shown at all. It reuses listening's own prompt (audio icon,
  // freely replayable, revealed as text once answered) rather than
  // reverse's, since unlike typed-reverse there's no English gloss standing
  // in as the prompt here for the typed input to add audio to afterward —
  // see attachTypedAnswerForm's isListening option below.
  const isDictation = mode === "typed-listening";
  const isTyped = mode === "typed-reverse" || isDictation;
  const isReverse = mode === "reverse" || mode === "typed-reverse";
  const isListening = mode === "listening" || isDictation;

  beginQuestionPrediction(wordObj, mode);

  // Each render replaces the previous question entirely, so nothing still
  // references earlier entries — reset instead of growing forever.
  wordDataStore = [];
  const wordId = wordDataStore.push(wordObj) - 1;

  // Reverse flashcards and dictation both ask the learner to recall the
  // Norwegian word — the answer options (and so the "correct" value
  // handleTranslationClick checks against) are Norwegian words instead of
  // English translations. Mirrors renderClozeGameUI reassigning this same
  // global to the clozed Norwegian form. Plain listening's correct answer is
  // English, same as forward, so it needs no reassignment here.
  if (isReverse || isDictation) {
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

  // Rendered by renderStats() below, inside the stats row itself (see
  // .game-stats-content in the stylesheets) rather than as a plain line here --
  // on mobile that lets it sit directly under the progress bar, between
  // the two colored boxes, instead of adding its own full-width row.
  const instructionText = getGameInstructionText(mode);

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
    // Dictation grades as Norwegian recall (see correctTranslation above)
    // but isn't a "reverse" question — its prompt already carries its own
    // audio (wired below, same as plain listening), so it doesn't need
    // revealReverseWordAudio's after-the-fact fix-up, only the isListening
    // flag so a miss/correct answer reveals the word's text the same way
    // plain listening does.
    attachTypedAnswerForm(wordObj, {
      isReverse: !isDictation,
      isListening: isDictation,
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

  renderStats(instructionText); // Ensure stats are drawn once DOM is fully loaded
  focusGameQuestionPrompt({ typed: isTyped });
  if (!isReverse) {
    playWordAudio(wordObj);
  }
}

async function renderClozeGameUI(
  wordObj,
  translations,
  clozedWordForm,
  isReintroduced = false,
  clozeTarget = null,
  useTypedRecall = false,
  preparedPredictionExercise = null,
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

  const renderedMode = useTypedRecall ? "typed-cloze" : "cloze";
  const predictionExercise =
    preparedPredictionExercise ||
    (await buildRenderedClozePredictionExercise(
      wordObj,
      renderedMode,
      clozeTarget,
      translations,
      clozedWordForm,
    ));
  beginQuestionPrediction(wordObj, renderedMode, predictionExercise);

  const sentenceWithBlank =
    clozeTarget.sentence.slice(0, clozeTarget.startIndex) +
    blank +
    clozeTarget.sentence.slice(clozeTarget.endIndex);
  const promptLengthClass = getGamePromptLengthClass(sentenceWithBlank);
  // Typed-cloze gives no multiple-choice options to lean on, so unlike the
  // multiple-choice cloze branch it shows the sentence translation up front
  // as a semantic anchor, in the same spot/markup the post-answer reveal
  // already uses (see the isCloze branch in handleTranslationClick) so the
  // English visibility toggle keeps working without extra wiring.
  const targetSentenceTranslation = getClozeTargetTranslation(
    wordObj,
    clozeTarget,
  );
  const clozeSentenceTranslation = useTypedRecall
    ? targetSentenceTranslation
    : "";

  // Rendered by renderStats() below -- see the matching comment in
  // renderWordGameUI.
  const instructionText = getGameInstructionText(
    useTypedRecall ? "typed-cloze" : "cloze",
  );

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

      <div class="game-word${promptLengthClass ? ` ${promptLengthClass}` : ""}">
      <h2 id="cloze-sentence">${escapeGameHTML(sentenceWithBlank)}</h2>
      </div>

      <div class="game-cefr-spacer">
        ${
          clozeSentenceTranslation
            ? `<div class="sentence-pair">
          <!-- Typed cloze needs this semantic cue to identify the missing
               Norwegian form, regardless of the global translation setting. -->
          <p class="game-english-translation game-english-translation-required" style="display: inline-block;">${clozeSentenceTranslation}</p>
        </div>`
            : ""
        }
      </div>
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
      clozeTarget,
      exampleSentenceIndex: clozeTarget.sentenceIndex,
      exampleSentenceTranslation: targetSentenceTranslation,
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
          false,
          targetSentenceTranslation,
        );
      });
    });
  }

  // Deliberately NOT clickable yet: the sentence still has its blank, and
  // letting someone hear the complete sentence before answering would let
  // them listen for the answer instead of reasoning about which word fits.
  // handleTranslationClick() makes it clickable once the sentence is whole.

  attachGameControls(wordObj, true);

  renderStats(instructionText); // Ensure stats bar is present after cloze loads too
  focusGameQuestionPrompt({ typed: useTypedRecall });
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

function updateTypedAnswerFeedback(
  isCorrect,
  correctAnswer,
  isNearMiss = false,
  morphologyNearMiss = null,
) {
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
    morphologyNearMiss
      ? morphologyNearMiss.message
      : isCorrect
      ? isNearMiss
        ? `Correct, close enough. Correct spelling: ${correctAnswer}`
        : "Correct answer"
      : `Correct answer: ${correctAnswer}`,
  );
  form.classList.add("is-answered");
  form.classList.toggle("is-correct", isCorrect);
  form.classList.toggle("is-almost", Boolean(morphologyNearMiss));
  form.classList.toggle(
    "is-incorrect",
    !isCorrect && !morphologyNearMiss,
  );

  // A near-miss (right word, wrong spelling — missing æ/ø/å or a small typo,
  // see isCloseEnoughTypedAnswer) still counts as correct so it doesn't
  // penalize recall, but silently accepting it without ever showing the real
  // spelling would let the misspelling go uncorrected. Shown in
  // #game-banner-placeholder — the same gray box showBanner() uses for the
  // streak/cleared-practice congratulation messages — rather than appended
  // to the form (which sits outside .game-word-card entirely, between the
  // input and the Next Word button). Typed-reverse, typed-listening, and
  // cloze questions (the only modes that reach here) never call
  // displayPronunciation, so this box is always free at this point; the
  // one real overlap is
  // showBanner("streak"/"clearedPracticeWords", ...) a few lines below in
  // handleTranslationClick/handleTypedAnswerSubmit, which — being called
  // after this — wins the shared box on the rare question that's both a
  // near-miss and a streak milestone.
  const bannerPlaceholder = document.getElementById("game-banner-placeholder");
  if (bannerPlaceholder) {
    const note = morphologyNearMiss?.message ||
      (isCorrect && isNearMiss
        ? `Close enough — correct spelling: ${correctAnswer}`
        : "");
    bannerPlaceholder.innerHTML = note
      ? `<div class="game-typed-answer-note"><p>${escapeGameHTML(note)}</p></div>`
      : "";
  }
}

function announceGameAnswer(isCorrect, correctAnswer, morphologyNearMiss = null) {
  const status = document.getElementById("game-answer-status");
  if (!status) return;
  status.textContent = morphologyNearMiss
    ? morphologyNearMiss.message
    : isCorrect
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

// Runs the instant a learner submits an answer — the single highest-stakes
// moment in the game: right/wrong feedback, SRS scheduling, ability-score
// updates, and relearning-queue bookkeeping all happen here. The four mode
// flags below aren't a single dispatch step at the top; each is checked
// separately, in whichever spot needs it, scattered through the function
// rather than organized by mode. A map of what each one actually controls,
// since that's easy to lose track of otherwise:
//   isCloze     — which sentence-blank gets filled in on answer
//                 (completeClozeSentence), and whether comparisons keep the
//                 full comma-containing surface form instead of just the
//                 first dictionary alternative (correctTranslationPart /
//                 selectedTranslationPart below).
//   isReverse   — unlocks replaying the Norwegian word's audio on the
//                 now-visible correct card (revealReverseWordAudio). Only
//                 needed when nothing on screen already has that audio
//                 wired — true for reverse/typed-reverse (whose prompt is
//                 English text), false for dictation (typed-listening),
//                 whose prompt already carries its own audio from render.
//   isListening — reveals the Norwegian word's text, previously hidden
//                 behind just its audio (revealListeningWordText). True for
//                 both plain listening and dictation.
//   wasTyped    — whether a typed-mastery requirement on this word (see
//                 requiresTypedMastery below, and shouldUseTypedRecall
//                 elsewhere) has now actually been satisfied — gates both
//                 SRS credit and whether the relearning queue lets this
//                 word go.
// The adaptive recovery plan converts these flags into the next scaffold or
// original-skill retry mode. The original failed mode remains stored
// separately and must eventually be answered correctly before graduation.
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
  exampleSentenceTranslation = "",
  clozeTarget = null,
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
  const normalizedSelected = normalizeGameAnswer(selectedTranslationPart);
  const exactAnswerMatch =
    acceptedAnswerIdentities.size > 0
      ? acceptedAnswerIdentities.has(normalizedSelected)
      : selectedTranslationPart === correctTranslationPart;
  const morphologyNearMiss =
    !exactAnswerMatch && wasTyped
      ? await classifyTypedMorphologyNearMiss(wordObj, selectedTranslationPart, {
          isCloze,
          isReverse,
          isListening,
          clozeTarget,
          correctAnswer: correctTranslationPart,
        })
      : null;
  // A typed answer that misses on an exact match gets one more, more
  // forgiving pass — missing æ/ø/å or a small typo shouldn't fail a learner
  // who actually recalled the word. Multiple-choice picks skip this
  // entirely: their text always matches an option exactly, so a mismatch
  // there is always a different word, never a typo. See
  // isCloseEnoughTypedAnswer for exactly what counts as "close enough".
  const nearMissTypedMatch =
    !exactAnswerMatch &&
    !morphologyNearMiss &&
    wasTyped &&
    (acceptedAnswerIdentities.size > 0
      ? [...acceptedAnswerIdentities].some((accepted) =>
          isCloseEnoughTypedAnswer(normalizedSelected, accepted),
        )
      : isCloseEnoughTypedAnswer(
          normalizedSelected,
          normalizeGameAnswer(correctTranslationPart),
        ));
  const answerWasCorrect = exactAnswerMatch || nearMissTypedMatch;
  const learningOutcome = morphologyNearMiss?.outcomeValue ??
    (answerWasCorrect ? 1 : 0);
  const answerSkill = isCloze
    ? "context"
    : isListening
      ? "listening"
      : isReverse
        ? "production"
        : "recognition";
  const answerSkillSnapshot =
    window.WordStrengthAPI?.getSkillSnapshot?.(wordObj, answerSkill) ??
    window.WordStrengthAPI?.getSnapshot?.(wordObj);
  // The first time an A0 learner meets a word is an introduction, even though
  // the existing card still asks for recognition. Preserve the correction and
  // future review record on a miss, but do not let that first unknown answer
  // create the same ability drop or in-round retry debt as a failed retrieval.
  const a0FirstExposure =
    hasActiveA0Support() &&
    currentWordQueueType === "new" &&
    !answerSkillSnapshot?.record;
  // Capture the rendered mode and its calibration before recording this
  // outcome, since recordQuestionPredictionOutcome updates that bias and then
  // clears currentQuestionPrediction. Ability should evaluate this answer
  // against what the game believed immediately before the learner answered.
  const answerMode =
    currentQuestionPrediction?.mode ??
    (isCloze
      ? wasTyped
        ? "typed-cloze"
        : "cloze"
      : isListening
        ? wasTyped
          ? "typed-listening"
          : "listening"
        : isReverse
          ? wasTyped
            ? "typed-reverse"
            : "reverse"
          : "forward");
  const learnedExerciseBiasBeforeAnswer = getQuestionLearnedBias(
    wordObj,
    answerMode,
    currentQuestionPrediction?.exercise ?? null,
  );
  const activeQueueEntry = incorrectWordQueue.find(
    (queued) => queued.wordObj === wordObj && queued.shown,
  );
  const answerWasScaffolded = Boolean(
    activeQueueEntry?.originalMode &&
      answerMode !== activeQueueEntry.originalMode,
  );

  const predictionEvidence = recordQuestionPredictionOutcome(
    answerWasCorrect,
    {
      nearMiss: nearMissTypedMatch,
      morphologyNearMiss: Boolean(morphologyNearMiss),
      wasTyped,
      wasScaffolded: answerWasScaffolded,
    },
  );
  const srsEvidenceWeight = window.WordGamePolicy.getSrsEvidenceWeight({
    wasCorrect: answerWasCorrect,
    predictedSuccess: predictionEvidence?.predictedSuccess ?? 0.5,
    responseTimeMs: predictionEvidence?.responseTimeMs ?? null,
    responseTimeTargetMs:
      window.WordGamePolicy.RESPONSE_TIME_TARGET_MS[answerMode] ?? 6500,
    nearMiss: nearMissTypedMatch || Boolean(morphologyNearMiss),
    possiblyGuessed: predictionEvidence?.possiblyGuessed ?? false,
    wasScaffolded: answerWasScaffolded,
  });

  resetTodayPracticeRoundAfterMidnight(wordObj);
  const { exampleSentence, sentenceTranslation } =
    await fetchExampleSentence(wordObj, exampleSentenceIndex, {
      preferredSentence: isCloze ? clozeSentence : "",
      preferredTranslation: exampleSentenceTranslation,
    });
  announceGameAnswer(
    answerWasCorrect,
    morphologyNearMiss?.correction || correctTranslationPart,
    morphologyNearMiss,
  );

  if (answerWasCorrect) {
    playSentenceAudio(exampleSentence);
    playChime(goodChime, CHIME_PRIORITY.answer);
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
    correctStreak++; // Increment the streak
    updateRecentAnswers(
      true,
      wordObj,
      answerMode,
      learnedExerciseBiasBeforeAnswer,
      learningOutcome,
      {
        possiblyGuessed: predictionEvidence?.possiblyGuessed,
        wasTyped,
      },
    );
    window.WordStrengthAPI?.recordResult?.(wordObj, true, {
      skill: answerSkill,
      // A bounded-round filler or a skill shown ahead of its own approach
      // window is not a spaced retrieval and must not lengthen that skill's
      // durable interval. A scaffold may strengthen its own skill, but the
      // recovery queue independently keeps the originally failed skill open.
      credit:
        currentWordQueueType !== "session-filler" &&
        (answerSkillSnapshot?.queue !== "scheduled" ||
          answerSkillSnapshot?.isApproaching),
      evidenceWeight: srsEvidenceWeight,
      deferRemote: true,
    });
    if (wordGameRoundActive) {
      wordGameSessionQuestionsAnswered++;
      wordGameSessionCorrectAnswers++;
      wordGameSessionCorrectWords.add(wordObj);
    }
    if (isCloze) {
      completeClozeSentence(clozeSentence); // see isCloze in the flag map above
    }
    // Not gated by wasTyped: this is a no-op when there's no typed-answer
    // form in the DOM (see its own definition), so it's safe to call
    // unconditionally on every mode, typed or not.
    updateTypedAnswerFeedback(true, correctTranslationPart, nearMissTypedMatch);
    if (isReverse) {
      revealReverseWordAudio(wordObj); // see isReverse in the flag map above
    }
    if (isListening) {
      revealListeningWordText(wordObj); // see isListening in the flag map above
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
      answerMode,
    );
    if (relearningResult === "remove" && indexInQueue !== -1) {
      incorrectWordQueue.splice(indexInQueue, 1);
      removedFromQueue = true;
    }
    // Trigger the streak banner if the user reaches a streak. Suppressed
    // in session mode — a 10-streak is barely reachable in a small bounded
    // round (often only hittable by finishing flawlessly, at which point
    // it'd fire in the same instant as "round complete"), so the round
    // summary is the one celebration moment there instead. Also suppressed
    // on a near-miss answer: updateTypedAnswerFeedback just wrote this
    // answer's "Close enough — correct spelling: X" note into this same
    // #game-banner-placeholder box, and this correction is the thing the
    // learner most needs to see for THIS answer — a streak milestone is a
    // bonus that will happily fire again on its next multiple of 10.
    if (
      wordGameMode !== "session" &&
      correctStreak % 10 === 0 &&
      !nearMissTypedMatch
    ) {
      showBanner("streak", correctStreak);
    }
    // Trigger the cleared practice words banner ONLY if the queue is now
    // empty — same near-miss suppression as the streak banner above, for
    // the same reason.
    if (
      incorrectWordQueue.length === 0 &&
      removedFromQueue &&
      !nearMissTypedMatch
    ) {
      showBanner("clearedPracticeWords"); // Show the cleared practice words banner
    }
  } else {
    playSentenceAudio(exampleSentence);
    const answerChime = morphologyNearMiss ? popChime : badChime;
    const answerChimePriority = morphologyNearMiss
      ? CHIME_PRIORITY.pop
      : CHIME_PRIORITY.answer;
    playChime(answerChime, answerChimePriority);
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
    correctStreak = 0; // Reset the streak
    updateRecentAnswers(
      false,
      wordObj,
      answerMode,
      learnedExerciseBiasBeforeAnswer,
      a0FirstExposure ? Math.max(learningOutcome, 0.6) : learningOutcome,
      {
        possiblyGuessed: predictionEvidence?.possiblyGuessed,
        wasTyped,
      },
    );
    window.WordStrengthAPI?.recordResult?.(wordObj, false, {
      skill: answerSkill,
      evidenceWeight: a0FirstExposure
        ? Math.min(srsEvidenceWeight, 0.35)
        : srsEvidenceWeight,
      outcomeValue: a0FirstExposure
        ? Math.max(learningOutcome, 0.6)
        : learningOutcome,
      deferRemote: true,
    });
    if (wordGameRoundActive) {
      wordGameSessionQuestionsAnswered++;
      wordGameSessionIncorrectAnswers++;
      wordGameSessionMissedWords.add(wordObj);
    }

    // Same four checks as the correct-answer branch above, same reasons —
    // see the flag map at the top of this function.
    if (isCloze) {
      completeClozeSentence(clozeSentence);
    }
    updateTypedAnswerFeedback(
      false,
      morphologyNearMiss?.correction || correctTranslationPart,
      false,
      morphologyNearMiss,
    );
    if (isReverse) {
      revealReverseWordAudio(wordObj);
    }
    if (isListening) {
      revealListeningWordText(wordObj);
    }

    // Placement misses are already saved durably above so ordinary practice
    // can review them later. They are not requeued while calibration is
    // actually running: an assessment must sample the promised ten distinct
    // words and finish, not require the learner to master every unknown
    // word before leaving. Without live calibration (e.g. skipped
    // placement), there's no such sampling need, so misses requeue as usual.
    if (!wordGamePlacementCalibrationEnabled && !a0FirstExposure) {
      // Keep the durable lapse in WordStrengthAPI and also schedule a short
      // retry after intervening questions in this active round. Repeat misses
      // get a modestly longer gap without blocking other ready queue entries.
      const existingQueueEntry = incorrectWordQueue.find(
        (incorrectWord) => incorrectWord.wordObj === wordObj,
      );
      const baseGap = getWordGameReintroduceThreshold();
      const recoveryEntry = scheduleAdaptiveRecovery({
        queueEntry: existingQueueEntry,
        wordObj,
        failedMode: answerMode,
        predictedSuccess: predictionEvidence?.predictedSuccess ?? 0.5,
        responseTimeMs: predictionEvidence?.responseTimeMs ?? null,
        answeredQuestions: wordGameSessionQuestionsAnswered,
        baseGap,
        clozedForm: isCloze ? correctTranslation : null,
        clozeSentence: isCloze ? clozeSentence : "",
        clozeSentenceTranslation: isCloze
          ? exampleSentenceTranslation
          : "",
      });
      if (!existingQueueEntry) incorrectWordQueue.push(recoveryEntry);
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

  // isCloze again: a cloze question already showed its example sentence
  // as the question itself (now completed by completeClozeSentence above),
  // so only forward/reverse/listening need the sentence text and
  // click-to-replay wiring added here after the fact — cloze only needs
  // the English translation revealed alongside it.
  if (exampleSentence && !isCloze) {
    const completedSentence = exampleSentence;

    const translationHTML = `
      <p class="game-english-translation" style="display: ${
        isEnglishVisible ? "inline-block" : "none"
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
      <p class="game-english-translation${wasTyped ? " game-english-translation-required" : ""}" style="display: ${
        wasTyped || isEnglishVisible ? "inline-block" : "none"
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

async function fetchExampleSentence(
  wordObj,
  preferredIndex = null,
  { preferredSentence = "", preferredTranslation = "" } = {},
) {
  if (!wordObj || !wordObj.ord) {
    console.warn("Missing required fields for search:", wordObj);
    return { exampleSentence: "", sentenceTranslation: "" };
  }

  if (normalizeGameWhitespace(preferredSentence)) {
    return {
      exampleSentence: normalizeGameWhitespace(preferredSentence),
      sentenceTranslation: normalizeGameWhitespace(preferredTranslation),
    };
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
  const matchingEntry = wordObj;

  // Never borrow an example from a different dictionary row here. A spelling
  // prefix is not a sense identifier in Norwegian, and doing so can attach a
  // homograph's sentence to the word the learner actually answered.
  if (!matchingEntry.eksempel || matchingEntry.eksempel.trim() === "") {
    return { exampleSentence: "", sentenceTranslation: "" };
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
  { ignorePrevious = false, allowIntroduced = false } = {},
) {
  const queuedForReintroduction = new Set(
    incorrectWordQueue.map((queued) => queued.wordObj),
  );
  const dailyQuestionMode = wordGameIsTodayPracticeRound
    ? getDailyQuestQuestionMode(
        wordGameDailyQuestIndex,
        wordGameSessionQuestionsAnswered,
        true,
      )
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

    // Placement has a small intentional skill plan. Filter only the entries
    // that cannot support its next planned prompt; the ordinary placement
    // selector can then keep adapting item difficulty instead of silently
    // changing a listening/typed slot after the word has already been drawn.
    const placementExercise = wordGameIsPlacementRound
      ? PLACEMENT_QUESTION_PLAN[
          Math.max(0, Math.floor(Number(wordGameSessionQuestionsAnswered) || 0))
        ] ?? "forward"
      : null;
    if (
      (placementExercise === "listening" ||
        placementExercise === "typed-listening") &&
      !hasPlayableWordAudio(entry)
    ) {
      return false;
    }
    if (
      placementExercise === "typed-reverse" &&
      !getGameSentenceTranslation(entry, 0)
    ) {
      return false;
    }

    // No CEFR gate here by design: word selection is a smooth,
    // ability-proximity-weighted draw (see getGameWordWeight), not a hard
    // per-level cutoff. A word far from the learner's ability isn't
    // excluded outright, just made vanishingly unlikely to be drawn.

    if (isExcludedFromRandomSelection(norwegianWord)) {
      return false;
    }

    /*
     * Avoid displaying the same spelling twice in a row.
     */
    if (!ignorePrevious && norwegianWord === previousWord) {
      return false;
    }

    if (
      (dailyQuestionMode === "cloze" || bonusExercise === "cloze") &&
      (!String(entry?.eksempel ?? "").trim() ||
        BANNED_WORD_CLASSES.some((wordClass) =>
          gender.toLowerCase().startsWith(wordClass),
        ))
    ) {
      return false;
    }

    if (
      (dailyQuestionMode === "listening" || bonusExercise === "listening") &&
      !hasPlayableWordAudio(entry)
    ) {
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
      !allowIntroduced &&
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
const RECALL_NEED_WEIGHT_EXPONENT = 1.5;
const RECALL_NEED_WEIGHT_FLOOR = 0.02;

// Vocabulary usefulness metadata is a separate, generated sidecar rather than
// another norwegianWords.csv column. It blends three registers — CLARINO
// newspaper text, OpenSubtitles conversational text, and NB N-gram digibok
// book text — so no single corpus's quirks (e.g. newspaper over-representing
// politics/journalism vocabulary) dominate the signal; see
// VOCABULARY_FREQUENCY_DATA.md for the blend method. Surface-form counts are
// aggregated into entry records offline using unambiguous official Norsk
// Ordbank inflections. Loading is kicked off unconditionally at script load
// (see the bottom of this file) since it now also refines per-word
// difficulty (getWordDifficultyAnchor) for the Elo-style ability rating on
// every answer, not just new-word/placement selection — the two narrower
// awaits below remain as a safety net for whichever comes first. A failed or
// not-yet-resolved request degrades to neutral weights and the plain CEFR
// band center; neither ability rating nor vocabulary selection may ever
// depend on this enhancement being online.
const VOCABULARY_FREQUENCY_DATA_VERSION = 4;
const VOCABULARY_USEFULNESS_MAX_BOOST = 0.7;
const CORE_VOCABULARY_MIN_PROXIMITY = 0.25;
let vocabularyFrequencyEntries = null;
let vocabularyFrequencyPromise = null;

async function loadVocabularyFrequencyRanks() {
  if (vocabularyFrequencyEntries) return vocabularyFrequencyEntries;
  if (vocabularyFrequencyPromise) return vocabularyFrequencyPromise;

  vocabularyFrequencyPromise = fetch(
    new URL("vocabulary-frequency.json", APP_ROOT_URL),
    { cache: "no-cache" },
  )
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      if (
        data?.version !== VOCABULARY_FREQUENCY_DATA_VERSION ||
        !data.entries ||
        typeof data.entries !== "object"
      ) {
        throw new Error("Unsupported vocabulary-frequency snapshot");
      }
      vocabularyFrequencyEntries = data.entries;
      return vocabularyFrequencyEntries;
    })
    .catch((error) => {
      console.warn("Vocabulary usefulness ranks could not be loaded.", error);
      vocabularyFrequencyEntries = Object.freeze({});
      return vocabularyFrequencyEntries;
    });

  return vocabularyFrequencyPromise;
}

// Frequency primarily decides which unseen words enter the core pool (see
// getCoreVocabularyCandidatePool). Once admitted, it is deliberately only a
// secondary signal: the blended, pre-normalized weight supplies at most a
// 1.7x boost, leaving personal memory need, challenge fit, and ability
// proximity dominant. Unmatched dictionary words retain a neutral weight of 1.
function getVocabularyFrequencyEntryKey(entry) {
  const primary = getPrimaryNorwegianForm(entry)
    .normalize("NFC")
    .trim()
    .toLowerCase();
  const gender = String(entry?.gender ?? "")
    .normalize("NFC")
    .trim()
    .toLowerCase();
  return `${primary}|${gender}`;
}

function getVocabularyFrequencyRecord(entry) {
  if (!vocabularyFrequencyEntries) return null;
  return vocabularyFrequencyEntries[getVocabularyFrequencyEntryKey(entry)] ?? null;
}

function getVocabularyFrequencyRank(entry) {
  const rank = getVocabularyFrequencyRecord(entry)?.rank;
  return Number.isFinite(rank) && rank > 0 ? rank : null;
}

function getVocabularyUsefulnessWeight(entry) {
  const weight = getVocabularyFrequencyRecord(entry)?.weight;
  return window.WordGamePolicy.getUsefulnessWeight(
    weight,
    VOCABULARY_USEFULNESS_MAX_BOOST,
  );
}

// --- Continuous A0 support ----------------------------------------------
// This deliberately derives support from durable evidence already owned by
// WordStrengthAPI. There is no A0 curriculum, user setting, or one-time
// graduation flag: as a learner accumulates broad, retained recognition and
// their ability rises, every support weight below simply fades toward 1.
function getA0LearningSummary() {
  const memories = Object.values(window.WordStrengthAPI?.getAll?.() ?? {});
  const establishedRecognitionCount = memories.filter((memory) => {
    const recognition = memory?.skills?.recognition;
    return (
      recognition?.state !== "relearning" &&
      Number(recognition?.successEvidence) >= 2
    );
  }).length;
  return {
    introducedCount: memories.length,
    establishedRecognitionCount,
  };
}

function getA0SupportIntensity() {
  const summary = getA0LearningSummary();
  return window.WordGamePolicy.getA0SupportIntensity({
    ability: Number.isFinite(abilityScore)
      ? abilityScore
      : CEFR_DIFFICULTY_ANCHOR.A1,
    ...summary,
  });
}

function getActiveA0SupportIntensity() {
  if (wordGameIsPlacementRound) return 0;
  return wordGameRoundActive
    ? wordGameA0SupportIntensity
    : getA0SupportIntensity();
}

function hasActiveA0Support() {
  return getActiveA0SupportIntensity() > 0.05;
}

function getA0VocabularyWeight(entry, supportIntensity) {
  if (!(supportIntensity > 0)) return 1;
  const frequencyWeight = window.WordGamePolicy.getA0FrequencyWeight(
    getVocabularyFrequencyRecord(entry)?.weight,
    supportIntensity,
  );
  const cefrWeight = window.WordGamePolicy.getA0CefrWeight(
    getWordCefrLabel(entry),
    supportIntensity,
  );
  return frequencyWeight * cefrWeight;
}

function getA0RecognitionEvidence(wordObj) {
  const record = window.WordStrengthAPI?.getSkillSnapshot?.(
    wordObj,
    "recognition",
  )?.record;
  return Math.max(0, Number(record?.successEvidence) || 0);
}

function getA0ReinforcementCandidates(entries) {
  return entries.filter((entry) => {
    const snapshot = window.WordStrengthAPI?.getSnapshot?.(entry);
    return (
      snapshot?.queue === "scheduled" &&
      !snapshot.isApproaching &&
      Boolean(snapshot.record)
    );
  });
}

function shouldPrioritizeA0Reinforcement(candidates) {
  if (!hasActiveA0Support() || candidates.length === 0) return false;
  return window.WordGamePolicy.shouldPrioritizeQuota({
    share: window.WordGamePolicy.getA0ReinforcementShare(
      getActiveA0SupportIntensity(),
    ),
    questionCount: wordGameA0PacingQuestionCount,
    savedCount: wordGameA0ReinforcementQuestionCount,
  });
}

function recordA0PacingQuestion(queueName) {
  if (!hasActiveA0Support()) return;
  if (queueName !== "new" && queueName !== "a0-reinforcement") return;
  wordGameA0PacingQuestionCount += 1;
  if (queueName === "a0-reinforcement") {
    wordGameA0ReinforcementQuestionCount += 1;
  }
}

// The scheduler first chooses an explicit queue (relearning, due, approaching,
// new, or scheduled fallback). Continuous recall need then influences the draw
// within review queues; the old coarse 0-5 strength remains only for pools
// whose purpose is not SRS urgency. The cumulative My Words quota is a
// separate user-directed allocation; on every remaining non-quota slot, this
// queue order remains authoritative.

// A Gaussian falloff centered on the learner's ability, in word-difficulty
// units — this is what stands in for the old hard CEFR-level cutoff. A word
// right at the estimated ability gets full weight; one further away fades
// out smoothly rather than being excluded outright.
//
// The falloff needs some rescue mechanism to keep it off exactly zero —
// CEFR tags are an approximate, hand-applied "v1 simplification" (see
// CEFR_DIFFICULTY_ANCHOR's comment), so a word mislabeled as much closer or
// further from a learner's ability than it really is should still have some
// path back into rotation, rather than becoming permanently unreachable
// once ability drifts past it.
//
// A flat per-word floor turns out to be the wrong shape for that, though:
// this dictionary's CEFR bands range from 889 words (A1) to 14,176 (B2), so
// the same per-word floor produces wildly different AGGREGATE leakage
// depending on which distant band happens to be huge. Concretely, a flat
// floor small enough to keep a B2 learner's rare stray A1 word negligible
// was still large enough that a brand-new A1 learner saw a 2+-band-away
// word — drawn overwhelmingly from B2's 14,176-word pool, and often as a
// cloze sentence with no translation shown and likely-harder surrounding
// vocabulary too — in essentially every 50-word round. That's a real risk
// of a discouraging first impression at exactly the point a new learner is
// most likely to churn, not a rare edge case.
//
// NEW_WORD_FLOOR_WEIGHT_BUDGET fixes that by normalizing per band instead
// of per word: it's the total rescue weight a whole distant CEFR band gets
// to share, split evenly across however many words are actually in that
// band right now (see countEntriesByCefr). A big band's per-word floor
// shrinks accordingly, so its aggregate contribution to the draw stays
// roughly the same small size as a small band's, instead of scaling up
// with the band's word count. It's expressed as a weight budget (not a
// 0-1 fraction like the old flat floor was) since "how much floor does one
// word get" now depends on the band it's in — see getAbilityProximityWeight.
//
// Deliberately *not* direction-aware (no lower floor above ability, higher
// below, or vice versa) — 2+ CEFR bands away is only a rare mislabeling
// edge case in either direction, and treating it as routine has real costs
// both ways: for an advanced learner, an unseen A1 word wastes a session
// slot on something they almost certainly already know; for a new learner,
// an unseen C-level word risks the discouraging-first-impression problem
// above. Keeping the floor low in both directions costs nothing real: a
// word that's legitimately too far away now will re-enter ordinary
// (non-floor) reach once ability has actually drifted closer to it.
const NEW_WORD_FLOOR_WEIGHT_BUDGET = 1.5;

// Tally of how many entries in the current candidate pool share each CEFR
// label, keyed the same way getWordCefrLabel normalizes it. Computed once
// per weighted draw (see pickPrioritizedGameWord) rather than per entry,
// since every entry in the same band needs the identical count to split
// NEW_WORD_FLOOR_WEIGHT_BUDGET evenly.
function countEntriesByCefr(entries) {
  const counts = {};

  for (const entry of entries) {
    const label = getWordCefrLabel(entry);
    counts[label] = (counts[label] || 0) + 1;
  }

  return counts;
}

function getAbilityProximityWeight(entry, cefrCounts) {
  if (abilityScore === null) return 1;

  const gaussian = getRawAbilityProximity(entry);
  const bandSize = cefrCounts?.[getWordCefrLabel(entry)] || 1;
  const perWordFloor = NEW_WORD_FLOOR_WEIGHT_BUDGET / bandSize;

  return Math.max(perWordFloor, gaussian);
}

function getRawAbilityProximity(entry) {
  if (abilityScore === null) return 1;

  const distance = getWordDifficultyAnchor(entry) - abilityScore;
  return window.WordGamePolicy.getAbilityProximity(
    distance,
    ABILITY_PROXIMITY_SIGMA,
  );
}

// Words ranked by any of the three blended frequency sources are the useful
// core. Prefer core words that are either reasonably close to the learner's
// continuous ability estimate or harder than it. The second condition keeps
// upward exploration smooth; the proximity
// condition prevents a strong learner's ordinary new-word slots from being
// consumed by beginner words merely because those words rank highly in a
// frequency list. This is deliberately one-sided: unexpectedly difficult
// words still have a small Gaussian-weighted route into rotation, while words
// far below the learner add little practice value.
//
// Once that suitably challenging core is exhausted, the complete dictionary
// reopens rather than starving the game. Due/relearning words never pass
// through this gate, and saved My Words are offered before it in
// fetchRandomWord, preserving both the review schedule and the selected Mix.
function getCoreVocabularyCandidatePool(entries) {
  return window.WordGamePolicy.getCoreCandidatePool(entries, {
    frequencyDataAvailable: Boolean(vocabularyFrequencyEntries),
    hasFrequency: (entry) => getVocabularyFrequencyRank(entry) !== null,
    getDifficulty: getWordDifficultyAnchor,
    ability: abilityScore,
    getProximity: getRawAbilityProximity,
    minimumProximity: CORE_VOCABULARY_MIN_PROXIMITY,
  });
}

// useAbilityWeight is false for queues built from words the learner has
// already been exposed to (due, relearning, scheduled): a due word already
// earned its turn through the SRS schedule, and re-weighting it down for
// being "off-level" would let it lose out indefinitely to due words closer
// to current ability, undermining spaced repetition. Ability proximity only
// applies when choosing what unseen word to introduce next (queue "new").
// cefrCounts is only meaningful (and only ever passed) alongside
// useAbilityWeight — see pickPrioritizedGameWord, the sole caller that
// computes it.
function getGameWordWeight(
  entry,
  {
    useAbilityWeight = true,
    useUsefulnessWeight = false,
    useRecallNeedWeight = false,
    a0SupportIntensity = 0,
    cefrCounts = null,
  } = {},
) {
  const strength = window.WordStrengthAPI?.get?.(entry) ?? 0;
  const recallNeed =
    window.WordStrengthAPI?.getSnapshot?.(entry)?.recallNeed ?? 0;
  const memoryWeight = window.WordGamePolicy.getMemoryWeight(
    {
      strength,
      recallNeed,
      useRecallNeed: useRecallNeedWeight,
    },
    {
      strengthCeiling: STRENGTH_WEIGHT_CEILING,
      strengthExponent: STRENGTH_WEIGHT_EXPONENT,
      recallNeedExponent: RECALL_NEED_WEIGHT_EXPONENT,
      recallNeedFloor: RECALL_NEED_WEIGHT_FLOOR,
    },
  );
  const abilityWeight = useAbilityWeight
    ? getAbilityProximityWeight(entry, cefrCounts)
    : 1;
  const usefulnessWeight = useUsefulnessWeight
    ? getVocabularyUsefulnessWeight(entry)
    : 1;
  const a0VocabularyWeight = getA0VocabularyWeight(
    entry,
    a0SupportIntensity,
  );

  return (
    window.WordGamePolicy.getWordWeight({
    memoryWeight,
    abilityWeight,
    usefulnessWeight,
    }) * a0VocabularyWeight
  );
}

/*
 * Favors low-strength (weak or never-tried) words over high-strength
 * (mastered) ones, without ever fully excluding a mastered word. Takes a
 * pre-computed weights array (same length/order as entries) rather than a
 * weight function, so callers that need each entry's weight for more than
 * just this draw (see pickPrioritizedGameWord) only compute it once.
 */
function pickWeightedGameWord(entries, weights) {
  const selectedIndex = window.WordGamePolicy.getWeightedIndex(
    weights,
    Math.random(),
  );
  return selectedIndex >= 0 ? entries[selectedIndex] ?? null : null;
}

function pickPrioritizedGameWord(
  eligibleEntries,
  {
    useAbilityWeight = true,
    useUsefulnessWeight = false,
    useRecallNeedWeight = false,
  } = {},
) {
  // Only needed (and only worth the pass over eligibleEntries) when ability
  // weighting is actually in play — see getAbilityProximityWeight.
  const cefrCounts = useAbilityWeight
    ? countEntriesByCefr(eligibleEntries)
    : null;
  // A0 frequency/CEFR shaping applies only when introducing a word. Due
  // reviews keep their scheduler-earned priority regardless of proficiency.
  const a0SupportIntensity = useAbilityWeight
    ? getActiveA0SupportIntensity()
    : 0;

  const pairPlans = eligibleEntries.map(getQuestionPairPlan);
  const weights = eligibleEntries.map((entry, index) => {
    const wordWeight = getGameWordWeight(entry, {
      useAbilityWeight,
      useUsefulnessWeight,
      useRecallNeedWeight,
      a0SupportIntensity,
      cefrCounts,
    });
    // Placement is an assessment sample, not adaptive practice: its word
    // draw must not drift toward the target practice-success rate.
    return (
      wordWeight *
      (wordGameIsPlacementRound ? 1 : pairPlans[index].totalPairWeight)
    );
  });
  const selectedEntry = pickWeightedGameWord(eligibleEntries, weights);
  const selectedIndex = eligibleEntries.indexOf(selectedEntry);
  plannedQuestionMode = chooseQuestionModeFromPlan(pairPlans[selectedIndex]);
  return selectedEntry;
}

// --- My Words mix ---------------------------------------------------------
// A user-set share of questions that should come from the learner's saved
// My Words list this session, chosen on the intro screen (see
// renderWordGameIntro) and persisted across visits like any other
// preference. Coarse quarters rather than a continuous slider: fine enough
// to feel adjustable, coarse enough that the control never implies more
// precision than a small saved list can actually deliver. The cumulative
// quota below keeps the chosen share honest within each round. The top level
// stops at 0.75, not 1, so
// even at max intensity the ordinary spaced-repetition draw still gets a
// guaranteed turn — a small saved list should never be able to fully starve
// the rest of the game.
const MY_WORDS_SHARE_STORAGE_KEY = "norwegian-dictionary-my-words-share-v1";
const MY_WORDS_SHARE_LEVELS = [0, 0.25, 0.5, 0.75];
const DEFAULT_MY_WORDS_SHARE = 0;

// Paired with a plain-language frequency ("one in four") rather than the
// percentage alone on the intro screen's pills — natural-frequency phrasing
// reads as more concrete than a bare percentage at a glance.
function getMyWordsShareValueLabel(share) {
  return share === 0 ? "Off" : `${Math.round(share * 100)}%`;
}

function getMyWordsShareDescriptionLabel(share) {
  switch (share) {
    case 0.25:
      return "one in four";
    case 0.5:
      return "every other";
    case 0.75:
      return "three in four";
    default:
      return "no boost";
  }
}

function loadMyWordsShare() {
  const stored = Number(
    window.localStorage?.getItem(MY_WORDS_SHARE_STORAGE_KEY),
  );

  return MY_WORDS_SHARE_LEVELS.includes(stored)
    ? stored
    : DEFAULT_MY_WORDS_SHARE;
}

function saveMyWordsShare(share) {
  try {
    window.localStorage?.setItem(MY_WORDS_SHARE_STORAGE_KEY, String(share));
  } catch (_error) {
    // Private browsing, storage quota, etc. — the in-memory value below
    // still governs this session either way.
  }
}

let wordGameMyWordsShare = loadMyWordsShare();

function getSavedMyWordsEntries() {
  return new Set(
    (window.MyWordsAPI?.getSavedEntries?.() ?? [])
      .map((savedRecord) => savedRecord.entry)
      .filter(Boolean),
  );
}

function isMyWordsEntry(entry) {
  return Boolean(entry) && getSavedMyWordsEntries().has(entry);
}

// A deterministic cumulative quota, not an independent random coin flip.
// Every complete block of four questions therefore contains exactly one,
// two, or three saved-word questions at 25%, 50%, or 75%, provided an
// eligible saved word exists. Natural due/relearning appearances count. If
// an earlier question cannot supply a saved word, the deficit can be recovered
// later in that round. Every new round starts its count from zero.
function shouldPrioritizeMyWordsQuestion() {
  return window.WordGamePolicy.shouldPrioritizeQuota({
    share: wordGameMyWordsShare,
    questionCount: wordGameMyWordsMixQuestionCount,
    savedCount: wordGameMyWordsMixSavedQuestionCount,
  });
}

function recordMyWordsMixQuestion(wasSavedWord) {
  if (wordGameMyWordsShare <= 0) return;
  wordGameMyWordsMixQuestionCount += 1;
  if (wasSavedWord) wordGameMyWordsMixSavedQuestionCount += 1;
}

// During the distinct-word portion of a bounded round, callers may include
// previously introduced saved words. Repeating one can lengthen the round,
// but never changes its promise to introduce exactly N distinct words.
function pickMyWordsQuotaWord(candidateEntries, reviewShare = null) {
  if (wordGameMyWordsShare <= 0) return null;

  const savedEntries = getSavedMyWordsEntries();
  const eligibleSaved = candidateEntries.filter((entry) =>
    savedEntries.has(entry),
  );

  if (eligibleSaved.length === 0) return null;

  // The quota decides that this slot belongs to My Words. The review/new
  // portfolio then operates inside that saved-word pool, so neither policy
  // is allowed to silently override the other.
  const queues = buildGameWordQueues(eligibleSaved);
  const queueName = getPortfolioGameQueueName(
    queues,
    Number.isFinite(reviewShare)
      ? reviewShare
      : getReviewPortfolioShareForQueues(queues),
  );
  const queueEntries =
    queueName === "scheduled"
      ? getNearestScheduledGameWords(queues.scheduled)
      : queues[queueName] ?? [];
  return pickPrioritizedGameWord(queueEntries, {
    useAbilityWeight: false,
    useRecallNeedWeight: ["relearning", "due", "approaching"].includes(
      queueName,
    ),
  });
}

function getGameEntryQueue(entry, now = Date.now()) {
  const snapshot = window.WordStrengthAPI?.getSnapshot?.(entry, now);
  if (snapshot?.queue === "scheduled" && snapshot.isApproaching) {
    return "approaching";
  }
  return snapshot?.queue ?? "new";
}

function buildGameWordQueues(eligibleEntries, now = Date.now()) {
  return window.WordGamePolicy.buildQueues(eligibleEntries, (entry) =>
    getGameEntryQueue(entry, now),
  );
}

function getNextGameQueueName(queues) {
  return window.WordGamePolicy.getNextQueueName(queues);
}

const REVIEW_PORTFOLIO_QUEUES = Object.freeze([
  "relearning",
  "due",
  "approaching",
]);

function getReviewPortfolioShareForQueues(queues) {
  const dueCount = REVIEW_PORTFOLIO_QUEUES.reduce(
    (total, queueName) => total + (queues?.[queueName]?.length || 0),
    0,
  );
  return window.WordGamePolicy.getReviewPortfolioShare(dueCount);
}

function getPortfolioGameQueueName(
  queues,
  reviewShare = getReviewPortfolioShareForQueues(queues),
) {
  const reviewQueueName = REVIEW_PORTFOLIO_QUEUES.find(
    (queueName) => queues?.[queueName]?.length > 0,
  );
  const hasNew = Boolean(queues?.new?.length);

  if (reviewQueueName && hasNew) {
    return window.WordGamePolicy.shouldPrioritizeReview({
      share: reviewShare,
      questionCount: wordGameReviewPortfolioQuestionCount,
      reviewCount: wordGameReviewPortfolioReviewCount,
    })
      ? reviewQueueName
      : "new";
  }
  if (reviewQueueName) return reviewQueueName;
  if (hasNew) return "new";
  return queues?.scheduled?.length ? "scheduled" : undefined;
}

function recordReviewPortfolioQuestion(queueName) {
  if (queueName === "new") {
    wordGameReviewPortfolioQuestionCount += 1;
  } else if (REVIEW_PORTFOLIO_QUEUES.includes(queueName)) {
    wordGameReviewPortfolioQuestionCount += 1;
    wordGameReviewPortfolioReviewCount += 1;
  }
}

// When somebody deliberately starts a round with no due or new material,
// let them practice rather than showing an empty screen. Only the nearest
// upcoming reviews are considered, minimizing how far the scheduler is
// pulled forward; correct answers in this fallback do not extend intervals.
function getNearestScheduledGameWords(entries) {
  return entries
    .map((entry) => ({
      entry,
      dueAt:
        window.WordStrengthAPI?.getSnapshot?.(entry)?.record?.dueAt ??
        Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) => left.dueAt - right.dueAt)
    .slice(0, Math.min(50, entries.length))
    .map(({ entry }) => entry);
}

// Words already-answered-correctly or already-introduced this round are
// candidates the filler draw picks between — excludes whichever word was
// just shown (previousWord), unless that's the only candidate left, since
// this path bypasses getEligibleGameWords' own same-word guard entirely.
function excludePreviousFillerWord(entries) {
  if (entries.length <= 1) return entries;

  const filtered = entries.filter((entry) => entry.ord !== previousWord);

  return filtered.length > 0 ? filtered : entries;
}

// The pool a filler draw picks between: already-introduced words this round
// has answered correctly, excluding whichever word was just shown and
// anything already queued for its own deliberate reintroduction. Split out
// from pickWordGameSessionFillerWord so fetchRandomWord's My Words quota
// check can roll against this same pool before falling back to plain
// filler logic — see pickMyWordsQuotaWord.
function getFillerReviewCandidates() {
  const queuedWords = new Set(
    incorrectWordQueue.map((entry) => entry.wordObj),
  );

  return excludePreviousFillerWord(
    Array.from(wordGameSessionCorrectWords).filter(
      (entry) => !queuedWords.has(entry),
    ),
  );
}

// Once a session round has introduced its full target word count, every
// further "new question" slot reviews one already-introduced word instead
// of pulling a brand-new one from the dictionary — this is what keeps a
// round of N to exactly N distinct words (see fetchRandomWord). Prefers
// words already answered correctly (pure review); words still awaiting
// their own scheduled reintroduction are left to that timing, which is
// handled separately at the top of startWordGame().
function pickWordGameSessionFillerWord() {
  const reviewCandidates = getFillerReviewCandidates();

  if (reviewCandidates.length > 0) {
    return pickPrioritizedGameWord(reviewCandidates, {
      useAbilityWeight: false,
    });
  }

  // Nothing correct yet to review (e.g. every introduced word so far has
  // been missed) — pick from all introduced words rather than returning
  // nothing, even if that means showing one slightly ahead of its own
  // scheduled reintroduction.
  const introduced = excludePreviousFillerWord(
    Array.from(wordGameSessionIntroducedWords),
  );

  return introduced.length > 0
    ? pickPrioritizedGameWord(introduced, { useAbilityWeight: false })
    : null;
}

async function fetchRandomWord() {
  if (
    wordGameMode === "session" &&
    wordGameSessionIntroducedWords.size >= wordGameSessionTarget
  ) {
    currentWordQueueType = "session-filler";

    // The word budget is already spent, so even a quota catch-up stays inside
    // the round's introduced-word review pool.
    const fillerCandidates = getFillerReviewCandidates();
    const myWordsQuotaEntry = shouldPrioritizeMyWordsQuestion()
      ? pickMyWordsQuotaWord(fillerCandidates)
      : null;
    const fillerEntry =
      myWordsQuotaEntry ?? pickWordGameSessionFillerWord();

    // getEligibleGameWords' previousWord check is bypassed on this path, so
    // it's kept in sync here instead — otherwise a later non-filler draw in
    // the same round wouldn't know a filler question was just shown.
    if (fillerEntry) {
      if (!plannedQuestionMode) {
        plannedQuestionMode = chooseQuestionModeFromPlan(
          getQuestionPairPlan(fillerEntry),
        );
      }
      previousWord = fillerEntry.ord;
      if (!wordGamePlacementCalibrationEnabled) {
        recordMyWordsMixQuestion(isMyWordsEntry(fillerEntry));
      }
    }

    return fillerEntry;
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

  let selectedEntry;
  if (wordGameIsPlacementRound) {
    await loadVocabularyFrequencyRanks();
    currentWordQueueType = "placement";
    selectedEntry = pickPrioritizedGameWord(
      getCoreVocabularyCandidatePool(eligibleEntries),
      {
        useAbilityWeight: true,
        useUsefulnessWeight: true,
      },
    );
  } else {
    // The Mix percentage is a round-level contract. Quota slots can draw
    // from any exercise-compatible saved word, including one already shown
    // this round. The review/new portfolio operates inside either the saved
    // pool or the ordinary pool without changing whether this is a Mix slot.
    const queues = buildGameWordQueues(eligibleEntries);
    const reviewShare = getReviewPortfolioShareForQueues(queues);
    const mixEligibleEntries = shouldPrioritizeMyWordsQuestion()
      ? getEligibleGameWords(selectedPOS, { allowIntroduced: true })
      : [];
    const myWordsQuotaEntry = pickMyWordsQuotaWord(
      mixEligibleEntries,
      reviewShare,
    );

    if (myWordsQuotaEntry) {
      selectedEntry = myWordsQuotaEntry;
      currentWordQueueType = getGameEntryQueue(myWordsQuotaEntry);
    } else {
      const queueName = getPortfolioGameQueueName(queues, reviewShare);
      const a0ReinforcementCandidates =
        queueName === "new" && hasActiveA0Support()
          ? getA0ReinforcementCandidates(
              getEligibleGameWords(selectedPOS, { allowIntroduced: true }),
            )
          : [];
      const a0ReinforcementEntry = shouldPrioritizeA0Reinforcement(
        a0ReinforcementCandidates,
      )
        ? pickPrioritizedGameWord(a0ReinforcementCandidates, {
            useAbilityWeight: false,
          })
        : null;
      if (queueName === "new") {
        await loadVocabularyFrequencyRanks();
      }
      if (a0ReinforcementEntry) {
        // A scheduled word is deliberately brought forward as a gentle
        // within-session reinforcement. It receives normal answer feedback,
        // but never extends its durable interval (see handleTranslationClick).
        selectedEntry = a0ReinforcementEntry;
        currentWordQueueType = "a0-reinforcement";
      } else {
        currentWordQueueType = queueName;
        const queueEntries =
          queueName === "scheduled"
            ? getNearestScheduledGameWords(queues.scheduled)
            : queues[queueName] ?? [];
        const ordinaryQueueEntries =
          queueName === "new"
            ? getCoreVocabularyCandidatePool(queueEntries)
            : queueEntries;
        // Ability weighting only shapes unseen words. Due and relearning words
        // have already earned their priority through the scheduler.
        selectedEntry =
          queueName === "scheduled"
            ? pickPrioritizedGameWord(ordinaryQueueEntries, {
                useAbilityWeight: false,
              })
            : pickPrioritizedGameWord(ordinaryQueueEntries, {
                useAbilityWeight: queueName === "new",
                useUsefulnessWeight: queueName === "new",
                useRecallNeedWeight: [
                  "relearning",
                  "due",
                  "approaching",
                ].includes(queueName),
              });
      }
    }
  }

  if (!selectedEntry) {
    return null;
  }

  if (!plannedQuestionMode) {
    plannedQuestionMode = chooseQuestionModeFromPlan(
      getQuestionPairPlan(selectedEntry),
    );
  }

  if (!wordGamePlacementCalibrationEnabled) {
    recordMyWordsMixQuestion(isMyWordsEntry(selectedEntry));
  }
  if (!wordGameIsPlacementRound) {
    recordReviewPortfolioQuestion(currentWordQueueType);
    recordA0PacingQuestion(currentWordQueueType);
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
      !isExcludedFromRandomSelection(entry.ord)
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

function saveAbilityState({ syncRemote = true, cloudPending = false } = {}) {
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
      detail: {
        score: abilityScore,
        placementCompleted,
        syncRemote,
        cloudPending,
      },
    }),
  );
}

// Seeds/finalizes the estimate immediately before the first real practice
// round (and before a learner-requested recalibration round later). Direct
// answers then adapt it through updateAbilityScore.
function completePlacementTest(score) {
  abilityScore = clampAbility(Math.round(score));
  placementCompleted = true;
  saveAbilityState();
}

function finalizePlacementCompletion(wasPlacementRound, roundWasComplete) {
  if (wasPlacementRound && roundWasComplete) {
    placementCompleted = true;
  }
}

function seedPlacementEstimate(score) {
  abilityScore = clampAbility(Math.round(score));
  // Preserve true for an existing learner who is voluntarily retaking
  // placement; preserve false for a first-time learner until question 10.
  saveAbilityState();
}

function startPlacementPracticeRound(score, { calibrate = true } = {}) {
  if (!Array.isArray(results) || results.length === 0) {
    renderWordGameLoadingMessage();
    return false;
  }

  if (calibrate) {
    seedPlacementEstimate(score);
  } else {
    // "Skip placement" is an explicit opt-out and therefore the only path
    // that marks a first-time learner complete before the round finishes.
    completePlacementTest(score);
  }
  window.trackEvent?.("tutorial_begin", {
    content_type: "placement",
    skipped: !calibrate,
  });
  beginWordGameRound("session", PLACEMENT_PRACTICE_WORD_COUNT, {
    placementRound: true,
    placementCalibration: calibrate,
  });
  return true;
}

function replaceAbilityState(remoteScore, remotePlacementCompleted) {
  abilityScore = clampAbility(remoteScore);
  placementCompleted = Boolean(remotePlacementCompleted);
  saveAbilityState({ syncRemote: false });
}

function resetGame(resetStreak = true) {
  currentWordQueueType = null;
  previousWord = null;
  if (resetStreak) {
    correctStreak = 0; // Reset the streak if the flag is true
  }
  incorrectWordQueue = [];
  recentAnswers = []; // Clear the recent answers array
  renderStats(); // Re-render the stats display to reflect the reset
}

// Navigating away from Word Game mid-round (via #mode-nav, a landing-page
// card, browser back/forward, etc.) doesn't run the round-summary flow —
// only quitting or finishing a round did, until now — so wordGameRoundActive
// and its body class were left stuck true on every other page until the
// visitor happened to re-enter Word Game (whose own entry branch in
// handleTypeChange resets it as a side effect). Called from
// handleTypeChange (scripts.js) whenever the new type isn't "word-game", so
// leaving always ends whatever round was in progress, the same way quitting
// or finishing one already does.
function abandonWordGameRoundIfActive() {
  if (!wordGameRoundActive) return;
  if (wordGameIsPlacementRound) {
    window.trackEvent?.("placement_abandoned", {
      content_type: "placement",
      questions_answered: wordGameSessionQuestionsAnswered,
    });
  }
  wordGameRoundActive = false;
  updateEndSessionToolbarButtonVisibility();
}
window.abandonWordGameRoundIfActive = abandonWordGameRoundIfActive;

document.addEventListener("keydown", function (event) {
  if (getCurrentMode() !== "word-game") return;
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
  // showWordGameRoundSummary() sets wordGameRoundActive = false and calls
  // updateEndSessionToolbarButtonVisibility() itself, which closes
  // #game-round-menu as part of hiding the whole round-options row — no
  // need to do it here too.
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
  getPredictionCalibrationReport,
  resetPredictionCalibrationReport,
  isPlacementCompleted: () => placementCompleted,
  getCefrAnchors: () => ({ ...CEFR_DIFFICULTY_ANCHOR }),
  getWordDifficulty: getWordDifficultyAnchor,
  completePlacement: completePlacementTest,
  startPlacementRound: startPlacementPracticeRound,
  replaceAbility: replaceAbilityState,
  startWordGame,
  getVocabStrengthFilterOptions,
  getWordStrengthFilterId,
  getVocabProgressSummary,
  buildVocabProgressBarMarkup,
  getVocabDueLabel,
  loadVocabularyFrequencyRanks,
  getVocabularyFrequencyRank,
});

// Keeps the vocabulary profile widget live if strength records change while
// the learner is already sitting on the landing page (e.g. a remote merge
// on sign-in) — renderLandingDailyQuests() only re-renders it on the paths
// that already touch daily-quest state, which word-strength updates don't.
window.addEventListener("word-strength:updated", () => {
  renderLandingProgressSummary();
});

renderLandingDailyQuests();
// Frequency data now feeds getWordDifficultyAnchor for every answer's Elo
// rating update, not just new-word/placement draws (see the two narrower
// `await loadVocabularyFrequencyRanks()` calls above) — kick off the fetch
// here (via deferUntilNeeded(), scripts.js — idle callback, or immediately
// on the first sign of real intent: a search-bar focus/input, or any
// mode-nav/landing-card click) so it's virtually always resolved by the
// time a learner reaches their first real answer, even in an all-review
// session that would otherwise never trigger it — without also being one
// more multi-MB fetch competing with a landing page that hasn't shown any
// interest in Word Game yet. Never awaited: a slow/failed request must not
// block anything, and every consumer already degrades to the plain band
// center when this hasn't resolved yet.
deferUntilNeeded(loadVocabularyFrequencyRanks);
