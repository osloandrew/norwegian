import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "scripts.js"), "utf8");
const functionStart = source.indexOf("async function fetchAndLoadDictionaryDataOnce(");
const functionEnd = source.indexOf("// Parse the CSV data", functionStart);
const functionSource = source.slice(functionStart, functionEnd);

assert.notEqual(functionStart, -1, "dictionary loader should exist");
assert.notEqual(functionEnd, -1, "dictionary loader boundary should exist");
assert.match(
  functionSource,
  /fetch\([\s\S]*norwegianWords\.csv[\s\S]*\{ cache: "no-cache" \}/,
  "every load should revalidate the deployed dictionary",
);

const networkFetch = functionSource.indexOf("const localResponse = await fetch(");
const cachedFallback = functionSource.indexOf("const cachedCSV = await cachedCSVPromise;");
assert.ok(networkFetch >= 0, "the deployed dictionary should be fetched");
assert.ok(
  cachedFallback > networkFetch,
  "IndexedDB should only be used after the fresh network request fails",
);

console.log("Dictionary freshness checks passed.");
