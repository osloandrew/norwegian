import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({ console, Map, Promise, Set, setTimeout });
context.window = context;
context.self = context;
context.__BOKMAL_INFLECTIONS_DATA__ = JSON.parse(
  fs.readFileSync(path.join(root, "inflections-data.json"), "utf8"),
);

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

function value(forms, label) {
  return forms.forms.find((form) => form.label === label)?.value;
}

function alternatives(currentValue) {
  return Array.isArray(currentValue) ? [...currentValue] : [currentValue];
}

const wolvesEntry = {
  ord: "kaste til ulvene, kaste for ulvene",
  gender: "expression",
  definisjon:
    "overlate (noen) til tøff behandling; overlate (noen) til seg selv",
  eksempel: "Lederen kastet henne til ulvene da skandalen ble kjent.",
};
const wolves = await context.ExpressionPatterns.getAnalysis(wolvesEntry);
assert.equal(wolves.forms.sourceType, "expression-ordbank");
assert.deepEqual(alternatives(value(wolves.forms, "Infinitive")), [
  "å kaste [noen] til ulvene",
  "å kaste [noen] for ulvene",
]);
assert.equal(
  alternatives(value(wolves.forms, "Past")).includes(
    "kastet [noen] til ulvene",
  ),
  true,
);
assert.equal(wolves.matcher.test(wolvesEntry.eksempel), true);
assert.equal(
  wolves.matcher.test("Styret kaster nå de ansatte til ulvene."),
  true,
);
assert.equal(
  wolves.matcher.test("Hun kastet ballen til barna."),
  false,
);
const wolvesHighlight = wolves.matcher.highlight(wolvesEntry.eksempel);
assert.match(wolvesHighlight, />kastet<\/span>/u);
assert.match(wolvesHighlight, />til<\/span>/u);
assert.match(wolvesHighlight, />ulvene<\/span>/u);
assert.doesNotMatch(wolvesHighlight, />henne<\/span>/u);

const pendingWolvesForms = context.Inflections.getForms(wolvesEntry);
assert.equal(pendingWolvesForms.pending, true);
const resolvedWolvesForms = await context.Inflections.resolvePending(
  pendingWolvesForms.requestId,
);
assert.equal(resolvedWolvesForms.sourceType, "expression-ordbank");
assert.equal(
  alternatives(value(resolvedWolvesForms, "Present")).includes(
    "kaster [noen] til ulvene",
  ),
  true,
);

const examples = context.SentenceFormMatching.collectExamples(
  wolvesEntry,
  [
    { ...wolvesEntry },
    {
      ord: "annen",
      eksempel: "De kastet ham til ulvene uten å nøle.",
      sentenceTranslation: "They threw him to the wolves without hesitating.",
    },
    {
      ord: "uvedkommende",
      eksempel: "Hun kastet ballen til barna.",
      sentenceTranslation: "She threw the ball to the children.",
    },
  ],
  wolves.matcher,
);
assert.equal(examples.primary[0].eksempel, wolvesEntry.eksempel);
assert.deepEqual(
  [...examples.supplemental.map((entry) => entry.eksempel)],
  ["De kastet ham til ulvene uten å nøle."],
);

const negatedEntry = {
  ord: "ikke vokse på trær",
  gender: "expression",
  eksempel: "Slike muligheter vokser ikke på trær.",
};
const negated = await context.ExpressionPatterns.getAnalysis(negatedEntry);
assert.equal(value(negated.forms, "Present"), "vokser ikke på trær");
assert.equal(
  alternatives(value(negated.forms, "Past")).includes(
    "vokste ikke på trær",
  ),
  true,
);
assert.equal(negated.matcher.test(negatedEntry.eksempel), true);
assert.match(
  negated.matcher.highlight(negatedEntry.eksempel),
  />vokser<\/span> <span[^>]*>ikke<\/span>/u,
);

