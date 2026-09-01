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
    /class="report-issue-btn"[\s\S]*?flagMissingWordEntry\('\$\{escapedWord\}'\)[\s\S]*?Report Missing Word/,
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

test("existing-word reports put the headword first without wrapper punctuation", () => {
  const functionStart = source.indexOf("function buildFeedbackMessage(");
  const functionEnd = source.indexOf("function flagMissingWordEntry(word)", functionStart);
  assert.notEqual(functionStart, -1);
  assert.notEqual(functionEnd, -1);

  const context = vm.createContext({});
  vm.runInContext(source.slice(functionStart, functionEnd), context);

  assert.equal(
    context.buildFeedbackMessage({
      source: "Word Game · Cloze",
      word: "oppkavet, oppkava, oppkavd",
      pos: "adjective",
      cefr: "C",
      prompt: "Hun følte seg helt oppkavet av stresset.",
      category: "My answer should have been accepted",
      userAnswer: "Overveldet",
    }),
    'oppkavet, oppkava, oppkavd-update Word Game · Cloze (adjective, C) — Shown: "Hun følte seg helt oppkavet av stresset." — Category: My answer should have been accepted — Learner answered: "Overveldet"',
  );
  assert.equal(
    context.buildFeedbackMessage({
      source: "Word Card",
      word: "streit, straight",
      pos: "adjective",
      cefr: "B2",
      category: "English sentence translation",
    }),
    "streit, straight-update Word Card (adjective, B2) — Category: English sentence translation",
  );
  assert.equal(
    context.buildFeedbackMessage({
      source: "Word Card",
      word: "lysbilde",
      pos: "noun",
      cefr: "B1",
      category: "Norwegian example sentence",
    }),
    "lysbilde-update Word Card (noun, B1) — Category: Norwegian example sentence",
  );
});
