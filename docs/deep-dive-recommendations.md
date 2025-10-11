# Web App Deep-Dive Recommendations

This document captures the architecture, performance, and accessibility improvements previously discussed so you can revisit them at any time.

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

