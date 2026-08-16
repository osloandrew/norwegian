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
context.noRandom = [];

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

runSection("function getGameGenderLabel", "// Getting a CSS transition");
runSection("function normalizeGameWhitespace", "// Shown every time the word game");
runSection("function shuffleArray", "// hasCompatibleGender lives");
runSection("function getPhraseChoiceDisplay", "function updateCEFRSelection");
runSection("function ensureUniqueDisplayedValues", "function displayPronunciation");

assert.equal(context.getGameGenderLabel("noun - en-et"), "N - en-et");
assert.equal(context.WordClass.hasCompatibleGender("noun - en", "en"), true);
assert.equal(context.WordClass.hasCompatibleGender("noun - en", "et"), false);
assert.equal(context.WordClass.hasCompatibleGender("en-et", "et"), true);
assert.equal(
  context.WordClass.hasCompatibleGender("adjective", "adverb"),
  false,
);

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

// Noun number and definiteness are grammatical slots, not endings to copy.
// A definite-plural answer must therefore receive only official definite-
// plural distractors, never definite-singular forms from another paradigm.
const pluralNounEntry = {
  ord: "stol",
  gender: "en",
  CEFR: "A2",
  eksempel: "Stolene stod langs veggen.",
};
const pluralNounCandidates = [
  { ord: "bil", gender: "en", CEFR: "A2" },
  { ord: "dag", gender: "en", CEFR: "A2" },
  { ord: "hare", gender: "en", CEFR: "A2" },
  { ord: "dato", gender: "en", CEFR: "A2" },
];
context.results = [pluralNounEntry, ...pluralNounCandidates];
const pluralNounTarget = context.findClozeTarget(pluralNounEntry);
assert.deepEqual([...pluralNounTarget.slotIndexes], [3]);
const pluralNounDistractors = context.generateClozeDistractors(
  pluralNounEntry,
  pluralNounTarget,
);
assert.equal(pluralNounDistractors.length, 3);
for (const distractor of pluralNounDistractors) {
  const matchingCandidate = pluralNounCandidates.find((candidate) => {
    const paradigm = context.Inflections.getParadigm(candidate);
    return paradigm.slots[3].includes(distractor);
  });
  assert.ok(matchingCandidate, `${distractor} is not a definite-plural noun`);
  assert.equal(
    context.Inflections.getParadigm(matchingCandidate).slots[1].includes(
      distractor,
    ),
    false,
    `${distractor} leaked from the definite-singular slot`,
  );
}

// The plural and definite adjective slots often share a surface, but not
// always (liten: lille/små). Ambiguous answers may use only forms valid in
// every matching slot, so one interpretation cannot silently win.
const adjectiveEntry = {
  ord: "kjedsom",
  gender: "adjective",
  CEFR: "B1",
  eksempel: "Oppgavene var kjedsomme.",
};
const adjectiveCandidates = [
  { ord: "stor", gender: "adjective", CEFR: "B1" },
  { ord: "vakker", gender: "adjective", CEFR: "B1" },
  { ord: "gammel", gender: "adjective", CEFR: "B1" },
  { ord: "morsom", gender: "adjective", CEFR: "B1" },
  { ord: "liten", gender: "adjective", CEFR: "B1" },
];
context.results = [adjectiveEntry, ...adjectiveCandidates];
const adjectiveTarget = context.findClozeTarget(adjectiveEntry);
assert.deepEqual([...adjectiveTarget.slotIndexes], [3, 4]);
const adjectiveDistractors = context.generateClozeDistractors(
  adjectiveEntry,
  adjectiveTarget,
);
assert.equal(adjectiveDistractors.length, 3);
for (const distractor of adjectiveDistractors) {
  const matchingCandidate = adjectiveCandidates.find((candidate) => {
    const paradigm = context.Inflections.getParadigm(candidate);
    return (
      paradigm.slots[3].includes(distractor) &&
      paradigm.slots[4].includes(distractor)
    );
  });
  assert.ok(matchingCandidate, `${distractor} does not preserve adjective form`);
}
assert.equal(adjectiveDistractors.includes("lille"), false);
assert.equal(adjectiveDistractors.includes("små"), false);

const austriaEntry = {
  ord: "Østerrike",
  gender: "et",
  CEFR: "A2",
  eksempel: "Vi planlegger å reise til Østerrike i vinter.",
};
const centralAmericaEntry = {
  ord: "Mellom-Amerika",
  gender: "et",
  CEFR: "A2",
  eksempel: "Mellom-Amerika har et tropisk klima.",
};
const properNounEntries = [
  austriaEntry,
  centralAmericaEntry,
  { ord: "Afrika", gender: "et", CEFR: "A2" },
  { ord: "Norge", gender: "et", CEFR: "A2" },
];
context.results = properNounEntries;
const austriaTarget = context.findClozeTarget(austriaEntry);
assert.equal(austriaTarget.surfaceForm, "Østerrike");
assert.equal(context.formatCorrectClozeChoice(austriaEntry, austriaTarget), "Østerrike");
const properNounDistractors = context.generateClozeDistractors(
  austriaEntry,
  austriaTarget,
);
assert.equal(properNounDistractors.length, 3);
assert.equal(properNounDistractors.includes("Mellom-Amerika"), true);
assert.equal(properNounDistractors.some((word) => word === "mellom-amerika"), false);
assert.equal(properNounDistractors.some((word) => word === "østerrike"), false);

