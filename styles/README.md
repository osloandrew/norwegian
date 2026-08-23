# Stylesheet map

The files in this directory replace the former 7,762-line `styles.css` file.
They began as contiguous, behavior-preserving slices; focused cleanup passes
now move shared rules into dedicated files while browser checks guard the
cascade. Their order in `index.html` remains intentional.

## Current order

1. `00-foundations-and-game.css` — tokens, shared primitives, and the original
   core Word Game rules.
2. `01-document-shell.css` — shared document sizing and the header/main/footer
   shell.
3. `10-shell-landing-and-stats.css` — authentication shell, landing page,
   vocabulary profile, and My Stats.
4. `20-results-and-story-quiz.css` — result cards, filters, sentence
   results, story reading, and story quiz rules.
5. `30-stories-and-word-lists.css` — story-list utilities and word-list table
   components.
6. `40-responsive-and-mode-overrides.css` — remaining feature/navigation
   responsive rules and desktop mode overrides, kept late in the cascade.
7. `50-late-feature-components.css` — later My Words, sentence-header, and
   report/feedback dialog refinements.

## Refactoring rules

- Do not reorder the stylesheet links without running visual regression checks.
- Add new feature rules to the file that already owns that feature; avoid
  adding more rules to the responsive override file.
- Before relocating an existing rule, check for later selectors that override
  it, including responsive and mode-scoped selectors.
- Prefer class selectors for new components. Reduce existing IDs and
  `!important` declarations only in focused cleanup passes that verify every
  affected state.
- Update a file's cache-busting query value in `index.html` whenever that file
  changes.

The document shell now owns its responsive behavior. Continue colocating the
remaining responsive rules with their features, one component at a time, with
before/after desktop and mobile checks.
