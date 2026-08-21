// Global Variables
let results = [];
// isEnglishVisible/setEnglishVisible live in englishVisibility.js, shared
// with Pronunciation and Stories.
let latestMultipleResults = null;
const resultsContainer = document.getElementById("results-container");

// Numeric rank for sorting/comparing CEFR levels — lower is easier.
// Was previously redeclared locally in two different sort comparators.
const CEFR_ORDER = { A1: 1, A2: 2, B1: 3, B2: 4, C: 5 };

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .toLocaleLowerCase("nb-NO")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createWholeTermRegex(value, flags = "iu") {
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escapeRegExp(value)}(?=$|[^\\p{L}\\p{N}])`,
    flags,
  );
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let wordSearchIndex = createEmptyWordSearchIndex();

function createEmptyWordSearchIndex() {
  return {
    norwegianExact: new Map(),
    englishExact: new Map(),
    norwegianKeyboardTerms: new Map(),
    searchTerms: new Map(),
  };
}

function splitSearchTerms(value) {
  return String(value ?? "")
    .split(",")
    .map(normalizeSearchText)
    .filter(Boolean);
}

function addEntryToSearchIndex(index, term, entry) {
  const entries = index.get(term) || [];
  if (!entries.includes(entry)) entries.push(entry);
  index.set(term, entries);
}

function getNorwegianKeyboardVariants(value) {
  const normalizedValue = normalizeSearchText(value);
  let variants = [""];

  for (const character of normalizedValue) {
    const replacements =
      character === "æ"
        ? ["ae"]
        : character === "ø"
          ? ["o", "oe"]
          : character === "å"
            ? ["a", "aa"]
            : [character];

    variants = variants.flatMap((variant) =>
      replacements.map((replacement) => variant + replacement),
    );
  }

  return [...new Set(variants)].filter(
    (variant) => variant !== normalizedValue,
  );
}

function addNorwegianKeyboardTerm(
  sourceTerm,
  resolvedTerm,
  onlyWhenUnmapped = false,
) {
  getNorwegianKeyboardVariants(sourceTerm).forEach((keyboardTerm) => {
    if (
      onlyWhenUnmapped &&
      wordSearchIndex.norwegianKeyboardTerms.has(keyboardTerm)
    ) {
      return;
    }

    const terms =
      wordSearchIndex.norwegianKeyboardTerms.get(keyboardTerm) || new Set();
    terms.add(resolvedTerm);
    wordSearchIndex.norwegianKeyboardTerms.set(keyboardTerm, terms);
  });
}

function buildWordSearchIndex() {
  wordSearchIndex = createEmptyWordSearchIndex();

  results.forEach((entry) => {
    splitSearchTerms(entry.ord).forEach((term) => {
      addEntryToSearchIndex(wordSearchIndex.norwegianExact, term, entry);
      wordSearchIndex.searchTerms.set(term, 0);

      addNorwegianKeyboardTerm(term, term);
    });

    splitSearchTerms(entry.engelsk).forEach((term) => {
      addEntryToSearchIndex(wordSearchIndex.englishExact, term, entry);
      if (!wordSearchIndex.searchTerms.has(term)) {
        wordSearchIndex.searchTerms.set(term, 1);
      }
    });
  });

}

function hasExactSearchTerm(query) {
  return (
    wordSearchIndex.norwegianExact.has(query) ||
    wordSearchIndex.englishExact.has(query)
  );
}

async function resolveWordSearchQuery(originalQuery, selectedPOS = "") {
  // Resolved unconditionally, even when the query is already a headword in
  // its own right ("gir" is itself a noun) -- otherwise an entry the query
  // only reaches through inflection (present-tense "gir" of the verb "gi")
  // never enters the result set at all, headword or not. Lemmas equal to
  // the query itself are excluded: that's just the query, not a distinct
  // inflection match worth surfacing separately.
  const officialResolution = await window.Inflections?.findLemmas(
    originalQuery,
    selectedPOS,
  );
  const officialLemmas = (officialResolution?.lemmas || []).filter(
    (lemma) => lemma !== originalQuery && wordSearchIndex.norwegianExact.has(lemma),
  );

  if (hasExactSearchTerm(originalQuery)) {
    return {
      query: originalQuery,
      queries: [originalQuery, ...officialLemmas],
      reason: "exact",
      inflectedLemmas: officialLemmas,
    };
  }

  if (officialLemmas.length > 0) {
    return {
      query: officialLemmas[0],
      queries: officialLemmas,
      reason: "word-form",
      inflectedLemmas: officialLemmas,
    };
  }

  const keyboardTerms =
    wordSearchIndex.norwegianKeyboardTerms.get(originalQuery);
  if (keyboardTerms && keyboardTerms.size === 1) {
    const query = [...keyboardTerms][0];
    return { query, queries: [query], reason: "keyboard" };
  }

  return {
    query: originalQuery,
    queries: [originalQuery],
    reason: "unresolved",
  };
}

function hasSearchableCharacters(value) {
  return /[\p{L}\p{N}]/u.test(value);
}

// `inflectedLemmas`, when given, are lemmas the query is a recognized
// inflected form of (see resolveWordSearchQuery) -- a genuine grammatical
// match ("gir" -> the verb "gi"), ranked above generic prefix/substring
// hits but still below the query being a headword outright, since typing
// an exact existing word is the strongest possible signal of intent.
function getSearchMatchRank(entry, query, inflectedLemmas) {
  const norwegianTerms = splitSearchTerms(entry.ord);
  const englishTerms = splitSearchTerms(entry.engelsk);

  if (norwegianTerms.includes(query)) return 0;
  if (inflectedLemmas?.some((lemma) => norwegianTerms.includes(lemma))) return 1;
  if (englishTerms.includes(query)) return 2;
  if (norwegianTerms.some((term) => term.startsWith(query))) return 3;
  if (englishTerms.some((term) => term.startsWith(query))) return 4;
  if (norwegianTerms.some((term) => term.includes(query))) return 5;
  if (englishTerms.some((term) => term.includes(query))) return 6;

  return 7;
}

function compareByCefrThenHeadword(a, b) {
  const cefrDifference = (CEFR_ORDER[a.CEFR] || 99) - (CEFR_ORDER[b.CEFR] || 99);
  if (cefrDifference) return cefrDifference;

  return String(a.ord).localeCompare(String(b.ord), "nb");
}

function compareWordSearchResults(a, b, query, inflectedLemmas) {
  const rankDifference =
    getSearchMatchRank(a, query, inflectedLemmas) -
    getSearchMatchRank(b, query, inflectedLemmas);
  if (rankDifference) return rankDifference;

  return compareByCefrThenHeadword(a, b);
}

function editDistanceWithinLimit(first, second, limit) {
  if (Math.abs(first.length - second.length) > limit) return limit + 1;

  let previous = Array.from({ length: second.length + 1 }, (_, index) => index);

  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    const current = [firstIndex];
    let smallestInRow = current[0];

    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      const substitutionCost =
        first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1;
      current[secondIndex] = Math.min(
        previous[secondIndex] + 1,
        current[secondIndex - 1] + 1,
        previous[secondIndex - 1] + substitutionCost,
      );
      smallestInRow = Math.min(smallestInRow, current[secondIndex]);
    }

    if (smallestInRow > limit) return limit + 1;
    previous = current;
  }

  return previous[second.length];
}

function findClosestSearchTerms(query, limit = 5) {
  // Below 3 characters, near-every indexed term is within edit distance 1,
  // so the scan is both at its most expensive (full pass, few early-outs)
  // and its least useful (too many, too noisy, to be a real suggestion).
  if (query.length < 3 || query.length > 32) return [];

  const maximumDistance = query.length <= 4 ? 1 : 2;
  const candidates = [];

  wordSearchIndex.searchTerms.forEach((languageRank, term) => {
    const distance = editDistanceWithinLimit(query, term, maximumDistance);
    if (distance <= maximumDistance) {
      candidates.push({ term, distance, languageRank });
    }
  });

  return candidates
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.languageRank - b.languageRank ||
        a.term.length - b.term.length ||
        a.term.localeCompare(b.term, "nb"),
    )
    .slice(0, limit)
    .map(({ term }) => term);
}

// Sentence search's own "did you mean" fallback — deliberately a separate
// index scan from findClosestSearchTerms above, rather than reusing the
// dictionary's wordSearchIndex, because a dictionary headword and a token
// that actually appears in the sentence corpus are two different sets: a
// headword can exist with zero example sentences (a suggestion there would
// just bounce back to "no sentences found"), and inflected/informal forms
// show up in real sentences without being a dictionary ord/engelsk entry in
// their own right. Scanning sentenceIndex's own keys guarantees every
// suggestion returned actually has at least one sentence behind it.
function findClosestSentenceTerms(query, limit = 5) {
  if (!sentenceIndex || query.length < 3 || query.length > 32) return [];

  const maximumDistance = query.length <= 4 ? 1 : 2;
  const candidates = [];
  const seenTerms = new Set();

  const scanIndex = (index, languageRank) => {
    index.forEach((_postings, term) => {
      if (seenTerms.has(term)) return;
      const distance = editDistanceWithinLimit(query, term, maximumDistance);
      if (distance <= maximumDistance) {
        seenTerms.add(term);
        candidates.push({ term, distance, languageRank });
      }
    });
  };
  scanIndex(sentenceIndex.norwegian, 0);
  scanIndex(sentenceIndex.english, 1);

  return candidates
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.languageRank - b.languageRank ||
        a.term.length - b.term.length ||
        a.term.localeCompare(b.term, "nb"),
    )
    .slice(0, limit)
    .map(({ term }) => term);
}

// Grammatical-category classification (noun/verb/adjective/... from the
// CSV `gender` field) lives in wordClass.js, loaded before this file — see
// window.WordClass. getWordClassForMetadata treats a bare "noun" value
// (used by a handful of entries with no specific article on file) as a
// noun too; that's a wider definition than WordClass.isNounGender's own,
// deliberately strict one, and was already the convention at this
// specific call site before this file's classifiers were consolidated.
function getWordClassForMetadata(pos = "") {
  const normalizedPOS = WordClass.stripNounPrefix(pos);

  return WordClass.isNounGender(normalizedPOS) || normalizedPOS === "noun"
    ? "noun"
    : normalizedPOS;
}

function findWordEntryForMetadata(word, selectedPOS = "") {
  const normalizedWord = String(word).trim().toLowerCase();

  const normalizedSelectedPOS = WordClass.stripNounPrefix(selectedPOS);

  const wordMatches = results.filter((entry) =>
    String(entry.ord || "")
      .toLowerCase()
      .split(",")
      .map((form) => form.trim())
      .includes(normalizedWord),
  );

  if (!normalizedSelectedPOS) {
    return wordMatches[0] || null;
  }

  const preciseMatch = wordMatches.find((entry) => {
    const entryPOS = WordClass.stripNounPrefix(entry.gender);

    if (normalizedSelectedPOS === "noun") {
      return WordClass.isNounGender(entryPOS);
    }

    return entryPOS === normalizedSelectedPOS;
  });

  return preciseMatch || wordMatches[0] || null;
}

function setWordMetaTag(attributeName, attributeValue, content) {
  let tag = document.head.querySelector(
    `meta[${attributeName}="${attributeValue}"]`,
  );

  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attributeName, attributeValue);
    document.head.appendChild(tag);
  }

  tag.setAttribute("content", content);
}

function setWordCanonicalURL(url) {
  let canonicalLink = document.head.querySelector('link[rel="canonical"]');

  if (!canonicalLink) {
    canonicalLink = document.createElement("link");
    canonicalLink.setAttribute("rel", "canonical");
    document.head.appendChild(canonicalLink);
  }

  canonicalLink.setAttribute("href", url);
}

function updateWordMetadata(entry) {
  if (!entry) {
    return;
  }

  const word = String(entry.ord || "")
    .split(",")[0]
    .trim();

  const canonicalPOS = WordClass.stripNounPrefix(entry.gender);

  const wordClass = getWordClassForMetadata(entry.gender);

  const englishTranslation = String(entry.engelsk || "")
    .replace(/\s+/g, " ")
    .trim();

  const pageTitle =
    `${word}${wordClass ? ` (${wordClass})` : ""} ` +
    "– Norwegian-English Dictionary";

  const wordDescription = wordClass
    ? `${wordClass} "${word}"`
    : `word "${word}"`;

  let description = englishTranslation
    ? `Learn the Norwegian ${wordDescription}, meaning ` +
      `"${englishTranslation}" in English. See definitions, ` +
      "pronunciation, CEFR level, and example sentences."
    : `Learn the Norwegian ${wordDescription}. See definitions, ` +
      "pronunciation, CEFR level, and example sentences.";

  if (description.length > 160) {
    description =
      description
        .slice(0, 157)
        .replace(/\s+\S*$/, "")
        .trimEnd() + "...";
  }

  const canonicalURL = new URL(
    window.location.origin + window.location.pathname,
  );

  canonicalURL.searchParams.set("type", "words");

  if (canonicalPOS) {
    canonicalURL.searchParams.set("pos", canonicalPOS);
  }

  canonicalURL.searchParams.set("word", word);

  const socialImageURL = new URL(
    "Resources/Icons/android-chrome-512x512.png",
    window.location.href,
  ).href;

  document.title = pageTitle;

  setWordMetaTag("name", "description", description);

  setWordMetaTag("property", "og:title", pageTitle);
  setWordMetaTag("property", "og:description", description);
  setWordMetaTag("property", "og:type", "website");
  setWordMetaTag("property", "og:url", canonicalURL.href);
  setWordMetaTag("property", "og:image", socialImageURL);

  setWordCanonicalURL(canonicalURL.href);
}

// --- Sentences index globals ---
let sentenceCorpus = []; // Flat array of { id, no, en, noNorm, enNorm, cefr, audio }
let sentenceIndex = null; // { norwegian: Map, english: Map }
let expressionSentenceCandidateCache = new WeakMap();

// Function to show or hide the landing card
function showLandingCard(show) {
  document.documentElement.classList.toggle("landing", show);

  const landingCard = document.getElementById("landing-card");
  const main = document.querySelector("main");

  if (!landingCard || !main) return;

  if (show) {
    // Move the card back into main, if it’s inside resultsContainer
    if (landingCard.parentNode !== main) {
      landingCard.remove();
      main.insertBefore(
        landingCard,
        document.getElementById("results-container"),
      );
    }
    landingCard.style.display = "block";
    window.DailyQuestAPI?.renderLanding?.();
  } else {
    landingCard.style.display = "none";
  }
}

// Function to navigate back to the landing card when the H1 is clicked
function returnToLandingPage() {
  // Update the URL to the base URL without any query parameters
  const baseUrl = window.location.origin + window.location.pathname;
  window.history.pushState({}, "", baseUrl);
  window.location.reload();
}

// Search only runs on a deliberate submit: the Enter key here, or the
// magnifying-glass button (handleSearchButtonClick).
function handleKey(event) {
  if (event.key !== "Enter") return;
  search();
}

function clearContainer() {
  const landingCard = document.getElementById("landing-card");
  if (landingCard) {
    // Temporarily remove the landing card from the container, then clear everything else
    landingCard.parentNode.removeChild(landingCard);
  }

  resultsContainer.innerHTML = ""; // Clear everything else in the container

  // Restore the landing card
  if (landingCard) {
    resultsContainer.appendChild(landingCard);
  }
}

function appendToContainer(content) {
  resultsContainer.innerHTML += content;
}

function splitIntoSentences(text) {
  if (!text) return [];
  const arr = text.match(/[^.!?]+[.!?]*/g);
  return arr ? arr.map((s) => s.trim()) : [text.trim()];
}

// Filter results based on selected part of speech (POS)
function filterResultsByPOS(results, selectedPOS) {
  if (!selectedPOS) return results;

  return results.filter((r) => WordClass.matchesWordClass(r.gender, selectedPOS));
}

// Clear the search input field
function clearInput(refreshCurrentView = true) {
  const searchEl = document.getElementById("search-bar");

  if (searchEl) {
    searchEl.value = "";
  }

  const typeSelect = document.getElementById("type-select");

  if (typeSelect && typeSelect.value === "stories") {
    const cefrEl = document.getElementById("cefr-select");
    const genreEl = document.getElementById("genre-select");

    if (cefrEl) cefrEl.value = "";
    if (genreEl) genreEl.value = "";

    if (refreshCurrentView) {
      // Clearing filters/search on the Stories tab is the deliberate
      // "give me a fresh draw" gesture (see handleSearchButtonClick below),
      // so it's the one place that should actually reroll the weighted
      // ordering rather than just re-filtering the existing one.
      reshuffleStoryOrder();
      displayStoryList();
    }
  } else if (typeSelect && typeSelect.value === "word-list") {
    renderWordList();
  }
}

// Click handler for the magnifying-glass search button.
function handleSearchButtonClick() {
  const query = document.getElementById("search-bar").value.trim();

  if (query) {
    search();
    return;
  }

  const type = document.getElementById("type-select").value;

  if (type === "word-list") {
    // Nothing to search or randomize here when the field is empty.
    return;
  }

  if (type === "stories") {
    // Same as clicking the clear (X) button: reset the filters and
    // reshuffle the story list, rather than searching for a word.
    clearInput();
    return;
  }

  stopAllAudio();
  randomWord();
  popChime.currentTime = 0;
  popChime.play();
}

// Prefixed: all language-site forks share one origin (osloandrew.github.io),
// so IndexedDB is shared across them too — an unprefixed name here would let
// a visit to another language site overwrite this one's cached data.
const WORD_CSV_DB_NAME = "wordDataCsvNorwegianV2";
const WORD_CSV_DB_STORE = "csv";
const WORD_CSV_DB_KEY = "wordDataCsv";
const WORD_CSV_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours, matching stories.js

// Legacy localStorage keys from before the cache moved to IndexedDB. The CSV
// (now several MB) risked silently exceeding localStorage's much smaller
// quota, so the cache moved somewhere with no realistic size cap. Clear any
// leftover entry once so it doesn't sit around wasting quota that stories.js
// and other features share on this origin.
try {
  localStorage.removeItem("wordDataCsvNorwegianV2");
  localStorage.removeItem("wordDataCsvTimestampNorwegianV2");
} catch (cleanupError) {
  // Ignore — best-effort cleanup only.
}

// On a local dev/test server (not the deployed osloandrew.github.io site),
// always fetch fresh CSV data instead of serving a stale cached copy — the
// whole point of a local test environment is seeing edits to the CSV files
// immediately, not up to 24h later. Duplicated in stories.js since each
// file's cache is otherwise independent.
function isLocalDevHost() {
  return (
    location.hostname === "127.0.0.1" || location.hostname === "localhost"
  );
}

function openWordCSVDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WORD_CSV_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(WORD_CSV_DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Read the cached raw CSV text (not parsed entries — a parsed copy of the
// ~29,000-row dictionary would run several MB larger than the CSV itself
// purely from repeated JSON key names).
// Returns null on a cache miss, a read error, or if the cache is stale.
async function readCachedWordCSV() {
  if (!("indexedDB" in window)) return null;
  if (isLocalDevHost()) return null;

  try {
    const db = await openWordCSVDB();
    const cached = await new Promise((resolve, reject) => {
      const tx = db.transaction(WORD_CSV_DB_STORE, "readonly");
      const request = tx.objectStore(WORD_CSV_DB_STORE).get(WORD_CSV_DB_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();

    if (!cached) return null;
    if (Date.now() - cached.timestamp > WORD_CSV_CACHE_MAX_AGE) return null;

    return cached.text;
  } catch (error) {
    console.warn("Cached word data could not be read.", error);
    return null;
  }
}

// Best-effort only: if this fails (private browsing, disabled storage, etc.)
// the app keeps working, it just re-fetches next time instead of caching.
async function cacheWordCSV(csvText) {
  if (!("indexedDB" in window)) return;

  try {
    const db = await openWordCSVDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(WORD_CSV_DB_STORE, "readwrite");
      tx.objectStore(WORD_CSV_DB_STORE).put(
        { text: csvText, timestamp: Date.now() },
        WORD_CSV_DB_KEY,
      );
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (error) {
    console.warn("Word data could not be cached.", error);
  }
}

// Set when both the local CSV fetch and the Google Sheets fallback have
// failed, so the loading-gate poll (in loadStateFromURL) knows to stop
// waiting forever and show a retry option instead.
let dictionaryLoadFailed = false;

function showDictionaryLoadError() {
  if (document.getElementById("dictionary-load-error")) return;

  const banner = document.createElement("div");
  banner.id = "dictionary-load-error";
  banner.className = "error-message";
  banner.innerHTML = `
    <p>We couldn't load the dictionary. Please check your connection and try again.</p>
    <button type="button" class="landing-card-btn">Retry</button>
  `;
  banner.querySelector("button").addEventListener("click", () => {
    location.reload();
  });

  const main = document.querySelector("main");
  main.insertBefore(banner, main.firstChild.nextSibling);
}

// Fetch the dictionary data from the file or server
async function fetchAndLoadDictionaryData() {
  dictionaryLoadFailed = false;

  const cachedCSV = await readCachedWordCSV();

  if (cachedCSV) {
    parseCSVData(cachedCSV);
    return;
  }

  try {
    const localResponse = await fetch("norwegianWords.csv");
    if (!localResponse.ok)
      throw new Error(`HTTP error! Status: ${localResponse.status}`);
    const localData = await localResponse.text();
    await cacheWordCSV(localData);
    parseCSVData(localData);
  } catch (localError) {
    console.error(
      "Error fetching or parsing data from local CSV file:",
      localError,
    );

    // Fallback to Google Sheets CSV
    try {
      const response = await fetch(
        "https://docs.google.com/spreadsheets/d/e/2PACX-1vSl2GxGiiO3qfEuVM6EaAbx_AgvTTKfytLxI1ckFE6c35Dv8cfYdx30vLbPPxadAjeDaSBODkiMMJ8o/pub?output=csv",
      );
      if (!response.ok)
        throw new Error(`HTTP error! Status: ${response.status}`);
      const data = await response.text();
      parseCSVData(data); // Use PapaParse for CSV parsing
    } catch (googleSheetsError) {
      console.error(
        "Error fetching or parsing data from Google Sheets:",
        googleSheetsError,
      );
      dictionaryLoadFailed = true;
      showDictionaryLoadError();
    }
  }
}

// Parse the CSV data using PapaParse. Runs in a Web Worker by default so
// parsing ~29,000 rows never blocks the main thread/freezes the page.
function parseCSVData(data, options = {}) {
  const useWorker = options.useWorker !== false;

  try {
    Papa.parse(data, {
      header: true,
      skipEmptyLines: true,
      worker: useWorker,
      complete: function (resultsFromParse) {
        const skippedWords = [];
        results = resultsFromParse.data
          .map((entry) => {
            entry.ord = entry.ord.trim(); // Ensure the word is trimmed
            return entry;
          })
          .filter((entry) => {
            if (entry.engelsk && entry.engelsk.trim()) return true;
            skippedWords.push(entry.ord || "(blank)");
            return false;
          });

        if (skippedWords.length) {
          console.warn(
            `Skipped ${skippedWords.length} CSV row(s) with no English translation:`,
            skippedWords,
          );
        }

        // Must run before anything can trigger Inflections' reverse-index
        // build (highlighting, story hints, sentence search) — that index
        // is only ever built once and cached, so a dictionary word with no
        // Norsk Ordbank record needs to be known up front to get an
        // estimated paradigm there too, not just in its own Word Forms
        // table lookup.
        window.Inflections?.registerDictionaryEntries(results);

        buildWordSearchIndex();

        /*
         * Sentence Search already builds these structures on demand.
         * Avoid constructing the entire sentence corpus and search index
         * for visitors who only use words, stories, lists, or the game.
         */
        sentenceCorpus = [];
        sentenceIndex = null;
        expressionSentenceCandidateCache = new WeakMap();
      },
      error: function (error) {
        console.error("Error parsing CSV:", error);

        // A worker runtime failure shouldn't leave the dictionary stuck
        // empty forever — fall back to parsing on the main thread once,
        // the same way this always worked before worker:true existed.
        if (useWorker) {
          console.warn("Retrying CSV parse without a Web Worker.");
          parseCSVData(data, { useWorker: false });
        }
      },
    });
  } catch (parseSetupError) {
    // Papa.parse can throw synchronously if the worker itself couldn't be
    // constructed (e.g. blocked by an extension or an unsupported
    // browser), rather than only reporting failure through the error
    // callback above.
    console.error("Error starting CSV parse:", parseSetupError);

    if (useWorker) {
      console.warn("Retrying CSV parse without a Web Worker.");
      parseCSVData(data, { useWorker: false });
    }
  }
}

function buildSentenceCorpus() {
  sentenceCorpus = [];
  let id = 0;
  for (const r of results) {
    const noList = splitIntoSentences(r.eksempel);
    const enList = splitIntoSentences(r.sentenceTranslation || "");
    const n = Math.max(noList.length, enList.length);
    for (let i = 0; i < n; i++) {
      const no = noList[i] || "";
      const en = enList[i] || "";
      if (!no && !en) continue;
      sentenceCorpus.push({
        id: id++,
        no,
        en,
        noNorm: normalizeSearchText(no),
        enNorm: normalizeSearchText(en),
        cefr: (r.CEFR || "").toUpperCase(),
        audio: r.sentenceAudio === "X",
      });
    }
  }
}

function tokenize(text) {
  // Unicode letters (incl. å, æ, ø). Grabs words like "være", "språk".
  const m = text.match(/\p{L}+/gu);
  return m ? m.map((w) => w.toLowerCase()) : [];
}

function buildSentenceIndex() {
  console.time("[Sentences] build index");
  const addRowTokens = (index, rowId, tokens) => {
    const seen = new Set();
    for (const tok of tokens) {
      if (tok.length === 0) continue;
      if (seen.has(tok)) continue; // avoid dup adds for same row
      seen.add(tok);
      let postings = index.get(tok);
      if (!postings) {
        postings = [];
        index.set(tok, postings);
      }
      postings.push(rowId);
    }
  };

  const idx = { norwegian: new Map(), english: new Map() };
  for (const row of sentenceCorpus) {
    addRowTokens(idx.norwegian, row.id, tokenize(row.noNorm));
    addRowTokens(idx.english, row.id, tokenize(row.enNorm));
  }

  // Optionally compact large postings to typed arrays.
  for (const languageIndex of Object.values(idx)) {
    for (const [key, list] of languageIndex) {
      if (list.length > 1024) {
        languageIndex.set(key, Uint32Array.from(list));
      }
    }
  }
  sentenceIndex = idx;
  console.timeEnd("[Sentences] build index");
}

// Every kind of user feedback — a missing word, a wrong translation, a
// broken audio clip — funnels through this one Google Form field. The
// form itself only has a single short-answer question, so each caller
// packs its context into one readable, self-describing string rather
// than requiring a matching form field to exist for every case.
const FEEDBACK_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdMpnbI2DyUo6SWBRR53ZnYucDPdAYXK9rksP3AhMrC7b91Dw/formResponse";
const FEEDBACK_FORM_FIELD_ID = "entry.279285583";

const FEEDBACK_CATEGORIES = [
  "Norwegian word or spelling",
  "English translation",
  "Part of speech / word class",
  "Word inflections",
  "CEFR level seems wrong",
  "Norwegian example sentence",
  "English sentence translation",
  "Word audio",
  "Sentence audio",
  "Something else",
];

const STORY_FEEDBACK_CATEGORIES = [
  "Norwegian story text",
  "English translation",
  "Story audio",
  "Story image",
  "CEFR level seems wrong",
  "Something else",
];

const GENERAL_FEEDBACK_CATEGORIES = [
  "Bug or technical issue",
  "Feature request or suggestion",
  "Something is confusing",
  "General feedback or compliment",
  "Something else",
];

function submitUserFeedback(message) {
  const formData = new FormData();
  formData.append(FEEDBACK_FORM_FIELD_ID, message);

  return fetch(FEEDBACK_FORM_URL, {
    method: "POST",
    body: formData,
    mode: "no-cors", // Necessary to avoid CORS issues
  });
}

function buildFeedbackMessage({
  source,
  word,
  pos,
  cefr,
  prompt,
  category,
  userAnswer,
  details,
}) {
  const parts = [];

  if (source) {
    parts.push(`[${source}]`);
  }

  if (word) {
    const attributes = [pos, cefr].filter(Boolean).join(", ");
    parts.push(attributes ? `"${word}" (${attributes})` : `"${word}"`);
  }

  if (prompt) {
    // What the learner actually saw and had to translate/complete — the
    // English meaning for a reverse-typed question, or the sentence with
    // its blank for a cloze one. "word" above is the target Norwegian
    // answer, which for a reverse question isn't itself what was shown, so
    // a reviewer judging "should this answer have been accepted" needs
    // this to know what prompted it in the first place.
    parts.push(`— Shown: "${prompt}"`);
  }

  if (category) {
    // "Category" rather than "Issue" — general feedback covers things
    // like feature requests and compliments, not just problems.
    parts.push(`— Category: ${category}`);
  }

  if (userAnswer) {
    parts.push(`— Learner answered: "${userAnswer}"`);
  }

  if (details) {
    parts.push(`— "${details}"`);
  }

  return parts.join(" ");
}

function flagMissingWordEntry(word) {
  // Unlike every other report type, this goes to the form as the bare
  // word — no brackets, category, or quoting — since the form's one
  // field is otherwise treated as a simple "missing word" list.
  submitUserFeedback(word)
    .then(() => {
      alert(`The word "${word}" has been flagged successfully!`);
    })
    .catch((error) => {
      console.error("Error flagging the word:", error);
      alert("There was an issue flagging this word. Please try again later.");
    });
}

// The "no match" branch re-renders #results-container more than once
// (first for the message itself, then again if inexact matches are found),
// which destroys and recreates the flag button each time — so this needs
// to be called again after every re-render, not just once.
function wireFlagMissingWordButton() {
  const flagButton = document.querySelector(".flag-missing-word-btn");
  if (!flagButton) return;

  flagButton.addEventListener("click", () => {
    const searchBar = document.getElementById("search-bar");
    const wordToFlag = searchBar.dataset.originalQuery || searchBar.value;
    flagMissingWordEntry(wordToFlag);
  });
}

function openWordCardFeedbackDialog(
  triggerElement,
  word,
  pos,
  cefr,
  initialCategory,
) {
  openFeedbackDialog({
    source: "Word Card",
    word,
    pos,
    cefr,
    initialCategory,
    triggerElement,
  });
}

// Site-wide feedback, not scoped to any one word/story/question — reachable
// from the footer on every page.
function openGeneralFeedbackDialog(triggerElement) {
  openFeedbackDialog({
    source: "General Feedback",
    categories: GENERAL_FEEDBACK_CATEGORIES,
    dialogTitle: "Share your feedback",
    categoryQuestion: "What's this about?",
    detailsPlaceholder: "Tell us more (optional)",
    successMessage: "Thanks — your feedback was sent.",
    triggerElement,
  });
}

let feedbackDialogTriggerElement = null;

function handleFeedbackDialogKeydown(event) {
  if (event.key === "Escape") {
    closeFeedbackDialog();
  }
}

function closeFeedbackDialog() {
  const overlay = document.querySelector(".feedback-dialog-overlay");
  if (!overlay) return;

  overlay.remove();
  document.removeEventListener("keydown", handleFeedbackDialogKeydown);

  if (
    feedbackDialogTriggerElement &&
    typeof feedbackDialogTriggerElement.focus === "function"
  ) {
    feedbackDialogTriggerElement.focus();
  }
  feedbackDialogTriggerElement = null;
}

// One shared "report an issue" dialog, reused by the word card, the word
// game, and individual stories. `source` identifies where the report came
// from (e.g. "Word Card", "Word Game · Cloze", "Story") and, along with
// `word`/`pos`/`cefr`, is folded into the single message string sent to
// the form. `categories` lets each caller show issue types relevant to
// its own content (a story has no "word audio" to report, for instance).
function openFeedbackDialog({
  source,
  word,
  pos,
  cefr,
  prompt,
  showWordInTitle = true,
  categories = FEEDBACK_CATEGORIES,
  dialogTitle,
  categoryQuestion = "What's the issue?",
  detailsPlaceholder = "What's wrong, exactly?",
  successMessage = "Thanks — your report was sent.",
  initialCategory,
  userAnswer,
  triggerElement,
}) {
  // Only one report dialog should ever be open at a time.
  closeFeedbackDialog();

  feedbackDialogTriggerElement = triggerElement || null;

  const overlay = document.createElement("div");
  overlay.className = "feedback-dialog-overlay";

  const dialog = document.createElement("div");
  dialog.className = "feedback-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "feedback-dialog-title");

  const title = document.createElement("h3");
  title.id = "feedback-dialog-title";
  title.textContent =
    dialogTitle ||
    (word && showWordInTitle
      ? `Report an issue with "${word}"`
      : "Report an issue with this question");
  dialog.appendChild(title);

  const categoryLabel = document.createElement("label");
  categoryLabel.className = "feedback-dialog-label";
  categoryLabel.htmlFor = "feedback-dialog-category";
  categoryLabel.textContent = categoryQuestion;
  dialog.appendChild(categoryLabel);

  const categorySelect = document.createElement("select");
  categorySelect.id = "feedback-dialog-category";
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categorySelect.appendChild(option);
  });
  if (initialCategory && categories.includes(initialCategory)) {
    categorySelect.value = initialCategory;
  }
  dialog.appendChild(categorySelect);

  const detailsLabel = document.createElement("label");
  detailsLabel.className = "feedback-dialog-label";
  detailsLabel.htmlFor = "feedback-dialog-details";
  detailsLabel.textContent = "Details (optional)";
  dialog.appendChild(detailsLabel);

  const detailsTextarea = document.createElement("textarea");
  detailsTextarea.id = "feedback-dialog-details";
  detailsTextarea.rows = 3;
  detailsTextarea.placeholder = detailsPlaceholder;
  dialog.appendChild(detailsTextarea);

  const status = document.createElement("p");
  status.className = "feedback-dialog-status";
  dialog.appendChild(status);

  const actions = document.createElement("div");
  actions.className = "feedback-dialog-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "feedback-dialog-cancel";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", closeFeedbackDialog);

  const submitButton = document.createElement("button");
  submitButton.type = "button";
  submitButton.className = "feedback-dialog-submit";
  submitButton.textContent = "Send";

  submitButton.addEventListener("click", () => {
    const category = categorySelect.value;
    const details = detailsTextarea.value.trim();

    if (category === "Something else" && !details) {
      status.textContent = "Please add a few details.";
      status.classList.add("feedback-dialog-status-error");
      detailsTextarea.focus();
      return;
    }

    submitButton.disabled = true;
    cancelButton.disabled = true;
    status.classList.remove("feedback-dialog-status-error");
    status.textContent = "Sending…";

    submitUserFeedback(
      buildFeedbackMessage({
        source,
        word,
        pos,
        cefr,
        prompt,
        category,
        userAnswer,
        details,
      }),
    )
      .then(() => {
        status.textContent = successMessage;
        setTimeout(closeFeedbackDialog, 1400);
      })
      .catch((error) => {
        console.error("Error sending feedback:", error);
        status.textContent = "Something went wrong. Please try again.";
        status.classList.add("feedback-dialog-status-error");
        submitButton.disabled = false;
        cancelButton.disabled = false;
      });
  });

  actions.appendChild(cancelButton);
  actions.appendChild(submitButton);
  dialog.appendChild(actions);

  overlay.appendChild(dialog);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeFeedbackDialog();
    }
  });

  document.body.appendChild(overlay);
  document.addEventListener("keydown", handleFeedbackDialogKeydown);

  categorySelect.focus();
}

// Generate and display a random word or sentence
async function randomWord() {
  const now = Date.now();
  const cooldownPeriod = 250; // Cooldown period in milliseconds (0.25 seconds)

  // Initialize lastCallTimestamp as a property of randomWord if it doesn't exist
  if (!randomWord.lastCallTimestamp) {
    randomWord.lastCallTimestamp = 0;
  }

  // Check if enough time has passed since the last call
  if (now - randomWord.lastCallTimestamp < cooldownPeriod) {
    console.warn("Please wait a moment before trying again.");
    return; // Exit the function if the cooldown period hasn't passed
  }

  randomWord.lastCallTimestamp = now; // Update the timestamp for the last call

  const type = document.getElementById("type-select").value;
  const selectedPOS = document.getElementById("pos-select")
    ? document.getElementById("pos-select").value.toLowerCase()
    : "";
  const selectedCEFR = document.getElementById("cefr-select")
    ? document.getElementById("cefr-select").value.toUpperCase()
    : "";

  // Ensure that the 'results' array is populated
  if (!results || !results.length) {
    console.warn("No results available to pick a random word or sentence.");
    document.getElementById("results-container").innerHTML = `
            <div class="definition error-message">
                <h2 class="word-gender">
                    Error <span class="gender">Unavailable Entry</span>
                </h2>
                <p>No random entries available. Please try again later.</p>
            </div>
        `;
    hideSpinner();
    return;
  }

  showSpinner();
  clearInput(); // Clear search bar when generating a random word or sentence
  showLandingCard(false);
  clearContainer();

  let filteredResults;

  if (type === "sentences") {
    // Filter results that contain example sentences (for the 'sentences' type)
    filteredResults = results.filter((r) => r.eksempel); // Assuming sentences are stored under the 'eksempel' key

    // Additionally, filter by the selected CEFR level if applicable
    filteredResults = filteredResults.filter(
      (r) => !selectedCEFR || (r.CEFR && r.CEFR.toUpperCase() === selectedCEFR),
    );
  } else if (type === "pronunciation") {
    initPronunciation();
    hideSpinner();
    return; // ✅ stop here, pronunciation handles itself
  } else {
    // Filter results by the selected part of speech (for 'words' type)
    filteredResults = filterResultsByPOS(results, selectedPOS);

    // Additionally, filter by the selected CEFR level if applicable
    filteredResults = filteredResults.filter(
      (r) => !selectedCEFR || (r.CEFR && r.CEFR.toUpperCase() === selectedCEFR),
    );

    // Exclude certain words here
    filteredResults = filteredResults.filter(
      (r) => !noRandom.includes(r.ord.toLowerCase()),
    );
  }

  if (!filteredResults.length) {
    console.warn("No random entries available for the selected type.");
    document.getElementById("results-container").innerHTML = `
            <div class="definition error-message">
                <h2 class="word-gender">
                    Error <span class="gender">Unavailable Entry</span>
                </h2>
                <p>No random entries available. Try selecting another type or part of speech.</p>
            </div>
        `;
    return;
  }

  // Randomly select a result from the filtered results
  const randomResult =
    filteredResults[Math.floor(Math.random() * filteredResults.length)];

  // Reset old highlights by removing any previous span tags
  randomResult.eksempel = randomResult.eksempel
    ? randomResult.eksempel.replace(/<span[^>]*>(.*?)<\/span>/gi, "$1")
    : "";

  // Generate CEFR label based on the result's CEFR value
  const cefrLabel = getSentenceCefrLabelHTML(randomResult.CEFR);
  if (!cefrLabel) {
    console.warn("CEFR value is missing for this entry:", randomResult);
  }

  if (type === "sentences") {
    // Split the Norwegian and English sentences
    const sentences = randomResult.eksempel.split(/(?<=[.!?])\s+/); // Split by sentence delimiters
    const translations = randomResult.sentenceTranslation
      ? randomResult.sentenceTranslation.split(/(?<=[.!?])\s+/)
      : [];

    // Randomly select one sentence and its translation
    const randomIndex = Math.floor(Math.random() * sentences.length);
    const selectedSentence = sentences[randomIndex];
    const selectedTranslation = translations[randomIndex] || "";

    // Clear any existing highlights in the sentence
    const cleanedSentence = selectedSentence.replace(
      /<span style="color: #1f6fb3;">(.*?)<\/span>/gi,
      "$1",
    );

    // Build the sentence HTML
    let sentenceHTML = `
            <div class="result-header">
                <h2>Random Sentence</h2>
            </div>
            <button class="sentence-btn english-toggle-btn" onclick="toggleEnglishTranslations(this)">
                ${isEnglishVisible ? "Hide English" : "Show English"}
            </button>
            <div class="sentence-container">
                <div lang="nb" class="sentence-box-norwegian ${
                  !isEnglishVisible ? "sentence-box-norwegian-hidden" : ""
                }">
            <div class="sentence-content">
            <div class="cefr-audio-block">
              ${cefrLabel}
              ${
                randomResult.sentenceAudio === "X"
                  ? `<i class="fas fa-volume-up sentence-audio-icon"
                        data-sentence="${cleanedSentence
                          .replace(/<[^>]*>/g, "")
                          .trim()}"></i>`
                  : ""
              }
            </div>
              <p class="sentence">${cleanedSentence}</p>
            </div>
                </div>
        `;

    if (selectedTranslation) {
      sentenceHTML += `
        <div lang="en" class="sentence-box-english ${isEnglishVisible ? "" : "hidden"}">
                    <p class="sentence">${selectedTranslation}</p>
                </div>
            `;
    }
    sentenceHTML += "</div>"; // Close the sentence-container div
    document.getElementById("results-container").innerHTML = sentenceHTML;
  } else if (type === "pronunciation") {
    initPronunciation();
    hideSpinner();
    return; // ✅ stop here, pronunciation handles itself
  } else {
    // Update the URL to include the random word's info
    updateURL("", type, randomResult.gender, null, randomResult.ord);
    // If it's a word, render it with highlighting (if needed)
    displaySearchResults([randomResult], randomResult.ord);
  }
  hideSpinner(); // Hide the spinner
}

// Perform a search based on the input query and selected POS
async function search(queryOverride = null) {
  const searchInput = document.getElementById("search-bar");
  const rawQuery = queryOverride === null ? searchInput.value : queryOverride;
  const originalQuery = normalizeSearchText(rawQuery);

  document.getElementById("search-bar").dataset.originalQuery = originalQuery;

  const selector = document.getElementById("type-select").value;

  // Word List performs its own search and filtering.
  if (selector === "word-list") {
    const selectedPOS = document.getElementById("pos-select")
      ? document.getElementById("pos-select").value.toLowerCase()
      : "";

    cleanURL("word-list");
    updateURL(originalQuery, "word-list", selectedPOS);
    showLandingCard(false);
    renderWordList();

    return;
  }

  // The search toolbar now only looks disabled after a short grace period
  // (see LOADING_STATE_DELAY_MS in window.onload), so a fast enough
  // interaction — a paste, an Enter key, a very quick typist — can reach
  // here before the dictionary CSV actually finishes loading. Sentences
  // also read from `results`; only Stories has its own independent
  // dataset, so it's excluded here. Without this, an early search would
  // wrongly report "no matches" for a word that just hasn't loaded yet.
  if (selector !== "stories" && (!Array.isArray(results) || results.length === 0)) {
    showLandingCard(false);
    document.getElementById("results-container").innerHTML = `
      <div class="definition">
        <h2>Loading vocabulary</h2>
        <p>The vocabulary data hasn't finished loading yet — try again in a moment.</p>
      </div>
    `;
    return;
  }

  const selectedPOS = document.getElementById("pos-select")
    ? document.getElementById("pos-select").value.toLowerCase()
    : "";
  const wordSearchResolution =
    selector === "words"
      ? await resolveWordSearchQuery(originalQuery, selectedPOS)
      : { query: originalQuery, queries: [originalQuery], reason: "exact" };
  const query = wordSearchResolution.query;
  const selectedCEFR = document.getElementById("cefr-select")
    ? document.getElementById("cefr-select").value.toUpperCase()
    : ""; // Fetch the selected CEFR level
  const type = document.getElementById("type-select").value; // Get the search type (words or sentences)
  const normalizedQueries = wordSearchResolution.queries.map(normalizeSearchText);

  // Build the "No Matches" message based on filters
  const filterMessage = [];
  if (selectedPOS) filterMessage.push(`word class of "${selectedPOS}"`);
  if (selectedCEFR) filterMessage.push(`CEFR level "${selectedCEFR}"`);
  const filtersText =
    filterMessage.length > 0 ? ` with the ${filterMessage.join(" and ")}` : "";

  // Clear any previous highlights by resetting the `query`
  let cleanResults = results.map((result) => {
    if (result.eksempel) {
      result.eksempel = result.eksempel.replace(
        /<span[^>]*>(.*?)<\/span>/gi,
        "$1",
      ); // Remove old highlights
    }
    return result;
  });

  cleanURL(type);

  // Update the URL with the search parameters
  updateURL(originalQuery, type, selectedPOS); // Preserve what the visitor typed

  // Show the spinner at the start of the search
  showSpinner();

  showLandingCard(false);
  clearContainer(); // Clear previous results

  let matchingResults;

  if (type === "stories") {
    // If query is empty, display all stories
    if (!query) {
      matchingResults = storyResults;
    } else {
      // Filter stories based on the query in both 'titleNorwegian' and 'titleEnglish'
      matchingResults = storyResults.filter((story) => {
        const norwegianTitleMatch = story.titleNorwegian
          .toLowerCase()
          .includes(query);
        const englishTitleMatch = story.titleEnglish
          .toLowerCase()
          .includes(query);
        return norwegianTitleMatch || englishTitleMatch;
      });
    }

    // Render the matching stories
    displayStoryList(matchingResults);
  } else if (type === "sentences") {
    if (!query) {
      resultsContainer.innerHTML = `
      <div class="definition error-message">
        <h2 class="word-gender">Error <div class="gender">Empty Search</div></h2>
        <p>Please enter a word in the search field before searching.</p>
      </div>`;
      hideSpinner();
      return;
    }

    if (!hasSearchableCharacters(query)) {
      resultsContainer.innerHTML = `
        <div class="definition error-message">
          <h2 class="word-gender">
            Error <span class="gender">Search Needs a Word</span>
          </h2>
          <p>Please enter at least one letter or number.</p>
        </div>
      `;
      hideSpinner();
      return;
    }

    // Safety: ensure index exists
    if (!sentenceIndex || !sentenceCorpus.length) {
      buildSentenceCorpus();
      buildSentenceIndex();
    }

    console.time("[Sentences] query");
    const normalizedQuery = normalizeSearchText(query);
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    const expressionEntry = results.find(
      (entry) =>
        WordClass.getWordClass(entry.gender) === "expression" &&
        window.ExpressionPatterns
          ?.getVariants(entry)
          .some((variant) => normalizeSearchText(variant) === normalizedQuery),
    );
    const expressionAnalysis = expressionEntry
      ? await window.ExpressionPatterns.getAnalysis(expressionEntry)
      : null;
    const expressionMatcher = expressionAnalysis?.matcher || null;
    let norwegianHighlightTerms = [];
    let ids = null;

    if (expressionAnalysis) {
      ids = new Set();
      for (const alternative of expressionAnalysis.searchAlternatives) {
        let alternativeIds = null;
        for (const acceptedForms of alternative) {
          const groupIds = new Set();
          for (const form of acceptedForms) {
            for (const id of sentenceIndex.norwegian.get(form) || []) {
              groupIds.add(id);
            }
          }
          alternativeIds =
            alternativeIds === null
              ? groupIds
              : new Set(
                  [...alternativeIds].filter((id) => groupIds.has(id)),
                );
        }
        for (const id of alternativeIds || []) ids.add(id);
      }
    } else {
      const norwegianTermGroups = await Promise.all(
        terms.map((term) => window.Inflections.expandSearchTerm(term)),
      );
      norwegianHighlightTerms = [...new Set(norwegianTermGroups.flat())];

      for (let termIndex = 0; termIndex < terms.length; termIndex++) {
        const groupIds = new Set();
        for (const form of norwegianTermGroups[termIndex]) {
          const match = sentenceIndex.norwegian.get(form) || [];
          for (const id of match) groupIds.add(id);
        }

        // English examples are not Norwegian morphology. Search the literal
        // English token only, so an official Norwegian form that happens to be
        // an English word cannot broaden the English side of the corpus.
        const englishMatch = sentenceIndex.english.get(terms[termIndex]) || [];
        for (const id of englishMatch) groupIds.add(id);

        ids =
          ids === null
            ? groupIds
            : new Set([...groupIds].filter((id) => ids.has(id)));
      }
    }

    // If nothing matched, default to empty
    if (!ids || ids.size === 0) {
      ids = [];
    }

    // Materialize rows
    const rowsAll = [];
    for (const sid of ids) {
      const row = sentenceCorpus[sid];
      if (!expressionMatcher || expressionMatcher.test(row.no)) rowsAll.push(row);
    }

    // Apply CEFR filter if set
    const selectedCEFR = document.getElementById("cefr-select")
      ? document.getElementById("cefr-select").value.toUpperCase()
      : "";
    const rowsFiltered = selectedCEFR
      ? rowsAll.filter((r) => r.cefr === selectedCEFR)
      : rowsAll;

    // Prefer exact phrase matches first, then multi-word partials
    const exact = [];
    const partial = [];
    for (const r of rowsFiltered) {
      const inOrder =
        Boolean(expressionMatcher) ||
        r.noNorm.includes(normalizedQuery) ||
        r.enNorm.includes(normalizedQuery);
      if (inOrder) {
        exact.push(r);
      } else {
        // The postings intersection above already guarantees one accepted
        // form for every query term; these are morphology-expanded matches.
        partial.push(r);
      }
    }

    // Sort helper: lower CEFR first, then leave relative order intact
    function sortByCEFR(arr) {
      return arr.sort((a, b) => {
        const aVal = CEFR_ORDER[a.cefr] || 99;
        const bVal = CEFR_ORDER[b.cefr] || 99;
        return aVal - bVal;
      });
    }

    // Top-N cap (10 like your current UI), exact matches first, within each CEFR-ordered
    let combined = [];
    if (exact.length) {
      combined = sortByCEFR(exact).concat(sortByCEFR(partial));
    } else {
      combined = sortByCEFR(partial);
    }
    combined = combined.slice(0, 10);

    // Parity with word search's "no exact matches — here are inexact
    // results" fallback (see the type === "words" branch's noExactMatches
    // handling below): a single-word query with zero sentence hits gets
    // re-run against the closest term that actually appears in the
    // sentence corpus, instead of a dead-end "no results" page. Multi-word
    // queries are left alone — which of several words was the typo is
    // ambiguous, so guessing wrong would be worse than the plain message.
    let inexactMatchInfo = null;
    let englishHighlightTermsForRender = terms;
    if (combined.length === 0 && terms.length === 1) {
      const [closestTerm] = findClosestSentenceTerms(terms[0], 1);
      if (closestTerm) {
        const inexactIds = new Set([
          ...(sentenceIndex.norwegian.get(closestTerm) || []),
          ...(sentenceIndex.english.get(closestTerm) || []),
        ]);
        const inexactRowsAll = [...inexactIds].map((sid) => sentenceCorpus[sid]);
        const inexactRowsFiltered = selectedCEFR
          ? inexactRowsAll.filter((r) => r.cefr === selectedCEFR)
          : inexactRowsAll;
        const inexactRows = sortByCEFR(inexactRowsFiltered).slice(0, 10);

        if (inexactRows.length > 0) {
          combined = inexactRows;
          inexactMatchInfo = { originalQuery: query, matchedTerm: closestTerm };
          norwegianHighlightTerms = [closestTerm];
          englishHighlightTermsForRender = [closestTerm];
        }
      }
    }

    renderSentenceMatchesFromCorpus(
      combined,
      query,
      norwegianHighlightTerms,
      englishHighlightTermsForRender,
      inexactMatchInfo ? null : expressionMatcher,
      inexactMatchInfo,
    );

    console.timeEnd("[Sentences] query");
    hideSpinner();
    return;
  } else {
    // Handle empty search query
    if (!query) {
      resultsContainer.innerHTML = `
            <div class="definition error-message">
                <h2 class="word-gender">
                    Error <span class="gender">Empty Search</span>
                </h2>
                <p>Please enter a word in the search field before searching.</p>
            </div>
        `;
      hideSpinner();
      return;
    }

    if (!hasSearchableCharacters(query)) {
      resultsContainer.innerHTML = `
        <div class="definition error-message">
          <h2 class="word-gender">
            Error <span class="gender">Search Needs a Word</span>
          </h2>
          <p>Please enter at least one letter or number.</p>
        </div>
      `;
      hideSpinner();
      return;
    }

    // Precompute the match strategy (and, for literal searches, the regexes)
    // once per query variation rather than once per dictionary row -- these
    // only depend on `variation`, not on `r`, so rebuilding them ~29k times
    // (once per row) on every search was pure overhead.
    const queryVariations = normalizedQueries.map((variation) => {
      const isInflectedForm =
        wordSearchResolution.reason === "word-form" ||
        wordSearchResolution.inflectedLemmas?.includes(variation);

      return isInflectedForm
        ? { variation, isInflectedForm }
        : {
            variation,
            isInflectedForm,
            exactRegex: createWholeTermRegex(variation), // Exact match for Unicode words
            partialRegex: new RegExp(escapeRegExp(variation), "iu"), // Literal partial match for larger words
          };
    });

    // Filter results by query and selected POS for words
    matchingResults = cleanResults.filter((r) => {
      const matchesQuery = queryVariations.some(
        ({ variation, isInflectedForm, exactRegex, partialRegex }) => {
          if (isInflectedForm) {
            return splitSearchTerms(r.ord).includes(variation);
          }

          // Literal word/translation searches retain their existing exact,
          // prefix, and substring behavior. Resolved inflections above are
          // deliberately exact so an inflected form of "bar" cannot also pull
          // in an unrelated headword such as "barn".
          const wordMatch =
            exactRegex.test(r.ord.toLowerCase()) ||
            partialRegex.test(r.ord.toLowerCase());
          const englishValues = r.engelsk
            .toLowerCase()
            .split(",")
            .map((e) => e.trim());
          const englishMatch = englishValues.some(
            (eng) => exactRegex.test(eng) || partialRegex.test(eng),
          );
          return wordMatch || englishMatch;
        },
      );

      // Handle POS filtering for nouns and other parts of speech.
      return (
        matchesQuery &&
        WordClass.matchesWordClass(r.gender, selectedPOS) &&
        (!selectedCEFR || r.CEFR === selectedCEFR)
      );
    });

    // getSearchMatchRank re-splits `ord`/`engelsk` on every call, and a
    // plain `.sort()` comparator calls it twice per comparison -- O(n log n)
    // times over. For a short, generic query almost the entire dictionary
    // can match (e.g. "e" matches ~25k of ~29k entries as a substring), so
    // that redundant recomputation alone took seconds. Rank only depends on
    // the entry + query, not on what it's being compared against, so
    // compute it once per entry up front instead.
    const matchRankByEntry = new Map(
      matchingResults.map((entry) => [
        entry,
        getSearchMatchRank(entry, query, wordSearchResolution.inflectedLemmas),
      ]),
    );

    matchingResults.sort((a, b) => {
      const rankDifference = matchRankByEntry.get(a) - matchRankByEntry.get(b);
      return rankDifference || compareByCefrThenHeadword(a, b);
    });

    if (matchingResults.length === 1) {
      // Update URL and title for a single result
      const singleResult = matchingResults[0];
      if (wordSearchResolution.reason === "exact") {
        updateURL(null, type, selectedPOS, null, singleResult.ord);
      }
      // Display this single result directly
      displaySearchResults([singleResult], query); // Display only this single result
      hideSpinner(); // Hide the spinner
      return;
    }

    if (matchingResults.length > 1) {
      latestMultipleResults = query;
    } else {
      latestMultipleResults = null;
    }

    // Check if there are **no exact matches**
    const noExactMatches = matchingResults.length === 0;

    // If no exact matches are found, find inexact matches
    if (noExactMatches) {
      // Only use spelling distance after exact, official-form, prefix, and
      // substring matching fail.
      const inexactWordQueries = findClosestSearchTerms(query);
      const suggestionOrder = new Map(
        inexactWordQueries.map((term, index) => [term, index]),
      );
      // Match only the suggested dictionary terms, not arbitrary substrings.
      let inexactWordMatches = results.filter((r) => {
        const entryTerms = [
          ...splitSearchTerms(r.ord),
          ...splitSearchTerms(r.engelsk),
        ];
        const matchesInexact = entryTerms.some((term) =>
          suggestionOrder.has(term),
        );
        return (
          matchesInexact &&
          WordClass.matchesWordClass(r.gender, selectedPOS) &&
          (!selectedCEFR || r.CEFR === selectedCEFR)
        );
      });

      inexactWordMatches.sort((a, b) => {
        const getSuggestionRank = (entry) =>
          Math.min(
            ...[
              ...splitSearchTerms(entry.ord),
              ...splitSearchTerms(entry.engelsk),
            ].map(
              (term) => suggestionOrder.get(term) ?? Number.MAX_SAFE_INTEGER,
            ),
          );

        return (
          getSuggestionRank(a) - getSuggestionRank(b) ||
          compareWordSearchResults(a, b, query, wordSearchResolution.inflectedLemmas)
        );
      });

      // ✂️ Limit to 10 results after sorting
      inexactWordMatches = inexactWordMatches.slice(0, 10);

      // Display the "No Exact Matches" message
      resultsContainer.innerHTML = `
                <div class="definition error-message">
                    <h2 class="word-gender">
                        No Exact Matches Found
                    </h2>
                    <p>We couldn't find exact matches for "${escapeHTML(originalQuery)}"${filtersText}. Here are some inexact results:</p>
                      ${
                        !selectedPOS && !selectedCEFR
                          ? `
                        <button class="landing-card-btn flag-missing-word-btn">
                          <i class="fas fa-flag"></i> Flag Missing Word Entry
                        </button>`
                          : ""
                      }
                </div>
            `;

      // Add flag button functionality
      wireFlagMissingWordButton();

      // If inexact matches are found, display them below the message
      if (inexactWordMatches.length > 0) {
        displaySearchResults(inexactWordMatches);

        // Reattach the flag button functionality AFTER rendering the search results
        wireFlagMissingWordButton();
      } else {
        clearContainer();
        appendToContainer(`
            <div class="definition error-message">
                <h2 class="word-gender">No Matches Found</h2>
                <p>We couldn't find any matches for "${escapeHTML(query)}"${filtersText}.</p>
                    ${
                      !selectedPOS && !selectedCEFR
                        ? `
                      <button class="landing-card-btn flag-missing-word-btn">
                        <i class="fas fa-flag"></i> Flag Missing Word Entry
                      </button>`
                        : ""
                    }
            </div>`);

        wireFlagMissingWordButton();
      }

      hideSpinner();
      return;
    }

    displaySearchResults(matchingResults, query); // Render word-specific results
  }
  hideSpinner(); // Hide the spinner
}

// Handle change in part of speech (POS) filter
function handlePOSChange() {
  const query = document
    .getElementById("search-bar")
    .value.toLowerCase()
    .trim();

  const selectedPOS = document.getElementById("pos-select").value.toLowerCase();

  const activeType = document.getElementById("type-select").value;

  // Word List uses the selected Word Class to filter its table.
  if (activeType === "word-list") {
    updateURL(query, "word-list", selectedPOS);
    renderWordList();

    return;
  }

  if (gameActive && activeType === "word-game") {
    startWordGame();
  } else {
    updateURL(query, "words", selectedPOS);

    if (!query) {
      randomWord();
    } else {
      search();
    }
  }
}

function selectType(type) {
  // Set the dropdown value to match the selected type
  document.getElementById("type-select").value = type;
  // Call handleTypeChange with the type
  handleTypeChange(type);
}

// Visual disabled/enabled styling (grayed text, not-allowed cursor) comes
// entirely from CSS — button:disabled and input[type="text"]:disabled in
// styles.css — the instant .disabled flips below, so there's nothing left
// to set here beyond that flag.
function enableSearchControls() {
  const searchBar = document.getElementById("search-bar");
  const searchBtn = document.getElementById("search-btn");
  const clearBtn = document.getElementById("clear-btn");

  if (!searchBar || !searchBtn || !clearBtn) return;

  searchBar.disabled = false;
  searchBtn.disabled = false;
  clearBtn.disabled = false;
}

function disableSearchControls() {
  const searchBar = document.getElementById("search-bar");
  const searchBtn = document.getElementById("search-btn");
  const clearBtn = document.getElementById("clear-btn");

  if (!searchBar || !searchBtn || !clearBtn) return;

  searchBar.disabled = true;
  searchBtn.disabled = true;
  clearBtn.disabled = true;
}

// Handle change in search type (words/sentences)
function handleTypeChange(type, options = {}) {
  // If type is not passed in (e.g., called from dropdown), get it from the dropdown
  type = type || document.getElementById("type-select").value;
  const shouldRenderStories = options.renderStories !== false;
  const shouldRenderInitialContent = options.renderInitialContent !== false;
  // Give the page a dedicated class while Word Game is selected.
  document.body.classList.toggle("word-game-mode", type === "word-game");
  // Same idea for My Stats — styles.css uses this to keep the My Words
  // button as a labeled pill beside the type dropdown at ≤1024px instead
  // of the icon-only circle meant to share a row with the search bar,
  // which My Stats hides entirely.
  document.body.classList.toggle("my-stats-mode", type === "my-stats");
  const query = document
    .getElementById("search-bar")
    .value.toLowerCase()
    .trim();

  // Clear any remnants from other types in the URL
  cleanURL(type);

  // Container to update and other UI elements
  const searchContainerInner = document.getElementById(
    "search-container-inner",
  ); // The container to update
  const searchBarWrapper = document.getElementById("search-bar-wrapper");
  const randomBtn = document.getElementById("my-words-nav-btn");
  const gameEnglishFilterContainer = document.querySelector(
    ".game-english-filter",
  );
  const gameEnglishSelect = document.getElementById("game-english-select");

  // Retrieve selected part of speech (POS) if available
  const selectedPOS = document.getElementById("pos-select")
    ? document.getElementById("pos-select").value.toLowerCase()
    : "";

  // Filter containers for POS, Genre, and CEFR
  const posFilterContainer = document.querySelector(".pos-filter");
  const genreFilterContainer = document.getElementById("genre-filter"); // Get the Genre filter container
  const cefrFilterContainer = document.querySelector(".cefr-filter"); // Get the CEFR filter container

  // Filter dropdowns for POS, Genre, and CEFR
  const posSelect = document.getElementById("pos-select");
  const genreSelect = document.getElementById("genre-select");
  const cefrSelect = document.getElementById("cefr-select"); // Get the CEFR filter dropdown
  const cefrLock = document.getElementById("lock-icon");

  removeStoryHeader();
  gameEnglishFilterContainer.style.display = "none";
  gameEnglishSelect.style.display = "none"; // Hide random button

  // Reset the shared CEFR filter (and its wrapping group) to their default
  // visible state before any type-specific branch runs. Only the word-game
  // branch (in wordGame.js's startWordGame()) hides .cefr-filter — CEFR is
  // a pure browse filter everywhere else, never a control the word game
  // exposes. The group itself is never hidden (it also holds the "Quit &
  // see stats" and "Report an issue" buttons the word game does use), but
  // is reset here too for safety.
  const cefrFilterGroup = document.querySelector(".cefr-filter-group");
  if (cefrFilterGroup) cefrFilterGroup.style.display = "";
  if (cefrFilterContainer) cefrFilterContainer.style.display = "";

  // Update the URL with the selected type, query, and POS
  updateURL(query, type, selectedPOS); // This ensures the type is reflected in the URL

  // Add logic for the "Stories" type
  if (type === "stories") {
    genreFilterContainer.style.display = "inline-flex"; // Show genre dropdown in story mode
    genreSelect.value = ""; // Reset to default genre

    searchBarWrapper.style.display = "inline-flex"; // Hide search-bar-wrapper
    posFilterContainer.style.display = "none";
    randomBtn.style.display = "block"; // My Words is still useful from the story list
    cefrLock.style.display = "none";

    searchContainerInner.classList.remove("word-game-active");

    showLandingCard(false);
    clearInput(false);

    cefrSelect.disabled = false; // Enable CEFR filter
    cefrFilterContainer.classList.remove("disabled"); // Visually enable the CEFR filter
    cefrSelect.value = ""; // Reset to default "CEFR Level"

    enableSearchControls();

    // Load stories data if not already loaded
    if (!storyResults.length) {
      fetchAndLoadStoryData().then(() => {
        if (shouldRenderStories) displayStoryList();
      });
    } else if (shouldRenderStories) {
      displayStoryList(); // Display the list of stories if already loaded
    }
  } else if (type === "sentences") {
    // Show POS and CEFR dropdowns, hide Genre dropdown
    genreFilterContainer.style.display = "none"; // Hide genre dropdown in sentences mode

    searchBarWrapper.style.display = "inline-flex";
    randomBtn.style.display = "block";

    searchContainerInner.classList.remove("word-game-active");
    gameActive = false;

    // Word class isn't a meaningful filter for sentence search, so hide
    // it entirely rather than showing it grayed out.
    posFilterContainer.style.display = "none";
    posSelect.disabled = true;
    cefrLock.style.display = "none";
    posSelect.value = ""; // Reset to "Part of Speech" option

    // Disable the CEFR dropdown and gray it out
    cefrSelect.disabled = false; // Enable CEFR filter when sentences are selected
    cefrSelect.value = ""; // Reset to "CEFR Level" option
    cefrFilterContainer.classList.remove("disabled"); // Visually enable the CEFR filter

    enableSearchControls();

    // If the search bar is not empty, perform a sentence search
    if (query) {
      search(); // This will trigger a search for sentences based on the search bar query
    } else {
      randomWord(); // Generate a random sentence if the search bar is empty
    }
  } else if (type === "word-game") {
    // Handle "Word Game" type

    // Every explicit entry into the word game shows the mode-picker intro
    // again — this is a fresh visit, not a continuation of whatever round
    // (if any) was previously active. startWordGame() itself becomes a
    // no-op past the "show the intro" gate until beginWordGameRound() sets
    // this back to true.
    wordGameRoundActive = false;
    resetGame();
    startWordGame(); // Call the word game function
  } else if (type === "pronunciation") {
    // Same UI adjustments you already had…
    genreFilterContainer.style.display = "none";
    searchBarWrapper.style.display = "inline-flex";
    randomBtn.style.display = "block";
    posFilterContainer.style.display = "inline-flex";
    posSelect.disabled = true;
    cefrLock.style.display = "none";
    cefrSelect.disabled = false;
    cefrFilterContainer.classList.remove("disabled");

    disableSearchControls();
    // Now call the pronunciation module
    initPronunciation();
  } else if (type === "my-stats") {
    // My Stats has nothing to search or filter — it's a personal report,
    // not a browsable list — so every shared filter control is hidden
    // entirely, same treatment as Word Game's intro screen.
    genreFilterContainer.style.display = "none";
    randomBtn.style.display = "block"; // My Words is still a useful jump from here

    searchBarWrapper.style.display = "none";
    disableSearchControls();

    searchContainerInner.classList.remove("word-game-active");
    gameActive = false;

    posFilterContainer.style.display = "none";
    cefrFilterContainer.style.display = "none";
    cefrLock.style.display = "none";

    if (typeof initMyStats === "function") {
      initMyStats();
    } else {
      showLandingCard(false);
      console.warn("initMyStats() is not available yet.");
      resultsContainer.innerHTML = "<p>My Stats is not ready yet.</p>";
    }
  } else if (type === "word-list") {
    // Hide controls that Word List does not use.
    genreFilterContainer.style.display = "none";
    // Unlike every other type above, the "My Words" jump button is a
    // no-op here — Word List (whose menu entry reads "My Words") is
    // already the destination it links to. search-bar-wrapper's own
    // flex-grow fills the freed space, same as it already does whenever
    // this button is hidden elsewhere (e.g. Word Game).
    randomBtn.style.display = "none";

    // Keep the shared search field visible.
    searchBarWrapper.style.display = "inline-flex";
    enableSearchControls();

    // Make sure Word Game mode is no longer active.
    searchContainerInner.classList.remove("word-game-active");
    gameActive = false;

    // Show and enable the Word Class filter.
    posFilterContainer.style.display = "inline-flex";
    posSelect.disabled = false;
    posSelect.value = "";
    posFilterContainer.classList.remove("disabled");

    // Show and enable the Level filter.
    cefrFilterContainer.style.display = "inline-flex";
    cefrSelect.disabled = false;
    cefrSelect.value = "";
    cefrFilterContainer.classList.remove("disabled");

    // Word List does not use the level-lock button.
    cefrLock.style.display = "none";

    // Hide the landing page and start the Word List module.
    showLandingCard(false);

    // The menu entry for this type reads "My Words" (see #type-select in
    // index.html), so reaching it this way — the dropdown, a bookmarked
    // ?type=word-list link, browser back/forward — should default to that
    // tab, not the underlying "All Words" table. openWordList() (used by
    // the landing page's separate Word List / My Words cards, which are
    // unambiguous on their own) passes an explicit override here instead,
    // so it isn't affected by this default.
    window.WordListAPI?.setActiveView?.(options.wordListView ?? "my");

    if (typeof initWordList === "function") {
      initWordList();
    } else {
      console.warn("initWordList() is not available yet.");
      resultsContainer.innerHTML = "<p>Word List is not ready yet.</p>";
    }
  } else {
    // Handle default case (e.g., "Words" type)
    genreFilterContainer.style.display = "none"; // Hide genre dropdown

    searchBarWrapper.style.display = "inline-flex"; // Show search-bar-wrapper
    randomBtn.style.display = "block"; // Show random button

    cefrLock.style.display = "none";
    gameActive = false;
    searchContainerInner.classList.remove("word-game-active");

    // Enable the POS dropdown and restore color
    posFilterContainer.style.display = "inline-flex";
    posSelect.disabled = false;
    posSelect.value = ""; // Reset to "Part of Speech" option
    posFilterContainer.classList.remove("disabled"); // Remove the 'disabled' class

    // Enable the CEFR dropdown and restore color
    cefrSelect.disabled = false;
    cefrSelect.value = ""; // Reset to "CEFR Level" option
    cefrFilterContainer.classList.remove("disabled");

    enableSearchControls();

    // Word List can supply an exact entry without searching the full dictionary.
    if (!shouldRenderInitialContent) {
      showLandingCard(false);
      clearContainer();
    } else if (query) {
      search(); // Trigger a word search if the search bar has a value
    } else {
      randomWord(); // Generate a random word if the search bar is empty
    }
  }
}

// Helper function to clear the URL of remnants from other types
function cleanURL(type) {
  const url = new URL(window.location);
  url.searchParams.delete("query");
  url.searchParams.delete("pos");
  url.searchParams.delete("story");
  url.searchParams.delete("word");
  url.searchParams.set("type", type);
  window.history.pushState({}, "", url);
}

// Handle change in CEFR filter
function handleCEFRChange() {
  const query = document
    .getElementById("search-bar")
    .value.toLowerCase()
    .trim();
  const type = document.getElementById("type-select").value;
  const selectedCEFR = document
    .getElementById("cefr-select")
    .value.toUpperCase();
  const selectedGenre = document
    .getElementById("genre-select")
    .value.trim()
    .toLowerCase();

  // Check if the 'stories' tab is active
  if (type === "stories") {
    // Filter the stories by the selected CEFR level
    const filteredStories = storyResults.filter((story) => {
      const genreMatch = selectedGenre
        ? story.genre.trim().toLowerCase() === selectedGenre
        : true;
      const cefrMatch = selectedCEFR
        ? story.CEFR && story.CEFR.toUpperCase() === selectedCEFR
        : true;

      return genreMatch && cefrMatch;
    });

    // Display the filtered list of stories
    displayStoryList(filteredStories);
  } else if (type === "pronunciation") {
    // Pronunciation: regenerate a sentence with the selected CEFR
    initPronunciation();
  } else if (type === "word-list") {
    // Rerender Word List using the selected CEFR level.
    renderWordList();
  } else if (gameActive && type === "word-game") {
    startWordGame(); // Adjust the word game based on the new CEFR filter
  } else {
    // If the search field is empty, generate a random word based on the CEFR level
    if (!query) {
      randomWord(); // Ensure randomWord() applies the CEFR filter
    } else {
      search(); // Perform a search with the selected CEFR
    }
  }
}

// The multi-result summary definition renders inside a flex-item <p> (see
// multipleResultsDefinitionText below) that participates in the card's row
// layout. makeDefinitionClickable's <ul>/<li> output can't be nested inside
// a <p> - browsers silently close the <p> right before the <ul>, popping the
// list out of the flex row and breaking its alignment with the word/POS
// column. This produces the same semicolon-separated "one sense per line"
// look with inline-safe markup instead, and deliberately isn't clickable:
// unlike the single-result view, clicking anywhere on this card already
// opens that single-result view, so per-word click targets here would only
// conflict with it.
function formatMultiResultDefinition(defText) {
  if (!defText) return "";
  if (!defText.includes(";")) return defText;

  const items = defText
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);

  return items
    .map((item) => `<span class="multiple-results-definition-item">${item}</span>`)
    .join("");
}

// Multi-word citation forms (expressions like "med en gang", conjunctions
// like "etter at") from the full dictionary, indexed so definition text can
// link the whole phrase in one click instead of splitting it into separate
// single-word links that don't correspond to any entry. Built lazily and
// cached against `results`' current length: `results` is assigned exactly
// once, from [] to the full parsed dataset (see parseCSVData), so a mismatch
// only ever means "the dictionary just finished loading" — cheap to detect,
// no need to rebuild on every render.
let multiWordDefinitionPhraseIndex = { size: -1, phrases: new Set(), maxWords: 0 };

function getMultiWordDefinitionPhrases() {
  if (multiWordDefinitionPhraseIndex.size === results.length) {
    return multiWordDefinitionPhraseIndex;
  }
  const phrases = new Set();
  let maxWords = 0;
  for (const entry of results) {
    if (!entry?.ord) continue;
    for (const variant of entry.ord.split(",")) {
      const words = normalizeSearchText(variant).split(" ").filter(Boolean);
      if (words.length < 2) continue;
      phrases.add(words.join(" "));
      maxWords = Math.max(maxWords, words.length);
    }
  }
  multiWordDefinitionPhraseIndex = { size: results.length, phrases, maxWords };
  return multiWordDefinitionPhraseIndex;
}

// Comparable form of a raw definition token: lowercased/whitespace-collapsed
// the same way the phrase index is, with the outer punctuation a token can
// pick up from sitting at a clause boundary (a trailing comma/period, a
// wrapping paren) stripped off, since that punctuation is never part of the
// dictionary's citation form.
function definitionTokenCore(token) {
  return normalizeSearchText(
    token.replace(/^[(),.:;!?]+/u, "").replace(/[(),.:;!?]+$/u, ""),
  );
}

// Greedily groups a definition item's whitespace-split tokens into
// multi-word phrase runs (longest match first, so "med en gang" wins over
// any shorter phrase that happens to also be a headword) and single-word
// leftovers. A token carrying its own internal punctuation (parens, a slash
// alternation like "en/ei") stays out of phrase matching entirely and falls
// through to the single-word path, which already knows how to handle it.
function segmentDefinitionTokens(tokens) {
  const { phrases, maxWords } = getMultiWordDefinitionPhrases();
  const segments = [];
  let index = 0;
  while (index < tokens.length) {
    let matchLength = 0;
    const upperBound = Math.min(maxWords, tokens.length - index);
    for (let length = upperBound; length >= 2; length--) {
      const slice = tokens.slice(index, index + length);
      if (slice.some((token) => /[()\/]/u.test(token))) continue;
      if (phrases.has(slice.map(definitionTokenCore).join(" "))) {
        matchLength = length;
        break;
      }
    }
    if (matchLength >= 2) {
      segments.push({ type: "phrase", tokens: tokens.slice(index, index + matchLength) });
      index += matchLength;
    } else {
      segments.push({ type: "word", token: tokens[index] });
      index += 1;
    }
  }
  return segments;
}

function makeDefinitionClickable(defText) {
  if (!defText) return "";

  function wrapToken(token) {
    // Håndter sammensatte ord med parentes, som (språk)gruppe eller språk(gruppe)
    const complexParenMatch = token.match(
      /^([\p{L}\-']*)\(([\p{L}\-']+)\)([\p{L}\-']*)([.,;!?]*)$/u,
    );
    if (complexParenMatch) {
      const [, before, inside, after, punctuation] = complexParenMatch;
      const parts = [];

      if (before) {
        parts.push(
          `<span class="clickable-definition-word" data-word="${before}">${before}</span>`,
        );
      }

      parts.push("(");
      parts.push(
        `<span class="clickable-definition-word" data-word="${inside}">${inside}</span>`,
      );
      parts.push(")");

      if (after) {
        parts.push(
          `<span class="clickable-definition-word" data-word="${after}">${after}</span>`,
        );
      }

      parts.push(punctuation || "");
      return parts.join("");
    }

    // Opprinnelig logikk for alt annet
    const match = token.match(
      /^(\()?(?<prefix>[\p{L}\-']+)?(\))?(?<base>[\p{L}\-']+)?([:.,;!?]*)$/u,
    );

    if (!match || !match.groups) return token;

    const { prefix, base } = match.groups;
    const punctuationMatch = token.match(/[:.,;!?]+$/);
    const punctuation = punctuationMatch ? punctuationMatch[0] : "";
    const open = token.startsWith("(") ? "(" : "";
    const close = token.includes(")") ? ")" : "";

    const parts = [];

    // 👇 Check for trailing hyphen outside the word
    const endsWithHyphen = token.endsWith("-");

    const word = (prefix || base || "").replace(/-$/, "");

    if (word) {
      parts.push(
        `${open}<span class="clickable-definition-word" data-word="${word}">${word}</span>${
          endsWithHyphen ? "-" : ""
        }${close}`,
      );
    } else if (open || close) {
      parts.push(`${open}${close}`);
    }

    return parts.join("") + punctuation;
  }

  // A matched phrase run's own trailing punctuation (from sitting at a
  // clause boundary, e.g. "...med en gang." or "...med en gang;") is kept
  // outside the link, exactly like a single wrapToken() word.
  function wrapPhrase(tokens) {
    const last = tokens[tokens.length - 1];
    const trailingPunctuationMatch = last.match(/[:.,;!?]+$/);
    const trailingPunctuation = trailingPunctuationMatch
      ? trailingPunctuationMatch[0]
      : "";
    const displayTokens = [
      ...tokens.slice(0, -1),
      trailingPunctuation
        ? last.slice(0, -trailingPunctuation.length)
        : last,
    ];
    const displayText = displayTokens.join(" ");
    const dataWord = displayTokens.map(definitionTokenCore).join(" ");
    return `<span class="clickable-definition-word" data-word="${dataWord}">${displayText}</span>${trailingPunctuation}`;
  }

  function wrapWord(token) {
    if (token.includes("/") && !token.startsWith("http")) {
      return token
        .split("/")
        .map((subToken) => wrapToken(subToken))
        .join("/");
    }
    return wrapToken(token);
  }

  function renderTokens(tokens) {
    return segmentDefinitionTokens(tokens)
      .map((segment) =>
        segment.type === "phrase"
          ? wrapPhrase(segment.tokens)
          : wrapWord(segment.token),
      )
      .join(" ");
  }

  if (defText.includes(";")) {
    const items = defText
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
    return (
      `<ul class="definition-list">` +
      items
        .map((item) => `<li>${renderTokens(item.split(/\s+/))}</li>`)
        .join("") +
      `</ul>`
    );
  }

  return renderTokens(defText.split(/\s+/));
}

// Replaces whatever nodes cover [match.start, match.end) of `container`'s
// live text (a run of clickable-definition-word spans, plain text, or
// both) with a single new span whose data-word is the matched expression's
// own citation form. From then on this occurrence behaves exactly like any
// other literal match: the click handler's ordinary exact-match lookup
// finds it, no special-casing needed there. Mirrors stories.js's
// replaceStoryWordSpanWithExpression for the same reason that function
// gives: swapping in one span of identical combined text never changes
// `container`'s total text length, so this is safe to call repeatedly for
// several non-overlapping matches in one pass without re-measuring between
// calls.
function mergeDefinitionExpressionSpan(container, match) {
  let offset = 0;
  const nodesToReplace = [];
  for (const child of Array.from(container.childNodes)) {
    const text = child.textContent;
    const childStart = offset;
    const childEnd = offset + text.length;
    if (childEnd > match.start && childStart < match.end) {
      nodesToReplace.push(child);
    }
    offset = childEnd;
  }
  if (nodesToReplace.length === 0) return;

  const matchedText = nodesToReplace.map((node) => node.textContent).join("");
  const newSpan = document.createElement("span");
  newSpan.className = "clickable-definition-word";
  newSpan.dataset.word = String(match.entry.ord || "").split(",")[0].trim();
  newSpan.textContent = matchedText;

  nodesToReplace[0].parentNode.insertBefore(newSpan, nodesToReplace[0]);
  nodesToReplace.forEach((node) => node.remove());
}

// makeDefinitionClickable only links a component word's literal citation
// spelling -- an inflected multi-word expression ("følger med", inflected
// from "følge med") isn't a headword itself, so each of its words rendered
// on its own either finds nothing or, worse, matches an unrelated
// same-spelling entry ("med" the preposition). window.findExpressionMatchesInSentence
// (stories.js) already solves exactly this for story sentences, complete
// with a reverse index so a definition only pays the matching cost for the
// handful of expressions that could plausibly appear in it, not all ~3,400
// -- reused here rather than re-deriving that grammar. Runs after the
// initial synchronous render (see displaySearchResults) since resolving an
// expression's inflected forms depends on data that isn't guaranteed
// loaded yet, so it can't block the definition's first paint.
async function upgradeDefinitionExpressionSpans(container, defText) {
  if (!defText || typeof findExpressionMatchesInSentence !== "function") return;

  const items = container.querySelectorAll("li");
  const targets = items.length > 0 ? Array.from(items) : [container];

  for (const target of targets) {
    const text = target.textContent;
    if (!text) continue;
    const matches = await findExpressionMatchesInSentence(text);
    for (const match of matches) {
      mergeDefinitionExpressionSpan(target, match);
    }
  }
}

// Collapsed-by-default "Word forms" toggle, sitting next to the "Report an
// issue" button in .definition-actions-row. Returns "" when the word class
// doesn't inflect, so no empty toggle ever renders.
function renderInflectionsToggleButton(inflections) {
  if (!inflections) return "";
  return `
    <button
      type="button"
      class="inflections-toggle-btn"
      aria-expanded="false"
      onclick="event.stopPropagation(); toggleInflectionsTable(this)"
      onkeydown="event.stopPropagation()"
    ><i class="fas fa-chevron-down"></i> Word forms</button>`;
}

// A form's value is either a plain string, or an array of accepted
// alternates (e.g. an ei-noun's feminine/masculine definite singular) —
// shown together in one cell.
function formatInflectionValue(value) {
  return Array.isArray(value) ? value.join(" / ") : value;
}

function renderInflectionRows(forms) {
  return forms
    .map((form) => {
      const label = escapeHTML(form.label);
      const value = escapeHTML(formatInflectionValue(form.value));
      return `
        <tr>
          <th>${label}</th>
          <td data-label="${label}">${value}</td>
        </tr>`;
    })
    .join("");
}

function renderInflectionsSource(inflections) {
  if (inflections?.sourceType === "ordbank") {
    return `<p class="inflections-hint">Forms from <a href="https://ord.uib.no/ord_1_Ordlister.html" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">Norsk Ordbank</a></p>`;
  }
  if (inflections?.sourceType === "dictionary-override") {
    return `<p class="inflections-hint">Forms based on this dictionary’s adjective classification</p>`;
  }
  if (inflections?.sourceType === "ordbank-derived") {
    const sourceLemma = escapeHTML(inflections.derivedFrom || "a compound head");
    return `<p class="inflections-hint">Forms derived from the <a href="https://ord.uib.no/ord_1_Ordlister.html" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">Norsk Ordbank</a> paradigm for ${sourceLemma}</p>`;
  }
  if (inflections?.sourceType === "dictionary-only") {
    return `<p class="inflections-hint">Only the dictionary form is available; no verified inflections were found. The remaining forms are regular estimates.</p>`;
  }
  if (inflections?.sourceType === "variant-mixed") {
    const variantSources = inflections.variantSources || [];
    const hasOrdbankSource = variantSources.some(
      (variant) =>
        variant.sourceType === "ordbank" ||
        variant.sourceType === "ordbank-derived",
    );
    const hasEstimatedSource = variantSources.some(
      (variant) => variant.sourceType === "dictionary-only",
    );
    return `<p class="inflections-hint">Forms combine the available paradigms for the listed spelling variants${hasOrdbankSource ? `, including forms from <a href="https://ord.uib.no/ord_1_Ordlister.html" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">Norsk Ordbank</a>` : ""}.${hasEstimatedSource ? " Some forms are dictionary-based estimates." : ""}</p>`;
  }
  if (inflections?.sourceType === "expression-ordbank") {
    const heads = escapeHTML((inflections.expressionHeads || []).join(" / "));
    return `<p class="inflections-hint inflections-hint-expression">Component forms${heads ? ` for ${heads}` : ""} from <a href="https://ord.uib.no/ord_1_Ordlister.html" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">Norsk Ordbank</a></p>`;
  }
  if (inflections?.sourceType === "expression-estimated") {
    return `<p class="inflections-hint">Some component forms are regular estimates because no verified paradigm was available.</p>`;
  }
  if (inflections?.sourceType === "expression-fixed") {
    return `<p class="inflections-hint">No reliable inflecting component was found, so this is treated as a fixed expression.</p>`;
  }
  return "";
}

