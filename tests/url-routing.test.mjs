import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "scripts.js"), "utf8");
const functionStart = source.indexOf("function getPrimaryWordForURL(");
const functionEnd = source.indexOf("// Helper function to capitalize", functionStart);

assert.notEqual(functionStart, -1, "URL word normalizer should exist");
assert.notEqual(functionEnd, -1, "updateURL boundary should exist");

function createRoutingContext(manifestWords = []) {
  let pushedURL = null;
  const context = vm.createContext({
    URL,
    String,
    APP_ROOT_URL: "http://127.0.0.1:3000/",
    STATIC_FEATURE_ROUTES: {
      sentences: "sentences/",
      "word-game": "word-game/",
      pronunciation: "pronunciation/",
    },
    pageManifest: { words: new Set(manifestWords), stories: new Set() },
    window: {
      location: { pathname: "/" },
      history: { pushState: (_state, _title, url) => { pushedURL = String(url); } },
    },
    document: { title: "" },
    parsePathState: () => null,
    slugifyWordForURL: (value) => String(value).trim().toLowerCase().replaceAll(" ", "-"),
    findWordEntryForMetadata: (word) => ({ ord: word }),
    updateWordMetadata: () => {},
    updateFeatureMetadata: () => {},
    capitalizeType: (value) => value,
  });
  vm.runInContext(source.slice(functionStart, functionEnd), context);
  return { context, getPushedURL: () => pushedURL };
}

test("alternative spellings use the primary word's pretty page", () => {
  const { context, getPushedURL } = createRoutingContext(["vuggesang"]);

  context.updateURL("", "words", "noun", "", null, "vuggesang, voggesang");

  assert.equal(getPushedURL(), "http://127.0.0.1:3000/word/vuggesang/");
});

test("the empty Words mode uses the application root", () => {
  const { context, getPushedURL } = createRoutingContext();

  context.updateURL("", "words", "", "");

  assert.equal(getPushedURL(), "http://127.0.0.1:3000/");
});

test("a sentence search keeps state on the pretty feature route", () => {
  const { context, getPushedURL } = createRoutingContext();

  context.updateURL("eple", "sentences", "", "");

  assert.equal(
    getPushedURL(),
    "http://127.0.0.1:3000/sentences/?query=eple",
  );
});

test("a random sentence returns to the clean feature route", () => {
  const { context, getPushedURL } = createRoutingContext();

  context.updateURL("", "sentences", "", "");

  assert.equal(getPushedURL(), "http://127.0.0.1:3000/sentences/");
});

test("a Words search does not repeat the default mode in the query string", () => {
  const { context, getPushedURL } = createRoutingContext();

  context.updateURL("eple", "words", "", "");

  assert.equal(getPushedURL(), "http://127.0.0.1:3000/?query=eple");
});

test("JS-only modes retain an explicit type parameter", () => {
  const { context, getPushedURL } = createRoutingContext();

  context.updateURL("", "my-stats", "", "");

  assert.equal(getPushedURL(), "http://127.0.0.1:3000/?type=my-stats");
});

test("Settings and About retain an explicit type parameter, same as My Stats", () => {
  const { context, getPushedURL } = createRoutingContext();

  context.updateURL("", "settings", "", "");
  assert.equal(getPushedURL(), "http://127.0.0.1:3000/?type=settings");

  context.updateURL("", "about", "", "");
  assert.equal(getPushedURL(), "http://127.0.0.1:3000/?type=about");
});
