import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const authSource = fs.readFileSync(path.join(root, "myWordsAuth.js"), "utf8");
const landingStyles = fs.readFileSync(
  path.join(root, "styles", "10-shell-landing-and-stats.css"),
  "utf8",
);

test("the mobile landing headline wraps only between complete words", () => {
  const mobileStart = landingStyles.indexOf("@media (max-width: 1024px)");
  const headlineStart = landingStyles.indexOf("#landing-card h2", mobileStart);
  const headlineEnd = landingStyles.indexOf("}", headlineStart);
  const rule = landingStyles.slice(headlineStart, headlineEnd);

  assert.notEqual(mobileStart, -1);
  assert.notEqual(headlineStart, -1);
  assert.match(rule, /hyphens:\s*none/);
  assert.match(rule, /overflow-wrap:\s*normal/);
  assert.match(rule, /word-break:\s*normal/);
});

test("Google sign-in opens synchronously inside the trusted click path", async () => {
  const functionStart = authSource.indexOf("function handleInteractiveSignIn(");
  const functionEnd = authSource.indexOf("// Runs once", functionStart);
  assert.notEqual(functionStart, -1);
  assert.notEqual(functionEnd, -1);

  const calls = [];
  const button = { disabled: false };
  const context = vm.createContext({
    auth: {},
    button,
    console: { warn: () => {} },
    prepareAuth: () => calls.push("prepare"),
    triggerSignIn: () => {
      calls.push("popup");
      return Promise.resolve();
    },
    window: { trackEvent: () => calls.push("track") },
  });

  vm.runInContext(
    `${authSource.slice(functionStart, functionEnd)}\nhandleInteractiveSignIn("header", button);`,
    context,
  );

  // This assertion runs before the returned promise microtask: the popup call
  // must already have happened while the click's user activation is intact.
  assert.deepEqual(calls, ["track", "popup"]);
  assert.equal(button.disabled, true);
  await Promise.resolve();
  assert.equal(button.disabled, false);
  assert.doesNotMatch(authSource, /ensureAuthReady\(\)\s*\.then\(triggerSignIn\)/);
});
