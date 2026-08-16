// Exact, Unicode-aware matching for learner-facing example sentences. A form
// must occupy a complete word/phrase boundary: "ugle" can match "ugla", when
// that accepted form is supplied, but can never match the prefix of "uglasert".
(function () {
  "use strict";

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeForms(forms) {
    return [
      ...new Set(
        (forms || [])
          .map((form) =>
            String(form ?? "")
              .normalize("NFC")
              .toLocaleLowerCase("nb-NO")
              .replace(/\s+/g, " ")
              .trim(),
          )
          .filter(Boolean),
      ),
    ].sort((a, b) => b.length - a.length || a.localeCompare(b, "nb"));
  }

  function createMatcher(forms) {
    const acceptedForms = normalizeForms(forms);
    if (acceptedForms.length === 0) {
      return Object.freeze({
        forms: acceptedForms,
        test: () => false,
        highlight: (text) => String(text ?? ""),
      });
    }

    const alternatives = acceptedForms
      .map((form) => escapeRegExp(form).replace(/ /g, "\\s+"))
      .join("|");
    const source = `(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`;
    const testPattern = new RegExp(source, "iu");
    const highlightPattern = new RegExp(source, "giu");

    return Object.freeze({
      forms: acceptedForms,
      test: (text) => testPattern.test(String(text ?? "").normalize("NFC")),
      highlight: (text) =>
        String(text ?? "")
          .normalize("NFC")
          .replace(
            highlightPattern,
            (matchedText) =>
              `<span style="color: #1f6fb3;">${matchedText}</span>`,
          ),
    });
  }

  function splitSentences(text) {
    if (!text) return [];
    const sentences = String(text).match(/[^.!?]+[.!?]*/g);
    return sentences
      ? sentences.map((sentence) => sentence.trim()).filter(Boolean)
      : [];
  }

  function collectExamples(primaryEntry, entries, matcher, limit = 100) {
    const uniqueSentences = new Set();
    const primary = [];
    const supplemental = [];

    const addSentence = (target, entry, sentence, translation = "") => {
      const key = String(sentence ?? "")
        .normalize("NFC")
        .toLocaleLowerCase("nb-NO")
        .replace(/\s+/g, " ")
        .trim();
      if (!key || uniqueSentences.has(key)) return;
      uniqueSentences.add(key);
      target.push({
        ...entry,
        eksempel: sentence,
        sentenceTranslation: translation,
      });
    };

    // Add the selected entry before searching anything else. This makes the
    // first-example guarantee structural rather than dependent on later sort
    // behavior or the dictionary's row order.
    const primarySentences = splitSentences(primaryEntry?.eksempel);
    const primaryTranslations = splitSentences(
      primaryEntry?.sentenceTranslation,
    );
    primarySentences.forEach((sentence, index) => {
      addSentence(
        primary,
        primaryEntry,
        sentence,
        primaryTranslations[index] || "",
      );
    });

    outerLoop: for (const entry of entries || []) {
      if (!entry?.eksempel || !matcher.test(entry.eksempel)) continue;
      const sentences = splitSentences(entry?.eksempel);
      const translations = splitSentences(entry?.sentenceTranslation);

      for (let index = 0; index < sentences.length; index++) {
        const sentence = sentences[index];
        if (!matcher.test(sentence)) continue;
        addSentence(
          supplemental,
          entry,
          sentence,
          translations[index] || "",
        );
        if (supplemental.length >= limit) break outerLoop;
      }
    }

    return { primary, supplemental };
  }

  window.SentenceFormMatching = Object.freeze({
    collectExamples,
    createMatcher,
    normalizeForms,
  });
})();
