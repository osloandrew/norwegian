import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "wordGame.js"), "utf8");
const start = source.indexOf("function applyCorrectRelearningResult");
const end = source.indexOf("let totalQuestions", start);

assert.notEqual(start, -1);
assert.notEqual(end, -1);

const context = vm.createContext({});
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
