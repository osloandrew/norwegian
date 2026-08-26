import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = JSON.parse(
  fs.readFileSync(path.join(root, "inflections-data.json"), "utf8"),
);
// inflections.js's loadSnapshot() resolves its fetch URL against
// APP_ROOT_URL (scripts.js) — a real page always has it defined by the
// time a table can be opened, so the fixture models the same fixed root.
const context = vm.createContext({
  console,
  Map,
  Promise,
  Set,
  URL,
  APP_ROOT_URL: "http://127.0.0.1:3000/",
});
context.window = context;
context.self = context;
context.__BOKMAL_INFLECTIONS_DATA__ = snapshot;

for (const file of ["wordClass.js", "inflections.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, {
    filename: file,
  });
}

function getForms(ord, gender) {
  return context.Inflections.getForms({ ord, gender });
}

function value(forms, label) {
  return forms.forms.find((form) => form.label === label)?.value;
}

function alternatives(currentValue) {
  return Array.isArray(currentValue) ? [...currentValue] : [currentValue];
}

// Irregular and competing weak/strong verb classes come from their actual
// lexical paradigms, rather than being inferred from the infinitive ending.
const betale = getForms("betale", "verb");
assert.equal(value(betale, "Past"), "betalte");
assert.equal(value(betale, "Present perfect"), "har betalt");

const blaase = getForms("blåse", "verb");
assert.equal(value(blaase, "Past"), "blåste");
assert.equal(value(blaase, "Present perfect"), "har blåst");
assert.equal(value(blaase, "Imperative"), "blås!");

const danse = getForms("danse", "verb");
assert.deepEqual(alternatives(value(danse, "Past")), ["dansa", "danset"]);

const finnes = getForms("finnes", "verb");
assert.deepEqual(alternatives(value(finnes, "Present")), ["finnes", "fins"]);
assert.equal(value(finnes, "Past"), "fantes");
assert.equal(value(finnes, "Present perfect"), "har funnes");
assert.equal(value(finnes, "Imperative"), "–");

// The common copular/existential være sense must not be merged with the rare
// regular homograph (værer, været). This same record feeds expression tables,
// sentence lookup, and Word Game slots.
const vaere = getForms("være", "verb");
assert.equal(value(vaere, "Infinitive"), "å være");
assert.equal(value(vaere, "Present"), "er");
assert.equal(value(vaere, "Past"), "var");
assert.equal(value(vaere, "Present perfect"), "har vært");
assert.equal(value(vaere, "Imperative"), "vær!");
assert.equal(
  ["værer", "væra", "været", "værede", "værete"].some((form) =>
    context.Inflections.getParadigm({ ord: "være", gender: "verb" })
      .slots.flat()
      .includes(form),
  ),
  false,
);

// Indeclinable adjectives remain invariant and do not acquire invented
// comparison forms; lexically irregular adjectives retain stem changes.
const foekkings = getForms("føkkings", "adjective");
assert.equal(foekkings.sourceType, "ordbank");
assert.equal(value(foekkings, "Neuter"), "føkkings");
assert.equal(value(foekkings, "Plural"), "føkkings");
assert.equal(value(foekkings, "Comparative"), "–");

const kjedsom = getForms("kjedsom", "adjective");
assert.equal(value(kjedsom, "Neuter"), "kjedsomt");
assert.equal(value(kjedsom, "Plural"), "kjedsomme");
assert.equal(value(kjedsom, "Comparative"), "kjedsommere");
assert.equal(value(kjedsom, "Definite superlative"), "kjedsomste");

const alene = getForms("alene", "adjective");
assert.equal(alene.sourceType, "dictionary-override");
assert.equal(value(alene, "Neuter"), "alene");
assert.equal(value(alene, "Plural"), "alene");
assert.equal(value(alene, "Comparative"), "–");

// Lexically variable noun plurals are preserved.
const museum = getForms("museum", "noun - et");
assert.equal(value(museum, "Definite singular"), "museet");
assert.equal(value(museum, "Indefinite plural"), "museer");
assert.deepEqual(alternatives(value(museum, "Definite plural")), [
  "musea",
  "museene",
]);

