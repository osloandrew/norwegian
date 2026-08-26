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

In the Word Game, a match in **any** of the three sources primarily admits an
unseen word to the useful core pool. Within that pool, the blended weight
contributes only a secondary 1.0–1.7x selection multiplier, so learner-specific
memory need and challenge fit remain more influential than raw frequency.

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

A form is ambiguous, and credited to nobody, whenever more than one distinct
entry claims it — whether both claims are exact spellings, both are
inflectional matches, or one of each. That last case matters more than it
looks: an entry's own exact-listed alternate spelling can coincide with an
unrelated, often far more common word's official inflected form (e.g. "allé"
lists "alle" as an alternate spelling, but "alle" is also the plural of the
unrelated quantifier "all"; the noun "bør" is spelled identically to the
present tense of the unrelated verb "burde"). Checking exact matches alone
would let the exact claim silently win and misattribute the other word's
entire frequency. Estimated dictionary-only paradigms and paradigms
mechanically inherited from another lemma are also excluded as evidence.

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

Each entry record is keyed by normalized primary spelling plus dictionary word
class or gender and contains:

- `rank` — position in the blended ranking;
- `weight` — the blended 0–1 score consumed directly by the Word Game;
- `bandPercentile` — `weight` re-normalized (min-max) against only the other
  entries sharing this word's own CEFR band, so a word can be globally rare
  but still rank high *within its band* (or vice versa) — this is what
  nudges per-word difficulty; and
- `sources` — per-source `{count, coverage}`, where `coverage` is
  `exact-lemma`, `unique-inflection`, or `exact-and-inflected`.

An absent record means *unobserved in every retained source*, not necessarily
rare in every kind of Norwegian.

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
