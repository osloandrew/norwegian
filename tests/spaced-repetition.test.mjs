import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({ console, Date, Math, Number, Object, Set });
context.window = context;

vm.runInContext(
  fs.readFileSync(path.join(root, "spacedRepetition.js"), "utf8"),
  context,
  { filename: "spacedRepetition.js" },
);

const scheduler = context.SpacedRepetition;
const NOW = Date.UTC(2026, 7, 16, 12);
const DAY = scheduler.DAY_MS;

// Legacy scalar strengths retain approximate maturity but are due once,
// because version 1 never recorded when the learner last saw them.
const legacyMastered = scheduler.normalizeRecord(5, NOW);
assert.equal(legacyMastered.state, "review");
assert.equal(legacyMastered.stabilityDays, 30);
assert.equal(legacyMastered.dueAt, NOW);
assert.equal(scheduler.getSnapshot(legacyMastered, NOW).queue, "due");

const legacyFailed = scheduler.normalizeRecord(0, NOW);
assert.equal(legacyFailed.state, "relearning");
assert.equal(scheduler.getSnapshot(legacyFailed, NOW).queue, "relearning");

// New knowledge enters a one-day learning step, then graduates to a longer
// review interval only after another due success.
const firstSuccess = scheduler.recordResult(null, true, NOW);
assert.equal(firstSuccess.state, "learning");
assert.equal(firstSuccess.dueAt, NOW + DAY);
assert.equal(scheduler.getSnapshot(firstSuccess, NOW).strength, 1);
assert.equal(scheduler.getSnapshot(firstSuccess, NOW).queue, "scheduled");
assert.equal(scheduler.getSnapshot(firstSuccess, NOW + DAY).queue, "due");

const secondSuccess = scheduler.recordResult(firstSuccess, true, NOW + DAY);
assert.equal(secondSuccess.state, "review");
assert.equal(secondSuccess.stabilityDays, 3);
assert.equal(secondSuccess.dueAt, NOW + 4 * DAY);

// Visible strength is time-sensitive rather than permanent.
const freshStrength = scheduler.getSnapshot(secondSuccess, NOW + DAY).strength;
const forgottenStrength = scheduler.getSnapshot(
  secondSuccess,
  NOW + 120 * DAY,
).strength;
assert.ok(forgottenStrength < freshStrength);

// A lapse becomes a durable, timestamped relearning record and is due after
// the short retry delay. A successful retry returns only to learning.
const lapseTime = NOW + 5 * DAY;
const lapsed = scheduler.recordResult(secondSuccess, false, lapseTime);
assert.equal(lapsed.state, "relearning");
assert.equal(lapsed.lapses, 1);
assert.equal(lapsed.dueAt, lapseTime + scheduler.RELEARNING_DELAY_MS);
assert.equal(
  scheduler.getSnapshot(lapsed, lapsed.dueAt - 1).queue,
  "scheduled",
);
assert.equal(scheduler.getSnapshot(lapsed, lapsed.dueAt).queue, "relearning");

const repaired = scheduler.recordResult(lapsed, true, lapsed.dueAt);
assert.equal(repaired.state, "learning");
assert.ok(repaired.stabilityDays <= 3);

// Device reconciliation follows the newest answer, not the highest historic
// score. Thus a later lapse survives an older mastered copy.
const olderMastery = {
  ...secondSuccess,
  stabilityDays: 30,
  dueAt: NOW + 30 * DAY,
  updatedAt: NOW + DAY,
};
const newerLapse = {
  ...lapsed,
  updatedAt: NOW + 5 * DAY,
};
const merged = scheduler.mergeRecordValues(olderMastery, newerLapse, NOW);
assert.equal(merged.state, "relearning");
assert.equal(merged.updatedAt, newerLapse.updatedAt);

// A structured record also wins over an unmigrated scalar from an older
// client, regardless of that scalar's nominal strength.
const structuredWins = scheduler.mergeRecordValues(newerLapse, 5, NOW);
assert.equal(structuredWins.state, "relearning");
assert.equal(structuredWins.updatedAt, newerLapse.updatedAt);

console.log("spaced-repetition tests passed");
