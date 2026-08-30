import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "wordGame.js"), "utf8");
const styles = fs.readFileSync(
  path.join(root, "styles", "00-foundations-and-game.css"),
  "utf8",
);

function loadBannerFitter() {
  const start = source.indexOf("const GAME_BANNER_MIN_FONT_SIZE");
  const end = source.indexOf("let gameBannerResizeObserver", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const context = vm.createContext({
    window: {
      getComputedStyle: (element) => {
        const fontSize = parseFloat(element.style.fontSize) || 16;
        return {
          fontSize: `${fontSize}px`,
          lineHeight: `${fontSize * 1.2}px`,
        };
      },
    },
  });
  vm.runInContext(
    `${source.slice(start, end)}\nthis.fitBanner = fitGameBannerText;`,
    context,
  );
  return context.fitBanner;
}

function bannerFixture(maximumTwoLineFontSize) {
  const paragraph = {
    clientWidth: 160,
    style: {
      fontSize: "",
      removeProperty: () => {
        paragraph.style.fontSize = "";
      },
    },
  };
  Object.defineProperties(paragraph, {
    scrollHeight: {
      get: () => {
        const fontSize = parseFloat(paragraph.style.fontSize) || 16;
        const lines = fontSize <= maximumTwoLineFontSize ? 2 : 3;
        return fontSize * 1.2 * lines;
      },
    },
    scrollWidth: { get: () => paragraph.clientWidth },
  });
  return {
    paragraph,
    placeholder: { querySelector: () => paragraph },
  };
}

test("short game banners keep their natural font size", () => {
  const { paragraph, placeholder } = bannerFixture(16);
  loadBannerFitter()(placeholder);

  assert.equal(paragraph.style.fontSize, "");
});

test("long game banners use the largest font size that fits two lines", () => {
  const { paragraph, placeholder } = bannerFixture(12.75);
  loadBannerFitter()(placeholder);

  const fittedSize = parseFloat(paragraph.style.fontSize);
  assert.ok(fittedSize <= 12.75);
  assert.ok(fittedSize > 12.7);
});

test("CSS provides a hard two-line boundary above the game prompt", () => {
  assert.match(
    styles,
    /#game-banner-placeholder > div\s*{[^}]*max-height:\s*2\.4em;[^}]*overflow:\s*hidden;/s,
  );
  assert.match(styles, /#game-banner-placeholder p\s*{[^}]*line-height:\s*1\.2;/s);
});
