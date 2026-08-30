// Whether Norwegian sentence examples show their English translation. This
// is a single flag shared by Sentence Search, Pronunciation practice, and
// Stories alike (previously each had its own, independent flag, so toggling
// it in one place had no effect on the others). Defaults to visible.
// Persisted to localStorage (always, signed in or not) and, for a signed-in
// user, mirrored to their account by myWordsAuth.js — the same "local
// always, remote when signed in" pattern used for streak/wordStrengths/etc.
const ENGLISH_VISIBLE_STORAGE_KEY = "norwegian-dictionary-show-english-v1";

function loadEnglishVisible() {
  try {
    const storedValue = window.localStorage.getItem(
      ENGLISH_VISIBLE_STORAGE_KEY,
    );
    return storedValue === null ? true : storedValue === "true";
  } catch (error) {
    return true;
  }
}

let isEnglishVisible = loadEnglishVisible();

// The single place that changes isEnglishVisible. Persists locally and
// notifies myWordsAuth.js (via "english-visibility:updated") so it can push
// the change to Firestore for a signed-in user. syncRemote is false when
// applying a value that just came from the account (a remote merge/snapshot),
// so it isn't immediately written straight back.
function setEnglishVisible(value, { syncRemote = true } = {}) {
  isEnglishVisible = Boolean(value);
  try {
    window.localStorage.setItem(
      ENGLISH_VISIBLE_STORAGE_KEY,
      String(isEnglishVisible),
    );
  } catch (error) {
    console.warn("English visibility could not be saved.", error);
  }

  window.dispatchEvent(
    new CustomEvent("english-visibility:updated", {
      detail: { isEnglishVisible, syncRemote },
    }),
  );
}

window.EnglishVisibilityAPI = Object.freeze({
  getState: () => isEnglishVisible,
  replaceState: (value) => setEnglishVisible(value, { syncRemote: false }),
});
