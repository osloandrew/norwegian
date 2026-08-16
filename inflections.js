// Authoritative Bokmål noun, adjective, and verb paradigms for the
// learner-facing "Word forms" table. The compact data file is generated from
// Norsk Ordbank (see INFLECTIONS_DATA.md) and loaded only after the dictionary
// is ready or when a learner first opens a table.
(function () {
  "use strict";

  const DATA_VERSION = 8;
  const DATA_URL = `inflections-data.json?v=${DATA_VERSION}`;
  const MAX_PENDING_ENTRIES = 100;
  const CLASS_PREFIX = {
    noun: "n",
    adjective: "a",
    verb: "v",
  };
  const PREFIX_CLASS = {
    n: "noun",
    a: "adjective",
    v: "verb",
  };

  let snapshot = window.__BOKMAL_INFLECTIONS_DATA__ || null;
  let snapshotPromise = snapshot ? Promise.resolve(snapshot) : null;
  let loadFailed = false;
  let reverseIndex = null;
  let keyboardReverseIndex = null;
  let reverseIndexPromise = null;
  let dictionaryClassOverrideKeys = null;
  let dictionaryOnlyKeys = null;
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

  function canonicalNounGender(gender) {
    const articles = new Set(
      WordClass.stripNounPrefix(gender)
        .split("-")
        .filter((token) => token === "en" || token === "ei" || token === "et"),
    );
    return ["en", "ei", "et"]
      .filter((article) => articles.has(article))
      .join("-");
  }

  function createRecordKey(lemma, wordClass, gender = "") {
    const prefix = CLASS_PREFIX[wordClass];
    const normalized = normalizeLemma(String(lemma ?? "").trim());
    if (!prefix || !normalized) return "";
    if (wordClass !== "noun") return `${prefix}:${normalized}`;
    const nounGender = canonicalNounGender(gender);
    return nounGender ? `${prefix}:${normalized}:${nounGender}` : "";
  }

  function parseRecordKey(key) {
    const wordClass = PREFIX_CLASS[key?.charAt(0)];
    const body = String(key || "").slice(2);
    if (!wordClass || !body) return null;
    if (wordClass !== "noun") return { lemma: body, wordClass, gender: "" };
    const genderSeparator = body.lastIndexOf(":");
    if (genderSeparator < 0) {
      return { lemma: body, wordClass, gender: "" };
    }
    return {
      lemma: body.slice(0, genderSeparator),
      wordClass,
      gender: body.slice(genderSeparator + 1),
    };
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

  function getSourceMetadata(key) {
    dictionaryClassOverrideKeys ||= new Set(
      snapshot?.dictionaryClassOverrides || [],
    );
    dictionaryOnlyKeys ||= new Set(snapshot?.dictionaryOnly || []);
    const isDictionaryClassOverride =
      dictionaryClassOverrideKeys.has(key);
    const derivedFromKey = snapshot?.derivedFrom?.[key] || "";
    const isDictionaryOnly = dictionaryOnlyKeys.has(key);

    if (isDictionaryClassOverride) {
      return {
        isAuthoritative: false,
        source: "dictionary",
        sourceType: "dictionary-override",
      };
    }
    if (derivedFromKey) {
      const sourceRecord = parseRecordKey(derivedFromKey);
      return {
        derivedFrom: sourceRecord?.lemma || "",
        isAuthoritative: false,
        source: "Norsk Ordbank-derived",
        sourceType: "ordbank-derived",
      };
    }
    if (isDictionaryOnly) {
      return {
        isAuthoritative: false,
        source: "dictionary",
        sourceType: "dictionary-only",
      };
    }
    return {
      isAuthoritative: true,
      source: "Norsk Ordbank",
      sourceType: "ordbank",
    };
  }

  function createParadigmFromKey(key) {
    if (!snapshot?.forms || !key) return null;
    const encodedRecord = snapshot.forms[key];
    if (!encodedRecord) return null;
    let record = decodeRecord(encodedRecord);
    if (!record) return null;

    const parsedKey = parseRecordKey(key);
    if (!parsedKey) return null;
    const { lemma, wordClass, gender } = parsedKey;
    const sourceMetadata = getSourceMetadata(key);
    if (sourceMetadata.sourceType === "dictionary-only") {
      record = fillMissingRecord(
        record,
        createEstimatedDictionaryRecord(lemma, wordClass, gender),
      );
    }

    let slots;
    if (wordClass === "noun") {
      slots = [[lemma], ...record.slice(0, 3)];
    } else if (wordClass === "adjective") {
      slots = record.slice(0, 8);
    } else {
      // Version 6 keeps seven hidden official passive/participial slots after
      // the five learner-facing fields. Empty arrays preserve stable slot
      // numbers for verbs whose paradigm does not define a particular form.
      slots = Array.from({ length: 12 }, (_, index) => record[index] || []);
    }

    return {
      key,
      gender,
      lemma,
      wordClass,
      slots: slots.map((values) => unique(values.map(normalizeLemma))),
      ...sourceMetadata,
    };
  }

  function getParadigmForLemma(lemma, wordClass, gender = "") {
    if (wordClass !== "noun" || gender) {
      return createParadigmFromKey(createRecordKey(lemma, wordClass, gender));
    }

    // Callers with a dictionary entry always pass its gender. Retain a safe
    // gender-agnostic API for general reverse lookup by combining the distinct
    // noun senses without using that combined view in a learner-facing table.
    const paradigms = WordClass.NOUN_GENDER_FORMS.map((nounGender) =>
      createParadigmFromKey(createRecordKey(lemma, wordClass, nounGender)),
    ).filter(Boolean);
    const genderlessParadigm = createParadigmFromKey(`n:${normalizeLemma(lemma)}`);
    if (genderlessParadigm) paradigms.push(genderlessParadigm);
    if (paradigms.length === 0) return null;
    if (paradigms.length === 1) return paradigms[0];

    const first = paradigms[0];
    const slotCount = Math.max(...paradigms.map((paradigm) => paradigm.slots.length));
    return {
      ...first,
      key: "",
      gender: "",
      slots: Array.from({ length: slotCount }, (_, index) =>
        unique(paradigms.flatMap((paradigm) => paradigm.slots[index] || [])),
      ),
    };
  }

  function getParadigm(entry) {
    if (!entry?.ord || !entry?.gender || !snapshot?.forms) return null;
    const lemma = extractLemma(entry);
    if (!lemma || isProperNoun(lemma)) return null;
    return getParadigmForLemma(
      lemma,
      WordClass.getWordClass(entry.gender),
      entry.gender,
    );
  }

  function flattenParadigmForms(paradigm) {
    return paradigm ? unique(paradigm.slots.flat()) : [];
  }

  function createNounPossessiveForms(form) {
    const normalizedForm = normalizeLemma(form);
    if (!normalizedForm) return [];

    // Bokmål adds possessive/genitive -s to the complete noun form. Words
    // already ending in s, x, or z take an apostrophe instead; accept both
    // common Unicode spellings while preserving exact token boundaries.
    return /[sxz]$/iu.test(normalizedForm)
      ? [`${normalizedForm}'`, `${normalizedForm}’`]
      : [`${normalizedForm}s`];
  }

  function addNounPossessiveForms(forms) {
    return unique(
      forms.flatMap((form) => [form, ...createNounPossessiveForms(form)]),
    );
  }

  function getParadigmSearchForms(paradigm) {
    const forms = flattenParadigmForms(paradigm);
    return paradigm?.wordClass === "noun"
      ? addNounPossessiveForms(forms)
      : forms;
  }

  function getMatchingSlots(entry, surface) {
    const paradigm = getParadigm(entry);
    const normalizedSurface = normalizeLemma(String(surface ?? "").trim());
    if (!paradigm || !normalizedSurface) return [];
    return paradigm.slots.flatMap((forms, index) =>
      forms.includes(normalizedSurface) ? [index] : [],
    );
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

  function createEstimatedNounRecord(lemma, gender) {
    const articles = new Set(
      WordClass.stripNounPrefix(gender).split("-").filter(Boolean),
    );
    const endsInE = lemma.endsWith("e");
    const endsInEr = lemma.endsWith("er");
    const stem = endsInE ? lemma.slice(0, -1) : lemma;
    const definiteSingular = [];
    if (articles.has("ei")) {
      definiteSingular.push(`${stem}a`, `${stem}en`);
    }
    if (articles.has("en")) definiteSingular.push(`${stem}en`);
    if (articles.has("et")) definiteSingular.push(`${stem}et`);

    let indefinitePlural;
    let definitePlural;
    if (endsInEr) {
      indefinitePlural = [`${lemma}e`];
      definitePlural = [`${lemma}ne`];
    } else if (articles.size === 1 && articles.has("et") && !endsInE) {
      // Neuter nouns commonly allow a zero plural. Keep the productive -er
      // alternative too because loanwords and polysyllables often require it.
      indefinitePlural = [lemma, `${lemma}er`];
      definitePlural = [`${lemma}ene`];
    } else {
      indefinitePlural = [`${stem}er`];
      definitePlural = [`${stem}ene`];
    }

    return [
      unique(definiteSingular),
      unique(indefinitePlural),
      unique(definitePlural),
    ];
  }

  function createEstimatedAdjectiveRecord(lemma) {
    const invariantEnding = /(?:e|ig|lig|sk)$/iu.test(lemma);
    const declinedPositive = lemma.endsWith("e")
      ? lemma
      : lemma.endsWith("m")
        ? `${lemma}me`
        : /e[ln]$/iu.test(lemma)
          ? `${lemma.slice(0, -2)}${lemma.slice(-1)}e`
          : `${lemma}e`;
    return [
      [lemma],
      [lemma],
      [invariantEnding ? lemma : `${lemma}t`],
      [declinedPositive],
      [declinedPositive],
      [`mer ${lemma}`],
      [`mest ${lemma}`],
      [`mest ${lemma}`],
    ];
  }

  function createEstimatedVerbRecord(lemma) {
    const stem = lemma.endsWith("e") ? lemma.slice(0, -1) : lemma;
    const pastParticiple = `${stem}et`;
    return [
      [lemma],
      [`${lemma}r`],
      [pastParticiple],
      [pastParticiple],
      [stem],
      ...Array.from({ length: 7 }, () => []),
    ];
  }

  function createEstimatedDictionaryRecord(lemma, wordClass, gender = "") {
    if (wordClass === "noun") return createEstimatedNounRecord(lemma, gender);
    if (wordClass === "adjective") return createEstimatedAdjectiveRecord(lemma);
    if (wordClass === "verb") return createEstimatedVerbRecord(lemma);
    return null;
  }

  function getEstimatedParadigmForLemma(lemma, wordClass, gender = "") {
    const normalizedLemma = normalizeLemma(String(lemma ?? "").trim());
    const record = createEstimatedDictionaryRecord(
      normalizedLemma,
      wordClass,
      gender,
    );
    if (!normalizedLemma || !record) return null;
    const slots =
      wordClass === "noun"
        ? [[normalizedLemma], ...record.slice(0, 3)]
        : wordClass === "adjective"
          ? record.slice(0, 8)
          : Array.from({ length: 12 }, (_, index) => record[index] || []);
    return {
      gender: wordClass === "noun" ? canonicalNounGender(gender) : "",
      isAuthoritative: false,
      key: "",
      lemma: normalizedLemma,
      slots: slots.map((values) => unique(values.map(normalizeLemma))),
      source: "dictionary",
      sourceType: "dictionary-only",
      wordClass,
    };
  }

  function fillMissingRecord(record, estimate) {
    if (!estimate) return record;
    return Array.from(
      { length: Math.max(record.length, estimate.length) },
      (_, index) =>
        record[index]?.length ? record[index] : estimate[index] || [],
    );
  }

  function createFormsForLemma(entry, lemma) {
    const wordClass = WordClass.getWordClass(entry.gender);
    const prefix = CLASS_PREFIX[wordClass];
    if (!prefix) return null;

    const key = createRecordKey(lemma, wordClass, entry.gender);
    const encodedRecord = snapshot?.forms?.[key];
    const sourceMetadata = encodedRecord
      ? getSourceMetadata(key)
      : {
          isAuthoritative: false,
          source: "dictionary",
          sourceType: "dictionary-only",
        };
    let record = encodedRecord
      ? decodeRecord(encodedRecord)
      : createEstimatedDictionaryRecord(lemma, wordClass, entry.gender);
    if (!record) return null;
    if (sourceMetadata.sourceType === "dictionary-only") {
      record = fillMissingRecord(
        record,
        createEstimatedDictionaryRecord(lemma, wordClass, entry.gender),
      );
    }

    let result;
    if (wordClass === "noun") result = createNounForms(entry, lemma, record);
    else if (wordClass === "adjective") result = createAdjectiveForms(record);
    else result = createVerbForms(record);

    return {
      ...result,
      ...sourceMetadata,
      lemma,
    };
  }

  function mergeFormValues(values) {
    const merged = unique(
      values.flatMap((value) =>
        value === "–" ? [] : Array.isArray(value) ? value : [value],
      ),
    );
    return displayValue(merged);
  }

  function mergeVariantSourceMetadata(variantForms) {
    const sourceTypes = unique(
      variantForms.map((forms) => forms.sourceType).filter(Boolean),
    );
    const variantSources = variantForms.map((forms) => ({
      derivedFrom: forms.derivedFrom || "",
      isAuthoritative: Boolean(forms.isAuthoritative),
      lemma: forms.lemma,
      sourceType: forms.sourceType || "dictionary-only",
    }));
    if (sourceTypes.length === 1) {
      const first = variantForms[0];
      const derivedFrom = unique(
        variantForms.map((forms) => forms.derivedFrom).filter(Boolean),
      );
      return {
        isAuthoritative: variantForms.every((forms) => forms.isAuthoritative),
        source: first.source,
        sourceType: first.sourceType,
        variantSources,
        ...(derivedFrom.length > 0
          ? { derivedFrom: derivedFrom.join(" / ") }
          : {}),
      };
    }
    return {
      isAuthoritative: false,
      source: "mixed",
      sourceType: "variant-mixed",
      variantSources,
    };
  }

  function createForms(entry) {
    const lemmas = extractLemmas(entry);
    if (lemmas.length === 0 || lemmas.some(isProperNoun)) return null;

    const variantForms = lemmas
      .map((lemma) => createFormsForLemma(entry, lemma))
      .filter(Boolean);
    if (variantForms.length === 0) return null;
    if (variantForms.length === 1) return variantForms[0];

    const labels = unique(
      variantForms.flatMap((forms) =>
        forms.forms.map((form) => form.label),
      ),
    );
    return {
      wordClass: variantForms[0].wordClass,
      forms: labels.map((label) => ({
        label,
        value: mergeFormValues(
          variantForms.map(
            (forms) =>
              forms.forms.find((form) => form.label === label)?.value || "–",
          ),
        ),
      })),
      ...mergeVariantSourceMetadata(variantForms),
    };
  }

  function collectSentenceForms(entry) {
    const lemmas = extractLemmas(entry);
    const accepted = lemmas.map(normalizeLemma);
    const wordClass = WordClass.getWordClass(entry.gender);
    if (!snapshot?.forms) {
      const forms = unique(accepted);
      return wordClass === "noun" ? addNounPossessiveForms(forms) : forms;
    }

    const prefix = CLASS_PREFIX[wordClass];
    if (!prefix) return unique(accepted);

    for (const lemma of lemmas) {
      const paradigm = getParadigmForLemma(lemma, wordClass, entry.gender);
      accepted.push(...flattenParadigmForms(paradigm));
    }

    const forms = unique(accepted);
    return wordClass === "noun" ? addNounPossessiveForms(forms) : forms;
  }

  function getNorwegianKeyboardVariants(value) {
    let variants = [""];
    for (const character of normalizeLemma(value)) {
      const replacements =
        character === "æ"
          ? ["ae"]
          : character === "ø"
            ? ["o", "oe"]
            : character === "å"
              ? ["a", "aa"]
              : [character];
      variants = variants.flatMap((variant) =>
        replacements.map((replacement) => variant + replacement),
      );
    }
    return unique(variants.filter((variant) => variant !== value));
  }

  function addReverseMapping(index, surface, key) {
    const normalizedSurface = normalizeLemma(surface);
    if (!normalizedSurface) return;
    const existing = index.get(normalizedSurface);
    if (!existing) {
      index.set(normalizedSurface, key);
    } else if (typeof existing === "string") {
      if (existing !== key) index.set(normalizedSurface, [existing, key]);
    } else if (!existing.includes(key)) {
      existing.push(key);
    }
  }

  function readReverseMappings(index, surface) {
    const value = index?.get(normalizeLemma(surface));
    if (!value) return [];
    return typeof value === "string" ? [value] : value;
  }

  function readNounPossessiveMappings(index, surface) {
    const normalizedSurface = normalizeLemma(surface);
    const baseSurface = /['’]$/u.test(normalizedSurface)
      ? normalizedSurface.slice(0, -1)
      : normalizedSurface.endsWith("s")
        ? normalizedSurface.slice(0, -1)
        : "";
    if (!baseSurface) return [];
    return readReverseMappings(index, baseSurface).filter(
      (key) => parseRecordKey(key)?.wordClass === "noun",
    );
  }

  async function buildReverseIndexes() {
    if (reverseIndex && keyboardReverseIndex) return;
    const exact = new Map();
    const keyboard = new Map();
    let processed = 0;

    for (const key of Object.keys(snapshot?.forms || {})) {
      const paradigm = createParadigmFromKey(key);
      for (const form of flattenParadigmForms(paradigm)) {
        addReverseMapping(exact, form, key);
        for (const variant of getNorwegianKeyboardVariants(form)) {
          addReverseMapping(keyboard, variant, key);
        }
      }

      // Yield between compact batches in a real browser. This keeps the
      // background index warm-up from creating one noticeable main-thread
      // pause on slower phones while preserving a synchronous test fallback.
      processed++;
      if (processed % 150 === 0 && typeof setTimeout === "function") {
        await new Promise((resolve) => {
          if (typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(resolve, { timeout: 1000 });
          } else {
            setTimeout(resolve, 0);
          }
        });
      }
    }

    reverseIndex = exact;
    keyboardReverseIndex = keyboard;
  }

  async function ensureReverseIndexes() {
    if (reverseIndex && keyboardReverseIndex) return true;
    if (reverseIndexPromise) return reverseIndexPromise;
    reverseIndexPromise = loadSnapshot().then((loaded) => {
      if (!loaded) return false;
      return buildReverseIndexes().then(() => true);
    });
    return reverseIndexPromise;
  }

  async function findLemmas(surface, wordClass = "") {
    if (!(await ensureReverseIndexes())) {
      return { lemmas: [], matchType: "none" };
    }

    let keys = readReverseMappings(reverseIndex, surface);
    let matchType = "exact";
    if (keys.length === 0) {
      keys = readNounPossessiveMappings(reverseIndex, surface);
      matchType = keys.length ? "possessive" : "none";
    }
    if (keys.length === 0) {
      keys = readReverseMappings(keyboardReverseIndex, surface);
      matchType = keys.length ? "keyboard" : "none";
    }
    if (keys.length === 0) {
      keys = readNounPossessiveMappings(keyboardReverseIndex, surface);
      matchType = keys.length ? "keyboard" : "none";
    }

    const prefix = CLASS_PREFIX[wordClass] || "";
    const lemmas = unique(
      keys
        .filter((key) => !prefix || key.startsWith(`${prefix}:`))
        .map((key) => parseRecordKey(key)?.lemma)
        .filter(Boolean),
    ).sort((a, b) => a.localeCompare(b, "nb"));
    return { lemmas, matchType: lemmas.length ? matchType : "none" };
  }

  function getExpressionComponentParadigms(surface, wordClass = "") {
    const normalizedSurface = normalizeLemma(String(surface ?? "").trim());
    const encodedKeys = snapshot?.expressionComponentLookup?.[normalizedSurface];
    if (!encodedKeys) return [];
    const prefix = CLASS_PREFIX[wordClass] || "";
    return unique(encodedKeys.split("/"))
      .filter((key) => !prefix || key.startsWith(`${prefix}:`))
      .map(createParadigmFromKey)
      .filter(Boolean);
  }

  async function expandSearchTerm(surface) {
    const normalizedSurface = normalizeLemma(String(surface ?? "").trim());
    if (!normalizedSurface || !(await ensureReverseIndexes())) {
      return normalizedSurface ? [normalizedSurface] : [];
    }

    let keys = readReverseMappings(reverseIndex, normalizedSurface);
    let preserveSurface = keys.length > 0;
    if (keys.length === 0) {
      keys = readNounPossessiveMappings(reverseIndex, normalizedSurface);
      preserveSurface = keys.length > 0;
    }
    if (keys.length === 0) {
      keys = readReverseMappings(keyboardReverseIndex, normalizedSurface);
    }
    if (keys.length === 0) {
      keys = readNounPossessiveMappings(
        keyboardReverseIndex,
        normalizedSurface,
      );
    }
    if (keys.length === 0) return [normalizedSurface];

    const expanded = preserveSurface ? [normalizedSurface] : [];
    for (const key of keys) {
      expanded.push(...getParadigmSearchForms(createParadigmFromKey(key)));
    }
    return unique(expanded);
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
      definisjon: entry.definisjon,
      eksempel: entry.eksempel,
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
    const wordClass = WordClass.getWordClass(entry.gender);
    if (wordClass === "expression") {
      return {
        wordClass,
        pending: true,
        requestId: rememberPendingEntry(entry),
        forms: [],
      };
    }
    if (!lemma || isProperNoun(lemma)) return null;
    if (!CLASS_PREFIX[wordClass]) return null;
    if (wordClass === "noun" && extractNounArticles(entry).length === 0) {
      return null;
    }

    if (snapshot) return createForms(entry);
    if (loadFailed) return createForms(entry);

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

    await loadSnapshot();
    if (WordClass.getWordClass(entry.gender) === "expression") {
      return window.ExpressionPatterns?.getForms(entry) || null;
    }
    return createForms(entry);
  }

  async function getSentenceForms(entry) {
    if (!entry?.ord) return [];

    const wordClass = WordClass.getWordClass(entry.gender);
    if (CLASS_PREFIX[wordClass] && !snapshot && !loadFailed) {
      await loadSnapshot();
    }
    return collectSentenceForms(entry);
  }

  async function getSupplementalSentenceForms(entry, dictionaryEntries = []) {
    const acceptedForms = await getSentenceForms(entry);
    if (acceptedForms.length === 0) return [];

    const selectedLemmas = new Set(extractLemmas(entry).map(normalizeLemma));
    const homographs = (dictionaryEntries || []).filter((competitor) =>
      extractLemmas(competitor)
        .map(normalizeLemma)
        .some((lemma) => selectedLemmas.has(lemma)),
    );
    const selectedWordClass = WordClass.getWordClass(entry.gender);

    // Cross-word-class homographs must retain their own literal search form.
    // Removing "ved" from the preposition because a noun "ved" also exists
    // leaves the preposition with no searchable or highlightable form at all.
    // The caller separately excludes competing entries' own examples.
    if (selectedWordClass !== "noun") return acceptedForms;

    const selectedNounGender = WordClass.stripNounPrefix(entry.gender);
    const nounHomographs = homographs.filter(
      (candidate) => WordClass.getWordClass(candidate.gender) === "noun",
    );
    const nounGenders = new Set(
      nounHomographs.map((candidate) =>
        WordClass.stripNounPrefix(candidate.gender),
      ),
    );

    // Same-gender noun senses have the same morphological evidence, so an
    // arbitrary primary sense cannot safely own their shared forms. Allocation
    // is useful only when distinct genders produce distinct paradigms.
    if (nounGenders.size < 2) return acceptedForms;

    const cefrRank = (candidate) => {
      const rank = ["A1", "A2", "B1", "B2", "C"].indexOf(
        String(candidate?.CEFR || "").toUpperCase(),
      );
      return rank < 0 ? Number.MAX_SAFE_INTEGER : rank;
    };
    const primarySense = nounHomographs.reduce(
      (primary, candidate) =>
        !primary || cefrRank(candidate) < cefrRank(primary)
          ? candidate
          : primary,
      null,
    );

    const primaryNounGender = WordClass.stripNounPrefix(primarySense?.gender);

    // Shared morphology belongs to the earliest-taught noun-gender paradigm.
    // Every sense with that gender retains it; later, genuinely different
    // paradigms use only their exclusive forms.
    if (primaryNounGender === selectedNounGender) return acceptedForms;

    const formsUsedByCompetingSenses = new Set();

    for (const competitor of nounHomographs) {
      if (
        !competitor?.ord ||
        WordClass.stripNounPrefix(competitor.gender) === selectedNounGender
      ) {
        continue;
      }
      for (const form of collectSentenceForms(competitor)) {
        formsUsedByCompetingSenses.add(form);
      }
    }

    // A shared spelling cannot identify a dictionary sense by morphology.
    // Keep it in the Word Forms table, but do not use it to fetch supplemental
    // examples for one homograph. The selected entry's own example is added
    // separately and remains first.
    return acceptedForms.filter(
      (form) => !formsUsedByCompetingSenses.has(normalizeLemma(form)),
    );
  }

  window.Inflections = Object.freeze({
    expandSearchTerm,
    findLemmas,
    getEstimatedParadigmForLemma,
    getExpressionComponentParadigms,
    getForms,
    getMatchingSlots,
    getParadigm,
    getParadigmForLemma,
    getSentenceForms,
    getSupplementalSentenceForms,
    preload: loadSnapshot,
    prepareSearchIndex: ensureReverseIndexes,
    resolvePending,
    isReady: () => Boolean(snapshot),
  });
})();
