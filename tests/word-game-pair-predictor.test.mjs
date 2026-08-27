import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { loadWordGamePolicy } from "./load-word-game-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "wordGame.js"), "utf8");
const stored = new Map();
const context = vm.createContext({
  Math,
  Date,
  JSON,
  Number,
  Object,
  Set,
});
context.window = context;
loadWordGamePolicy(root, context);
context.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
};
context.WordStrengthAPI = {
  getSnapshot: (entry) => entry.snapshot ?? null,
  getSkillSnapshot: (entry, skill) =>
    entry.skillSnapshots?.[skill] ?? entry.snapshot ?? null,
};
context.getWordDifficultyAnchor = (entry) => entry.difficulty;
context.getPrimaryNorwegianForm = (entry) => String(entry?.ord ?? "");
context.normalizeGameWhitespace = (value) => String(value ?? "").trim();
context.getExpectedSuccessProbability = (difficulty, ability) =>
  1 / (1 + Math.exp((difficulty - ability) / 180));
context.getTypedRecallProbability = () => 0.5;
context.getGameSentenceTranslation = (entry) => entry.translation ?? "";
context.hasPlayableWordAudio = (entry) => entry.audio === true;
context.interpolateByAbility = (_ability, table) => table.B2;
context.pickWeightedGameWord = (entries, weights) =>
  entries[weights.indexOf(Math.max(...weights))] ?? null;
context.getDailyQuestQuestionMode = () => "cloze";
context.getBonusRoundQuestionMode = () => "typed-reverse";

vm.runInContext(
  `
    var abilityScore = 700;
    var CEFR_DIFFICULTY_ANCHOR = { A1: 100 };
    var wordGameIsPlacementRound = false;
    var wordGameIsTodayPracticeRound = false;
    var wordGameIsBonusRound = false;
    var wordGameDailyQuestIndex = 0;
    var wordGameSessionQuestionsAnswered = 0;
    var wordGameSessionIntroducedWords = new Set();
    var LISTENING_PROBABILITY = { B2: 0.35 };
    var REVERSE_FLASHCARD_PROBABILITY = { B2: 0.45 };
    var BANNED_WORD_CLASSES = [];
    var currentQuestionPrediction = null;
  `,
  context,
);

const start = source.indexOf("const QUESTION_PAIR_PREDICTOR_STORAGE_KEY");
const end = source.indexOf("function getTypedAcceptedAnswers", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);
vm.runInContext(source.slice(start, end), context, {
  filename: "wordGame.js",
});

const nearAbility = {
  ord: "near",
  difficulty: 700,
  translation: "near translation",
  audio: true,
};
const easy = { ...nearAbility, ord: "easy", difficulty: 350 };
const hard = { ...nearAbility, ord: "hard", difficulty: 950 };

assert.equal(context.getQuestionSkillForMode("forward"), "recognition");
assert.equal(context.getQuestionSkillForMode("reverse"), "production");
assert.equal(context.getQuestionSkillForMode("typed-listening"), "listening");
assert.equal(context.getQuestionSkillForMode("typed-cloze"), "context");

assert.ok(
  context.predictQuestionSuccess(nearAbility, "forward") >
    context.predictQuestionSuccess(nearAbility, "reverse"),
);
assert.ok(
  context.predictQuestionSuccess(nearAbility, "reverse") >
    context.predictQuestionSuccess(nearAbility, "typed-reverse"),
);
assert.ok(
  context.predictQuestionSuccess(easy, "forward") >
    context.predictQuestionSuccess(hard, "forward"),
);

const easyRenderedCloze = {
  form: "spiser",
  sentence: "Jeg spiser brød hver morgen.",
  sentenceVocabularySuccess: 0.92,
  targetContextCoverage: 0.8,
  distractorSimilarity: 0.15,
  translationAvailable: true,
  audioAvailable: false,
};
const hardRenderedCloze = {
  form: "eksemplifiserte",
  sentence: "Eksemplifiserte hun den særdeles komplekse problemstillingen?",
  sentenceVocabularySuccess: 0.45,
  targetContextCoverage: 0.2,
  distractorSimilarity: 0.9,
  translationAvailable: false,
  audioAvailable: false,
};
assert.ok(
  context.predictQuestionSuccess(
    nearAbility,
    "typed-cloze",
    Date.now(),
    easyRenderedCloze,
  ) >
    context.predictQuestionSuccess(
      nearAbility,
      "typed-cloze",
      Date.now(),
      hardRenderedCloze,
    ),
);

const remembered = {
  ...nearAbility,
  snapshot: { record: {}, retrievability: 0.95 },
};
const forgotten = {
  ...nearAbility,
  snapshot: { record: {}, retrievability: 0.2 },
};
assert.ok(
  context.predictQuestionSuccess(remembered, "reverse") >
    context.predictQuestionSuccess(forgotten, "reverse"),
);

