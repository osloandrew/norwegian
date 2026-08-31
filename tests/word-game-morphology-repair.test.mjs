import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "wordGame.js"), "utf8");

const classNames = new Set();
const reveal = {
  dataset: {},
  classList: { remove: (name) => classNames.delete(name) },
  innerHTML: "",
};
const submit = { textContent: "Check" };
const form = {
  classList: { add: (...names) => names.forEach((name) => classNames.add(name)) },
  querySelector: () => submit,
};
const attributes = new Map();
let focused = false;
let selection = null;
const input = {
  value: "spise",
  setAttribute: (name, value) => attributes.set(name, value),
  focus: () => { focused = true; },
  setSelectionRange: (start, end) => { selection = [start, end]; },
};
const status = { textContent: "" };
const document = {
  getElementById: (id) => ({
    "game-teaching-reveal": reveal,
    "game-typed-answer-input": input,
    "game-answer-status": status,
  })[id] ?? null,
  querySelector: (selector) =>
    selector === ".game-typed-answer-form" ? form : null,
};
const escapeHTML = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const context = vm.createContext({ document, escapeHTML, Object, String });

const runSection = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  vm.runInContext(source.slice(start, end), context, { filename: "wordGame.js" });
};

runSection("function normalizeGameWhitespace", "function normalizeGameAnswer");
runSection("function escapeGameHTML", "function getPrimaryNorwegianForm");
runSection("const GAME_OUTCOME_ICON_SVG", "async function renderGameTeachingReveal");

const feedback = {
  isUnambiguous: true,
  repairPrompt:
    "Almost — right word, wrong form. “spise” is the infinitive. This sentence needs present tense. Try again.",
  selectedAnswer: "spise",
  correction: "spiser",
  selectedLabels: ["the infinitive"],
  requiredLabels: ["present tense"],
};

assert.equal(context.getMorphologyFormContrast(feedback), "å spise → spiser");
assert.equal(context.renderMorphologyRepairPrompt(feedback), true);
assert.equal(reveal.dataset.state, "almost");
assert.match(reveal.innerHTML, /right word, wrong form/);
assert.doesNotMatch(reveal.innerHTML, />spiser</);
assert.match(reveal.innerHTML, /Edit your answer below/);
assert.equal(submit.textContent, "Try Again");
assert.equal(classNames.has("is-almost"), true);
assert.equal(classNames.has("is-repairing"), true);
assert.equal(attributes.get("aria-invalid"), "true");
assert.equal(status.textContent, feedback.repairPrompt);
assert.equal(focused, true);
assert.deepEqual(selection, [5, 5]);

assert.equal(
  context.renderMorphologyRepairPrompt({
    ...feedback,
    isUnambiguous: false,
  }),
  false,
);

const handlerStart = source.indexOf("async function handleTranslationClick");
const handlerEnd = source.indexOf("async function fetchExampleSentence", handlerStart);
const handler = source.slice(handlerStart, handlerEnd);
assert.ok(
  handler.indexOf("renderMorphologyRepairPrompt(morphologyNearMiss)") <
    handler.indexOf("recordQuestionPredictionOutcome("),
  "The repair prompt must happen before grading or adaptive-state mutation.",
);
assert.match(handler, /const answerWasCorrect = morphologyRepair\s*\? false/);
assert.match(handler, /if \(!morphologyRepair\) correctStreak = 0/);
assert.match(handler, /scheduleAdaptiveRecovery\(/);
assert.match(
  source,
  /isCorrect \|\| morphologyNearMiss\?\.repairSucceeded/,
  "A repaired value should not remain aria-invalid after it is accepted.",
);

console.log("word-game morphology repair tests passed");
