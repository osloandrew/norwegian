import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "scripts.js"), "utf8");

const functionStart = source.indexOf("function getSearchMatchRank(entry, query, inflectedLemmas)");
const functionEnd = source.indexOf("function editDistanceWithinLimit(", functionStart);
assert.notEqual(functionStart, -1, "getSearchMatchRank should exist");
assert.notEqual(functionEnd, -1, "editDistanceWithinLimit boundary should exist");

function createContext(rankByOrd) {
  const context = vm.createContext({
    String,
    Number,
    window: {
      WordGameHelpers: {
        getVocabularyFrequencyRank: (entry) => rankByOrd.get(entry.ord) ?? null,
      },
    },
    CEFR_ORDER: { A1: 1, A2: 2, B1: 3, B2: 4, C: 5 },
    splitSearchTerms: (value) =>
      String(value || "")
        .toLowerCase()
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean),
  });
  vm.runInContext(source.slice(functionStart, functionEnd), context, {
    filename: "scripts.js",
  });
  return context;
}

test("CEFR decides across bands even when both entries have frequency data", () => {
  // Restored to this morning's priority: CEFR is the primary signal across
  // the whole dictionary. A common C-level word no longer jumps ahead of a
  // rarer A1 one just because it has a much better frequency rank -- that
  // was today's brief, now-dialed-back experiment.
  const a1Word = { ord: "husmor", gender: "en", CEFR: "A1" };
  const cWord = { ord: "hustru", gender: "en", CEFR: "C" };
  const context = createContext(
    new Map([
      ["husmor", 9000],
      ["hustru", 50],
    ]),
  );

  assert.equal(context.compareByCefrThenFrequencyThenHeadword(a1Word, cWord) < 0, true);
  assert.equal(context.compareByCefrThenFrequencyThenHeadword(cWord, a1Word) > 0, true);
});

test("frequency breaks a tie within the same CEFR band when both sides are attested", () => {
  const common = { ord: "husholdning", gender: "ei", CEFR: "B1" };
  const rarer = { ord: "hushjelp", gender: "ei", CEFR: "B1" };
  const context = createContext(
    new Map([
      ["husholdning", 100],
      ["hushjelp", 9000],
    ]),
  );

  assert.equal(context.compareByCefrThenFrequencyThenHeadword(common, rarer) < 0, true);
  assert.equal(context.compareByCefrThenFrequencyThenHeadword(rarer, common) > 0, true);
});

test("a CEFR gap decides over an asymmetric frequency record (regression: et egg vs ei egg)", () => {
  // "egg" (et, "egg", A1) shares every one of its inflected forms with
  // either "egg" (ei, "blade edge", B2) or the unrelated verb "egge" ("to
  // incite"), so build-vocabulary-frequency.py's ambiguity handling
  // correctly excludes all of them -- "et egg" ends up with zero recorded
  // evidence, while "ei egg" keeps one lucky unambiguous form ("eggen").
  // The far more common, hand-tagged-A1 "et egg" must still win.
  const etEgg = { ord: "egg", gender: "et", CEFR: "A1" };
  const eiEgg = { ord: "egg", gender: "ei", CEFR: "B2" };
  // Both entries share the exact spelling "egg", so the stub distinguishes
  // them by gender instead -- matching how the real getVocabularyFrequencyRank
  // keys on ord+gender together, not ord alone.
  const context = createContext(new Map());
  context.window.WordGameHelpers.getVocabularyFrequencyRank = (entry) =>
    entry.gender === "ei" ? 9968 : null;

  assert.equal(context.compareByCefrThenFrequencyThenHeadword(etEgg, eiEgg) < 0, true);
  assert.equal(context.compareByCefrThenFrequencyThenHeadword(eiEgg, etEgg) > 0, true);
});

test("some evidence still beats none within the same CEFR band", () => {
  const covered = { ord: "hustru", gender: "en", CEFR: "B2" };
  const uncovered = { ord: "husarrest", gender: "en", CEFR: "B2" };
  const context = createContext(new Map([["hustru", 50]]));

  assert.equal(context.compareByCefrThenFrequencyThenHeadword(covered, uncovered) < 0, true);
  assert.equal(context.compareByCefrThenFrequencyThenHeadword(uncovered, covered) > 0, true);
});

test("falls back to plain alphabetical when neither entry has frequency data, within a band", () => {
  const context = createContext(new Map());
  const sameBandFirst = { ord: "bil", gender: "en", CEFR: "A1" };
  const sameBandSecond = { ord: "katt", gender: "en", CEFR: "A1" };

  assert.equal(
    context.compareByCefrThenFrequencyThenHeadword(sameBandFirst, sameBandSecond) < 0,
    true,
  );
});

test("match-quality rank still dominates CEFR/frequency in compareWordSearchResults", () => {
  // "exact" is an exact headword match (rank 0); "exactly" only starts with
  // the query (rank 3) -- a worse match tier, even though it's given a
  // lower CEFR band and a far better frequency rank here.
  const context = createContext(
    new Map([
      ["exactly", 5],
      ["exact", 500000],
    ]),
  );
  const exactHeadword = { ord: "exact", gender: "en", engelsk: "x", CEFR: "C" };
  const prefixMatch = { ord: "exactly", gender: "en", engelsk: "y", CEFR: "A1" };

  assert.equal(
    context.compareWordSearchResults(exactHeadword, prefixMatch, "exact", null) < 0,
    true,
  );
  assert.equal(
    context.compareWordSearchResults(prefixMatch, exactHeadword, "exact", null) > 0,
    true,
  );
});

console.log("search result frequency order tests passed");
