import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = JSON.parse(
  fs.readFileSync(path.join(root, "inflections-data.json"), "utf8"),
);
const context = vm.createContext({ console, Map, Promise, Set });
context.window = context;
context.__BOKMAL_INFLECTIONS_DATA__ = snapshot;
context.BANNED_WORD_CLASSES = [];

for (const file of ["wordClass.js", "inflections.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, {
    filename: file,
  });
}

const source = fs.readFileSync(path.join(root, "wordGame.js"), "utf8");
const runSection = (start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  vm.runInContext(source.slice(startIndex, endIndex), context, {
    filename: "wordGame.js",
  });
};

runSection("function findClozeTarget", "// Shown every time the word game");
runSection("function shuffleArray", "// hasCompatibleGender lives");
runSection("function generateClozeDistractors", "function updateCEFRSelection");

const barTarget = context.findClozeTarget({
  ord: "bar",
  gender: "noun - en",
  eksempel: "Barn samlet bar etter stengetid.",
});
assert.equal(barTarget.surfaceForm, "bar");

const legeTarget = context.findClozeTarget({
  ord: "lege",
  gender: "verb",
  eksempel: "Legen forsøkte å lege såret.",
});
assert.equal(legeTarget.surfaceForm, "lege");

const ugleTarget = context.findClozeTarget({
  ord: "ugle",
  gender: "noun - ei",
  eksempel:
    "Vasene var uglasert og hadde en matt overflate. Ugla fløy forbi.",
});
assert.equal(ugleTarget.surfaceForm, "Ugla");

const drikkeEntry = {
  ord: "drikke",
  gender: "verb",
  CEFR: "A2",
  eksempel: "Han drakk vann.",
};
const drikkeTarget = context.findClozeTarget(drikkeEntry);
assert.deepEqual([...drikkeTarget.slotIndexes], [2]);

context.results = [
  drikkeEntry,
  { ord: "betale", gender: "verb", CEFR: "A2" },
  { ord: "blåse", gender: "verb", CEFR: "A2" },
  { ord: "skrive", gender: "verb", CEFR: "A2" },
  { ord: "spise", gender: "verb", CEFR: "A2" },
];
const distractors = context.generateClozeDistractors(
  drikkeEntry,
  drikkeTarget,
);
assert.equal(distractors.length, 3);
assert.equal(distractors.includes("drikkte"), false);
for (const distractor of distractors) {
  assert.equal(
    ["betalte", "blåste", "skreiv", "skrev", "spiste"].includes(distractor),
    true,
  );
}

console.log("Word Game exact-form checks passed.");
