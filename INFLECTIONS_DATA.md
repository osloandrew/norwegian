# Bokmål inflection data

`inflections-data.json` is a compact derivative of the structured
`lemma_expanded.json` export from **Norsk Ordbank – Bokmål**, maintained by the
University of Bergen and Språkrådet.

- Source: <https://ord.uib.no/bm/fil/lemma_expanded.json>
- Source documentation: <https://ord.uib.no/ord_1_Ordlister.html>
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)

The generated snapshot contains only noun, adjective, and verb lemmas used by
this project. Paradigms are encoded compactly and expanded only for the selected
word. The file is loaded outside the app's critical startup path and replaces
the former spelling-based guesses in the learner-facing **Word forms** table.
The grammatical category in `norwegianWords.csv` is authoritative when it
differs from Norsk Ordbank; for example, the project's adjective entry `alene`
is represented as an invariant adjective.

To refresh it from the current official export:

```sh
python3 scripts/build-inflections.py
```

For a reproducible build from an already-downloaded export:

```sh
python3 scripts/build-inflections.py --source /path/to/lemma_expanded.json
```
