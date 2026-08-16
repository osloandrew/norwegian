import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({ console, Map, Promise, Set, setTimeout });
context.window = context;
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
