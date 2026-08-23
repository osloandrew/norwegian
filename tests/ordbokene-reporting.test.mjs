import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "scripts.js"), "utf8");

test("the single Ordbokene fallback card reports its displayed headword", () => {
  assert.match(
    source,
    /isOrdbokeneResult\s*\? defaultResult\s*\? `<div class="definition-actions-row ordbokene-actions-row">/,
  );
  assert.match(
    source,
    /class="report-issue-btn"[\s\S]*?flagMissingWordEntry\('\$\{escapedWord\}'\)[\s\S]*?Report missing word/,
  );
});

test("missing-word reports submit only the bare displayed word", async () => {
  const functionStart = source.indexOf("function flagMissingWordEntry(word)");
  const functionEnd = source.indexOf(
    "// The \"no match\" branch",
    functionStart,
  );
  assert.notEqual(functionStart, -1);
  assert.notEqual(functionEnd, -1);

  const submissions = [];
  const context = vm.createContext({
    alert() {},
    console,
    submitUserFeedback(message) {
      submissions.push(message);
      return Promise.resolve();
    },
  });

  vm.runInContext(source.slice(functionStart, functionEnd), context);
  context.flagMissingWordEntry("skie, ski");
  await Promise.resolve();

  assert.deepEqual(submissions, ["skie, ski"]);
});
