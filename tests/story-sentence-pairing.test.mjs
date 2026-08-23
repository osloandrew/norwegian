import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "stories.js"), "utf8");
const helperStart = source.indexOf("const STORY_SENTENCE_REGEX");
const helperEnd = source.indexOf("function displayStory", helperStart);
assert.notEqual(helperStart, -1, "Missing story sentence helpers");
assert.notEqual(helperEnd, -1, "Missing displayStory marker");

const context = vm.createContext({ String });
vm.runInContext(
  source.slice(helperStart, helperEnd) +
    "\nthis.storySentenceAPI = { getStorySentencePairs };",
  context,
  { filename: "stories.js" },
);
const { getStorySentencePairs } = context.storySentenceAPI;

// A genuine speech attribution remains attached to its quotation.
const dialogue = getStorySentencePairs(
  '"Kan jeg få passordet?" spurte Maria høflig. Så satte hun seg.',
  '"Can I have the password?" Maria asked politely. Then she sat down.',
);
assert.equal(dialogue.norwegianSentences.length, 2);
assert.equal(dialogue.englishSentences.length, 2);
assert.equal(
  dialogue.englishSentences[0],
  '"Can I have the password?" Maria asked politely.',
);

// A complete sentence that merely contains "asked" must stay separate even
// when the preceding sentence happens to end with a quoted name.
const falseAttribution = getStorySentencePairs(
  'Han kalte seg "Don Quixote." Han ba Sancho bli med.',
  'He called himself "Don Quixote." He also needed a companion, so he asked Sancho to join him.',
);
assert.equal(falseAttribution.norwegianSentences.length, 2);
assert.equal(falseAttribution.englishSentences.length, 2);

const require = createRequire(import.meta.url);
const Papa = require(path.join(root, "vendor/papaparse.min.js"));
const stories = Papa.parse(
  fs.readFileSync(path.join(root, "norwegianStories.csv"), "utf8"),
  { header: true, skipEmptyLines: true },
).data;

const mismatches = [];
for (const story of stories) {
  const paired = getStorySentencePairs(story.norwegian, story.english);
  if (paired.norwegianSentences.length !== paired.englishSentences.length) {
    mismatches.push({
      title: story.titleEnglish,
      norwegian: paired.norwegianSentences.length,
      english: paired.englishSentences.length,
    });
  }
}
assert.deepEqual(mismatches, []);

const donQuixote = stories.find((story) => story.titleEnglish === "Don Quixote");
assert.ok(donQuixote, "Don Quixote story is missing");
const donQuixotePairs = getStorySentencePairs(
  donQuixote.norwegian,
  donQuixote.english,
);
assert.equal(donQuixotePairs.norwegianSentences.length, 18);
assert.equal(donQuixotePairs.englishSentences.length, 18);
assert.equal(
  donQuixotePairs.englishSentences[3],
  'He put on an old suit of armor, found an old horse named Rocinante, and called himself "Don Quixote."',
);
assert.equal(
  donQuixotePairs.englishSentences[4],
  "He also needed a companion, so he asked a farmer named Sancho Panza to join him.",
);

console.log("story sentence pairing tests passed");