const negatedReflexiveEntry = {
  ord: "ikke la seg be to ganger",
  gender: "expression",
  eksempel: "Han lot seg ikke be to ganger da sjansen kom.",
};
const negatedReflexive = await context.ExpressionPatterns.getAnalysis(
  negatedReflexiveEntry,
);
assert.equal(
  value(negatedReflexive.forms, "Present"),
  "lar seg ikke be to ganger",
);
assert.equal(negatedReflexive.matcher.test(negatedReflexiveEntry.eksempel), true);

const vaereExpressionEntry = {
  ord: "være glad i",
  gender: "expression",
  eksempel: "Jeg er veldig glad i familien min.",
};
const vaereExpression = await context.ExpressionPatterns.getAnalysis(
  vaereExpressionEntry,
);
assert.equal(value(vaereExpression.forms, "Present"), "er glad i");
assert.equal(value(vaereExpression.forms, "Past"), "var glad i");
assert.equal(
  value(vaereExpression.forms, "Present perfect"),
  "har vært glad i",
);
assert.equal(
  JSON.stringify(vaereExpression.forms.forms).includes("værer"),
  false,
);
assert.equal(
  JSON.stringify(vaereExpression.forms.forms).includes("været"),
  false,
);

const matterEntry = {
  ord: "ha mye å si",
  gender: "expression",
  eksempel: "Valget av database kan ha mye å si for hastigheten.",
};
const matter = await context.ExpressionPatterns.getAnalysis(matterEntry);
assert.equal(value(matter.forms, "Infinitive"), "å ha mye å si");
assert.equal(value(matter.forms, "Present"), "har mye å si");
assert.equal(value(matter.forms, "Past"), "hadde mye å si");
assert.equal(value(matter.forms, "Present perfect"), "har hatt mye å si");
assert.equal(value(matter.forms, "Imperative"), "ha mye å si!");
assert.equal(matter.matcher.test("Dette har mye å si."), true);
assert.equal(matter.matcher.test("Dette har mye å sier."), false);
const matterComplement = matter.patterns[0].nodes.find(
  (node) => node.normalized === "si",
);
assert.equal(matterComplement.infinitiveOnly, true);
assert.deepEqual(
  [
    ...matter.searchAlternatives[0][
      matter.patterns[0].nodes.indexOf(matterComplement)
    ],
  ],
  ["si"],
);
assert.doesNotMatch(
  JSON.stringify(matter.forms.forms),
  /mye å (?:sier|sa|sagt)\b/u,
);

const citedPhraseEntry = {
  ord: "for å si det med",
  gender: "expression",
  eksempel: "For å si det med et gammelt uttrykk: tiden flyr.",
};
const citedPhrase = await context.ExpressionPatterns.getAnalysis(
  citedPhraseEntry,
);
assert.equal(value(citedPhrase.forms, "Fixed expression"), "for å si det med");
assert.equal(citedPhrase.matcher.test(citedPhraseEntry.eksempel), true);
assert.equal(
  citedPhrase.matcher.test("For å sier det med et gammelt uttrykk."),
  false,
);

const fixedEntry = {
  ord: "a cappella",
  gender: "expression",
  eksempel: "Koret sang a cappella i kirken.",
};
const fixed = await context.ExpressionPatterns.getAnalysis(fixedEntry);
assert.equal(fixed.forms.sourceType, "expression-fixed");
assert.equal(value(fixed.forms, "Fixed expression"), "a cappella");

// Both words in this fixed expression collide with unrelated verb forms:
// "eller" is the present of "elle", and "ei" is the imperative of "eie".
// Exact literal agreement with the entry's example is not evidence that
// either token is functioning as that verb. The whole expression must stay
// fixed so sentence retrieval and highlighting cannot drift onto forms of
// those unrelated verbs.
const orNotEntry = {
  ord: "eller ei",
  gender: "expression",
  definisjon: "eller ikke",
  eksempel: "Hun skulle si ifra, om det passet eller ei.",
};
const orNot = await context.ExpressionPatterns.getAnalysis(orNotEntry);
assert.equal(orNot.forms.sourceType, "expression-fixed");
assert.equal(value(orNot.forms, "Fixed expression"), "eller ei");
assert.equal(
  orNot.patterns[0].nodes.every((node) => node.selected === undefined),
  true,
);
assert.equal(orNot.matcher.test(orNotEntry.eksempel), true);
assert.equal(orNot.matcher.test("Hun eller kanskje eier huset."), false);
const orNotHighlight = orNot.matcher.highlight(orNotEntry.eksempel);
assert.match(orNotHighlight, />eller<\/span>/u);
assert.match(orNotHighlight, />ei<\/span>/u);
assert.deepEqual(
  [...orNot.searchAlternatives[0].map((forms) => [...forms])],
  [["eller"], ["ei"]],
);

