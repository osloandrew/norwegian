import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const navigationStyles = fs.readFileSync(
  path.join(root, "styles/35-navigation.css"),
  "utf8",
);

test("word game hides the complete search control group at every width", () => {
  assert.match(
    navigationStyles,
    /body\.word-game-mode \.search-and-random-wrapper\s*{[^}]*display:\s*none;/s,
  );
});

test("mobile search cannot preserve an intrinsic width over the letter keys", () => {
  assert.match(
    navigationStyles,
    /@media \(max-width:\s*1024px\)[\s\S]*?#search-bar\s*{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*0;[^}]*width:\s*0;/,
  );
  assert.match(
    navigationStyles,
    /@media \(max-width:\s*1024px\)[\s\S]*?\.search-bar-wrapper\s*{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*0;[^}]*width:\s*0;/,
  );
  assert.match(
    navigationStyles,
    /@media \(max-width:\s*1024px\)[\s\S]*?\.search-norwegian-letter-keys\s*{[^}]*flex:\s*0 0 100px;[^}]*min-width:\s*100px;/,
  );
});
