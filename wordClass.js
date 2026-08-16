// Single source of truth for classifying a dictionary entry's grammatical
// category from its CSV `gender` field, which doubles as both true
// grammatical gender for nouns (en/et/ei, possibly compound like "en-et")
// and part-of-speech for every other word class (verb, adjective, ...).
//
// This logic used to be reimplemented independently in scripts.js,
// wordGame.js, and wordList.js, with inconsistent safety properties — some
// used unanchored String.includes()/substring checks, which silently
// misclassified "adverb" as a verb match (it contains "verb"), "pronoun"
// as a noun match (it contains "noun"), and "determiner" as a noun (it
// contains "et", in "d-ET-erminer"). One shared, tested implementation
// removes that whole bug class.
//
// Loaded first — a plain, non-deferred <script> before every other app
// script — so its globals are available to pronunciation.js/wordList.js/
// myWordsAuth.js, which run synchronously during HTML parsing, before the
// deferred scripts (scripts.js, wordGame.js, ...) run after parsing ends.
(function () {
  "use strict";

  // All grammatical-gender values a noun's `gender` field can take,
  // including entries that list more than one article (e.g. "en-et").
  const NOUN_GENDER_FORMS = [
    "en",
    "et",
    "ei",
    "en-et",
    "en-ei",
    "ei-et",
    "en-ei-et",
  ];

  // Strips a leading "noun - " prefix (added by formatWordClassLabel
  // below) and normalizes case/whitespace, so a previously-formatted
  // display value ("noun - en") and a raw CSV value ("en") both reduce to
  // the same token.
  function stripNounPrefix(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/^noun\s*-\s*/, "");
  }

  // True if `genderValue` represents a noun. Requires "en"/"et"/"ei" to
  // appear as a standalone token (word-boundary delimited), not merely as
  // a substring — a plain String.includes() check also matches
  // "determiner", misclassifying determiners as nouns. \b still correctly
  // matches the "en" inside a "noun - en" display value, since a space is
  // a non-word character too. Deliberately strict — a bare "noun" value
  // (used by a handful of dictionary entries with no specific article on
  // file) does not match here; callers that need to treat that case as a
  // noun too do so explicitly, since that was already an inconsistent,
  // per-call-site convention before this consolidation and preserving it
  // exactly (rather than silently unifying it) avoids changing behavior.
  function isNounGender(genderValue) {
    const normalized = stripNounPrefix(genderValue);
    return /\b(en|et|ei)\b/.test(normalized);
  }

  // Canonical word-class token for a raw `gender` value: "noun" for any
  // noun (regardless of which article(s) it takes), or the value itself
  // (lowercased, any "noun - " prefix stripped) for every other class.
  function getWordClass(genderValue) {
    const normalized = stripNounPrefix(genderValue);
    return isNounGender(normalized) ? "noun" : normalized;
  }

  // True if `genderValue` belongs to the word class named by
  // `selectedPOS` (a token like "noun", "verb", "adjective", as used by
  // the Word Class filter dropdown). Anchored on a whole leading token,
  // never a bare substring, so "adverb" never matches a "verb" filter and
  // "pronoun" never matches a "noun" filter.
  function matchesWordClass(genderValue, selectedPOS) {
    if (!selectedPOS) return true;
    const normalizedPOS = stripNounPrefix(selectedPOS);
    if (normalizedPOS === "noun") {
      return isNounGender(genderValue);
    }
    return stripNounPrefix(genderValue).startsWith(normalizedPOS);
  }

  // True if two `gender` values are close enough to swap one for the
  // other as a Word Game distractor — same word class, and for nouns,
  // sharing at least one article ("en-et" is compatible with a plain "en"
  // or "et" noun). Comparing by shared prefix used to conflate
  // "adjective"/"adverb" and "preposition"/"pronoun" (both pairs share
  // their first two letters) — comparing token sets instead fixes that,
  // while still treating a compound noun gender like "en-et" as
  // compatible with "en".
  function hasCompatibleGender(targetGender, candidateGender) {
    if (!candidateGender) return false;
    const targetTokens = String(targetGender ?? "")
      .toLowerCase()
      .split("-");
    const candidateTokens = String(candidateGender ?? "")
      .toLowerCase()
      .split("-");
    return targetTokens.some((token) => candidateTokens.includes(token));
  }

  // Prefixes "noun - " onto a noun's raw gender value for display (e.g.
  // "en" -> "noun - en"), leaving every other word class unchanged. Strips
  // any existing "noun - " prefix first so re-formatting an
  // already-formatted value is idempotent rather than doubling it up.
  function formatWordClassLabel(genderValue) {
    const raw = String(genderValue ?? "").trim();
    if (!raw) return raw;
    return isNounGender(raw) ? "noun - " + stripNounPrefix(raw) : raw;
  }

  window.WordClass = Object.freeze({
    NOUN_GENDER_FORMS,
    stripNounPrefix,
    isNounGender,
    getWordClass,
    matchesWordClass,
    hasCompatibleGender,
    formatWordClassLabel,
  });
})();
