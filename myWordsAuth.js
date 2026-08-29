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

  // A resource-exhausted (quota) error means the Firestore SDK already
  // auto-retried the failing transaction several times with backoff. Left
  // alone, every subsequent local edit schedules another transaction that
  // goes through the same retry cycle, hammering an already-over-budget
  // quota and flooding the console. Once that error is seen, pushes are
  // deferred until this cooldown elapses instead of being attempted
  // immediately — the underlying data stays queued (dirty flag/pending
  // patches are untouched) so nothing is lost, it just waits.
  const QUOTA_COOLDOWN_MS = 5 * 60 * 1000;

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
  let progressPushTimeoutId = null;
  let profilePushTimeoutId = null;
  let wasSignedInThisSession = false;
  let quotaCooldownUntil = 0;

  function noteQuotaExhausted() {
    quotaCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
  }

  function isQuotaCoolingDown() {
    return Date.now() < quotaCooldownUntil;
  }

  const SIGN_IN_READY_TITLE =
    "Sign in with Google to sync My Words across devices";
  const SIGN_IN_LOADING_TITLE = "Preparing Google sign-in…";

  // signInWithPopup must run directly inside a trusted click. If the Firebase
  // SDK is first downloaded from that click and the popup starts only after
  // the download promise resolves, installed web apps and stricter mobile
  // browsers treat it as an unsolicited popup and block it. Keep both entry
  // points disabled until Auth is ready so their eventual click can open the
  // Google window synchronously.
  function setSignInControlsReady(isReady) {
    for (const button of [signInButton, signInNudgeSignInButton]) {
      if (!button) continue;
      button.disabled = !isReady;
      button.title = isReady ? SIGN_IN_READY_TITLE : SIGN_IN_LOADING_TITLE;
    }
  }

  setSignInControlsReady(false);

  // An iOS "Add to Home Screen" install (and other installed/standalone
  // PWAs) runs with no real popup window support: signInWithPopup's
  // opener/postMessage channel back to this page never connects, so the
  // sign-in can appear to proceed but onAuthStateChanged here never fires
  // and mergeRemoteData() never runs — My Words, streak, and everything
  // else stay stuck showing only this device's local state indefinitely.
  // signInWithRedirect avoids the popup entirely (a plain top-level
  // navigation this window survives) and works the same everywhere else.
  //
  // navigator.standalone and the display-mode media query both require
  // iOS to recognize apple-mobile-web-app-capable (see index.html) — icons
  // added to the home screen before that tag existed, or other WebKit
  // versions that just lag on this, can still report neither as true even
  // though window.open is just as broken there. manifest.json's start_url
  // tags every home-screen launch with utm_source=pwa as a fallback signal
  // that doesn't depend on iOS reporting standalone status correctly.
  // Captured once, here, while this script's top-level code runs on page
  // load — well before any click could trigger the in-app navigation that
  // rewrites the query string for its own routing and would erase it from
  // the live URL by the time a sign-in click can happen.
  let launchedFromHomeScreen = false;
  try {
    launchedFromHomeScreen =
      new URLSearchParams(window.location.search).get("utm_source") === "pwa";
  } catch (error) {
    // Ignore — falls back to the live standalone checks below.
  }

  // navigator.standalone, display-mode, and manifest-driven start_url are
  // all Safari/W3C-manifest features. Every iOS browser is forced onto
  // Apple's WebKit engine, but only Safari gets the OS-level "true
  // standalone app" container — a Chrome/Firefox/Edge/Opera iOS icon added
  // via "Add to Home Screen" is just a bookmark that reopens in that
  // browser's own UI, so none of the three signals above ever fire for it,
  // and there's no other API to detect "launched from that bookmark"
  // either. Those browsers share Safari's WebKit-level popup restrictions
  // regardless, so signInWithPopup is just as unreliable there — routing
  // them to the redirect flow unconditionally (not only when bookmarked)
  // is the only way to cover the case this can't otherwise detect.
  function isNonSafariIOSBrowser() {
    return /iP(hone|od|ad)/.test(navigator.userAgent) &&
      /CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
  }

  function isStandaloneDisplayMode() {
    return (
      window.navigator.standalone === true ||
      (window.matchMedia?.("(display-mode: standalone)")?.matches ?? false) ||
      launchedFromHomeScreen ||
      isNonSafariIOSBrowser()
    );
  }

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
  // The my-words/word-strength/favorite-stories keys are read from their
  // owning modules (loaded earlier — see index.html) rather than duplicated
  // as literals, so a future rename there can't silently stop being cleared
  // here. The remaining keys belong to modules that load after this one
  // (wordGame.js, streak.js), so those stay literal.
  const LOCAL_USER_DATA_KEYS = [
    window.MyWordsAPI.STORAGE_KEY,
    window.WordStrengthAPI.STORAGE_KEY,
    "norwegian-dictionary-streak-v1",
    "norwegian-dictionary-ability-v1",
    "norwegian-dictionary-game-level-v1",
    "norwegian-dictionary-daily-practice-v2",
    "norwegian-dictionary-best-word-streak-v1",
    window.StoryFavoritesAPI.STORAGE_KEY,
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
      authReadyPromise = loadFirebaseScripts()
        .then(() => {
          if (typeof firebase === "undefined") {
            throw new Error("Firebase failed to load.");
          }
          initAuth();
        })
        .catch((error) => {
          // Permit a later retry after a transient network/CDN failure.
          authReadyPromise = null;
          throw error;
        });
    }

    return authReadyPromise;
  }

  function prepareAuth() {
    setSignInControlsReady(false);
    return ensureAuthReady()
      .then(() => {
        setSignInControlsReady(true);
      })
      .catch((error) => {
        console.warn("Google sign-in could not be prepared.", error);
        // Leave the controls disabled: clicking an unprepared control would
        // only recreate the browser-blocked delayed-popup behavior.
      });
  }

  function getUserDocRef(userId) {
    return db.collection("myWordsUsers").doc(userId);
  }

  function getProgressShardsRef(userId) {
    return getUserDocRef(userId).collection("progressShards");
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

  const inFlightWrites = new Set();
  let pendingShardPatches = {};
  let pendingProfile = {};
  let progressBatchesInFlight = 0;
  let abilityCloudPending = false;
  let abilityRevision = 0;
  const LAST_USER_ID_KEY = "norwegian-dictionary-last-user-id-v1";
  const PROGRESS_DIRTY_KEY_PREFIX = "norwegian-dictionary-progress-dirty-v2:";
  const GUEST_PROGRESS_DIRTY_KEY =
    "norwegian-dictionary-guest-progress-dirty-v2";

  function rememberedUserId() {
    try {
      return localStorage.getItem(LAST_USER_ID_KEY);
    } catch (error) {
      return null;
    }
  }

  function setProgressDirty(userId, isDirty) {
    try {
      const key = userId
        ? PROGRESS_DIRTY_KEY_PREFIX + userId
        : GUEST_PROGRESS_DIRTY_KEY;
      if (isDirty) localStorage.setItem(key, "1");
      else localStorage.removeItem(key);
    } catch (error) {
      // Best effort. Explicit sign-out still awaits in-memory writes.
    }
  }

  function isProgressDirty(userId) {
    try {
      return (
        localStorage.getItem(PROGRESS_DIRTY_KEY_PREFIX + userId) === "1" ||
        localStorage.getItem(GUEST_PROGRESS_DIRTY_KEY) === "1"
      );
    } catch (error) {
      return true;
    }
  }

  function clearProgressDirty(userId) {
    setProgressDirty(userId, false);
    try {
      localStorage.removeItem(GUEST_PROGRESS_DIRTY_KEY);
    } catch (error) {
      // Best effort; a stale flag only causes one extra full merge.
    }
  }

  function mergeStrengthRecord(localValue, remoteValue) {
    return (
      window.SpacedRepetition?.mergeRecordValues?.(localValue, remoteValue) ??
      (window.ProgressSharding.getStrengthTimestamp(remoteValue) >
      window.ProgressSharding.getStrengthTimestamp(localValue)
        ? remoteValue
        : localValue)
    );
  }

  function trackWrite(promise, failureLabel) {
    let tracked;
    tracked = promise
      .then((value) => {
        clearSyncStatusError();
        return value;
      })
      .catch((error) => {
        console.warn(failureLabel, error);
        showSyncStatusError();
        if (error?.code === "resource-exhausted") {
          noteQuotaExhausted();
        }
        throw error;
      })
      .finally(() => inFlightWrites.delete(tracked));
    inFlightWrites.add(tracked);
    // Timer/pagehide callers cannot await. This prevents an unhandled
    // rejection while flushPendingPushes() and explicit sign-out still can.
    tracked.catch(() => {});
    return tracked;
  }

  function pushShardPatchNow(userId, shardId, patch) {
    const shardRef = getProgressShardsRef(userId).doc(shardId);
    return trackWrite(
      db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(shardRef);
        const current = snapshot.exists
          ? window.ProgressSharding.parsePayload(snapshot.data().payload)
          : window.ProgressSharding.emptyPayload();
        const merged = window.ProgressSharding.mergePayload(
          current,
          patch,
          mergeStrengthRecord,
        );
        transaction.set(
          shardRef,
          {
            schemaVersion: window.ProgressSharding.SCHEMA_VERSION,
            // A JSON string deliberately prevents Firestore from indexing a
            // field for every vocabulary entry inside the payload.
            payload: window.ProgressSharding.serializePayload(merged),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }),
      "Progress could not be synced.",
    );
  }

  function drainPendingShardPatches(userId) {
    const patches = pendingShardPatches;
    pendingShardPatches = {};
    if (!userId || Object.keys(patches).length === 0) return Promise.resolve();
    progressBatchesInFlight++;
    return Promise.all(
      Object.entries(patches).map(([shardId, patch]) =>
        pushShardPatchNow(userId, shardId, patch),
      ),
    )
      .catch((error) => {
        // Keep a retryable copy in memory and the durable dirty marker. Some
        // shards may already have committed, but replaying them is idempotent.
        for (const [shardId, patch] of Object.entries(patches)) {
          pendingShardPatches[shardId] = window.ProgressSharding.mergePayload(
            patch,
            pendingShardPatches[shardId],
            mergeStrengthRecord,
          );
        }
        setProgressDirty(userId, true);
        throw error;
      })
      .finally(() => {
        progressBatchesInFlight--;
      })
      .then(() => {
        if (
          progressBatchesInFlight === 0 &&
          Object.keys(pendingShardPatches).length === 0
        ) {
          clearProgressDirty(userId);
        }
      });
  }

  function scheduleProgressPush(options, { defer = false } = {}) {
    const targetUserId = currentUserId || rememberedUserId();
    setProgressDirty(targetUserId, true);
    if (!currentUserId) return;
    const patches = window.ProgressSharding.buildShardPatches(options);
    for (const [shardId, patch] of Object.entries(patches)) {
      pendingShardPatches[shardId] = window.ProgressSharding.mergePayload(
        pendingShardPatches[shardId],
        patch,
        mergeStrengthRecord,
      );
    }

    if (defer) return;

    const userId = currentUserId;
    window.clearTimeout(progressPushTimeoutId);
    progressPushTimeoutId = window.setTimeout(
      function attemptDrain() {
        if (isQuotaCoolingDown()) {
          progressPushTimeoutId = window.setTimeout(
            attemptDrain,
            QUOTA_COOLDOWN_MS,
          );
          return;
        }
        progressPushTimeoutId = null;
        drainPendingShardPatches(userId).catch(() => {});
      },
      PUSH_DEBOUNCE_MS,
    );
  }

  function pushProfileNow(userId, profile) {
    if (!userId || Object.keys(profile).length === 0) return Promise.resolve();
    return trackWrite(
      getUserDocRef(userId).set(
        {
          ...profile,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
      "Profile progress could not be synced.",
    );
  }

  function pushProfileWithAbilityTracking(userId, profile, revision) {
    return pushProfileNow(userId, profile).then((value) => {
      if (
        Object.prototype.hasOwnProperty.call(profile, "abilityScore") &&
        revision === abilityRevision
      ) {
        abilityCloudPending = false;
      }
      return value;
    });
  }

  // Ability, streak, and daily-quest updates all happen while a round
  // summary is being assembled. Combining partials here makes that one
  // Firestore write instead of three independent writes.
  function scheduleProfilePush(partial) {
    if (!currentUserId) return;
    if (Object.prototype.hasOwnProperty.call(partial, "abilityScore")) {
      abilityCloudPending = true;
      abilityRevision++;
    }
    pendingProfile = { ...pendingProfile, ...partial };
    const userId = currentUserId;
    window.clearTimeout(profilePushTimeoutId);
    profilePushTimeoutId = window.setTimeout(
      function attemptPush() {
        if (isQuotaCoolingDown()) {
          profilePushTimeoutId = window.setTimeout(
            attemptPush,
            QUOTA_COOLDOWN_MS,
          );
          return;
        }
        profilePushTimeoutId = null;
        const profile = pendingProfile;
        pendingProfile = {};
        const revision = abilityRevision;
        pushProfileWithAbilityTracking(userId, profile, revision).catch(() => {
          pendingProfile = { ...profile, ...pendingProfile };
        });
      },
      PUSH_DEBOUNCE_MS,
    );
  }

  // Explicit sign-out awaits this function. A pagehide can only make a
  // best-effort start, but still bypasses the debounce window.
  async function flushPendingPushes() {
    const userId = currentUserId;
    if (!userId) return;

    window.clearTimeout(progressPushTimeoutId);
    window.clearTimeout(profilePushTimeoutId);
    progressPushTimeoutId = null;
    profilePushTimeoutId = null;

    const writes = [...inFlightWrites];
    if (Object.keys(pendingShardPatches).length > 0) {
      writes.push(drainPendingShardPatches(userId));
    }
    if (Object.keys(pendingProfile).length > 0) {
      const profile = pendingProfile;
      pendingProfile = {};
      writes.push(
        pushProfileWithAbilityTracking(userId, profile, abilityRevision).catch(
          (error) => {
            pendingProfile = { ...profile, ...pendingProfile };
            throw error;
          },
        ),
      );
    }

    const results = await Promise.allSettled(writes);
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPendingPushes();
    }
  });
  window.addEventListener("pagehide", flushPendingPushes);

  let unsubscribeRealtimeSync = null;
  let unsubscribeProgressSync = null;
  const PROGRESS_CURSOR_KEY_PREFIX =
    "norwegian-dictionary-progress-cursor-v2:";

  function loadProgressCursor(userId) {
    try {
      const value = Number(localStorage.getItem(PROGRESS_CURSOR_KEY_PREFIX + userId));
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch (error) {
      return 0;
    }
  }

  function saveProgressCursor(userId, value) {
    if (!Number.isFinite(value) || value <= 0) return;
    try {
      localStorage.setItem(PROGRESS_CURSOR_KEY_PREFIX + userId, String(value));
    } catch (error) {
      // Best effort; losing the cursor only causes a full shard read next time.
    }
  }

  function timestampMillis(value) {
    return typeof value?.toMillis === "function" ? value.toMillis() : 0;
  }

  function applyProgressSnapshots(userId, snapshots) {
    const payloads = [];
    let newestTimestamp = loadProgressCursor(userId);
    snapshots.forEach((snapshot) => {
      if (!snapshot.exists || snapshot.metadata?.hasPendingWrites) return;
      const data = snapshot.data();
      payloads.push(window.ProgressSharding.parsePayload(data.payload));
      newestTimestamp = Math.max(newestTimestamp, timestampMillis(data.updatedAt));
    });
    if (payloads.length === 0) return newestTimestamp;

    const progress = window.ProgressSharding.combineShardDocuments(
      payloads,
      mergeStrengthRecord,
    );
    window.MyWordsAPI?.reconcileEntryIds?.(
      progress.entryIds,
      progress.entryTimestamps,
    );
    window.WordStrengthAPI?.mergeAll?.(progress.strengths);
    saveProgressCursor(userId, newestTimestamp);
    return newestTimestamp;
  }

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
  function attachRealtimeSync(userId, cursor = loadProgressCursor(userId)) {
    unsubscribeRealtimeSync?.();
    unsubscribeProgressSync?.();

    unsubscribeRealtimeSync = getUserDocRef(userId).onSnapshot(
      (snapshot) => {
        if (userId !== currentUserId) {
          return; // Stale listener from a previous sign-in.
        }

        if (!snapshot.exists || snapshot.metadata.hasPendingWrites) {
          return;
        }

        const data = snapshot.data();

        if (Number.isFinite(data.abilityScore) && !abilityCloudPending) {
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

        if (Number.isFinite(data.bestWordStreak)) {
          window.BestWordStreakAPI?.replaceState?.(data.bestWordStreak);
        }

        if (typeof data.showEnglish === "boolean") {
          window.EnglishVisibilityAPI?.replaceState?.(data.showEnglish);
        }

        if (typeof data.favoriteStoriesPayload === "string") {
          window.StoryFavoritesAPI?.reconcile?.(data.favoriteStoriesPayload);
        }
      },
      (error) => {
        console.warn("Live sync for My Words was interrupted.", error);
      },
    );

    // Re-open from one millisecond before the persisted high-water mark.
    // This may re-read a shard at the boundary but cannot miss two server
    // timestamps that happened inside the same millisecond.
    let query = getProgressShardsRef(userId);
    if (cursor > 0) {
      query = query.where(
        "updatedAt",
        ">",
        firebase.firestore.Timestamp.fromMillis(Math.max(0, cursor - 1)),
      );
    }
    unsubscribeProgressSync = query.onSnapshot(
      (snapshot) => {
        if (userId !== currentUserId) return;
        applyProgressSnapshots(
          userId,
          snapshot.docChanges().map((change) => change.doc),
        );
      },
      (error) => console.warn("Live progress sync was interrupted.", error),
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
      const mergedStoryFavoritesPayload =
        window.StoryFavoritesAPI?.reconcile?.(
          remoteData.favoriteStoriesPayload,
        ) ?? window.StoryFavoritesAPI?.getPayload?.();

      const hasShardedProgress =
        remoteData.progressSchemaVersion >= window.ProgressSharding.SCHEMA_VERSION;
      const storedCursor = loadProgressCursor(userId);
      const progressDirty = isProgressDirty(userId);
      let shardQuery = getProgressShardsRef(userId);
      if (hasShardedProgress && storedCursor > 0 && !progressDirty) {
        shardQuery = shardQuery.where(
          "updatedAt",
          ">",
          firebase.firestore.Timestamp.fromMillis(Math.max(0, storedCursor - 1)),
        );
      }
      const shardSnapshot = await shardQuery.get();
      const shardPayloads = shardSnapshot.docs.map((document) =>
        window.ProgressSharding.parsePayload(document.data().payload),
      );
      let newestCursor = storedCursor;
      shardSnapshot.docs.forEach((document) => {
        newestCursor = Math.max(
          newestCursor,
          timestampMillis(document.data().updatedAt),
        );
      });

      // Version-1 progress lived in two large fields on the profile doc.
      // Fold it into the same merge input until migration has committed.
      const legacyEntryIds = Array.isArray(remoteData.entryIds)
        ? remoteData.entryIds
        : [];
      const legacyEntryTimestamps =
        remoteData.entryTimestamps &&
        typeof remoteData.entryTimestamps === "object"
          ? remoteData.entryTimestamps
          : {};
      const legacyStrengths =
        remoteData.wordStrengths && typeof remoteData.wordStrengths === "object"
          ? remoteData.wordStrengths
          : {};
      const normalizedLegacyTimestamps = { ...legacyEntryTimestamps };
      legacyEntryIds.forEach((entryId) => {
        if (!Number.isFinite(normalizedLegacyTimestamps[entryId])) {
          normalizedLegacyTimestamps[entryId] = 0;
        }
      });
      const legacyPatches = window.ProgressSharding.buildShardPatches({
        entryIds: legacyEntryIds,
        entryTimestamps: normalizedLegacyTimestamps,
        strengths: legacyStrengths,
      });
      const remoteProgress = window.ProgressSharding.combineShardDocuments(
        [...shardPayloads, ...Object.values(legacyPatches)],
        mergeStrengthRecord,
      );

      const reconciledEntries = window.MyWordsAPI?.reconcileEntryIds?.(
        remoteProgress.entryIds,
        remoteProgress.entryTimestamps,
      ) ?? {
        entryIds: window.MyWordsAPI?.getEntryIds?.() ?? [],
        entryTimestamps: window.MyWordsAPI?.getEntryTimestamps?.() ?? {},
      };

      const remoteStrengths = remoteProgress.strengths;
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

      // A personal-best record, same "only ever grows" shape as streak's
      // longestCount — the higher of the two devices' values is always the
      // more complete one.
      const mergedBestWordStreak = Math.max(
        Number(remoteData.bestWordStreak) || 0,
        window.BestWordStreakAPI?.getState?.() ?? 0,
      );

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
      window.BestWordStreakAPI?.replaceState?.(mergedBestWordStreak);
      window.EnglishVisibilityAPI?.replaceState?.(mergedShowEnglish);

      // First use of the sharded format on an account/browser seeds the
      // merged local state. Later sessions read and write only changed
      // shards, which is the normal low-usage path.
      if (!hasShardedProgress || storedCursor === 0 || progressDirty) {
        const mergedPatches = window.ProgressSharding.buildShardPatches({
          entryIds: reconciledEntries.entryIds,
          entryTimestamps: reconciledEntries.entryTimestamps,
          strengths: mergedStrengths,
        });
        await Promise.all(
          Object.entries(mergedPatches).map(([shardId, patch]) =>
            pushShardPatchNow(userId, shardId, patch),
          ),
        );
        clearProgressDirty(userId);
      }

      if (!hasShardedProgress) {
        // Only declare migration complete after every shard write succeeds.
        // Deleting these two legacy fields prevents the root document from
        // continuing to approach Firestore's 1 MiB document ceiling.
        await trackWrite(
          getUserDocRef(userId).set(
            {
              progressSchemaVersion: window.ProgressSharding.SCHEMA_VERSION,
              entryIds: firebase.firestore.FieldValue.delete(),
              entryTimestamps: firebase.firestore.FieldValue.delete(),
              wordStrengths: firebase.firestore.FieldValue.delete(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          ),
          "Progress migration could not be finalized.",
        );
      }

      await pushProfileNow(userId, {
        ...(mergedAbility !== null && mergedAbility !== undefined
          ? {
              abilityScore: mergedAbility,
              placementCompleted: mergedPlacementCompleted,
            }
          : {}),
        streak: mergedStreak,
        dailyPractice: mergedDailyPractice,
        bestWordStreak: mergedBestWordStreak,
        showEnglish: mergedShowEnglish,
        ...(typeof mergedStoryFavoritesPayload === "string"
          ? { favoriteStoriesPayload: mergedStoryFavoritesPayload }
          : {}),
      });
      saveProgressCursor(userId, newestCursor);
      return newestCursor;
    } catch (error) {
      console.warn("Your saved words could not be loaded from your account.", error);
      return loadProgressCursor(userId);
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

  function rememberSignedInState(isSignedIn, userId = null) {
    try {
      if (isSignedIn) {
        localStorage.setItem(WAS_SIGNED_IN_KEY, "1");
        if (userId) localStorage.setItem(LAST_USER_ID_KEY, userId);
      } else {
        localStorage.removeItem(WAS_SIGNED_IN_KEY);
        localStorage.removeItem(LAST_USER_ID_KEY);
      }
    } catch (error) {
      // Best-effort only — worst case, Firebase loads on click instead of
      // automatically restoring the session next visit.
    }
  }

  // Shared by both the popup's resolved result and the redirect result
  // picked up after the page comes back from Google — same funnel-tracking
  // moment either way, as opposed to onAuthStateChanged firing again for a
  // returning session.
  function trackSignInResult(result) {
    const isNewUser = Boolean(result?.additionalUserInfo?.isNewUser);
    window.trackEvent?.(isNewUser ? "sign_up" : "login", {
      method: "Google",
    });
    // Retain the existing event during migration so current reports do
    // not break while the recommended GA4 events begin collecting.
    window.trackEvent?.("sign_in_completed", { is_new_user: isNewUser });
  }

  function triggerSignIn() {
    if (isStandaloneDisplayMode()) {
      // The redirect itself navigates this window away immediately; the
      // result is collected by getRedirectResult() in initAuth() on the
      // next load, not from this promise.
      return auth.signInWithRedirect(provider).catch((error) => {
        console.warn("Google sign-in failed.", error);
        window.alert("Google sign-in failed. Please try again.");
      });
    }

    return auth
      .signInWithPopup(provider)
      .then((result) => {
        trackSignInResult(result);
      })
      .catch((error) => {
        if (error?.code !== "auth/popup-closed-by-user") {
          console.warn("Google sign-in failed.", error);
          window.alert("Google sign-in failed. Please try again.");
        }
      });
  }

  function handleInteractiveSignIn(source, button) {
    window.trackEvent?.("sign_in_started", { source });
    button.disabled = true;

    // Auth is prepared before either sign-in control is enabled. Keeping this
    // guard makes a future markup/state regression fail safely without trying
    // to open a delayed popup outside the user gesture.
    if (!auth) {
      console.warn("Google sign-in was clicked before Auth was ready.");
      prepareAuth();
      return;
    }

    // Deliberately invoked synchronously from the click handler. Do not put an
    // SDK-loading promise before this call: browsers would block the popup.
    triggerSignIn().finally(() => {
      button.disabled = false;
    });
  }

  // Runs once, after the SDK scripts have finished loading.
  function initAuth() {
    firebase.initializeApp(FIREBASE_CONFIG);

    auth = firebase.auth();
    db = firebase.firestore();
    provider = new firebase.auth.GoogleAuthProvider();

    // Local development talks to a local Firestore emulator instead of the
    // real project, so testing/reloading never touches the production
    // account's free-tier quota. Auth stays real (Google sign-in still works
    // normally); only Firestore reads/writes are redirected. useEmulator
    // must be called before any other Firestore operation, which this is —
    // nothing above touches `db`.
    if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      db.useEmulator("localhost", 8080);
      console.info(
        "Firestore: using local emulator (localhost:8080) — run `npm run emulators` if it's not already running.",
      );
    }

    // Completes the signInWithRedirect flow started in triggerSignIn() for
    // standalone/installed PWAs. onAuthStateChanged below fires with the
    // signed-in user regardless of whether this resolves — it only exists
    // to keep sign-in analytics tracking at parity with the popup path.
    auth
      .getRedirectResult()
      .then((result) => {
        if (result?.user) {
          trackSignInResult(result);
        }
      })
      .catch((error) => {
        console.warn("Google sign-in failed.", error);
        window.alert("Google sign-in failed. Please try again.");
      });

    signOutButton?.addEventListener("click", async () => {
      window.trackEvent?.("sign_out");
      signOutButton.disabled = true;
      try {
        await flushPendingPushes();
        await auth.signOut();
      } catch (error) {
        console.warn("Sign-out failed.", error);
        window.alert(
          "Your latest progress could not be synced, so you have not been signed out. Please check your connection and try again.",
        );
        signOutButton.disabled = false;
      }
    });

    auth.onAuthStateChanged(async (user) => {
      currentUserId = user ? user.uid : null;
      updateAuthUI(user);
      rememberSignedInState(Boolean(user), user?.uid);

      if (user) {
        wasSignedInThisSession = true;
        const cursor = await mergeRemoteData(user.uid);
        if (currentUserId === user.uid) {
          attachRealtimeSync(user.uid, cursor);
        }
      } else {
        unsubscribeRealtimeSync?.();
        unsubscribeProgressSync?.();
        unsubscribeRealtimeSync = null;
        unsubscribeProgressSync = null;

        if (wasSignedInThisSession) {
          wasSignedInThisSession = false;
          clearLocalUserDataAndReload();
        }
      }
    });
  }

  signInButton?.addEventListener("click", () => {
    handleInteractiveSignIn("header", signInButton);
  });

  let wasSignedInBefore = false;
  try {
    wasSignedInBefore = localStorage.getItem(WAS_SIGNED_IN_KEY) === "1";
  } catch (error) {
    // Ignore — falls back to loading on click, same as a first-time visitor.
  }

  if (wasSignedInBefore) {
    // Returning users restore immediately. First-time visitors wait until the
    // initial page has loaded, then prepare Auth in the background so their
    // eventual click still retains its browser user-activation permission.
    prepareAuth();
  } else if (document.readyState === "complete") {
    prepareAuth();
  } else {
    window.addEventListener("load", prepareAuth, { once: true });
  }

  // Fired by wordList.js's saveMyWordsEntryIds() whenever My Words changes.
  window.addEventListener("my-words:updated", (event) => {
    if (event.detail?.syncRemote === false) {
      return;
    }

    scheduleProgressPush({
      entryIds: event.detail?.entryIds ?? [],
      entryTimestamps: event.detail?.entryTimestamps ?? {},
      changedEntryIds: event.detail?.changedEntryIds,
    });
  });

  // Fired by wordList.js's saveWordStrengths() whenever word strength changes.
  window.addEventListener("word-strength:updated", (event) => {
    if (event.detail?.syncRemote === false) {
      return;
    }

    scheduleProgressPush(
      {
        strengths: event.detail?.strengths ?? {},
        changedStrengthIds: event.detail?.changedEntryIds,
      },
      { defer: event.detail?.deferRemote === true },
    );
  });

  // Fired by storyFavorites.js after a local toggle or when a newer local
  // tombstone needs to repair stale account data from another device.
  window.addEventListener("story-favorites:updated", (event) => {
    if (
      event.detail?.syncRemote === false ||
      typeof event.detail?.payload !== "string"
    ) {
      return;
    }

    scheduleProfilePush({ favoriteStoriesPayload: event.detail.payload });
  });

  window.addEventListener("progress:round-complete", () => {
    if (!currentUserId || Object.keys(pendingShardPatches).length === 0) return;
    if (isQuotaCoolingDown()) return; // Stays queued; the debounce timer will retry.
    window.clearTimeout(progressPushTimeoutId);
    progressPushTimeoutId = null;
    drainPendingShardPatches(currentUserId).catch(() => {});
  });

  // Fired by wordGame.js's saveAbilityState() whenever the ability score
  // (or placement-completed flag) changes.
  window.addEventListener("ability:updated", (event) => {
    if (event.detail?.syncRemote === false) {
      if (event.detail?.cloudPending === true) {
        abilityCloudPending = true;
        abilityRevision++;
      }
      return;
    }

    if (!Number.isFinite(event.detail?.score)) {
      return;
    }

    scheduleProfilePush({
      abilityScore: event.detail.score,
      placementCompleted: Boolean(event.detail.placementCompleted),
    });
  });

  // Fired by streak.js's saveStreakState() whenever the streak changes.
  window.addEventListener("streak:updated", (event) => {
    if (event.detail?.syncRemote === false) {
      return;
    }

    scheduleProfilePush({ streak: event.detail?.streak ?? {} });
  });

  // Fired by wordGame.js's saveDailyPracticeState() whenever quest progress
  // changes.
  window.addEventListener("daily-quest:updated", (event) => {
    if (event.detail?.syncRemote === false) {
      return;
    }

    scheduleProfilePush({ dailyPractice: event.detail?.dailyPractice ?? {} });
  });

  // Fired by wordGame.js's saveBestWordStreakState() whenever a new
  // personal-best correct-answer streak is reached.
  window.addEventListener("best-word-streak:updated", (event) => {
    if (event.detail?.syncRemote === false) {
      return;
    }

    if (!Number.isFinite(event.detail?.longest)) {
      return;
    }

    scheduleProfilePush({ bestWordStreak: event.detail.longest });
  });

  // Fired by englishVisibility.js's setEnglishVisible() whenever the
  // show/hide-English preference changes.
  window.addEventListener("english-visibility:updated", (event) => {
    if (event.detail?.syncRemote === false) {
      return;
    }

    scheduleProfilePush({
      showEnglish: Boolean(event.detail?.isEnglishVisible),
    });
  });

  signInNudgeDismissButton?.addEventListener("click", () => {
    window.trackEvent?.("sign_in_nudge_dismissed");
    dismissSignInNudge();
  });

  signInNudgeSignInButton?.addEventListener("click", () => {
    window.trackEvent?.("sign_in_nudge_clicked");
    dismissSignInNudge();
    handleInteractiveSignIn("nudge", signInNudgeSignInButton);
  });

  // Called by wordGame.js after the first completed round — the moment a
  // signed-out visitor first has something (a streak, saved words) worth
  // protecting from a cleared cache.
  window.SignInNudgeAPI = Object.freeze({
    maybeShow: maybeShowSignInNudge,
  });
})();
