import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { loadWordGamePolicy } from "./load-word-game-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "wordGame.js"), "utf8");
const start = source.indexOf("function configureRelearningEntryMode");
const end = source.indexOf("let wordDataStore", start);

assert.notEqual(start, -1);
assert.notEqual(end, -1);

const context = vm.createContext({});
context.window = context;
loadWordGamePolicy(root, context);
vm.runInContext(source.slice(start, end), context, { filename: "wordGame.js" });

const typedMiss = {
  requiresTypedMastery: true,
  forceTypedRetry: false,
  shown: true,
  availableAfterQuestion: 0,
};

assert.equal(
  context.applyCorrectRelearningResult(typedMiss, false, 8),
  "keep-for-typing",
);
assert.equal(typedMiss.forceTypedRetry, true);
assert.equal(typedMiss.shown, false);
assert.equal(typedMiss.availableAfterQuestion, 9);

// Only a successful typed retry is allowed to clear a typed miss.
assert.equal(
  context.applyCorrectRelearningResult(typedMiss, true, 9),
  "remove",
);
assert.equal(
  context.applyCorrectRelearningResult(
    { requiresTypedMastery: false },
    false,
    2,
  ),
  "remove",
);

// Recovery difficulty and spacing follow the failed pair's predicted
// success. An uncertain typed miss receives an easier scaffold, but that
// scaffold cannot clear the original productive skill.
const word = { ord: "prøve" };
const adaptiveTypedMiss = context.scheduleAdaptiveRecovery({
  wordObj: word,
  failedMode: "typed-reverse",
  predictedSuccess: 0.4,
  responseTimeMs: 12000,
  answeredQuestions: 8,
  baseGap: 4,
});
assert.equal(adaptiveTypedMiss.originalMode, "typed-reverse");
assert.equal(adaptiveTypedMiss.nextMode, "forward");
assert.equal(adaptiveTypedMiss.requiresOriginalSuccess, true);
assert.equal(adaptiveTypedMiss.forceTypedRetry, false);
assert.ok(adaptiveTypedMiss.availableAfterQuestion >= 10);

assert.equal(
  context.applyCorrectRelearningResult(
    adaptiveTypedMiss,
    false,
    10,
    "forward",
  ),
  "keep-for-original",
);
assert.equal(adaptiveTypedMiss.nextMode, "typed-reverse");
assert.equal(adaptiveTypedMiss.forceTypedRetry, true);
assert.ok(adaptiveTypedMiss.availableAfterQuestion >= 14);
assert.equal(
  context.applyCorrectRelearningResult(
    adaptiveTypedMiss,
    true,
    adaptiveTypedMiss.availableAfterQuestion,
    "typed-reverse",
  ),
  "remove",
);

const nearlyReadyTypedMiss = context.scheduleAdaptiveRecovery({
  wordObj: word,
  failedMode: "typed-reverse",
  predictedSuccess: 0.85,
  answeredQuestions: 3,
  baseGap: 4,
});
assert.equal(nearlyReadyTypedMiss.nextMode, "typed-reverse");
assert.equal(nearlyReadyTypedMiss.requiresOriginalSuccess, false);

const listeningMiss = context.scheduleAdaptiveRecovery({
  wordObj: word,
  failedMode: "listening",
  predictedSuccess: 0.35,
  answeredQuestions: 4,
  baseGap: 4,
});
assert.equal(listeningMiss.nextMode, "forward");

const variedContextMiss = context.scheduleAdaptiveRecovery({
  wordObj: word,
  failedMode: "typed-cloze",
  predictedSuccess: 0.82,
  answeredQuestions: 5,
  baseGap: 4,
  clozedForm: "prøvde",
  clozeSentence: "Hun prøvde en annen fremgangsmåte.",
  clozeSentenceTranslation: "She tried another approach.",
});
assert.equal(
  variedContextMiss.clozeSentence,
  "Hun prøvde en annen fremgangsmåte.",
);
assert.equal(
  variedContextMiss.clozeSentenceTranslation,
  "She tried another approach.",
);
const repeatedScaffoldMiss = context.scheduleAdaptiveRecovery({
  queueEntry: listeningMiss,
  wordObj: word,
  failedMode: "forward",
  predictedSuccess: 0.3,
  answeredQuestions: 7,
  baseGap: 4,
});
assert.equal(repeatedScaffoldMiss.originalMode, "listening");
assert.equal(repeatedScaffoldMiss.nextMode, "forward");
assert.equal(repeatedScaffoldMiss.requiresOriginalSuccess, true);

// Relearning remains an internal scheduler state, not a user-facing
// vocabulary category. A missed word stays on the ordinary strength ladder.
const tierStart = source.indexOf("const VOCAB_LADDER_TIERS");
const tierEnd = source.indexOf("function getVocabProgressSummary", tierStart);

assert.notEqual(tierStart, -1);
assert.notEqual(tierEnd, -1);

const tierContext = vm.createContext({ window: {} });
vm.runInContext(source.slice(tierStart, tierEnd), tierContext, {
  filename: "wordGame.js",
});

assert.deepEqual(
  Array.from(
    tierContext.getVocabStrengthFilterOptions(),
    ({ id, label }) => [id, label],
  ),
  [
    ["unpracticed", "Not practiced yet"],
    ["learning", "Learning"],
    ["developing", "Developing"],
    ["strengthening", "Strengthening"],
    ["strong", "Strong"],
    ["mastered", "Mastered"],
  ],
);
assert.equal(
  tierContext.getWordProgressTierId({
    strength: 0,
    record: { state: "relearning" },
  }),
  "learning",
);

console.log("word-game relearning tests passed");
