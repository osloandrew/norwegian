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
  assert.equal(entry.eksempel, "en sirlig håndskrift.");
  assert.equal(entry.etymologi, "fra tysk; av sir opprinnelig ‘pyntelig’");
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

test("infers Norwegian noun articles from official paradigm tags", () => {
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

  assert.equal(entry.gender, "en-ei");
  assert.equal(entry.ord, "rundspørring");
});
