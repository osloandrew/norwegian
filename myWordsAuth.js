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

  const PUSH_DEBOUNCE_MS = 800;

  const isFirebaseConfigured =
    Boolean(FIREBASE_CONFIG.apiKey) && FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";

  const signInButton = document.getElementById("google-signin-btn");
  const signOutButton = document.getElementById("google-signout-btn");
  const userInfo = document.getElementById("auth-user-info");
  const userAvatar = document.getElementById("auth-user-avatar");
  const userName = document.getElementById("auth-user-name");

  if (!isFirebaseConfigured || typeof firebase === "undefined") {
    console.warn(
      "My Words sync is disabled: add your Firebase config to myWordsAuth.js.",
    );

    if (signInButton) {
      signInButton.disabled = true;
      signInButton.title = "Google sign-in is not configured yet.";
    }

    return;
  }

  firebase.initializeApp(FIREBASE_CONFIG);

  const auth = firebase.auth();
  const db = firebase.firestore();
  const provider = new firebase.auth.GoogleAuthProvider();

  let currentUserId = null;
  let pushTimeoutId = null;
  let strengthPushTimeoutId = null;

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

  function schedulePush(entryIds) {
    if (!currentUserId) {
      return;
    }

    window.clearTimeout(pushTimeoutId);
    pushTimeoutId = window.setTimeout(() => {
      pushEntryIdsNow(currentUserId, entryIds);
    }, PUSH_DEBOUNCE_MS);
  }

  function scheduleStrengthPush(strengths) {
    if (!currentUserId) {
      return;
    }

    window.clearTimeout(strengthPushTimeoutId);
    strengthPushTimeoutId = window.setTimeout(() => {
      pushWordStrengthsNow(currentUserId, strengths);
    }, PUSH_DEBOUNCE_MS);
  }

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

      window.MyWordsAPI?.replaceEntryIds?.(mergedEntryIds);
      window.WordStrengthAPI?.replaceAll?.(mergedStrengths);

      pushEntryIdsNow(userId, mergedEntryIds);
      pushWordStrengthsNow(userId, mergedStrengths);
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

  signInButton?.addEventListener("click", () => {
    auth.signInWithPopup(provider).catch((error) => {
      if (error?.code !== "auth/popup-closed-by-user") {
        console.warn("Google sign-in failed.", error);
        window.alert("Google sign-in failed. Please try again.");
      }
    });
  });

  signOutButton?.addEventListener("click", () => {
    auth.signOut().catch((error) => {
      console.warn("Sign-out failed.", error);
    });
  });

  auth.onAuthStateChanged((user) => {
    currentUserId = user ? user.uid : null;
    updateAuthUI(user);

    if (user) {
      mergeRemoteData(user.uid);
    }
  });

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
})();
