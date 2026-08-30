import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "englishVisibility.js"), "utf8");

function loadWithStoredValue(storedValue, { storageThrows = false } = {}) {
  const storage = new Map();
  if (storedValue !== null) {
    storage.set("norwegian-dictionary-show-english-v1", storedValue);
  }

  const context = vm.createContext({
    console,
    CustomEvent: class {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
  });
  context.window = context;
  context.localStorage = {
    getItem: (key) => {
      if (storageThrows) throw new Error("storage unavailable");
      return storage.get(key) ?? null;
    },
    setItem: (key, value) => storage.set(key, value),
  };
  context.dispatchEvent = () => {};

  vm.runInContext(source, context, { filename: "englishVisibility.js" });
  return context.EnglishVisibilityAPI.getState();
}

assert.equal(
  loadWithStoredValue(null),
  true,
  "fresh users should see English by default",
);
assert.equal(loadWithStoredValue("true"), true);
assert.equal(
  loadWithStoredValue("false"),
  false,
  "an existing hide preference should remain hidden",
);
assert.equal(
  loadWithStoredValue(null, { storageThrows: true }),
  true,
  "the safe fallback should match the fresh-user default",
);