// Comma-separated dictionary spellings are equal variants of one entry. The
// table combines each variant's own official paradigm instead of silently
// showing only the first spelling.
const future = getForms("fremtid, framtid", "noun - ei");
assert.equal(future.sourceType, "ordbank");
assert.deepEqual(alternatives(value(future, "Indefinite singular")), [
  "ei fremtid",
  "en fremtid",
  "ei framtid",
  "en framtid",
]);
assert.deepEqual(alternatives(value(future, "Definite singular")), [
  "fremtida",
  "fremtiden",
  "framtida",
  "framtiden",
]);
assert.deepEqual(alternatives(value(future, "Indefinite plural")), [
  "fremtider",
  "framtider",
]);
assert.deepEqual(alternatives(value(future, "Definite plural")), [
  "fremtidene",
  "framtidene",
]);

// Same-spelling noun senses retain completely separate paradigms when the
// dictionary gives them different genders.
const father = getForms("far", "noun - en");
assert.equal(value(father, "Indefinite singular"), "en far");
assert.equal(value(father, "Definite singular"), "faren");
assert.equal(value(father, "Indefinite plural"), "fedre");
assert.equal(value(father, "Definite plural"), "fedrene");

const track = getForms("far", "noun - et");
assert.equal(value(track, "Indefinite singular"), "et far");
assert.equal(value(track, "Definite singular"), "faret");
assert.equal(value(track, "Indefinite plural"), "far");
assert.deepEqual(alternatives(value(track, "Definite plural")), [
  "fara",
  "farene",
]);
assert.equal(alternatives(value(father, "Definite plural")).includes("farene"), false);
assert.equal(alternatives(value(track, "Indefinite plural")).includes("fedre"), false);
assert.deepEqual(
  [...await context.Inflections.getSentenceForms({ ord: "far", gender: "noun - en" })],
  ["far", "fars", "faren", "farens", "fedre", "fedres", "fedrene", "fedrenes"],
);
assert.deepEqual(
  [...await context.Inflections.getSentenceForms({ ord: "far", gender: "noun - et" })],
  ["far", "fars", "faret", "farets", "fara", "faras", "farene", "farenes"],
);

const fatherEntry = {
  ord: "far",
  gender: "noun - en",
  eksempel: "Faren min er flink til å lage mat.",
};
const trackEntry = {
  ord: "far",
  gender: "noun - et",
  eksempel: "Jegerne fulgte faret etter elgen gjennom skogen.",
};
const farHomographs = [fatherEntry, trackEntry];
assert.deepEqual(
  [
    ...await context.Inflections.getSupplementalSentenceForms(
      fatherEntry,
      farHomographs,
    ),
  ],
  ["far", "fars", "faren", "farens", "fedre", "fedres", "fedrene", "fedrenes"],
);
const trackSupplementalForms =
  await context.Inflections.getSupplementalSentenceForms(
    trackEntry,
    farHomographs,
  );
assert.deepEqual([...trackSupplementalForms], [
  "faret",
  "farets",
  "fara",
  "faras",
  "farene",
  "farenes",
]);

// A homographic noun must not erase the literal form of a preposition. Doing
// so used to leave ved (preposition) with only its primary example and made
// even that sentence impossible to highlight.
const woodEntry = {
  ord: "ved",
  gender: "noun - en",
  CEFR: "A1",
  eksempel: "Jeg har nok ved for hele vinteren.",
};
const byEntry = {
  ord: "ved",
  gender: "preposition",
  CEFR: "A1",
  eksempel: "Jeg krysset elven ved å svømme.",
};
const vedForms = await context.Inflections.getSupplementalSentenceForms(
  byEntry,
  [woodEntry, byEntry],
);
assert.deepEqual([...vedForms], ["ved"]);