function renderInflectionsTableWrapper(inflections) {
  if (!inflections) return "";

  const requestAttribute = inflections.pending
    ? ` data-inflections-request-id="${escapeHTML(inflections.requestId)}"`
    : "";
  const rowsHTML = inflections.pending
    ? `<tr><td colspan="2">Loading verified forms…</td></tr>`
    : renderInflectionRows(inflections.forms);

  return `
    <div class="inflections-table-wrapper hidden"${requestAttribute}>
      <table class="inflections-table">
        <tbody>${rowsHTML}</tbody>
      </table>
      <div class="inflections-source">${renderInflectionsSource(inflections)}</div>
    </div>`;
}

async function loadPendingInflections(wrapper) {
  const requestId = wrapper.dataset.inflectionsRequestId;
  if (!requestId) return;

  const inflections = await window.Inflections?.resolvePending(requestId);
  delete wrapper.dataset.inflectionsRequestId;

  const tableBody = wrapper.querySelector(".inflections-table tbody");
  const source = wrapper.querySelector(".inflections-source");
  if (!tableBody) return;

  if (!inflections) {
    tableBody.innerHTML = `<tr><td colspan="2">No verified forms are available for this entry.</td></tr>`;
    if (source) source.innerHTML = "";
    return;
  }

  tableBody.innerHTML = renderInflectionRows(inflections.forms);
  if (source) source.innerHTML = renderInflectionsSource(inflections);
}

