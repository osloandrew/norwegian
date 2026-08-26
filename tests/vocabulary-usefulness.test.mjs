import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { loadWordGamePolicy } from "./load-word-game-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wordGameSource = fs.readFileSync(path.join(root, "wordGame.js"), "utf8");
const frequencyData = JSON.parse(
  fs.readFileSync(path.join(root, "vocabulary-frequency.json"), "utf8"),
);

assert.equal(frequencyData.version, 4);
assert.equal(frequencyData.sources.clarino.license, "CC BY-NC 4.0");
assert.equal(
  frequencyData.sources.clarino.sourceFile,
  "clarino-aviskorpus-bokmal-top-100000.tsv",
);
assert.equal(
  frequencyData.method,
  "entry-counts-exact-then-unique-official-inflection",
);
assert.ok(frequencyData.sources.clarino.sourceLexicalForms >= 50000);
assert.ok(frequencyData.matchedDictionaryEntries >= 14000);
assert.ok(
  frequencyData.entries["i|preposition"].rank <
    frequencyData.entries["hus|et"].rank,
);
// The source documentation calls uppercase Foto a newspaper-credit artifact;
// the lowercase-only build must not accidentally restore its top-50 rank.
assert.ok(frequencyData.entries["foto|et"].rank > 1000);

const weightStart = wordGameSource.indexOf(
  "const VOCABULARY_FREQUENCY_DATA_VERSION",
);
const weightEnd = wordGameSource.indexOf(
  "// The scheduler first chooses an explicit queue",
  weightStart,
);
assert.notEqual(weightStart, -1);
assert.notEqual(weightEnd, -1);

const context = vm.createContext({ Math, Number, Object, URL, console });
context.window = context;
loadWordGamePolicy(root, context);
context.normalizeGameAnswer = (value) => String(value).trim().toLowerCase();
context.getPrimaryNorwegianForm = (entry) => String(entry?.ord ?? "").split(",")[0];
vm.runInContext(
  wordGameSource.slice(weightStart, weightEnd),
  context,
  { filename: "wordGame.js" },
);
vm.runInContext(
  `vocabularyFrequencyEntries = ${JSON.stringify(frequencyData.entries)};`,
  context,
);

const topWeight = context.getVocabularyUsefulnessWeight({
  ord: "i",
  gender: "preposition",
});
const commonWeight = context.getVocabularyUsefulnessWeight({
  ord: "hus",
  gender: "et",
});
const rareWeight = context.getVocabularyUsefulnessWeight({
  ord: "diplomatisk",
  gender: "adjective",
});
const unmatchedWeight = context.getVocabularyUsefulnessWeight({
  ord: "xyzzy",
  gender: "noun",
});

assert.ok(topWeight > commonWeight);
assert.ok(commonWeight > rareWeight);
assert.ok(rareWeight > 1);
assert.ok(topWeight <= 1.7);
// "i" is an extremely common word across all three blended registers, but
// blending is a mean across sources rather than a single corpus's max, so
// this only requires it to be near the top of the boost range, not at it.
assert.ok(topWeight > 1.6);
assert.ok(commonWeight < 1.7);
assert.equal(unmatchedWeight, 1);
const expectedCommonWeight =
  1 + 0.7 * frequencyData.entries["hus|et"].weight;
assert.ok(Math.abs(commonWeight - expectedCommonWeight) < 1e-9);
assert.equal(
  context.getVocabularyFrequencyRecord({ ord: "hus, huset", gender: "et" })
    .rank,
  frequencyData.entries["hus|et"].rank,
);

// getWordDifficultyAnchor: the real function, run in the same context (which
// already has the real getVocabularyFrequencyRecord/EntryKey and the real
// committed frequency data loaded above) plus a plain CEFR_DIFFICULTY_ANCHOR
// literal, since that table's real definition lives elsewhere in the file.
context.CEFR_DIFFICULTY_ANCHOR = { A1: 100, A2: 300, B1: 500, B2: 700, C: 900 };
const difficultyStart = wordGameSource.indexOf("function getWordCefrLabel");
const difficultyEnd = wordGameSource.indexOf(
  "// Elo/logistic-style update",
  difficultyStart,
);
assert.notEqual(difficultyStart, -1);
assert.notEqual(difficultyEnd, -1);
vm.runInContext(
  wordGameSource.slice(difficultyStart, difficultyEnd),
  context,
  { filename: "wordGame.js" },
);

// A matched word's difficulty is nudged from its band center by exactly the
// documented formula, using its real committed bandPercentile.
const husBandPercentile = frequencyData.entries["hus|et"].bandPercentile;
const husDifficulty = context.getWordDifficultyAnchor({
  ord: "hus",
  gender: "et",
  CEFR: "B1",
});
const expectedHusDifficulty = 500 - (husBandPercentile - 0.5) * 2 * 80;
assert.ok(Math.abs(husDifficulty - expectedHusDifficulty) < 1e-9);

