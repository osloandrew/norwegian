import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "ordbokene.js"), "utf8");

const sirligArticle = {
  article_id: 51717,
  lemmas: [
    {
      lemma: "sirlig",
      is_standard: true,
      inflection_class: "a2",
      paradigm_info: [{ tags: ["ADJ"] }],
    },
  ],
  body: {
    etymology: [
      {
        type_: "etymology_reference",
        content: "fra $",
        items: [{ type_: "entity", id: "ty." }],
      },
      {
        type_: "etymology_reference",
        content: "av $ $ ‘pyntelig’",
        items: [
          { type_: "article_ref", lemmas: [{ lemma: "sir" }] },
          { type_: "entity", id: "oppr" },
        ],
      },
    ],
    definitions: [
      {
        type_: "definition",
        elements: [
          {
            type_: "explanation",
            content: "som er gjort med omtanke og svært nøyaktig",
            items: [],
          },
          {
            type_: "explanation",
            content: "pertentlig, ordentlig, elegant",
            items: [],
          },
          {
            type_: "example",
            quote: {
              content: "en $ håndskrift",
              items: [{ type_: "usage", text: "sirlig" }],
            },
          },
        ],
      },
    ],
  },
};

function createContext() {
  const requests = [];
  const context = vm.createContext({
    AbortController,
    Map,
    Number,
    Object,
    Promise,
    Set,
    String,
    URL,
    clearTimeout,
    console,
    setTimeout,
    window: {},
    fetch: async (url) => {
      const parsedURL = new URL(String(url));
      requests.push(parsedURL.href);

      let payload;
      if (parsedURL.pathname === "/api/articles") {
        const query = parsedURL.searchParams.get("w");
        const scope = parsedURL.searchParams.get("scope");
        const ids =
          (query === "sirlig" && scope === "e") ||
          (query === "sirlige" && scope === "i")
            ? [51717]
            : [];
        payload = { articles: { bm: ids } };
      } else if (parsedURL.pathname === "/bm/concepts.json") {
        payload = {
          concepts: {
            "ty.": { expansion: "tysk" },
            oppr: { expansion: "opprinnelig" },
          },
        };
      } else if (parsedURL.pathname === "/bm/article/51717.json") {
        payload = sirligArticle;
      } else {
        throw new Error(`Unexpected request: ${parsedURL.href}`);
      }

      return { ok: true, json: async () => payload };
    },
  });

  vm.runInContext(source, context, { filename: "ordbokene.js" });
  return { api: context.window.Ordbokene, requests };
}

test("maps an exact Bokmålsordboka article into the local card fields", async () => {
  const { api } = createContext();
  const result = await api.lookup("sirlig");

  assert.equal(result.hasExactArticles, true);
  assert.equal(result.entries.length, 1);
  const entry = result.entries[0];
  assert.equal(entry.ord, "sirlig");
  assert.equal(entry.gender, "adjective");
  assert.equal(entry._ordbokene.matchType, "exact");
  assert.equal(entry._ordbokene.url, "https://ordbokene.no/bm/51717");
  assert.equal(
    entry.definisjon,
    "som er gjort med omtanke og svært nøyaktig; pertentlig, ordentlig, elegant",
  );
  assert.equal(entry.eksempel, "En sirlig håndskrift.");
  assert.equal(entry.etymologi, "fra tysk; av sir opprinnelig ‘pyntelig’");
});

test("omits placeholder articles with metadata but no definition content", () => {
  const { api } = createContext();
  const entry = api.articleToEntry(
    {
      article_id: 99999,
      lemmas: [
        {
          lemma: "befinne",
          inflection_class: "v1",
          paradigm_info: [{ tags: ["VERB"] }],
        },
      ],
      body: {
        pronunciation: [{ text: "befi´nne" }],
        etymology: [{ text: "fra tysk" }],
        definitions: [],
      },
    },
    {},
    "exact",
  );

  assert.equal(entry, null);
});

