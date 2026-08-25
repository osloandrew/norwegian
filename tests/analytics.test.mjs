import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("analytics excludes local/build traffic and owns SPA page views", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");

  assert.match(html, /ANALYTICS_PRODUCTION_HOSTS/);
  assert.match(html, /send_page_view:\s*false/);
  assert.match(html, /window\.trackPageView/);
  assert.match(html, /pageViewKey === lastPageViewKey/);
  assert.match(html, /url\.searchParams\.delete\(parameter\)/);
  assert.doesNotMatch(html, /event_label:/);
});

test("successful Google auth emits GA4 recommended events", async () => {
  const source = await readFile(new URL("myWordsAuth.js", root), "utf8");

  assert.match(source, /isNewUser \? "sign_up" : "login"/);
  assert.match(source, /method:\s*"Google"/);
});