const nominalEntry = {
  ord: "amerikansk bison",
  gender: "expression",
  eksempel: "Den amerikanske bisonen er et kraftig dyr.",
};
const nominal = await context.ExpressionPatterns.getAnalysis(nominalEntry);
assert.equal(value(nominal.forms, "Indefinite singular"), "en amerikansk bison");
assert.equal(value(nominal.forms, "Definite singular"), "den amerikanske bisonen");
assert.equal(value(nominal.forms, "Indefinite plural"), "amerikanske bisoner");
assert.equal(value(nominal.forms, "Definite plural"), "de amerikanske bisonene");

// A single citation form with a fixed preposition ahead of the noun still
// gets the full declension synthesized (nothing here signals the idiom is
// closed to just one or two forms) — the article belongs immediately
// before the noun phrase, not at the very start of the rendered string, so
// naively prepending it at position 0 used to produce "en i bunn" (article
// in front of the preposition) instead of "i en bunn" (article in front of
// "bunn", where it belongs).
const singleVariantPrepositionalEntry = {
  ord: "i bunnen",
  gender: "expression",
  definisjon: "som grunn, grunnlag (under noe annet)",
  eksempel: "I bunn handler denne saken om rettferdighet.",
};
const singleVariantPrepositional = await context.ExpressionPatterns.getAnalysis(
  singleVariantPrepositionalEntry,
);
assert.equal(
  value(singleVariantPrepositional.forms, "Indefinite singular"),
  "i en bunn",
);
assert.equal(
  value(singleVariantPrepositional.forms, "Definite singular"),
  "i den bunnen",
);
assert.equal(
  value(singleVariantPrepositional.forms, "Indefinite plural"),
  "i bunner",
);
assert.equal(
  value(singleVariantPrepositional.forms, "Definite plural"),
  "i de bunnene",
);

// But the REAL dictionary entry authors both the indefinite and definite
// singular explicitly ("i bunn, i bunnen") — every variant selects the same
// noun lemma ("bunn"), which means the author already spelled out the exact
// forms this frozen idiom is valid in. That enumeration is the fixed,
// complete answer; synthesizing further forms would fabricate a plural
// ("i bunner", "i de bunnene") nobody would ever use for this meaning.
const closedIdiomEntry = {
  ord: "i bunn, i bunnen",
  gender: "expression",
  definisjon: "som grunn, grunnlag (under noe annet)",
  eksempel: "I bunn handler denne saken om rettferdighet.",
};
const closedIdiom = await context.ExpressionPatterns.getAnalysis(closedIdiomEntry);
assert.equal(closedIdiom.forms.sourceType, "expression-ordbank");
assert.deepEqual(
  alternatives(value(closedIdiom.forms, "Fixed expression")),
  ["i bunn", "i bunnen"],
);

// "en god del" (a good deal / quite a lot) is a quantifier idiom whose
// citation form already contains its own literal "en" before the adjective
// + noun phrase — inserting the row's own article there duplicated it
// ("en en god del"), and the definite/plural rows mixed the still-literal
// "en" with a freshly inserted "den"/"de" ("en den gode delen"). Unlike "i
// bunn, i bunnen" there's only one authored variant here, so there's no
// second citation form to base a definite/plural reading on either way —
// this must just stay the fixed, literal quantifier phrase.
const quantifierIdiomEntry = {
  ord: "en god del",
  gender: "expression",
  definisjon: "nokså mange eller mye",
  eksempel: "Det var en god del folk på konserten i går.",
};
const quantifierIdiom = await context.ExpressionPatterns.getAnalysis(
  quantifierIdiomEntry,
);
assert.equal(value(quantifierIdiom.forms, "Fixed expression"), "en god del");