// A word with no frequency record at all falls back to the plain band
// center, unchanged from before this refinement existed.
assert.equal(
  context.getWordDifficultyAnchor({ ord: "xyzzy", gender: "noun", CEFR: "B1" }),
  500,
);

// The nudge can never cross into a neighboring band: even at the percentile
// extremes (0 and 1), difficulty stays strictly inside [center-80, center+80].
// Reassigning through vm.runInContext (not a direct `context.x =` property
// set) matters here: vocabularyFrequencyEntries was declared with `let`
// inside the earlier slice, and a vm context's `let`/`const` bindings live
// in a lexical environment separate from the context object's own
// properties, so only a script run in the same context can reach it.
vm.runInContext(
  `vocabularyFrequencyEntries = ${JSON.stringify({
    "mostcommonb1|noun": { bandPercentile: 1 },
    "rarestb1|noun": { bandPercentile: 0 },
  })};`,
  context,
);
const easiestB1 = context.getWordDifficultyAnchor({
  ord: "mostcommonb1",
  gender: "noun",
  CEFR: "B1",
});
const hardestB1 = context.getWordDifficultyAnchor({
  ord: "rarestb1",
  gender: "noun",
  CEFR: "B1",
});
assert.ok(easiestB1 > 500 - 80 - 1e-9 && easiestB1 < 500);
assert.ok(hardestB1 < 500 + 80 + 1e-9 && hardestB1 > 500);
assert.ok(easiestB1 < hardestB1);

const coreStart = wordGameSource.indexOf("function getRawAbilityProximity");
const coreEnd = wordGameSource.indexOf(
  "// useAbilityWeight is false",
  coreStart,
);
assert.notEqual(coreStart, -1);
assert.notEqual(coreEnd, -1);
const coreContext = vm.createContext({ Math });
coreContext.window = coreContext;
loadWordGamePolicy(root, coreContext);
vm.runInContext(
  `
    let abilityScore = 500;
    const ABILITY_PROXIMITY_SIGMA = 140;
    const CORE_VOCABULARY_MIN_PROXIMITY = 0.25;
    let vocabularyFrequencyEntries = {};
    function getWordDifficultyAnchor(entry) { return entry.difficulty; }
    function getVocabularyFrequencyRank(entry) { return entry.rank ?? null; }
  `,
  coreContext,
);
vm.runInContext(
  wordGameSource.slice(coreStart, coreEnd),
  coreContext,
  { filename: "wordGame.js" },
);

const nearbyCore = { ord: "core-nearby", rank: 100, difficulty: 500 };
const distantCore = { ord: "core-distant", rank: 200, difficulty: 100 };
const distantHarderCore = { ord: "core-harder", rank: 300, difficulty: 900 };
const nearbyRare = { ord: "rare-nearby", rank: null, difficulty: 500 };
assert.deepEqual(
  [...coreContext.getCoreVocabularyCandidatePool([
    nearbyCore,
    distantCore,
    distantHarderCore,
    nearbyRare,
  ])],
  [nearbyCore, distantHarderCore],
);
vm.runInContext("abilityScore = 900", coreContext);
const advancedNearbyCore = {
  ord: "advanced-nearby",
  rank: 400,
  difficulty: 700,
};
assert.deepEqual(
  [...coreContext.getCoreVocabularyCandidatePool([
    distantCore,
    nearbyCore,
    advancedNearbyCore,
    distantHarderCore,
  ])],
  [advancedNearbyCore, distantHarderCore],
);
// Once no suitably challenging core word remains, the complete pool is
// admitted rather than the game being starved by distant beginner words.
vm.runInContext("abilityScore = 500", coreContext);
assert.deepEqual(
  [...coreContext.getCoreVocabularyCandidatePool([distantCore, nearbyRare])],
  [distantCore, nearbyRare],
);

// Selection policy: usefulness is awaited and enabled only for placement and
// the scheduler's new queue. Due/relearning/scheduled paths retain their SRS
// priority and do not use this preference signal.
assert.match(
  wordGameSource,
  /if \(wordGameIsPlacementRound\) \{\s*await loadVocabularyFrequencyRanks\(\);[\s\S]*?useUsefulnessWeight: true/,
);
assert.match(
  wordGameSource,
  /if \(queueName === "new"\) \{\s*await loadVocabularyFrequencyRanks\(\);/,
);
assert.match(
  wordGameSource,
  /useUsefulnessWeight: queueName === "new"/,
);
assert.match(
  wordGameSource,
  /getCoreVocabularyCandidatePool\(eligibleEntries\)/,
);

console.log("vocabulary usefulness tests passed");
