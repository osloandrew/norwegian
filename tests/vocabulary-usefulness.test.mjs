import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wordGameSource = fs.readFileSync(path.join(root, "wordGame.js"), "utf8");
const frequencyData = JSON.parse(
  fs.readFileSync(path.join(root, "vocabulary-frequency.json"), "utf8"),
);

assert.equal(frequencyData.version, 1);
assert.equal(frequencyData.license, "CC BY 3.0");
assert.equal(frequencyData.method, "exact-lowercase-dictionary-spelling-rank");
assert.ok(frequencyData.matchedDictionarySpellings >= 3000);
assert.ok(frequencyData.ranks.i < frequencyData.ranks.hus);
// The source documentation calls uppercase Foto a newspaper-credit artifact;
// the lowercase-only build must not accidentally restore its top-50 rank.
assert.ok(frequencyData.ranks.foto > 2000);

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
context.normalizeGameAnswer = (value) => String(value).trim().toLowerCase();
vm.runInContext(
  wordGameSource.slice(weightStart, weightEnd),
  context,
  { filename: "wordGame.js" },
);
vm.runInContext(
  `vocabularyFrequencyRanks = ${JSON.stringify(frequencyData.ranks)}`,
  context,
);

const topWeight = context.getVocabularyUsefulnessWeight({ ord: "i" });
const commonWeight = context.getVocabularyUsefulnessWeight({ ord: "hus" });
const rareWeight = context.getVocabularyUsefulnessWeight({ ord: "diplomatisk" });
const unmatchedWeight = context.getVocabularyUsefulnessWeight({ ord: "xyzzy" });

assert.ok(topWeight > commonWeight);
assert.ok(commonWeight > rareWeight);
assert.ok(rareWeight > 1);
assert.equal(unmatchedWeight, 1);
assert.equal(
  context.getVocabularyUsefulnessWeight({ ord: "xyzzy, i" }),
  topWeight,
);

const coreStart = wordGameSource.indexOf("function getRawAbilityProximity");
const coreEnd = wordGameSource.indexOf(
  "// useAbilityWeight is false",
  coreStart,
);
assert.notEqual(coreStart, -1);
assert.notEqual(coreEnd, -1);
const coreContext = vm.createContext({ Math });
vm.runInContext(
  `
    let abilityScore = 500;
    const ABILITY_PROXIMITY_SIGMA = 140;
    const CORE_VOCABULARY_MIN_PROXIMITY = 0.25;
    let vocabularyFrequencyRanks = {};
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
const nearbyRare = { ord: "rare-nearby", rank: null, difficulty: 500 };
assert.deepEqual(
  [...coreContext.getCoreVocabularyCandidatePool([
    nearbyCore,
    distantCore,
    nearbyRare,
  ])],
  [nearbyCore, distantCore],
);
// Once no core word remains near the continuous ability estimate, the rare
// candidate is admitted rather than the game being starved by distant words.
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
