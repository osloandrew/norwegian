let storyResults = []; // Global variable to store the stories
let currentSpeed = 1.0; // default speed
// Deliberately a separate flag from scripts.js's isEnglishVisible (used by
// Sentence Search) rather than sharing it — defaults to hidden now that
// click-to-define gives a per-word hint, without changing Sentence
// Search's own default.
let isStoryEnglishVisible = false;

// Titles (titleNorwegian) the learner has opened before. Used only to
// softly deprioritize already-seen stories in the weighted list ordering
// below (see READ_STORY_WEIGHT_PENALTY) — never to hide them, since
// rereading a story is still a normal thing to want to do.
const READ_STORIES_STORAGE_KEY = "norwegian-dictionary-read-stories-v1";

function loadReadStoryTitles() {
  try {
    const storedValue = window.localStorage.getItem(READ_STORIES_STORAGE_KEY);
    if (!storedValue) {
      return new Set();
    }
    const parsedValue = JSON.parse(storedValue);
    return new Set(Array.isArray(parsedValue) ? parsedValue : []);
  } catch (error) {
    console.warn("Read stories could not be loaded.", error);
    return new Set();
  }
}

let readStoryTitles = loadReadStoryTitles();

function markStoryAsRead(titleNorwegian) {
  if (!titleNorwegian || readStoryTitles.has(titleNorwegian)) {
    return;
  }

  readStoryTitles.add(titleNorwegian);
  cachedStoryOrder = null; // Invalidate: the read penalty now applies to it.

  try {
    window.localStorage.setItem(
      READ_STORIES_STORAGE_KEY,
      JSON.stringify(Array.from(readStoryTitles)),
    );
  } catch (error) {
    console.warn("Read stories could not be saved.", error);
  }
}

// Cache of the current ability/read-weighted story ordering (see
// getStoryOrder). Reused across re-renders — typing in the search box,
// switching CEFR/genre filters, returning from a story to the list — so
// the list doesn't visibly reshuffle for reasons other than the learner's
// own choice (the explicit reshuffle gesture; see reshuffleStoryOrder) or
// a genuine change in ability/read state.
let cachedStoryOrder = null; // { cacheKey, order: Map<titleNorwegian, rank> }

// Define an object mapping genres to Font Awesome icons
const genreIcons = {
  action: '<i class="fas fa-bolt"></i>', // Action genre icon
  adventure: '<i class="fas fa-compass"></i>', // Adventure genre icon
  biography: '<i class="fas fa-user"></i>', // Biography genre icon
  business: '<i class="fas fa-briefcase"></i>', // Business genre icon
  children: '<i class="fas fa-child"></i>', // Children’s genre icon
  comedy: '<i class="fas fa-laugh"></i>', // Comedy genre icon
  crime: '<i class="fas fa-gavel"></i>', // Crime genre icon
  culture: '<i class="fas fa-globe"></i>', // Culture genre icon
  dialogue: '<i class="fas fa-comments"></i>', // Dialogue genre icon
  drama: '<i class="fas fa-theater-masks"></i>', // Drama genre icon
  economics: '<i class="fas fa-chart-line"></i>', // Economics genre icon
  education: '<i class="fas fa-book-reader"></i>', // Education genre icon
  fantasy: '<i class="fas fa-dragon"></i>', // Fantasy genre icon
  food: '<i class="fas fa-utensils"></i>', // Food genre icon
  health: '<i class="fas fa-heartbeat"></i>', // Health genre icon
  history: '<i class="fas fa-landmark"></i>', // History genre icon
  horror: '<i class="fas fa-ghost"></i>', // Horror genre icon
  language: '<i class="fas fa-language"></i>', // Language genre icon
  monologue: '<i class="fas fa-microphone-alt"></i>', // Monologue genre icon
  music: '<i class="fas fa-music"></i>', // Music genre icon
  mystery: '<i class="fas fa-search"></i>', // Mystery genre icon
  nature: '<i class="fas fa-leaf"></i>', // Nature genre icon
  philosophy: '<i class="fas fa-brain"></i>', // Philosophy genre icon
  poetry: '<i class="fas fa-feather-alt"></i>', // Poetry genre icon
  politics: '<i class="fas fa-balance-scale"></i>', // Politics genre icon
  psychology: '<i class="fas fa-user-md"></i>', // Psychology genre icon
  religion: '<i class="fas fa-praying-hands"></i>', // Religion genre icon
  romance: '<i class="fas fa-heart"></i>', // Romance genre icon
  science: '<i class="fas fa-flask"></i>', // Science genre icon
  "science fiction": '<i class="fas fa-rocket"></i>', // Sci-Fi genre icon
  "self-help": '<i class="fas fa-hands-helping"></i>', // Self-help genre icon
  sports: '<i class="fas fa-football-ball"></i>', // Sports genre icon
  technology: '<i class="fas fa-microchip"></i>', // Technology genre icon
  thriller: '<i class="fas fa-skull"></i>', // Thriller genre icon
  travel: '<i class="fas fa-plane"></i>', // Travel genre icon
};

const CSV_URL = "norwegianStories.csv";
// Prefixed: all language-site forks share one origin (osloandrew.github.io),
// so localStorage is shared across them too — an unprefixed key here would
// let a visit to another language site overwrite this one's cached data.
const STORY_CACHE_KEY = "storyDataNorwegian";
const STORY_CACHE_TIME_KEY = "storyDataTimestampNorwegian";
const STORY_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours, matching scripts.js
let storyDataLoadPromise = null;
const storyImagePathCache = new Map();

function normalizeStoryEntries(entries) {
  return entries.map((entry) => ({
    ...entry,
    titleNorwegian: (entry.titleNorwegian || "").trim(),
  }));
}

function readCachedStoryData() {
  try {
    const cached = localStorage.getItem(STORY_CACHE_KEY);
    if (!cached) return null;

    const entries = JSON.parse(cached);
    if (!Array.isArray(entries) || !entries.length) return null;

    return {
      entries: normalizeStoryEntries(entries),
      timestamp: Number(localStorage.getItem(STORY_CACHE_TIME_KEY)) || 0,
    };
  } catch (error) {
    console.warn("Cached story data could not be read.", error);
    return null;
  }
}

function cacheStoryData(entries) {
  try {
    localStorage.setItem(STORY_CACHE_KEY, JSON.stringify(entries));
    localStorage.setItem(STORY_CACHE_TIME_KEY, String(Date.now()));
  } catch (error) {
    console.warn("Story data could not be cached.", error);
  }
}

async function fetchFreshStoryData() {
  const response = await fetch(CSV_URL);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const csvText = await response.text();
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
  }).data;
  const entries = normalizeStoryEntries(parsed);

  cacheStoryData(entries);
  return entries;
}

function refreshStaleStoryCache() {
  const refresh = () => {
    fetchFreshStoryData().catch((error) => {
      console.warn("Story data could not be refreshed.", error);
    });
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(refresh, { timeout: 3000 });
  } else {
    window.setTimeout(refresh, 1500);
  }
}

async function fetchAndLoadStoryData() {
  if (storyResults.length) return storyResults;
  if (storyDataLoadPromise) return storyDataLoadPromise;

  showSpinner();

  const cached = readCachedStoryData();
  if (cached) {
    storyResults = cached.entries;
    hideSpinner();

    if (Date.now() - cached.timestamp > STORY_CACHE_MAX_AGE) {
      refreshStaleStoryCache();
    }

    return storyResults;
  }

  storyDataLoadPromise = fetchFreshStoryData()
    .then((entries) => {
      storyResults = entries;
      return storyResults;
    })
    .catch((error) => {
      console.error("Story data could not be loaded:", error);
      storyResults = [];
      return storyResults;
    })
    .finally(() => {
      storyDataLoadPromise = null;
      hideSpinner();
    });

  return storyDataLoadPromise;
}
// Helper function to determine CEFR class
function getStoryCefrClass(cefrLevel) {
  if (!cefrLevel) return "cefr-unknown"; // Fallback for missing CEFR levels
  const level = cefrLevel.toUpperCase();
  if (["A1"].includes(level)) return "a1";
  if (["A2"].includes(level)) return "a2";
  if (["B1"].includes(level)) return "b1";
  if (["B2"].includes(level)) return "b2";
  if (["C"].includes(level)) return "c1";
  if (["C1"].includes(level)) return "c1";
  if (["C2"].includes(level)) return "c2";

  return "cefr-unknown"; // Default
}

