import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "wordGame.js"), "utf8");
const styles = fs.readFileSync(
  path.join(root, "styles/00-foundations-and-game.css"),
  "utf8",
);

assert.match(source, /class="game-learning-stage"/);
assert.match(source, /id="game-teaching-reveal"/);
assert.match(source, /data-state="question"/);
assert.match(source, /id="game-pronunciation-slot"/);
assert.match(source, /game-listening-prompt/);
assert.match(source, /function getWordGameStatsProgressHeading/);
assert.match(source, /<p class="game-stat-label">In a row<\/p>/);
assert.match(source, /<p class="game-stat-label">To review<\/p>/);
assert.match(source, /renderGameTeachingReveal\(\{/);
assert.doesNotMatch(source, /querySelector\("\.game-cefr-spacer"\)/);

assert.match(styles, /\.game-learning-stage\s*\{[\s\S]*?grid-template-rows:/);
assert.match(styles, /\.game-teaching-reveal\s*\{[\s\S]*?height: 132px/);
assert.match(styles, /\.game-teaching-reveal\s*\{[\s\S]*?overflow: hidden/);
assert.match(
  styles,
  /\.game-teaching-context\s*\{[\s\S]*?overflow-y: auto/,
);
assert.doesNotMatch(
  styles.match(/\.game-teaching-sentence\s*\{[\s\S]*?\n\}/)?.[0] ?? "",
  /line-clamp|overflow: hidden/,
);
assert.doesNotMatch(
  styles.match(/\.game-teaching-translation\s*\{[\s\S]*?\n\}/)?.[0] ?? "",
  /line-clamp|overflow: hidden/,
);
assert.match(
  styles,
  /body\.word-game-mode\.word-game-round-active \.game-grid\s*\{[\s\S]*?position: fixed/,
);
assert.match(
  styles,
  /bottom: calc\(max\(8px, env\(safe-area-inset-bottom\)\) \+ 74px\)/,
);
assert.match(styles, /\.game-pronunciation-slot\s*\{/);
assert.match(
  styles,
  /\.game-word\.game-listening-prompt\s*\{[\s\S]*?overflow: visible/,
);
assert.match(
  styles,
  /\.game-listening-prompt \.game-listening-icon\s*\{[\s\S]*?margin-bottom: 8px/,
);
assert.match(styles, /font-family: "Fraunces", Georgia/);
assert.match(styles, /font-family: "Source Serif 4", Georgia/);
assert.match(styles, /font-weight: 500 !important/);
assert.match(styles, /\.game-progress-heading\s*\{/);
assert.match(styles, /background-color: #4f8067/);
assert.match(
  styles,
  /@media \(min-width: 1025px\)[\s\S]*?#game-session-stats\s*\{[\s\S]*?margin-bottom: 4px/,
);

const navigationStyles = fs.readFileSync(
  path.join(root, "styles/35-navigation.css"),
  "utf8",
);
assert.match(navigationStyles, /background-color: #f8fafc/);
assert.match(navigationStyles, /border: 1px solid #d8e1e8/);
assert.match(
  navigationStyles,
  /\.game-round-menu-panel \.game-end-session-btn i\s*\{[\s\S]*?display: inline-block/,
);

console.log("word-game teaching reveal checks passed");
