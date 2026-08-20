import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "wordGame.js"), "utf8");
const context = vm.createContext({ Math, Object, Set, String });
context.window = context;
context.self = context;
vm.runInContext(fs.readFileSync(path.join(root, "wordClass.js"), "utf8"), context, {
  filename: "wordClass.js",
});

let snapshot = null;
context.WordStrengthAPI = {
  getSnapshot: () => snapshot,
};

const runSection = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  vm.runInContext(source.slice(start, end), context, {
    filename: "wordGame.js",
  });
};

runSection("const TYPED_RECALL_PROBABILITY", "let previousWord");
runSection("function normalizeGameWhitespace", "function uppercaseFirstNorwegian");
runSection("function getGamePromptLengthClass", "function getTypedAnswerMarkup");
runSection("function getTypedAnswerMarkup", "// mode:");

const word = { ord: "fremtid, framtid" };

snapshot = { queue: "new", strength: null };
assert.equal(context.getTypedRecallProbability(word, "cloze"), 0);
assert.equal(context.getTypedRecallProbability(word, "reverse"), 0);

snapshot = { queue: "due", strength: 2 };
assert.equal(context.getTypedRecallProbability(word, "cloze"), 0.25);
assert.equal(context.getTypedRecallProbability(word, "reverse"), 0);
assert.equal(context.shouldUseTypedRecall(word, "cloze", 0.24), true);
assert.equal(context.shouldUseTypedRecall(word, "cloze", 0.25), false);

snapshot = { queue: "due", strength: 3 };
assert.equal(context.getTypedRecallProbability(word, "cloze"), 0.5);
assert.equal(context.getTypedRecallProbability(word, "reverse"), 0.35);

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

const answerButtonMatches = source.match(
  /<button type="button" class="game-translation-card"/g,
);
assert.equal(answerButtonMatches?.length, 2);
assert.doesNotMatch(source, /<div class="game-translation-card"/);
assert.doesNotMatch(source, /Correct:<\/|Correct: \$\{/);

console.log("word-game productive recall tests passed");