// Shared morphology is retained by the earliest-taught sense rather than
// being removed from every homograph. Thus the common A1 en-sense of ting
// can find the many bare/plural examples, while the B2 et-sense is kept to
// its exclusive form and cannot steal the en-sense's examples.
const commonThingEntry = {
  ord: "ting",
  gender: "noun - en",
  CEFR: "A1",
  eksempel: "Tingen lå på bordet.",
};
const assemblyThingEntry = {
  ord: "ting",
  gender: "noun - et",
  CEFR: "B2",
  eksempel: "Tinget vedtok forslaget.",
};
const thingHomographs = [commonThingEntry, assemblyThingEntry];
const commonThingForms =
  await context.Inflections.getSupplementalSentenceForms(
    commonThingEntry,
    thingHomographs,
  );
assert.deepEqual([...commonThingForms], [
  "ting",
  "tings",
  "tingen",
  "tingens",
  "tinga",
  "tingas",
  "tingene",
  "tingenes",
]);
assert.deepEqual(
  [
    ...await context.Inflections.getSupplementalSentenceForms(
      assemblyThingEntry,
      thingHomographs,
    ),
  ],
  ["tinget", "tingets"],
);

// Dictionary-only compounds inherit the official paradigm of a compatible
// right-hand head, but are attributed as derived rather than exact Ordbank
// entries.
const luftfoto = getForms("luftfoto", "noun - et");
assert.equal(luftfoto.sourceType, "ordbank-derived");
assert.equal(luftfoto.derivedFrom, "foto");
assert.equal(value(luftfoto, "Definite singular"), "luftfotoet");
assert.deepEqual(alternatives(value(luftfoto, "Indefinite plural")), [
  "luftfoto",
  "luftfotoer",
]);
assert.deepEqual(alternatives(value(luftfoto, "Definite plural")), [
  "luftfotoa",
  "luftfotoene",
]);

const airfryer = getForms("airfryer", "noun - en");
assert.equal(airfryer.sourceType, "dictionary-only");
assert.equal(value(airfryer, "Indefinite singular"), "en airfryer");
assert.equal(value(airfryer, "Definite singular"), "airfryeren");
assert.equal(value(airfryer, "Indefinite plural"), "airfryere");
assert.equal(value(airfryer, "Definite plural"), "airfryerne");

const speedo = getForms("speedo", "noun - en");
assert.equal(speedo.sourceType, "dictionary-only");
assert.equal(value(speedo, "Indefinite singular"), "en speedo");
assert.equal(value(speedo, "Definite singular"), "speedoen");
assert.equal(value(speedo, "Indefinite plural"), "speedoer");
assert.equal(value(speedo, "Definite plural"), "speedoene");
assert.equal(
  (
    await context.Inflections.getSentenceForms({
      ord: "speedo",
      gender: "noun - en",
    })
  ).includes("speedoen"),
  true,
);

// A dictionary entry added after the snapshot was built still receives the
// complete table structure with explicitly non-authoritative regular estimates.
const unknownNoun = getForms("tullmuseum", "noun - et");
assert.equal(unknownNoun.sourceType, "dictionary-only");
assert.equal(value(unknownNoun, "Indefinite singular"), "et tullmuseum");
assert.equal(value(unknownNoun, "Definite singular"), "tullmuseumet");
assert.deepEqual(alternatives(value(unknownNoun, "Indefinite plural")), [
  "tullmuseum",
  "tullmuseumer",
]);
assert.equal(value(unknownNoun, "Definite plural"), "tullmuseumene");

const unknownAdjective = getForms("superkjedsom", "adjective");
assert.equal(unknownAdjective.sourceType, "dictionary-only");
assert.equal(value(unknownAdjective, "Masculine"), "superkjedsom");
assert.equal(value(unknownAdjective, "Feminine"), "superkjedsom");
assert.equal(value(unknownAdjective, "Neuter"), "superkjedsomt");
assert.equal(value(unknownAdjective, "Plural"), "superkjedsomme");

const unknownVerb = getForms("xbetale", "verb");
assert.equal(unknownVerb.sourceType, "dictionary-only");
assert.equal(value(unknownVerb, "Infinitive"), "å xbetale");
assert.equal(value(unknownVerb, "Present"), "xbetaler");
assert.equal(value(unknownVerb, "Past"), "xbetalet");