// The toggle button and its table live in separate DOM positions (button
// inside .definition-actions-row, table right after it) so the button can
// sit next to "Report an issue" in its own column — walk back up to the
// shared row, then to its next sibling, rather than assuming adjacency.
async function toggleInflectionsTable(button) {
  const row = button.closest(".definition-actions-row");
  const wrapper = row ? row.nextElementSibling : null;
  if (!wrapper) return;
  const isExpanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!isExpanded));
  button.classList.toggle("inflections-toggle-expanded", !isExpanded);
  wrapper.classList.toggle("hidden", isExpanded);

  if (!isExpanded && wrapper.dataset.inflectionsRequestId) {
    button.disabled = true;
    try {
      await loadPendingInflections(wrapper);
    } finally {
      button.disabled = false;
    }
  }
}

const dictionaryEntryDomIds = new WeakMap();
let nextDictionaryEntryDomId = 1;

function getDictionaryEntryDomKey(entry) {
  if (!entry || (typeof entry !== "object" && typeof entry !== "function")) {
    return "entry-unknown";
  }
  if (!dictionaryEntryDomIds.has(entry)) {
    dictionaryEntryDomIds.set(entry, nextDictionaryEntryDomId++);
  }
  return `entry-${dictionaryEntryDomIds.get(entry)}`;
}

