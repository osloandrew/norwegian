# Bokmål vocabulary-frequency data

`vocabulary-frequency.json` is generated entry-level selection metadata for the
Word Game. It does not add a column to or modify `norwegianWords.csv`.

## Frequency sources

A single register (e.g. newspaper text) is a skewed proxy for "useful"
vocabulary — it over-represents its own domain's jargon and under-represents
everything else. This build blends three registers instead, so no one
corpus's quirks dominate the signal:

| Source | Register | Stored snapshot | Export script |
| --- | --- | --- | --- |
| CLARINO Norsk aviskorpus (Bokmål) | Newspaper | `data/clarino-aviskorpus-bokmal-top-100000.tsv` | `scripts/export-clarino-frequency.py` |
| OpenSubtitles2018 (hermitdave/FrequencyWords) | Conversational / spoken | `data/opensubtitles-bokmal-full.tsv` | `scripts/export-opensubtitles-frequency.py` |
| NB N-gram digibok (Nasjonalbiblioteket) | Literary / books | `data/nb-ngram-digibok-bokmal-top-100000.tsv` | `scripts/export-nb-ngram-frequency.py` |

Each export script writes a dated, `#`-commented TSV snapshot in the shared
`count\tword` shape, so the build reads all three through the same generic
parser. Every export is dated in its header so later corpus updates cannot
silently change an ordinary application build. If a source's stored snapshot
is absent, the build skips that source with a printed warning rather than
attempting a live multi-gigabyte download — CLARINO alone keeps its historical
fallback to the small deposited top-10,000 list, since that is itself a
stable, versioned artifact rather than a live corpus.

- CLARINO deposited 2025 list: <https://repo.clarino.uib.no/xmlui/handle/11509/157>
- CLARINO live corpus/export interface: <https://clarino.uib.no/korpuskel/>
- CLARINO corpus: `avis-plain` / Aviskorpus (Bokmål)
- OpenSubtitles source: <https://github.com/hermitdave/FrequencyWords>
- NB N-gram source: <https://www.nb.no/sprakbanken/en/resource-catalogue/oai-nb-no-sbr-70/>

> **TODO (licensing/attribution):** CLARINO's deep export is CC BY-NC 4.0
> (non-commercial), the deposited top-10,000 list is CC BY 3.0, OpenSubtitles
> content is CC BY-SA-4.0 (share-alike — obligates attribution and a
> compatible license on redistributed derivatives), and NB N-gram is CC0. The
> per-source `license` field in `vocabulary-frequency.json`'s `sources` object
> records which applies to each; the actual compliance/attribution text for
> the app is being handled separately and isn't drafted here.

The CLARINO source in particular is newspaper language; its rank is useful
evidence, not a claim that newspaper frequency perfectly represents
conversation, fiction, or children's language — which is exactly the gap the
other two sources are meant to help close.

In the Word Game, reliable entry evidence from **any** source admits an unseen
word to the useful core pool. An ambiguous surface form can also admit only its
lowest-CEFR candidate (or all candidates tied at that lowest level) through a
separate exposure proxy. Reliable blended weight contributes a secondary
1.0–1.7x selection multiplier; proxy-only evidence is capped at 1.2x. Learner-
specific memory need and challenge fit therefore remain more influential.

Frequency also refines per-word **difficulty**, not just selection: a word's
`bandPercentile` (see below) nudges it within its hand-tagged CEFR band,
feeding the Elo-style ability rating, exercise-mode prediction, and
word-selection weighting alike (see `getWordDifficultyAnchor` in
`wordGame.js`). CEFR bands remain the primary, hand-curated difficulty
signal — frequency only refines position *within* a band, never reorders
bands, since a word's frequency alone can't be trusted to make it easier or
harder than an entire CEFR level.

## Entry-level aggregation

Each source contains observed forms, while the dictionary primarily contains
lemmas. The builder therefore, independently per source:

1. removes punctuation, numeric forms, and uppercase newspaper/text artifacts;
2. checks each form against both an exact-spelling match and an official
   inflection match from `inflections-data.json` (Norsk Ordbank, CC BY 4.0);
3. accepts the form only when exactly one distinct entry claims it — across
   *both* checks together, not each in isolation — and sums its counts
   toward that entry, per source.

