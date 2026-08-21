(function () {
  "use strict";

  /**
   * Fill these in with your Firebase project's config, from:
   * Firebase console > Project settings > General > Your apps > SDK setup and configuration.
   * These values are public client identifiers, not secrets, so it's fine to commit them.
   */
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBd9EhUlq-TuBD_EpB1amqK1CqJFS50Nz4",
    authDomain: "norwegian-dictionary-71da6.firebaseapp.com",
    projectId: "norwegian-dictionary-71da6",
  };

  // The Firebase SDK (~3 blocking scripts) is only needed by the minority of
  // visitors who actually sign in. Loading it eagerly on every pageview was
  // blocking initial paint for everyone else. Instead it's fetched lazily,
  // either on the first click of "Sign in" or, for someone who has signed in
  // on this browser before, immediately on load so their session still
  // restores silently like it used to.
  // SRI hashes pin these to the exact bytes served for 10.14.1 at the time
  // they were added, so a compromised/altered CDN response fails to load
  // rather than running unverified code. Bump both the version in the URL
  // and its hash together if this ever gets upgraded.
  const FIREBASE_SCRIPT_URLS = [
    {
      src: "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js",
      integrity:
        "sha384-ZaR6mWzmJtrRibZ1Vm7SoHFr8OXjyAuGAXalGDKqbxFT18oi/z+oZLIRFkpeNor1",
    },
    {
      src: "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js",
      integrity:
        "sha384-I1LYojsZ5RM1cOda44Z2h42Qa6YfsQ1XkXxREnhp4ueYBR/4d1pG1K+NZM537Vsj",
    },
    {
      src: "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js",
      integrity:
        "sha384-Ke0FJhH7LyRqDxZ0wt+/OXV38yfQVu7g9VPEEGjYmB4RVOY/ta04uecRhsMwT7V3",
    },
  ];
  const WAS_SIGNED_IN_KEY = "norwegian-dictionary-was-signed-in-v1";
  // Superseded by SIGNIN_NUDGE_STATE_KEY below, which tracks re-nudging by
  // milestone instead of a single ever-shown flag — read once, at startup,
  // purely to migrate a visitor who already saw the old one-shot nudge (see
  // loadSignInNudgeState).
  const SIGNIN_NUDGE_SHOWN_KEY = "norwegian-dictionary-signin-nudge-shown-v1";
  const SIGNIN_NUDGE_STATE_KEY = "norwegian-dictionary-signin-nudge-state-v1";

  // Re-nudge thresholds: the nudge originally fired once, ever, after the
  // first completed round. That meant a visitor who dismissed it in their
  // first five minutes — before they had anything worth losing — was never
  // asked again, even after building a real streak or word list. Instead,
  // each dimension has its own milestone ladder; crossing a new rung on
  // either one is a fresh occasion to ask, since it's a fresh amount of
  // progress that's now at risk of being lost to a cleared cache. 1 is the
  // first rung so the original "first completed round" trigger still fires
  // the same as before.
  const SIGNIN_NUDGE_STREAK_MILESTONES = [1, 3, 7, 14, 30, 60, 100];
  const SIGNIN_NUDGE_WORD_COUNT_MILESTONES = [5, 15, 30, 60, 100];
  // Even a new, higher milestone won't re-show the banner sooner than this
  // after it was last shown — otherwise a visitor who happens to cross two
  // thresholds in one sitting (e.g. finishes a round that both extends their
  // streak past 7 and pushes My Words past 15) would see it twice in a row.
  const SIGNIN_NUDGE_MIN_RESHOW_GAP_MS = 3 * 24 * 60 * 60 * 1000;

  const PUSH_DEBOUNCE_MS = 300;

  const isFirebaseConfigured =
    Boolean(FIREBASE_CONFIG.apiKey) && FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";

  const signInButton = document.getElementById("google-signin-btn");
  const signOutButton = document.getElementById("google-signout-btn");
  const userInfo = document.getElementById("auth-user-info");
  const userAvatar = document.getElementById("auth-user-avatar");
  const userName = document.getElementById("auth-user-name");
  const syncStatus = document.getElementById("sync-status");
  const signInNudgeBanner = document.getElementById("signin-nudge-banner");
  const signInNudgeSignInButton = document.getElementById(
    "signin-nudge-signin-btn",
  );
  const signInNudgeDismissButton = document.getElementById(
    "signin-nudge-dismiss-btn",
  );

  if (!isFirebaseConfigured) {
    console.warn(
      "My Words sync is disabled: add your Firebase config to myWordsAuth.js.",
    );

    if (signInButton) {
      signInButton.disabled = true;
      signInButton.title = "Google sign-in is not configured yet.";
    }

    return;
  }

  let auth = null;
  let db = null;
  let provider = null;
  let currentUserId = null;
  let pushTimeoutId = null;
  let strengthPushTimeoutId = null;
  let abilityPushTimeoutId = null;
  let streakPushTimeoutId = null;
  let dailyQuestPushTimeoutId = null;
  let showEnglishPushTimeoutId = null;
  let wasSignedInThisSession = false;

  // Words/streak/ability data saved locally must not leak into whichever
  // account signs in next on a shared device — mergeRemoteData() below
  // unions local state into the new account's cloud doc on next sign-in,
  // so a stale local cache here would silently attribute one person's
  // words/streak to someone else. Cleared only on an actual sign-out
  // (wasSignedInThisSession guards against wiping a guest's local-only
  // progress on a page load where no session was ever established), then
  // the page reloads so every module's in-memory state — streak badge,
  // word list, ability/daily-practice caches — starts clean rather than
  // continuing to display data that's no longer stored.
  const LOCAL_USER_DATA_KEYS = [
    "norwegian-dictionary-my-words-v1",
    "norwegian-dictionary-word-strength-v1",
    "norwegian-dictionary-streak-v1",
    "norwegian-dictionary-ability-v1",
    "norwegian-dictionary-game-level-v1",
    "norwegian-dictionary-daily-practice-v2",
  ];

  function clearLocalUserDataAndReload() {
    try {
      LOCAL_USER_DATA_KEYS.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      // Best-effort only — if storage is unavailable there's nothing to clear.
    }
    window.location.reload();
  }

  function loadFirebaseScripts() {
    return FIREBASE_SCRIPT_URLS.reduce(
      (chain, { src, integrity }) =>
        chain.then(
          () =>
            new Promise((resolve, reject) => {
              const script = document.createElement("script");
              script.src = src;
              script.integrity = integrity;
              script.crossOrigin = "anonymous";
              script.onload = resolve;
              script.onerror = () =>
                reject(new Error(`Failed to load ${src}`));
              document.head.appendChild(script);
            }),
        ),
      Promise.resolve(),
    );
  }

  let authReadyPromise = null;

  // Loads the SDK (once) and wires up auth. Safe to call multiple times —
  // the sign-in click handler and the "was signed in before" auto-load path
  // both call this, and only the first call does any work.
  function ensureAuthReady() {
    if (!authReadyPromise) {
      authReadyPromise = loadFirebaseScripts().then(() => {
        if (typeof firebase === "undefined") {
          throw new Error("Firebase failed to load.");
        }
        initAuth();
      });
    }

    return authReadyPromise;
  }

  function getUserDocRef(userId) {
    return db.collection("myWordsUsers").doc(userId);
  }

  function defaultSignInNudgeState() {
    return {
      highestStreakMilestoneShown: 0,
      highestWordCountMilestoneShown: 0,
      lastShownAt: 0,
    };
  }

  // A visitor who already saw the old one-shot nudge shouldn't immediately
  // see it again just because this shipped — that flag becomes "milestone 1
  // already shown, as of now" (starting the re-show cooldown fresh) rather
  // than being ignored.
  function loadSignInNudgeState() {
    try {
      const stored = localStorage.getItem(SIGNIN_NUDGE_STATE_KEY);
      if (stored) {
        return { ...defaultSignInNudgeState(), ...JSON.parse(stored) };
      }

      if (localStorage.getItem(SIGNIN_NUDGE_SHOWN_KEY) === "1") {
        return {
          ...defaultSignInNudgeState(),
          highestStreakMilestoneShown: 1,
          lastShownAt: Date.now(),
        };
      }
    } catch (error) {
      // Fall through to the default below.
    }

    return defaultSignInNudgeState();
  }

  function saveSignInNudgeState(state) {
    try {
      localStorage.setItem(SIGNIN_NUDGE_STATE_KEY, JSON.stringify(state));
    } catch (error) {
      // Best-effort only — worst case, it re-shows sooner than intended.
    }
  }

  // The highest milestone in `milestones` that `value` has reached, or 0 if
  // none have.
  function highestMilestoneReached(value, milestones) {
    let highest = 0;
    for (const milestone of milestones) {
      if (value >= milestone) highest = milestone;
    }
    return highest;
  }

  // Called after every completed/ended word-game round (see this module's
  // caller in wordGame.js). Shows the "sign in to keep this safe" banner
  // again each time the visitor crosses a new streak or My Words milestone
  // — not just once, ever — since each milestone represents a fresh amount
  // of local-only progress now at risk from a cleared cache. Uses
  // WAS_SIGNED_IN_KEY rather than currentUserId to decide "already signed
  // in" — currentUserId is still null for a moment while a returning user's
  // session silently restores (Firebase loads async), and this avoids
  // nudging them during that window.
  function maybeShowSignInNudge() {
    if (!signInNudgeBanner) {
      return;
    }

    let alreadySignedIn = true;
    let state = defaultSignInNudgeState();
    try {
      alreadySignedIn = localStorage.getItem(WAS_SIGNED_IN_KEY) === "1";
      state = loadSignInNudgeState();
    } catch (error) {
      // If localStorage is unavailable, err toward not nagging.
      return;
    }

    if (alreadySignedIn || currentUserId) {
      return;
    }

    const streakCount = window.StreakAPI?.getState?.()?.count ?? 0;
    const wordCount = window.MyWordsAPI?.getEntryIds?.()?.length ?? 0;
    const streakMilestone = highestMilestoneReached(
      streakCount,
      SIGNIN_NUDGE_STREAK_MILESTONES,
    );
    const wordCountMilestone = highestMilestoneReached(
      wordCount,
      SIGNIN_NUDGE_WORD_COUNT_MILESTONES,
    );
    const reachedNewMilestone =
      streakMilestone > state.highestStreakMilestoneShown ||
      wordCountMilestone > state.highestWordCountMilestoneShown;
    const cooldownElapsed =
      state.lastShownAt === 0 ||
      Date.now() - state.lastShownAt >= SIGNIN_NUDGE_MIN_RESHOW_GAP_MS;

    if (!reachedNewMilestone || !cooldownElapsed) {
      return;
    }

    saveSignInNudgeState({
      highestStreakMilestoneShown: Math.max(
        state.highestStreakMilestoneShown,
        streakMilestone,
      ),
      highestWordCountMilestoneShown: Math.max(
        state.highestWordCountMilestoneShown,
        wordCountMilestone,
      ),
      lastShownAt: Date.now(),
    });

    window.trackEvent?.("sign_in_nudge_shown", {
      streak_milestone: streakMilestone,
      word_count_milestone: wordCountMilestone,
      is_first_time: state.lastShownAt === 0,
    });

    signInNudgeBanner.classList.remove("hidden");
  }

  function dismissSignInNudge() {
    signInNudgeBanner?.classList.add("hidden");
  }

  // Firestore write failures used to be console.warn-only — invisible to
  // the user, who'd have no idea their changes weren't reaching their
  // account. This surfaces a small, non-alarming indicator (nothing is
  // actually lost; localStorage is always the source of truth) and clears
  // itself the moment any write succeeds again.
  let pendingFailureCount = 0;

  function showSyncStatusError() {
    pendingFailureCount++;
    syncStatus?.classList.remove("hidden");
  }

  function clearSyncStatusError() {
    pendingFailureCount = Math.max(0, pendingFailureCount - 1);
    if (pendingFailureCount === 0) {
      syncStatus?.classList.add("hidden");
    }
  }

  // {merge:true} is required on every write below: entryIds and
  // wordStrengths are pushed independently (different events, different
  // debounce timers), and without merge each write would silently wipe
  // out whichever field it doesn't mention.
  function pushEntryIdsNow(userId, entryIds, entryTimestamps) {
    getUserDocRef(userId)
      .set(
        {
          entryIds,
          entryTimestamps: entryTimestamps ?? {},
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .then(clearSyncStatusError)
      .catch((error) => {
        console.warn("My Words could not be synced.", error);
        showSyncStatusError();
      });
  }

  function pushWordStrengthsNow(userId, strengths) {
    getUserDocRef(userId)
      .set(
        {
          wordStrengths: strengths,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .then(clearSyncStatusError)
      .catch((error) => {
        console.warn("Word strength could not be synced.", error);
        showSyncStatusError();
      });
  }

  function pushAbilityNow(userId, score, placementCompleted) {
    getUserDocRef(userId)
      .set(
        {
          abilityScore: score,
          placementCompleted,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .then(clearSyncStatusError)
      .catch((error) => {
        console.warn("Ability score could not be synced.", error);
        showSyncStatusError();
      });
  }

  function pushStreakNow(userId, streak) {
    getUserDocRef(userId)
      .set(
        {
          streak,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .then(clearSyncStatusError)
      .catch((error) => {
        console.warn("Streak could not be synced.", error);
        showSyncStatusError();
      });
  }

  function pushDailyQuestNow(userId, dailyPractice) {
    getUserDocRef(userId)
      .set(
        {
          dailyPractice,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .then(clearSyncStatusError)
      .catch((error) => {
        console.warn("Daily quests could not be synced.", error);
        showSyncStatusError();
      });
  }

  function pushShowEnglishNow(userId, showEnglish) {
    getUserDocRef(userId)
      .set(
        {
          showEnglish,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .then(clearSyncStatusError)
      .catch((error) => {
        console.warn("English visibility could not be synced.", error);
        showSyncStatusError();
      });
  }

  // Debounced writes need their latest pending value kept around outside
  // the setTimeout closure, so a flush (tab hidden/closed before the 800ms
  // fires) can push it immediately instead of losing it.
  let pendingEntryIds = null;
  let pendingEntryTimestamps = null;
  let pendingStrengths = null;
  let pendingAbility = null;
  let pendingStreak = null;
  let pendingDailyQuest = null;
  let pendingShowEnglish = null;

  function schedulePush(entryIds, entryTimestamps) {
    if (!currentUserId) {
      return;
    }

    pendingEntryIds = entryIds;
    pendingEntryTimestamps = entryTimestamps;
    window.clearTimeout(pushTimeoutId);
    pushTimeoutId = window.setTimeout(() => {
      pushTimeoutId = null;
      pendingEntryIds = null;
      pendingEntryTimestamps = null;
      pushEntryIdsNow(currentUserId, entryIds, entryTimestamps);
    }, PUSH_DEBOUNCE_MS);
  }

  function scheduleStrengthPush(strengths) {
    if (!currentUserId) {
      return;
    }

    pendingStrengths = strengths;
    window.clearTimeout(strengthPushTimeoutId);
    strengthPushTimeoutId = window.setTimeout(() => {
      strengthPushTimeoutId = null;
      pendingStrengths = null;
      pushWordStrengthsNow(currentUserId, strengths);
    }, PUSH_DEBOUNCE_MS);
  }

  function scheduleAbilityPush(score, placementCompleted) {
    if (!currentUserId) {
      return;
    }

    pendingAbility = { score, placementCompleted };
    window.clearTimeout(abilityPushTimeoutId);
    abilityPushTimeoutId = window.setTimeout(() => {
      abilityPushTimeoutId = null;
      pendingAbility = null;
      pushAbilityNow(currentUserId, score, placementCompleted);
    }, PUSH_DEBOUNCE_MS);
  }

  function scheduleStreakPush(streak) {
    if (!currentUserId) {
      return;
    }

    pendingStreak = streak;
    window.clearTimeout(streakPushTimeoutId);
    streakPushTimeoutId = window.setTimeout(() => {
      streakPushTimeoutId = null;
      pendingStreak = null;
      pushStreakNow(currentUserId, streak);
    }, PUSH_DEBOUNCE_MS);
  }

  function scheduleDailyQuestPush(dailyPractice) {
    if (!currentUserId) {
      return;
    }

    pendingDailyQuest = dailyPractice;
    window.clearTimeout(dailyQuestPushTimeoutId);
    dailyQuestPushTimeoutId = window.setTimeout(() => {
      dailyQuestPushTimeoutId = null;
      pendingDailyQuest = null;
      pushDailyQuestNow(currentUserId, dailyPractice);
    }, PUSH_DEBOUNCE_MS);
  }

  function scheduleShowEnglishPush(showEnglish) {
    if (!currentUserId) {
      return;
    }

    pendingShowEnglish = showEnglish;
    window.clearTimeout(showEnglishPushTimeoutId);
    showEnglishPushTimeoutId = window.setTimeout(() => {
      showEnglishPushTimeoutId = null;
      pendingShowEnglish = null;
      pushShowEnglishNow(currentUserId, showEnglish);
    }, PUSH_DEBOUNCE_MS);
  }

  // Fires when the tab is backgrounded, closed, or navigated away from —
  // pushes anything still waiting out its debounce instead of risking it
  // being silently dropped if the page never becomes active again.
  function flushPendingPushes() {
    if (!currentUserId) {
      return;
    }

    if (pushTimeoutId !== null) {
      window.clearTimeout(pushTimeoutId);
      pushTimeoutId = null;
      pushEntryIdsNow(currentUserId, pendingEntryIds, pendingEntryTimestamps);
      pendingEntryIds = null;
      pendingEntryTimestamps = null;
    }

    if (strengthPushTimeoutId !== null) {
      window.clearTimeout(strengthPushTimeoutId);
      strengthPushTimeoutId = null;
      pushWordStrengthsNow(currentUserId, pendingStrengths);
      pendingStrengths = null;
    }

    if (abilityPushTimeoutId !== null) {
      window.clearTimeout(abilityPushTimeoutId);
      abilityPushTimeoutId = null;
      pushAbilityNow(
        currentUserId,
        pendingAbility?.score,
        pendingAbility?.placementCompleted,
      );
      pendingAbility = null;
    }

    if (streakPushTimeoutId !== null) {
      window.clearTimeout(streakPushTimeoutId);
      streakPushTimeoutId = null;
      pushStreakNow(currentUserId, pendingStreak);
      pendingStreak = null;
    }

    if (dailyQuestPushTimeoutId !== null) {
      window.clearTimeout(dailyQuestPushTimeoutId);
      dailyQuestPushTimeoutId = null;
      pushDailyQuestNow(currentUserId, pendingDailyQuest);
      pendingDailyQuest = null;
    }

    if (showEnglishPushTimeoutId !== null) {
      window.clearTimeout(showEnglishPushTimeoutId);
      showEnglishPushTimeoutId = null;
      pushShowEnglishNow(currentUserId, pendingShowEnglish);
      pendingShowEnglish = null;
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPendingPushes();
    }
  });
  window.addEventListener("pagehide", flushPendingPushes);

  let unsubscribeRealtimeSync = null;

  // Keeps this tab in sync with changes made on *other* signed-in devices,
  // without waiting for a page reload here. Firestore's own snapshot
  // metadata is what makes this safe against feedback loops: while our own
  // debounced write is still in flight, the snapshot we get back is marked
  // hasPendingWrites:true (it's just our own optimistic local echo) and is
  // skipped; only a server-confirmed snapshot is applied. Applying our own
  // just-confirmed write back to local state is a harmless no-op since the
  // values already match — no extra "is this really a remote change"
  // bookkeeping needed on top of that.
  //
  // entryIds/wordStrengths/abilityScore/streak/dailyPractice are each
  // pushed independently on their own debounce timer, so a snapshot can be
  // server-confirmed for (say) a wordStrengths write while an entryIds
  // change made moments earlier is still sitting unsent in its own 300ms
  // window — that snapshot's entryIds would then be stale. reconcileEntryIds
  // resolves this the same way it resolves the sign-in merge: per-word
  // last-write-wins, so a stale remote snapshot can't stomp a newer local
  // change (and a genuinely newer remote change still wins).
  function attachRealtimeSync(userId) {
    unsubscribeRealtimeSync?.();

    unsubscribeRealtimeSync = getUserDocRef(userId).onSnapshot(
      (snapshot) => {
        if (userId !== currentUserId) {
          return; // Stale listener from a previous sign-in.
        }

        if (!snapshot.exists || snapshot.metadata.hasPendingWrites) {
          return;
        }

        const data = snapshot.data();

        if (Array.isArray(data.entryIds)) {
          window.MyWordsAPI?.reconcileEntryIds?.(
            data.entryIds,
            data.entryTimestamps,
          );
        }

        if (data.wordStrengths && typeof data.wordStrengths === "object") {
          // Merge chronologically instead of replacing local state: a
          // debounced lapse made on this device must not be erased by a
          // server snapshot that still contains an older, stronger record.
          window.WordStrengthAPI?.mergeAll?.(data.wordStrengths);
        }

        if (Number.isFinite(data.abilityScore)) {
          window.WordGameHelpers?.replaceAbility?.(
            data.abilityScore,
            data.placementCompleted,
          );
        }

        if (data.streak && typeof data.streak === "object") {
          window.StreakAPI?.replaceState?.(data.streak);
        }

        if (data.dailyPractice && typeof data.dailyPractice === "object") {
          window.DailyQuestAPI?.replaceState?.(data.dailyPractice);
        }

        if (typeof data.showEnglish === "boolean") {
          window.EnglishVisibilityAPI?.replaceState?.(data.showEnglish);
        }
      },
      (error) => {
        console.warn("Live sync for My Words was interrupted.", error);
      },
    );
  }

  // Reconcile the words already saved on this device with whatever is saved
  // under the signed-in account, using per-word last-write-wins (see
  // reconcileEntryIds in wordList.js) rather than a flat union — a plain
  // union of two id arrays can only ever grow, so it can't represent "this
  // word was removed" and will silently resurrect a word removed on one
  // side just before the other side's stale copy gets merged in. This also
  // runs unconditionally on every sign-in (including a returning user's
  // silent session restore, not just an explicit sign-in click), so it
  // doubles as the retry for any local change made in the brief window
  // before auth finished restoring and schedulePush had a user to push to.
  // Review records merge by their latest answer timestamp; unlike the old
  // Math.max strength merge, this preserves a newer lapse instead of
  // reviving an obsolete mastery score.
  async function mergeRemoteData(userId) {
    try {
      const snapshot = await getUserDocRef(userId).get();
      const remoteData = snapshot.exists ? snapshot.data() : {};

      const remoteEntryIds = Array.isArray(remoteData.entryIds)
        ? remoteData.entryIds
        : [];
      const remoteEntryTimestamps =
        remoteData.entryTimestamps &&
        typeof remoteData.entryTimestamps === "object"
          ? remoteData.entryTimestamps
          : {};
      const reconciledEntries = window.MyWordsAPI?.reconcileEntryIds?.(
        remoteEntryIds,
        remoteEntryTimestamps,
      ) ?? {
        entryIds: window.MyWordsAPI?.getEntryIds?.() ?? [],
        entryTimestamps: window.MyWordsAPI?.getEntryTimestamps?.() ?? {},
      };

      const remoteStrengths =
        remoteData.wordStrengths && typeof remoteData.wordStrengths === "object"
          ? remoteData.wordStrengths
          : {};
      const localStrengths = window.WordStrengthAPI?.getAll?.() ?? {};
      const mergedStrengths =
        window.WordStrengthAPI?.mergeCollections?.(
          localStrengths,
          remoteStrengths,
        ) ?? localStrengths;

      // Ability is a single continuous value, not a set or a per-word map.
      // Prefer whichever side actually has a completed placement over a
      // raw unplaced default; once both are placed (or neither is), take
      // the higher estimate, the same "more progress wins" spirit the old
      // ordinal-level merge used.
      const localAbility = window.WordGameHelpers?.getAbilityScore?.();
      const localPlacementCompleted =
        window.WordGameHelpers?.isPlacementCompleted?.() ?? false;
      const remoteAbility = Number.isFinite(remoteData.abilityScore)
        ? remoteData.abilityScore
        : null;
      const remotePlacementCompleted = Boolean(remoteData.placementCompleted);

      let mergedAbility;
      let mergedPlacementCompleted;

      if (remoteAbility === null) {
        mergedAbility = localAbility;
        mergedPlacementCompleted = localPlacementCompleted;
      } else if (localAbility === null) {
        mergedAbility = remoteAbility;
        mergedPlacementCompleted = remotePlacementCompleted;
      } else if (localPlacementCompleted !== remotePlacementCompleted) {
        mergedAbility = localPlacementCompleted ? localAbility : remoteAbility;
        mergedPlacementCompleted = true;
      } else {
        mergedAbility = Math.max(localAbility, remoteAbility);
        mergedPlacementCompleted = localPlacementCompleted;
      }

      // Streak isn't a set or a max-per-key map either — it's a single
      // running count tied to a specific last-active date, so the side with
      // the more recent lastActiveDate is the one whose count/graceUsed
      // actually reflects reality. "YYYY-MM-DD" strings sort correctly with
      // plain comparison. On a same-day tie, keep the higher count (in case
      // one device already recorded today's activity and the other hasn't)
      // and treat the grace day as spent if either side spent it.
      const remoteStreak =
        remoteData.streak && typeof remoteData.streak === "object"
          ? remoteData.streak
          : {};
      const localStreak = window.StreakAPI?.getState?.() ?? {};
      const remoteLastActive = remoteStreak.lastActiveDate ?? "";
      const localLastActive = localStreak.lastActiveDate ?? "";

      let mergedStreak;

      if (remoteLastActive === localLastActive) {
        mergedStreak = {
          count: Math.max(remoteStreak.count ?? 0, localStreak.count ?? 0),
          lastActiveDate: localLastActive || null,
          graceUsed: Boolean(remoteStreak.graceUsed) || Boolean(localStreak.graceUsed),
        };
      } else if (remoteLastActive > localLastActive) {
        mergedStreak = {
          count: remoteStreak.count ?? 0,
          lastActiveDate: remoteLastActive,
          graceUsed: Boolean(remoteStreak.graceUsed),
        };
      } else {
        mergedStreak = {
          count: localStreak.count ?? 0,
          lastActiveDate: localLastActive || null,
          graceUsed: Boolean(localStreak.graceUsed),
        };
      }

      mergedStreak.longestCount = Math.max(
        remoteStreak.longestCount ?? 0,
        localStreak.longestCount ?? 0,
        mergedStreak.count,
      );

      // Daily quests reset every calendar day, so unlike streak's
      // lastActiveDate comparison, remote progress only counts when it's
      // for *today* — DailyQuestAPI.normalize resets completedRounds to 0
      // for any other date, same as a stale local read would. Within
      // today, completed rounds are earned in order, so the higher count
      // is strictly more progress and always safe to take. gemCounts is a
      // set of lifetime per-gem totals instead (My Stats' "Gems earned"),
      // not scoped to today at all, but the same max-of-both logic still
      // applies per gem type — each count only ever goes up, so the higher
      // of the two devices' counts is always the more complete one.
      const remoteDailyPractice =
        remoteData.dailyPractice && typeof remoteData.dailyPractice === "object"
          ? remoteData.dailyPractice
          : {};
      const localDailyPractice = window.DailyQuestAPI?.getState?.() ?? {
        date: null,
        completedRounds: 0,
        gemCounts: {},
      };
      const normalizedRemoteDailyPractice =
        window.DailyQuestAPI?.normalize?.(remoteDailyPractice) ?? {
          completedRounds: 0,
          gemCounts: {},
        };
      const mergedGemCounts = {};
      for (const reward of new Set([
        ...Object.keys(localDailyPractice.gemCounts ?? {}),
        ...Object.keys(normalizedRemoteDailyPractice.gemCounts ?? {}),
      ])) {
        mergedGemCounts[reward] = Math.max(
          localDailyPractice.gemCounts?.[reward] ?? 0,
          normalizedRemoteDailyPractice.gemCounts?.[reward] ?? 0,
        );
      }
      const mergedDailyPractice =
        window.DailyQuestAPI?.normalize?.({
          date: localDailyPractice.date,
          completedRounds: Math.max(
            localDailyPractice.completedRounds ?? 0,
            normalizedRemoteDailyPractice.completedRounds ?? 0,
          ),
          gemCounts: mergedGemCounts,
        }) ?? localDailyPractice;

      // A plain display preference, not per-word progress, so there's no
      // "more progress wins" comparison to make — whichever side actually
      // has a value in the account doc wins (it reflects a real choice made
      // on some device), falling back to this device's local value only if
      // the account has never recorded one yet.
      const remoteShowEnglish =
        typeof remoteData.showEnglish === "boolean"
          ? remoteData.showEnglish
          : null;
      const mergedShowEnglish =
        remoteShowEnglish === null
          ? (window.EnglishVisibilityAPI?.getState?.() ?? false)
          : remoteShowEnglish;

      // entryIds/entryTimestamps were already reconciled and saved above,
      // via reconcileEntryIds — nothing further to apply here.
      window.WordStrengthAPI?.replaceAll?.(mergedStrengths);
      if (mergedAbility !== null && mergedAbility !== undefined) {
        window.WordGameHelpers?.replaceAbility?.(
          mergedAbility,
          mergedPlacementCompleted,
        );
      }
      window.StreakAPI?.replaceState?.(mergedStreak);
      window.DailyQuestAPI?.replaceState?.(mergedDailyPractice);
      window.EnglishVisibilityAPI?.replaceState?.(mergedShowEnglish);

      pushEntryIdsNow(
        userId,
        reconciledEntries.entryIds,
        reconciledEntries.entryTimestamps,
      );
      pushWordStrengthsNow(userId, mergedStrengths);
      if (mergedAbility !== null && mergedAbility !== undefined) {
        pushAbilityNow(userId, mergedAbility, mergedPlacementCompleted);
      }
      pushStreakNow(userId, mergedStreak);
      pushDailyQuestNow(userId, mergedDailyPractice);
      pushShowEnglishNow(userId, mergedShowEnglish);
    } catch (error) {
      console.warn("Your saved words could not be loaded from your account.", error);
    }
  }

  function updateAuthUI(user) {
    if (user) {
      signInButton?.classList.add("hidden");
      userInfo?.classList.remove("hidden");
      dismissSignInNudge();

      if (userAvatar) {
        userAvatar.src = user.photoURL || "";
        userAvatar.alt = user.displayName || user.email || "Signed in";
      }

      if (userName) {
        userName.textContent = user.displayName || user.email || "Signed in";
      }
    } else {
      signInButton?.classList.remove("hidden");
      userInfo?.classList.add("hidden");
    }
  }

  function rememberSignedInState(isSignedIn) {
    try {
      if (isSignedIn) {
        localStorage.setItem(WAS_SIGNED_IN_KEY, "1");
      } else {
        localStorage.removeItem(WAS_SIGNED_IN_KEY);
      }
    } catch (error) {
      // Best-effort only — worst case, Firebase loads on click instead of
      // automatically restoring the session next visit.
    }
  }

  function triggerSignIn() {
    return auth
      .signInWithPopup(provider)
      .then((result) => {
        // Only reached by an explicit, successful sign-in click (never by
        // the silent session-restore path below, which calls
        // ensureAuthReady() directly without this function) — the actual
        // funnel conversion moment, as opposed to onAuthStateChanged firing
        // again for a returning session.
        window.trackEvent?.("sign_in_completed", {
          is_new_user: Boolean(result?.additionalUserInfo?.isNewUser),
        });
      })
      .catch((error) => {
        if (error?.code !== "auth/popup-closed-by-user") {
          console.warn("Google sign-in failed.", error);
          window.alert("Google sign-in failed. Please try again.");
        }
      });
  }

  // Runs once, after the SDK scripts have finished loading.
  function initAuth() {
    firebase.initializeApp(FIREBASE_CONFIG);

    auth = firebase.auth();
    db = firebase.firestore();
    provider = new firebase.auth.GoogleAuthProvider();

    signOutButton?.addEventListener("click", () => {
      window.trackEvent?.("sign_out");
      auth.signOut().catch((error) => {
        console.warn("Sign-out failed.", error);
      });
    });

    auth.onAuthStateChanged((user) => {
      currentUserId = user ? user.uid : null;
      updateAuthUI(user);
      rememberSignedInState(Boolean(user));

      if (user) {
        wasSignedInThisSession = true;
        mergeRemoteData(user.uid);
        attachRealtimeSync(user.uid);
      } else {
        unsubscribeRealtimeSync?.();
        unsubscribeRealtimeSync = null;

        if (wasSignedInThisSession) {
          wasSignedInThisSession = false;
          clearLocalUserDataAndReload();
        }
      }
    });
  }

  signInButton?.addEventListener("click", () => {
    window.trackEvent?.("sign_in_started", { source: "header" });
    signInButton.disabled = true;

    ensureAuthReady()
      .then(triggerSignIn)
      .catch((error) => {
        console.warn("Google sign-in could not be loaded.", error);
        window.alert("Google sign-in failed. Please try again.");
      })
      .finally(() => {
        signInButton.disabled = false;
      });
  });

  let wasSignedInBefore = false;
  try {
    wasSignedInBefore = localStorage.getItem(WAS_SIGNED_IN_KEY) === "1";
  } catch (error) {
    // Ignore — falls back to loading on click, same as a first-time visitor.
  }

  if (wasSignedInBefore) {
    ensureAuthReady().catch((error) => {
      console.warn("Could not restore your signed-in session.", error);
    });
  }

  // Fired by wordList.js's saveMyWordsEntryIds() whenever My Words changes.
  window.addEventListener("my-words:updated", (event) => {
    if (event.detail?.syncRemote === false) {
      return;
    }

    schedulePush(event.detail?.entryIds ?? [], event.detail?.entryTimestamps ?? {});
  });

  // Fired by wordList.js's saveWordStrengths() whenever word strength changes.
  window.addEventListener("word-strength:updated", (event) => {
    if (event.detail?.syncRemote === false) {
      return;
    }

    scheduleStrengthPush(event.detail?.strengths ?? {});
  });

  // Fired by wordGame.js's saveAbilityState() whenever the ability score
  // (or placement-completed flag) changes.
  window.addEventListener("ability:updated", (event) => {
    if (event.detail?.syncRemote === false) {
      return;
    }

    if (!Number.isFinite(event.detail?.score)) {
      return;
    }

    scheduleAbilityPush(event.detail.score, Boolean(event.detail.placementCompleted));
  });

  // Fired by streak.js's saveStreakState() whenever the streak changes.
  window.addEventListener("streak:updated", (event) => {
    if (event.detail?.syncRemote === false) {
      return;
    }

    scheduleStreakPush(event.detail?.streak ?? {});
  });

  // Fired by wordGame.js's saveDailyPracticeState() whenever quest progress
  // changes.
  window.addEventListener("daily-quest:updated", (event) => {
    if (event.detail?.syncRemote === false) {
      return;
    }

    scheduleDailyQuestPush(event.detail?.dailyPractice ?? {});
  });

  // Fired by englishVisibility.js's setEnglishVisible() whenever the
  // show/hide-English preference changes.
  window.addEventListener("english-visibility:updated", (event) => {
    if (event.detail?.syncRemote === false) {
      return;
    }

    scheduleShowEnglishPush(Boolean(event.detail?.isEnglishVisible));
  });

  signInNudgeDismissButton?.addEventListener("click", () => {
    window.trackEvent?.("sign_in_nudge_dismissed");
    dismissSignInNudge();
  });

  signInNudgeSignInButton?.addEventListener("click", () => {
    window.trackEvent?.("sign_in_nudge_clicked");
    window.trackEvent?.("sign_in_started", { source: "nudge" });
    dismissSignInNudge();
    signInNudgeSignInButton.disabled = true;

    ensureAuthReady()
      .then(triggerSignIn)
      .catch((error) => {
        console.warn("Google sign-in could not be loaded.", error);
        window.alert("Google sign-in failed. Please try again.");
      })
      .finally(() => {
        signInNudgeSignInButton.disabled = false;
      });
  });

  // Called by wordGame.js after the first completed round — the moment a
  // signed-out visitor first has something (a streak, saved words) worth
  // protecting from a cleared cache.
  window.SignInNudgeAPI = Object.freeze({
    maybeShow: maybeShowSignInNudge,
  });
})();
