import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "pronunciation.js"), "utf8");

function loadBuilders(baseURI) {
  const context = vm.createContext({
    console,
    document: { baseURI },
    Promise,
    URL,
  });
  context.window = context;
  vm.runInContext(source, context, { filename: "pronunciation.js" });
  return context;
}

const local = loadBuilders(
  "http://127.0.0.1:3000/index.html?type=word-game",
);
assert.equal(
  local.buildWordAudioUrl("blå himmel"),
  "http://127.0.0.1:3000/Resources/Words/bl%C3%A5%20himmel.m4a",
);
assert.equal(
  local.buildPronAudioUrl("Hva skjer?"),
  "http://127.0.0.1:3000/Resources/Sentences/Hva%20skjer.m4a",
);

const githubPages = loadBuilders(
  "https://osloandrew.github.io/norwegian/index.html?type=word-game",
);
assert.equal(
  githubPages.buildWordAudioUrl("frisk"),
  "https://osloandrew.github.io/norwegian/Resources/Words/frisk.m4a",
);
assert.equal(
  githubPages.buildPronAudioUrl("Hun er frisk."),
  "https://osloandrew.github.io/norwegian/Resources/Sentences/Hun%20er%20frisk..m4a",
);

console.log("Pronunciation audio path checks passed.");
