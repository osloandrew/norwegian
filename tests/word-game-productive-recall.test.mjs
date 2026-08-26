import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "wordGame.js"), "utf8");
const context = vm.createContext({ Date, JSON, Math, Number, Object, Set, String });
context.window = context;
context.self = context;
context.localStorage = { getItem: () => null, setItem: () => {} };
vm.runInContext(fs.readFileSync(path.join(root, "wordClass.js"), "utf8"), context, {
  filename: "wordClass.js",
});

let snapshot = null;
const requestedSkills = [];
context.WordStrengthAPI = {
  getSnapshot: () => snapshot,
  getSkillSnapshot: (_word, skill) => {
    requestedSkills.push(skill);
    return snapshot;
  },
};
context.getWordDifficultyAnchor = (entry) => entry.difficulty ?? 700;
context.getExpectedSuccessProbability = (difficulty, ability) =>
  1 / (1 + Math.exp((difficulty - ability) / 180));

const runSection = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  vm.runInContext(source.slice(start, end), context, {
    filename: "wordGame.js",
  });
};

runSection("const TYPED_RECALL_READINESS", "let previousWord");
vm.runInContext(
  "var abilityScore = 700; var CEFR_DIFFICULTY_ANCHOR = { A1: 100 };",
  context,
);
runSection("function normalizeGameWhitespace", "function uppercaseFirstNorwegian");
runSection("function getGamePromptLengthClass", "function getTypedAnswerMarkup");
runSection("function getTypedAnswerMarkup", "// mode:");

const word = { ord: "fremtid, framtid", difficulty: 700 };

snapshot = { queue: "new", strength: null };
assert.equal(context.getTypedRecallProbability(word, "cloze"), 0);
assert.equal(context.getTypedRecallProbability(word, "reverse"), 0);

const easyWord = { ...word, difficulty: 300 };
snapshot = { queue: "due", record: {}, retrievability: 0.9 };
assert.equal(context.getTypedRecallProbability(easyWord, "cloze"), 1);
const reverseTypedProbability = context.getTypedRecallProbability(
  easyWord,
  "reverse",
);
assert.ok(reverseTypedProbability > 0 && reverseTypedProbability < 0.9);
assert.equal(
  context.shouldUseTypedRecall(easyWord, "reverse", reverseTypedProbability - 0.01),
  true,
);
assert.equal(
  context.shouldUseTypedRecall(easyWord, "reverse", reverseTypedProbability),
  false,
);
assert.ok(requestedSkills.includes("context"));
assert.ok(requestedSkills.includes("production"));

snapshot = { queue: "relearning", strength: 5 };
assert.equal(context.getTypedRecallProbability(word, "cloze"), 0);
assert.equal(context.getTypedRecallProbability(word, "reverse"), 0);

assert.deepEqual(
  [...context.getTypedAcceptedAnswers(word, false, "fremtid")],
  ["fremtid", "framtid"],
);
assert.deepEqual(
  [...context.getTypedAcceptedAnswers(word, true, "framtiden")],
  ["framtiden"],
);
assert.deepEqual(
  [...context.getTypedAcceptedAnswers({ ord: "gå inn/ut" }, false, "")],
  ["gå inn", "gå ut"],
);
const bathroomTarget = {
  ord: "bad",
  engelsk: "bathroom",
  gender: "et",
};
context.results = [
  bathroomTarget,
  { ord: "baderom", engelsk: "bathroom", gender: "noun - et" },
  { ord: "toalett", engelsk: "bathroom", gender: "en" },
  { ord: "badstue", engelsk: "sauna", gender: "et" },
];
assert.deepEqual(
  [...context.getTypedAcceptedAnswers(bathroomTarget, false, "")],
  ["bad", "baderom"],
);
const ifTarget = {
  ord: "hvis",
  engelsk: "if",
  gender: "conjunction",
};
context.results = [
  ifTarget,
  { ord: "om", engelsk: "whether, if", gender: "conjunction" },
  { ord: "om", engelsk: "hum", gender: "en" },
];
assert.deepEqual(
  [...context.getTypedAcceptedAnswers(ifTarget, false, "")],
  ["hvis", "om"],
);

// Typed-recall fuzzy matching: near-misses (missing æ/ø/å, a small typo)
// should be accepted; a genuinely different word should not.
assert.equal(context.isCloseEnoughTypedAnswer("hus", "hus"), true);
assert.equal(context.isCloseEnoughTypedAnswer("skole", "skoole"), true); // one extra letter
assert.equal(context.isCloseEnoughTypedAnswer("gjore", "gjøre"), true); // ø typed as o
assert.equal(context.isCloseEnoughTypedAnswer("kjaerlighet", "kjærlighet"), true); // æ typed as ae
assert.equal(context.isCloseEnoughTypedAnswer("bla", "blå"), true); // å typed as a
assert.equal(context.isCloseEnoughTypedAnswer("hus", "hys"), false); // short word, no tolerance
assert.equal(context.isCloseEnoughTypedAnswer("bil", "tog"), false); // different word entirely
assert.equal(
  context.isCloseEnoughTypedAnswer("nasjonalitet", "nasjonalitett"), // one extra letter, longer word
  true,
);
assert.equal(context.isCloseEnoughTypedAnswer("", "hus"), false);
assert.equal(context.isCloseEnoughTypedAnswer("hus", ""), false);

assert.equal(
  context.getGameSentenceTranslation(
    { sentenceTranslation: "First sentence. Second sentence!" },
    1,
  ),
  "Second sentence!",
);
assert.equal(
  context.getGameSentenceTranslation({ sentenceTranslation: "" }, 0),
  "",
);
assert.equal(context.getGamePromptLengthClass("A short prompt."), "");
assert.equal(
  context.getGamePromptLengthClass("x".repeat(90)),
  "game-prompt-long",
);
assert.equal(
  context.getGamePromptLengthClass("x".repeat(160)),
  "game-prompt-extra-long",
);

const typedMarkup = context.getTypedAnswerMarkup(0);
assert.match(typedMarkup, /<form class="game-typed-answer-form"/);
assert.match(typedMarkup, /<input[\s\S]+lang="nb"/);
assert.match(typedMarkup, /<button class="game-typed-submit" type="submit">/);
assert.doesNotMatch(typedMarkup, /game-typed-answer-feedback/);
assert.match(source, /input\.value = correctAnswer/);
assert.match(source, /input\.readOnly = true/);
assert.match(source, /form\.classList\.contains\("is-answered"\)/);
assert.match(source, /if \(event\.defaultPrevented\) return/);
assert.doesNotMatch(source, /feedback\.innerHTML = `Correct answer:/);

// Typed cloze relies on the English sentence as its semantic cue. It must
// remain visible even when the learner's global translation preference is
// hidden, both on initial render and after the answer is graded.
assert.match(
  source,
  /game-english-translation game-english-translation-required/,
);
assert.match(source, /wasTyped \|\| isEnglishVisible/);
assert.match(
  source,
  /translationElement\.classList\.contains\([\s\S]*?"game-english-translation-required"/,
);

const answerButtonMatches = source.match(
  /<button type="button" class="game-translation-card"/g,
);
// renderWordGameUI, renderClozeGameUI, and renderMinimalPairQuestion — real
// <button> elements every time, never the <div> the next assertion guards
// against.
assert.equal(answerButtonMatches?.length, 3);
assert.doesNotMatch(source, /<div class="game-translation-card"/);
assert.doesNotMatch(source, /Correct:<\/|Correct: \$\{/);

console.log("word-game productive recall tests passed");
