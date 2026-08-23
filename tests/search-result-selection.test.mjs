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