const drikkeParadigm = context.Inflections.getParadigm({
  ord: "drikke",
  gender: "verb",
});
assert.deepEqual([...drikkeParadigm.slots[2]], ["drakk"]);
assert.equal(drikkeParadigm.slots[11].includes("drikkende"), true);
assert.deepEqual(
  [...context.Inflections.getMatchingSlots({ ord: "drikke", gender: "verb" }, "drakk")],
  [2],
);
assert.deepEqual(
  [...context.Inflections.getMatchingSlots({ ord: "bar", gender: "noun - en" }, "barn")],
  [],
);

const resolvedUgler = await context.Inflections.findLemmas("ugler", "noun");
assert.equal(resolvedUgler.matchType, "exact");
assert.deepEqual([...resolvedUgler.lemmas], ["ugle"]);
const expandedUgler = await context.Inflections.expandSearchTerm("ugler");
assert.deepEqual([...expandedUgler], [
  "ugler",
  "ugle",
  "ugles",
  "ugla",
  "uglas",
  "uglen",
  "uglens",
  "uglers",
  "uglene",
  "uglenes",
]);
assert.equal(expandedUgler.includes("uglasert"), false);

const ugleSentenceForms = await context.Inflections.getSentenceForms({
  ord: "ugle",
  gender: "noun - ei",
});
assert.deepEqual([...ugleSentenceForms], [
  "ugle",
  "ugles",
  "ugla",
  "uglas",
  "uglen",
  "uglens",
  "ugler",
  "uglers",
  "uglene",
  "uglenes",
]);
assert.equal(ugleSentenceForms.includes("ugl"), false);

// Norwegian possessive/genitive -s is productive over every verified noun
// surface even though it is not shown as a separate Word Forms table slot.
const elskovSentenceForms = await context.Inflections.getSentenceForms({
  ord: "elskov",
  gender: "noun - en",
});
assert.equal(elskovSentenceForms.includes("elskovens"), true);
assert.equal(elskovSentenceForms.includes("elskovs"), true);
assert.equal(elskovSentenceForms.includes("elskovenes"), true);
const isSentenceForms = await context.Inflections.getSentenceForms({
  ord: "is",
  gender: "noun - en",
});
assert.equal(isSentenceForms.includes("is'"), true);
assert.equal(isSentenceForms.includes("is’"), true);
assert.equal(isSentenceForms.includes("iss"), false);

const resolvedElskovens = await context.Inflections.findLemmas(
  "elskovens",
  "noun",
);
assert.deepEqual([...resolvedElskovens.lemmas], ["elskov"]);
const expandedElskov = await context.Inflections.expandSearchTerm("elskov");
assert.equal(expandedElskov.includes("elskovens"), true);

vm.runInContext(
  fs.readFileSync(path.join(root, "sentenceFormMatching.js"), "utf8"),
  context,
  { filename: "sentenceFormMatching.js" },
);
const vedMatcher = context.SentenceFormMatching.createMatcher(vedForms);
assert.equal(vedMatcher.test("Hun satt ved bordet og ventet."), true);
assert.equal(
  vedMatcher.highlight(byEntry.eksempel),
  'Jeg krysset elven <span style="color: var(--color-interactive);">ved</span> å svømme.',
);
const collectedVedExamples = context.SentenceFormMatching.collectExamples(
  byEntry,
  [
    woodEntry,
    byEntry,
    { ord: "bord", eksempel: "Hun satt ved bordet og ventet." },
    { ord: "behov", eksempel: "Ring meg ved behov." },
  ],
  vedMatcher,
  100,
  [woodEntry],
);
assert.equal(collectedVedExamples.primary[0].eksempel, byEntry.eksempel);
assert.deepEqual(
  [...collectedVedExamples.supplemental].map((item) => item.eksempel),
  ["Hun satt ved bordet og ventet.", "Ring meg ved behov."],
);
const elskovMatcher =
  context.SentenceFormMatching.createMatcher(elskovSentenceForms);