const easyEntry = {
  ord: "lett som en plett",
  gender: "expression",
  eksempel: "Den oppgaven var lett som en plett.",
};
const easy = await context.ExpressionPatterns.getAnalysis(easyEntry);
assert.equal(easy.matcher.test(easyEntry.eksempel), true);
const easyHighlight = easy.matcher.highlight(easyEntry.eksempel);
assert.match(easyHighlight, />lett<\/span>/u);
assert.match(easyHighlight, />som<\/span>/u);
assert.match(easyHighlight, />en<\/span>/u);
assert.match(easyHighlight, />plett<\/span>/u);

// "en"/"et"/"ei" (indefinite article) happen to also be the imperative of
// the rare verbs "ene"/"ete"/"eie" (unite/eat/own), and a noun in its bare
// citation form can itself collide with a different verb's imperative
// ("foss" the waterfall vs. "fosse", to gush). Both must lose to the
// obvious noun-phrase reading here, and the expression's only conjugating
// head must be "snakke"/"prate" — not "ene" or "fosse".
const waterfallEntry = {
  ord: "snakke som en foss, prate som en foss",
  gender: "expression",
  definisjon: "snakke mye og fort",
  eksempel: "Hun kunne snakke som en foss og stoppet aldri.",
};
const waterfall = await context.ExpressionPatterns.getAnalysis(waterfallEntry);
assert.equal(waterfall.matcher.test(waterfallEntry.eksempel), true);
for (const pattern of waterfall.patterns) {
  // "en" here is fixed grammar (the article), not a substitutable slot like
  // "noen"/"noe" — it stays a plain, unselected lexeme (matched by literal
  // text equality, same as "som") rather than a `type: "placeholder"` node.
  // A placeholder is matched by blindly consuming whatever token sits at
  // the current search position, which is fine for a genuinely free slot
  // but wrong for a fixed word — it previously let the search swallow the
  // wrong token entirely when the article opened the citation form with no
  // anchor word before it (see the "et avsluttet kapittel" case below), and
  // it must print as plain "en" in Word Forms, not "[en]".
  const enNode = pattern.nodes.find((node) => node.normalized === "en");
  assert.equal(enNode?.type, "lexeme");
  assert.equal(enNode?.selected, undefined);
  const fossNode = pattern.nodes.find((node) => node.normalized === "foss");
  assert.notEqual(fossNode?.selected?.wordClass, "verb");
}
assert.match(
  waterfall.matcher.highlight(waterfallEntry.eksempel),
  />en<\/span>/u,
);
// Both comma-separated variants are equally valid dictionary entries; the
// shared example sentence only ever attests "snakke" literally, but "prate"
// must still get its own conjugation rather than silently vanishing.
assert.deepEqual([...waterfall.forms.expressionHeads], ["snakke", "prate"]);
assert.deepEqual(alternatives(value(waterfall.forms, "Present")), [
  "snakker som en foss",
  "prater som en foss",
]);

