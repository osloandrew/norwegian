import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "wordGame.js"), "utf8");

const poolStart = source.indexOf("function getA0CurriculumCandidatePool");
const poolEnd = source.indexOf("function recordA0AutomaticTarget", poolStart);
assert.notEqual(poolStart, -1);
assert.notEqual(poolEnd, -1);

const entries = [
  { ord: "jeg", CEFR: "A1", gender: "pronoun" },
  { ord: "hus", CEFR: "A1", gender: "et" },
  { ord: "reise", CEFR: "A2", gender: "verb" },
  { ord: "samfunn", CEFR: "B1", gender: "et" },
];
let support = 1;
const context = vm.createContext({
  Math,
  entries,
  getActiveA0SupportIntensity: () => support,
  getWordCefrLabel: (entry) => entry.CEFR,
  getA0CurriculumCategory: () => "content",
  wordGameA0AutomaticNewWordCount: 0,
  wordGameA0PronounCount: 0,
  wordGameA0FunctionWordCount: 0,
  window: {
    WordGamePolicy: {
      shouldPrioritizeQuota: () => false,
    },
  },
});
vm.runInContext(source.slice(poolStart, poolEnd), context, {
  filename: "wordGame.js",
});

assert.deepEqual(
  Array.from(context.getA0CurriculumCandidatePool(entries, 0.999)),
  entries.slice(0, 2),
  "maximum beginner focus must make automatic targets A1-only",
);

support = 0.72;
assert.deepEqual(
  Array.from(context.getA0CurriculumCandidatePool(entries, 0.5)),
  entries.slice(0, 2),
  "the handful-of-words path should usually draw from A1",
);
assert.equal(
  context.getA0CurriculumCandidatePool(entries, 0.9).length,
  entries.length,
  "partial support must blend the ordinary feed back in continuously",
);
const handfulA1Draws = Array.from(
  { length: 1000 },
  (_, index) =>
    context.getA0CurriculumCandidatePool(entries, index / 1000).length === 2,
).filter(Boolean).length;
assert.equal(handfulA1Draws, 720);

support = 0.48;
assert.deepEqual(
  Array.from(context.getA0CurriculumCandidatePool(entries, 0.4)),
  entries.slice(0, 2),
  "simple-conversation learners should retain a lighter A1 influence",
);
assert.equal(context.getA0CurriculumCandidatePool(entries, 0.6).length, 4);

context.getA0CurriculumCategory = (entry) =>
  entry.gender === "pronoun" ? "pronoun" : "content";
context.window.WordGamePolicy.shouldPrioritizeQuota = () => true;
assert.deepEqual(
  Array.from(context.getA0CurriculumCandidatePool(entries, 0.4)),
  [entries[0]],
  "a lagging pronoun share should narrow the otherwise A1-safe pool",
);

const focusConstantStart = source.indexOf("const A0_FOCUS_BY_ABILITY");
const focusConstantEnd = source.indexOf("function clampAbility", focusConstantStart);
const focusFunctionStart = source.indexOf("function getA0AbilityFocusCeiling");
const focusFunctionEnd = source.indexOf("function getA0SupportIntensity", focusFunctionStart);
const focusContext = vm.createContext({ Number, Object });
vm.runInContext(
  `${source.slice(focusConstantStart, focusConstantEnd)}\n${source.slice(focusFunctionStart, focusFunctionEnd)}`,
  focusContext,
  { filename: "wordGame.js" },
);
assert.equal(focusContext.getA0AbilityFocusCeiling(60), 1);
assert.equal(focusContext.getA0AbilityFocusCeiling(220), 0.72);
assert.equal(focusContext.getA0AbilityFocusCeiling(420), 0.48);
assert.ok(
  focusContext.getA0AbilityFocusCeiling(300) < 0.72 &&
    focusContext.getA0AbilityFocusCeiling(300) > 0.48,
  "focus must interpolate continuously between self-assessment anchors",
);