assert.equal(
  elskovMatcher.highlight(
    "De hadde funnet en gammel bok om elskovens historie.",
  ),
  'De hadde funnet en gammel bok om <span style="color: var(--color-interactive);">elskovens</span> historie.',
);
const ugleMatcher = context.SentenceFormMatching.createMatcher(ugleSentenceForms);
assert.equal(ugleMatcher.test("Den gamle ugla lettet og fløy forbi."), true);
assert.equal(
  ugleMatcher.test("Vasene var uglasert og hadde en naturlig, matt overflate."),
  false,
);
assert.equal(ugleMatcher.test("Ugler jakter om natten."), true);

const trackMatcher = context.SentenceFormMatching.createMatcher(
  trackSupplementalForms,
);
assert.equal(trackMatcher.test("Faren min er flink til å lage mat."), false);
assert.equal(trackMatcher.test("Han så opp til sin far."), false);
assert.equal(
  trackMatcher.test("Det gamle faret var fremdeles synlig i skogen."),
  true,
);
const collectedTrackExamples = context.SentenceFormMatching.collectExamples(
  trackEntry,
  [
    fatherEntry,
    trackEntry,
    {
      ord: "spor",
      eksempel: "Det gamle faret var fremdeles synlig i skogen.",
    },
  ],
  trackMatcher,
);
assert.equal(collectedTrackExamples.primary[0].eksempel, trackEntry.eksempel);
assert.deepEqual(
  [...collectedTrackExamples.supplemental].map((entry) => entry.eksempel),
  ["Det gamle faret var fremdeles synlig i skogen."],
);
const commonThingMatcher =
  context.SentenceFormMatching.createMatcher(commonThingForms);
const collectedThingExamples = context.SentenceFormMatching.collectExamples(
  commonThingEntry,
  [
    commonThingEntry,
    assemblyThingEntry,
    { ord: "sak", eksempel: "Det stod mange ting på bordet." },
    { ord: "eiendel", eksempel: "Tingene hennes var pakket ned." },
  ],
  commonThingMatcher,
  100,
  [assemblyThingEntry],
);
assert.equal(collectedThingExamples.primary[0].eksempel, commonThingEntry.eksempel);
assert.deepEqual(
  [...collectedThingExamples.supplemental].map((entry) => entry.eksempel),
  ["Det stod mange ting på bordet.", "Tingene hennes var pakket ned."],
);
const selectedUgleEntry = {
  ord: "ugle",
  eksempel: "Den gamle ugla lettet og fløy forbi.",
  sentenceTranslation: "The old owl took off and flew past.",
};
const collectedUgleExamples = context.SentenceFormMatching.collectExamples(
  selectedUgleEntry,
  [
    {
      ord: "uglasert",
      eksempel: "Vasene var uglasert og hadde en naturlig, matt overflate.",
    },
    selectedUgleEntry,
    { ord: "ugler i mosen", eksempel: "Det er noe ugler i mosen her." },
  ],
  ugleMatcher,
);
assert.equal(
  collectedUgleExamples.primary[0].eksempel,
  selectedUgleEntry.eksempel,
);
assert.deepEqual(
  [...collectedUgleExamples.supplemental].map((entry) => entry.eksempel),
  ["Det er noe ugler i mosen her."],
);

// Before the low-priority snapshot preload completes, opening a table resolves
// the pending entry through the same request and returns the authoritative data.
const lazyContext = vm.createContext({
  console,
  Map,
  Promise,
  Set,
  URL,
  APP_ROOT_URL: "http://127.0.0.1:3000/",
  fetch: async () => ({
    ok: true,
    json: async () => snapshot,
  }),
});
lazyContext.window = lazyContext;
lazyContext.self = lazyContext;
for (const file of ["wordClass.js", "inflections.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), lazyContext, {
    filename: file,
  });
}
const pending = lazyContext.Inflections.getForms({ ord: "kjedsom", gender: "adjective" });
assert.equal(pending.pending, true);
const resolved = await lazyContext.Inflections.resolvePending(pending.requestId);
assert.equal(value(resolved, "Comparative"), "kjedsommere");

console.log("Inflection paradigm checks passed.");
