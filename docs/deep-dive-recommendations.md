# Web App Deep-Dive Recommendations

This document captures the architecture, performance, and accessibility improvements previously discussed so you can revisit them at any time.

## Simplification Priorities (Ranked)
1. **Modularize dictionary and sentence search orchestration (`scripts.js`)** – The main script still couples global state, CSV ingestion, sentence indexing, and UI rendering in one file, making even minor changes risky. Breaking the fetch/parse/index pipeline into a data layer that feeds slimmer view components would let you reuse the cache, share the sentence index, and drop a large amount of defensive DOM code that exists only to guard shared globals. 【F:scripts.js†L1-L258】【F:scripts.js†L284-L420】
2. **Extract a reusable story list presenter (`stories.js`)** – Story loading, filtering, shuffling, and DOM construction all live together and imperatively manipulate the results container. Consolidating the filter logic and rendering into smaller functions (or templates) would eliminate duplicate element wiring and reduce the sprawling switch logic around CEFR/genre toggles. 【F:stories.js†L1-L183】
3. **Slim down the pronunciation practice module (`pronunciation.js`)** – Audio URL generation, MFCC/DTW scoring, CEFR decorations, and markup assembly happen inline, leading to repeated string building and complex branching. Isolating the audio analysis and view-building helpers would simplify experimentation with alternative scoring approaches while keeping the UI code lean. 【F:pronunciation.js†L1-L200】

## Data and Search Performance
- Cache parsed dictionary CSV data in memory (or persist in IndexedDB) to avoid reparsing on every search.
- Pre-index high-frequency fields (e.g., lemmas, parts of speech) for faster lookups.
- Decouple UI-driven fetches from rendering so repeated queries reuse cached results.
- Replace brittle suffix stripping with a morphological ruleset or server-side inflection service.

## Pronunciation Workflow
- Reuse a single `AudioContext` instance across pronunciation requests to avoid expensive reinitialization.
- Move phoneme generation into a Web Worker to keep the main thread responsive.
- Delay loading of pronunciation-only scripts until the user opens that feature.

## Front-End Architecture
- Break large inline script blocks into ES modules and load them with `type="module"` and `defer`.
- Normalize fetch logic through a dedicated data service module to share caching and error handling.
- Split UI state management from DOM manipulation to simplify future framework adoption.

## Accessibility and UX
- Wrap search inputs and controls in semantic `<form>` elements to enable keyboard submission.
- Provide visible labels or aria-labels for icon-only buttons.
- Ensure focus styles are visible and consistent across interactive controls.
- Use descriptive headings and landmark roles to improve screen-reader navigation.

## Next Steps
- Validate the new sentence search retriever with real user flows and capture before/after metrics to quantify the win.
- Extend the faster lookup approach to pronunciation and definition queries so all fetch paths benefit from consistent caching.
- Break the monolithic scripts into feature modules (search, sentences, pronunciation, games) that share a single data service.
- Harden accessibility by adding semantic forms, labels, and keyboard focus states while you refactor the UI.
- Add automated regression tests covering search accuracy, pronunciation latency, and word-game scoring to protect future changes.