const railsEntry = {
  ord: "gå på skinner",
  gender: "verb",
  CEFR: "B2",
  eksempel: "Alt går på skinner i norsk økonomi.",
};
const railsTarget = context.findClozeTarget(railsEntry);
assert.equal(railsTarget.kind, "phrase");
assert.equal(railsTarget.surfaceForm, "går på skinner");

context.results = [
  railsEntry,
  { ord: "bli født på ny", gender: "verb", CEFR: "B2" },
  { ord: "dra lasset", gender: "verb", CEFR: "B2" },
  { ord: "få tak i", gender: "verb", CEFR: "B2" },
];
const railsDistractors = context.generateClozeDistractors(
  railsEntry,
  railsTarget,
);
assert.deepEqual(
  [...railsDistractors].sort(),
  ["blir født på ny", "drar lasset", "får tak i"].sort(),
);

const wildcardEntry = {
  ord: "for ... siden, for ... sia",
  gender: "expression",
  CEFR: "B2",
  eksempel: "Hennes generasjon ble borte for et kvart århundre siden.",
};
const wildcardTarget = context.findClozeTarget(wildcardEntry);
assert.equal(wildcardTarget.kind, "phrase");
assert.equal(wildcardTarget.surfaceForm, "for et kvart århundre siden");

const slashEntry = {
  ord: "logge inn/på",
  gender: "verb",
  CEFR: "B1",
  eksempel: "Hun logget på systemet i går.",
};
const slashTarget = context.findClozeTarget(slashEntry);
assert.equal(slashTarget.kind, "phrase");
assert.equal(slashTarget.surfaceForm, "logget på");

context.results = [
  wildcardEntry,
  { ord: "desto ... desto", gender: "expression", CEFR: "B2" },
  { ord: "fra tid til annen", gender: "expression", CEFR: "B2" },
  { ord: "før eller senere", gender: "expression", CEFR: "B2" },
  { ord: "på godt og vondt", gender: "expression", CEFR: "B2" },
];
assert.equal(
  context.generateClozeDistractors(wildcardEntry, wildcardTarget).length,
  3,
);
assert.deepEqual(
  [...context.getPhraseCandidateTemplates(slashEntry)],
  ["logge inn", "logge på"],
);

assert.deepEqual(
  [...context.ensureUniqueDisplayedValues(["Østerrike", "østerrike", "Norge"])],
  ["Østerrike", "Norge"],
);
context.results = properNounEntries;
const reverseDistractors = context.fetchIncorrectNorwegianWords(
  "Østerrike",
  "A2",
  "et",
);
assert.equal(reverseDistractors.length, 3);
assert.equal(reverseDistractors.every((word) => context.startsWithUppercaseLetter(word)), true);
assert.equal(reverseDistractors.includes("Mellom-Amerika"), true);

// Same-spelling homographs retain the selected dictionary entry's class.
// In particular, the adjective sense of koreansk must never inherit the
// language noun's en-et label or noun distractors.
const koreanAdjectiveEntry = {
  ord: "koreansk",
  gender: "adjective",
  CEFR: "B1",
  eksempel: "Jeg liker koreansk mat.",
};
const misclassifiedKoreanNounExample = {
  ord: "koreansk",
  gender: "en-et",
  CEFR: "B1",
  eksempel: "Jeg liker koreansk mat.",
};
context.results = [
  koreanAdjectiveEntry,
  misclassifiedKoreanNounExample,
  { ord: "mat", gender: "en", CEFR: "A1" },
  ...adjectiveCandidates,
];
assert.equal(context.findClozeTarget(misclassifiedKoreanNounExample), null);
const koreanTarget = context.findClozeTarget(koreanAdjectiveEntry);
assert.equal(koreanTarget.wordClass, "adjective");
assert.deepEqual([...koreanTarget.slotIndexes], [0]);
const koreanDistractors = context.generateClozeDistractors(
  koreanAdjectiveEntry,
  koreanTarget,
);
assert.equal(koreanDistractors.length, 3);
assert.equal(
  koreanDistractors.every((choice) =>
    adjectiveCandidates.some((candidate) =>
      context.Inflections.getParadigm(candidate).slots[0].includes(choice),
    ),
  ),
  true,
);

console.log("Word Game exact-form checks passed.");
