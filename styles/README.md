# Stylesheet map

The files in this directory are the first, behavior-preserving step away from
the former 7,762-line `styles.css` file. They are contiguous slices of that
file, so their order in `index.html` reproduces the original cascade exactly.

## Current order

1. `00-foundations-and-game.css` — tokens, shared primitives, and the original
   core Word Game rules.
2. `10-shell-landing-and-stats.css` — header/authentication shell, landing page,
   vocabulary profile, and My Stats.
3. `20-results-and-story-quiz.css` — main/result cards, filters, sentence
   results, story reading, and story quiz rules.
4. `30-stories-and-word-lists.css` — story-list utilities and word-list table
   components.
5. `40-responsive-and-mode-overrides.css` — the original responsive and
   desktop mode overrides, kept late in the cascade.
6. `50-late-feature-components.css` — later My Words, sentence-header, and
   report/feedback dialog refinements.

## Refactoring rules

- Do not reorder the stylesheet links without running visual regression checks.
- During this first phase, add new feature rules to the file that already owns
  that feature; avoid adding more rules to the responsive override file.
- Before relocating an existing rule, check for later selectors that override
  it, including responsive and mode-scoped selectors.
- Prefer class selectors for new components. Existing IDs and `!important`
  declarations are retained until focused cleanup passes can verify each
  affected state.
- Update a file's cache-busting query value in `index.html` whenever that file
  changes.

The next phase is to move scattered global primitives into a dedicated base
section and colocate responsive rules with their features. That work can change
precedence, so it should be done component by component with before/after
desktop and mobile checks.
