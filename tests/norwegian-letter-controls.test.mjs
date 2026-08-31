import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptsSource = fs.readFileSync(path.join(root, "scripts.js"), "utf8");
const wordGameSource = fs.readFileSync(path.join(root, "wordGame.js"), "utf8");
const navigationStyles = fs.readFileSync(
  path.join(root, "styles/35-navigation.css"),
  "utf8",
);
const gameStyles = fs.readFileSync(
  path.join(root, "styles/00-foundations-and-game.css"),
  "utf8",
);

test("both Norwegian letter palettes identify their group and controlled input", () => {
  assert.match(
    indexSource,
    /class="search-norwegian-letter-keys"\s+role="group"\s+aria-label="Norwegian letters"/,
  );
  assert.equal(
    (indexSource.match(/aria-controls="search-bar"/g) || []).length,
    3,
  );

  assert.match(
    wordGameSource,
    /class="game-norwegian-letter-keys" role="group" aria-label="Norwegian letters"/,
  );
  assert.equal(
    (wordGameSource.match(/aria-controls="game-typed-answer-input"/g) || [])
      .length,
    3,
  );
});

test("search letters replace the selection, emit input, and restore pointer focus", () => {
  const functionStart = scriptsSource.indexOf(
    "const searchLetterPointerActivations",
  );
  const functionEnd = scriptsSource.indexOf("\nfunction clearContainer", functionStart);
  const dispatchedEvents = [];
  const focusOptions = [];
  const input = {
    disabled: false,
    selectionStart: 1,
    selectionEnd: 3,
    value: "faer",
    dispatchEvent(event) {
      dispatchedEvents.push(event);
    },
    focus(options) {
      focusOptions.push(options);
    },
    setRangeText(text, start, end) {
      this.value = `${this.value.slice(0, start)}${text}${this.value.slice(end)}`;
      this.selectionStart = start + text.length;
      this.selectionEnd = this.selectionStart;
    },
  };
  class TestEvent {
    constructor(type, options) {
      this.type = type;
      this.bubbles = options?.bubbles ?? false;
    }
  }
  const context = vm.createContext({
    document: { getElementById: () => input },
    Event: TestEvent,
  });
  vm.runInContext(scriptsSource.slice(functionStart, functionEnd), context);

  const pointerButton = {};
  context.markSearchLetterPointerActivation({ currentTarget: pointerButton });
  context.insertSearchLetter("æ", {
    currentTarget: pointerButton,
    detail: 0,
  });
  assert.equal(input.value, "fær");
  assert.equal(dispatchedEvents.length, 1);
  assert.equal(dispatchedEvents[0].type, "input");
  assert.equal(dispatchedEvents[0].bubbles, true);
  assert.equal(focusOptions.length, 1);
  assert.equal(focusOptions[0].preventScroll, true);

  context.insertSearchLetter("ø", { detail: 0 });
  assert.equal(input.value, "fæør");
  assert.equal(focusOptions.length, 1, "keyboard activation keeps button focus");
});

test("every mobile Norwegian text input stays at the iOS no-zoom threshold", () => {
  assert.match(
    navigationStyles,
    /@media \(max-width:\s*1024px\)[\s\S]*?#search-bar\s*{[^}]*font-size:\s*16px;/,
  );
  assert.match(
    gameStyles,
    /@media \(max-width:\s*600px\)[\s\S]*?\.game-typed-answer-input\s*{[^}]*font-size:\s*16px;/,
  );
});

test("word-game pointer activation restores the answer field focus", () => {
  assert.match(
    wordGameSource,
    /button\.addEventListener\("pointerdown",[\s\S]*?button\.addEventListener\("click", \(event\) => \{[\s\S]*?input\.dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\);[\s\S]*?if \(isPointerActivation \|\| event\.detail > 0\) \{\s*input\.focus\(\{ preventScroll: true \}\);/,
  );
});
