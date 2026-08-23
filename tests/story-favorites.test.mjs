import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storage = new Map();
const events = [];
let now = 100;

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

const context = vm.createContext({
  console,
  CustomEvent: TestCustomEvent,
  Date: { now: () => now },
  JSON,
  Math,
  Number,
  Object,
  Set,
  String,
  decodeURIComponent,
  encodeURIComponent,
});
context.window = context;
context.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};
context.dispatchEvent = (event) => events.push(event);

vm.runInContext(
  fs.readFileSync(path.join(root, "storyFavorites.js"), "utf8"),
  context,
  { filename: "storyFavorites.js" },
);

const favorites = context.StoryFavoritesAPI;
const title = "Sámi-folket";
const titleKey = encodeURIComponent(title);

assert.equal(favorites.isSaved(title), false);
assert.equal(favorites.toggle(title), true);
assert.equal(favorites.isSaved(title), true);
assert.deepEqual([...favorites.getFavoriteTitles()], [title]);
assert.ok(
  storage.has("norwegian-dictionary-favorite-stories-v1"),
  "favorite state should be persisted locally",
);
assert.equal(events.at(-1).detail.syncRemote, true);

now = 200;
assert.equal(favorites.toggle(title), false);
assert.equal(favorites.isSaved(title), false);
assert.equal(favorites.parsePayload(favorites.getPayload()).entries[titleKey].present, false);

// A stale remote add cannot resurrect a newer local removal, and the event
// asks Firebase to repair the stale cloud payload.
const staleRemote = {
  version: 1,
  entries: { [titleKey]: { present: true, updatedAt: 150 } },
};
favorites.reconcile(staleRemote);
assert.equal(favorites.isSaved(title), false);
assert.equal(events.at(-1).detail.syncRemote, true);

// A genuinely newer change from another device wins locally without being
// echoed straight back to Firebase.
const newerRemote = {
  version: 1,
  entries: { [titleKey]: { present: true, updatedAt: 300 } },
};
favorites.reconcile(newerRemote);
assert.equal(favorites.isSaved(title), true);
assert.equal(events.at(-1).detail.syncRemote, false);

// Same-millisecond conflicts resolve toward removal.
const sameTimeRemoval = {
  version: 1,
  entries: { [titleKey]: { present: false, updatedAt: 300 } },
};
const tied = favorites.mergePayload(newerRemote, sameTimeRemoval);
assert.equal(tied.entries[titleKey].present, false);

assert.deepEqual(
  JSON.parse(favorites.serializePayload("not-json")),
  { version: 1, entries: {} },
);

// Guard the UI contract: the card control reuses the word favorite class and
// remains a sibling of the story link rather than an invalid nested button.
const storiesSource = fs.readFileSync(path.join(root, "stories.js"), "utf8");
assert.match(
  storiesSource,
  /word-list-favorite-button story-card-favorite-button/,
);
assert.match(
  storiesSource,
  /li\.appendChild\(createStoryCardLink\(story\)\);\s+li\.appendChild\(createStoryFavoriteButton\(story\)\);/,
);

const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const favoritesFilterIndex = indexSource.indexOf(
  'id="story-favorites-filter"',
);
const genreFilterIndex = indexSource.indexOf('id="genre-filter"');
const levelFilterIndex = indexSource.indexOf('class="cefr-filter-group"');
assert.ok(favoritesFilterIndex < genreFilterIndex);
assert.ok(genreFilterIndex < levelFilterIndex);

const chipListStart = storiesSource.indexOf("const activeFilterChips = [");
const chipListEnd = storiesSource.indexOf("]\n      .filter(Boolean)", chipListStart);
const chipListSource = storiesSource.slice(chipListStart, chipListEnd);
assert.ok(
  chipListSource.indexOf("showFavoritesOnly") <
    chipListSource.indexOf("selectedGenre"),
);
assert.ok(
  chipListSource.indexOf("selectedGenre") <
    chipListSource.indexOf("selectedCEFR"),
);

const storyStylesSource = fs.readFileSync(
  path.join(root, "styles/20-results-and-story-quiz.css"),
  "utf8",
);
assert.match(
  storyStylesSource,
  /\.story-card-favorite-button:not\(\.is-saved\)\s*\{\s*color:\s*#a9b0b8;/,
);
assert.match(
  storyStylesSource,
  /\.stories-detail-container\s*\{[\s\S]*?flex-direction:\s*column;/,
);
assert.match(
  storyStylesSource,
  /body\.stories-mode \.stories-detail-container\s*\{[\s\S]*?gap:\s*10px;[\s\S]*?padding-top:\s*40px;/,
);
assert.match(
  storyStylesSource,
  /body\.stories-mode \.story-card-favorite-button\s*\{[\s\S]*?height:\s*30px;/,
);
assert.match(
  storyStylesSource,
  /body\.stories-mode \.story-card-favorite-button::before\s*\{[\s\S]*?border-radius:\s*50%;[\s\S]*?height:\s*30px;[\s\S]*?width:\s*30px;/,
);
assert.ok(
  storiesSource.indexOf("detailContainer.appendChild(genreDiv)") <
    storiesSource.indexOf("detailContainer.appendChild(cefrDiv)"),
);

console.log("story favorite tests passed");