test("resolves an inflected form to its official headword", async () => {
  const { api } = createContext();
  const result = await api.lookup("sirlige", { selectedPOS: "adjective" });

  assert.equal(result.hasExactArticles, false);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].ord, "sirlig");
  assert.equal(result.entries[0]._ordbokene.matchType, "inflected");
});

test("puts an official inflection resolution ahead of a misleading local form", async () => {
  const { api } = createContext();
  const lookup = await api.lookup("sirlige");
  const localForm = {
    ord: "sirlige",
    gender: "adjective",
    definisjon: "local row",
  };

  const merged = api.mergeEntries([localForm], lookup);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].ord, "sirlig");
  assert.equal(merged[1], localForm);
});

test("does not duplicate a local headword of the same word class", async () => {
  const { api, requests } = createContext();
  const lookup = await api.lookup("sirlig");
  const localHeadword = {
    ord: "sirlig",
    gender: "adjective",
    definisjon: "local definition",
  };

  const merged = api.mergeEntries([localHeadword], lookup);
  assert.equal(merged.length, 1);
  assert.equal(merged[0], localHeadword);

  await api.lookup("sirlig");
  assert.equal(
    requests.filter((url) => url.includes("/api/articles")).length,
    2,
    "repeat lookups should use the in-memory lookup cache",
  );
});

test("deduplicates alternative spellings regardless of their order", () => {
  const { api } = createContext();
  const localHeadword = {
    ord: "fremtid, framtid",
    gender: "ei",
    definisjon: "local definition",
  };
  const officialHeadword = {
    ord: "framtid, fremtid",
    gender: "ei",
    definisjon: "official definition",
    _ordbokene: { matchType: "exact" },
  };

  const merged = api.mergeEntries([localHeadword], {
    entries: [officialHeadword],
    hasExactArticles: true,
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0], localHeadword);
});

test("deduplicates a local multi-word expression against an official verb", () => {
  const { api } = createContext();
  const localExpression = {
    ord: "vise seg",
    gender: "expression",
    definisjon: "local definition",
  };
  const officialVerb = {
    ord: "vise seg",
    gender: "verb",
    definisjon: "official definition",
    _ordbokene: { matchType: "exact" },
  };

  const merged = api.mergeEntries([localExpression], {
    entries: [officialVerb],
    hasExactArticles: true,
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0], localExpression);
});

test("deduplicates an unclassified official phrase against a local conjunction", () => {
  const { api } = createContext();
  const localConjunction = {
    ord: "selv om, sjøl om",
    gender: "conjunction",
    definisjon: "local definition",
  };
  const officialPhrase = {
    ord: "selv om, sjøl om",
    gender: "",
    definisjon: "official definition",
    _ordbokene: { matchType: "exact" },
  };

  const merged = api.mergeEntries([localConjunction], {
    entries: [officialPhrase],
    hasExactArticles: true,
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0], localConjunction);
});

test("keeps single-word entries from different word classes distinct", () => {
  const { api } = createContext();
  const localNoun = {
    ord: "type",
    gender: "en",
    definisjon: "local noun",
  };
  const officialVerb = {
    ord: "type",
    gender: "verb",
    definisjon: "official verb",
    _ordbokene: { matchType: "exact" },
  };

  const merged = api.mergeEntries([localNoun], {
    entries: [officialVerb],
    hasExactArticles: true,
  });

  assert.equal(merged.length, 2);
  assert.equal(merged[0], officialVerb);
  assert.equal(merged[1], localNoun);
});

test("prefers CSV numerals over official determiner classifications", () => {
  const { api } = createContext();
  const localNumerals = [
    {
      ord: "tjuefem",
      gender: "numeral",
      definisjon: "CSV twenty-five",
    },
    {
      ord: "en, én",
      gender: "numeral",
      definisjon: "CSV one",
    },
  ];
  const officialDeterminers = [
    {
      ord: "tjuefem",
      gender: "determiner",
      definisjon: "official twenty-five",
      _ordbokene: { matchType: "exact" },
    },
    {
      ord: "en",
      gender: "determiner",
      definisjon: "official one",
      _ordbokene: { matchType: "exact" },
    },
  ];

  const merged = api.mergeEntries(localNumerals, {
    entries: officialDeterminers,
    hasExactArticles: true,
  });

  assert.equal(merged.length, 2);
  assert.equal(merged[0], localNumerals[0]);
  assert.equal(merged[1], localNumerals[1]);
});

