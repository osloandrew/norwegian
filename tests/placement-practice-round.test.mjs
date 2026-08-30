import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { loadWordGamePolicy } from "./load-word-game-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "placementTest.js"), "utf8");
const featureCaptureSource = fs.readFileSync(
  path.join(root, "scripts", "capture-feature-pages.py"),
  "utf8",
);
assert.match(featureCaptureSource, /if feature == "word-game":/);
assert.match(featureCaptureSource, /Preparing Word Game/);
const starts = [];

function makeButton(dataset = {}) {
  return {
    dataset,
    addEventListener(type, listener) {
      assert.equal(type, "click");
      this.click = listener;
    },
  };
}

const optionButtons = Array.from({ length: 6 }, (_, index) =>
  makeButton({ index: String(index) }),
);
const skipButton = makeButton();
const container = {
  innerHTML: "",
  querySelectorAll(selector) {
    assert.equal(selector, ".placement-option-btn");
    return optionButtons;
  },
  querySelector(selector) {
    assert.equal(selector, ".placement-skip-btn");
    return skipButton;
  },
};

const context = vm.createContext({
  escapeGameHTML(value) {
    return String(value);
  },
  document: {
    getElementById(id) {
      assert.equal(id, "results-container");
      return container;
    },
  },
});
context.window = context;
context.WordGameHelpers = {
  startPlacementRound(score, options) {
    starts.push({ score, ...options });
  },
};

vm.runInContext(source, context, { filename: "placementTest.js" });
context.PlacementTestAPI.start();

assert.match(container.innerHTML, /10-word practice round/);
assert.doesNotMatch(container.innerHTML, /Question 1 of 13/);

optionButtons[2].click();
assert.deepEqual(starts.pop(), {
  score: 420,
  calibrate: true,
  beginnerFocus: 0.48,
});

optionButtons[1].click();
assert.deepEqual(starts.pop(), {
  score: 220,
  calibrate: true,
  beginnerFocus: 0.72,
});

optionButtons[0].click();
assert.deepEqual(starts.pop(), {
  score: 60,
  calibrate: true,
  beginnerFocus: 1,
});

skipButton.click();
assert.deepEqual(starts.pop(), {
  score: 60,
  calibrate: false,
  beginnerFocus: 1,
});

