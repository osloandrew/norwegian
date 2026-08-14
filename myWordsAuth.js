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
  const FIREBASE_SCRIPT_URLS = [
    "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js",
    "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js",
  ];
  const WAS_SIGNED_IN_KEY = "norwegian-dictionary-was-signed-in-v1";

  const PUSH_DEBOUNCE_MS = 800;

  const isFirebaseConfigured =
    Boolean(FIREBASE_CONFIG.apiKey) && FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";

  const signInButton = document.getElementById("google-signin-btn");
  const signOutButton = document.getElementById("google-signout-btn");
  const userInfo = document.getElementById("auth-user-info");
  const userAvatar = document.getElementById("auth-user-avatar");
  const userName = document.getElementById("auth-user-name");

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
  let levelPushTimeoutId = null;

  function loadFirebaseScripts() {
    return FIREBASE_SCRIPT_URLS.reduce(
      (chain, src) =>
        chain.then(
          () =>
            new Promise((resolve, reject) => {
              const script = document.createElement("script");
              script.src = src;
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

  // {merge:true} is required on every write below: entryIds and
  // wordStrengths are pushed independently (different events, different
  // debounce timers), and without merge each write would silently wipe
  // out whichever field it doesn't mention.
  function pushEntryIdsNow(userId, entryIds) {
    getUserDocRef(userId)
      .set(
        {
          entryIds,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .catch((error) => {
        console.warn("My Words could not be synced.", error);
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
      .catch((error) => {
        console.warn("Word strength could not be synced.", error);
      });
  }

  function pushGameLevelNow(userId, level) {
    getUserDocRef(userId)
      .set(
        {
          gameLevel: level,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .catch((error) => {
        console.warn("Game level could not be synced.", error);
      });
  }

  // Debounced writes need their latest pending value kept around outside
  // the setTimeout closure, so a flush (tab hidden/closed before the 800ms
  // fires) can push it immediately instead of losing it.
  let pendingEntryIds = null;
  let pendingStrengths = null;
  let pendingLevel = null;

  function schedulePush(entryIds) {
    if (!currentUserId) {
      return;
    }

    pendingEntryIds = entryIds;
    window.clearTimeout(pushTimeoutId);
    pushTimeoutId = window.setTimeout(() => {
      pushTimeoutId = null;
      pendingEntryIds = null;
      pushEntryIdsNow(currentUserId, entryIds);
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

  function scheduleLevelPush(level) {
    if (!currentUserId) {
      return;
    }

    pendingLevel = level;
    window.clearTimeout(levelPushTimeoutId);
    levelPushTimeoutId = window.setTimeout(() => {
      levelPushTimeoutId = null;
      pendingLevel = null;
      pushGameLevelNow(currentUserId, level);
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
      pushEntryIdsNow(currentUserId, pendingEntryIds);
      pendingEntryIds = null;
    }

    if (strengthPushTimeoutId !== null) {
      window.clearTimeout(strengthPushTimeoutId);
      strengthPushTimeoutId = null;
      pushWordStrengthsNow(currentUserId, pendingStrengths);
      pendingStrengths = null;
    }

    if (levelPushTimeoutId !== null) {
      window.clearTimeout(levelPushTimeoutId);
      levelPushTimeoutId = null;
      pushGameLevelNow(currentUserId, pendingLevel);
      pendingLevel = null;
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPendingPushes();
    }
  });
  window.addEventListener("pagehide", flushPendingPushes);

  // Union the words already saved on this device with whatever is saved
  // under the signed-in account, then treat that union as the new truth
  // both locally and remotely. Word strength isn't a set, so instead of a
  // union each word takes the higher of its local/remote value, so
  // progress made on either device survives the merge.
  //
  // Known limitation: there's no realtime listener, so two devices signed
  // in at once each debounce-push their whole wordStrengths map and the
  // last write wins for any word touched on both — acceptable for now.
  async function mergeRemoteData(userId) {
    try {
      const snapshot = await getUserDocRef(userId).get();
      const remoteData = snapshot.exists ? snapshot.data() : {};

      const remoteEntryIds = Array.isArray(remoteData.entryIds)
        ? remoteData.entryIds
        : [];
      const localEntryIds = window.MyWordsAPI?.getEntryIds?.() ?? [];
      const mergedEntryIds = Array.from(
        new Set([...remoteEntryIds, ...localEntryIds]),
      );

      const remoteStrengths =
        remoteData.wordStrengths && typeof remoteData.wordStrengths === "object"
          ? remoteData.wordStrengths
          : {};
      const localStrengths = window.WordStrengthAPI?.getAll?.() ?? {};
      const mergedStrengths = {};

      for (const entryId of new Set([
        ...Object.keys(remoteStrengths),
        ...Object.keys(localStrengths),
      ])) {
        mergedStrengths[entryId] = Math.max(
          remoteStrengths[entryId] ?? 0,
          localStrengths[entryId] ?? 0,
        );
      }

      // Level is a single ordinal value, not a set or a per-word map — merge
      // by taking whichever of local/remote represents more progress.
      const levelOrder = window.WordGameHelpers?.getLevelOrder?.() ?? [
        "A1",
        "A2",
        "B1",
        "B2",
        "C",
      ];
      const localLevel = window.WordGameHelpers?.getCurrentLevel?.() ?? "A1";
      const remoteLevel =
        typeof remoteData.gameLevel === "string" ? remoteData.gameLevel : "A1";
      const mergedLevel =
        levelOrder.indexOf(remoteLevel) > levelOrder.indexOf(localLevel)
          ? remoteLevel
          : localLevel;

      window.MyWordsAPI?.replaceEntryIds?.(mergedEntryIds);
      window.WordStrengthAPI?.replaceAll?.(mergedStrengths);
      window.WordGameHelpers?.replaceLevel?.(mergedLevel);

      pushEntryIdsNow(userId, mergedEntryIds);
      pushWordStrengthsNow(userId, mergedStrengths);
      pushGameLevelNow(userId, mergedLevel);
    } catch (error) {
      console.warn("Your saved words could not be loaded from your account.", error);
    }
  }

  function updateAuthUI(user) {
    if (user) {
      signInButton?.classList.add("hidden");
      userInfo?.classList.remove("hidden");

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
    return auth.signInWithPopup(provider).catch((error) => {
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
      auth.signOut().catch((error) => {
        console.warn("Sign-out failed.", error);
      });
    });

    auth.onAuthStateChanged((user) => {
      currentUserId = user ? user.uid : null;
      updateAuthUI(user);
      rememberSignedInState(Boolean(user));

      if (user) {
        mergeRemoteData(user.uid);
      }
    });
  }

  signInButton?.addEventListener("click", () => {
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

    schedulePush(event.detail?.entryIds ?? []);
  });

  // Fired by wordList.js's saveWordStrengths() whenever word strength changes.
  window.addEventListener("word-strength:updated", (event) => {
    if (event.detail?.syncRemote === false) {
      return;
    }

    scheduleStrengthPush(event.detail?.strengths ?? {});
  });

  // Fired by wordGame.js's saveGameLevel() whenever the CEFR level changes.
  window.addEventListener("game-level:updated", (event) => {
    if (event.detail?.syncRemote === false) {
      return;
    }

    scheduleLevelPush(event.detail?.level ?? "A1");
  });
})();