const skillSpecific = {
  ...nearAbility,
  skillSnapshots: {
    recognition: { record: {}, retrievability: 0.97 },
    production: { record: {}, retrievability: 0.25 },
  },
};
assert.ok(
  context.predictQuestionSuccess(skillSpecific, "forward") >
    context.predictQuestionSuccess(skillSpecific, "reverse"),
);
const contextReady = {
  ...nearAbility,
  skillSnapshots: {
    recognition: { record: {}, retrievability: 0.96 },
  },
};
const contextNotReady = {
  ...nearAbility,
  skillSnapshots: {
    recognition: { record: {}, retrievability: 0.3 },
  },
};
assert.ok(
  context.getQuestionProgressionWeight(contextReady, "cloze") >
    context.getQuestionProgressionWeight(contextNotReady, "cloze"),
);
assert.ok(
  context.getQuestionProgressionWeight(contextNotReady, "cloze") >= 0.15,
);
const productionDue = {
  ...nearAbility,
  snapshot: {
    record: {},
    queue: "due",
    isDue: true,
    isApproaching: false,
    recallNeed: 0.6,
  },
  skillSnapshots: {
    recognition: {
      record: {},
      queue: "scheduled",
      isDue: false,
      isApproaching: false,
      recallNeed: 0,
      retrievability: 0.97,
    },
    production: {
      record: {},
      queue: "due",
      isDue: true,
      isApproaching: false,
      recallNeed: 0.6,
      retrievability: 0.7,
    },
  },
};
assert.ok(
  context.getQuestionSkillUrgencyWeight(productionDue, "reverse") >
    context.getQuestionSkillUrgencyWeight(productionDue, "forward") * 10,
);

assert.ok(
  context.getQuestionPairChallengeFit(0.84) >
    context.getQuestionPairChallengeFit(0.98),
);
assert.ok(
  context.getQuestionPairChallengeFit(0.86) >
    context.getQuestionPairChallengeFit(0.45),
);

const initialBias = vm.runInContext(
  "questionPairPredictorState.modes.forward.bias",
  context,
);
context.beginQuestionPrediction(nearAbility, "forward");
context.recordQuestionPredictionOutcome(true);
const correctBias = vm.runInContext(
  "questionPairPredictorState.modes.forward.bias",
  context,
);
assert.ok(correctBias > initialBias);
context.beginQuestionPrediction(nearAbility, "forward");
context.recordQuestionPredictionOutcome(false);
const missedBias = vm.runInContext(
  "questionPairPredictorState.modes.forward.bias",
  context,
);
assert.ok(missedBias < correctBias);
assert.ok(
  JSON.parse(
    stored.get("norwegian-dictionary-question-pair-predictor-v1"),
  ).modes.forward.attempts === 2,
);
assert.equal(
  JSON.parse(stored.get("norwegian-dictionary-question-pair-predictor-v1"))
    .skills.recognition.attempts,
  2,
);
context.beginQuestionPrediction(nearAbility, "forward");
context.recordQuestionPredictionOutcome(true, {
  nearMiss: true,
  wasTyped: true,
});
assert.equal(
  JSON.parse(stored.get("norwegian-dictionary-question-pair-predictor-v1"))
    .skills.recognition.nearMisses,
  1,
);
const storedEvaluation = JSON.parse(
  stored.get("norwegian-dictionary-prediction-evaluation-v1"),
);
assert.equal(storedEvaluation.total.count, 3);
assert.equal(storedEvaluation.modes.forward.count, 3);
assert.equal(storedEvaluation.difficultyBuckets["600-799"].count, 3);
const calibrationReport = context.getPredictionCalibrationReport();
assert.equal(calibrationReport.overall.count, 3);
assert.equal(calibrationReport.byMode.forward.count, 3);
assert.equal(calibrationReport.byMode.forward.nearMissRate, 1 / 3);
assert.equal(context.resetPredictionCalibrationReport().overall.count, 0);
assert.equal(
  JSON.parse(stored.get("norwegian-dictionary-prediction-evaluation-v1"))
    .total.count,
  0,
);

vm.runInContext("wordGameIsPlacementRound = true", context);
assert.deepEqual(
  [...context.getQuestionModeCandidates(nearAbility)].map((item) => item.mode),
  ["forward"],
);

vm.runInContext(
  "wordGameIsPlacementRound = false; wordGameIsTodayPracticeRound = true",
  context,
);
assert.ok(
  context
    .getQuestionModeCandidates(nearAbility)
    .every((item) => item.mode === "cloze" || item.mode === "typed-cloze"),
);

vm.runInContext(
  "wordGameIsTodayPracticeRound = false; wordGameIsBonusRound = true",
  context,
);
assert.deepEqual(
  [...context.getQuestionModeCandidates(nearAbility)].map((item) => item.mode),
  ["typed-reverse"],
);

vm.runInContext("wordGameIsBonusRound = false", context);
const noAudioCandidates = context.getQuestionModeCandidates({
  ...nearAbility,
  audio: false,
});
assert.ok(
  noAudioCandidates.every(
    (item) => item.mode !== "listening" && item.mode !== "typed-listening",
  ),
);
assert.ok(
  Math.abs(
    noAudioCandidates.reduce((sum, item) => sum + item.weight, 0) - 1,
  ) < 1e-12,
);

assert.match(
  source,
  /const pairPlans = eligibleEntries\.map\(getQuestionPairPlan\)/,
);
assert.match(
  source,
  /wordGameIsPlacementRound \? 1 : pairPlans\[index\]\.totalPairWeight/,
);
assert.match(source, /plannedMode: selectedPlannedMode/);
assert.match(source, /buildRenderedClozePredictionExercise/);
assert.match(source, /recordPredictionEvaluation/);
assert.match(source, /recordQuestionPredictionOutcome\([\s\S]*?answerWasCorrect/);
assert.match(source, /skill: answerSkill/);
assert.match(source, /nearMiss: nearMissTypedMatch/);
assert.match(source, /responseTimeMs/);

console.log("word-game pair predictor tests passed");
