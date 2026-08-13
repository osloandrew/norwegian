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

  function getUserDocRef(userId) {
    return db.collection("myWordsUsers").doc(userId);
  }

  function pushEntryIdsNow(userId, entryIds) {
    getUserDocRef(userId)
      .set({
        entryIds,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      })
      .catch((error) => {
        console.warn("My Words could not be synced.", error);
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

  // Union the words already saved on this device with whatever is saved
  // under the signed-in account, then treat that union as the new truth
  // both locally and remotely.
  async function mergeRemoteEntries(userId) {
    try {
      const snapshot = await getUserDocRef(userId).get();
      const remoteEntryIds = snapshot.exists
        ? snapshot.data().entryIds || []
        : [];
      const localEntryIds = window.MyWordsAPI?.getEntryIds?.() ?? [];
      const mergedEntryIds = Array.from(
        new Set([...remoteEntryIds, ...localEntryIds]),
      );

      window.MyWordsAPI?.replaceEntryIds?.(mergedEntryIds);
      pushEntryIdsNow(userId, mergedEntryIds);
    } catch (error) {
      console.warn("My Words could not be loaded from your account.", error);
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
      mergeRemoteEntries(user.uid);
    }
  });

  // Fired by wordList.js's saveMyWordsEntryIds() whenever My Words changes.
  window.addEventListener("my-words:updated", (event) => {
    if (event.detail?.syncRemote === false) {
      return;
    }

    schedulePush(event.detail?.entryIds ?? []);
  });
})();