function setMetaTag(attributeName, attributeValue, content) {
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

function setCanonicalURL(url) {
  let canonicalLink = document.head.querySelector('link[rel="canonical"]');

  if (!canonicalLink) {
    canonicalLink = document.createElement("link");
    canonicalLink.setAttribute("rel", "canonical");
    document.head.appendChild(canonicalLink);
  }

  canonicalLink.setAttribute("href", url);
}

function createStoryURL(titleNorwegian) {
  const storyURL = new URL(window.location.href);

  storyURL.search = "";
  storyURL.hash = "";
  storyURL.searchParams.set("type", "story");
  storyURL.searchParams.set("story", titleNorwegian);

  return storyURL.href;
}

function updateStoryMetadata(story, imageFileURL = "") {
  const norwegianTitle = (story.titleNorwegian || "").trim();
  const englishTitle = (story.titleEnglish || "").trim();
  const cefrLevel = (story.CEFR || "").trim().toUpperCase();
  const genre = (story.genre || "").trim().toLowerCase();

  const levelText = cefrLevel ? `${cefrLevel} ` : "";
  const genreText = genre ? `${genre} ` : "";

  const translatedTitle =
    englishTitle && englishTitle !== norwegianTitle ? ` (${englishTitle})` : "";

  const pageTitle = `${norwegianTitle}: ${levelText}Norwegian Story`;

  const description =
    `Read "${norwegianTitle}"${translatedTitle}, ` +
    `a free ${levelText}Norwegian ${genreText}story ` +
    `with an English translation.`;

  const storyURL = createStoryURL(norwegianTitle);

  const socialImageURL = imageFileURL
    ? new URL(imageFileURL, window.location.href).href
    : new URL(
        "Resources/Icons/android-chrome-512x512.png",
        window.location.href,
      ).href;

  document.title = pageTitle;

  setMetaTag("name", "description", description);

  setMetaTag("property", "og:title", pageTitle);
  setMetaTag("property", "og:description", description);
  setMetaTag("property", "og:type", "article");
  setMetaTag("property", "og:url", storyURL);
  setMetaTag("property", "og:image", socialImageURL);

  setCanonicalURL(storyURL);
}

function updateStoriesListMetadata() {
  const storiesURL = new URL(window.location.href);

  storiesURL.search = "";
  storiesURL.hash = "";
  storiesURL.searchParams.set("type", "stories");

  const pageTitle = "Norwegian Stories with English Translations";

  const description =
    "Read free Norwegian stories organized by CEFR level and genre, " +
    "with English translations and audio.";

  const socialImageURL = new URL(
    "Resources/Icons/android-chrome-512x512.png",
    window.location.href,
  ).href;

  document.title = pageTitle;

  setMetaTag("name", "description", description);

  setMetaTag("property", "og:title", pageTitle);
  setMetaTag("property", "og:description", description);
  setMetaTag("property", "og:type", "website");
  setMetaTag("property", "og:url", storiesURL.href);
  setMetaTag("property", "og:image", socialImageURL);

  setCanonicalURL(storiesURL.href);
}

function updateEnglishVisibility() {
  const englishSentences = document.querySelectorAll(".english-sentence");
  const toggleEnglishBtn = document.getElementById("toggle-english-btn"); // Dynamically find the button
  if (isStoryEnglishVisible) {
    englishSentences.forEach((sentence) => {
      sentence.style.display = "block";
    });
    if (toggleEnglishBtn) toggleEnglishBtn.textContent = "Hide English";
  } else {
    englishSentences.forEach((sentence) => {
      sentence.style.display = "none";
    });
    if (toggleEnglishBtn) toggleEnglishBtn.textContent = "Show English";
  }
}

// How tightly the story ordering clusters around the learner's ability.
// Wider than the word-selection sigma in wordGame.js — there are far fewer
// stories than words per CEFR band, so a tighter radius would leave many
// learners with nothing nearby.
const STORY_RECOMMENDATION_SIGMA = 150;

// Ability drifts by a point or two after almost every word-game answer;
// caching on its exact value would reorder the list on nearly every
// render. Bucketing to the nearest 25 keeps it stable across that noise
// while still updating once ability has genuinely moved.
function getStoryRecommendationCacheKey(ability) {
  return Math.round(ability / 25) * 25;
}

// Proximity weight of a single story for a given ability estimate — a soft
// draw, not an exact CEFR match, so a thin band still surfaces its nearest
// neighbors. A small floor (+0.001) keeps every story in the running,
// however faintly, so a learner whose ability sits far from every
// available story still sees something instead of nothing.
function getStoryDifficultyWeight(story, ability) {
  if (!Number.isFinite(ability) || !story.CEFR) {
    return 1;
  }

  const anchors = window.WordGameHelpers?.getCefrAnchors?.() ?? {};
  const anchor = anchors[story.CEFR.trim().toUpperCase()] ?? 500;
  const distance = anchor - ability;

  return (
    Math.exp(
      -(distance * distance) /
        (2 * STORY_RECOMMENDATION_SIGMA * STORY_RECOMMENDATION_SIGMA),
    ) + 0.001
  );
}

// Already-read stories aren't excluded from the list (rereading is a
// normal thing to want to do) but shouldn't keep competing for the top of
// a fresh draw once they've been opened.
const READ_STORY_WEIGHT_PENALTY = 0.15;

const STORY_SHUFFLE_SEED_KEY = "norwegian-dictionary-story-shuffle-seed-v1";

// Deterministic PRNG (mulberry32). The *seed* is what makes a draw random;
// the function itself always reproduces the same sequence for the same
// seed, which is what lets getStoryOrder stay stable across re-renders
// that shouldn't reshuffle anything (see cachedStoryOrder above).
function createSeededRandom(seed) {
  let state = seed >>> 0;

  return function seededRandom() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getStoryShuffleSeed() {
  try {
    const stored = window.localStorage.getItem(STORY_SHUFFLE_SEED_KEY);
    const parsed = stored ? Number(stored) : NaN;
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  } catch (error) {
    // Fall through to drawing a fresh seed below.
  }
  return reshuffleStoryOrder();
}

// The explicit "reshuffle" gesture (magnifying glass / clear button on the
// Stories tab — see handleSearchButtonClick and clearInput in scripts.js).
// Every other re-render of the story list reuses the existing seed instead
// of calling this, so the list only visibly reshuffles when the learner
// actually asked for a fresh draw.
function reshuffleStoryOrder() {
  const seed = Math.floor(Math.random() * 2 ** 31);

  try {
    window.localStorage.setItem(STORY_SHUFFLE_SEED_KEY, String(seed));
  } catch (error) {
    // Best-effort only — the in-memory seed below still applies for the
    // rest of this session even if it can't be persisted.
  }

  cachedStoryOrder = null;
  return seed;
}

// Builds a full ability-weighted, read-penalized ranking of every story in
// the corpus for one seed. Uses the Efraimidis-Spirakis exponential-key
// form of weighted sampling without replacement: each story draws one
// seeded random tap and gets key = -ln(tap) / weight (lower key = drawn
// earlier); sorting ascending by that key in one pass is equivalent to
// repeatedly drawing without replacement with probability proportional to
// weight. This form scales *linearly* in 1/weight, unlike the more
// commonly-seen tap^(1/weight) form — that one exponentiates the weight
// ratio, so for a full-corpus ranking (as opposed to picking a single
// winner, where it's fine) any story more than ~1.5 sigma from the
// learner's ability underflows toward the same float-noise floor as every
// other distant story, collapsing B1/B2/C into an effectively arbitrary
// order instead of a smooth gradient. The linear form keeps that gradient
// intact at any weight ratio.
//
// Stories are enumerated in a fixed, filter-independent order
// (alphabetical) so a given story always draws the same tap for a given
// seed regardless of which filters are applied when the list is rendered —
// that's what keeps a filtered/searched view's relative ordering
// consistent with the unfiltered one.
function buildStoryOrder(seed) {
  const ability = window.WordGameHelpers?.getAbilityScore?.();
  const random = createSeededRandom(seed);

  const stableStories = [...storyResults].sort((a, b) =>
    a.titleNorwegian.localeCompare(b.titleNorwegian),
  );

  const scored = stableStories.map((story) => {
    const weight =
      getStoryDifficultyWeight(story, ability) *
      (readStoryTitles.has(story.titleNorwegian)
        ? READ_STORY_WEIGHT_PENALTY
        : 1);
    // Clamp away from 0 so a (vanishingly unlikely) tap of exactly 0
    // can't produce -ln(0) = Infinity.
    const tap = Math.max(random(), 1e-12);
    const key = -Math.log(tap) / Math.max(weight, 0.0001);
    return { titleNorwegian: story.titleNorwegian, key };
  });

  scored.sort((a, b) => a.key - b.key);

  const order = new Map();
  scored.forEach(({ titleNorwegian }, index) => {
    order.set(titleNorwegian, index);
  });
  return order;
}

// Returns (and caches) the current story ordering: a Map from
// titleNorwegian to rank, lower = drawn earlier. Recomputed only when the
// seed, the learner's ability bucket, or the read-story count actually
// changes — anything else re-rendering the list just re-filters this same
// ranking, which is what keeps it stable (see cachedStoryOrder above).
function getStoryOrder() {
  const ability = window.WordGameHelpers?.getAbilityScore?.();
  const cacheKey = [
    getStoryShuffleSeed(),
    getStoryRecommendationCacheKey(Number.isFinite(ability) ? ability : 0),
    readStoryTitles.size,
  ].join(":");

  if (cachedStoryOrder && cachedStoryOrder.cacheKey === cacheKey) {
    return cachedStoryOrder.order;
  }

  const order = buildStoryOrder(getStoryShuffleSeed());
  cachedStoryOrder = { cacheKey, order };
  return order;
}

/*
 * The single best-ranked story for the learner right now — same ordering
 * that drives the full list below, so the "Recommended for you" banner and
 * the list it sits above are always consistent with each other. Returns
 * null only if no ability estimate exists yet (placement not completed) or
 * there are no CEFR-tagged stories at all.
 */
function getRecommendedStory() {
  const ability = window.WordGameHelpers?.getAbilityScore?.();

  if (!Number.isFinite(ability)) {
    return null;
  }

  const candidates = storyResults.filter(
    (story) => story.CEFR && story.titleNorwegian,
  );

  if (!candidates.length) {
    return null;
  }

  const order = getStoryOrder();
  candidates.sort(
    (a, b) =>
      (order.get(a.titleNorwegian) ?? Infinity) -
      (order.get(b.titleNorwegian) ?? Infinity),
  );

  return candidates[0];
}

/*
 * Build the shared title+detail markup for a story card. Used by both the
 * regular story list and the recommendation banner, so they always stay
 * visually consistent.
 */
function createStoryCardLink(story) {
  const storyLink = document.createElement("a");
  storyLink.className = "story-card-link";
  storyLink.href = `?type=story&story=${encodeURIComponent(story.titleNorwegian)}`;
  storyLink.dataset.storyTitle = story.titleNorwegian;

  const titleContainer = document.createElement("div");
  titleContainer.classList.add("title-container");

  const norwegianTitle = document.createElement("div");
  norwegianTitle.classList.add("japanese-title");
  norwegianTitle.textContent = story.titleNorwegian;

  titleContainer.appendChild(norwegianTitle);

  if (story.titleNorwegian !== story.titleEnglish) {
    const englishTitle = document.createElement("div");
    englishTitle.classList.add("english-title", "stories-subtitle");
    englishTitle.textContent = story.titleEnglish || "";

    titleContainer.appendChild(englishTitle);
  }

  const detailContainer = document.createElement("div");
  detailContainer.classList.add("stories-detail-container");

  const genreDiv = document.createElement("div");
  genreDiv.classList.add("stories-genre");
  genreDiv.innerHTML =
    (story.genre && genreIcons[story.genre.toLowerCase()]) || "";

  const cefrDiv = document.createElement("div");
  cefrDiv.classList.add("cefr-value", getStoryCefrClass(story.CEFR));
  cefrDiv.textContent = story.CEFR || "N/A";
  if (story.CEFR) cefrDiv.title = getCefrTooltip(story.CEFR);

  detailContainer.appendChild(genreDiv);
  detailContainer.appendChild(cefrDiv);

  storyLink.appendChild(titleContainer);
  storyLink.appendChild(detailContainer);

  return storyLink;
}

/*
 * Build the highlighted "recommended for your level" banner shown at the
 * top of the Stories page.
 */
function createStoryRecommendationElement(story) {
  const wrapper = document.createElement("div");
  wrapper.className = "story-recommendation";

  // No "your level: X" claim here — the story's own CEFR badge (rendered
  // by createStoryCardLink below) already carries that as descriptive
  // metadata. The learner's ability estimate is otherwise invisible.
  const label = document.createElement("div");
  label.className = "story-recommendation-label";
  label.innerHTML = `<i class="fas fa-star" aria-hidden="true"></i> Recommended for you`;

  const storyLink = createStoryCardLink(story);
  storyLink.classList.add("story-recommendation-link");

  storyLink.addEventListener("click", (event) => {
    const modifiedClick =
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (modifiedClick) return;

    event.preventDefault();
    displayStory(storyLink.dataset.storyTitle);
  });

  wrapper.appendChild(label);
  wrapper.appendChild(storyLink);

  return wrapper;
}

async function displayStoryList(filteredStories = storyResults) {
  showSpinner(); // Show spinner before rendering story list
  restoreSearchContainerInner();
  removeStoryHeader();
  clearContainer(); // Clear previous results

  // Reset the page title and URL to the main list view
  document.title = "Stories - Norwegian Dictionary";
  history.replaceState(
    {},
    "",
    `${window.location.origin}${window.location.pathname}`,
  );
  updateURL(null, "stories", null);
  updateStoriesListMetadata();

  // Retrieve selected CEFR and genre filter values
  const selectedCEFR = document
    .getElementById("cefr-select")
    .value.toUpperCase()
    .trim();
  const selectedGenre = document
    .getElementById("genre-select")
    .value.toLowerCase()
    .trim();

  // NEW: read search text (support either id if your HTML differs)
  const searchInput =
    document.getElementById("search-bar") ||
    document.getElementById("stories-search") ||
    document.getElementById("global-search");
  const searchText = (searchInput?.value || "").toLowerCase().trim();

  // Filter stories based on selected CEFR and genre
  let filtered = filteredStories.filter((story) => {
    const genreMatch = selectedGenre
      ? story.genre && story.genre.trim().toLowerCase() === selectedGenre
      : true;
    const cefrMatch = selectedCEFR
      ? story.CEFR && story.CEFR.trim().toUpperCase() === selectedCEFR
      : true;
    const hasNorwegian = story.norwegian && story.norwegian.trim() !== "";
    // NEW: title search across ES + EN titles, like JP
    const matchesSearch =
      !searchText ||
      (story.titleNorwegian &&
        story.titleNorwegian.toLowerCase().includes(searchText)) ||
      (story.titleEnglish &&
        story.titleEnglish.toLowerCase().includes(searchText));

    return genreMatch && cefrMatch && hasNorwegian && matchesSearch;
  });

  // Recommend a story weighted toward the learner's estimated ability,
  // elevated above the regular list, and excluded from it so it isn't
  // shown twice.
  const recommendedStory = getRecommendedStory();

  if (recommendedStory) {
    filtered = filtered.filter((story) => story !== recommendedStory);
  }

  // Ability-weighted, read-penalized, deterministic-per-seed ordering (see
  // getStoryOrder) — not a fresh shuffle on every render. Falls back to
  // the CSV's own order for any story the ranking doesn't know about,
  // which can only happen if storyResults changed between building the
  // order and this render.
  const storyOrder = getStoryOrder();
  filtered.sort(
    (a, b) =>
      (storyOrder.get(a.titleNorwegian) ?? Infinity) -
      (storyOrder.get(b.titleNorwegian) ?? Infinity),
  );

  // ▶ NEW: populate <ul id="stories"> with <li> items (JP mirror)
  const container = document.getElementById("results-container");
  let storyList = document.getElementById("stories");
  if (!storyList) {
    storyList = document.createElement("ul");
    storyList.id = "stories";
    storyList.className = "stories-list";
  }
  storyList.innerHTML = ""; // clear old list items
  const storyItems = document.createDocumentFragment();

  filtered.forEach((story) => {
    const li = document.createElement("li");
    li.className = "stories-list-item";
    li.appendChild(createStoryCardLink(story));
    storyItems.appendChild(li);
  });

  /*
   * One delegated listener replaces hundreds of identical listeners while
   * preserving normal modified-click behavior for opening a new tab.
   */
  storyList.addEventListener("click", (event) => {
    const storyLink = event.target.closest(".story-card-link");
    if (!storyLink || !storyList.contains(storyLink)) return;

    const modifiedClick =
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (modifiedClick) return;

    event.preventDefault();
    displayStory(storyLink.dataset.storyTitle);
  });

  storyList.appendChild(storyItems);

  if (recommendedStory) {
    container.appendChild(createStoryRecommendationElement(recommendedStory));
  }

  container.appendChild(storyList);

  // show list / hide reader (unchanged behavior)
  const storyViewer = document.getElementById("story-viewer");
  const storyContent = document.getElementById("story-content");
  const stickyHeader = document.getElementById("sticky-header");

  container.style.display = "block";
  if (storyViewer) storyViewer.style.display = "none";
  if (storyContent) storyContent.innerHTML = "";
  if (stickyHeader) stickyHeader.classList.add("hidden");

  hideSpinner();
}

// Matches runs of letters (with combining marks), allowing an internal
// hyphen/apostrophe so compounds like "Nord-Norge" stay one clickable unit
// instead of splitting into two. Everything else (spaces, punctuation) is
// left as plain text between spans, so the rendered sentence is visually
// identical to before — just with each word individually clickable.
const STORY_WORD_TOKEN_REGEX = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu;

function renderClickableNorwegianSentence(sentenceText) {
  let html = "";
  let lastIndex = 0;
  let match;

  STORY_WORD_TOKEN_REGEX.lastIndex = 0;
  while ((match = STORY_WORD_TOKEN_REGEX.exec(sentenceText)) !== null) {
    html += escapeHTML(sentenceText.slice(lastIndex, match.index));
    const word = match[0];
    html += `<span class="story-word" data-word="${escapeHTML(word)}">${escapeHTML(word)}</span>`;
    lastIndex = STORY_WORD_TOKEN_REGEX.lastIndex;
  }
  html += escapeHTML(sentenceText.slice(lastIndex));

  return html;
}

function displayStory(titleNorwegian) {
  document.documentElement.classList.add("reading");
  showSpinner(); // Show spinner at the start of story loading
  const searchContainer = document.getElementById("search-container");
  const searchContainerInner = document.getElementById(
    "search-container-inner",
  );
  const selectedStory = storyResults.find(
    (story) => story.titleNorwegian === titleNorwegian,
  );

  if (!selectedStory) {
    console.error(`No story found with the title: ${titleNorwegian}`);
    hideSpinner();
    return;
  }

  markStoryAsRead(selectedStory.titleNorwegian);

  document.title = selectedStory.titleNorwegian + " - Norwegian Dictionary";

  updateURL(null, "story", null, titleNorwegian); // Update URL with story parameter

  clearContainer();
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });

  updateStoryMetadata(selectedStory);

  // This button lives permanently in the site header (shown/hidden via
  // html.reading in CSS), not regenerated per story, so its handler is
  // overwritten via assignment rather than addEventListener — otherwise
  // navigating between stories would stack another listener bound to a
  // now-stale story.
  const reportIssueButton = document.getElementById("story-report-issue");
  if (reportIssueButton) {
    reportIssueButton.onclick = () => {
      openFeedbackDialog({
        source: "Story",
        word: selectedStory.titleNorwegian,
        pos: selectedStory.genre,
        cefr: selectedStory.CEFR,
        categories: STORY_FEEDBACK_CATEGORIES,
        triggerElement: reportIssueButton,
      });
    };
  }

  // Build sticky header here, just before audio is constructed
  const genreIcon = genreIcons[selectedStory.genre.toLowerCase()] || "";
  const cefrClass = getStoryCefrClass(selectedStory.CEFR);

  const sticky = document.getElementById("sticky-header");
  sticky.classList.remove("hidden");

  // 1) Render a stable skeleton with fixed slots so layout never reflows
  sticky.innerHTML = `
  <div class="sticky-detail-container">
    <div class="sticky-row">
      <div class="sticky-genre" id="sticky-genre-slot"></div>
      <div class="sticky-cefr-label ${cefrClass}" id="sticky-cefr-slot" title="${selectedStory.CEFR ? getCefrTooltip(selectedStory.CEFR) : ""}">
        ${selectedStory.CEFR || "N/A"}
      </div>
    </div>
    <button id="back-button" class="back-button">
      <i class="fas fa-chevron-left"></i> Back
    </button>
  </div>
  <div id="sticky-audio-slot"></div>
  <div id="right-controls" class="right-controls"></div>
`;

  const stickyHeaderEl = document.getElementById("sticky-header");
  const audioSlot = document.getElementById("sticky-audio-slot");

  stickyHeaderEl.style.display = "flex";
  stickyHeaderEl.style.alignItems = "center";

  // Let left and right stay their natural size, middle (audioSlot) expand
  const left = stickyHeaderEl.querySelector(".sticky-detail-container");
  const right = document.getElementById("right-controls");
  if (left) left.style.flex = "0 0 auto";
  if (right) right.style.flex = "0 0 auto";
  if (audioSlot) {
    audioSlot.style.flex = "1 1 auto"; // flex-grow so it fills available width
    audioSlot.style.maxWidth = "100%"; // never overflow
    const audioEl = audioSlot.querySelector("audio");
    if (audioEl) {
      audioEl.style.width = "100%"; // make the <audio> itself fill its slot
    }
  }
  // 2) Fill the left-side genre slot immediately
  const genreSlot = document.getElementById("sticky-genre-slot");
  if (genreSlot) genreSlot.innerHTML = genreIcon;

  // 3) Create the English toggle once, in its fixed slot (no later moves)
  const rc = document.getElementById("right-controls");
  if (rc) {
    rc.innerHTML = `
    <button id="toggle-english-btn" class="toggle-english-btn">
      ${isStoryEnglishVisible ? "Hide English" : "Show English"}
    </button>
  `;
  }

  // Insert a Speed button *above* the English toggle, with identical styling
  (function addSpeedButton() {
    const rc = document.getElementById("right-controls");
    const engBtn = document.getElementById("toggle-english-btn");
    if (!rc || !engBtn) return;

    const speedBtn = document.createElement("button");
    speedBtn.id = "speed-btn";
    speedBtn.type = "button";
    // Clone the *exact* classes from the English button for identical styling
    speedBtn.className = engBtn.className;
    speedBtn.textContent = "1.0×";
    // Small vertical spacing without touching your CSS
    speedBtn.style.marginBottom = "5px";

    // Insert above the English button
    rc.insertBefore(speedBtn, engBtn);

    const rates = [0.7, 0.8, 0.9, 1];
    let i = rates.indexOf(currentSpeed);
    if (i === -1) i = 3; // default to 1.0×

    function label(r) {
      return "Speed: " + r.toFixed(1).replace(/\.0$/, "");
    }
    function applyRate(r) {
      currentSpeed = r; // update global
      const audio = document.querySelector("#sticky-audio-slot audio");
      if (audio) {
        audio.playbackRate = r;
        audio.preservesPitch = true;
        audio.mozPreservesPitch = true;
        audio.webkitPreservesPitch = true;
      }
      speedBtn.textContent = label(r);
      speedBtn.setAttribute("aria-label", `Playback speed ${r} times`);
    }

    speedBtn.addEventListener("click", () => {
      i = (i + 1) % rates.length;
      applyRate(rates[i]);
    });

    // initialize button + audio to current global speed
    applyRate(rates[i]);

    // Expose helpers so newly-created audio can reuse the current rate
    speedBtn._getRate = () => rates[i];
    speedBtn._applyRate = () => applyRate(rates[i]);

    // Initialize
    applyRate(rates[i]);
  })();

  document
    .getElementById("toggle-english-btn")
    ?.addEventListener("click", () => {
      isStoryEnglishVisible = !isStoryEnglishVisible;
      updateEnglishVisibility();
      const b = document.getElementById("toggle-english-btn");
      if (b) b.textContent = isStoryEnglishVisible ? "Hide English" : "Show English";
    });

  // DIAG 2: force a visible audio control even if the real file is missing
  // REAL AUDIO: sanitize title and set src; fallback mp3 if m4a fails
  {
    const slot = document.getElementById("sticky-audio-slot");
    if (slot) {
      // Build a sanitized filename: strip trailing '?', trim, collapse spaces
      const rawTitle = (selectedStory.titleEnglish || "")
        .replace(/\?+$/, "")
        .trim()
        .replace(/\s+/g, " ");
      const enc = encodeURIComponent(rawTitle);
      const player = document.createElement("audio");
      player.controls = true;
      player.className = "stories-audio-player";
      player.preload = "metadata";
      player.src = `Resources/Audio/${enc}.m4a`;
      player.onerror = () => {
        // try mp3, then give up quietly
        if (player.src.endsWith(".m4a")) {
          player.onerror = () =>
            console.warn("[AUDIO]", "mp3 also missing for:", rawTitle);
          player.src = `Resources/Audio/${enc}.mp3`;
        }
      };
      slot.innerHTML = "";
      slot.appendChild(player);
      player.playbackRate = currentSpeed; // ensure it starts at the saved speed
    }
  }

  if (searchContainer) searchContainer.style.display = "none";

  document
    .getElementById("back-button")
    ?.addEventListener("click", storiesBackBtn);

  let contentHTML = '<div id="story-image-slot"></div>';
  // Function to finalize and display the story content
  const finalizeContent = () => {
    for (let i = 0; i < norwegianSentences.length; i++) {
      const norwegianSentence = norwegianSentences[i].trim();
      const englishSentence = englishSentences[i]
        ? englishSentences[i].trim()
        : "";

      contentHTML += `
    <div class="couplet">
      <div lang="nb" class="japanese-sentence" data-raw-text="${escapeHTML(norwegianSentence)}">${renderClickableNorwegianSentence(norwegianSentence)}</div>
      <div lang="en" class="english-sentence">${escapeHTML(englishSentence)}</div>
    </div>
  `;
    }

    const storyViewer = document.getElementById("story-viewer");
    const storyContent = document.getElementById("story-content");
    const listEl = document.getElementById("results-container");

    if (storyContent) {
      storyContent.innerHTML = contentHTML; // render story body into the reader pane
      // Insert the sticky title above the first child (mirror JP order)
      const titleNode = document.createElement("div");
      titleNode.className = "sticky-title-container";
      titleNode.innerHTML = `
  <h2 lang="nb" class="sticky-title-japanese">${selectedStory.titleNorwegian}</h2>
  ${
    selectedStory.titleNorwegian !== selectedStory.titleEnglish
      ? `<p lang="en" class="sticky-title-english">${selectedStory.titleEnglish}</p>`
      : ""
  }
`;
      storyContent.insertBefore(titleNode, storyContent.firstChild);
    }
    // JP mirror: enforce current visibility state on first render
    updateEnglishVisibility();
    if (storyViewer) {
      storyViewer.style.display = "block"; // show the reader pane
    }
    if (listEl) {
      listEl.style.display = "none"; // hide the list while reading
    }
    hideSpinner(); // Hide spinner after story content is displayed
    scheduleStoryUpgrades();
  };

  // Process story text into sentences
  const standardizedNorwegian = selectedStory.norwegian.replace(/[“”«»]/g, '"');
  const standardizedEnglish = selectedStory.english.replace(/[“”«»]/g, '"');
  const sentenceRegex =
    /(?:(["]?.+?(?<!\bMr)(?<!\bMrs)(?<!\bMs)(?<!\bDr)(?<!\bProf)(?<!\bJr)(?<!\bSr)(?<!\bSt)(?<!\bMt)[.!?]["]?)(?=\s|$)|(?:\.\.\."))/g;
  let norwegianSentences = standardizedNorwegian.match(sentenceRegex) || [
    standardizedNorwegian,
  ];
  let englishSentences = standardizedEnglish.match(sentenceRegex) || [
    standardizedEnglish,
  ];

  const combineSentences = (sentences, combineIfContains) => {
    return sentences.reduce((acc, sentence) => {
      const trimmedSentence = sentence.trim();
      const lastSentence = acc[acc.length - 1] || "";

      // Check if the previous sentence ends with a quote and the current sentence contains 'asked'
      if (
        acc.length > 0 &&
        combineIfContains &&
        combineIfContains.test(trimmedSentence) &&
        /["”']$/.test(lastSentence)
      ) {
        acc[acc.length - 1] += " " + trimmedSentence;
      } else if (acc.length > 0 && /^[a-zæøå]/.test(trimmedSentence)) {
        acc[acc.length - 1] += " " + trimmedSentence;
      } else {
        acc.push(trimmedSentence);
      }
      return acc;
    }, []);
  };

  norwegianSentences = combineSentences(norwegianSentences);
  englishSentences = combineSentences(englishSentences, /\basked\b/i);

  finalizeContent();
  loadStoryImage(selectedStory);
}

function handleGenreChange() {
  const selectedGenre = document
    .getElementById("genre-select")
    .value.trim()
    .toLowerCase();
  const selectedCEFR = document
    .getElementById("cefr-select")
    .value.toUpperCase();

  // Filter the stories based on both the selected genre and CEFR level
  const filteredStories = storyResults.filter((story) => {
    const genreMatch = selectedGenre
      ? story.genre.trim().toLowerCase() === selectedGenre
      : true;
    const cefrMatch = selectedCEFR
      ? story.CEFR && story.CEFR.toUpperCase() === selectedCEFR
      : true;

    return genreMatch && cefrMatch;
  });

  // Call displayStoryList with the filtered stories
  displayStoryList(filteredStories);
}

function storiesBackBtn() {
  // JP parity: stop and remove any playing audio from the sticky header
  const stickyHeader = document.getElementById("sticky-header");
  if (stickyHeader) {
    const players = stickyHeader.querySelectorAll(
      "audio, .stories-audio-player",
    );
    players.forEach((p) => {
      if (typeof p.pause === "function") p.pause();
      try {
        p.currentTime = 0;
      } catch (_) {}
      p.remove();
    });
    const toggles = stickyHeader.querySelector(".toggle-buttons-container");
    if (toggles) toggles.remove();
  }

  // 1) Capture current CEFR/Genre BEFORE changing the UI
  const cefrElBefore = document.getElementById("cefr-select");
  const genreElBefore = document.getElementById("genre-select");
  const savedCEFR = cefrElBefore ? cefrElBefore.value : "";
  const savedGenre = genreElBefore ? genreElBefore.value : "";

  // 2) Clear ONLY the search box (mirror JP)
  const searchEl =
    document.getElementById("search-bar") ||
    document.getElementById("stories-search") ||
    document.getElementById("global-search");
  if (searchEl) searchEl.value = "";

  // 3) If you must switch the type tab, do it now (this may rebuild the filters)
  const typeSel = document.getElementById("type-select");
  if (typeSel) typeSel.value = "stories";
  if (typeof handleTypeChange === "function") {
    handleTypeChange("stories", { renderStories: false });
  }

  // 4) Re-grab the (possibly re-rendered) selects and restore values
  const cefrElAfter = document.getElementById("cefr-select");
  const genreElAfter = document.getElementById("genre-select");
  if (cefrElAfter) cefrElAfter.value = savedCEFR;
  if (genreElAfter) genreElAfter.value = savedGenre;

  // 5) Render the list using the restored dropdowns
  displayStoryList();

  // 6) Exit reading mode
  document.documentElement.classList.remove("reading");
}

// Helper function to remove the story header
function removeStoryHeader() {
  const searchContainer = document.getElementById("search-container"); // The container to update
  const storyHeader = document.querySelector(".stories-story-header");
  searchContainer.style.display = "";
  if (storyHeader) {
    storyHeader.remove();
  }
}

// Helper function to restore the inner
function restoreSearchContainerInner() {
  const searchContainerInner = document.getElementById(
    "search-container-inner",
  ); // The container to update
  searchContainerInner.style.display = "";
}

function getStoryImageCandidates(titleEnglish) {
  const title = String(titleEnglish || "").trim();
  if (!title) return [];

  const sanitized = title.endsWith("?") ? title.slice(0, -1) : title;
  const encodedTitles = [...new Set([title, sanitized])].map(
    encodeURIComponent,
  );
  const imageExtensions = ["png", "webp", "jpg", "avif", "jpeg", "gif"];

  return encodedTitles.flatMap((encoded) =>
    imageExtensions.map(
      (extension) => `Resources/Images/${encoded}.${extension}`,
    ),
  );
}

function loadStoryImage(story) {
  const slot = document.getElementById("story-image-slot");
  const cacheKey = String(story.titleEnglish || "").trim();
  const cachedPath = storyImagePathCache.get(cacheKey);
  const candidates = cachedPath
    ? [cachedPath]
    : getStoryImageCandidates(story.titleEnglish);
  if (!slot || !candidates.length) return;

  const image = new Image();
  let candidateIndex = 0;
  let currentCandidate = "";

  image.alt = story.titleEnglish || story.titleNorwegian;
  image.className = "story-image";
  image.decoding = "async";

  const tryNextCandidate = () => {
    if (!slot.isConnected || candidateIndex >= candidates.length) return;
    currentCandidate = candidates[candidateIndex];
    image.src = currentCandidate;
    candidateIndex += 1;
  };

  image.addEventListener("load", () => {
    if (!slot.isConnected) return;
    storyImagePathCache.set(cacheKey, currentCandidate);
    slot.replaceChildren(image);
    updateStoryMetadata(story, image.src);
  });

  image.addEventListener("error", tryNextCandidate);
  tryNextCandidate();
}

function isStoriesTabActive() {
  const typeSelect = document.getElementById("type-select");
  return typeSelect && typeSelect.value === "stories";
}

window.addEventListener("DOMContentLoaded", async () => {
  const currentURL = new URL(window.location.href);

  const requestedType = currentURL.searchParams.get("type");
  const requestedStory = currentURL.searchParams.get("story");

  /*
   * Story data is unnecessary on the homepage, dictionary,
   * Word List, Sentence Search, and Word Game.
   *
   * If a user later selects Stories without reloading, the existing
   * handleTypeChange("stories") code loads the data at that point.
   */
  if (requestedType === "stories" || requestedStory) {
    const typeSelect = document.getElementById("type-select");
    if (typeSelect) {
      typeSelect.value = "stories";
      typeSelect.disabled = true;
    }

    await fetchAndLoadStoryData();

    if (requestedStory) {
      displayStory(requestedStory);
    } else {
      handleTypeChange("stories");
    }
  }

  // Wire up live story filtering:

  // After data is loaded, wire up live filtering like JP:
  const searchEl =
    document.getElementById("search-bar") ||
    document.getElementById("stories-search") ||
    document.getElementById("global-search");
  const cefrEl = document.getElementById("cefr-select");
  const genreEl = document.getElementById("genre-select");
  if (searchEl) {
    searchEl.addEventListener("input", () => {
      if (isStoriesTabActive()) {
        displayStoryList();
      }
    });
  }
  if (cefrEl) {
    cefrEl.addEventListener("change", () => {
      if (isStoriesTabActive()) {
        displayStoryList();
      }
    });
  }

  if (genreEl) {
    genreEl.addEventListener("change", () => {
      if (isStoriesTabActive()) {
        displayStoryList();
      }
    });
  }
});

// Click-to-define: tapping a word in the Norwegian text of a story looks it
// up (going through the same inflection resolution as the main dictionary
// search, so "bryllupet"/"bryllupene" resolve to the "bryllup" entry same as
// typing any of them into search would) and shows a small popover with the
// English gloss and a My Words star, without leaving the story.
let activeStoryWordPopover = null;

function closeStoryWordPopover() {
  if (!activeStoryWordPopover) return;
  activeStoryWordPopover.remove();
  activeStoryWordPopover = null;
  window.removeEventListener("scroll", closeStoryWordPopover, true);
  window.removeEventListener("resize", closeStoryWordPopover);
}

function positionStoryWordPopover(popover, wordSpan) {
  const wordRect = wordSpan.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const gap = 8;

  let top = wordRect.top - popoverRect.height - gap;
  if (top < 8) {
    top = wordRect.bottom + gap; // Not enough room above — show below instead.
  }

  const maxLeft = window.innerWidth - popoverRect.width - 8;
  const left = Math.max(8, Math.min(wordRect.left, maxLeft));

  popover.style.top = `${Math.round(top)}px`;
  popover.style.left = `${Math.round(left)}px`;
}

function updateStoryWordPopoverStar(button, entry, isSaved) {
  const word = getDisplayedAnswer(entry.ord);
  const action = isSaved ? "Remove" : "Add";
  const destination = isSaved ? "from My Words" : "to My Words";

  button.classList.toggle("is-saved", isSaved);
  button.setAttribute("aria-pressed", String(isSaved));
  button.setAttribute("aria-label", `${action} ${word} ${destination}`);
  button.title = `${action} ${word} ${destination}`;
  button.querySelector("i").className = `${isSaved ? "fas" : "far"} fa-star`;
}

// Applies a suffix-rule transform to only the last word of a (possibly
// multi-word) gloss — "wedding day" -> "wedding days", not "wedding
// daydays" or a transform blindly applied across the whole phrase.
function applyToLastWord(gloss, transform) {
  const words = gloss.split(" ");
  const lastWord = words.pop();
  return [...words, transform(lastWord)].join(" ");
}

// English noun phrases are head-final ("wedding day" -> the day, so
// applyToLastWord is right for pluralizing), but English verb phrases are
// not — phrasal verbs put the conjugatable verb first and the particle(s)
// after ("give up", "look forward to", "be able to"). Conjugating the last
// word of "be able to" gives "be able toes"; conjugating the first word
// gives the correct "is able to".
function applyToFirstWord(gloss, transform) {
  const words = gloss.split(" ");
  const firstWord = words.shift();
  return [transform(firstWord), ...words].join(" ");
}

// Covers the highest-frequency irregular nouns — not exhaustive (a rarer
// one like "die"/"dice" is still a known gap), but "man"/"woman"/"child"
// etc. are common enough in any A1-C vocabulary that the regular "+s" rule
// would visibly misfire ("womans") on them constantly otherwise.
const IRREGULAR_NOUN_PLURALS = {
  man: "men",
  woman: "women",
  child: "children",
  person: "people",
  foot: "feet",
  tooth: "teeth",
  mouse: "mice",
  goose: "geese",
  ox: "oxen",
  louse: "lice",
  die: "dice",
  medium: "media",
};

// Covers ~100 of the most common English irregular verbs — enough for
// typical A1-B2 vocabulary, not an exhaustive list of the several hundred
// that exist. Present tense isn't conjugated at all (see
// VERB_SLOT_GLOSS_TRANSFORMS), so only past/participle are ever read here.
const IRREGULAR_VERBS = {
  be: { past: "was", participle: "been" },
  have: { past: "had", participle: "had" },
  do: { past: "did", participle: "done" },
  go: { past: "went", participle: "gone" },
  get: { past: "got", participle: "gotten" },
  make: { past: "made", participle: "made" },
  know: { past: "knew", participle: "known" },
  think: { past: "thought", participle: "thought" },
  take: { past: "took", participle: "taken" },
  see: { past: "saw", participle: "seen" },
  come: { past: "came", participle: "come" },
  give: { past: "gave", participle: "given" },
  find: { past: "found", participle: "found" },
  tell: { past: "told", participle: "told" },
  become: { past: "became", participle: "become" },
  leave: { past: "left", participle: "left" },
  feel: { past: "felt", participle: "felt" },
  bring: { past: "brought", participle: "brought" },
  begin: { past: "began", participle: "begun" },
  keep: { past: "kept", participle: "kept" },
  hold: { past: "held", participle: "held" },
  write: { past: "wrote", participle: "written" },
  stand: { past: "stood", participle: "stood" },
  hear: { past: "heard", participle: "heard" },
  let: { past: "let", participle: "let" },
  mean: { past: "meant", participle: "meant" },
  set: { past: "set", participle: "set" },
  meet: { past: "met", participle: "met" },
  run: { past: "ran", participle: "run" },
  pay: { past: "paid", participle: "paid" },
  sit: { past: "sat", participle: "sat" },
  speak: { past: "spoke", participle: "spoken" },
  lie: { past: "lay", participle: "lain" },
  lay: { past: "laid", participle: "laid" },
  lead: { past: "led", participle: "led" },
  read: { past: "read", participle: "read" },
  grow: { past: "grew", participle: "grown" },
  lose: { past: "lost", participle: "lost" },
  fall: { past: "fell", participle: "fallen" },
  send: { past: "sent", participle: "sent" },
  build: { past: "built", participle: "built" },
  understand: { past: "understood", participle: "understood" },
  draw: { past: "drew", participle: "drawn" },
  break: { past: "broke", participle: "broken" },
  spend: { past: "spent", participle: "spent" },
  cut: { past: "cut", participle: "cut" },
  rise: { past: "rose", participle: "risen" },
  drive: { past: "drove", participle: "driven" },
  buy: { past: "bought", participle: "bought" },
  wear: { past: "wore", participle: "worn" },
  choose: { past: "chose", participle: "chosen" },
  eat: { past: "ate", participle: "eaten" },
  drink: { past: "drank", participle: "drunk" },
  sing: { past: "sang", participle: "sung" },
  ring: { past: "rang", participle: "rung" },
  swim: { past: "swam", participle: "swum" },
  fly: { past: "flew", participle: "flown" },
  fight: { past: "fought", participle: "fought" },
  win: { past: "won", participle: "won" },
  sleep: { past: "slept", participle: "slept" },
  wake: { past: "woke", participle: "woken" },
  sell: { past: "sold", participle: "sold" },
  teach: { past: "taught", participle: "taught" },
  catch: { past: "caught", participle: "caught" },
  cost: { past: "cost", participle: "cost" },
  put: { past: "put", participle: "put" },
  hit: { past: "hit", participle: "hit" },
  hurt: { past: "hurt", participle: "hurt" },
  shut: { past: "shut", participle: "shut" },
  forget: { past: "forgot", participle: "forgotten" },
  forgive: { past: "forgave", participle: "forgiven" },
  hide: { past: "hid", participle: "hidden" },
  ride: { past: "rode", participle: "ridden" },
  shoot: { past: "shot", participle: "shot" },
  show: { past: "showed", participle: "shown" },
  shine: { past: "shone", participle: "shone" },
  steal: { past: "stole", participle: "stolen" },
  strike: { past: "struck", participle: "struck" },
  swear: { past: "swore", participle: "sworn" },
  sweep: { past: "swept", participle: "swept" },
  throw: { past: "threw", participle: "thrown" },
  weep: { past: "wept", participle: "wept" },
  bear: { past: "bore", participle: "borne" },
  bend: { past: "bent", participle: "bent" },
  bind: { past: "bound", participle: "bound" },
  bite: { past: "bit", participle: "bitten" },
  bleed: { past: "bled", participle: "bled" },
  blow: { past: "blew", participle: "blown" },
  breed: { past: "bred", participle: "bred" },
  deal: { past: "dealt", participle: "dealt" },
  dig: { past: "dug", participle: "dug" },
  feed: { past: "fed", participle: "fed" },
  freeze: { past: "froze", participle: "frozen" },
  hang: { past: "hung", participle: "hung" },
  kneel: { past: "knelt", participle: "knelt" },
  lend: { past: "lent", participle: "lent" },
  light: { past: "lit", participle: "lit" },
  quit: { past: "quit", participle: "quit" },
  seek: { past: "sought", participle: "sought" },
  shake: { past: "shook", participle: "shaken" },
  shrink: { past: "shrank", participle: "shrunk" },
  sink: { past: "sank", participle: "sunk" },
  slide: { past: "slid", participle: "slid" },
  spin: { past: "spun", participle: "spun" },
  split: { past: "split", participle: "split" },
  spread: { past: "spread", participle: "spread" },
  spring: { past: "sprang", participle: "sprung" },
  stick: { past: "stuck", participle: "stuck" },
  sting: { past: "stung", participle: "stung" },
  swing: { past: "swung", participle: "swung" },
  tear: { past: "tore", participle: "torn" },
  wind: { past: "wound", participle: "wound" },
  withdraw: { past: "withdrew", participle: "withdrawn" },
};

// Covers the handful of adjectives whose comparative/superlative are
// entirely different words rather than a suffix or "more"/"most" — the
// common gap otherwise ("good" -> "gooder").
const IRREGULAR_ADJECTIVES = {
  good: { comparative: "better", superlative: "best" },
  bad: { comparative: "worse", superlative: "worst" },
  far: { comparative: "further", superlative: "furthest" },
  little: { comparative: "less", superlative: "least" },
  many: { comparative: "more", superlative: "most" },
  much: { comparative: "more", superlative: "most" },
};

// Naive English suffix rules layered under the irregular-form tables above
// — enough for common regular forms, not a full grammar engine. A rarer
// irregular not in those tables is a known remaining gap; a multi-word or
// otherwise irregular-looking gloss is left alone rather than mangled (see
// the length/shape guard in comparativeAndSuperlative, which the others
// don't need since a wrong-but-plausible "-s"/"-ed" guess on a long word
// is far less visibly broken than a wrong "-er"/"-est" guess would be).
// Norwegian has several nouns whose plural is the everyday/only form used
// ("penger", "briller", "solbriller") while their singular dictionary
// headword ("penge", "brille", "solbrille") is rare or archaic — but their
// *English* gloss doesn't have a distinct plural at all, because English
// treats the same concept as inherently plural-only ("glasses",
// "sunglasses" — nobody says "a glass" for eyewear) or as a mass noun
// ("money"). Pluralizing that gloss further is always wrong, whether by
// corrupting an already-plural word ("glasses" -> "glasseses") or by
// inventing a form English doesn't have ("money" -> "moneys"). Keyed by
// the gloss word itself (lowercased) rather than the Norwegian lemma,
// since this reflects a property of the *English* word, and the same
// fix therefore also covers any other entry whose gloss happens to be one
// of these, not just the specific Norwegian words that prompted it.
const INVARIANT_ENGLISH_PLURAL_NOUNS = new Set([
  "money",
  "news",
  "furniture",
  "information",
  "advice",
  "equipment",
  "luggage",
  "glasses",
  "sunglasses",
  "goggles",
  "binoculars",
  "pants",
  "trousers",
  "shorts",
  "jeans",
  "pajamas",
  "scissors",
  "pliers",
  "tongs",
  "tweezers",
  "clothes",
  "series",
  "species",
  "means",
]);

function pluralizeEnglishGloss(gloss) {
  return applyToLastWord(gloss, (word) => {
    if (INVARIANT_ENGLISH_PLURAL_NOUNS.has(word.toLowerCase())) return word;
    const irregular = IRREGULAR_NOUN_PLURALS[word.toLowerCase()];
    if (irregular) return irregular;
    if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
    if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
    return `${word}s`;
  });
}

function regularPastSuffix(word) {
  if (/e$/i.test(word)) return `${word}d`;
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/i.test(word)) return `${word}${word.slice(-1)}ed`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ied`;
  return `${word}ed`;
}

function pastTenseEnglishGloss(gloss) {
  return applyToFirstWord(gloss, (word) => {
    const irregular = IRREGULAR_VERBS[word.toLowerCase()]?.past;
    return irregular || regularPastSuffix(word);
  });
}

// Regular participles share their form with the regular past tense
// ("helped"/"helped"), but irregulars very often don't ("go" -> "went"
// past vs. "gone" participle) — this is why present perfect uses this
// rather than reusing pastTenseEnglishGloss.
function pastParticipleEnglishGloss(gloss) {
  return applyToFirstWord(gloss, (word) => {
    const irregular = IRREGULAR_VERBS[word.toLowerCase()]?.participle;
    return irregular || regularPastSuffix(word);
  });
}

// Comparative/superlative only get real "-er"/"-est" morphology for a
// short single-word gloss — same rule real English follows (compare
// "bigger"/"biggest" against "more beautiful"/"most beautiful" rather than
// "beautifuller").
function comparativeAndSuperlative(gloss) {
  const irregular = IRREGULAR_ADJECTIVES[gloss.toLowerCase()];
  if (irregular) return irregular;
  if (gloss.includes(" ") || gloss.length > 7) {
    return { comparative: `more ${gloss}`, superlative: `most ${gloss}` };
  }
  if (/e$/i.test(gloss)) {
    return { comparative: `${gloss}r`, superlative: `${gloss}st` };
  }
  if (/[^aeiou]y$/i.test(gloss)) {
    const stem = gloss.slice(0, -1);
    return { comparative: `${stem}ier`, superlative: `${stem}iest` };
  }
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/i.test(gloss)) {
    const doubled = gloss + gloss.slice(-1);
    return { comparative: `${doubled}er`, superlative: `${doubled}est` };
  }
  return { comparative: `${gloss}er`, superlative: `${gloss}est` };
}

// Every paradigm's slots follow a fixed order (see getParadigm in
// inflections.js) — knowing which slot the clicked surface form matched is
// enough to turn a base dictionary gloss into the actually-inflected
// English one, without a second dictionary entry per form.
//
// Noun slots: [indefinite singular, definite singular, indefinite plural,
// definite plural]. English marks these with "the" and a plural suffix.
const NOUN_SLOT_GLOSS_TRANSFORMS = [
  (gloss) => gloss,
  (gloss) => `the ${gloss}`,
  (gloss) => pluralizeEnglishGloss(gloss),
  (gloss) => `the ${pluralizeEnglishGloss(gloss)}`,
];

// Verb slots: [infinitive, present, past, present perfect, imperative].
// Present tense uses the same bare base form as the infinitive rather than
// a 3rd-person-singular "-s" conjugation ("forstår" -> "understand", not
// "understands") — Norwegian present tense doesn't mark person at all
// (jeg/du/han/vi/dere/de forstår are all identical), so singling out a
// 3rd-person English reading would be an arbitrary, unearned choice, not a
// more accurate one. Present perfect is shown as the bare participle
// ("erfart" -> "experienced", not "has experienced") for the same
// reason — the participle itself is what's actually in the text; "has"
// presumes a specific "har X" construction around the clicked word that
// isn't always there (a past participle also stands alone adjectivally/
// statively in Norwegian, same as in English), and unlike the noun/
// adjective slots, there's no single word in the surface form itself that
// signals which reading applies. Uses the participle rather than the past
// tense, since for irregular verbs those differ ("gone", not "went").
const VERB_SLOT_GLOSS_TRANSFORMS = [
  (gloss) => gloss,
  (gloss) => gloss,
  (gloss) => pastTenseEnglishGloss(gloss),
  (gloss) => pastParticipleEnglishGloss(gloss),
  (gloss) => `${gloss}!`,
];

// Adjective slots: [masculine, feminine, neuter, definite singular,
// plural, comparative, superlative, definite superlative]. Unlike Norwegian,
// English adjectives don't inflect for gender/number/definiteness at all
// ("stor"/"stort"/"store" are all just "big") — only comparative and
// superlative actually change the English word. Definite superlative
// ("den største") is the one slot that does add an English article, since
// it's the form used pronominally ("the biggest").
function getAdjectiveSlotGloss(baseGloss, slotIndex) {
  const { comparative, superlative } = comparativeAndSuperlative(baseGloss);
  const bySlot = [
    baseGloss,
    baseGloss,
    baseGloss,
    baseGloss,
    baseGloss,
    comparative,
    superlative,
    `the ${superlative}`,
  ];
  return bySlot[slotIndex] ?? baseGloss;
}

// Verb paradigm slots 5 and 11 are the s-passive present ("brukes" = "is
// used") and present participle ("brukende" = "using" — also how
// adjectives formed from a verb, like "pulserende"/pulsating, are
// reached, since they're not separate dictionary entries) — confirmed
// empirically (getParadigm has no documented index-to-label mapping
// beyond the 5 learner-facing slots) by checking several verbs:
// bruke/kalle/lage/se/finne/gjøre all put these at the same two indices.
// The remaining hidden slots (6-10) are mostly duplicate/alternate forms
// of slots already handled elsewhere (participle gender variants,
// alternate pasts) and are left as the unchanged base gloss.
const VERB_PASSIVE_PRESENT_SLOT = 5;
const VERB_PRESENT_PARTICIPLE_SLOT = 11;
// The "-ering"/"-ing" verbal noun slot deriveVerbalNounForms adds after the
// twelve official Ordbank-shaped slots (see inflections.js) — e.g.
// "fermentering" for "fermentere". Reads the same as the present participle
// in English ("fermenting"), so it shares that transform.
const VERB_VERBAL_NOUN_SLOT = 12;

// "pulse" -> "pulsing", not "pulseing"; "die" -> "dying"; "stop" ->
// "stopping" (only single-word glosses get the CVC-doubling check — same
// reasoning as comparativeAndSuperlative for why that's skipped on
// anything longer).
function ingFormEnglishGloss(gloss) {
  return applyToFirstWord(gloss, (word) => {
    if (/ie$/i.test(word)) return `${word.slice(0, -2)}ying`;
    if (/[^aeiou]e$/i.test(word)) return `${word.slice(0, -1)}ing`;
    if (/^[^aeiou]*[aeiou][^aeiouwxy]$/i.test(word)) {
      return `${word}${word.slice(-1)}ing`;
    }
    return `${word}ing`;
  });
}

// A possessive ("bordets", "mannens") isn't one of a noun's own 4 paradigm
// forms — inflections.js derives it separately, by appending -s (or just
// an apostrophe, for a base already ending in s/x/z) to any of them — see
// createNounPossessiveForms in inflections.js. This reverses that: strip
// the same suffix and see which of the entry's own forms is left, to know
// whether the result should be "a table's", "the table's", "tables'", or
// "the tables'".
function getNounPossessiveMatchSlot(entry, surfaceWord) {
  const candidates = [];
  if (/['’]$/.test(surfaceWord)) candidates.push(surfaceWord.slice(0, -1));
  if (/s$/i.test(surfaceWord)) candidates.push(surfaceWord.slice(0, -1));

  for (const candidate of candidates) {
    const slots = window.Inflections?.getMatchingSlots?.(entry, candidate) || [];
    if (slots.length > 0) return slots[0];
  }
  return null;
}

function possessiveEnglishGloss(baseGloss, underlyingSlotIndex) {
  const isPlural = underlyingSlotIndex === 2 || underlyingSlotIndex === 3;
  const isDefinite = underlyingSlotIndex === 1 || underlyingSlotIndex === 3;
  const noun = isPlural ? pluralizeEnglishGloss(baseGloss) : baseGloss;
  const apostropheForm = /s$/i.test(noun) ? `${noun}'` : `${noun}'s`;
  return isDefinite ? `the ${apostropheForm}` : apostropheForm;
}

// Turns a base English gloss into the form matching one specific paradigm
// slot of one specific word class — the same transform table regardless of
// whether that slot came from an ordinary noun/verb/adjective entry or from
// one component word inside a multi-word expression (see getStoryWordGloss
// below), so a plural/tense/comparative reads correctly in both places
// instead of expressions being limited to whichever slots someone
// separately re-implemented for them.
function applySlotGlossTransform(baseGloss, wordClass, slotIndex) {
  if (slotIndex === undefined) return baseGloss;

  if (wordClass === "adjective") return getAdjectiveSlotGloss(baseGloss, slotIndex);

  if (wordClass === "verb" && slotIndex === VERB_PASSIVE_PRESENT_SLOT) {
    return `be ${pastParticipleEnglishGloss(baseGloss)}`;
  }
  if (
    wordClass === "verb" &&
    (slotIndex === VERB_PRESENT_PARTICIPLE_SLOT ||
      slotIndex === VERB_VERBAL_NOUN_SLOT)
  ) {
    return ingFormEnglishGloss(baseGloss);
  }

  const transformsBySlot =
    wordClass === "noun"
      ? NOUN_SLOT_GLOSS_TRANSFORMS
      : wordClass === "verb"
        ? VERB_SLOT_GLOSS_TRANSFORMS
        : null;
  const transform = transformsBySlot?.[slotIndex];

  return transform ? transform(baseGloss) : baseGloss;
}

function getStoryWordGloss(entry, surfaceWord, expressionSlot) {
  const baseGloss = getDisplayedAnswer(entry.engelsk);
  const wordClass = WordClass.getWordClass(entry.gender);

  // Expressions have no single-lemma paradigm for getMatchingSlots to check
  // below (that's built for individual noun/verb/adjective entries), so
  // whichever of an expression's own component words actually carried the
  // matched inflection — found while locating its occurrence in the story
  // text, see findExpressionMatchesInSentence — is threaded in directly
  // instead, as {wordClass, slotIndex} for that one component. Without
  // this, every occurrence showed the bare citation gloss regardless of
  // the form actually in the text: a verb-headed expression always read as
  // the infinitive ("enter") even when the text had "trådte inn"
  // (entered), and a noun-headed one never pluralized at all ("sosiale
  // medier" read as "social medium" instead of "social media").
  if (wordClass === "expression") {
    if (!expressionSlot) return baseGloss;
    return applySlotGlossTransform(
      baseGloss,
      expressionSlot.wordClass,
      expressionSlot.slotIndex,
    );
  }

  const matchingSlots =
    window.Inflections?.getMatchingSlots?.(entry, surfaceWord) || [];
  const slotIndex = matchingSlots[0];

  if (slotIndex === undefined) {
    if (wordClass === "noun") {
      const possessiveSlot = getNounPossessiveMatchSlot(entry, surfaceWord);
      if (possessiveSlot !== null) {
        return possessiveEnglishGloss(baseGloss, possessiveSlot);
      }
    }
    return baseGloss;
  }

  return applySlotGlossTransform(baseGloss, wordClass, slotIndex);
}

// Cache of normalized surface form -> Promise<resolved entries>. Caching the
// promise itself, not just its eventually-resolved value, matters here: a
// popover click can land while the initial highlight pass (below) is still
// mid-flight resolving the very same word, and without this both callers
// would race independently instead of sharing one computation. A word this
// cheap to resolve also doesn't need per-story invalidation (the dictionary
// itself doesn't change at runtime), so one cache serves the whole session.
const storyWordEntryPromiseCache = new Map();

function resolveStoryWordEntries(normalizedWord) {
  let promise = storyWordEntryPromiseCache.get(normalizedWord);
  if (promise) return promise;

  promise = (async () => {
    // This promise is cached forever below, so resolving it before the
    // dictionary is ready would permanently freeze a false "not found" for
    // this word (see wordSearchIndex.norwegianExact.get below). The two
    // callers of getStoryWordSpanEntries both already wait for this
    // themselves before the normal per-click path reaches here, but
    // highlightKnownStoryWords also runs directly off "my-words:updated"
    // (stories.js, near the bottom) with no such gate — that event can
    // fire early (e.g. a signed-in My Words remote merge completing) on a
    // direct story link, while the ~29k-row CSV parse this word lookup
    // depends on is still running. "både"/"og" are common enough to be on
    // screen — and so swept into that premature pass — in nearly every
    // story.
    await waitForDictionaryData();

    // Deliberately not just resolveWordSearchQuery(): that function
    // short-circuits to the exact match alone whenever the clicked surface
    // form happens to also be a standalone dictionary word ("exact" reason,
    // scripts.js) — the right call for a search box, but wrong here.
    // "hjelper" IS the noun "helper", but it's ALSO the present tense of
    // the verb "hjelpe" ("helps"); resolveWordSearchQuery would only ever
    // surface the former. Checking findLemmas independently, in addition
    // to the exact match, catches both.
    const entries = [];
    const addEntry = (entry) => {
      if (!entries.includes(entry)) entries.push(entry);
    };

    // The clicked surface form is itself a headword ("hjelper") — every
    // sense spelled that way is fair game regardless of class, since no
    // lemma-inference is involved here at all.
    for (const entry of wordSearchIndex.norwegianExact.get(normalizedWord) || []) {
      addEntry(entry);
    }

    // The clicked form is an inflected form of some OTHER lemma. Matching
    // by word class (not just the bare lemma string) matters here: looking
    // entries up by spelling alone would also surface an unrelated
    // homograph that merely shares that spelling — "skolen" only inflects
    // from the noun "skole" (school), but "skole" is ALSO a separate verb
    // entry ("to teach") with no form "skolen" at all, and would otherwise
    // show up as a bogus second hint.
    const officialResolution =
      await window.Inflections?.findLemmas(normalizedWord);
    (officialResolution?.matches || []).forEach(({ lemma, wordClass }) => {
      for (const entry of wordSearchIndex.norwegianExact.get(lemma) || []) {
        if (WordClass.getWordClass(entry.gender) === wordClass) addEntry(entry);
      }
    });

    return entries;
  })();

  storyWordEntryPromiseCache.set(normalizedWord, promise);
  return promise;
}

// Multi-word expressions ("bestemme seg", "gå gjennom ild og vann") need to
// be treated as one clickable unit rather than their individual words —
// resolveStoryWordEntries has no way to reassemble "bestemmer" + "seg"
// back into the expression, since expressions aren't part of the
// noun/verb/adjective inflection system at all. window.ExpressionPatterns
// (built for the exact same problem in sentence search — see scripts.js)
// already knows how to locate an expression's inflected occurrences inside
// arbitrary text, so this reuses it rather than re-deriving that grammar.
// ExpressionPatterns.isPhraseEntry also covers multi-word conjunctions
// ("selv om", "så lenge") that are genuinely conjunctions, not expressions,
// but are still a fixed multi-word citation that should read as one hint.
//
// ~3,400 expression entries exist — far too many to pattern-match against
// every sentence directly. This builds a cheap reverse index (component
// word -> candidate expressions) once, so a given sentence only pays the
// real matching cost for the small handful of expressions that could
// plausibly appear in it.
const EXPRESSION_INDEX_STOPWORDS = new Set([
  "seg", "meg", "deg", "oss", "dere", "det", "den", "de", "noe", "noen",
  "nokon", "noko", "en", "ei", "et", "å", "som", "sin", "sitt", "sine",
]);

// A story reached directly by URL renders before the ~29k-row dictionary
// has loaded (see the initialStoryRoute delay in scripts.js) — this index
// is built from `results`, so it must not be memoized off an empty/not-
// -yet-loaded dictionary, or expression detection would silently never
// work for the rest of that page's lifetime.
let expressionComponentIndex = null;

async function buildExpressionComponentIndex() {
  if (expressionComponentIndex) return expressionComponentIndex;
  if (results.length === 0) return new Map();

  // First pass: each expression's own non-stopword component words, kept
  // *per spelling variant* (entry.ord's comma-separated alternatives, e.g.
  // "til sjuende og sist, til syvende og sist") rather than merged — an
  // alternate spelling's distinctive word ("syvende") doesn't appear in
  // the other variant ("sjuende") at all, so a story using that spelling
  // needs its own variant's words available to index under. Also a
  // running count of how many *other* expressions share each word, across
  // all variants.
  const expressionEntries = [];
  const wordFrequency = new Map();

  for (const entry of results) {
    if (!window.ExpressionPatterns?.isPhraseEntry(entry)) continue;

    const variants =
      window.ExpressionPatterns?.getVariants?.(entry) ??
      String(entry.ord || "")
        .split(",")
        .map((variant) => variant.trim());

    const variantWordLists = variants
      .map((variant) => [
        ...new Set(
          (variant.match(STORY_WORD_TOKEN_REGEX) || [])
            .map(normalizeSearchText)
            .filter((word) => word && !EXPRESSION_INDEX_STOPWORDS.has(word)),
        ),
      ])
      .filter((words) => words.length > 0);
    if (variantWordLists.length === 0) continue;

    expressionEntries.push({ entry, variantWordLists });
    const allWords = new Set(variantWordLists.flat());
    allWords.forEach((word) => wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1));
  }

  // Second pass: index each expression under the rarest component of
  // *each* of its spelling variants, not one rarest word overall — picking
  // a single global rarest word could land on one variant's distinctive
  // word and leave a story occurrence of a different variant with no
  // shared index key at all. The full pattern match still requires all of
  // an expression's own words to be present regardless of which one
  // indexed it, so this only narrows *candidates* — it can't cause a real
  // match to be missed. (A handful of extremely common verbs — "være",
  // "gå", "ta" — are each a component of 90-100+ expressions; indexing
  // under every component word instead of just the rarest per variant
  // would turn nearly every sentence into 100+ compile() calls, since
  // those verbs show up in almost every sentence a story has.)
  const index = new Map();
  for (const { entry, variantWordLists } of expressionEntries) {
    const rarestWordsPerVariant = new Set(
      variantWordLists.map((words) =>
        words.reduce((rarest, word) =>
          wordFrequency.get(word) < wordFrequency.get(rarest) ? word : rarest,
        ),
      ),
    );
    for (const word of rarestWordsPerVariant) {
      if (!index.has(word)) index.set(word, []);
      index.get(word).push(entry);
    }
  }

  expressionComponentIndex = index;
  return index;
}

// Resolves once the dictionary has either loaded or given up trying —
// upgradeStoryExpressionSpans needs to wait for this rather than run once
// and silently find nothing on a direct story-link page load.
function waitForDictionaryData() {
  if (results.length > 0 || dictionaryLoadFailed) return Promise.resolve();
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (results.length > 0 || dictionaryLoadFailed) {
        clearInterval(interval);
        resolve();
      }
    }, 200);
  });
}

// A wildcard/placeholder slot in an expression pattern (e.g. "gjøre noe
// for [noen]") could in principle match across a large stretch of a
// sentence — capped here so one runaway match can't visually swallow half
// a sentence into one clickable unit. citationWordCount + 3 gives room for
// a filled placeholder or two without allowing that.
function isReasonableExpressionMatchLength(matchedText, citationWordCount) {
  const matchedWordCount = (matchedText.match(STORY_WORD_TOKEN_REGEX) || []).length;
  return matchedWordCount > 0 && matchedWordCount <= citationWordCount + 3;
}

// The matcher's wildcard/placeholder support is meant for expressions that
// really do have a variable slot ("gjøre noe for [noen]"), but it also lets
// match.start..match.end span two of the expression's own words with
// completely unrelated text in between — e.g. matching "være ... på" across
// "er et symbol på", where "et symbol" has nothing to do with the
// expression. match.spans holds each individually-matched word's own
// range, so a real word (not just whitespace/punctuation) sitting in the
// gap between two consecutive spans means this occurrence shouldn't be
// treated as one clickable phrase.
function hasUnrelatedWordsBetweenSpans(matchSpans, text) {
  const sorted = [...(matchSpans || [])].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const gapText = text.slice(sorted[i - 1].end, sorted[i].start);
    if (/[\p{L}\p{N}]/u.test(gapText)) return true;
  }
  return false;
}

async function findExpressionMatchesInSentence(sentenceText) {
  const index = await buildExpressionComponentIndex();
  const words = sentenceText.match(STORY_WORD_TOKEN_REGEX) || [];
  if (words.length === 0) return [];

  const uniqueNormalizedWords = [...new Set(words.map(normalizeSearchText))];
  const candidateEntries = new Set();

  for (const word of uniqueNormalizedWords) {
    for (const candidate of index.get(word) || []) candidateEntries.add(candidate);

    const officialResolution = await window.Inflections?.findLemmas(word);
    for (const lemma of officialResolution?.lemmas || []) {
      for (const candidate of index.get(lemma) || []) candidateEntries.add(candidate);
    }
  }

  if (candidateEntries.size === 0) return [];

  const spans = [];
  for (const entry of candidateEntries) {
    const analysis = await window.ExpressionPatterns?.getAnalysis(entry);
    const matcher = analysis?.matcher;
    if (!matcher) continue;

    // The longest spelling variant's word count — not just the first
    // variant's — so a match against a longer alternate spelling isn't
    // spuriously rejected as "too long" relative to a shorter one.
    const variants =
      window.ExpressionPatterns?.getVariants?.(entry) ??
      String(entry.ord || "")
        .split(",")
        .map((variant) => variant.trim());
    const citationWordCount = Math.max(
      0,
      ...variants.map(
        (variant) => (variant.match(STORY_WORD_TOKEN_REGEX) || []).length,
      ),
    );

    // Mirrors ExpressionPatterns' own .highlight() cursor loop — walk
    // forward finding every non-overlapping occurrence in this sentence,
    // not just the first.
    let cursor = 0;
    while (cursor < sentenceText.length) {
      const remaining = sentenceText.slice(cursor);
      const match = matcher.find(remaining);
      if (!match) break;

      const start = match.start + cursor;
      const end = match.end + cursor;
      const matchedText = sentenceText.slice(start, end);
      if (
        isReasonableExpressionMatchLength(matchedText, citationWordCount) &&
        !hasUnrelatedWordsBetweenSpans(match.spans, remaining)
      ) {
        // Same "which node is the (finite) verb" check
        // createVerbExpressionForms uses to build the Word Forms table —
        // reused here so a story occurrence's gloss can reflect the actual
        // form matched ("trådte inn" -> "entered", "sosiale medier" ->
        // "social media") instead of always the citation form. Verb is
        // checked first and, if present, wins outright — the existing,
        // already-correct priority for a verb-headed expression — falling
        // back to a noun then an adjective component for expressions
        // headed by those instead. node.infinitiveOnly nodes (a verb
        // governed by an authored "å", not independently inflected) are
        // skipped so a modal/infinitive pair doesn't pick the wrong one.
        const inflectedSpan =
          match.spans.find(
            (span) =>
              span.node?.selected?.wordClass === "verb" &&
              !span.node?.infinitiveOnly,
          ) ||
          match.spans.find((span) => span.node?.selected?.wordClass === "noun") ||
          match.spans.find(
            (span) => span.node?.selected?.wordClass === "adjective",
          );
        const expressionSlot = inflectedSpan
          ? {
              wordClass: inflectedSpan.node.selected.wordClass,
              slotIndex: inflectedSpan.slotIndexes?.[0],
            }
          : undefined;
        spans.push({ start, end, entry, expressionSlot });
      }
      cursor += Math.max(match.end, 1);
    }
  }

  // Longer matches win on overlap (a 3-word expression fully containing a
  // 2-word one should keep the more specific reading).
  spans.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const accepted = [];
  for (const span of spans) {
    const overlaps = accepted.some(
      (existing) => span.start < existing.end && span.end > existing.start,
    );
    if (!overlaps) accepted.push(span);
  }
  accepted.sort((a, b) => a.start - b.start);
  return accepted;
}

// Object identity can't survive a round trip through an HTML string /
// dataset attribute, so matched expression entries are kept here and
// referenced from their span by a small numeric id instead.
const expressionEntryRegistry = new Map();
// Parallel map, same ids: which component word's slot (if any — see
// expressionSlot in findExpressionMatchesInSentence) this specific
// occurrence matched. Kept separate from expressionEntryRegistry rather
// than wrapping its values, since My Words / star-toggle code elsewhere
// expects the raw dictionary entry.
const expressionSlotRegistry = new Map();
let nextExpressionEntryId = 0;

function registerExpressionEntry(entry, expressionSlot) {
  const id = String(nextExpressionEntryId++);
  expressionEntryRegistry.set(id, entry);
  if (expressionSlot) expressionSlotRegistry.set(id, expressionSlot);
  return id;
}

// Replaces the .story-word span(s) + connecting text covering [span.start,
// span.end) in `container`'s raw text with a single new span, so the whole
// expression becomes one clickable unit instead of two/three separate
// word clicks. Offsets are recomputed from the live DOM on every call
// (rather than trusting stale numbers) — since the replacement swaps nodes
// for a single span of identical combined text, total length never
// changes, so processing order doesn't matter.
function replaceStoryWordSpanWithExpression(container, span, entry, expressionSlot) {
  let offset = 0;
  const nodesToReplace = [];

  for (const child of Array.from(container.childNodes)) {
    const text = child.textContent;
    const childStart = offset;
    const childEnd = offset + text.length;
    if (childEnd > span.start && childStart < span.end) {
      nodesToReplace.push(child);
    }
    offset = childEnd;
  }
  if (nodesToReplace.length === 0) return;

  const matchedText = nodesToReplace.map((node) => node.textContent).join("");
  const newSpan = document.createElement("span");
  newSpan.className = "story-word story-word-expression";
  newSpan.dataset.word = matchedText;
  newSpan.dataset.exprId = registerExpressionEntry(entry, expressionSlot);
  newSpan.textContent = matchedText;

  nodesToReplace[0].parentNode.insertBefore(newSpan, nodesToReplace[0]);
  nodesToReplace.forEach((node) => node.remove());
}

async function upgradeStoryExpressionSpans() {
  await waitForDictionaryData();
  await window.Inflections?.preload();

  const sentenceEls = document.querySelectorAll(".japanese-sentence[data-raw-text]");
  for (const sentenceEl of sentenceEls) {
    const rawText = sentenceEl.dataset.rawText;
    const matches = await findExpressionMatchesInSentence(rawText);
    matches.forEach((match) =>
      replaceStoryWordSpanWithExpression(
        sentenceEl,
        match,
        match.entry,
        match.expressionSlot,
      ),
    );
  }
}

// Kicks off the expression-merging and My-Words-highlight passes on genuine
// browser idle time rather than in the same tick the story becomes
// visible. Both passes can trigger Inflections' one-time-per-page-load
// reverse-index warm-up (see buildReverseIndexes in inflections.js), which
// is real, if background-safe, CPU work — starting it immediately competed
// with whatever else was settling right as a story opened, making the
// story feel slow to load even though its content was already on screen.
// Individual word clicks don't wait on any of this (see
// getExactMatchEntries in showStoryWordPopover), so nothing about reading
// or looking up a word depends on how quickly this finishes.
function scheduleStoryUpgrades() {
  const run = () => {
    // Expression spans must be merged before the My Words highlight pass
    // runs over them, or it would just see (and correctly, but
    // pointlessly) evaluate their since-replaced individual word spans.
    upgradeStoryExpressionSpans().then(() => highlightKnownStoryWords());
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 3000 });
  } else {
    setTimeout(run, 300);
  }
}

// A word can resolve to more than one dictionary entry — either a single
// spelling with multiple senses (homonyms), or, like "hjelper", two
// entirely different lemmas (the verb "hjelpe" present tense vs. the noun
// "hjelper"). Rather than guess from context, every distinct sense is shown
// as its own row.
const MAX_STORY_WORD_POPOVER_SENSES = 4;

function getExactMatchEntries(normalizedWord) {
  return wordSearchIndex.norwegianExact.get(normalizedWord) || [];
}

// state: "dictionary-loading" | "loading" | "empty" | "ready". Split out
// from showStoryWordPopover so it can be called twice: once synchronously
// with whatever's instantly available, and again if a slower follow-up
// lookup finds more.
function renderStoryWordPopoverContent(
  popover,
  entries,
  surfaceWord,
  normalizedWord,
  state,
  expressionSlot,
) {
  popover.innerHTML = "";
  popover.classList.remove("story-word-popover-empty");

  if (state === "dictionary-loading") {
    popover.classList.add("story-word-popover-empty");
    popover.textContent = "Loading dictionary…";
    return;
  }

  if (state === "loading") {
    popover.classList.add("story-word-popover-empty");
    popover.textContent = "Looking up…";
    return;
  }

  if (state === "empty") {
    // Fails without erroring — proper nouns, names, and words outside the
    // dictionary are expected to turn up nothing. The flag link reuses the
    // exact same "missing word" feedback channel as the main search page's
    // no-results state (see flagMissingWordEntry in scripts.js), so both
    // land in the same reviewable list.
    popover.classList.add("story-word-popover-empty");

    const emptyText = document.createElement("span");
    emptyText.textContent = "No definition found";

    const flagButton = document.createElement("button");
    flagButton.type = "button";
    flagButton.className = "story-word-popover-flag-btn";
    flagButton.textContent = "Flag missing word";
    flagButton.addEventListener("click", (event) => {
      event.stopPropagation();
      flagMissingWordEntry(surfaceWord);
      closeStoryWordPopover();
    });

    popover.append(emptyText, flagButton);
    return;
  }

  const seenGlosses = new Set();

  // Easiest sense first — someone at A1 hitting an ambiguous word usually
  // wants the common everyday reading before a rarer C-level one.
  const orderedEntries = [...entries].sort(
    (a, b) =>
      (CEFR_ORDER[String(a.CEFR).toUpperCase()] || 99) -
      (CEFR_ORDER[String(b.CEFR).toUpperCase()] || 99),
  );

  orderedEntries.slice(0, MAX_STORY_WORD_POPOVER_SENSES).forEach((entry) => {
    const gloss = getStoryWordGloss(entry, normalizedWord, expressionSlot);
    const glossKey = gloss.toLowerCase();
    if (seenGlosses.has(glossKey)) return;
    seenGlosses.add(glossKey);

    const row = document.createElement("div");
    row.className = "story-word-popover-row";

    const translationEl = document.createElement("span");
    translationEl.className = "story-word-popover-translation";
    translationEl.textContent = gloss;

    const starButton = document.createElement("button");
    starButton.type = "button";
    starButton.className = "word-list-favorite-button story-word-popover-star";
    starButton.innerHTML = '<i aria-hidden="true"></i>';
    updateStoryWordPopoverStar(
      starButton,
      entry,
      window.MyWordsAPI?.isSaved?.(entry) ?? false,
    );

    starButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const nowSaved = Boolean(window.MyWordsAPI?.toggle?.(entry));
      updateStoryWordPopoverStar(starButton, entry, nowSaved);
    });

    row.append(translationEl, starButton);
    popover.appendChild(row);
  });
}

async function showStoryWordPopover(wordSpan) {
  const surfaceWord = wordSpan.dataset.word || wordSpan.textContent;
  const normalizedWord = normalizeSearchText(surfaceWord);

  closeStoryWordPopover();
  if (!normalizedWord) return;

  const popover = document.createElement("div");
  popover.className = "story-word-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", `Definition of ${surfaceWord}`);

  const isExpression = wordSpan.classList.contains("story-word-expression");

  // Render instantly with whatever's available synchronously, without
  // waiting on Inflections — an expression's entry is already resolved
  // (via the registry, from when its span was built), and most Norwegian
  // text isn't inflected on every single word, so a plain exact-index hit
  // is common too. Only a genuinely inflected surface form (e.g.
  // "bryllupet") needs the slower lookup below, which can be very slow
  // the first time it runs on a given page load (see buildReverseIndexes
  // in inflections.js) — blocking every click on it made even
  // already-known words feel broken.
  const instantEntries = isExpression
    ? [expressionEntryRegistry.get(wordSpan.dataset.exprId)].filter(Boolean)
    : results.length > 0
      ? getExactMatchEntries(normalizedWord)
      : [];
  const instantState = isExpression
    ? instantEntries.length > 0
      ? "ready"
      : "empty"
    : results.length === 0
      ? "dictionary-loading"
      : instantEntries.length > 0
        ? "ready"
        : "loading";
  const expressionSlot = isExpression
    ? expressionSlotRegistry.get(wordSpan.dataset.exprId)
    : undefined;

  renderStoryWordPopoverContent(
    popover,
    instantEntries,
    surfaceWord,
    normalizedWord,
    instantState,
    expressionSlot,
  );

  document.body.appendChild(popover);
  positionStoryWordPopover(popover, wordSpan);
  activeStoryWordPopover = popover;

  window.addEventListener("scroll", closeStoryWordPopover, true);
  window.addEventListener("resize", closeStoryWordPopover);

  // An expression's entry is already resolved via the registry — nothing
  // slower left to check.
  if (isExpression) return;

  // Either the dictionary itself hasn't finished loading yet (a click can
  // land here on a direct story link, before the ~29k-row CSV parse
  // completes), or — the common case — it has, but this surface form
  // needed the slower inflection-aware lookup. Previously only the second
  // case was ever followed up on, so a click during that dictionary-load
  // window got stuck showing "Loading dictionary…" forever instead of
  // ever resolving.
  await waitForDictionaryData();
  await window.Inflections?.preload();
  const fullEntries = await getStoryWordSpanEntries(wordSpan);

  // The user may have closed this popover, or opened a different one,
  // while the fuller (inflection-aware) lookup was still in flight — don't
  // resurrect or overwrite whatever's showing now.
  if (activeStoryWordPopover !== popover) return;
  // instantEntries is always a subset of fullEntries by construction (the
  // exact-match lemma is included in resolveStoryWordEntries' own lookup
  // too), so an equal count normally means nothing new was found — except
  // when instantState was "loading" (not yet a final state, just "found
  // nothing *yet*"). A word the fuller lookup also fails to resolve — as
  // happens for a handful of genuinely irregular forms the inflection data
  // doesn't cover, e.g. "tennene" — must still surface a final "No
  // definition found" instead of being left stuck on "Looking up…" forever
  // just because the count (0) happened not to change.
  if (instantState !== "loading" && fullEntries.length === instantEntries.length) {
    return;
  }

  renderStoryWordPopoverContent(
    popover,
    fullEntries,
    surfaceWord,
    normalizedWord,
    fullEntries.length > 0 ? "ready" : "empty",
  );
  positionStoryWordPopover(popover, wordSpan);
}

// Colors a word in the story text the same gold as a filled My Words star
// (.is-saved) if it's already saved, so known vocabulary stands out while
// reading without having to click each word to check. Runs once per story
// render and again on my-words:updated so starring a word from the
// popover recolors it immediately.
async function getStoryWordSpanEntries(span) {
  if (span.classList.contains("story-word-expression")) {
    const entry = expressionEntryRegistry.get(span.dataset.exprId);
    return entry ? [entry] : [];
  }

  const normalizedWord = normalizeSearchText(span.dataset.word || span.textContent);
  return normalizedWord ? resolveStoryWordEntries(normalizedWord) : [];
}

async function highlightKnownStoryWords() {
  if (!window.MyWordsAPI || !isStoriesTabActive()) return;

  const wordSpans = Array.from(document.querySelectorAll(".story-word"));
  if (wordSpans.length === 0) return;

  await window.Inflections?.preload();

  const entriesBySpan = await Promise.all(
    wordSpans.map((span) => getStoryWordSpanEntries(span)),
  );

  wordSpans.forEach((span, index) => {
    const isKnown = entriesBySpan[index].some((entry) =>
      window.MyWordsAPI.isSaved(entry),
    );
    span.classList.toggle("story-word-known", isKnown);
  });
}

window.addEventListener("my-words:updated", () => {
  highlightKnownStoryWords();
});

document.addEventListener("click", (event) => {
  const wordSpan = event.target.closest(".story-word");
  if (wordSpan) {
    showStoryWordPopover(wordSpan);
    return;
  }

  if (activeStoryWordPopover && !event.target.closest(".story-word-popover")) {
    closeStoryWordPopover();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeStoryWordPopover();
  }
});
