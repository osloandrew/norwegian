import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "wordGame.js"), "utf8");
const styles = fs.readFileSync(
  path.join(root, "styles", "00-foundations-and-game.css"),
  "utf8",
);

const introductionStart = source.indexOf(
  "async function renderWordIntroductionUI",
);
const introductionEnd = source.indexOf(
  '// mode: "forward"',
  introductionStart,
);
assert.notEqual(introductionStart, -1);
assert.notEqual(introductionEnd, -1);
const introductionSource = source.slice(introductionStart, introductionEnd);

assert.match(introductionSource, /Learn This Word/);
assert.match(introductionSource, /This introduction isn’t scored/);
assert.match(introductionSource, /Continue Practice/);
assert.match(introductionSource, /playWordAudio\(wordObj\)/);
assert.match(introductionSource, /game-introduction-target/);
assert.doesNotMatch(introductionSource, /beginQuestionPrediction/);
assert.doesNotMatch(introductionSource, /WordStrengthAPI\?\.recordResult/);
assert.doesNotMatch(introductionSource, /wordGameSessionQuestionsAnswered\+\+/);

for (const mode of [
  "cloze",
  "typed-cloze",
  "listening",
  "typed-listening",
  "reverse",
  "typed-reverse",
]) {
  assert.match(source, new RegExp(`mode === "${mode}"`));
}
assert.match(source, /return "You’ll recall its meaning/);

assert.match(
  source,
  /placementCalibrationEnabled: wordGamePlacementCalibrationEnabled/,
);
assert.match(
  source,
  /initialRetrievalQueue\.push\(initialEntry\)[\s\S]*?renderWordIntroductionUI\(initialEntry\)/,
);
assert.match(
  fs.readFileSync(path.join(root, "wordGamePolicy.js"), "utf8"),
  /MAX_PENDING_INITIAL_RETRIEVALS = 2/,
);
assert.match(
  source,
  /currentWordQueueType = "initial-retrieval";[\s\S]*?plannedQuestionMode = initialRetrievalEntry\.targetMode/,
);
assert.match(
  source,
  /preparedClozeTarget: plannedInitialClozeTarget/,
);
assert.match(
  source,
  /initialRetrievalQueue\.map\(\(queued\) => queued\.wordObj\)/,
);
assert.match(
  source,
  /wordGameSessionCorrectWords\.size >= wordGameSessionTarget &&[\s\S]*?initialRetrievalQueue\.length === 0/,
);

const structuredStart = source.indexOf(
  "function getStructuredQuestionModeForWord",
);
const structuredEnd = source.indexOf(
  "function getQuestionModeCandidates",
  structuredStart,
);
const structuredSource = source.slice(structuredStart, structuredEnd);
assert.match(
  structuredSource,
  /getDailyQuestQuestionMode\([\s\S]*?wordGameSessionIntroducedWords\.size/,
);
assert.match(
  structuredSource,
  /getBonusRoundQuestionMode\([\s\S]*?wordGameSessionIntroducedWords\.size/,
);

assert.match(styles, /\.game-teaching-reveal\[data-state="introduction"\]/);
assert.match(styles, /\.game-grid\.game-introduction-grid/);
assert.match(styles, /\.game-introduction-target/);

console.log("word-game introduction checks passed");
