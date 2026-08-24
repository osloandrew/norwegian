import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "scripts.js"), "utf8");
const functionStart = source.indexOf(
  "function normalizeResultCardMatchValue(value)",
);
const functionEnd = source.indexOf(
  "// Function to handle clicking on a search result card",
  functionStart,
);

assert.notEqual(functionStart, -1, "result-card normalizer should exist");
assert.notEqual(functionEnd, -1, "result-card normalizer boundary should exist");

const context = vm.createContext({ String });
vm.runInContext(source.slice(functionStart, functionEnd), context);

test("result cards match multiline CSV definitions to flattened click data", () => {
  const csvDefinition =
    "kategori av individer med felles kjennetegn;\n(typisk) representant";
  const clickDefinition =
    "kategori av individer med felles kjennetegn; (typisk) representant";

  assert.equal(
    context.normalizeResultCardMatchValue(csvDefinition),
    context.normalizeResultCardMatchValue(clickDefinition),
  );
});

test("the result lookup uses normalized comparisons for every identifying field", () => {
  const handlerStart = source.indexOf("function handleCardClick(");
  const handlerEnd = source.indexOf(
    "// Open an official fallback card",
    handlerStart,
  );
  const handlerSource = source.slice(handlerStart, handlerEnd);

  for (const field of ["r.ord", "r.gender", "r.engelsk", "r.definisjon"]) {
    assert.match(handlerSource, new RegExp(`normalizeResultCardMatchValue\\(${field.replace(".", "\\.")}\\)`));
  }
});

test("a direct lookup ranks a true headword before an earlier alternative spelling", () => {
  const renderStart = source.indexOf("function renderWordDefinition(");
  const renderEnd = source.indexOf("function getHomographEntries(", renderStart);
  assert.notEqual(renderStart, -1);
  assert.notEqual(renderEnd, -1);

  const elements = {
    "type-select": { value: "" },
    "pos-select": { value: "", disabled: true },
    "results-container": { innerHTML: "" },
  };
  let rendered = null;
  let metadata = null;
  const renderContext = vm.createContext({
    results: [
      { ord: "andre, annen", gender: "adjective" },
      { ord: "annen", gender: "determiner" },
    ],
    WordClass: {
      stripNounPrefix: (value) => String(value || "").trim().toLowerCase(),
      isNounGender: () => false,
    },
    document: {
      getElementById: (id) => elements[id],
      querySelector: () => ({ classList: { remove() {} } }),
    },
    displaySearchResults: (entries) => { rendered = entries; },
    updateWordMetadata: (entry) => { metadata = entry; },
    escapeHTML: String,
  });
  vm.runInContext(source.slice(renderStart, renderEnd), renderContext);
  renderContext.renderWordDefinition("annen");

  assert.equal(rendered[0].ord, "annen");
  assert.equal(metadata.ord, "annen");
  assert.equal(rendered[1].ord, "andre, annen");
});

test("definition clicks prefer a unique exact closed-class headword", () => {
  const helperStart = source.indexOf(
    "const INFLECTING_DEFINITION_WORD_CLASSES",
  );
  const helperEnd = source.indexOf(
    'document.addEventListener("click", async (event)',
    helperStart,
  );
  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);

  const helperContext = vm.createContext({
    Set,
    WordClass: {
      getWordClass: (gender) => gender,
    },
  });
  vm.runInContext(source.slice(helperStart, helperEnd), helperContext);

  const conjunction = { ord: "eller", gender: "conjunction" };
  const noun = { ord: "danser", gender: "noun" };
  assert.equal(
    helperContext.getDefinitiveExactDefinitionMatch([conjunction]),
    conjunction,
  );
  assert.equal(helperContext.getDefinitiveExactDefinitionMatch([noun]), null);
  assert.equal(
    helperContext.getDefinitiveExactDefinitionMatch([conjunction, noun]),
    null,
  );
});