// "et" opens this citation form with no anchor word before it (unlike "en"
// in "snakke som en foss", which comes after the real head verb) — the case
// that actually exposed the placeholder blind-consumption bug: the search
// swallowed the sentence's first word entirely as "et", then bridged the
// gap to "avsluttet" through ordinary gap tolerance, so "et" was never
// actually matched or highlighted at its real position. "avsluttet" is
// also a past participle used as an adjective here ("a closed chapter"),
// not a finite verb — Norsk Ordbank has no separate adjective lexeme for
// it, so without dropping the verb reading explicitly, it was the only
// candidate left standing and produced a nonsense conjugation table for a
// fixed noun phrase that doesn't inflect at all.
const closedChapterEntry = {
  ord: "et avsluttet kapittel, et tilbakelagt kapittel",
  gender: "expression",
  definisjon: "noe en har gjort seg ferdig med",
  eksempel: "Forholdet vårt er et avsluttet kapittel.",
};
const closedChapter = await context.ExpressionPatterns.getAnalysis(
  closedChapterEntry,
);
assert.equal(closedChapter.matcher.test(closedChapterEntry.eksempel), true);
for (const pattern of closedChapter.patterns) {
  const etNode = pattern.nodes.find((node) => node.normalized === "et");
  assert.equal(etNode?.type, "lexeme");
  assert.equal(etNode?.selected, undefined);
  const participleNode = pattern.nodes.find(
    (node) => node.normalized === "avsluttet" || node.normalized === "tilbakelagt",
  );
  assert.notEqual(participleNode?.selected?.wordClass, "verb");
}
assert.deepEqual(
  alternatives(value(closedChapter.forms, "Fixed expression")),
  ["et avsluttet kapittel", "et tilbakelagt kapittel"],
);
const closedChapterHighlight = closedChapter.matcher.highlight(
  closedChapterEntry.eksempel,
);
assert.match(closedChapterHighlight, />et<\/span>/u);
assert.match(closedChapterHighlight, />avsluttet<\/span>/u);
assert.match(closedChapterHighlight, />kapittel<\/span>/u);

// This is a compiler-wide rule, not an exception for "lett som en plett": an
// authored generic "en" is highlighted when that literal token is present,
// but a substituted object occupying the same placeholder is not.
const literalGenericEntry = {
  ord: "følge en til graven",
  gender: "expression",
  eksempel: "De skulle følge en til graven.",
};
const literalGeneric = await context.ExpressionPatterns.getAnalysis(
  literalGenericEntry,
);
assert.equal(
  literalGeneric.patterns.some((pattern) =>
    pattern.nodes.some(
      (node) => node.type === "placeholder" && node.normalized === "en",
    ),
  ),
  true,
);
assert.match(
  literalGeneric.matcher.highlight(literalGenericEntry.eksempel),
  />en<\/span>/u,
);
assert.doesNotMatch(
  literalGeneric.matcher.highlight("De skulle følge ham til graven."),
  />ham<\/span>/u,
);

// Possessives authored inside lexicalized expressions stay fixed. If the
// entry's own example attests a person substitution, that exact surface can
// match too, but it must not open the entire gender/number paradigm.
const dyingDayEntry = {
  ord: "til sin døende dag",
  gender: "expression",
  eksempel: "Dette vil jeg huske til min døende dag.",
};
const dyingDay = await context.ExpressionPatterns.getAnalysis(dyingDayEntry);
assert.equal(value(dyingDay.forms, "Fixed expression"), "til sin døende dag");
assert.equal(dyingDay.matcher.test(dyingDayEntry.eksempel), true);
assert.equal(dyingDay.matcher.test("Dette varer til sin døende dag."), true);
assert.equal(dyingDay.matcher.test("Dette varer til mitt døende dag."), false);
const dyingPossessive = dyingDay.patterns[0].nodes.find(
  (node) => node.normalized === "sin",
);
assert.deepEqual([...dyingPossessive.possessiveForms], ["sin", "min"]);

const fixedMinEntry = {
  ord: "du store min",
  gender: "expression",
  eksempel: "Du store min, for et tordenvær!",
};
const fixedMin = await context.ExpressionPatterns.getAnalysis(fixedMinEntry);
assert.equal(value(fixedMin.forms, "Fixed expression"), "du store min");
assert.equal(fixedMin.matcher.test(fixedMinEntry.eksempel), true);
assert.equal(fixedMin.matcher.test("Du store mitt, for et tordenvær!"), false);

// A future CSV-only regular expression still works before the compact data is
// rebuilt, but its table is honestly labeled as estimated rather than Ordbank.
const futureEntry = {
  ord: "florpe ut",
  gender: "expression",
  eksempel: "Hun florpet ut hele historien.",
};
const future = await context.ExpressionPatterns.getAnalysis(futureEntry);
assert.equal(future.forms.sourceType, "expression-estimated");
assert.equal(value(future.forms, "Present"), "florper ut");
assert.equal(value(future.forms, "Past"), "florpet ut");
assert.equal(future.matcher.test(futureEntry.eksempel), true);

console.log("Automatic expression-pattern checks passed.");
