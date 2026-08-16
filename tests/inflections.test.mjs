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
  ["far", "faren", "fedre", "fedrene"],
);
assert.deepEqual(
  [...await context.Inflections.getSentenceForms({ ord: "far", gender: "noun - et" })],
  ["far", "faret", "fara", "farene"],
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
  ["faren", "fedre", "fedrene"],
);
const trackSupplementalForms =
  await context.Inflections.getSupplementalSentenceForms(
    trackEntry,
    farHomographs,
  );
assert.deepEqual([...trackSupplementalForms], ["faret", "fara", "farene"]);

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
assert.equal(value(airfryer, "Definite singular"), "–");

// Unknown words no longer borrow the paradigm of an unrelated suffix or
// receive a guessed regular paradigm.
assert.equal(getForms("tullmuseum", "noun - et"), null);
assert.equal(getForms("superkjedsom", "adjective"), null);
assert.equal(getForms("xbetale", "verb"), null);

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
  "ugla",
  "uglen",
  "uglene",
]);
assert.equal(expandedUgler.includes("uglasert"), false);

const ugleSentenceForms = await context.Inflections.getSentenceForms({
  ord: "ugle",
  gender: "noun - ei",
});
assert.deepEqual([...ugleSentenceForms], [
  "ugle",
  "ugla",
  "uglen",
  "ugler",
  "uglene",
]);
assert.equal(ugleSentenceForms.includes("ugl"), false);

vm.runInContext(
  fs.readFileSync(path.join(root, "sentenceFormMatching.js"), "utf8"),
  context,
  { filename: "sentenceFormMatching.js" },
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
  fetch: async () => ({
    ok: true,
    json: async () => snapshot,
  }),
});
lazyContext.window = lazyContext;
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
