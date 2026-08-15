// Global Variables
let results = [];
let isEnglishVisible = true;
let latestMultipleResults = null;
const resultsContainer = document.getElementById("results-container");

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
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const COMMON_NORWEGIAN_FORM_ALIASES = new Map([
  ["boka", "bok"],
  ["boken", "bok"],
  ["bøkene", "bok"],
  ["bøker", "bok"],
  ["ble", "bli"],
  ["blir", "bli"],
  ["blitt", "bli"],
  ["drakk", "drikke"],
  ["drukket", "drikke"],
  ["dro", "dra"],
  ["dratt", "dra"],
  ["fant", "finne"],
  ["funnet", "finne"],
  ["fikk", "få"],
  ["fått", "få"],
  ["gikk", "gå"],
  ["gått", "gå"],
  ["gjorde", "gjøre"],
  ["gjort", "gjøre"],
  ["hadde", "ha"],
  ["hatt", "ha"],
  ["holdt", "holde"],
  ["kom", "komme"],
  ["kommet", "komme"],
  ["leste", "lese"],
  ["lest", "lese"],
  ["løp", "løpe"],
  ["løpt", "løpe"],
  ["sa", "si"],
  ["sagt", "si"],
  ["skrev", "skrive"],
  ["skrevet", "skrive"],
  ["sov", "sove"],
  ["sovet", "sove"],
  ["spiser", "spise"],
  ["spist", "spise"],
  ["spiste", "spise"],
  ["sto", "stå"],
  ["stod", "stå"],
  ["stått", "stå"],
  ["tatt", "ta"],
  ["tok", "ta"],
  ["var", "være"],
  ["visste", "vite"],
  ["vært", "være"],
]);

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

  COMMON_NORWEGIAN_FORM_ALIASES.forEach((resolvedTerm, sourceTerm) => {
    if (wordSearchIndex.norwegianExact.has(resolvedTerm)) {
      addNorwegianKeyboardTerm(sourceTerm, resolvedTerm, true);
    }
  });
}

function hasExactSearchTerm(query) {
  return (
    wordSearchIndex.norwegianExact.has(query) ||
    wordSearchIndex.englishExact.has(query)
  );
}

function resolveWordSearchQuery(originalQuery) {
  if (hasExactSearchTerm(originalQuery)) {
    return { query: originalQuery, reason: "exact" };
  }

  const formAlias = COMMON_NORWEGIAN_FORM_ALIASES.get(originalQuery);
  if (formAlias && wordSearchIndex.norwegianExact.has(formAlias)) {
    return { query: formAlias, reason: "word-form" };
  }

  const keyboardTerms =
    wordSearchIndex.norwegianKeyboardTerms.get(originalQuery);
  if (keyboardTerms && keyboardTerms.size === 1) {
    return { query: [...keyboardTerms][0], reason: "keyboard" };
  }

  return { query: originalQuery, reason: "unresolved" };
}

function hasSearchableCharacters(value) {
  return /[\p{L}\p{N}]/u.test(value);
}

function getSearchMatchRank(entry, query) {
  const norwegianTerms = splitSearchTerms(entry.ord);
  const englishTerms = splitSearchTerms(entry.engelsk);

  if (norwegianTerms.includes(query)) return 0;
  if (englishTerms.includes(query)) return 1;
  if (norwegianTerms.some((term) => term.startsWith(query))) return 2;
  if (englishTerms.some((term) => term.startsWith(query))) return 3;
  if (norwegianTerms.some((term) => term.includes(query))) return 4;
  if (englishTerms.some((term) => term.includes(query))) return 5;

  return 6;
}

