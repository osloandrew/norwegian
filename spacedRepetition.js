(function () {
  "use strict";

  // A small, deterministic scheduler for durable vocabulary review. The
  // previous implementation stored a timeless integer from 0-5; these
  // records instead keep enough information to answer two separate
  // questions: how stable is this memory, and is it due for retrieval now?
  const STORAGE_VERSION = 2;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const RELEARNING_DELAY_MS = 10 * 60 * 1000;
  const TARGET_RETENTION = 0.9;
  const MIN_STABILITY_DAYS = 0.25;
  const MAX_STABILITY_DAYS = 3650;
  const VALID_STATES = new Set(["learning", "review", "relearning"]);
  const LEGACY_STABILITY_DAYS = [0.25, 1, 3, 7, 15, 30];

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  // How often a word has been missed relative to how often it's actually
  // been tested — a self-correcting ratio, not a raw lifetime lapse count
  // (which only ever grows). A word that struggled early but has since
  // turned around dilutes back below the threshold as successful
  // repetitions accumulate, with no separate "recovered" bookkeeping
  // needed. Below CHRONIC_MIN_REPETITIONS, one early miss out of very few
  // attempts isn't evidence of a real pattern yet.
  const CHRONIC_MIN_REPETITIONS = 5;
  const CHRONIC_LAPSE_RATE = 0.34;

  function isChronicallyStruggling(record) {
    return Boolean(
      record &&
        record.repetitions >= CHRONIC_MIN_REPETITIONS &&
        record.lapses / record.repetitions >= CHRONIC_LAPSE_RATE,
    );
  }

  // Multiplies into how far a correct answer is allowed to grow the review
  // interval. A word at or under the chronic threshold regrows normally
  // (1); climbing further past it regrows more cautiously, down to a floor
  // that still lets a genuinely turned-around word recover given enough
  // consecutive correct answers, just more slowly than an ordinary word
  // would. This is what actually targets a true chronic-miss pattern:
  // `difficulty` alone (see scheduleCorrect below) saturates at its max
  // after only ~6 lapses and stops adding any further resistance, while
  // this keeps scaling with the word's whole lapse history.
  function getChronicGrowthDampening(record) {
    if (!isChronicallyStruggling(record)) return 1;

    const lapseRate = record.lapses / record.repetitions;
    const excess = clamp(
      (lapseRate - CHRONIC_LAPSE_RATE) / (1 - CHRONIC_LAPSE_RATE),
      0,
      1,
    );

    return clamp(1 - excess * 0.5, 0.5, 1);
  }

  function finiteNumber(value, fallback) {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : fallback;
  }

  function isStructuredRecord(value) {
    return Boolean(
      value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        (VALID_STATES.has(value.state) || Number.isFinite(value.dueAt)),
    );
  }

  // Version-1 strengths have no review date. Treat every migrated word as
  // due once, preserving its approximate maturity without pretending it was
  // reviewed today. The first real answer replaces updatedAt=0 with a useful
  // timestamp, so subsequent device merges can be chronological.
  function migrateLegacyStrength(value, now = Date.now()) {
    const strength = Math.round(clamp(finiteNumber(value, 0), 0, 5));
    const stabilityDays = LEGACY_STABILITY_DAYS[strength];

    return {
      state: strength === 0 ? "relearning" : strength === 1 ? "learning" : "review",
      stabilityDays,
      difficulty: clamp(6 - strength * 0.2, 1, 10),
      lastReviewedAt: now,
      dueAt: now,
      repetitions: strength,
      successes: strength,
      lapses: strength === 0 ? 1 : 0,
      updatedAt: 0,
    };
  }

  function normalizeRecord(value, now = Date.now()) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return migrateLegacyStrength(value, now);
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const state = VALID_STATES.has(value.state) ? value.state : "learning";
    const stabilityDays = clamp(
      finiteNumber(value.stabilityDays, 1),
      MIN_STABILITY_DAYS,
      MAX_STABILITY_DAYS,
    );
    const lastReviewedAt = Number.isFinite(value.lastReviewedAt)
      ? Math.max(0, value.lastReviewedAt)
      : null;
    const fallbackDueAt =
      lastReviewedAt === null ? now : lastReviewedAt + stabilityDays * DAY_MS;

    return {
      state,
      stabilityDays,
      difficulty: clamp(finiteNumber(value.difficulty, 5), 1, 10),
      lastReviewedAt,
      dueAt: Math.max(0, finiteNumber(value.dueAt, fallbackDueAt)),
      repetitions: Math.max(0, Math.floor(finiteNumber(value.repetitions, 0))),
      successes: Math.max(0, Math.floor(finiteNumber(value.successes, 0))),
      lapses: Math.max(0, Math.floor(finiteNumber(value.lapses, 0))),
      updatedAt: Math.max(
        0,
        finiteNumber(value.updatedAt, lastReviewedAt ?? 0),
      ),
    };
  }

  function normalizeCollection(records, now = Date.now()) {
    if (!records || typeof records !== "object" || Array.isArray(records)) {
      return {};
    }

    const normalized = {};

    for (const [entryId, value] of Object.entries(records)) {
      const record = normalizeRecord(value, now);

      if (record) {
        normalized[entryId] = record;
      }
    }

    return normalized;
  }

  function cloneRecord(record) {
    return record ? { ...record } : null;
  }

  function cloneCollection(records) {
    return Object.fromEntries(
      Object.entries(records || {}).map(([entryId, record]) => [
        entryId,
        cloneRecord(record),
      ]),
    );
  }

  function getRetrievability(record, now = Date.now()) {
    const normalized = normalizeRecord(record, now);

    if (!normalized || normalized.lastReviewedAt === null) {
      return 0;
    }

    const elapsedDays = Math.max(
      0,
      (now - normalized.lastReviewedAt) / DAY_MS,
    );

    // stabilityDays is the interval at which predicted recall is 90%.
    return clamp(
      Math.pow(TARGET_RETENTION, elapsedDays / normalized.stabilityDays),
      0,
      1,
    );
  }

  function getSnapshot(record, now = Date.now()) {
    const normalized = normalizeRecord(record, now);

    if (!normalized) {
      return {
        record: null,
        queue: "new",
        isDue: false,
        retrievability: 0,
        strength: null,
      };
    }

    const isDue = normalized.dueAt <= now;
    const retrievability = getRetrievability(normalized, now);
    // Stability measures durable maturity; retrievability makes the visible
    // meter fall when a word has not been recalled for a long time.
    const maturity = clamp(
      Math.log2(normalized.stabilityDays + 1) / Math.log2(31),
      0,
      1,
    );
    const strength = Math.round(5 * maturity * retrievability);
    const queue = isDue
      ? normalized.state === "relearning"
        ? "relearning"
        : "due"
      : "scheduled";

    return {
      record: cloneRecord(normalized),
      queue,
      isDue,
      retrievability,
      strength: clamp(strength, 0, 5),
    };
  }

  function scheduleCorrect(record, now) {
    if (!record) {
      return {
        state: "learning",
        stabilityDays: 1,
        difficulty: 5,
        lastReviewedAt: now,
        dueAt: now + DAY_MS,
        repetitions: 1,
        successes: 1,
        lapses: 0,
        updatedAt: now,
      };
    }

    const difficulty = clamp(record.difficulty - 0.15, 1, 10);
    // See getChronicGrowthDampening's own comment for why this exists
    // alongside `difficulty`: difficulty saturates at its ceiling after
    // only ~6 lapses and stops discouraging further growth, while this
    // keeps responding to the word's whole lapse history.
    const dampening = getChronicGrowthDampening(record);
    let state;
    let stabilityDays;

    if (record.state === "relearning") {
      // A successful short retry repairs the lapse but does not restore the
      // old long interval. Tomorrow's retrieval supplies the durable evidence.
      state = "learning";
      stabilityDays = Math.max(1, record.stabilityDays);
    } else if (record.state === "learning") {
      state = "review";
      stabilityDays = Math.max(3, record.stabilityDays * 3) * dampening;
    } else {
      state = "review";
      const elapsedDays =
        record.lastReviewedAt === null
          ? record.stabilityDays
          : Math.max(0, (now - record.lastReviewedAt) / DAY_MS);
      const overdueRatio = elapsedDays / record.stabilityDays;
      const difficultyAdjustment = (5 - difficulty) * 0.12;
      const overdueBonus = clamp(overdueRatio - 1, 0, 2) * 0.15;
      const growthFactor = clamp(
        2.4 + difficultyAdjustment + overdueBonus,
        1.3,
        3.2,
      );

      stabilityDays = Math.max(
        record.stabilityDays + 1,
        record.stabilityDays * growthFactor * dampening,
      );
    }

    stabilityDays = clamp(
      stabilityDays,
      MIN_STABILITY_DAYS,
      MAX_STABILITY_DAYS,
    );

    return {
      ...record,
      state,
      stabilityDays,
      difficulty,
      lastReviewedAt: now,
      dueAt: now + stabilityDays * DAY_MS,
      repetitions: record.repetitions + 1,
      successes: record.successes + 1,
      updatedAt: now,
    };
  }

  function scheduleIncorrect(record, now) {
    const previous =
      record ||
      ({
        state: "learning",
        stabilityDays: MIN_STABILITY_DAYS,
        difficulty: 5,
        lastReviewedAt: null,
        dueAt: now,
        repetitions: 0,
        successes: 0,
        lapses: 0,
        updatedAt: 0,
      });
    const stabilityDays = clamp(
      previous.stabilityDays * 0.35,
      MIN_STABILITY_DAYS,
      MAX_STABILITY_DAYS,
    );

    return {
      ...previous,
      state: "relearning",
      stabilityDays,
      difficulty: clamp(previous.difficulty + 0.8, 1, 10),
      lastReviewedAt: now,
      dueAt: now + RELEARNING_DELAY_MS,
      repetitions: previous.repetitions + 1,
      lapses: previous.lapses + 1,
      updatedAt: now,
    };
  }

  function recordResult(value, isCorrect, now = Date.now()) {
    const record = normalizeRecord(value, now);

    return isCorrect
      ? scheduleCorrect(record, now)
      : scheduleIncorrect(record, now);
  }

  function mergeRecordValues(localValue, remoteValue, now = Date.now()) {
    const localStructured = isStructuredRecord(localValue);
    const remoteStructured = isStructuredRecord(remoteValue);

    // A structured v2 record always contains more reliable evidence than a
    // legacy scalar, whose review time is unknowable.
    if (localStructured !== remoteStructured) {
      return cloneRecord(
        normalizeRecord(localStructured ? localValue : remoteValue, now),
      );
    }

    const local = normalizeRecord(localValue, now);
    const remote = normalizeRecord(remoteValue, now);

    if (!local) return cloneRecord(remote);
    if (!remote) return cloneRecord(local);
    if (local.updatedAt !== remote.updatedAt) {
      return cloneRecord(local.updatedAt > remote.updatedAt ? local : remote);
    }

    // Same-time conflicts are resolved conservatively so a lapse cannot be
    // erased by an equally recent, more optimistic copy.
    if (local.lapses !== remote.lapses) {
      return cloneRecord(local.lapses > remote.lapses ? local : remote);
    }
    if (local.dueAt !== remote.dueAt) {
      return cloneRecord(local.dueAt < remote.dueAt ? local : remote);
    }

    return cloneRecord(
      local.stabilityDays <= remote.stabilityDays ? local : remote,
    );
  }

  function mergeCollections(localRecords, remoteRecords, now = Date.now()) {
    const merged = {};
    const local = localRecords || {};
    const remote = remoteRecords || {};

    for (const entryId of new Set([
      ...Object.keys(local),
      ...Object.keys(remote),
    ])) {
      const record = mergeRecordValues(local[entryId], remote[entryId], now);

      if (record) {
        merged[entryId] = record;
      }
    }

    return merged;
  }

  window.SpacedRepetition = Object.freeze({
    STORAGE_VERSION,
    DAY_MS,
    RELEARNING_DELAY_MS,
    normalizeRecord,
    normalizeCollection,
    cloneRecord,
    cloneCollection,
    getRetrievability,
    getSnapshot,
    recordResult,
    mergeRecordValues,
    mergeCollections,
    isChronicallyStruggling,
  });
})();
