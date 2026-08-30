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

test("mobile search gives the letter keys their own non-overlapping column", () => {
  assert.match(
    navigationStyles,
    /@media \(max-width:\s*1024px\)[\s\S]*?\.search-and-random-wrapper\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*max-content minmax\(0,\s*1fr\);/,
  );
});
