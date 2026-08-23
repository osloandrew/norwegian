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

  function inferWordClass(article) {
    const tags = getParadigmTags(article);
    const upperTags = tags.map((tag) => String(tag).toUpperCase());
    const classTag = upperTags.find((tag) => WORD_CLASS_LABELS[tag]);

    if (classTag === "NOUN") {
      const articles = [];
      if (upperTags.includes("MASC")) articles.push("en");
      if (upperTags.includes("FEM")) articles.push("ei");
      if (upperTags.includes("NEUTER")) articles.push("et");
      return articles.length ? articles.join("-") : "noun";
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

  function joinExamples(examples) {
    return examples
      .map((example) =>
        /[.!?]$/.test(example) ? example : `${example}.`,
      )
      .join(" ");
  }

  function articleToEntry(article, concepts, matchType) {
    const headword = String(
      article?.lemmas?.find((lemma) => lemma.is_standard !== false)?.lemma ||
        article?.lemmas?.[0]?.lemma ||
        "",
    ).trim();
    const articleId = Number(article?.article_id);
    if (!headword || !Number.isFinite(articleId)) return null;

    const definitionContent = collectDefinitionContent(
      article?.body?.definitions,
      concepts,
    );
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

  function entryIdentity(entry) {
    const headword = normalize(String(entry?.ord || "").split(",")[0]);
    return `${headword}|${getCanonicalWordClass(entry?.gender)}`;
  }

  // Avoid duplicating a local headword/same-word-class entry. When the query
  // itself is only an inflected form in Ordbøkene, put the official lemma
  // first; otherwise local exact entries retain priority and any additional
  // official inflection matches follow them.
  function mergeEntries(localEntries, lookupResult) {
    const local = Array.isArray(localEntries) ? localEntries : [];
    const localIdentities = new Set(local.map(entryIdentity));
    const external = (lookupResult?.entries || []).filter(
      (entry) => !localIdentities.has(entryIdentity(entry)),
    );
    const exact = external.filter(
      (entry) => entry._ordbokene?.matchType === "exact",
    );
    const inflected = external.filter(
      (entry) => entry._ordbokene?.matchType !== "exact",
    );

    return lookupResult?.hasExactArticles
      ? [...exact, ...local, ...inflected]
      : [...inflected, ...local];
  }

  window.Ordbokene = Object.freeze({
    articleToEntry,
    getEntry,
    lookup,
    mergeEntries,
    renderStructuredText,
  });
})();
