# Bokmål vocabulary-frequency data

`vocabulary-frequency.json` is a compact derivative of the 2025 **Frekvensordliste
(bokmål) fra ord i norsk avisspråk**, published by the CLARINO Bergen Centre at
the University of Bergen.

- Source: <https://repo.clarino.uib.no/xmlui/handle/11509/157>
- Authors: CLARINO Bergen senter; Gunn Inger Lyse Samdal
- Corpus: Norsk aviskorpus, eleven major newspapers, material from 1998–2022
- Source list generated: 25 August 2025
- License: [Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/)

The source contains the 10,000 most frequent observed forms, including
punctuation and case-distinct duplicates. The generated browser snapshot:

1. removes punctuation and numeric forms;
2. uses lowercase occurrences only, reducing newspaper-specific names,
   mastheads, and credit labels such as the source's own `VG`/`Foto` examples;
3. keeps only exact spellings present in `norwegianWords.csv`; and
4. stores each match's rank among the remaining lexical source forms.

This conservative first version does not infer lemmas from inflected forms.
Without part-of-speech information, doing so could incorrectly transfer a very
common form's frequency to an unrelated homograph. The frequency snapshot is
selection metadata only; the source dictionary CSV remains unchanged.

To refresh from CLARINO:

```sh
python3 scripts/build-vocabulary-frequency.py
```

For a reproducible build from an already-downloaded TSV:

```sh
python3 scripts/build-vocabulary-frequency.py --source /path/to/frekvensordliste-aviskorpus-nob.tsv
```
