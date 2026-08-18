// Day-streak tracking: how many consecutive calendar days in a row the
// learner has completed at least one word-game round (a bounded round
// finishing, or an infinite round being manually ended — see
// showWordGameRoundSummary() in wordGame.js, the single place that calls
// recordStreakActivity()).
//
// Mirrors wordList.js's wordStrengths pattern: state lives in localStorage
// (always, signed in or not), a CustomEvent fires on every save so
// myWordsAuth.js can sync it to Firestore for signed-in users, and a
// "syncRemote: false" save (used when applying a remote merge/replace)
// skips re-dispatching to avoid writing the same value straight back.
(function () {
  "use strict";

  const STREAK_STORAGE_KEY = "norwegian-dictionary-streak-v1";

  function defaultStreakState() {
    return {
      count: 0,
      longestCount: 0,
      lastActiveDate: null, // "YYYY-MM-DD", local date
      graceUsed: false, // the one free missed-day forgiveness, per streak
    };
  }

  function loadStreakState() {
    try {
      const storedValue = window.localStorage.getItem(STREAK_STORAGE_KEY);

      if (!storedValue) {
        return defaultStreakState();
      }

      const parsedValue = JSON.parse(storedValue);

      return {
        ...defaultStreakState(),
        ...(parsedValue.streak && typeof parsedValue.streak === "object"
          ? parsedValue.streak
          : {}),
      };
    } catch (error) {
      console.warn("Streak could not be loaded.", error);
      return defaultStreakState();
    }
  }

  let streakState = loadStreakState();

  function saveStreakState({ syncRemote = true } = {}) {
    try {
      window.localStorage.setItem(
        STREAK_STORAGE_KEY,
        JSON.stringify({ version: 1, streak: streakState }),
      );
    } catch (error) {
      console.warn("Streak could not be saved.", error);
    }

    updateStreakBadge();

    // Let myWordsAuth.js know the streak changed, so it can sync to
    // Firestore when a user is signed in. syncRemote is false when the
    // change came from a remote merge, to avoid immediately writing it
    // back.
    window.dispatchEvent(
      new CustomEvent("streak:updated", {
        detail: { streak: { ...streakState }, syncRemote },
      }),
    );
  }

  function getLocalDateString(date = new Date()) {
    // Deliberately not toISOString() (UTC-based) — a streak is about the
    // learner's own calendar day, and that shifts near midnight in most
    // timezones if derived from UTC instead of local date parts.
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // Both arguments are "YYYY-MM-DD" local-date strings with no time
  // component. Constructed as UTC midnight purely so the subtraction below
  // is a plain, DST-immune day count — this never touches the *local*
  // meaning of either date, only measures the gap between them.
  function daysBetween(earlierDateString, laterDateString) {
    const [y1, m1, d1] = earlierDateString.split("-").map(Number);
    const [y2, m2, d2] = laterDateString.split("-").map(Number);
    const earlier = Date.UTC(y1, m1 - 1, d1);
    const later = Date.UTC(y2, m2 - 1, d2);

    return Math.round((later - earlier) / 86400000);
  }

  // Called once per completed/ended word-game round. Returns what actually
  // happened so the caller (the round summary screen) can show an
  // appropriate message — e.g. calling out that the grace day was just
  // spent, rather than silently extending the streak.
  function recordStreakActivity() {
    const today = getLocalDateString();

    if (streakState.lastActiveDate === today) {
      // Already played today — nothing changes, just report where things
      // stand (a second round in one day shouldn't double-count).
      return {
        status: "already-counted",
        count: streakState.count,
        longestCount: streakState.longestCount,
      };
    }

    let status;

    if (!streakState.lastActiveDate) {
      streakState.count = 1;
      streakState.graceUsed = false;
      status = "started";
    } else {
      const gap = daysBetween(streakState.lastActiveDate, today);

      if (gap === 1) {
        // Yesterday to today — the ordinary, consecutive case.
        streakState.count += 1;
        status = "extended";
      } else if (gap === 2 && !streakState.graceUsed) {
        // Exactly one day was missed, and the grace day for this streak
        // hasn't been spent yet — the streak survives, retroactively
        // treating the missed day as covered.
        streakState.count += 1;
        streakState.graceUsed = true;
        status = "grace-used";
      } else {
        // Either more than one day was missed, or the grace day was
        // already used earlier in this streak — starts over.
        streakState.count = 1;
        streakState.graceUsed = false;
        status = "reset";
      }
    }

    streakState.lastActiveDate = today;
    streakState.longestCount = Math.max(
      streakState.longestCount,
      streakState.count,
    );

    saveStreakState();

    return {
      status,
      count: streakState.count,
      longestCount: streakState.longestCount,
    };
  }

  // Applied when a remote (Firestore) value should become the local truth
  // — a fresh sign-in merge, or a live update from another signed-in
  // device. Never dispatches back to myWordsAuth.js (syncRemote: false),
  // since the value just came from there.
  function replaceStreakState(remoteState) {
    streakState = { ...defaultStreakState(), ...remoteState };
    saveStreakState({ syncRemote: false });
  }

  function updateStreakBadge() {
    const badge = document.getElementById("streak-badge");
    const countEl = document.getElementById("streak-badge-count");

    if (!badge || !countEl) {
      return;
    }

    if (streakState.count > 0) {
      countEl.textContent = String(streakState.count);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  // Deferred scripts run after the document is fully parsed, so the badge
  // markup in index.html is already present by the time this executes.
  updateStreakBadge();

  window.StreakAPI = Object.freeze({
    getState: () => ({ ...streakState }),
    recordActivity: recordStreakActivity,
    replaceState: replaceStreakState,
  });
})();