const wordGameSource = fs.readFileSync(path.join(root, "wordGame.js"), "utf8");
assert.match(
  wordGameSource,
  /beginWordGameRound\("session", PLACEMENT_PRACTICE_WORD_COUNT/,
);
assert.match(wordGameSource, /PLACEMENT_CALIBRATION_ANSWER_COUNT = 7/);
assert.match(wordGameSource, /First Practice Complete!/);
assert.match(
  wordGameSource,
  /const PLACEMENT_QUESTION_PLAN = Object\.freeze\(\[[\s\S]*?"listening"[\s\S]*?"typed-reverse"[\s\S]*?"typed-listening"[\s\S]*?\]\);/,
);
assert.match(
  wordGameSource,
  /function getStructuredQuestionModeForWord[\s\S]*?if \(wordGameIsPlacementRound\) return getPlacementQuestionMode\(wordObj\);/,
);
assert.match(
  wordGameSource,
  /PLACEMENT_LIKELY_GUESS_OUTCOME = 0\.65/,
);

// Homepage CTAs both route through startDailyQuestFromLanding. Entering the
// Word Game view renders placement; the helper must not then overwrite it
// with an emerald round for a learner who has no placement history.
const landingStart = wordGameSource.indexOf(
  "function startDailyQuestFromLanding",
);
const landingEnd = wordGameSource.indexOf(
  "function beginTodayPracticeRound",
  landingStart,
);
assert.notEqual(landingStart, -1);
assert.notEqual(landingEnd, -1);

const landingCalls = [];
const landingContext = vm.createContext({ landingCalls });
vm.runInContext(
  `
    let placementCompleted = false;
    function selectType(type) { landingCalls.push(["select", type]); }
    function beginTodayPracticeRound() { landingCalls.push(["begin"]); }
  `,
  landingContext,
);
vm.runInContext(
  wordGameSource.slice(landingStart, landingEnd),
  landingContext,
  { filename: "wordGame.js" },
);

landingContext.startDailyQuestFromLanding();
assert.deepEqual(JSON.parse(JSON.stringify(landingCalls)), [
  ["select", "word-game"],
]);
vm.runInContext("placementCompleted = true", landingContext);
landingContext.startDailyQuestFromLanding();
assert.deepEqual(JSON.parse(JSON.stringify(landingCalls.at(-1))), ["begin"]);

// The round engine itself is the final safety net for every current and
// future button that starts a round directly.
const beginRoundStart = wordGameSource.indexOf("function beginWordGameRound");
const beginRoundEnd = wordGameSource.indexOf(
  "function resetTodayPracticeRoundAfterMidnight",
  beginRoundStart,
);
assert.notEqual(beginRoundStart, -1);
assert.notEqual(beginRoundEnd, -1);

const placementGateCalls = [];
const roundContext = vm.createContext({ placementGateCalls });
roundContext.window = roundContext;
roundContext.PlacementTestAPI = {
  start() {
    placementGateCalls.push("placement");
  },
};
vm.runInContext(
  `
    let placementCompleted = false;
    let wordGameRoundActive = true;
    function updateEndSessionToolbarButtonVisibility() {
      placementGateCalls.push("toolbar");
    }
  `,
  roundContext,
);
vm.runInContext(
  wordGameSource.slice(beginRoundStart, beginRoundEnd),
  roundContext,
  { filename: "wordGame.js" },
);
roundContext.beginWordGameRound("session", 10);
assert.deepEqual(placementGateCalls, ["toolbar", "placement"]);
assert.match(
  wordGameSource.slice(beginRoundStart, beginRoundEnd),
  /if \(!placementCompleted && !options\.placementRound\)/,
);

// Placement measures ten distinct responses. Incorrect answers remain
// useful scheduler data for later, but they must neither enter the live
// relearning queue nor prevent this assessment round from completing.
const completionStart = wordGameSource.indexOf(
  "function isWordGameRoundComplete",
);
const completionEnd = wordGameSource.indexOf(
  "function updateEndSessionToolbarButtonVisibility",
  completionStart,
);
assert.notEqual(completionStart, -1);
assert.notEqual(completionEnd, -1);

const completionContext = vm.createContext({ Math });
vm.runInContext(
  `
    let wordGamePlacementCalibrationEnabled = true;
    let wordGameMode = "session";
    let wordGameSessionQuestionsAnswered = 10;
    let wordGameSessionTarget = 10;
    let wordGameSessionCorrectWords = new Set([1, 2, 3]);
    let incorrectWordQueue = [{}, {}, {}];
    let wordGameIsTodayPracticeRound = false;
    let wordGameIsBonusRound = false;
  `,
  completionContext,
);
vm.runInContext(
  wordGameSource.slice(completionStart, completionEnd),
  completionContext,
  { filename: "wordGame.js" },
);

// While calibration is actually running (a real, un-skipped placement
// round), 10 answered questions complete it regardless of the 3
// outstanding misses.
assert.equal(completionContext.isWordGameRoundComplete(), true);
assert.equal(
  completionContext.getWordGameSessionProgressLabel(),
  "Question 10 of 10",
);
assert.equal(completionContext.getWordGameSessionProgressPercent(), 100);

// Skipped placement still runs this same round shape (wordGameIsPlacementRound
// stays true — see the structuredQuestionMode assertion above), but with no
// assessment actually happening, it must complete like ordinary practice:
// the round isn't done while misses are still outstanding, and it reports
// itself the same way ordinary practice would.
vm.runInContext("wordGamePlacementCalibrationEnabled = false", completionContext);
assert.equal(completionContext.isWordGameRoundComplete(), false);
assert.equal(
  completionContext.getWordGameSessionProgressLabel(),
  "Word 3 of 10",
);
// 3 mastered words out of (10 target + 3 still-outstanding reviews): the
// bar weighs the 3 queued misses as real remaining work, not just the raw
// correct-word count the label above uses.
assert.equal(
  completionContext.getWordGameSessionProgressPercent(),
  (3 / 13) * 100,
);

const answerHandlerStart = wordGameSource.indexOf(
  "async function handleTranslationClick",
);
const answerHandlerEnd = wordGameSource.indexOf(
  "function enableGameControls",
  answerHandlerStart,
);
const answerHandlerSource = wordGameSource.slice(
  answerHandlerStart,
  answerHandlerEnd,
);
assert.match(
  answerHandlerSource,
  /if \(!wordGamePlacementCalibrationEnabled && !a0FirstExposure\) \{[\s\S]*incorrectWordQueue\.push/,
);
assert.match(answerHandlerSource, /const a0FirstExposure =/);
assert.match(answerHandlerSource, /Math\.min\(srsEvidenceWeight, 0\.35\)/);
assert.match(
  wordGameSource,
  /currentWordQueueType = "placement";[\s\S]*pickPrioritizedGameWord/,
);
assert.match(
  wordGameSource,
  /const leftStatHTML = wordGamePlacementCalibrationEnabled\s+\? ""/,
);
assert.match(
  wordGameSource,
  /const rightStatHTML = wordGamePlacementCalibrationEnabled\s+\? ""/,
);

// A starting-level choice seeds ability but leaves a first-time learner's
// placement incomplete. Only finishing question 10—or explicitly choosing
// Skip—unlocks ordinary Word Game entry. Retakes preserve an existing true
// completion flag if abandoned.
const placementStateStart = wordGameSource.indexOf(
  "function completePlacementTest",
);
const placementStateEnd = wordGameSource.indexOf(
  "function replaceAbilityState",
  placementStateStart,
);
assert.notEqual(placementStateStart, -1);
assert.notEqual(placementStateEnd, -1);

const placementStateCalls = [];
const trackedEvents = [];
const placementStateContext = vm.createContext({
  placementStateCalls,
  window: {
    // Mirrors the JSON round-trip placementState() already needs below:
    // params built by code running inside the vm context belong to a
    // different realm's Object.prototype, so assert.deepEqual against a
    // plain outer-realm object literal fails structural-but-not-
    // reference-equal even when the data is identical.
    trackEvent(name, params) {
      trackedEvents.push([name, JSON.parse(JSON.stringify(params || {}))]);
    },
  },
});
vm.runInContext(
  `
    let abilityScore = null;
    let placementCompleted = false;
    const results = [{}];
    const PLACEMENT_PRACTICE_WORD_COUNT = 10;
    function clampAbility(value) { return Math.max(0, Math.min(1000, value)); }
    function saveAbilityState() {
      placementStateCalls.push(["save", abilityScore, placementCompleted]);
    }
    function renderWordGameLoadingMessage() {
      placementStateCalls.push(["loading"]);
    }
    function beginWordGameRound(mode, target, options) {
      placementStateCalls.push(["begin", mode, target, options]);
    }
    function placementState() {
      return { abilityScore, placementCompleted };
    }
  `,
  placementStateContext,
);
vm.runInContext(
  wordGameSource.slice(placementStateStart, placementStateEnd),
  placementStateContext,
  { filename: "wordGame.js" },
);

placementStateContext.startPlacementPracticeRound(420, {
  calibrate: true,
  beginnerFocus: 0.48,
});
assert.deepEqual(
  JSON.parse(JSON.stringify(placementStateContext.placementState())),
  { abilityScore: 420, placementCompleted: false },
);
assert.deepEqual(trackedEvents.pop(), [
  "tutorial_begin",
  { content_type: "placement", skipped: false, beginner_focus: 0.48 },
]);
placementStateContext.finalizePlacementCompletion(true, false);
assert.equal(placementStateContext.placementState().placementCompleted, false);
placementStateContext.finalizePlacementCompletion(true, true);
assert.equal(placementStateContext.placementState().placementCompleted, true);

vm.runInContext("placementCompleted = false", placementStateContext);
placementStateContext.startPlacementPracticeRound(60, {
  calibrate: false,
  beginnerFocus: 1,
});
assert.equal(placementStateContext.placementState().placementCompleted, true);
assert.deepEqual(trackedEvents.pop(), [
  "tutorial_begin",
  { content_type: "placement", skipped: true, beginner_focus: 1 },
]);

assert.match(
  wordGameSource,
  /if \(!placementCompleted\) \{\s*window\.PlacementTestAPI\?\.start\?\.\(\)/,
);

// Placement now uses the regular mode-aware expectation model. A fast
// correct four-choice answer is intentionally partial evidence, while a
// typed response keeps its full weight because it cannot be a lucky tap.
const abilityUpdateStart = wordGameSource.indexOf("function updateAbilityScore");
const abilityUpdateEnd = wordGameSource.indexOf(
  "function updateGameEnglishTranslationVisibility",
  abilityUpdateStart,
);
assert.notEqual(abilityUpdateStart, -1);
assert.notEqual(abilityUpdateEnd, -1);

const abilityUpdateContext = vm.createContext({ Math, Number, Set });
abilityUpdateContext.window = abilityUpdateContext;
loadWordGamePolicy(root, abilityUpdateContext);
vm.runInContext(
  `
    let abilityScore = 500;
    const ABILITY_MIN = 0;
    const ABILITY_MAX = 1000;
    const ABILITY_LOGISTIC_SCALE = 220;
    const PLACEMENT_CALIBRATION_ANSWER_COUNT = 7;
    const PLACEMENT_CALIBRATION_INITIAL_STEP = 150;
    const PLACEMENT_CALIBRATION_STEP_DECAY = 0.72;
    const PLACEMENT_CALIBRATION_MIN_STEP = 30;
    const PLACEMENT_LIKELY_GUESS_OUTCOME = 0.65;
    let wordGameIsPlacementRound = true;
    let wordGamePlacementCalibrationEnabled = true;
    let wordGamePlacementCalibrationWords = new Set();
    let wordGamePlacementCalibrationStep = PLACEMENT_CALIBRATION_INITIAL_STEP;
    function clampAbility(value) { return Math.max(ABILITY_MIN, Math.min(ABILITY_MAX, value)); }
    function getWordDifficultyAnchor(entry) { return entry.difficulty; }
    function saveAbilityState() {}
    function resetPlacementAbility() {
      abilityScore = 500;
      wordGamePlacementCalibrationWords = new Set();
      wordGamePlacementCalibrationStep = PLACEMENT_CALIBRATION_INITIAL_STEP;
    }
    function currentAbility() { return abilityScore; }
  `,
  abilityUpdateContext,
);
vm.runInContext(
  wordGameSource.slice(abilityUpdateStart, abilityUpdateEnd),
  abilityUpdateContext,
  { filename: "wordGame.js" },
);

const placementWord = { difficulty: 500 };
abilityUpdateContext.updateAbilityScore(
  placementWord,
  true,
  "forward",
  0,
  1,
  { possiblyGuessed: true, wasTyped: false },
);
const fastMultipleChoiceAbility = abilityUpdateContext.currentAbility();
abilityUpdateContext.resetPlacementAbility();
abilityUpdateContext.updateAbilityScore(
  placementWord,
  true,
  "forward",
  0,
  1,
  { possiblyGuessed: false, wasTyped: false },
);
const deliberateMultipleChoiceAbility = abilityUpdateContext.currentAbility();
abilityUpdateContext.resetPlacementAbility();
abilityUpdateContext.updateAbilityScore(
  placementWord,
  true,
  "typed-reverse",
  0,
  1,
  { possiblyGuessed: true, wasTyped: true },
);
const typedAbility = abilityUpdateContext.currentAbility();

assert.ok(deliberateMultipleChoiceAbility > fastMultipleChoiceAbility + 40);
assert.ok(typedAbility > fastMultipleChoiceAbility + 40);

console.log("placement practice-round checks passed");
