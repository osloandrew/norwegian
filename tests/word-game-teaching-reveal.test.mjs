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
assert.match(source, /<p class="game-stat-label">In a Row<\/p>/);
assert.match(source, /<p class="game-stat-label">To Review<\/p>/);
assert.match(source, /renderGameTeachingReveal\(\{/);
assert.match(source, /async function renderGameTeachingReveal/);
assert.match(source, /await getTeachingSentenceHTML\(wordObj, normalizedSentence\)/);
assert.doesNotMatch(source, /querySelector\("\.game-cefr-spacer"\)/);

assert.match(styles, /\.game-learning-stage\s*\{[\s\S]*?grid-template-rows:/);
assert.match(styles, /\.game-teaching-reveal\s*\{[\s\S]*?height: 132px/);
assert.match(styles, /\.game-teaching-reveal\s*\{[\s\S]*?overflow: hidden/);
assert.match(
  styles,
  /\.game-teaching-context\s*\{[\s\S]*?overflow-y: auto/,
);
const teachingOutcomeTextStyles =
  styles.match(/\.game-teaching-outcome strong\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
assert.match(teachingOutcomeTextStyles, /white-space: normal/);
assert.match(teachingOutcomeTextStyles, /overflow-wrap: anywhere/);
assert.doesNotMatch(teachingOutcomeTextStyles, /ellipsis|line-clamp/);
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
assert.match(styles, /font-family: "Source Serif 4", Georgia/);
assert.match(styles, /font-weight: 500 !important/);
assert.match(styles, /\.game-progress-heading\s*\{/);
assert.match(styles, /background-color: #4f8067/);
assert.match(
  styles,
  /\.game-stats-correct-box \.game-stat-label\s*\{[\s\S]*?font-size: 13px[\s\S]*?white-space: nowrap/,
);
assert.match(
  styles,
  /\.game-stats-incorrect-box \.game-stat-label\s*\{[\s\S]*?font-size: 13px[\s\S]*?white-space: nowrap/,
);
assert.match(
  styles,
  /@media \(max-width: 600px\)[\s\S]*?#results-container\s*\{\s*margin-top: 3px[\s\S]*?#game-session-stats\s*\{\s*margin-bottom: 3px[\s\S]*?> \.game-stats-content\s*\{\s*margin-bottom: 0/,
);
assert.match(
  styles,
  /--game-mobile-reveal-height: clamp\(156px, calc\(100dvh - 688px\), 176px\)/,
);
assert.match(
  styles,
  /@media \(max-width: 600px\) and \(max-height: 700px\)[\s\S]*?grid-template-rows: 162px 128px[\s\S]*?height: 298px/,
);
assert.match(
  styles,
  /@media \(min-width: 1025px\)[\s\S]*?#game-session-stats\s*\{[\s\S]*?margin-bottom: 4px/,
);

const navigationStyles = fs.readFileSync(
  path.join(root, "styles/35-navigation.css"),
  "utf8",
);
const shellStyles = fs.readFileSync(
  path.join(root, "styles/01-document-shell.css"),
  "utf8",
);
assert.match(
  shellStyles,
  /html:has\(body\.word-game-mode\.word-game-round-active\),[\s\S]*?body\.word-game-mode\.word-game-round-active\s*\{[\s\S]*?height: 100dvh;[\s\S]*?overflow: hidden;[\s\S]*?overscroll-behavior: none/,
);
assert.match(
  shellStyles,
  /body\.word-game-mode\.word-game-round-active main\s*\{[\s\S]*?min-height: 0;[\s\S]*?overflow: hidden/,
);
assert.match(
  source,
  /function setGameContainerHTML\(html\)\s*\{[\s\S]*?word-game-round-active[\s\S]*?window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/,
);
assert.match(navigationStyles, /background-color: #f8fafc/);
assert.match(navigationStyles, /border: 1px solid #d8e1e8/);
assert.match(
  navigationStyles,
  /body\.word-game-mode\.word-game-round-active \.game-english-filter\s*\{[\s\S]*?display: none !important/,
);
assert.match(
  navigationStyles,
  /\.game-round-menu-panel\s+\.game-english-toggle-btn,[\s\S]*?\.game-round-menu-panel\s+\.toolbar-report-issue-btn,[\s\S]*?\.game-round-menu-panel\s+\.game-end-session-btn\s*\{[\s\S]*?background-color: #f8fafc[\s\S]*?border: 1px solid #d8e1e8/,
);
assert.match(
  navigationStyles,
  /\.game-english-toggle-btn\s*\{\s*order: 1/,
);
assert.match(
  navigationStyles,
  /\.toolbar-report-issue-btn\s*\{\s*order: 2/,
);
assert.match(
  navigationStyles,
  /\.game-end-session-btn\s*\{\s*order: 3/,
);
assert.match(
  navigationStyles,
  /\.game-round-menu-panel \.toolbar-report-issue-btn i,[\s\S]*?\.game-round-menu-panel \.game-end-session-btn i\s*\{\s*display: none/,
);
assert.match(
  navigationStyles,
  /\.game-round-menu-panel \.toolbar-report-issue-btn span,[\s\S]*?\.game-round-menu-panel \.game-end-session-btn span\s*\{[\s\S]*?display: block/,
);

console.log("word-game teaching reveal checks passed");
