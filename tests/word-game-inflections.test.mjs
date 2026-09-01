import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { loadWordGamePolicy } from "./load-word-game-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = JSON.parse(
  fs.readFileSync(path.join(root, "inflections-data.json"), "utf8"),
);
const context = vm.createContext({ console, Map, Promise, Set });
context.window = context;
loadWordGamePolicy(root, context);
context.self = context;
context.__BOKMAL_INFLECTIONS_DATA__ = snapshot;
context.BANNED_WORD_CLASSES = [];
context.noRandom = [];
context.noRandomLetters = [];

for (const file of [
  "wordClass.js",
  "inflections.js",
  "expressionPatterns.js",
  "sentenceFormMatching.js",
]) {
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
runSection("function getPhraseChoiceDisplay", "function loadAbilityState");
runSection("function ensureUniqueDisplayedValues", "function displayPronunciation");

assert.equal(context.getGameGenderLabel("noun - en-et"), "noun - en-et");
assert.equal(context.getGameGenderLabel("adjective"), "adjective");
assert.equal(context.getGameGenderLabel("expression"), "expression");
assert.equal(context.WordClass.hasCompatibleGender("noun - en", "en"), true);
assert.equal(context.WordClass.hasCompatibleGender("noun - en", "et"), false);
assert.equal(context.WordClass.hasCompatibleGender("en-et", "et"), true);
assert.equal(
  context.WordClass.hasCompatibleGender("adjective", "adverb"),
  false,
);

const barTarget = await context.findClozeTarget({
  ord: "bar",
  gender: "noun - en",
  eksempel: "Barn samlet bar etter stengetid.",
});
assert.equal(barTarget.surfaceForm, "bar");
assert.equal(
  await context.isVariedClozeTargetUnambiguous(
    { ord: "bar", gender: "noun - en" },
    barTarget,
  ),
  false,
);

const legeTarget = await context.findClozeTarget({
  ord: "lege",
  gender: "verb",
  eksempel: "Legen forsøkte å lege såret.",
});
assert.equal(legeTarget.surfaceForm, "lege");

const ugleEntry = {
  ord: "ugle",
  gender: "noun - ei",
  eksempel:
    "Vasene var uglasert og hadde en matt overflate. Ugla fløy forbi.",
};
const ugleTarget = await context.findClozeTarget(ugleEntry);
assert.equal(ugleTarget.surfaceForm, "Ugla");
context.results = [ugleEntry];
assert.equal(context.hasCompetingGameHomograph(ugleEntry), false);
assert.equal(
  await context.isVariedClozeTargetUnambiguous(ugleEntry, ugleTarget),
  true,
);
context.results = [
  ugleEntry,
  {
    ord: "skumring",
    gender: "noun - en",
    eksempel: "I skumringen så vi ugla fly over tunet.",
    sentenceTranslation: "At dusk we saw the owl fly over the yard.",
  },
];
const variedOwlTargets = await context.buildVariedGameContextTargets(ugleEntry);
assert.equal(variedOwlTargets.length, 1);
assert.equal(variedOwlTargets[0].surfaceForm, "ugla");
assert.equal(variedOwlTargets[0].isVariedContext, true);
const competingOwlSense = {
  ord: "ugle",
  gender: "noun - ei",
  engelsk: "a different owl sense",
};
context.results = [ugleEntry, competingOwlSense];
assert.equal(context.hasCompetingGameHomograph(ugleEntry), true);
assert.deepEqual(
  [...await context.buildVariedGameContextTargets(ugleEntry)],
  [],
);

const drikkeEntry = {
  ord: "drikke",
  gender: "verb",
  CEFR: "A2",
  eksempel: "Han drakk vann.",
};
const drikkeTarget = await context.findClozeTarget(drikkeEntry);
assert.deepEqual([...drikkeTarget.slotIndexes], [2]);

// Typed cloze accepts a genuine dictionary synonym only after inflecting it
// into the same grammatical slot as the missing word. Thus "eter" is a valid
// present-tense replacement for "spiser", while the past tense "åt" is not.
const spiseEntry = {
  ord: "spise",
  engelsk: "eat",
  gender: "verb",
  CEFR: "A1",
  eksempel: "Jeg spiser brød hver morgen.",
};
const eteEntry = {
  ord: "ete",
  engelsk: "eat",
  gender: "verb",
  CEFR: "A2",
};
const spiseTarget = await context.findClozeTarget(spiseEntry);
assert.deepEqual([...spiseTarget.slotIndexes], [1]);
context.results = [
  spiseEntry,
  eteEntry,
  { ord: "måltid", engelsk: "eat", gender: "et" },
  { ord: "drikke", engelsk: "drink", gender: "verb" },
];
const acceptedEatingAnswers = context.getTypedAcceptedAnswers(
  spiseEntry,
  true,
  spiseTarget.surfaceForm,
  spiseTarget,
);
assert.equal(acceptedEatingAnswers.includes("spiser"), true);
assert.equal(acceptedEatingAnswers.includes("eter"), true);
assert.equal(acceptedEatingAnswers.includes("åt"), false);
assert.equal(acceptedEatingAnswers.includes("måltidet"), false);
assert.equal(acceptedEatingAnswers.includes("drikker"), false);

// An invariant source adjective in predicate position needs its subject to
// resolve agreement before a synonym with distinct forms can be accepted.
// The ordinary conservative cloze set cannot infer that from
// "uforutsigelig" alone, but "været" establishes neuter singular.
const unpredictableEntry = {
  ord: "uforutsigelig",
  engelsk: "unpredictable",
  gender: "adjective",
  CEFR: "C",
  eksempel: "Været her er uforutsigelig og endrer seg raskt.",
};
const unpredictableSynonym = {
  ord: "uforutsigbar",
  engelsk: "unpredictable",
  gender: "adjective",
  CEFR: "B2",
};
const weatherEntry = { ord: "vær", gender: "et" };
const unpredictableTarget = await context.findClozeTarget(unpredictableEntry);
assert.deepEqual([...unpredictableTarget.slotIndexes], [0, 1, 2]);
context.results = [unpredictableEntry, unpredictableSynonym, weatherEntry];
const strictUnpredictableAnswers = context.getTypedAcceptedAnswers(
  unpredictableEntry,
  true,
  unpredictableTarget.surfaceForm,
  unpredictableTarget,
);
assert.equal(strictUnpredictableAnswers.includes("uforutsigbart"), false);
const contextualUnpredictableAnswers =
  await context.getContextualPredicateAdjectiveSynonymForms(
    unpredictableEntry,
    unpredictableTarget,
    "uforutsigbart",
  );
assert.equal(contextualUnpredictableAnswers.includes("uforutsigbart"), true);
assert.equal(contextualUnpredictableAnswers.includes("uforutsigbar"), false);
assert.equal(contextualUnpredictableAnswers.includes("uforutsigbare"), false);
context.results = [
  spiseEntry,
  eteEntry,
  { ord: "måltid", engelsk: "eat", gender: "et" },
  { ord: "drikke", engelsk: "drink", gender: "verb" },
];

const infinitiveEatingNearMiss =
  await context.classifyTypedMorphologyNearMiss(spiseEntry, "spise", {
    isCloze: true,
    clozeTarget: spiseTarget,
    correctAnswer: spiseTarget.surfaceForm,
  });
assert.equal(infinitiveEatingNearMiss.outcomeValue, 0.4);
assert.equal(infinitiveEatingNearMiss.correction, "spiser");
assert.match(infinitiveEatingNearMiss.message, /infinitive/);
assert.match(infinitiveEatingNearMiss.message, /present tense/);
assert.match(infinitiveEatingNearMiss.repairPrompt, /right word, wrong form/i);
assert.match(infinitiveEatingNearMiss.repairPrompt, /Try again/);
assert.doesNotMatch(infinitiveEatingNearMiss.repairPrompt, /spiser/);
assert.equal(infinitiveEatingNearMiss.selectedAnswer, "spise");
const synonymInfinitiveNearMiss =
  await context.classifyTypedMorphologyNearMiss(spiseEntry, "ete", {
    isCloze: true,
    clozeTarget: spiseTarget,
    correctAnswer: spiseTarget.surfaceForm,
  });
assert.equal(synonymInfinitiveNearMiss.correction, "eter");
assert.match(synonymInfinitiveNearMiss.message, /present tense/);
const pastEatingNearMiss = await context.classifyTypedMorphologyNearMiss(
  spiseEntry,
  "åt",
  {
    isCloze: true,
    clozeTarget: spiseTarget,
    correctAnswer: spiseTarget.surfaceForm,
  },
);
assert.equal(pastEatingNearMiss.correction, "eter");
assert.match(pastEatingNearMiss.message, /past tense/);
assert.equal(
  await context.classifyTypedMorphologyNearMiss(spiseEntry, "eter", {
    isCloze: true,
    clozeTarget: spiseTarget,
    correctAnswer: spiseTarget.surfaceForm,
  }),
  null,
);
const reverseInflectionNearMiss =
  await context.classifyTypedMorphologyNearMiss(spiseEntry, "spiser", {
    isReverse: true,
    correctAnswer: "spise",
  });
assert.equal(reverseInflectionNearMiss.correction, "spise");
assert.match(reverseInflectionNearMiss.message, /dictionary form/);
const listeningInflectionNearMiss =
  await context.classifyTypedMorphologyNearMiss(spiseEntry, "spiste", {
    isListening: true,
    correctAnswer: "spise",
  });
assert.equal(listeningInflectionNearMiss.correction, "spise");
assert.match(listeningInflectionNearMiss.message, /past tense/);

const chairEntry = {
  ord: "stol",
  engelsk: "chair",
  gender: "en",
  eksempel: "Stolen står ved bordet.",
};
const chairTarget = await context.findClozeTarget(chairEntry);
context.results = [
  chairEntry,
  { ord: "sete", engelsk: "chair", gender: "et" },
];
const acceptedChairAnswers = context.getTypedAcceptedAnswers(
  chairEntry,
  true,
  chairTarget.surfaceForm,
  chairTarget,
);
assert.equal(acceptedChairAnswers.includes("Stolen"), true);
assert.equal(acceptedChairAnswers.includes("setet"), false);
const indefiniteChairNearMiss =
  await context.classifyTypedMorphologyNearMiss(chairEntry, "stol", {
    isCloze: true,
    clozeTarget: chairTarget,
    correctAnswer: chairTarget.surfaceForm,
  });
assert.equal(indefiniteChairNearMiss.correction, "Stolen");
assert.match(indefiniteChairNearMiss.message, /indefinite singular/);
assert.match(indefiniteChairNearMiss.message, /definite singular/);

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
const pluralNounTarget = await context.findClozeTarget(pluralNounEntry);
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
const adjectiveTarget = await context.findClozeTarget(adjectiveEntry);
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
const austriaTarget = await context.findClozeTarget(austriaEntry);
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
const railsTarget = await context.findClozeTarget(railsEntry);
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
const wildcardTarget = await context.findClozeTarget(wildcardEntry);
assert.equal(wildcardTarget.kind, "phrase");
assert.equal(wildcardTarget.surfaceForm, "for et kvart århundre siden");

const wolvesExpressionEntry = {
  ord: "kaste til ulvene, kaste for ulvene",
  gender: "expression",
  CEFR: "B2",
  definisjon: "overlate (noen) til tøff behandling",
  eksempel: "Lederen kastet henne til ulvene da skandalen ble kjent.",
};
const wolvesExpressionTarget = await context.findClozeTarget(
  wolvesExpressionEntry,
);
assert.equal(wolvesExpressionTarget.kind, "expression-anchor");
assert.equal(wolvesExpressionTarget.surfaceForm, "kastet");
assert.equal(wolvesExpressionTarget.wordClass, "verb");
assert.deepEqual([...wolvesExpressionTarget.slotIndexes], [2]);
assert.equal(
  wolvesExpressionTarget.sentence.slice(
    wolvesExpressionTarget.startIndex,
    wolvesExpressionTarget.endIndex,
  ),
  "kastet",
);
context.results = [
  wolvesExpressionEntry,
  { ord: "betale", gender: "verb", CEFR: "B2" },
  { ord: "blåse", gender: "verb", CEFR: "B2" },
  { ord: "skrive", gender: "verb", CEFR: "B2" },
  { ord: "spise", gender: "verb", CEFR: "B2" },
];
const wolvesExpressionDistractors = context.generateClozeDistractors(
  wolvesExpressionEntry,
  wolvesExpressionTarget,
);
assert.equal(wolvesExpressionDistractors.length, 3);
assert.equal(
  wolvesExpressionDistractors.every((choice) =>
    ["betalte", "blåste", "skreiv", "skrev", "spiste"].includes(choice),
  ),
  true,
);

// Nominal expressions carry the head noun's actual gender and exact slot.
// The entry itself is classified as "expression", so using its outer gender
// here would reject every noun candidate or fall back to unrelated forms.
const bisonExpressionEntry = {
  ord: "amerikansk bison",
  gender: "expression",
  CEFR: "B1",
  eksempel: "Den amerikanske bisonen er en imponerende skapning.",
};
const bisonExpressionTarget = await context.findClozeTarget(
  bisonExpressionEntry,
);
assert.equal(bisonExpressionTarget.kind, "expression-anchor");
assert.equal(bisonExpressionTarget.surfaceForm, "bisonen");
assert.equal(bisonExpressionTarget.wordClass, "noun");
assert.equal(bisonExpressionTarget.targetGender, "en");
assert.deepEqual([...bisonExpressionTarget.slotIndexes], [1]);
const expressionNounCandidates = [
  { ord: "bil", gender: "en", CEFR: "B1" },
  { ord: "dag", gender: "en", CEFR: "B1" },
  { ord: "hare", gender: "en", CEFR: "B1" },
  { ord: "dato", gender: "en", CEFR: "B1" },
];
context.results = [bisonExpressionEntry, ...expressionNounCandidates];
const bisonExpressionDistractors = context.generateClozeDistractors(
  bisonExpressionEntry,
  bisonExpressionTarget,
);
assert.equal(bisonExpressionDistractors.length, 3);
for (const distractor of bisonExpressionDistractors) {
  assert.equal(
    expressionNounCandidates.some((candidate) =>
      context.Inflections.getParadigm(candidate).slots[1].includes(distractor),
    ),
    true,
    `${distractor} is not a definite-singular noun`,
  );
}

// Adjective-headed expressions use the same degree/agreement slot as the
// realized adjective, not the adjective's dictionary form.
const comparativeExpressionEntry = {
  ord: "vakker i",
  gender: "expression",
  CEFR: "B1",
  eksempel: "Hun var vakrere i den blå kjolen enn i den røde.",
};
const comparativeExpressionTarget = await context.findClozeTarget(
  comparativeExpressionEntry,
);
assert.equal(comparativeExpressionTarget.kind, "expression-anchor");
assert.equal(comparativeExpressionTarget.surfaceForm, "vakrere");
assert.equal(comparativeExpressionTarget.wordClass, "adjective");
assert.deepEqual([...comparativeExpressionTarget.slotIndexes], [5]);
context.results = [comparativeExpressionEntry, ...adjectiveCandidates];
const comparativeExpressionDistractors = context.generateClozeDistractors(
  comparativeExpressionEntry,
  comparativeExpressionTarget,
);
assert.equal(comparativeExpressionDistractors.length, 3);
for (const distractor of comparativeExpressionDistractors) {
  assert.equal(
    adjectiveCandidates.some((candidate) =>
      context.Inflections.getParadigm(candidate).slots[5].includes(distractor),
    ),
    true,
    `${distractor} is not a comparative adjective`,
  );
}

const treesExpressionEntry = {
  ord: "ikke vokse på trær",
  gender: "expression",
  CEFR: "B2",
  eksempel: "Slike muligheter vokser ikke på trær.",
};
const treesExpressionTarget = await context.findClozeTarget(
  treesExpressionEntry,
);
assert.equal(treesExpressionTarget.kind, "expression-anchor");
assert.equal(treesExpressionTarget.surfaceForm, "vokser");
assert.deepEqual([...treesExpressionTarget.slotIndexes], [1]);

const slashEntry = {
  ord: "logge inn/på",
  gender: "verb",
  CEFR: "B1",
  eksempel: "Hun logget på systemet i går.",
};
const slashTarget = await context.findClozeTarget(slashEntry);
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
assert.equal(await context.findClozeTarget(misclassifiedKoreanNounExample), null);
const koreanTarget = await context.findClozeTarget(koreanAdjectiveEntry);
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
