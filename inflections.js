// Authoritative Bokmål noun, adjective, and verb paradigms for the
// learner-facing "Word forms" table. The compact data file is generated from
// Norsk Ordbank (see INFLECTIONS_DATA.md) and loaded only after the dictionary
// is ready or when a learner first opens a table.
(function () {
  "use strict";

  const DATA_VERSION = 3;
  const DATA_URL = `inflections-data.json?v=${DATA_VERSION}`;
  const MAX_PENDING_ENTRIES = 100;
  const CLASS_PREFIX = {
    noun: "n",
    adjective: "a",
    verb: "v",
  };

  let snapshot = window.__BOKMAL_INFLECTIONS_DATA__ || null;
  let snapshotPromise = snapshot ? Promise.resolve(snapshot) : null;
  let loadFailed = false;
  let nextRequestId = 1;
  const pendingEntries = new Map();

  function extractLemma(entry) {
    return String(entry.ord ?? "")
      .split(",")[0]
      .trim();
  }

  function extractLemmas(entry) {
    return String(entry.ord ?? "")
      .split(",")
      .map((lemma) => lemma.trim())
      .filter(Boolean);
  }

  function normalizeLemma(lemma) {
    return lemma.normalize("NFC").toLowerCase();
  }

  function isProperNoun(lemma) {
    const first = lemma.charAt(0);
    return (
      first !== "" &&
      first === first.toUpperCase() &&
      first !== first.toLowerCase()
    );
  }

  function extractNounArticles(entry) {
    return WordClass.stripNounPrefix(entry.gender)
      .split("-")
      .filter((token) => token === "en" || token === "et" || token === "ei");
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function displayValue(values, transform = (value) => value) {
    const accepted = unique((values || []).map(transform));
    if (accepted.length === 0) return "–";
    return accepted.length === 1 ? accepted[0] : accepted;
  }

  function decodeRecord(record) {
    // Version 2 stores each paradigm as one compact string to avoid retaining
    // tens of thousands of tiny arrays. Accept the old array shape as well so
    // a cached version-1 payload can still finish a page load safely.
    if (Array.isArray(record)) return record;
    if (typeof record !== "string") return null;
    return record
      .split("|")
      .map((field) => (field ? field.split("/") : []));
  }

  function createNounForms(entry, lemma, record) {
    const articles = extractNounArticles(entry);
    if (articles.length === 0) return null;

    // Bokmål feminine nouns may also follow common-gender inflection. Keep
    // both accepted indefinite articles when the dictionary lists only "ei".
    const indefiniteArticles =
      articles.includes("ei") && !articles.includes("en")
        ? [...articles, "en"]
        : articles;

    return {
      wordClass: "noun",
      isAuthoritative: true,
      source: "Norsk Ordbank",
      forms: [
        {
          label: "Indefinite singular",
          value: displayValue(indefiniteArticles, (article) => `${article} ${lemma}`),
        },
        { label: "Definite singular", value: displayValue(record[0]) },
        { label: "Indefinite plural", value: displayValue(record[1]) },
        { label: "Definite plural", value: displayValue(record[2]) },
      ],
    };
  }

  function createAdjectiveForms(record) {
    return {
      wordClass: "adjective",
      isAuthoritative: true,
      source: "Norsk Ordbank",
      forms: [
        { label: "Masculine", value: displayValue(record[0]) },
        { label: "Feminine", value: displayValue(record[1]) },
        { label: "Neuter", value: displayValue(record[2]) },
        { label: "Definite singular", value: displayValue(record[3]) },
        { label: "Plural", value: displayValue(record[4]) },
        { label: "Comparative", value: displayValue(record[5]) },
        { label: "Superlative", value: displayValue(record[6]) },
        { label: "Definite superlative", value: displayValue(record[7]) },
      ],
    };
  }

  function createVerbForms(record) {
    return {
      wordClass: "verb",
      isAuthoritative: true,
      source: "Norsk Ordbank",
      forms: [
        {
          label: "Infinitive",
          value: displayValue(record[0], (value) => `å ${value}`),
        },
        { label: "Present", value: displayValue(record[1]) },
        { label: "Past", value: displayValue(record[2]) },
        {
          label: "Present perfect",
          value: displayValue(record[3], (value) => `har ${value}`),
        },
        {
          label: "Imperative",
          value: displayValue(record[4], (value) => `${value}!`),
        },
      ],
    };
  }

  function createForms(entry) {
    if (!snapshot?.forms) return null;

    const lemma = extractLemma(entry);
    if (!lemma || isProperNoun(lemma)) return null;

    const wordClass = WordClass.getWordClass(entry.gender);
    const prefix = CLASS_PREFIX[wordClass];
    if (!prefix) return null;

    const encodedRecord = snapshot.forms[`${prefix}:${normalizeLemma(lemma)}`];
    if (!encodedRecord) return null;
    const record = decodeRecord(encodedRecord);
    if (!record) return null;

    if (wordClass === "noun") return createNounForms(entry, lemma, record);
    if (wordClass === "adjective") return createAdjectiveForms(record);
    return createVerbForms(record);
  }

  function collectSentenceForms(entry) {
    const lemmas = extractLemmas(entry);
    const accepted = lemmas.map(normalizeLemma);
    if (!snapshot?.forms) return unique(accepted);

    const wordClass = WordClass.getWordClass(entry.gender);
    const prefix = CLASS_PREFIX[wordClass];
    if (!prefix) return unique(accepted);

    for (const lemma of lemmas) {
      const encodedRecord = snapshot.forms[`${prefix}:${normalizeLemma(lemma)}`];
      if (!encodedRecord) continue;
      const record = decodeRecord(encodedRecord);
      if (!record) continue;
      record.forEach((field) => accepted.push(...field.map(normalizeLemma)));
    }

    return unique(accepted);
  }

  function loadSnapshot() {
    if (snapshot) return Promise.resolve(snapshot);
    if (loadFailed) return Promise.resolve(null);
    if (snapshotPromise) return snapshotPromise;

    snapshotPromise = fetch(DATA_URL, { cache: "default" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Inflection data request failed (${response.status})`);
        }
        return response.json();
      })
      .then((data) => {
        if (!data || typeof data.forms !== "object") {
          throw new Error("Inflection data has an invalid format");
        }
        snapshot = data;
        return snapshot;
      })
      .catch((error) => {
        loadFailed = true;
        console.warn("Verified word forms could not be loaded.", error);
        return null;
      });

    return snapshotPromise;
  }

  function rememberPendingEntry(entry) {
    const requestId = String(nextRequestId++);
    pendingEntries.set(requestId, {
      ord: entry.ord,
      gender: entry.gender,
    });

    // Search results can be rerendered repeatedly without a table ever being
    // opened. Bound this short-lived cache so abandoned cards cannot leak.
    while (pendingEntries.size > MAX_PENDING_ENTRIES) {
      pendingEntries.delete(pendingEntries.keys().next().value);
    }
    return requestId;
  }

  function getForms(entry) {
    if (!entry || !entry.ord || !entry.gender) return null;

    const lemma = extractLemma(entry);
    if (!lemma || isProperNoun(lemma)) return null;

    const wordClass = WordClass.getWordClass(entry.gender);
    if (!CLASS_PREFIX[wordClass]) return null;
    if (wordClass === "noun" && extractNounArticles(entry).length === 0) {
      return null;
    }

    if (snapshot) return createForms(entry);
    if (loadFailed) return null;

    return {
      wordClass,
      pending: true,
      requestId: rememberPendingEntry(entry),
      forms: [],
    };
  }

  async function resolvePending(requestId) {
    const entry = pendingEntries.get(String(requestId));
    pendingEntries.delete(String(requestId));
    if (!entry) return null;

    const loaded = await loadSnapshot();
    return loaded ? createForms(entry) : null;
  }

  async function getSentenceForms(entry) {
    if (!entry?.ord) return [];

    const wordClass = WordClass.getWordClass(entry.gender);
    if (CLASS_PREFIX[wordClass] && !snapshot && !loadFailed) {
      await loadSnapshot();
    }
    return collectSentenceForms(entry);
  }

  window.Inflections = Object.freeze({
    getForms,
    getSentenceForms,
    preload: loadSnapshot,
    resolvePending,
    isReady: () => Boolean(snapshot),
  });
})();
