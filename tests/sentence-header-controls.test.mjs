import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(
  path.join(root, "styles/20-results-and-story-quiz.css"),
  "utf8",
);

const toggleRule = css.match(
  /\.sentence-results-actions \.sentence-btn \{([\s\S]*?)\n\}/,
)?.[1];
assert.ok(toggleRule, "sentence English toggle styling should exist");

for (const declaration of [
  "background-color: var(--color-surface)",
  "border: 1px solid var(--color-wash-blue-border)",
  "border-radius: 999px",
  "color: var(--color-ink)",
  "font-size: 14px",
  "font-weight: 500",
  "padding: 5px 9px",
  "text-transform: none",
]) {
  assert.match(toggleRule, new RegExp(declaration.replace(/[()]/g, "\\$&")));
}

const sideRule = css.match(/\.sentence-results-header-side \{([\s\S]*?)\n\}/)?.[1];
assert.ok(sideRule, "sentence header-side positioning should exist");
assert.match(sideRule, /align-items: flex-end/);
assert.match(sideRule, /flex-direction: column/);
assert.match(sideRule, /position: absolute/);
assert.match(sideRule, /bottom: 20px/);
assert.match(sideRule, /right: 24px/);
assert.match(sideRule, /top: 20px/);

const actionsRule = css.match(/\.sentence-results-actions \{([\s\S]*?)\n\}/)?.[1];
assert.match(actionsRule, /margin: auto 0 0/);
