// Official Bokmålsordboka fallback for words that are not represented as
// headwords in the local Norwegian-English CSV. The public API explicitly
// distinguishes citation-form matches from inflected-form matches, which is
// important here: a surface form can occur in the CSV even though its actual
// lemma only exists in Ordbøkene.
(function () {
  "use strict";

  const API_BASE = "https://ord.uib.no";
  const PUBLIC_BASE = "https://ordbokene.no";
  const LOOKUP_TIMEOUT_MS = 3500;
  const MAX_ARTICLES = 10;

  const articleEntryCache = new Map();
  const lookupCache = new Map();
  let conceptsPromise = null;

  const WORD_CLASS_LABELS = Object.freeze({
    ADJ: "adjective",
    ADV: "adverb",
    CONJ: "conjunction",
    DET: "determiner",
    INF: "infinitive marker",
    INTJ: "interjection",
    NOUN: "noun",
    NUM: "numeral",
    PREP: "preposition",
    PRON: "pronoun",
    SUBJ: "conjunction",
    VERB: "verb",
  });

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFC")
      .toLocaleLowerCase("nb-NO")
      .replace(/\s+/g, " ")
      .trim();
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  async function fetchJSON(url, signal) {
    const response = await fetch(url, {
      cache: "force-cache",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new Error(`Ordbøkene request failed (${response.status})`);
    }
    return response.json();
  }

  function getArticleIds(payload) {
    return Array.isArray(payload?.articles?.bm) ? payload.articles.bm : [];
  }

  function getConcepts(signal) {
    if (!conceptsPromise) {
      conceptsPromise = fetchJSON(`${API_BASE}/bm/concepts.json`, signal)
        .then((payload) => payload?.concepts || {})
        .catch((error) => {
          // Definitions remain readable without the expansion table; only
          // compact labels such as "ty." remain abbreviated.
          console.warn("Ordbøkene labels could not be expanded.", error);
          conceptsPromise = null;
          return {};
        });
    }
    return conceptsPromise;
  }

  function renderInlineItem(item, concepts) {
    if (!item || typeof item !== "object") return "";

    if (item.type_ === "entity") {
      return concepts[item.id]?.expansion || String(item.id || "");
    }

    if (item.type_ === "article_ref") {
      return String(item.lemmas?.[0]?.lemma || "");
    }

    if (typeof item.text === "string") return item.text;
    if (typeof item.content === "string") {
      return renderTemplate(item.content, item.items, concepts);
    }
    if (item.quote) return renderStructuredText(item.quote, concepts);
    if (item.lemma) return String(item.lemma);

    return "";
  }

  function renderTemplate(content, items = [], concepts = {}) {
    let itemIndex = 0;
    return String(content ?? "")
      .replace(/\$/g, () => renderInlineItem(items[itemIndex++], concepts))
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function renderStructuredText(node, concepts = {}) {
    if (!node) return "";
    if (typeof node === "string") return node.trim();
    if (typeof node.text === "string") return node.text.trim();
    if (typeof node.content === "string") {
      return renderTemplate(node.content, node.items, concepts);
    }
    if (node.quote) return renderStructuredText(node.quote, concepts);
    if (node.type_ === "entity") return renderInlineItem(node, concepts);
    return "";
  }

  function collectDefinitionContent(definitions, concepts) {
    const explanations = [];
    const examples = [];

    function visit(node) {
      if (!node || typeof node !== "object") return;

      if (node.type_ === "example") {
        const quote = renderStructuredText(node.quote || node, concepts);
        const explanation = renderStructuredText(node.explanation, concepts);
        const example = [quote, explanation ? `(${explanation})` : ""]
          .filter(Boolean)
          .join(" ");
        if (example) examples.push(example);
        return;
      }

      if (node.type_ === "explanation") {
        const explanation = renderStructuredText(node, concepts);
        if (explanation) explanations.push(explanation);
      } else if (
        node.type_ === "entity" ||
        node.type_ === "usage" ||
        node.type_ === "grammar"
      ) {
        const label = renderStructuredText(node, concepts);
        if (label) explanations.push(label);
      }

      for (const child of node.elements || []) visit(child);
      for (const child of node.definitions || []) visit(child);
      for (const child of node.items || []) {
        // Inline placeholders are already consumed by renderTemplate.
        if (node.content?.includes("$")) break;
        visit(child);
      }
    }

    for (const definition of definitions || []) visit(definition);
    return {
      definitions: unique(explanations),
      examples: unique(examples),
    };
  }

  function getParadigmTags(article) {
    return (article?.lemmas || []).flatMap((lemma) =>
      (lemma.paradigm_info || []).flatMap((paradigm) => paradigm.tags || []),
    );
  }

  function getPreferredNounArticle(upperTags) {
    // Bokmål permits many feminine nouns to use masculine agreement too,
    // but the learner-facing dictionary consistently presents a feminine
    // noun with "ei". Prefer the explicitly feminine paradigm whenever the
    // official article supplies one instead of displaying "en-ei".
    if (upperTags.includes("FEM")) return "ei";
    if (upperTags.includes("NEUTER")) return "et";
    if (upperTags.includes("MASC")) return "en";
    return "";
  }

  function inferWordClass(article) {
    const tags = getParadigmTags(article);
    const upperTags = tags.map((tag) => String(tag).toUpperCase());
    const classTag = upperTags.find((tag) => WORD_CLASS_LABELS[tag]);

    if (classTag === "NOUN") {
      return getPreferredNounArticle(upperTags) || "noun";
    }

    if (classTag) return WORD_CLASS_LABELS[classTag];

    const inflectionClass = String(
      article?.lemmas?.[0]?.inflection_class || "",
    ).toLowerCase();
    if (/^v\d/.test(inflectionClass)) return "verb";
    if (/^a\d/.test(inflectionClass)) return "adjective";
    if (/^[mfn]\d/.test(inflectionClass)) return "noun";
    return "";
  }

  function getArticleParadigms(article) {
    return (article?.lemmas || []).flatMap((lemma) =>
      (lemma.paradigm_info || [])
        .filter(
          (paradigm) =>
            !paradigm.standardisation ||
            paradigm.standardisation === "STANDARD",
        )
        .map((paradigm) => ({
          ...paradigm,
          lemma: String(lemma.lemma || "").trim(),
          upperTags: (paradigm.tags || []).map((tag) =>
            String(tag).toUpperCase(),
          ),
        })),
    );
  }

  function getFormValues(paradigms, requiredTags, excludedTags = []) {
    return unique(
      paradigms.flatMap((paradigm) =>
        (paradigm.inflection || [])
          .filter((inflection) => {
            const tags = (inflection.tags || []).map((tag) =>
              String(tag).toUpperCase(),
            );
            return (
              requiredTags.every((tag) => tags.includes(tag)) &&
              excludedTags.every((tag) => !tags.includes(tag))
            );
          })
          .map((inflection) => String(inflection.word_form || "").trim()),
      ),
    );
  }

  function createOfficialInflections(article, gender) {
    const wordClass = getCanonicalWordClass(gender);
    let paradigms = getArticleParadigms(article);
    let forms = [];

    if (wordClass === "noun") {
      const nounArticle = String(gender || "");
      const preferredTag =
        nounArticle === "ei"
          ? "FEM"
          : nounArticle === "et"
            ? "NEUTER"
            : nounArticle === "en"
              ? "MASC"
              : "";
      // Keep both the feminine and masculine paradigms in the table, just as
      // local `ei` nouns do. The preferred tag controls display order only;
      // it does not discard other officially permitted agreement forms.
      if (preferredTag) {
        paradigms = [...paradigms].sort(
          (left, right) =>
            Number(right.upperTags.includes(preferredTag)) -
            Number(left.upperTags.includes(preferredTag)),
        );
      }
      const nounArticles =
        nounArticle === "ei" ? ["ei", "en"] : nounArticle ? [nounArticle] : [];
      const indefiniteSingular = getFormValues(paradigms, ["SING", "IND"])
        .flatMap((form) =>
          nounArticles.length > 0
            ? nounArticles.map((article) => `${article} ${form}`)
            : [form],
        );
      const slots = [
        ["Indefinite singular", indefiniteSingular],
        ["Definite singular", getFormValues(paradigms, ["SING", "DEF"])],
        ["Indefinite plural", getFormValues(paradigms, ["PLUR", "IND"])],
        ["Definite plural", getFormValues(paradigms, ["PLUR", "DEF"])],
      ];
      forms = slots
        .filter(([, values]) => values.length > 0)
        .map(([label, values]) => ({
          label,
          value: values.length === 1 ? values[0] : values,
        }));
    } else if (wordClass === "adjective") {
      const positiveCommon = getFormValues(
        paradigms,
        ["POS", "SING", "IND"],
        ["NEUTER"],
      );
      const slots = [
        ["Masculine", positiveCommon],
        ["Feminine", positiveCommon],
        ["Neuter", getFormValues(paradigms, ["POS", "NEUTER", "SING"])],
        ["Definite singular", getFormValues(paradigms, ["POS", "DEF", "SING"])],
        ["Plural", getFormValues(paradigms, ["POS", "PLUR"])],
        ["Comparative", getFormValues(paradigms, ["CMP"])],
        ["Superlative", getFormValues(paradigms, ["SUP", "IND"])],
        ["Definite superlative", getFormValues(paradigms, ["SUP", "DEF"])],
      ];
      forms = slots
        .filter(([, values]) => values.length > 0)
        .map(([label, values]) => ({
          label,
          value: values.length === 1 ? values[0] : values,
        }));
    } else if (wordClass === "verb") {
      const slots = [
        ["Infinitive", getFormValues(paradigms, ["INF"])],
        ["Present", getFormValues(paradigms, ["PRES"])],
        ["Past", getFormValues(paradigms, ["PRET"])],
        ["Present perfect", getFormValues(paradigms, ["PERF", "PART"])],
        ["Imperative", getFormValues(paradigms, ["IMP"])],
      ];
      forms = slots
        .filter(([, values]) => values.length > 0)
        .map(([label, values]) => ({
          label,
          value: values.length === 1 ? values[0] : values,
        }));
    }

    return forms.length > 0
      ? { wordClass, forms, sourceType: "ordbokene" }
      : null;
  }

  function normalizeExampleSentence(example) {
    const trimmed = String(example || "").replace(/\s+/g, " ").trim();
    if (!trimmed) return "";

    const capitalized = trimmed.replace(
      /^(\s*[«“”„'"(\[]*)(\p{L})/u,
      (_match, prefix, firstLetter) =>
        `${prefix}${firstLetter.toLocaleUpperCase("nb-NO")}`,
    );
    return /[.!?…]$/.test(capitalized) ? capitalized : `${capitalized}.`;
  }

  function joinExamples(examples) {
    return examples
      .map(normalizeExampleSentence)
      .filter(Boolean)
      .join(" ");
  }

  function articleToEntry(article, concepts, matchType) {
    const standardHeadwords = unique(
      (article?.lemmas || [])
        .filter((lemma) => lemma.is_standard !== false)
        .map((lemma) => String(lemma.lemma || "").trim()),
    );
    const headwords = standardHeadwords.length
      ? standardHeadwords
      : unique(
          (article?.lemmas || []).map((lemma) =>
            String(lemma.lemma || "").trim(),
          ),
        );
    const headword = headwords.join(", ");
    const articleId = Number(article?.article_id);
    if (!headword || !Number.isFinite(articleId)) return null;

    const definitionContent = collectDefinitionContent(
      article?.body?.definitions,
      concepts,
    );
    // Some Ordbøkene articles are only structural placeholders for a
    // related entry (for example "befinne" points readers to "befinne seg").
    // Pronunciation, etymology, examples, and inflections are useful metadata,
    // but none of them tells a learner what the headword means. Do not turn
    // those definition-less articles into fallback definition cards.
    if (definitionContent.definitions.length === 0) return null;

    const etymology = unique(
      (article?.body?.etymology || [])
        .map((item) => renderStructuredText(item, concepts))
        .filter(Boolean),
    ).join("; ");
    const pronunciation = unique(
      (article?.body?.pronunciation || [])
        .map((item) => renderStructuredText(item, concepts))
        .filter(Boolean),
    ).join("; ");
    const gender = inferWordClass(article);
    const inflections = createOfficialInflections(article, gender);

    return {
      CEFR: "",
      definisjon: definitionContent.definitions.join("; "),
      eksempel: joinExamples(definitionContent.examples),
      engelsk: "",
      etymologi: etymology,
      gender,
      ord: headword,
      sentenceAudio: "",
      sentenceTranslation: "",
      uttale: pronunciation,
      wordAudio: "",
      _ordbokene: {
        articleId,
        dictionary: "Bokmålsordboka",
        hasBlankTranslations: definitionContent.examples.length > 0,
        inflections,
        matchType,
        url: `${PUBLIC_BASE}/bm/${articleId}`,
      },
    };
  }

  function getEntry(articleId) {
    return articleEntryCache.get(Number(articleId)) || null;
  }

  async function lookup(query, { selectedPOS = "" } = {}) {
    const normalizedQuery = normalize(query);
    const normalizedPOS = normalize(selectedPOS);
    if (
      !normalizedQuery ||
      normalizedQuery.length > 80 ||
      !/[\p{L}\p{N}]/u.test(normalizedQuery)
    ) {
      return { entries: [], hasExactArticles: false };
    }

    const cacheKey = `${normalizedQuery}|${normalizedPOS}`;
    if (lookupCache.has(cacheKey)) return lookupCache.get(cacheKey);

    const lookupPromise = (async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

      try {
        const buildArticlesURL = (scope) => {
          const url = new URL(`${API_BASE}/api/articles`);
          url.searchParams.set("w", normalizedQuery);
          url.searchParams.set("dict", "bm");
          url.searchParams.set("scope", scope);
          return url.href;
        };

        const [exactResult, inflectedResult] = await Promise.allSettled([
          fetchJSON(buildArticlesURL("e"), controller.signal),
          fetchJSON(buildArticlesURL("i"), controller.signal),
        ]);
        const exactIds =
          exactResult.status === "fulfilled"
            ? getArticleIds(exactResult.value)
            : [];
        const inflectedIds =
          inflectedResult.status === "fulfilled"
            ? getArticleIds(inflectedResult.value)
            : [];
        const allIds = unique([...exactIds, ...inflectedIds]).slice(
          0,
          MAX_ARTICLES,
        );
        if (allIds.length === 0) {
          return { entries: [], hasExactArticles: exactIds.length > 0 };
        }

        const [concepts, articleResults] = await Promise.all([
          getConcepts(controller.signal),
          Promise.allSettled(
            allIds.map((articleId) =>
              fetchJSON(
                `${API_BASE}/bm/article/${Number(articleId)}.json`,
                controller.signal,
              ),
            ),
          ),
        ]);
        const exactIdSet = new Set(exactIds.map(Number));
        const entries = articleResults
          .map((result, index) => {
            if (result.status !== "fulfilled") return null;
            const articleId = Number(allIds[index]);
            const entry = articleToEntry(
              result.value,
              concepts,
              exactIdSet.has(articleId) ? "exact" : "inflected",
            );
            if (entry) articleEntryCache.set(articleId, entry);
            return entry;
          })
          .filter(Boolean)
          .filter(
            (entry) =>
              !normalizedPOS ||
              normalize(getCanonicalWordClass(entry.gender)) === normalizedPOS,
          );

        return { entries, hasExactArticles: exactIds.length > 0 };
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.warn("Ordbøkene fallback lookup failed.", error);
        }
        return { entries: [], hasExactArticles: false };
      } finally {
        clearTimeout(timeoutId);
      }
    })();

    lookupCache.set(cacheKey, lookupPromise);
    return lookupPromise;
  }

  function getCanonicalWordClass(gender) {
    const value = normalize(gender).replace(/^noun\s*-\s*/, "");
    return /^(?:en|ei|et)(?:-(?:en|ei|et))*$/.test(value) || value === "noun"
      ? "noun"
      : value;
  }

  function getEntryHeadwords(entry) {
    return unique(String(entry?.ord || "").split(",").map(normalize));
  }

  function entriesRepresentSameHeadword(left, right) {
    const rightHeadwords = new Set(getEntryHeadwords(right));
    const sharedHeadwords = getEntryHeadwords(left).filter((headword) =>
      rightHeadwords.has(headword),
    );
    if (sharedHeadwords.length === 0) return false;

    const leftWordClass = getCanonicalWordClass(left?.gender);
    const rightWordClass = getCanonicalWordClass(right?.gender);
    if (leftWordClass === rightWordClass) return true;

    // Bokmålsordboka classifies some quantity words as determiners even
    // though the learner CSV deliberately presents them as numerals (for
    // example "tjuefem" and "en, én"). When their headwords overlap, the
    // authored CSV entry is authoritative; otherwise the fallback produces
    // a second card for the same word under a conflicting class label.
    // `left` is the Ordbøkene candidate and `right` is the CSV entry in
    // mergeEntries below, so keep this exception deliberately one-way.
    if (leftWordClass === "determiner" && rightWordClass === "numeral") {
      return true;
    }

    // Some uninflected official articles do not expose a paradigm tag, so
    // their word class cannot be inferred. If that otherwise-unclassified
    // fallback shares an exact headword with a local entry, displaying both
    // produces two visibly identical cards (for example "selv om, sjøl om").
    // Prefer the richer local entry, whose class and English gloss are known.
    if (!leftWordClass || !rightWordClass) return true;

    // The CSV intentionally groups lexicalized multi-word verbs such as
    // "vise seg" under "expression", while Bokmålsordboka tags the same
    // headword as a verb. Treat that classification difference as the same
    // entry so the official fallback does not duplicate a phrase the local
    // dictionary already contains. Keep single-word cross-class homonyms
    // distinct (for example a noun and verb with the same spelling).
    return (
      (leftWordClass === "expression" || rightWordClass === "expression") &&
      sharedHeadwords.some((headword) => headword.includes(" "))
    );
  }

  // Avoid duplicating a local headword/same-word-class entry. Ordbøkene is
  // a fallback layer, so its entries -- exact or inflected -- always sort
  // after every local (CSV) entry, never ahead of or interleaved with them.
  function mergeEntries(localEntries, lookupResult) {
    const local = Array.isArray(localEntries) ? localEntries : [];
    const external = (lookupResult?.entries || []).filter(
      (entry) =>
        !local.some((localEntry) =>
          entriesRepresentSameHeadword(entry, localEntry),
        ),
    );
    const exact = external.filter(
      (entry) => entry._ordbokene?.matchType === "exact",
    );
    const inflected = external.filter(
      (entry) => entry._ordbokene?.matchType !== "exact",
    );

    return [...local, ...exact, ...inflected];
  }

  window.Ordbokene = Object.freeze({
    articleToEntry,
    getEntry,
    lookup,
    mergeEntries,
    normalizeExampleSentence,
    renderStructuredText,
  });
})();
