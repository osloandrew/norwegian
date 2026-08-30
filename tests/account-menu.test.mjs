import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptsSource = fs.readFileSync(path.join(root, "scripts.js"), "utf8");
const menuStyles = fs.readFileSync(
  path.join(root, "styles", "10-shell-landing-and-stats.css"),
  "utf8",
);

function loadPositioner() {
  const start = scriptsSource.indexOf("function positionAccountMenuPanel(");
  const end = scriptsSource.indexOf("// Toggleable dropdown", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const context = vm.createContext({
    document: { documentElement: { clientWidth: 320 } },
  });
  vm.runInContext(
    `${scriptsSource.slice(start, end)}\nthis.positionPanel = positionAccountMenuPanel;`,
    context,
  );
  return context.positionPanel;
}

function panelFixture(width) {
  const classes = new Set(["account-menu-panel--opens-right"]);
  const properties = new Map();
  return {
    classes,
    classList: {
      remove: (name) => classes.delete(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
    },
    getBoundingClientRect: () => ({ width }),
    properties,
    style: {
      removeProperty: (name) => properties.delete(name),
      setProperty: (name, value) => properties.set(name, value),
    },
  };
}

test("account menu keeps its preferred left-growing alignment when it fits", () => {
  const panel = panelFixture(190);
  loadPositioner()(
    { getBoundingClientRect: () => ({ left: 266, right: 300 }) },
    panel,
  );

  assert.equal(panel.classes.has("account-menu-panel--opens-right"), false);
  assert.equal(panel.properties.get("--account-menu-available-width"), "292px");
});

test("account menu grows right when there is not enough room on the left", () => {
  const panel = panelFixture(190);
  loadPositioner()(
    { getBoundingClientRect: () => ({ left: 116, right: 150 }) },
    panel,
  );

  assert.equal(panel.classes.has("account-menu-panel--opens-right"), true);
  assert.equal(panel.properties.get("--account-menu-available-width"), "196px");
});

test("account menu is elevated above nearby sticky page chrome", () => {
  const menuStart = menuStyles.indexOf(".account-menu {");
  const menuEnd = menuStyles.indexOf("}", menuStart);
  const menuRule = menuStyles.slice(menuStart, menuEnd);

  assert.match(menuRule, /position:\s*relative/);
  assert.match(menuRule, /z-index:\s*1100/);
  assert.match(menuStyles, /\.account-menu-panel--opens-right\s*{[^}]*left:\s*0;[^}]*right:\s*auto;/s);
});

test("account menu labels stay within a width-capped panel", () => {
  const itemStart = menuStyles.indexOf(".account-menu-item {");
  const itemEnd = menuStyles.indexOf("}", itemStart);
  const itemRule = menuStyles.slice(itemStart, itemEnd);

  assert.match(itemRule, /max-width:\s*100%/);
  assert.match(itemRule, /min-width:\s*0/);
  assert.match(itemRule, /overflow-wrap:\s*anywhere/);
  assert.match(itemRule, /white-space:\s*normal/);
});
