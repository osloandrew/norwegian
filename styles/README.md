# Stylesheet map

The files in this directory replace the former 7,762-line `styles.css` file.
They began as contiguous, behavior-preserving slices; focused cleanup passes
now move shared rules into dedicated files while browser checks guard the
cascade. Their order in `index.html` remains intentional.

## Current order

1. `00-foundations-and-game.css` — tokens, shared primitives, and core Word
   Game rules across desktop and responsive layouts.
2. `01-document-shell.css` — shared document sizing and the header/main/footer
   shell.
3. `10-shell-landing-and-stats.css` — authentication shell, landing page,
   vocabulary profile, My Stats, forms, and footer links.
4. `20-results-and-story-quiz.css` — result cards, filters, sentence results,
   story reading, and story quiz rules across desktop and responsive layouts.
5. `30-stories-and-word-lists.css` — story-list utilities and responsive
   word-list table components.
6. `35-navigation.css` — base and responsive behavior for the shared
   mode/filter/search toolbar and its Word Game controls.
7. `50-late-feature-components.css` — later My Words, sentence-header, and
   report/feedback dialog refinements.

## Refactoring rules

- Do not reorder the stylesheet links without running visual regression checks.
- Add new feature rules, including responsive behavior, to the file that
  already owns that feature.
- Before relocating an existing rule, check for later selectors that override
  it, including responsive and mode-scoped selectors.
- Prefer class selectors for new components. Reduce existing IDs and
  `!important` declarations only in focused cleanup passes that verify every
  affected state.
- Update a file's cache-busting query value in `index.html` whenever that file
  changes.

The document shell, shared navigation, Word Game, result views, Stories, and
word lists now own their responsive behavior. The remaining late-feature file
is intentionally last in the cascade until its component rules are merged into
their owning files in a focused pass.
