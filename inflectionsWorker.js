// Builds the Norsk Ordbank reverse index (surface form -> dictionary lemma)
// on a background thread, so opening a story or typing a dictionary search
// query — both of which can trigger this ~27k-key build the first time it's
// needed — never compete with the main thread for input handling.
//
// wordClass.js and inflections.js are imported as-is (not duplicated) so
// this stays a single source of truth for the paradigm-building logic; both
// files use `self.X = ...` rather than `window.X = ...` specifically so they
// also work here, where there is no `window`. See inflections.js's
// buildReverseIndexesOffMainThread(), which creates and talks to this
// worker, and falls back to building the index on the main thread if this
// file can't be loaded or throws.
importScripts("wordClass.js", "inflections.js");

self.onmessage = async (event) => {
  try {
    const result = await self.Inflections.computeReverseIndexData(
      event.data?.dictionaryOnlyLemmaKeys,
    );
    self.postMessage(result);
  } catch (error) {
    self.postMessage({ error: String((error && error.message) || error) });
  }
};
