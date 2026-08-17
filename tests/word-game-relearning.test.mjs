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

console.log("word-game relearning tests passed");