test("prefers ei for nouns with an official feminine paradigm", () => {
  const { api } = createContext();
  const entry = api.articleToEntry(
    {
      article_id: 49118,
      lemmas: [
        {
          lemma: "rundspørring",
          paradigm_info: [
            { tags: ["NOUN", "Masc"] },
            { tags: ["NOUN", "Fem"] },
          ],
        },
      ],
      body: {
        definitions: [
          {
            type_: "definition",
            elements: [
              {
                type_: "explanation",
                content: "det å rette spørsmål til mange",
                items: [],
              },
            ],
          },
        ],
      },
    },
    {},
    "exact",
  );

  assert.equal(entry.gender, "ei");
  assert.equal(entry.ord, "rundspørring");
});

test("maps skie's feminine paradigm into the shared word-forms shape", () => {
  const { api } = createContext();
  const entry = api.articleToEntry(
    {
      article_id: 52697,
      lemmas: [
        {
          lemma: "skie",
          paradigm_info: [
            {
              standardisation: "STANDARD",
              tags: ["NOUN", "Masc"],
              inflection: [
                { tags: ["Sing", "Ind"], word_form: "skie" },
                { tags: ["Sing", "Def"], word_form: "skien" },
                { tags: ["Plur", "Ind"], word_form: "skier" },
                { tags: ["Plur", "Def"], word_form: "skiene" },
              ],
            },
            {
              standardisation: "STANDARD",
              tags: ["NOUN", "Fem"],
              inflection: [
                { tags: ["Sing", "Ind"], word_form: "skie" },
                { tags: ["Sing", "Def"], word_form: "skia" },
                { tags: ["Plur", "Ind"], word_form: "skier" },
                { tags: ["Plur", "Def"], word_form: "skiene" },
              ],
            },
          ],
        },
        {
          lemma: "ski",
          paradigm_info: [
            {
              standardisation: "STANDARD",
              tags: ["NOUN", "Fem"],
              inflection: [
                { tags: ["Sing", "Ind"], word_form: "ski" },
                { tags: ["Sing", "Def"], word_form: "skia" },
                { tags: ["Plur", "Ind"], word_form: "skier" },
                { tags: ["Plur", "Def"], word_form: "skiene" },
              ],
            },
          ],
        },
      ],
      body: {
        definitions: [
          {
            type_: "definition",
            elements: [
              { type_: "explanation", content: "kløyvd trestykke", items: [] },
              {
                type_: "example",
                quote: {
                  content: "legge en $ på varmen",
                  items: [{ type_: "usage", text: "skie" }],
                },
              },
              {
                type_: "example",
                quote: {
                  content: "en $ i en skigard!",
                  items: [{ type_: "usage", text: "skie" }],
                },
              },
            ],
          },
        ],
      },
    },
    {},
    "exact",
  );

  assert.equal(entry.gender, "ei");
  assert.equal(entry.ord, "skie, ski");
  assert.equal(
    JSON.stringify(entry._ordbokene.inflections.forms),
    JSON.stringify([
      {
        label: "Indefinite singular",
        value: ["ei skie", "en skie", "ei ski", "en ski"],
      },
      { label: "Definite singular", value: ["skia", "skien"] },
      { label: "Indefinite plural", value: "skier" },
      { label: "Definite plural", value: "skiene" },
    ]),
  );
  assert.equal(
    entry.eksempel,
    "Legge en skie på varmen. En skie i en skigard!",
  );
  assert.equal(entry.sentenceTranslation, "");
  assert.equal(entry._ordbokene.hasBlankTranslations, true);
});
