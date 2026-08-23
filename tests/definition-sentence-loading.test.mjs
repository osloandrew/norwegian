import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "scripts.js"), "utf8");
const functionStart = source.indexOf("async function fetchAndRenderSentences(");
const functionEnd = source.indexOf("// Spinner Control Functions", functionStart);
const functionSource = source.slice(functionStart, functionEnd);

assert.notEqual(functionStart, -1, "sentence loader should exist");
assert.notEqual(functionEnd, -1, "sentence loader boundary should exist");

const immediateRender = functionSource.indexOf(
  "renderDefinitionSentenceResults(\n    immediatePrimaryResults",
);
const supplementalWait = functionSource.indexOf(
  "await window.Inflections.getSupplementalSentenceForms",
);

assert.notEqual(immediateRender, -1, "the entry's own example should be rendered");
assert.notEqual(supplementalWait, -1, "supplemental forms should still be loaded");
assert.ok(
  immediateRender < supplementalWait,
  "the own example must render before waiting for supplemental inflections",
);

console.log("Definition sentence loading-order checks passed.");
