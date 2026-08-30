import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "stories.js"), "utf8");

const fetchStart = source.indexOf("async function fetchStoryCSV(");
const fetchEnd = source.indexOf("async function fetchFreshStoryData(", fetchStart);
const fetchSource = source.slice(fetchStart, fetchEnd);

assert.notEqual(fetchStart, -1, "story CSV fetcher should exist");
assert.notEqual(fetchEnd, -1, "story CSV fetcher boundary should exist");
assert.match(
  fetchSource,
  /fetch\([\s\S]*\{[\s\S]*cache: "no-cache"[\s\S]*\}/,
  "every fresh load should revalidate the deployed story catalogs",
);

const loaderStart = source.indexOf("async function fetchAndLoadStoryData(");
const loaderEnd = source.indexOf("// Helper function", loaderStart);
const loaderSource = source.slice(loaderStart, loaderEnd);

assert.notEqual(loaderStart, -1, "story loader should exist");
assert.notEqual(loaderEnd, -1, "story loader boundary should exist");

const networkFetch = loaderSource.indexOf("fetchFreshStoryData()");
const cachedFallback = loaderSource.indexOf("storyResults = cached || [];");
assert.ok(networkFetch >= 0, "the deployed story catalogs should be fetched");
assert.ok(
  cachedFallback > networkFetch,
  "localStorage should only be used after the fresh network request fails",
);

console.log("Story freshness checks passed.");