function compareWordSearchResults(a, b, query) {
  const rankDifference =
    getSearchMatchRank(a, query) - getSearchMatchRank(b, query);
  if (rankDifference) return rankDifference;

  const cefrOrder = { A1: 1, A2: 2, B1: 3, B2: 4, C: 5 };
  const cefrDifference = (cefrOrder[a.CEFR] || 99) - (cefrOrder[b.CEFR] || 99);
  if (cefrDifference) return cefrDifference;

  return String(a.ord).localeCompare(String(b.ord), "nb");
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
  if (query.length < 2 || query.length > 32) return [];

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

// All grammatical-gender values a noun's `gender` field can take, including
// entries that list more than one article (e.g. "en-et"). Used both for
// exact-match POS checks (below) and, via isNounGenderValue, for substring
// checks against raw/unnormalized gender strings elsewhere in this file.
const NOUN_GENDER_FORMS = ["en", "et", "ei", "en-et", "en-ei", "ei-et", "en-ei-et"];

function isNounGenderValue(genderValue = "") {
  const normalized = String(genderValue).toLowerCase();
  return NOUN_GENDER_FORMS.some((form) => normalized.includes(form));
}

function normalizeWordMetadataPOS(pos = "") {
  return String(pos)
    .trim()
    .toLowerCase()
    .replace(/^noun\s*-\s*/i, "");
}

function getWordClassForMetadata(pos = "") {
  const normalizedPOS = normalizeWordMetadataPOS(pos);

  return [...NOUN_GENDER_FORMS, "noun"].includes(normalizedPOS)
    ? "noun"
    : normalizedPOS;
}

function findWordEntryForMetadata(word, selectedPOS = "") {
  const normalizedWord = String(word).trim().toLowerCase();

  const normalizedSelectedPOS = normalizeWordMetadataPOS(selectedPOS);

  const nounForms = NOUN_GENDER_FORMS;

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
    const entryPOS = normalizeWordMetadataPOS(entry.gender);

    if (normalizedSelectedPOS === "noun") {
      return nounForms.includes(entryPOS);
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

  const canonicalPOS = normalizeWordMetadataPOS(entry.gender);

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
let sentenceIndex = null; // Map<string, Uint32Array | number[]>

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

// Debounce function to limit how often search is triggered
function debounceSearchTrigger(func, delay) {
  clearTimeout(this.debounceTimer);
  this.debounceTimer = setTimeout(func, delay);
}

// Handle the key input, performing a search on 'Enter' or debouncing otherwise
function handleKey(event) {
  // Call search function when 'Enter' is pressed or debounce it otherwise
  debounceSearchTrigger(() => {
    if (event.key === "Enter") {
      search();
    }
  }, 300); // Delay of 300ms before calling search()
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
function togglePronunciationGuide() {
  const pronunciationWrapper = document.querySelector(".pronunciation-wrapper"); // Target the wrapper div
  pronunciationWrapper.classList.toggle("hidden"); // Toggle hidden class
}

// Filter results based on selected part of speech (POS)
function filterResultsByPOS(results, selectedPOS) {
  if (!selectedPOS) return results;

  return results.filter((r) => {
    // Handle nouns based on gender
    if (selectedPOS === "noun") {
      return r.gender && isNounGenderValue(r.gender);
    }

    // Handle all other POS types like "verb," "adjective," etc.
    return (
      r.gender && r.gender.toLowerCase().startsWith(selectedPOS.toLowerCase())
    );
  });
}

// Helper function to format 'gender' (grammatical gender) based on its value
function formatGender(gender) {
  return gender &&
    ["en", "et", "ei"].includes(gender.substring(0, 2).toLowerCase())
    ? "noun - " + gender
    : gender;
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

    if (refreshCurrentView) displayStoryList();
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
// so localStorage is shared across them too — an unprefixed key here would
// let a visit to another language site overwrite this one's cached data.
const WORD_CSV_CACHE_KEY = "wordDataCsvNorwegian";
const WORD_CSV_CACHE_TIME_KEY = "wordDataCsvTimestampNorwegian";
const WORD_CSV_CACHE_MAX_AGE = 6 * 60 * 60 * 1000; // 6 hours, matching stories.js

// Read the cached raw CSV text (not parsed entries — a parsed copy of the
// ~29,000-row dictionary would run several MB larger than the CSV itself
// purely from repeated JSON key names, risking localStorage's quota).
// Returns null on a cache miss, a parse error, or if the cache is stale.
function readCachedWordCSV() {
  try {
    const cachedText = localStorage.getItem(WORD_CSV_CACHE_KEY);
    if (!cachedText) return null;

    const timestamp = Number(localStorage.getItem(WORD_CSV_CACHE_TIME_KEY)) || 0;
    if (Date.now() - timestamp > WORD_CSV_CACHE_MAX_AGE) return null;

    return cachedText;
  } catch (error) {
    console.warn("Cached word data could not be read.", error);
    return null;
  }
}

// Best-effort only: if this fails (quota exceeded, private browsing, etc.)
// the app keeps working, it just re-fetches next time instead of caching.
function cacheWordCSV(csvText) {
  try {
    localStorage.setItem(WORD_CSV_CACHE_KEY, csvText);
    localStorage.setItem(WORD_CSV_CACHE_TIME_KEY, String(Date.now()));
  } catch (error) {
    // Don't leave a stale/partial entry occupying quota for next time.
    try {
      localStorage.removeItem(WORD_CSV_CACHE_KEY);
      localStorage.removeItem(WORD_CSV_CACHE_TIME_KEY);
    } catch (cleanupError) {
      // Ignore — best-effort cleanup only.
    }
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

  const cachedCSV = readCachedWordCSV();

  if (cachedCSV) {
    parseCSVData(cachedCSV);
    return;
  }

  try {
    const localResponse = await fetch("norwegianWords.csv");
    if (!localResponse.ok)
      throw new Error(`HTTP error! Status: ${localResponse.status}`);
    const localData = await localResponse.text();
    cacheWordCSV(localData);
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
        results = resultsFromParse.data.map((entry) => {
          entry.ord = entry.ord.trim(); // Ensure the word is trimmed
          return entry;
        });

        buildWordSearchIndex();
        updateLandingWordCount();

        /*
         * Sentence Search already builds these structures on demand.
         * Avoid constructing the entire sentence corpus and search index
         * for visitors who only use words, stories, lists, or the game.
         */
        sentenceCorpus = [];
        sentenceIndex = null;
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

// Swaps the landing page's static "29,000+" placeholder for the real,
// exact count once the dictionary has actually loaded.
function updateLandingWordCount() {
  const el = document.getElementById("landing-word-count");
  if (!el || !results.length) return;

  el.textContent = `${results.length.toLocaleString("en-US")} Norwegian words, definitions, and example sentences.`;
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
  const idx = new Map();
  for (const row of sentenceCorpus) {
    const seen = new Set();
    for (const tok of [...tokenize(row.noNorm), ...tokenize(row.enNorm)]) {
      if (tok.length === 0) continue;
      if (seen.has(tok)) continue; // avoid dup adds for same row
      seen.add(tok);
      let postings = idx.get(tok);
      if (!postings) {
        postings = [];
        idx.set(tok, postings);
      }
      postings.push(row.id);
    }
  }
  // Optionally compact to typed arrays if large
  for (const [k, list] of idx) {
    if (list.length > 1024) idx.set(k, Uint32Array.from(list));
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

function buildFeedbackMessage({ source, word, pos, cefr, category, details }) {
  const parts = [];

  if (source) {
    parts.push(`[${source}]`);
  }

  if (word) {
    const attributes = [pos, cefr].filter(Boolean).join(", ");
    parts.push(attributes ? `"${word}" (${attributes})` : `"${word}"`);
  }

  if (category) {
    // "Category" rather than "Issue" — general feedback covers things
    // like feature requests and compliments, not just problems.
    parts.push(`— Category: ${category}`);
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

function openWordCardFeedbackDialog(triggerElement, word, pos, cefr) {
  openFeedbackDialog({ source: "Word Card", word, pos, cefr, triggerElement });
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
  showWordInTitle = true,
  categories = FEEDBACK_CATEGORIES,
  dialogTitle,
  categoryQuestion = "What's the issue?",
  detailsPlaceholder = "What's wrong, exactly?",
  successMessage = "Thanks — your report was sent.",
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
      buildFeedbackMessage({ source, word, pos, cefr, category, details }),
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
                <div class="sentence-box-norwegian ${
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
        <div class="sentence-box-english ${isEnglishVisible ? "" : "hidden"}">
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

  const wordSearchResolution =
    selector === "words"
      ? resolveWordSearchQuery(originalQuery)
      : { query: originalQuery, reason: "exact" };
  const query = wordSearchResolution.query;
  const selectedPOS = document.getElementById("pos-select")
    ? document.getElementById("pos-select").value.toLowerCase()
    : "";
  const selectedCEFR = document.getElementById("cefr-select")
    ? document.getElementById("cefr-select").value.toUpperCase()
    : ""; // Fetch the selected CEFR level
  const type = document.getElementById("type-select").value; // Get the search type (words or sentences)
  const normalizedQueries = [normalizeSearchText(query)]; // Use only the base query for matching

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
    const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);

    let ids = null;
    for (const t of terms) {
      const match = sentenceIndex.get(t) || [];
      const asArray = ArrayBuffer.isView(match) ? Array.from(match) : match;
      ids =
        ids === null
          ? new Set(asArray)
          : new Set(asArray.filter((x) => ids.has(x)));
    }

    // If nothing matched, default to empty
    if (!ids || ids.size === 0) {
      ids = [];
    }

    // Materialize rows
    const rowsAll = [];
    for (const sid of ids) rowsAll.push(sentenceCorpus[sid]);

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
        r.noNorm.includes(normalizeSearchText(query)) ||
        r.enNorm.includes(normalizeSearchText(query));
      if (inOrder) {
        exact.push(r);
      } else {
        // fallback: all words must still appear somewhere
        const matchesAll = terms.every(
          (t) => r.noNorm.includes(t) || r.enNorm.includes(t),
        );
        if (matchesAll) {
          partial.push(r);
        }
      }
    } // CEFR order for sorting
    const cefrOrder = { A1: 1, A2: 2, B1: 3, B2: 4, C: 5 };

    // Sort helper: lower CEFR first, then leave relative order intact
    function sortByCEFR(arr) {
      return arr.sort((a, b) => {
        const aVal = cefrOrder[a.cefr] || 99;
        const bVal = cefrOrder[b.cefr] || 99;
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

    renderSentenceMatchesFromCorpus(combined, query);

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

    // Filter results by query and selected POS for words
    matchingResults = cleanResults.filter((r) => {
      // Exact and partial match logic
      const matchesQuery = normalizedQueries.some((variation) => {
        const exactRegex = createWholeTermRegex(variation); // Exact match for Unicode words
        const partialRegex = new RegExp(escapeRegExp(variation), "iu"); // Literal partial match for larger words
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
      });

      // Handle POS filtering for nouns and other parts of speech
      return (
        matchesQuery &&
        (!selectedPOS ||
          (selectedPOS === "noun" && isNounGenderValue(r.gender)) ||
          r.gender.toLowerCase().includes(selectedPOS)) &&
        (!selectedCEFR || r.CEFR === selectedCEFR)
      );
    });

    matchingResults.sort((a, b) => compareWordSearchResults(a, b, query));

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
      // Only use spelling distance after exact, alias, prefix, and substring matching fail.
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
          (!selectedPOS ||
            (selectedPOS === "noun" && isNounGenderValue(r.gender)) ||
            r.gender.toLowerCase().includes(selectedPOS)) &&
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
          compareWordSearchResults(a, b, query)
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

function enableSearchControls() {
  const searchBar = document.getElementById("search-bar");
  const searchBtn = document.getElementById("search-btn");
  const clearBtn = document.getElementById("clear-btn");

  if (!searchBar || !searchBtn || !clearBtn) return;

  searchBar.disabled = false;
  searchBtn.disabled = false;
  clearBtn.disabled = false;

  searchBar.style.color = "";
  searchBar.style.cursor = "text";
  searchBtn.style.color = "";
  searchBtn.style.cursor = "pointer";
  clearBtn.style.color = "";
  clearBtn.style.cursor = "pointer";
}

function disableSearchControls() {
  const searchBar = document.getElementById("search-bar");
  const searchBtn = document.getElementById("search-btn");
  const clearBtn = document.getElementById("clear-btn");

  if (!searchBar || !searchBtn || !clearBtn) return;

  searchBar.disabled = true;
  searchBtn.disabled = true;
  clearBtn.disabled = true;

  searchBar.style.color = "#ccc";
  searchBar.style.cursor = "not-allowed";
  searchBtn.style.color = "#ccc";
  searchBtn.style.cursor = "not-allowed";
  clearBtn.style.color = "#ccc";
  clearBtn.style.cursor = "not-allowed";
}

// Handle change in search type (words/sentences)
function handleTypeChange(type, options = {}) {
  // If type is not passed in (e.g., called from dropdown), get it from the dropdown
  type = type || document.getElementById("type-select").value;
  const shouldRenderStories = options.renderStories !== false;
  const shouldRenderInitialContent = options.renderInitialContent !== false;
  // Give the page a dedicated class while Word Game is selected.
  document.body.classList.toggle("word-game-mode", type === "word-game");
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
    isEnglishVisible = true;
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
    isEnglishVisible = true;
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
  } else if (type === "word-list") {
    // Hide controls that Word List does not use.
    genreFilterContainer.style.display = "none";
    randomBtn.style.display = "block";

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

  if (defText.includes(";")) {
    const items = defText
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
    return (
      `<ul class="definition-list">` +
      items
        .map((item) => `<li>${item.split(/\s+/).map(wrapToken).join(" ")}</li>`)
        .join("") +
      `</ul>`
    );
  }

  return defText
    .split(/\s+/)
    .map((token) => {
      if (token.includes("/") && !token.startsWith("http")) {
        return token
          .split("/")
          .map((subToken) => wrapToken(subToken))
          .join("/");
      } else {
        return wrapToken(token);
      }
    })
    .join(" ");
}

// Render a list of results (words)
function displaySearchResults(results, query = "") {
  query = query.toLowerCase().trim(); // Ensure the query is lowercased and trimmed
  const defaultResult = results.length <= 1; // Determine if there are multiple results
  const multipleResults = results.length > 1; // Determine if there are multiple results

  let htmlString = "";

  // Limit to a maximum of 10 results
  results.slice(0, 10).forEach((result) => {
    result.gender = formatGender(result.gender);
    // Directly handle the POS based on the gender field
    result.pos = isNounGenderValue(result.gender)
      ? "noun"
      : result.gender.toLowerCase();

    // Convert the word to lowercase and trim spaces when generating the ID
    const normalizedWord = result.ord.toLowerCase().trim();

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
    const hasSentencesPlaceholder = `<button class="sentence-btn english-toggle-btn" style="display: none;" onclick="event.stopPropagation(); toggleEnglishTranslations('${normalizedWord}')">Show English</button>`;

    const escapedGender = result.gender.replace(/'/g, "\\'").trim();
    const escapedEngelsk = result.engelsk.replace(/'/g, "\\'").trim();
    const handleCardClickArgs = `'${escapedWord}', '${escapedGender}', '${escapedEngelsk}', this.querySelector('.${multipleResultsDefinitionText}')?.textContent?.trim() || ''`;

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
                  <div class="word-text-block">
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
                          )}">${result.CEFR}</div>`
                        : ""
                    } 
                </h2>
                ${
                  result.definisjon
                    ? `<p class="${multipleResultsDefinitionText}">${
                        defaultResult
                          ? makeDefinitionClickable(result.definisjon)
                          : result.definisjon
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
                          )};">${result.CEFR}</span></p>`
                        : ""
                    }
                    <button
                      type="button"
                      class="report-issue-btn"
                      onclick="event.stopPropagation(); openWordCardFeedbackDialog(this, '${escapedWord}', '${result.pos}', '${result.CEFR || ""}')"
                      onkeydown="event.stopPropagation()"
                    ><i class="fas fa-flag"></i> Report an issue</button>
                </div>
                </div>
                                <!-- Show "Show Sentences" button only if sentences exist -->
                    <div class="${multipleResultsHiddenContent}">
                        ${hasSentencesPlaceholder}
                    </div>       
            <!-- Sentences container is now outside the definition block -->
            <div class="sentences-container" id="sentences-container-${normalizedWord}"></div>
        `;
  });
  appendToContainer(htmlString);

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
        singleResult.ord,
        singleResult.pos,
        isEnglishVisible,
      );
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

  // Toggle visibility based on the global isEnglishVisible state
  isEnglishVisible = !isEnglishVisible;

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

// Function to find the gender of a word
function getWordGender(word) {
  const matchingWord = results.find(
    (result) => result.ord.toLowerCase() === word.toLowerCase(),
  );
  return matchingWord ? matchingWord.gender : "unknown"; // Default to 'unknown' if not found
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
    ? `<div class="sentence-cefr-label ${cefrClass}">${cefrLevel}</div>`
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

// Utility function to generate word variations for verbs ending in -ere and handle adjective/noun forms
function generateWordVariationsForSentences(word, pos) {
  const variations = [];

  // Split the word into parts in case it's a phrase (e.g., "vedtatt sannhet")
  const wordParts = word.split(" ");

  // Handle phrases with slashes (e.g., "være/vær så snill", "logge inn/på")
  if (word.includes("/")) {
    // Split on the slash and create variations for both parts
    const [firstPart, secondPart] = word.split("/");
    const restOfPhrase = word.split(" ").slice(1).join(" "); // Get the rest of the phrase after the first word

    variations.push(`${firstPart} ${restOfPhrase}`); // Add the first part with the rest of the phrase
    variations.push(`${secondPart} ${restOfPhrase}`); // Add the second part with the rest of the phrase
    return variations;
  }

  // Reflexive pronouns to handle reflexive verbs with variations (e.g., "seg", "deg", "meg", "oss", etc.)
  const reflexivePronouns = ["seg", "deg", "meg", "oss", "dere"];

  // If it's a single word
  if (wordParts.length === 1) {
    const singleWord = wordParts[0];
    let stem = singleWord;
    let gender = getWordGender(singleWord);

    if (singleWord.length <= 2) {
      // Handle the case where the word is too short to generate meaningful variations
      console.warn(`Word "${singleWord}" is too short to generate variations.`);
      variations.push(singleWord); // Just return the word as is
      return variations;
    }

    if (pos === "noun" && (gender.includes("en") || gender.includes("et") || gender.includes("ei"))) {
      // A word's gender field can list more than one article (e.g. "en-et"),
      // so each applicable pattern below is additive rather than exclusive —
      // this only adds extra highlight candidates, so an extra guess that
      // never appears in a sentence is harmless.
      if (gender.includes("ei")) {
        if (singleWord.endsWith("e")) {
          stem = singleWord.slice(0, -1); // Remove the final -e from the word
        }
        variations.push(
          `${stem}`, // setning
          `${stem}e`, // jente
          `${stem}a`, // jenta
          `${stem}en`, // jenten
          `${stem}er`, // jenter
          `${stem}ene`, // jentene
        );
      }

      if (gender.includes("en")) {
        if (singleWord.endsWith("e")) {
          const enStem = singleWord.slice(0, -1);
          variations.push(
            `${singleWord}`, // type
            `${enStem}en`, // typen
            `${enStem}er`, // typer
            `${enStem}ene`, // typene
          );
        } else {
          variations.push(
            `${singleWord}`, // tilskuer / hund
            `${singleWord}en`, // tilskueren / hunden
            `${singleWord}er`, // hunder
            `${singleWord}e`, // tilskuere (the common "-er" agent-noun plural)
            `${singleWord}ene`, // hundene
            `${singleWord}ne`, // tilskuerne (the common "-er" agent-noun definite plural)
          );
        }
      }

      if (gender.includes("et")) {
        if (singleWord.endsWith("e")) {
          variations.push(
            `${singleWord}`, // eple
            `${singleWord}t`, // eplet
            `${singleWord}r`, // epler
            `${singleWord}ne`, // eplene
          );
        } else {
          variations.push(
            `${singleWord}`, // hus
            `${singleWord}et`, // huset
            `${singleWord}er`, // (rare pluralizing et-words)
            `${singleWord}ene`, // husene
          );
        }
      }
      // Handle verb variations if the word is a verb and ends with "e"
    } else if (pos === "verb") {
      if (singleWord.endsWith("e")) {
        stem = singleWord.slice(0, -1); // Remove the final -e from the verb
      }
      variations.push(
        `${stem}`, // imperative: anglifiser
        `${stem}a`, // past tense: snakka
        `${stem}e`, // infinitive: anglifisere
        `${stem}er`, // present tense: anglifiserer
        `${stem}es`, // passive: anglifiseres
        `${stem}et`, // past tense: snakket
        `${stem}r`, // present tense: bor
        `${stem}t`, // past participle: anglifisert
        `${stem}te`, // past tense: anglifiserte
      );
    } else {
      // For non-verbs, just add the word itself as a variation
      variations.push(singleWord);
    }

    // If it's a phrase (e.g., "vedtatt sannhet"), handle each part separately
  } else if (wordParts.length >= 2) {
    const [firstWord, secondWord, ...restOfPhrase] = wordParts;
    const remainingPhrase = restOfPhrase.join(" ");

    // Handle reflexive verbs like "beklage seg" with variations for reflexive pronouns
    if (reflexivePronouns.includes(secondWord)) {
      let stem;
      // Only remove the final 'e' if it exists; otherwise, use the full word (e.g., for "bry")
      if (firstWord.endsWith("e")) {
        stem = firstWord.slice(0, -1); // Remove the final -e from the verb
      } else {
        stem = firstWord; // Use the full word if it doesn't end with 'e'
      }
      // Add variations for all reflexive pronouns (seg, deg, meg, etc.)
      reflexivePronouns.forEach((reflexive) => {
        variations.push(
          `${stem}e ${reflexive} ${remainingPhrase}`, // infinitive
          `${stem}er ${reflexive} ${remainingPhrase}`, // present tense
          `${stem}te ${reflexive} ${remainingPhrase}`, // past tense
          `${stem}t ${reflexive} ${remainingPhrase}`, // past participle
          `${stem}et ${reflexive} ${remainingPhrase}`, // past tense/past participle
          `${stem}a ${reflexive} ${remainingPhrase}`, // past tense/past participle
          `${stem} ${reflexive} ${remainingPhrase}`, // imperative
          `${stem}es ${reflexive} ${remainingPhrase}`, // passive
        );
      });
    } else if (wordParts.length === 2) {
      // Handle adjective inflection (e.g., "vedtatt" -> "vedtatte")
      const adjectiveVariations = [firstWord, firstWord.replace(/t$/, "te")]; // Add plural/adjective form

      // Handle noun pluralization (e.g., "sannhet" -> "sannheter")
      const nounVariations = [secondWord, secondWord + "er"]; // Add plural form for nouns

      // Combine all variations of adjective and noun
      adjectiveVariations.forEach((adj) => {
        nounVariations.forEach((noun) => {
          variations.push(`${adj} ${noun}`);
        });
      });
    } else {
      // For other longer phrases, just return the phrase as is
      variations.push(word);
    }
  } else {
    // Add the original phrase as a variation (no transformation needed for long phrases)
    variations.push(word);
  }

  return variations;
}

// Render a single sentence
function renderSentenceMatchesFromCorpus(rows, query) {
  clearContainer();
  const safeQuery = escapeHTML(query);

  if (!rows.length) {
    document.getElementById("results-container").innerHTML = `
      <div class="definition error-message">
        <h2 class="word-gender">Error <span class="gender">No Matching Sentences</span></h2>
        <p>No sentences found containing "${safeQuery}".</p>
      </div>`;
    return;
  }

  let html = `
    <div class="result-header">
      <h2>Sentence Results for "${safeQuery}"</h2>
    </div>
    <button class="sentence-btn english-toggle-btn" onclick="toggleEnglishTranslations()">
      ${isEnglishVisible ? "Hide English" : "Show English"}
    </button>
  `;

  for (const row of rows) {
    const cefr = row.cefr;
    const cefrLabel = getSentenceCefrLabelHTML(cefr);

    const noHTML = highlightQuery(row.no, query);
    const enHTML = row.en ? highlightQuery(row.en, query) : "";

    html += `
      <div class="sentence-container">
        <div class="sentence-box-norwegian ${
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
          <div class="sentence-box-english ${isEnglishVisible ? "" : "hidden"}">
            <p class="sentence">${enHTML}</p>
          </div>`
            : ""
        }
      </div>
    `;
  }

  document.getElementById("results-container").innerHTML = html;
}

/*
 * Wrap every occurrence of any given term in a highlight span. Rather than
 * requiring an exact match against a pre-generated list of inflected
 * forms, a term of 3+ letters is treated as a stem: it's matched anywhere
 * inside a word and the highlight is expanded to the whole word, so any
 * inflection/suffix the caller's candidate list didn't anticipate (e.g. an
 * irregular plural, or a form generateWordVariationsForSentences simply
 * doesn't know about) still gets highlighted correctly. Terms shorter than
 * that fall back to requiring an exact whole-word match, since a 1-2
 * letter stem would otherwise match huge numbers of unrelated words.
 */
function highlightTermsInText(text, terms) {
  const uniqueTerms = [...new Set(terms.filter(Boolean))];

  if (!uniqueTerms.length) return text;

  const longTerms = uniqueTerms.filter((term) => term.length >= 3);
  const shortTerms = uniqueTerms.filter((term) => term.length < 3);
  const patterns = [];

  if (longTerms.length) {
    const literalLongTerms = longTerms.map(escapeRegExp).join("|");
    patterns.push(`[\\p{L}]*(?:${literalLongTerms})[\\p{L}]*`);
  }

  if (shortTerms.length) {
    const literalShortTerms = shortTerms.map(escapeRegExp).join("|");
    patterns.push(
      `(?<![\\p{L}\\p{N}])(?:${literalShortTerms})(?![\\p{L}\\p{N}])`,
    );
  }

  const regex = new RegExp(patterns.join("|"), "giu");

  return text.replace(
    regex,
    (matchedText) => `<span style="color: #1f6fb3;">${matchedText}</span>`,
  );
}

// Highlight search query in text, accounting for Norwegian characters (å, æ, ø) and verb variations
function highlightQuery(sentence, query) {
  if (!query) return sentence; // If no query, return sentence as is.

  // Always remove any existing highlights by replacing the <span> tags to avoid persistent old highlights
  const cleanSentence = sentence.replace(
    /<span style="color: #1f6fb3;">(.*?)<\/span>/gi,
    "$1",
  );

  // Get part of speech (POS) for the query to pass into `generateWordVariationsForSentences`
  const normalizedQuery = normalizeSearchText(query);
  const matchingWordEntry = results.find((result) =>
    normalizeSearchText(result.ord).includes(normalizedQuery),
  );
  const pos = matchingWordEntry
    ? isNounGenderValue(matchingWordEntry.gender)
      ? "noun"
      : matchingWordEntry.gender.toLowerCase()
    : "";

  // Generate word variations using the external function
  const highlightTerms = [
    ...splitSearchTerms(query),
    ...generateWordVariationsForSentences(normalizedQuery, pos),
  ]
    .map(normalizeSearchText)
    .filter(Boolean);

  return highlightTermsInText(cleanSentence, highlightTerms);
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
  const normalizedSelectedPOS = normalizeWordMetadataPOS(selectedPOS);

  const nounForms = [...NOUN_GENDER_FORMS, "noun"];

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

    const entryPOS = normalizeWordMetadataPOS(entry.gender);

    const posMatch =
      normalizedSelectedPOS === "noun"
        ? nounForms.includes(entryPOS)
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
                <p>No definition found for "${trimmedWord}".</p>
            </div>
        `;
  }
}

// Fetch and render sentences for a word or phrase, including handling comma-separated variations
function fetchAndRenderSentences(word, pos, showEnglish = true) {
  // Added showEnglish parameter with default value
  const trimmedWord = word
    .trim()
    .toLowerCase()
    .replace(/[\r\n]+/g, ""); // Remove any carriage returns or newlines
  const button = document.querySelector(`button[data-word='${word}']`);
  const sentenceContainer = document.getElementById(
    `sentences-container-${trimmedWord}`,
  );

  if (!sentenceContainer) {
    return;
  }

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

  // Find the part of speech (POS) of the word
  const matchingWordEntry = results.find(
    (result) =>
      result.ord.toLowerCase() === trimmedWord &&
      pos &&
      result.gender.toLowerCase().includes(pos.toLowerCase()),
  );
  if (!matchingWordEntry) {
    console.error(`No matching word found for "${trimmedWord}".`);
    return; // Stop if the word isn't found
  }

  // Generate word variations using the external function
  const wordVariations = [
    ...new Set(
      trimmedWord.length < 4
        ? [trimmedWord]
        : trimmedWord
            .split(",")
            .flatMap((w) => generateWordVariationsForSentences(w.trim(), pos)),
    ),
  ].filter(Boolean);

  const requiresStrictSentenceBoundary = [
    "adverb",
    "conjunction",
    "preposition",
    "interjection",
    "numeral",
  ].includes(pos);

  /*
   * Compile each variation once. Common words can occur throughout the
   * dictionary, so rebuilding these expressions for every entry previously
   * created hundreds of thousands of RegExp objects on the main thread.
   */
  const sentenceVariationPatterns = wordVariations.map((variation) => {
    const escapedVariation = escapeRegExp(variation);

    return requiresStrictSentenceBoundary
      ? new RegExp(`(^|\\s)${escapedVariation}($|[\\s.,!?;])`, "i")
      : new RegExp(`(^|[^\\wåæøÅÆØ])${escapedVariation}`, "i");
  });

  const sentenceMatchesVariation = (sentence) =>
    sentenceVariationPatterns.some((pattern) => pattern.test(sentence));

  // First, filter results to get relevant entries
  const relevantEntries = results.filter(
    (r) => r.eksempel && sentenceMatchesVariation(r.eksempel),
  );
  // Use a Set to store unique sentences and translations
  const uniqueSentences = new Set();
  const uniqueTranslations = new Set();

  // Now, split sentences and align translations
  let matchingResults = [];
  outerLoop: for (const r of relevantEntries) {
    const sentences = r.eksempel.split(/(?<=[.!?])\s+/);
    const translations = r.sentenceTranslation
      ? r.sentenceTranslation.split(/(?<=[.!?])\s+/)
      : [];

    const matched = { matchedSentences: [], matchedTranslations: [] };

    sentences.forEach((sentence, index) => {
      const isMatched = sentenceMatchesVariation(sentence);

      if (isMatched) {
        if (!uniqueSentences.has(sentence)) {
          uniqueSentences.add(sentence);
          matched.matchedSentences.push(sentence);
        }
        if (
          translations[index] &&
          !uniqueTranslations.has(translations[index])
        ) {
          uniqueTranslations.add(translations[index]);
          matched.matchedTranslations.push(translations[index]);
        }
      }
    });

    if (matched.matchedSentences.length > 0) {
      matchingResults.push({
        ...r,
        eksempel: matched.matchedSentences.join(" "),
        sentenceTranslation: matched.matchedTranslations.join(" "),
      });
    }

    if (uniqueSentences.size >= 10) break outerLoop;
  }

  // Ensure each sentence in the primary 'eksempel' attribute from the matching word entry is added if unique
  if (matchingWordEntry.eksempel) {
    const primarySentences = matchingWordEntry.eksempel.split(/(?<=[.!?])\s+/);
    const primaryTranslations = matchingWordEntry.sentenceTranslation
      ? matchingWordEntry.sentenceTranslation.split(/(?<=[.!?])\s+/)
      : [];

    primarySentences.forEach((sentence, index) => {
      // Check if each sentence is already in uniqueSentences before adding
      if (!uniqueSentences.has(sentence)) {
        uniqueSentences.add(sentence); // Track unique primary sentence

        matchingResults.unshift({
          ...matchingWordEntry,
          eksempel: sentence, // Add only the unique sentence
          sentenceTranslation: primaryTranslations[index] || "",
        });
      }
    });
  }

  // Check if there are any matching results
  if (matchingResults.length === 0) {
    return;
  }

  // Prioritize the matching results using the prioritizeResults function
  matchingResults = prioritizeResults(
    matchingResults,
    trimmedWord,
    "eksempel",
    pos,
  );

  /*
   * Highlight every variation in one pass. Calling highlightQuery() once per
   * variation repeatedly searched the entire dictionary and stripped the
   * highlights added by the previous pass.
   */
  const sentenceHighlightTerms = [...wordVariations]
    .map(normalizeSearchText)
    .filter(Boolean);

  matchingResults.forEach((result) => {
    const cleanSentence = result.eksempel.replace(
      /<span style="color: #1f6fb3;">(.*?)<\/span>/gi,
      "$1",
    );

    result.eksempel = highlightTermsInText(cleanSentence, sentenceHighlightTerms);
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
                <div class="sentence-box-norwegian ${
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
                <div class="sentence-box-english ${
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
    const englishButton = sentenceContainer.parentElement.querySelector(
      ".english-toggle-btn",
    );
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

  if (
    searchBtn &&
    randomBtn &&
    searchBar &&
    clearBtn &&
    posSelect &&
    cefrSelect
  ) {
    disableSearchControls();
    randomBtn.disabled = true;
    posSelect.disabled = true;
    cefrSelect.disabled = true;
    typeSelect.disabled = true;

    // Apply the disabled styling
    randomBtn.style.color = "#ccc";
    randomBtn.style.cursor = "not-allowed";
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
      cefrSelect.disabled = false;
      cefrFilterContainer.classList.remove("disabled");
    }
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

      // Enable the buttons once data is fully loaded
      // Enable the buttons and filters once data is fully loaded
      enableSearchControls();
      randomBtn.disabled = false;
      typeSelect.disabled = false;
      posSelect.disabled = false;
      cefrSelect.disabled = false;

      // Restore original styling
      randomBtn.style.color = "";
      randomBtn.style.cursor = "pointer";
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

document.addEventListener("click", (event) => {
  const target = event.target;
  if (target.classList.contains("clickable-definition-word")) {
    let word = target.getAttribute("data-word").toLowerCase();
    const searchInput = document.getElementById("search-bar");

    if (searchInput) {
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
        // Fully emulate the click-to-expand behavior for a single result
        latestMultipleResults = null;
        resultsContainer.innerHTML = ""; // Clear previous results

        // Display only the matched entry
        displaySearchResults(exactMatches);

        // Update the URL and page title
        updateURL(
          null,
          "words",
          exactMatches[0].gender.toLowerCase(),
          null,
          word,
        );
      } else {
        search(word); // fallback to regular multi-result search
      }
    }
  }
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

    const audio = new Audio(audioUrl);
    activeAudio.push(audio);
    audio.play().catch((err) => {
      console.error("Audio playback failed:", err);
    });
  }
});