const distractorStart = source.indexOf(
  "function getA0SafeNorwegianDistractorPool",
);
const distractorEnd = source.indexOf(
  "function fetchIncorrectTranslations",
  distractorStart,
);
const distractorContext = vm.createContext({
  getActiveA0SupportIntensity: () => 1,
  getWordCefrLabel: (entry) => entry.CEFR,
});
vm.runInContext(source.slice(distractorStart, distractorEnd), distractorContext, {
  filename: "wordGame.js",
});
assert.deepEqual(
  Array.from(
    distractorContext.getA0SafeNorwegianDistractorPool(entries, entries[0]),
  ),
  entries.slice(0, 2),
  "A1 targets must not receive higher-level Norwegian distractors",
);

for (const essential of ["jeg", "vi", "han", "men", "nå"]) {
  assert.match(
    source,
    new RegExp(`A0_ESSENTIAL_WORDS[\\s\\S]*?"${essential}"`),
  );
}
assert.match(source, /jeg: new Set\(\["pronoun"\]\)/);
assert.match(source, /men: new Set\(\["conjunction"\]\)/);
assert.match(source, /nå: new Set\(\["adverb"\]\)/);

assert.match(
  source,
  /placementCandidates = getA0CurriculumCandidatePool\(eligibleEntries\)/,
);
assert.match(
  source,
  /queueName === "new"[\s\S]*?getA0CurriculumCandidatePool\(queueEntries\)/,
);

const exampleSafetyStart = source.indexOf(
  "async function getA0SafeExampleSentence",
);
const exampleSafetyEnd = source.indexOf(
  "function getRenderedTargetContextCoverage",
  exampleSafetyStart,
);
let exampleSupport = 1;
let vocabularySuccess = 0.69;
const exampleSafetyContext = vm.createContext({
  normalizeGameWhitespace: (value) => String(value || "").trim(),
  getActiveA0SupportIntensity: () => exampleSupport,
  getWordCefrLabel: (entry) => entry.CEFR,
  getRenderedSentenceVocabularySuccess: async () => vocabularySuccess,
});
vm.runInContext(
  source.slice(exampleSafetyStart, exampleSafetyEnd),
  exampleSafetyContext,
  { filename: "wordGame.js" },
);
const introductoryA1 = { CEFR: "A1" };
const outsideCurriculum = { CEFR: "B1" };
let safeExample = await exampleSafetyContext.getA0SafeExampleSentence(
  introductoryA1,
  "Jeg leser en bok.",
  "I am reading a book.",
  true,
);
assert.equal(
  safeExample.exampleSentence,
  "",
  "very difficult context may still be hidden on an introductory A1 exposure",
);
vocabularySuccess = 0.7;
safeExample = await exampleSafetyContext.getA0SafeExampleSentence(
  introductoryA1,
  "Jeg leser en bok.",
  "I am reading a book.",
  true,
);
assert.equal(
  safeExample.exampleSentence,
  "Jeg leser en bok.",
  "the relaxed full-support threshold should admit 70%-comprehensible context",
);
vocabularySuccess = 0.1;
safeExample = await exampleSafetyContext.getA0SafeExampleSentence(
  outsideCurriculum,
  "Dette er vanskelig.",
  "This is difficult.",
  true,
);
assert.equal(
  safeExample.exampleSentence,
  "Dette er vanskelig.",
  "non-A1 words must remain outside the introductory sentence safeguard",
);
safeExample = await exampleSafetyContext.getA0SafeExampleSentence(
  introductoryA1,
  "Dette er en senere repetisjon.",
  "This is a later review.",
  false,
);
assert.equal(
  safeExample.exampleSentence,
  "Dette er en senere repetisjon.",
  "reviews must remain outside the first-exposure safeguard",
);
assert.match(
  source,
  /getA0SafeExampleSentence\([\s\S]*?wordObj,[\s\S]*?a0FirstExposure/,
);

console.log("word-game A0 curriculum tests passed");
