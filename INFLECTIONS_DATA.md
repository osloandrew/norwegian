# Bokmål inflection data

`inflections-data.json` is a compact derivative of the structured
`lemma_expanded.json` export from **Norsk Ordbank – Bokmål**, maintained by the
University of Bergen and Språkrådet.

- Source: <https://ord.uib.no/bm/fil/lemma_expanded.json>
- Source documentation: <https://ord.uib.no/ord_1_Ordlister.html>
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)

The generated snapshot contains only noun, adjective, and verb lemmas used by
this project, plus official component paradigms discovered automatically from
multi-word verb and expression entries. Expression components are lookup data;
their grammatical classes still come from Norsk Ordbank rather than being
invented from their position in a phrase.
Paradigms are encoded compactly and expanded only when used. The five verb forms
shown in the learner-facing **Word forms** table remain unchanged; hidden
official passive and participial slots support exact sentence search and Word
Game matching. The file is loaded outside the app's critical startup path and
replaces spelling-based guesses throughout the application.

Noun records are keyed by both lemma and the gender assigned to the individual
dictionary entry. Homographs such as masculine *far* (father) and neuter *far*
(track/course) therefore keep completely separate tables and sentence-search
forms. Dictionary entries with no exact Ordbank record receive either a
gender-compatible compound-head paradigm (clearly labeled as derived in the
UI) or a lemma-only table with unknown forms; guessed regular endings are never
presented as verified forms.

The grammatical category in `norwegianWords.csv` is authoritative when it
differs from Norsk Ordbank; for example, the project's adjective entry `alene`
is represented as an invariant adjective.

Comma-separated spelling variants in one dictionary entry retain their own
paradigms and are combined in the same Word Forms table. When distinct Ordbank
lexemes share both spelling and word class, an explicit learner-facing sense
preference can prevent an uncommon homograph from polluting the intended
paradigm; `være` therefore uses only the common `er – var – vært` sense rather
than also displaying the rare regular `værer – været` forms.

To refresh it from the current official export:

```sh
python3 scripts/build-inflections.py
```

For a reproducible build from an already-downloaded export:

```sh
python3 scripts/build-inflections.py --source /path/to/lemma_expanded.json
```