// Render a list of results (words)
function displaySearchResults(results, query = "") {
  query = query.toLowerCase().trim(); // Ensure the query is lowercased and trimmed
  const defaultResult = results.length <= 1; // Determine if there are multiple results
  const multipleResults = results.length > 1; // Determine if there are multiple results

  let htmlString = "";

  // Limit to a maximum of 10 results
  results.slice(0, 10).forEach((result) => {
    result.gender = WordClass.formatWordClassLabel(result.gender);
    // Directly handle the POS based on the gender field
    result.pos = WordClass.getWordClass(result.gender);

    // null for word classes that don't inflect (adverb, preposition, ...)
    // or for entries without a verified noun/verb/adjective paradigm.
    const inflections = window.Inflections?.getForms(result) || null;

    const dictionaryEntryDomKey = getDictionaryEntryDomKey(result);

    // Determine whether to initially hide the content for multiple results
    const multipleResultsExposedContent = defaultResult
      ? "default-hidden-content"
      : "";

    const multipleResultsDefinition = multipleResults
      ? "multiple-results-definition"
      : "single-result-definition"; // Hide content if multiple results
    const multipleResultsEnglish = multipleResults
      ? "multiple-results-english"
      : ""; // Hide content if multiple results
    const multipleResultsHiddenContent = multipleResults
      ? "multiple-results-hidden-content"
      : ""; // Hide content if multiple results
    const multipleResultsDefinitionHeader = multipleResults
      ? "multiple-results-definition-header"
      : "";
    const multipleResultsWordgender = multipleResults
      ? "multiple-results-word-gender"
      : "";
    const multipleResultsDefinitionText = multipleResults
      ? "multiple-results-definition-text"
      : "";
    const multipleResultsgenderClass = multipleResults
      ? "multiple-results-gender-class"
      : "";

    // Safely escape the word in JavaScript by replacing special characters
    const escapedWord = result.ord
      .replace(/'/g, "\\'")
      .replace(/"/g, "&quot;")
      .replace(/\r?\n|\r/g, ""); // Escapes single quotes, double quotes, and removes newlines
    const hasSentencesPlaceholder = `<button class="sentence-btn english-toggle-btn" style="display: none;" onclick="event.stopPropagation(); toggleEnglishTranslations('${dictionaryEntryDomKey}')">Show English</button>`;

    const escapedGender = result.gender.replace(/'/g, "\\'").trim();
    const escapedEngelsk = result.engelsk.replace(/'/g, "\\'").trim();
    // Embedded directly rather than read back from the rendered DOM via
    // .textContent: the multi-result summary now renders semicolon-separated
    // senses as separate <span> elements (see formatMultiResultDefinition),
    // and .textContent concatenates them with no separator, which no longer
    // matches result.definisjon and silently breaks handleCardClick's exact
    // string match below.
    const escapedDefinisjon = (result.definisjon || "")
      .replace(/'/g, "\\'")
      .replace(/"/g, "&quot;")
      .replace(/\r?\n|\r/g, " ");
    const handleCardClickArgs = `'${escapedWord}', '${escapedGender}', '${escapedEngelsk}', '${escapedDefinisjon}'`;

    htmlString += `
<div
  class="definition ${multipleResultsDefinition}"
  data-word="${escapedWord}"
  data-pos="${result.pos}"
  data-engelsk="${result.engelsk}"
  tabindex="0"
  role="button"
  onclick="if (!window.getSelection().toString()) handleCardClick(event, ${handleCardClickArgs})"
  onkeydown="if ((event.key === 'Enter' || event.key === ' ') && !window.getSelection().toString()) { event.preventDefault(); handleCardClick(event, ${handleCardClickArgs}) }">
                <div class="${multipleResultsDefinitionHeader}">
                <h2 class="word-gender ${multipleResultsWordgender}">
                  <div lang="nb" class="word-text-block">
                    ${
                      result.ord.includes(",")
                        ? (() => {
                            const [first, ...rest] = result.ord.split(",");
                            return `${first.trim()}<br><span class="alt-spelling">${rest
                              .join(", ")
                              .trim()}</span>`;
                          })()
                        : result.ord
                    }
                  </div>

                    ${
                      result.gender
                        ? `<div class="gender ${multipleResultsgenderClass}">${result.gender}</div>`
                        : ""
                    }
                    ${
                      result.engelsk
                        ? `<p class="english ${multipleResultsExposedContent} ${multipleResultsEnglish}">${result.engelsk}</p>`
                        : ""
                    }
                    ${
                      result.CEFR
                        ? `<div class="game-cefr-label ${multipleResultsExposedContent} ${getCefrClass(
                            result.CEFR,
                          )}" title="${getCefrTooltip(result.CEFR)}">${result.CEFR}</div>`
                        : ""
                    } 
                </h2>
                ${
                  result.definisjon
                    ? `<p class="definition-text ${multipleResultsDefinitionText}">${
                        defaultResult
                          ? makeDefinitionClickable(result.definisjon)
                          : formatMultiResultDefinition(result.definisjon)
                      }</p>`
                    : ""
                }
                </div>
                <div class="definition-content ${multipleResultsHiddenContent}"> <!-- Apply the hidden class conditionally -->
                    ${
                      result.engelsk
                        ? `<p class="english"><i class="fas fa-language"></i> ${result.engelsk}</p>`
                        : ""
                    }
                    ${
                      result.wordAudio === "X"
                        ? `<p class="pronunciation">
                            <i class="fas fa-volume-up sentence-audio-icon"
                        data-sentence="${result.ord
                          .split(",")[0]
                          .trim()}"></i>                            ${
                          result.uttale || ""
                        }
                          </p>`
                        : result.uttale
                          ? `<p class="pronunciation"><i class="fas fa-volume-up"></i> ${result.uttale}</p>`
                          : ""
                    }
                    ${
                      result.etymologi
                        ? `<p class="etymology"><i class="fa-solid fa-scroll"></i> ${result.etymologi}</p>`
                        : ""
                    }
                    ${
                      result.CEFR
                        ? `<p style="display: inline-flex; align-items: center; font-family: 'Noto Sans', sans-serif; font-weight: bold; text-transform: uppercase; font-size: 12px; color: #4F4F4F;"><i class="fa-solid fa-signal" style="margin-right: 5px;"></i><span style="text-align: center; min-width: 15px; display: inline-block; padding: 3px 7px; border-radius: 4px; background-color: ${getCefrColor(
                            result.CEFR,
                          )};">${result.CEFR}</span><span style="margin-left: 6px; font-family: 'Noto Sans', sans-serif; font-size: 11px; font-weight: 500; letter-spacing: 0.03em; text-transform: uppercase; color: var(--color-text-muted);">${getCefrLabel(
                            result.CEFR,
                          )}</span></p>`
                        : ""
                    }
                    <div class="definition-actions-row">
                      <button
                        type="button"
                        class="report-issue-btn"
                        onclick="event.stopPropagation(); openWordCardFeedbackDialog(this, '${escapedWord}', '${result.pos}', '${result.CEFR || ""}')"
                        onkeydown="event.stopPropagation()"
                      ><i class="fas fa-flag"></i> Report an issue</button>
                      ${renderInflectionsToggleButton(inflections)}
                    </div>
                    ${renderInflectionsTableWrapper(inflections)}
                </div>
                </div>
                                <!-- Show "Show Sentences" button only if sentences exist -->
                    <div class="${multipleResultsHiddenContent}">
                        ${hasSentencesPlaceholder}
                    </div>       
            <!-- Sentences container is now outside the definition block -->
            <div class="sentences-container" id="sentences-container-${dictionaryEntryDomKey}"></div>
        `;
  });
  appendToContainer(htmlString);

  if (defaultResult && results[0]?.definisjon) {
    const definitionEl = resultsContainer.querySelector(".definition-text");
    if (definitionEl) {
      upgradeDefinitionExpressionSpans(definitionEl, results[0].definisjon).catch(
        (error) => {
          console.error("Could not resolve inflected expressions in definition.", error);
        },
      );
    }
  }

  if (
    defaultResult &&
    results[0] &&
    typeof window.attachSingleResultMyWordsControls === "function"
  ) {
    window.attachSingleResultMyWordsControls(results[0]);
  }

  if (
    multipleResults &&
    typeof window.attachMultipleResultMyWordsStars === "function"
  ) {
    window.attachMultipleResultMyWordsStars(results.slice(0, 10));
  }

  // Automatically load sentences for a single result, regardless of whether sentences exist in `eksempel`
  if (defaultResult && results[0]) {
    setTimeout(() => {
      const singleResult = results[0];
      fetchAndRenderSentences(
        singleResult,
        getDictionaryEntryDomKey(singleResult),
        isEnglishVisible,
      ).catch((error) => {
        console.error("Could not load inflected example sentences.", error);
      });
    }, 0);
  } else {
  }
}

// Function to toggle the visibility of English sentences and update Norwegian box styles
function toggleEnglishTranslations(wordId = null) {
  // Determine if wordId is a button element
  const isButton = wordId instanceof HTMLElement;
  const safeWordId = isButton ? null : CSS.escape(wordId);

  // Determine target elements based on the presence of wordId or button context
  const sentenceContainerSelector = safeWordId
    ? `#sentences-container-${safeWordId}`
    : ".sentence-container";
  const sentenceContainer = isButton
    ? wordId.nextElementSibling // Update to directly select the next sibling after the button
    : wordId
      ? document.querySelector(sentenceContainerSelector)
      : document; // Global context if no wordId

  if (!sentenceContainer) return;

  const englishSentenceDivs = wordId
    ? sentenceContainer.querySelectorAll(".sentence-box-english")
    : document.querySelectorAll(".sentence-box-english"); // Global if no wordId
  const norwegianSentenceDivs = wordId
    ? sentenceContainer.querySelectorAll(".sentence-box-norwegian")
    : document.querySelectorAll(".sentence-box-norwegian"); // Global if no wordId

  // Locate the button within the correct container
  const englishBtns = wordId
    ? [
        isButton
          ? wordId
          : sentenceContainer.previousElementSibling.querySelector(
              ".english-toggle-btn",
            ),
      ]
    : document.querySelectorAll(".english-toggle-btn"); // Global if no wordId

  // Toggle visibility based on the shared isEnglishVisible state
  setEnglishVisible(!isEnglishVisible);

  englishSentenceDivs.forEach((div) => {
    div.classList.toggle("hidden", !isEnglishVisible);
  });

  norwegianSentenceDivs.forEach((div) => {
    div.classList.toggle("sentence-box-norwegian-hidden", !isEnglishVisible);
  });

  // Update all button texts to match the new state
  englishBtns.forEach((btn) => {
    btn.textContent = isEnglishVisible ? "Hide English" : "Show English";
  });
}

// Plain-English glosses for each CEFR level. This app is not aimed at
// linguists, so a bare code like "B2" shouldn't be the only thing a user
// ever sees — every place a level is shown should be able to reach for a
// real label and/or a one-line description via these helpers.
const CEFR_LEVEL_INFO = {
  A1: { label: "Beginner", description: "Basic words and phrases for everyday needs" },
  A2: { label: "Elementary", description: "Simple, familiar topics and routine information" },
  B1: { label: "Intermediate", description: "Everyday topics, opinions, and plans" },
  B2: { label: "Upper-Intermediate", description: "Complex topics and more abstract ideas" },
  C: { label: "Advanced", description: "Nuanced, precise, and specialized language" },
};

function getCefrLabel(cefrLevel) {
  return CEFR_LEVEL_INFO[cefrLevel]?.label || "";
}

// "Label (Code): description" — for use as a title tooltip on compact badges
// that don't have room to show the plain label directly.
function getCefrTooltip(cefrLevel) {
  const info = CEFR_LEVEL_INFO[cefrLevel];
  return info ? `${info.label} (${cefrLevel}): ${info.description}` : "";
}

function getCefrClass(cefrLevel) {
  if (cefrLevel === "A1" || cefrLevel === "A2") {
    return "easy";
  } else if (cefrLevel === "B1" || cefrLevel === "B2") {
    return "medium";
  } else if (cefrLevel === "C") {
    return "hard";
  }
  return "";
}

function getSentenceCefrLabelHTML(cefrLevel) {
  const cefrClass = getCefrClass(cefrLevel);
  return cefrClass
    ? `<div class="sentence-cefr-label ${cefrClass}" title="${getCefrTooltip(cefrLevel)}">${cefrLevel}</div>`
    : "";
}

function getCefrColor(cefrLevel) {
  switch (cefrLevel) {
    case "A1":
    case "A2":
      return "#C7E3B6"; // Green for 'easy'
    case "B1":
    case "B2":
      return "#F2D96B"; // Yellow for 'medium'
    case "C":
      return "#E9A895"; // Red for 'hard'
    default:
      return "#ccc"; // Default background color
  }
}

// Render a single sentence
function renderSentenceMatchesFromCorpus(
  rows,
  query,
  norwegianHighlightTerms,
  englishHighlightTerms,
  norwegianMatcherOverride = null,
  // Set only by the inexact-match fallback in the sentences search branch
  // (see findClosestSentenceTerms) when `query` itself had zero hits but a
  // nearby corpus term did — `rows` here are already that corrected term's
  // results, matching the word-search pattern of substituting and showing
  // results directly rather than a dead-end "no results" page.
  inexactMatchInfo = null,
) {
  clearContainer();
  const safeQuery = escapeHTML(query);
  const norwegianMatcher =
    norwegianMatcherOverride ||
    window.SentenceFormMatching.createMatcher(norwegianHighlightTerms);
  const englishMatcher = window.SentenceFormMatching.createMatcher(
    englishHighlightTerms,
  );

  if (!rows.length) {
    document.getElementById("results-container").innerHTML = `
      <div class="definition error-message">
        <h2 class="word-gender">Error <span class="gender">No Matching Sentences</span></h2>
        <p>No sentences found containing "${safeQuery}".</p>
      </div>`;
    return;
  }

  const inexactNoticeHTML = inexactMatchInfo
    ? `
    <div class="definition error-message">
      <h2 class="word-gender">No Exact Matches Found</h2>
      <p>We couldn't find sentences for "${escapeHTML(inexactMatchInfo.originalQuery)}". Here are inexact results for "${escapeHTML(inexactMatchInfo.matchedTerm)}":</p>
    </div>
  `
    : "";

  let html = `
    ${inexactNoticeHTML}
    <div class="result-header">
      <h2>Sentence Results for "${inexactMatchInfo ? escapeHTML(inexactMatchInfo.matchedTerm) : safeQuery}"</h2>
    </div>
    <button class="sentence-btn english-toggle-btn" onclick="toggleEnglishTranslations()">
      ${isEnglishVisible ? "Hide English" : "Show English"}
    </button>
  `;

  for (const row of rows) {
    const cefr = row.cefr;
    const cefrLabel = getSentenceCefrLabelHTML(cefr);

    const noHTML = norwegianMatcher.highlight(row.no);
    const enHTML = row.en ? englishMatcher.highlight(row.en) : "";

    html += `
      <div class="sentence-container">
        <div lang="nb" class="sentence-box-norwegian ${
          !isEnglishVisible ? "sentence-box-norwegian-hidden" : ""
        }">
          <div class="sentence-content">
            <div class="cefr-audio-block">
              ${cefrLabel}
              ${
                row.audio
                  ? `<i class="fas fa-volume-up sentence-audio-icon" data-sentence="${row.no
                      .replace(/<[^>]*>/g, "")
                      .trim()}"></i>`
                  : ""
              }
            </div>
            <p class="sentence">${noHTML}</p>
          </div>
        </div>
        ${
          row.en
            ? `
          <div lang="en" class="sentence-box-english ${isEnglishVisible ? "" : "hidden"}">
            <p class="sentence">${enHTML}</p>
          </div>`
            : ""
        }
      </div>
    `;
  }

  document.getElementById("results-container").innerHTML = html;
}

function renderWordDefinition(word, selectedPOS = "") {
  const trimmedWord = word.trim().toLowerCase();

  // Switch the type selector back to "words"
  const typeSelect = document.getElementById("type-select");
  typeSelect.value = "words";

  // Re-enable the POS filter
  const posSelect = document.getElementById("pos-select");
  posSelect.disabled = false;
  const posFilterContainer = document.querySelector(".pos-filter");
  posFilterContainer.classList.remove("disabled"); // Remove the 'disabled' class for visual effect

  // Filter results based on both word and selected POS if provided.
  const normalizedSelectedPOS = WordClass.stripNounPrefix(selectedPOS);

  const matchingResults = results.filter((entry) => {
    /*
     * Some CSV entries contain comma-separated spelling variants.
     * A direct URL for any individual form must find the full entry.
     */
    const wordMatch = String(entry.ord || "")
      .toLowerCase()
      .split(",")
      .map((form) => form.trim())
      .includes(trimmedWord);

    const entryPOS = WordClass.stripNounPrefix(entry.gender);

    // A bare "noun" gender value (a handful of entries with no specific
    // article on file) counts as a noun match here, matching this
    // function's pre-existing, wider-than-usual convention.
    const posMatch =
      normalizedSelectedPOS === "noun"
        ? WordClass.isNounGender(entryPOS) || entryPOS === "noun"
        : normalizedSelectedPOS
          ? entryPOS === normalizedSelectedPOS
          : true;

    return wordMatch && posMatch;
  });
  if (matchingResults.length > 0) {
    displaySearchResults(matchingResults);
    updateWordMetadata(matchingResults[0]);
  } else {
    document.getElementById("results-container").innerHTML = `
            <div class="definition error-message">
                <h2 class="word-gender">
                    Error <span class="gender">No Definition Found</span>
                </h2>
                <p>No definition found for "${escapeHTML(trimmedWord)}".</p>
            </div>
        `;
  }
}

function getHomographEntries(entry) {
  return [
    ...new Set(
      splitSearchTerms(entry?.ord).flatMap(
        (lemma) => wordSearchIndex.norwegianExact.get(lemma) || [],
      ),
    ),
  ];
}

// Expression matching understands reordered verbs, movable negation,
// reflexives, possessives, and object gaps. That makes it much more useful
// than a simple form regex, but also too expensive to run against every
// dictionary row whenever a definition card opens. First require one or two
// of the expression's most selective, token-bounded components. The complete
// matcher then only has to inspect the small set that survives this pass.
//
// This deliberately avoids building the full Sentence Search index on first
// use: even its one-time construction would make the first card feel slower.
function getExpressionSentenceCandidates(primaryEntry, analysis) {
  if (!primaryEntry || !analysis) return results;

  const cached = expressionSentenceCandidateCache.get(primaryEntry);
  if (cached) return cached;

  const coarseAlternatives = (analysis.searchAlternatives || [])
    .map((groups) =>
      groups
        .map((forms) =>
          window.SentenceFormMatching.normalizeForms(forms),
        )
        .filter((forms) => forms.length > 0)
        .sort((left, right) => {
          // A literal component has fewer accepted forms than an inflected
          // one. Among equally fixed components, the longer word/phrase is
          // usually rarer ("ulvene" is a better anchor than "til").
          if (left.length !== right.length) return left.length - right.length;
          const leftLength = Math.max(...left.map((form) => form.length));
          const rightLength = Math.max(...right.map((form) => form.length));
          return rightLength - leftLength;
        })
        .slice(0, 2)
        .map((forms) => window.SentenceFormMatching.createMatcher(forms)),
    )
    .filter((matchers) => matchers.length > 0);

  // An expression made entirely from placeholders has no safe coarse
  // anchors. Such an unusual row still gets its own example immediately;
  // scanning the whole dictionary with the expensive matcher is not useful.
  if (coarseAlternatives.length === 0) {
    const ownEntryOnly = [primaryEntry];
    expressionSentenceCandidateCache.set(primaryEntry, ownEntryOnly);
    return ownEntryOnly;
  }

  const candidates = results.filter(
    (entry) =>
      entry === primaryEntry ||
      (entry?.eksempel &&
        coarseAlternatives.some((matchers) =>
          matchers.every((matcher) => matcher.test(entry.eksempel)),
        )),
  );
  expressionSentenceCandidateCache.set(primaryEntry, candidates);
  return candidates;
}

// Fetch and render sentences for one exact dictionary sense. Cross-class and
// same-gender homographs retain their searchable spelling; only genuinely
// different noun-gender paradigms allocate shared forms to the earliest-
// taught paradigm. The selected entry's own example is always inserted first.
async function fetchAndRenderSentences(
  matchingWordEntry,
  dictionaryEntryDomKey,
  showEnglish = true,
) {
  if (!matchingWordEntry?.ord) return;
  const trimmedWord = matchingWordEntry.ord
    .trim()
    .toLowerCase()
    .replace(/[\r\n]+/g, ""); // Remove any carriage returns or newlines
  const sentenceContainer = document.getElementById(
    `sentences-container-${dictionaryEntryDomKey}`,
  );

  if (!sentenceContainer) {
    return;
  }
  const button = sentenceContainer.previousElementSibling?.querySelector(
    ".english-toggle-btn",
  );

  // Toggle visibility without re-fetching sentences
  if (sentenceContainer.getAttribute("data-fetched") === "true") {
    if (!button) return;

    if (sentenceContainer.style.display === "block") {
      sentenceContainer.style.display = "none";
      button.innerText = "Show Sentences";
      button.classList.remove("hide");
      button.classList.add("show");
    } else {
      sentenceContainer.style.display = "block";
      button.innerText = "Hide Sentences";
      button.classList.remove("show");
      button.classList.add("hide");
    }
    return;
  }

  sentenceContainer.innerHTML = ""; // Clear previous sentences

  const homographEntries = getHomographEntries(matchingWordEntry);
  const isExpression =
    WordClass.getWordClass(matchingWordEntry.gender) === "expression";
  const expressionAnalysis = isExpression
    ? await window.ExpressionPatterns?.getAnalysis(matchingWordEntry)
    : null;
  const sentenceForms = expressionAnalysis
    ? []
    : await window.Inflections.getSupplementalSentenceForms(
        matchingWordEntry,
        homographEntries,
      );
  const primaryHighlightForms = expressionAnalysis
    ? []
    : await window.Inflections.getSentenceForms(matchingWordEntry);
  if (!sentenceContainer.isConnected) return;
  const formMatcher = expressionAnalysis
    ? expressionAnalysis.matcher
    : window.SentenceFormMatching.createMatcher(sentenceForms);
  const primaryHighlightMatcher = expressionAnalysis
    ? expressionAnalysis.matcher
    : window.SentenceFormMatching.createMatcher(primaryHighlightForms);
  const sentenceCandidateEntries = expressionAnalysis
    ? getExpressionSentenceCandidates(matchingWordEntry, expressionAnalysis)
    : results;
  const { primary: primaryResults, supplemental: supplementalResults } =
    window.SentenceFormMatching.collectExamples(
      matchingWordEntry,
      sentenceCandidateEntries,
      formMatcher,
      100,
      homographEntries.filter((entry) => entry !== matchingWordEntry),
    );

  // Rank supplemental examples without allowing them to move ahead of the
  // primary entry's own example sentence(s).
  const rankedSupplemental = prioritizeResults(
    supplementalResults,
    trimmedWord,
    "eksempel",
    WordClass.getWordClass(matchingWordEntry.gender),
  );
  let matchingResults = [...primaryResults, ...rankedSupplemental].slice(0, 10);

  if (matchingResults.length === 0) return;

  const primaryResultSet = new Set(primaryResults);
  matchingResults.forEach((result) => {
    const cleanSentence = result.eksempel.replace(
      /<span style="color: #1f6fb3;">(.*?)<\/span>/gi,
      "$1",
    );
    const highlightMatcher = primaryResultSet.has(result)
      ? primaryHighlightMatcher
      : formMatcher;
    result.eksempel = highlightMatcher.highlight(cleanSentence);
  });

  // Create the sentence content with CEFR labels
  let sentenceContent = matchingResults
    .slice(0, 10)
    .map((result) => {
      // Split example sentences by common sentence delimiters (period, question mark, exclamation mark)
      const sentences = result.eksempel
        ? result.eksempel.split(/(?<=[.!?])\s+/)
        : [];
      const translations = result.sentenceTranslation
        ? result.sentenceTranslation.split(/(?<=[.!?])\s+/)
        : [];

      // Generate the CEFR label based on the result's CEFR value
      const cefrLabel = getSentenceCefrLabelHTML(result.CEFR);

      // For each sentence, map it to a card
      return sentences
        .map(
          (sentence, index) => `
            <div class="sentence-container">
                <div lang="nb" class="sentence-box-norwegian ${
                  !showEnglish ? "sentence-box-norwegian-hidden" : ""
                }">
                  <div class="sentence-content">
                  <div class="cefr-audio-block">

                    ${cefrLabel}
                ${
                  result.sentenceAudio === "X"
                    ? `<i class="fas fa-volume-up sentence-audio-icon"
                          data-sentence="${sentence
                            .replace(/<[^>]*>/g, "")
                            .trim()}"></i>`
                    : ""
                }        
                </div>            
                <p class="sentence">${sentence}</p>
                  </div>
                </div>
                ${
                  translations[index]
                    ? `
                <div lang="en" class="sentence-box-english ${
                  showEnglish ? "" : "hidden"
                }">
                    <p class="sentence-translation">${translations[index]}</p>
                </div>`
                    : ""
                }
            </div>
        `,
        )
        .join("");
    })
    .join("");

  if (sentenceContent) {
    sentenceContainer.innerHTML = sentenceContent;
    sentenceContainer.style.display = "block"; // Show the container

    // Find the button and display it if sentences exist
    const englishButton = button;
    if (englishButton) {
      englishButton.style.display = "block"; // Make the button visible
      englishButton.innerText = showEnglish ? "Hide English" : "Show English";
    }
  } else {
    console.warn("No content to show for the word:", trimmedWord);
  }

  sentenceContainer.setAttribute("data-fetched", "true");
}

// Spinner Control Functions
function showSpinner() {
  document.getElementById("loading-spinner").style.display = "block";
}

function hideSpinner() {
  document.getElementById("loading-spinner").style.display = "none";
}

// Prioritize results based on query position or exact match
function prioritizeResults(results, query, key, pos) {
  // Define regex for exact match and start of word
  const escapedQuery = escapeRegExp(query);
  const regexStartOfWord = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escapedQuery}`,
    "iu",
  );
  const regexExactMatch = createWholeTermRegex(query);

  // Define CEFR level order
  const CEFROrder = ["A1", "A2", "B1", "B2", "C"];

  // Separate `direct examples` where both `ord` and `pos` match
  const directExamples = results.filter(
    (r) => r.ord.toLowerCase() === query.toLowerCase() && r.pos === pos,
  );
  const otherResults = results.filter(
    (r) => r.ord.toLowerCase() !== query.toLowerCase() || r.pos !== pos,
  );

  // Sort the other results with the usual criteria
  const sortedOthers = otherResults.sort((a, b) => {
    const aText = a[key].toLowerCase();
    const bText = b[key].toLowerCase();

    // Prioritize entries with both `eksempel` and `sentenceTranslation`
    const aHasExampleAndTranslation = a.eksempel && a.sentenceTranslation;
    const bHasExampleAndTranslation = b.eksempel && b.sentenceTranslation;

    if (aHasExampleAndTranslation && !bHasExampleAndTranslation) return -1;
    if (!aHasExampleAndTranslation && bHasExampleAndTranslation) return 1;

    // First, prioritize CEFR levels (lower levels come first)
    if (a.CEFR && b.CEFR) {
      // Handle missing CEFR values by assigning a default
      const aCEFR = a.CEFR ? a.CEFR.toUpperCase() : "C";
      const bCEFR = b.CEFR ? b.CEFR.toUpperCase() : "C";

      const aCEFRIndex = CEFROrder.indexOf(aCEFR);
      const bCEFRIndex = CEFROrder.indexOf(bCEFR);

      if (aCEFRIndex !== bCEFRIndex) {
        return aCEFRIndex - bCEFRIndex;
      }
    }

    // Prioritize exact matches
    const aExactMatch = regexExactMatch.test(aText);
    const bExactMatch = regexExactMatch.test(bText);

    if (aExactMatch && !bExactMatch) {
      return -2;
    }
    if (!aExactMatch && bExactMatch) {
      return 2;
    }

    // Check if the query appears at the start of a word
    const aStartsWithWord = regexStartOfWord.test(aText);
    const bStartsWithWord = regexStartOfWord.test(bText);

    // Prioritize where the query starts a word
    if (aStartsWithWord && !bStartsWithWord) return -1;
    if (!aStartsWithWord && bStartsWithWord) return 1;

    // Otherwise, sort by the position of the query in the text (earlier is better)
    return aText.indexOf(query) - bText.indexOf(query);
  });
  // Combine direct examples at the top, followed by sorted other results
  return [...directExamples, ...sortedOthers];
}

// Update URL based on current search parameters
function updateURL(query, type, selectedPOS, story = null, word = null) {
  const url = new URL(window.location);

  // Set or remove the query parameter
  if (query) {
    url.searchParams.set("query", query);
  } else {
    url.searchParams.delete("query");
  }

  // Always set the type parameter in the URL
  if (type) {
    url.searchParams.set("type", type);
  } else {
    url.searchParams.delete("type");
  }

  // Set or remove the POS parameter
  if (selectedPOS) {
    url.searchParams.set("pos", selectedPOS);
  } else {
    url.searchParams.delete("pos");
  }

  // Set or remove the story parameter
  if (story) {
    url.searchParams.set("story", story);
  } else {
    url.searchParams.delete("story");
  }

  // Set the word parameter if a specific word entry is clicked
  if (word) {
    url.searchParams.set("word", word);

    // Update the URL without reloading the page.
    window.history.pushState({}, "", url);

    // Apply the matching word's unique SEO metadata.
    const metadataEntry = findWordEntryForMetadata(word, selectedPOS);

    updateWordMetadata(metadataEntry);

    return;
  }

  // Update the page title based on the context, if no specific word is provided
  if (story) {
    document.title = `${decodeURIComponent(story)} - Norwegian Story`;
  } else if (query) {
    document.title = `${query} - ${capitalizeType(
      type,
    )} Search - Norwegian Dictionary`;
  } else if (type) {
    document.title = `${capitalizeType(type)} - Norwegian Dictionary`;
  } else {
    document.title = "Norwegian Dictionary";
  }

  // Update the URL without reloading the page
  window.history.pushState({}, "", url);
}

// Helper function to capitalize and format type correctly
function capitalizeType(type) {
  switch (type) {
    case "words":
      return "Words";
    case "word-game":
      return "Word Game";
    case "sentences":
      return "Sentences";
    case "stories":
      return "Stories";
    case "pronunciation":
      return "Pronunciation";
    case "my-stats":
      return "My Stats";
    case "word-list":
      return "My Words";

    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

// Load the state from the URL and trigger the appropriate search or display
function loadStateFromURL() {
  const url = new URL(window.location);
  const query = url.searchParams.get("query") || ""; // Default to an empty query if not present
  const type = url.searchParams.get("type") || "words"; // Default to 'words' if not specified
  const selectedPOS = url.searchParams.get("pos") || ""; // Default to empty POS if not present
  const storyTitle = url.searchParams.get("story"); // Check for a specific story parameter
  const word = url.searchParams.get("word"); // Check for a specific word entry

  // If there's a story in the URL, display that story and exit
  if (storyTitle) {
    document.title = `${decodeURIComponent(storyTitle)} - Norwegian Story`;
    displayStory(decodeURIComponent(storyTitle)); // Display the specific story
    return; // Exit function as story is being displayed
  }

  // Function to display the word entry once data is loaded
  function displayWordIfLoaded() {
    if (results.length > 0) {
      // Check if dictionary data is loaded
      if (word) {
        // Set title to the word
        document.title = `${word} - Norwegian Dictionary`;
        showLandingCard(false);
        resultsContainer.innerHTML = "";

        // Render only matching results by filtering directly within renderWordDefinition
        renderWordDefinition(word, selectedPOS);

        clearInterval(checkDataLoaded); // Stop checking once data is loaded
        return; // Exit function to prevent further handling
      }

      // Continue with regular URL-based loading if no specific word is in the URL
      document.getElementById("search-bar").value = query;
      document.getElementById("type-select").value = type;
      if (selectedPOS) {
        document.getElementById("pos-select").value = selectedPOS;
      }

      if (type === "word-game") {
        // Same reasoning as handleTypeChange's word-game branch: treat
        // this as a fresh entry (e.g. via browser back/forward) and show
        // the mode-picker intro again rather than resuming silently.
        wordGameRoundActive = false;
        // handleTypeChange isn't called on this direct-URL path, so mirror
        // its body class toggle here too (styles.css scopes mobile rules
        // to body.word-game-mode).
        document.body.classList.toggle("word-game-mode", true);
        startWordGame();
      } else if (type === "pronunciation") {
        handleTypeChange("pronunciation"); // 👈 ensure pronunciation tab is restored
      } else if (type !== "words") {
        handleTypeChange(type);
      } else {
        // "words" skips handleTypeChange (its search/landing-page logic is
        // handled separately below), but the CEFR filter and Word Game's
        // visual state still need resetting here too — otherwise a level
        // saved from Word Game (e.g. via the browser back button) leaks
        // into the Words/Sentences CEFR filter instead of coming up blank.
        const cefrSelectEl = document.getElementById("cefr-select");
        const cefrLockEl = document.getElementById("lock-icon");
        const searchContainerInnerEl = document.getElementById(
          "search-container-inner",
        );

        if (cefrSelectEl) cefrSelectEl.value = "";
        if (cefrLockEl) cefrLockEl.style.display = "none";
        searchContainerInnerEl?.classList.remove("word-game-active");
        gameActive = false;
      }

      // Perform a search if a query is specified; otherwise, show the landing page
      if (query) {
        search();
      } else if (type === "words") {
        document.title =
          "Norwegian Dictionary | Search in Norwegian or English";
        clearContainer();
        showLandingCard(true);
      }

      clearInterval(checkDataLoaded); // Stop checking once data is loaded
    }
  }
  // Set an interval to check data load status before proceeding
  const checkDataLoaded = setInterval(displayWordIfLoaded, 100);
}

// Function to handle clicking on a search result card
function handleCardClick(event, word, pos, engelsk, definisjon) {
  // Filter to count only visible elements with the specific card class
  const visibleCards = Array.from(resultsContainer.children).filter(
    (child) =>
      child.classList.contains("definition") && child.offsetParent !== null,
  );

  // Prevent activation if only one card is displayed
  if (visibleCards.length === 1) {
    return;
  }

  // Filter results by word, POS (part of speech), and the English translation
  const clickedResult = results.filter((r) => {
    const wordMatch = r.ord.toLowerCase().trim() === word.toLowerCase().trim();
    const genderMatch =
      r.gender.toLowerCase().trim() === pos.toLowerCase().trim();
    const engelskMatch =
      r.engelsk.toLowerCase().trim() === engelsk.toLowerCase().trim();
    const definisjonMatch =
      r.definisjon.toLowerCase().trim() === definisjon.toLowerCase().trim();

    return wordMatch && genderMatch && engelskMatch && definisjonMatch;
  });

  if (clickedResult.length === 0) {
    console.error(
      `No result found for word: "${word}" with POS: "${pos}" and English: "${engelsk}"`,
    );
    return;
  }

  // Clear all other results and keep only the clicked card
  resultsContainer.innerHTML = ""; // Clear the container

  if (latestMultipleResults) {
    const backDiv = document.createElement("div");
    backDiv.className = "back-navigation";
    backDiv.tabIndex = 0;
    backDiv.setAttribute("role", "button");

    // Create the icon element
    const icon = document.createElement("i");
    icon.className = "fas fa-chevron-left";

    // Create the text element
    const text = document.createTextNode(
      ` Back to Results for "${latestMultipleResults}"`,
    );

    // Append icon and text to backDiv
    backDiv.appendChild(icon);
    backDiv.appendChild(text);

    // Append backDiv to resultsContainer
    resultsContainer.appendChild(backDiv);
  }

  // Clear the search bar
  clearInput();

  // Display the clicked result
  displaySearchResults(clickedResult); // This ensures only the clicked card remains

  // Update the URL to reflect the clicked entry
  updateURL("", "words", pos, null, word.split(",")[0].trim());
}

// Initialization of the dictionary data and event listeners
window.onload = function () {
  const initialURL = new URL(window.location.href);
  const initialType = initialURL.searchParams.get("type");
  const initialStoryRoute =
    initialType === "stories" || initialURL.searchParams.has("story");

  // Check if the buttons exist in the DOM
  const searchBtn = document.getElementById("search-btn");
  const randomBtn = document.getElementById("my-words-nav-btn");
  const searchBar = document.getElementById("search-bar");
  const clearBtn = document.getElementById("clear-btn");
  const typeSelect = document.getElementById("type-select");
  const posSelect = document.getElementById("pos-select");
  const cefrSelect = document.getElementById("cefr-select");
  const typeFilterContainer = document.querySelector(".type-filter");
  const posFilterContainer = document.querySelector(".pos-filter");
  const cefrFilterContainer = document.querySelector(".cefr-filter");

  // Most loads finish well under a second — the dictionary CSV is cached
  // in IndexedDB after the first visit, and even a fresh fetch is often
  // fast. Disabling the toolbar immediately, only to re-enable it a
  // moment later, reads as a flash of flicker across several elements at
  // once rather than a deliberate loading state. Delaying it behind a
  // short grace period — and skipping it entirely if data arrives first,
  // via the clearTimeout below — means a fast load shows no loading UI at
  // all, while a genuinely slow one still gets a clear, stable signal
  // instead of a flash.
  const LOADING_STATE_DELAY_MS = 300;
  let loadingStateTimeoutId = null;

  if (
    searchBtn &&
    randomBtn &&
    searchBar &&
    clearBtn &&
    posSelect &&
    cefrSelect
  ) {
    loadingStateTimeoutId = window.setTimeout(() => {
      disableSearchControls();
      // Explains the disabled state rather than leaving it silently greyed
      // out — restored (to the floating-label blank) once loaded below, or
      // immediately for the stories route, which doesn't need this data.
      searchBar.placeholder = "Loading dictionary…";
      randomBtn.disabled = true;
      posSelect.disabled = true;
      cefrSelect.disabled = true;
      typeSelect.disabled = true;

      // randomBtn's own grayed/not-allowed styling comes from the global
      // button:disabled rule in styles.css, same as searchBtn/clearBtn above.
      typeFilterContainer.classList.add("disabled");
      posFilterContainer.classList.add("disabled"); // Add the 'disabled' class to visually disable POS filter
      cefrFilterContainer.classList.add("disabled"); // Add the 'disabled' class to visually disable CEFR filter

      /*
       * Stories have their own data and can be searched or filtered before the
       * much larger dictionary finishes loading. Keep the type switch disabled
       * briefly so another section cannot be opened without its data.
       */
      if (initialStoryRoute) {
        enableSearchControls();
        searchBar.placeholder = " ";
        cefrSelect.disabled = false;
        cefrFilterContainer.classList.remove("disabled");
      }
    }, LOADING_STATE_DELAY_MS);
  }

  const loadDictionaryData = () => fetchAndLoadDictionaryData();
  if (initialStoryRoute) {
    window.setTimeout(loadDictionaryData, 1000);
  } else {
    loadDictionaryData();
  }

  // Wait for the data to be fetched before triggering the search
  const checkDataLoaded = setInterval(() => {
    if (dictionaryLoadFailed) {
      // showDictionaryLoadError() already ran from inside the failed fetch
      // itself — just stop polling instead of waiting forever.
      clearInterval(checkDataLoaded);
      return;
    }

    if (results.length > 0) {
      // Ensure results are loaded
      clearInterval(checkDataLoaded);

      // Data arrived before the grace period elapsed — cancel the pending
      // disabled-state timeout so it never gets a chance to flash in. The
      // enable calls below are a harmless no-op if it never fired anyway.
      if (loadingStateTimeoutId !== null) {
        window.clearTimeout(loadingStateTimeoutId);
        loadingStateTimeoutId = null;
      }

      // The verified word-form snapshot is deliberately lower priority than
      // the main dictionary. Warm it only after the dictionary is usable; a
      // learner who opens a table first will reuse the same in-flight request.
      const preloadInflections = async () => {
        await window.Inflections?.preload();
        await window.Inflections?.prepareSearchIndex();
      };
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(preloadInflections, { timeout: 4000 });
      } else {
        window.setTimeout(preloadInflections, 0);
      }

      // Enable the buttons once data is fully loaded
      // Enable the buttons and filters once data is fully loaded
      enableSearchControls();
      searchBar.placeholder = " ";
      randomBtn.disabled = false;
      typeSelect.disabled = false;
      posSelect.disabled = false;
      cefrSelect.disabled = false;

      typeFilterContainer.classList.remove("disabled"); // Remove 'disabled' class for POS filter
      posFilterContainer.classList.remove("disabled"); // Remove 'disabled' class for POS filter
      cefrFilterContainer.classList.remove("disabled"); // Remove 'disabled' class for CEFR filter

      // Stories are initialized by stories.js and must not be rendered twice.
      if (!initialStoryRoute) {
        loadStateFromURL();
      }
    }
  }, 100);

  // Add event listener to POS filter dropdown
  document
    .getElementById("pos-select")
    .addEventListener("change", handlePOSChange);

  // Add event listener to POS filter dropdown
  document
    .getElementById("cefr-select")
    .addEventListener("change", handleCEFRChange);

  // Add event listener to the search bar to trigger handleKey on key press
  document.getElementById("search-bar").addEventListener("keyup", handleKey);

  document.addEventListener("click", (event) => {
    if (event.target.closest(".back-navigation")) {
      search(latestMultipleResults);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (
      (event.key === "Enter" || event.key === " ") &&
      event.target.closest(".back-navigation")
    ) {
      event.preventDefault();
      search(latestMultipleResults);
    }
  });
};

window.addEventListener("popstate", () => {
  loadStateFromURL(); // Re-load everything based on current URL
});

// Fully emulates the click-to-expand behavior for a single result: shows
// just that entry and updates the URL/title to match. `canonicalWord` is
// read for the URL only after displaySearchResults runs, matching this
// code's previous behavior of reading `.gender` post-mutation (that call
// formats it, e.g. into "noun - en").
function openDictionaryEntry(entry, canonicalWord) {
  latestMultipleResults = null;
  resultsContainer.innerHTML = ""; // Clear previous results
  displaySearchResults([entry]);
  updateURL(null, "words", entry.gender.toLowerCase(), null, canonicalWord);
}

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!target.classList.contains("clickable-definition-word")) return;

  const word = target.getAttribute("data-word").toLowerCase();
  const searchInput = document.getElementById("search-bar");
  if (!searchInput) return;

  searchInput.value = "";
  clearInput();

  // Find exact matches for the clicked word
  const exactMatches = results.filter((r) =>
    r.ord
      .toLowerCase()
      .split(",")
      .map((s) => s.trim())
      .includes(word),
  );

  if (exactMatches.length === 1) {
    openDictionaryEntry(exactMatches[0], word);
    return;
  }

  // Zero literal matches only -- when the clicked spelling is ALREADY a
  // headword in its own right (exactMatches.length > 1, e.g. "ens" is both
  // an adjective and a possessive), that's a genuine disambiguation the
  // learner should see via the regular search list, not something an
  // inflection guess should silently resolve past. Jumping straight to a
  // same-spelling inflected form of some other, unrelated word (e.g. "ens"
  // is also the imperative of the rare verb "ense") would bury the two
  // senses that were actually already known matches.
  if (exactMatches.length === 0) {
    // No literal citation match at all. An inflected multi-word expression
    // ("følger med" -> "følge med") is already handled at render time (see
    // upgradeDefinitionExpressionSpans), so what's left here is a single
    // inflected word on its own ("kastet" -> "kaste"). Resolve it through
    // the same reverse index Stories' click-to-define already relies on
    // before falling back to a blind full-dictionary search.
    const officialResolution = await window.Inflections?.findLemmas(word);
    const inflectedMatches = [];
    for (const { lemma, wordClass } of officialResolution?.matches || []) {
      if (lemma === word) continue;
      for (const candidate of results) {
        if (
          WordClass.getWordClass(candidate.gender) === wordClass &&
          candidate.ord
            .toLowerCase()
            .split(",")
            .map((s) => s.trim())
            .includes(lemma)
        ) {
          inflectedMatches.push(candidate);
        }
      }
    }

    if (inflectedMatches.length === 1) {
      openDictionaryEntry(
        inflectedMatches[0],
        inflectedMatches[0].ord.split(",")[0].trim().toLowerCase(),
      );
      return;
    }
  }

  search(word); // fallback to regular multi-result search
});

document.addEventListener("click", (event) => {
  if (event.target.classList.contains("sentence-audio-icon")) {
    stopAllAudio();
    const text = event.target.dataset.sentence;
    let audioUrl;

    // Decide if this is a word or a sentence based on where the icon lives
    if (event.target.closest(".pronunciation")) {
      // Word-level audio
      audioUrl = buildWordAudioUrl(text);
    } else {
      // Sentence-level audio
      audioUrl = buildPronAudioUrl(text);
    }

    playTrackedAudio(audioUrl);
  }
});
