# Bokmål vocabulary-frequency data

`vocabulary-frequency.json` is generated entry-level selection metadata for the
Word Game. It does not add a column to or modify `norwegianWords.csv`.

## Frequency source

The deep-export maintenance command writes
`data/clarino-aviskorpus-bokmal-top-100000.tsv` from the live **Norsk
aviskorpus (Bokmål)** resource in CLARINO Corpuscle. It retains up to 100,000
observed forms instead of the deposited 2025 list's top 10,000. The export is
dated in its header so later corpus updates cannot silently change an ordinary
application build. Until that file is present, the builder safely falls back
to CLARINO's deposited top-10,000 TSV.

- Deposited 2025 list: <https://repo.clarino.uib.no/xmlui/handle/11509/157>
- Live corpus/export interface: <https://clarino.uib.no/korpuskel/>
- Corpus: `avis-plain` / Aviskorpus (Bokmål)
- Deep-export license: CC BY-NC 4.0
- Deposited top-10,000-list license: CC BY 3.0

The source is newspaper language. Its rank is useful evidence, not a claim that
newspaper frequency perfectly represents conversation, fiction, or children's
language.

## Entry-level aggregation

The source contains observed forms, while the dictionary primarily contains
lemmas. The builder therefore:

1. removes punctuation, numeric forms, and uppercase newspaper artifacts;
2. assigns an exact spelling only when it identifies one dictionary entry;
3. reverse-maps remaining forms through authoritative paradigms in
   `inflections-data.json` (Norsk Ordbank, CC BY 4.0);
4. accepts an inflection only when it resolves to one entry unambiguously;
5. sums all accepted surface-form counts for that entry; and
6. ranks entries by the aggregated count.

Ambiguous forms are deliberately not copied to every possible homograph.
Estimated dictionary-only paradigms and paradigms mechanically inherited from
another lemma are also excluded as frequency evidence.

Each record is keyed by normalized primary spelling plus dictionary word class
or gender and contains:

- aggregated count;
- rank;
- coverage (`exact-lemma`, `unique-inflection`, or both); and
- evidence confidence.

An absent record means *unobserved in the retained source evidence*, not
necessarily rare in every kind of Norwegian.

## Maintenance

Rebuild the compact browser sidecar from the stored export:

```sh
npm run build:frequency
```

Refresh the stored 100,000-form Corpuscle export, then rebuild:

```sh
npm run export:frequency
npm run build:frequency
```

The export is intentionally a separate maintenance step because Corpuscle must
scan and aggregate a very large corpus. Ordinary builds are deterministic and
offline once the dated TSV is stored.