A form is ambiguous, and its count is credited to no entry, whenever more than
one distinct entry claims it — whether both claims are exact spellings, both are
inflectional matches, or one of each. That last case matters more than it
looks: an entry's own exact-listed alternate spelling can coincide with an
unrelated, often far more common word's official inflected form (e.g. "allé"
lists "alle" as an alternate spelling, but "alle" is also the plural of the
unrelated quantifier "all"; the noun "bør" is spelled identically to the
present tense of the unrelated verb "burde"). Checking exact matches alone
would let the exact claim silently win and misattribute the other word's
entire frequency. The form is not discarded altogether: it becomes
**surface-exposure evidence** for the candidate(s) at the lowest CEFR level.
This is a curriculum priority (teach the easiest interpretation of a common
form first), not a claim that those candidates produced every corpus token.

When the lowest-CEFR candidates are still tied (e.g. the preposition "i" and
the letter name "I, i" are both A1), one more tiebreak applies before
falling back to an even split: if the tie mixes a closed word class
(pronoun/preposition/conjunction/determiner — `CLOSED_WORD_CLASSES` in
`scripts/build-vocabulary-frequency.py`) with an open one, the closed-class
candidate gets the exposure proxy and the open-class one does not. Closed
classes dominate raw token frequency in any corpus regardless of curriculum
level, so that's a stronger prior than the CEFR tie itself. A tie among
only-closed or only-open candidates has no such signal and stays split
across all of them, same as before this tiebreak existed. A candidate that
loses the tiebreak can still separately earn its own (typically much
smaller) reliable rank from forms the other sense could never produce —
the letter noun "i" still ranks on its own plural "ier", it just doesn't
also share in the preposition's exposure proxy. The resulting proxy record's
`basis` is `"lowest-cefr-closed-class"` when this tiebreak fired, or plain
`"lowest-cefr"` otherwise.

Exposure proxies never contribute entry counts or difficulty percentiles.
Estimated dictionary-only paradigms and paradigms mechanically inherited from
another lemma are also excluded as reliable evidence.

The generated-data build requires every dictionary row to contain a recognized
CEFR value. The browser retains its B1 fallback only as defensive handling for
malformed runtime data; generated records never silently substitute B1.

## Blending

Raw counts aren't comparable across corpora of wildly different sizes (a
~100,000-form CLARINO export vs. a multi-million-token book corpus), so
counts are never summed directly. Instead, per source: `log1p(count)` is
min-max normalized across that source's own matched entries, producing a
0–1 score. An entry's final `weight` is the **mean of that normalized score,
averaged only over the sources that actually matched it** — a word attested
across multiple registers scores higher; a word unique to one register (e.g.
conversational-only) still gets in via that source alone. Entries are then
ranked by blended `weight` descending.

Each record is keyed by normalized primary spelling plus dictionary word class
or gender. Multiple dictionary senses may therefore share reliable headword/POS
frequency without being forced to share a CEFR level. Records can contain:

- `rank` — position in the blended ranking;
- `weight` — the blended 0–1 score consumed directly by the Word Game;
- `bandPercentiles` — a map from each CEFR band represented by the grouped
  dictionary senses to `weight` re-normalized against that band. A runtime row
  reads only its own band, so an A2 and B1 sense sharing a key do not inherit
  whichever CEFR row happened to appear first;
- `sources` — per-source `{count, coverage}`, where `coverage` is
  `exact-lemma`, `unique-inflection`, or `exact-and-inflected`; source-level
  metadata reports how many candidate entries had evidence withheld; and
- `exposureProxy` — a separately ranked, blended surface-exposure record with
  `eligibleBands` and `basis` (`"lowest-cefr"`, or `"lowest-cefr-closed-class"`
  when the closed-vs-open-class tiebreak above decided it).

Proxy-only records intentionally have no reliable `rank`, `weight`, `sources`,
or `bandPercentiles`. This makes it impossible for ambiguous evidence to nudge
Elo difficulty accidentally.

An absent record means neither reliable entry evidence nor qualifying lowest-
CEFR surface exposure was found. It does not necessarily mean the word is rare.

## Maintenance

Rebuild the compact browser sidecar from the stored exports:

```sh
npm run build:frequency
```

Refresh each stored snapshot, then rebuild:

```sh
npm run export:frequency
npm run export:frequency:opensubtitles
npm run export:frequency:nb-ngram
npm run build:frequency
```

Each export is a separate maintenance step because two of the three sources
require scanning or downloading a very large corpus. Ordinary builds are
deterministic and offline once the dated TSVs are stored.
