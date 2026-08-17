// Automatic, entry-local grammar for multi-word dictionary expressions.
//
// The CSV intentionally remains the only authored source.  This module uses
// the expression's citation form, its own example, and the compact Norsk
// Ordbank paradigms to infer which components inflect and where bounded
// intervening material may occur.  Every consumer receives the same compiled
// pattern, so sentence retrieval, highlighting, Word Forms, and the Word Game
// cannot drift into four independent sets of guesses.
(function () {
  "use strict";

  const MAX_ALIGNMENT_GAP = 8;
  const MAX_PLACEHOLDER_WORDS = 6;
  const STRONG_BOUNDARY = /[.!?;:]/u;
  const TOKEN_PATTERN = /\.\.\.|…|[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;
  const REFLEXIVE_FORMS = new Set(["meg", "deg", "seg", "oss", "dere"]);
  const POSSESSIVE_FORMS = new Set([
    "min",
    "mi",
    "mitt",
    "mine",
    "din",
    "di",
    "ditt",
    "dine",
    "sin",
    "sitt",
    "sine",
    "vår",
    "vårt",
    "våre",
    "hans",
    "hennes",
    "dens",
    "dets",
    "deres",
  ]);
  const VARIABLE_TOKENS = new Set(["noen", "noe", "nokon", "noko"]);
  const VARIABLE_POSSESSIVES = new Set(["ens", "noens", "nokons"]);
  // What a "noen"/"noe" object slot ("gjøre noen noe" = do something TO
  // SOMEONE) may actually be filled with in real text: the literal
  // placeholder word itself (most common — many idioms occur with it
  // unfilled, e.g. "det gjør ikke noe"), or a personal/reflexive pronoun
  // genuinely standing in for a person ("noen") — the entry's own example
  // replaces "noen" with "deg". Without this, the slot was an unconstrained
  // wildcard that could just as well swallow any nearby unrelated noun or
  // adjective, turning a bare "gjør" followed by any two words into a false
  // "gjøre noen noe" match. "noe" (a thing) is far less freely substituted
  // in practice, so only "det" is accepted beyond the literal word.
  const PERSON_PLACEHOLDER_FORMS = new Set([
    ...REFLEXIVE_FORMS,
    "ham",
    "han",
    "henne",
    "hun",
    "dem",
    "de",
  ]);

  function isAcceptableVariableTokenFiller(nodeNormalized, surfaceNormalized) {
    if (surfaceNormalized === nodeNormalized) return true;
    if (nodeNormalized === "noen" || nodeNormalized === "nokon") {
      return PERSON_PLACEHOLDER_FORMS.has(surfaceNormalized);
    }
    if (nodeNormalized === "noe" || nodeNormalized === "noko") {
      return surfaceNormalized === "det";
    }
    return false;
  }
  const PREVERBAL_ADVERBS = new Set(["ikke", "aldri", "neppe"]);
  const VERB_CONTEXT = new Set([
    "å",
    "kan",
    "kunne",
    "må",
    "måtte",
    "skal",
    "skulle",
    "vil",
    "ville",
    "bør",
    "burde",
  ]);
  const PREPOSITIONS = new Set([
    "av",
    "bak",
    "blant",
    "etter",
    "for",
    "foran",
    "fra",
    "før",
    "gjennom",
    "hos",
    "i",
    "innen",
    "med",
    "mellom",
    "mot",
    "om",
    "over",
    "på",
    "rundt",
    "til",
    "under",
    "uten",
    "ved",
  ]);
  const cache = new WeakMap();
  const primitiveCache = new Map();

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFC")
      .toLocaleLowerCase("nb-NO")
      .replace(/\s+/g, " ")
      .trim();
  }

  function unique(values) {
    return [...new Set((values || []).filter(Boolean))];
  }

  function expandSlashVariant(variant) {
    let combinations = [""];
    for (const token of String(variant || "").trim().split(/\s+/u)) {
      const options = token.split("/").filter(Boolean);
      combinations = combinations.flatMap((prefix) =>
        options.map((option) => (prefix ? `${prefix} ${option}` : option)),
      );
    }
    return combinations;
  }

  function getVariants(entry) {
    return unique(
      String(entry?.ord ?? "")
        .split(",")
        .flatMap(expandSlashVariant)
        .map((variant) => variant.normalize("NFC").replace(/\s+/g, " ").trim()),
    );
  }

  function tokenize(value) {
    return Array.from(String(value ?? "").matchAll(TOKEN_PATTERN), (match) => ({
      text: match[0],
      normalized: normalize(match[0] === "…" ? "..." : match[0]),
      start: match.index,
      end: match.index + match[0].length,
    }));
  }

  function flattenParadigm(paradigm) {
    return unique(paradigm?.slots?.flat() || []).map(normalize);
  }

  function candidateIdentity(candidate) {
    return `${candidate.wordClass}:${candidate.lemma}:${candidate.paradigm?.gender || ""}`;
  }

  async function getCandidates(token, componentIndex, includeReverse = false) {
    const candidates = [];
    const seen = new Set();
    const add = (lemma, wordClass, paradigm, estimated = false) => {
      if (!paradigm) return;
      const candidate = {
        lemma: normalize(lemma),
        wordClass,
        paradigm,
        estimated:
          estimated || paradigm.sourceType === "dictionary-only",
        forms: new Set(flattenParadigm(paradigm)),
      };
      const identity = candidateIdentity(candidate);
      if (!candidate.lemma || seen.has(identity)) return;
      seen.add(identity);
      candidates.push(candidate);
    };

    for (const wordClass of ["verb", "adjective", "noun"]) {
      const direct = window.Inflections?.getParadigmForLemma(
        token.normalized,
        wordClass,
        "",
      );
      add(token.normalized, wordClass, direct);

      if (includeReverse) {
        for (const paradigm of
          window.Inflections?.getExpressionComponentParadigms?.(
            token.normalized,
            wordClass,
          ) || []) {
          add(paradigm.lemma, wordClass, paradigm);
        }
      }
    }

    // A CSV row can be deployed before the compact Ordbank snapshot is
    // refreshed.  In that narrow case, a first component that behaves like a
    // regular verb in the entry's own example may still receive an explicitly
    // estimated paradigm.  It can never be presented as an Ordbank result.
    if (
      componentIndex === 0 &&
      !PREVERBAL_ADVERBS.has(token.normalized) &&
      !candidates.some((candidate) => candidate.wordClass === "verb")
    ) {
      add(
        token.normalized,
        "verb",
        window.Inflections?.getEstimatedParadigmForLemma?.(
          token.normalized,
          "verb",
        ),
        true,
      );
    }
    return candidates;
  }

  function getSlotsContaining(candidate, surface) {
    const normalizedSurface = normalize(surface);
    const direct = (candidate?.paradigm?.slots || []).flatMap((forms, index) =>
      forms.map(normalize).includes(normalizedSurface) ? [index] : [],
    );
    if (direct.length > 0 || candidate?.wordClass !== "noun") return direct;
    const base = /['’]$/u.test(normalizedSurface)
      ? normalizedSurface.slice(0, -1)
      : normalizedSurface.endsWith("s")
        ? normalizedSurface.slice(0, -1)
        : "";
    if (!base) return [];
    return (candidate?.paradigm?.slots || []).flatMap((forms, index) =>
      forms.map(normalize).includes(base) ? [index] : [],
    );
  }

  function getLexemePair(node, surfaceToken) {
    const surface = normalize(surfaceToken.text);
    const exact = surface === node.normalized;
    const compatible = node.candidates
      .map((candidate) => ({
        candidate,
        slotIndexes: getSlotsContaining(candidate, surface),
      }))
      .filter((match) => match.slotIndexes.length > 0);

    if (exact) {
      return { exact: true, compatible, score: 12, surfaceToken };
    }
    if (node.normalized === "seg" && REFLEXIVE_FORMS.has(surface)) {
      return {
        exact: false,
        compatible: [],
        reflexive: true,
        score: 15,
        surfaceToken,
      };
    }
    if (POSSESSIVE_FORMS.has(node.normalized) && POSSESSIVE_FORMS.has(surface)) {
      return {
        exact: false,
        compatible: [],
        possessive: true,
        score: 14,
        surfaceToken,
      };
    }
    if (compatible.length > 0) {
      return { exact: false, compatible, score: 17, surfaceToken };
    }
    return null;
  }

  function crossesStrongBoundary(text, leftToken, rightToken) {
    if (!leftToken || !rightToken) return false;
    return STRONG_BOUNDARY.test(text.slice(leftToken.end, rightToken.start));
  }

  function isBetterAlignment(candidate, current) {
    if (!current) return true;
    if (candidate.score !== current.score) return candidate.score > current.score;
    const candidateLength = candidate.endToken - candidate.startToken;
    const currentLength = current.endToken - current.startToken;
    return candidateLength < currentLength;
  }

  function findBestAlignment(pattern, text) {
    const sentenceTokens = tokenize(text).filter(
      (token) => token.normalized !== "...",
    );
    if (sentenceTokens.length === 0 || pattern.nodes.length === 0) return null;
    let best = null;

    const walk = (nodeIndex, sentenceIndex, matches, score, startToken) => {
      if (nodeIndex >= pattern.nodes.length) {
        const candidate = {
          matches,
          score,
          startToken,
          endToken: sentenceIndex,
          sentenceTokens,
        };
        if (isBetterAlignment(candidate, best)) best = candidate;
        return;
      }

      const node = pattern.nodes[nodeIndex];
      if (node.type === "wildcard" || node.type === "placeholder") {
        const minimum = node.minWords ?? 1;
        const maximum = Math.min(
          node.maxWords || MAX_PLACEHOLDER_WORDS,
          sentenceTokens.length - sentenceIndex,
        );
        for (let count = minimum; count <= maximum; count++) {
          if (count === 0) {
            walk(
              nodeIndex + 1,
              sentenceIndex,
              [
                ...matches,
                {
                  nodeIndex,
                  node,
                  startToken: sentenceIndex,
                  endToken: sentenceIndex,
                  variable: true,
                },
              ],
              score + 5,
              startToken,
            );
            continue;
          }
          const first = sentenceTokens[sentenceIndex];
          const last = sentenceTokens[sentenceIndex + count - 1];
          if (!first || !last) continue;
          if (crossesStrongBoundary(text, first, last)) break;
          walk(
            nodeIndex + 1,
            sentenceIndex + count,
            [
              ...matches,
              {
                nodeIndex,
                node,
                startToken: sentenceIndex,
                endToken: sentenceIndex + count,
                variable: true,
              },
            ],
            score + 7 - Math.max(0, count - 1),
            startToken < 0 ? sentenceIndex : startToken,
          );
        }
        return;
      }

      const latest =
        nodeIndex === 0
          ? sentenceTokens.length - 1
          : Math.min(sentenceTokens.length - 1, sentenceIndex + MAX_ALIGNMENT_GAP);
      for (let index = sentenceIndex; index <= latest; index++) {
        const previous = matches.length
          ? sentenceTokens[matches[matches.length - 1].endToken - 1]
          : null;
        if (previous && crossesStrongBoundary(text, previous, sentenceTokens[index])) {
          break;
        }
        const pair = getLexemePair(node, sentenceTokens[index]);
        if (!pair) continue;
        const gapBefore = nodeIndex === 0 ? 0 : index - sentenceIndex;
        walk(
          nodeIndex + 1,
          index + 1,
          [
            ...matches,
            {
              nodeIndex,
              node,
              pair,
              startToken: index,
              endToken: index + 1,
              gapBefore,
            },
          ],
          score + pair.score - gapBefore * 2,
          startToken < 0 ? index : startToken,
        );
      }
    };

    walk(0, 0, [], 0, -1);
    return best;
  }

  function chooseCandidate(match, pattern, alignment) {
    if (!match?.pair) return null;
    if (match.pair.exact && PREPOSITIONS.has(match.node.normalized)) {
      return null;
    }
    const compatible = (match.pair.compatible || []).filter(
      ({ candidate }) => !match.pair.exact || !candidate.estimated,
    );
    if (compatible.length === 0) return null;
    const classes = new Set(compatible.map(({ candidate }) => candidate.wordClass));

    if (!match.pair.exact) {
      if (classes.size === 1) return compatible[0];
      if (
        match.nodeIndex === 0 ||
        match.nodeIndex === alignment.matchOrder?.[0]
      ) {
        const verb = compatible.find(({ candidate }) => candidate.wordClass === "verb");
        if (verb) return verb;
      }
      const noun = compatible.find(({ candidate }) => candidate.wordClass === "noun");
      if (noun && match.nodeIndex === pattern.nodes.length - 1) return noun;
      return null;
    }

    const sentenceTokenIndex = match.startToken;
    const preceding = normalize(
      alignment.sentenceTokens[sentenceTokenIndex - 1]?.text || "",
    );
    if (VERB_CONTEXT.has(preceding)) {
      return compatible.find(({ candidate }) => candidate.wordClass === "verb") || null;
    }
    if (
      match.nodeIndex === alignment.matchOrder?.[0] &&
      compatible.some(({ candidate }) => candidate.wordClass === "verb")
    ) {
      return compatible.find(({ candidate }) => candidate.wordClass === "verb");
    }
    if (
      pattern.nodes[match.nodeIndex - 1]?.type === "placeholder" &&
      compatible.some(({ candidate }) => candidate.wordClass === "verb")
    ) {
      return compatible.find(({ candidate }) => candidate.wordClass === "verb");
    }
    if (classes.size === 1) {
      const only = compatible[0];
      if (
        only.candidate.wordClass === "verb" &&
        (match.nodeIndex === 0 ||
          VERB_CONTEXT.has(preceding) ||
          only.candidate.lemma !== match.node.normalized)
      ) {
        return only;
      }
    }
    return null;
  }

  function applyAlignment(pattern, alignment) {
    pattern.alignment = alignment;
    if (!alignment) return;
    for (const match of alignment.matches) {
      const node = pattern.nodes[match.nodeIndex];
      if (!node) continue;
      if (match.variable) {
        node.primaryGapWords = match.endToken - match.startToken;
        continue;
      }
      if (match.pair?.reflexive) node.reflexive = true;
      if (match.pair?.possessive) {
        // Possessives inside lexicalized expressions are fixed material, not
        // a free agreement paradigm.  Retain the citation spelling and, when
        // this entry's own example supplies a different person with the same
        // construction, retain only that attested surface too.  This avoids
        // expanding e.g. "sin" into grammatically incompatible si/sitt/sine.
        node.possessive = true;
        node.possessiveForms = new Set([
          node.normalized,
          normalize(match.pair.surfaceToken?.text),
        ]);
      }
      const selected = chooseCandidate(match, pattern, alignment);
      if (selected) {
        node.selected = selected.candidate;
        node.primarySlotIndexes = selected.slotIndexes;
        node.primarySurface = match.pair.surfaceToken.text;
      }
      if (match.gapBefore > 0) {
        node.maxGapBefore = Math.min(
          MAX_ALIGNMENT_GAP,
          Math.max(3, match.gapBefore + 2),
        );
        node.primaryGapWords = match.gapBefore;
      }
    }
  }

  function selectUniqueCandidate(node, wordClass) {
    const candidates = node?.candidates?.filter(
      (candidate) => candidate.wordClass === wordClass && !candidate.estimated,
    );
    if (!candidates?.length) return null;
    const lemmas = new Set(candidates.map((candidate) => candidate.lemma));
    return lemmas.size === 1 ? candidates[0] : null;
  }

  function inferNominalOrAdjectiveStructure(pattern) {
    if (!pattern.alignment) return;
    if (pattern.nodes.some((node) => node.selected?.wordClass === "verb")) return;
    const firstPreposition = pattern.nodes.findIndex((node) =>
      PREPOSITIONS.has(node.normalized),
    );
    const nominalEnd = firstPreposition < 0 ? pattern.nodes.length : firstPreposition;
    const adjectiveIndexes = pattern.nodes
      .map((node, index) => ({ node, index }))
      .filter(
        ({ node, index }) =>
          index < nominalEnd && Boolean(selectUniqueCandidate(node, "adjective")),
      );
    const nounIndexes = pattern.nodes
      .map((node, index) => ({ node, index }))
      .filter(
        ({ node, index }) =>
          index < nominalEnd && Boolean(selectUniqueCandidate(node, "noun")),
      );
    if (nounIndexes.length > 0 && adjectiveIndexes.length > 0) {
      const head = nounIndexes[nounIndexes.length - 1];
      head.node.selected = selectUniqueCandidate(head.node, "noun");
      for (const adjective of adjectiveIndexes.filter(
        ({ index }) => index < head.index,
      )) {
        adjective.node.selected = selectUniqueCandidate(
          adjective.node,
          "adjective",
        );
      }
      return;
    }
    if (
      nounIndexes.length === 0 &&
      adjectiveIndexes.length === 1 &&
      firstPreposition > adjectiveIndexes[0].index
    ) {
      adjectiveIndexes[0].node.selected = selectUniqueCandidate(
        adjectiveIndexes[0].node,
        "adjective",
      );
    }
  }

  function propagateSelections(patterns) {
    const evidence = new Map();
    for (const pattern of patterns) {
      for (const node of pattern.nodes) {
        if (!node.selected) continue;
        const key = `${node.normalized}:${node.selected.wordClass}`;
        evidence.set(key, node.selected);
      }
    }
    for (const pattern of patterns) {
      for (const node of pattern.nodes) {
        if (node.selected) continue;
        for (const wordClass of ["verb", "adjective", "noun"]) {
          const selected = evidence.get(`${node.normalized}:${wordClass}`);
          if (!selected) continue;
          const compatible = node.candidates.find(
            (candidate) =>
              candidate.wordClass === wordClass &&
              candidate.lemma === selected.lemma,
          );
          if (compatible) node.selected = compatible;
        }
      }
    }

    // Alternatives commonly differ only in one fixed preposition.  If the
    // primary example establishes a bounded gap for one alternative, carry
    // that structural evidence to an otherwise parallel alternative instead
    // of displaying an object slot for only half of the dictionary entry.
    for (const pattern of patterns) {
      const selectedVerb = pattern.nodes.find(
        (node) => node.selected?.wordClass === "verb",
      );
      if (!selectedVerb) continue;
      const source = patterns.find(
        (candidate) =>
          candidate !== pattern &&
          candidate.nodes.length === pattern.nodes.length &&
          candidate.nodes.some(
            (node) =>
              node.selected?.wordClass === "verb" &&
              node.selected.lemma === selectedVerb.selected.lemma,
          ) &&
          candidate.nodes.some((node) => node.primaryGapWords > 0),
      );
      if (!source) continue;
      source.nodes.forEach((sourceNode, index) => {
        if (!sourceNode.primaryGapWords || !pattern.nodes[index]) return;
        pattern.nodes[index].primaryGapWords = sourceNode.primaryGapWords;
        pattern.nodes[index].maxGapBefore = sourceNode.maxGapBefore;
      });
    }
  }

  function applyVerbGovernment(patterns) {
    for (const pattern of patterns) {
      const verbs = pattern.nodes
        .map((node, index) => ({ node, index }))
        .filter(({ node }) => node.selected?.wordClass === "verb");
      for (const { node, index } of verbs) {
        node.infinitiveOnly =
          pattern.nodes[index - 1]?.normalized === "å";
      }
    }
  }

  async function buildPattern(display, example, includeReverse = false) {
    const rawTokens = tokenize(display);
    // "noen"/"noe" normally mark a genuine variable slot ("gi noen noe" =
    // "give someone something") and are compiled as optional placeholders
    // (minWords: 0) below. But a citation that OPENS with one and has no
    // other placeholder/wildcard elsewhere ("noen få" = "a few", "noen
    // gang" = "ever") is a fixed idiom, not a template — that word isn't
    // optional there. Leaving it optional let the pattern collapse to just
    // its trailing lexeme, so a bare inflected form of an unrelated word
    // class (e.g. "får", a verb form of "få") could satisfy the whole
    // "noen få" pattern on its own and hijack unrelated story text.
    const openingVariableTokenIsLiteral =
      rawTokens.length > 0 &&
      VARIABLE_TOKENS.has(rawTokens[0].normalized) &&
      !rawTokens.some(
        (token, index) =>
          index > 0 &&
          (token.normalized === "..." ||
            VARIABLE_TOKENS.has(token.normalized) ||
            VARIABLE_POSSESSIVES.has(token.normalized)),
      );
    const nodes = [];
    for (let index = 0; index < rawTokens.length; index++) {
      const token = rawTokens[index];
      const isLiteralOpeningVariable = index === 0 && openingVariableTokenIsLiteral;
      if (token.normalized === "...") {
        nodes.push({ type: "wildcard", text: "...", normalized: "..." });
      } else if (
        !isLiteralOpeningVariable &&
        (VARIABLE_TOKENS.has(token.normalized) ||
          VARIABLE_POSSESSIVES.has(token.normalized))
      ) {
        nodes.push({
          type: "placeholder",
          text: token.text,
          normalized: token.normalized,
          // A "noen"/"noe" slot is a real syntactic argument ("gjøre noen
          // noe" = do something TO SOMEONE), always exactly one word
          // (isAcceptableVariableTokenFiller further restricts a
          // VARIABLE_TOKENS node's filler to the literal word itself or a
          // real pronoun — see its own comment for why letting it match
          // zero, or arbitrarily many, unconstrained words let a bare verb
          // misfire on unrelated nearby text).
          minWords: 1,
          maxWords: 1,
        });
      } else {
        nodes.push({
          type: "lexeme",
          text: token.text,
          normalized: token.normalized,
          // Closed-class possessives are lexical material in dictionary
          // expressions.  Looking them up as open-class homographs can turn
          // "min" into a form of the verb "mine" and manufacture nonsense
          // such as "du store miner/minte". A literal opening "noen"/"noe"
          // gets the same treatment for the same reason.
          candidates:
            POSSESSIVE_FORMS.has(token.normalized) || isLiteralOpeningVariable
              ? []
              : await getCandidates(token, index, includeReverse),
          maxGapBefore: 0,
        });
      }
    }
    if (
      nodes[0]?.normalized === "det" &&
      nodes[1]?.candidates?.some((candidate) => candidate.wordClass === "verb")
    ) {
      nodes[0] = {
        type: "placeholder",
        text: nodes[0].text,
        normalized: nodes[0].normalized,
        displayLiteral: true,
        minWords: 1,
        maxWords: MAX_PLACEHOLDER_WORDS,
      };
    }
    for (let index = 0; index < nodes.length - 1; index++) {
      if (
        nodes[index]?.normalized === "en" &&
        PREPOSITIONS.has(nodes[index + 1]?.normalized)
      ) {
        nodes[index] = {
          type: "placeholder",
          text: nodes[index].text,
          normalized: nodes[index].normalized,
          highlightWhenLiteral: true,
          minWords: 0,
          maxWords: 1,
        };
      }
    }
    for (let index = 0; index < nodes.length; index++) {
      if (nodes[index]?.normalized !== "en") continue;
      const previous = nodes[index - 1];
      const next = nodes[index + 1];
      const previousIsVerb = previous?.candidates?.some(
        (candidate) => candidate.wordClass === "verb",
      );
      const previousIsPreposition = PREPOSITIONS.has(previous?.normalized);
      const nextCandidateClasses = new Set(
        (next?.candidates || []).map((candidate) => candidate.wordClass),
      );
      const nextIsVerb =
        nextCandidateClasses.has("verb") &&
        !nextCandidateClasses.has("noun") &&
        !nextCandidateClasses.has("adjective");
      const nextIsInflectedNoun = next?.candidates?.some(
        (candidate) =>
          candidate.wordClass === "noun" &&
          candidate.lemma !== next.normalized,
      );
      if (
        (index === nodes.length - 1 &&
          (previousIsVerb || previousIsPreposition)) ||
        nextIsVerb ||
        (previousIsVerb && nextIsInflectedNoun)
      ) {
        nodes[index] = {
          type: "placeholder",
          text: nodes[index].text,
          normalized: nodes[index].normalized,
          highlightWhenLiteral: true,
          minWords: 0,
          maxWords: 1,
        };
      }
    }
    const naturalOrder = nodes.map((_, index) => index);
    const matchOrders = [naturalOrder];
    for (let index = 0; index < nodes.length - 1; index++) {
      if (!VARIABLE_POSSESSIVES.has(nodes[index]?.normalized)) continue;
      matchOrders.push([
        ...naturalOrder.slice(0, index),
        index + 1,
        index,
        ...naturalOrder.slice(index + 2),
      ]);
    }
    if (
      PREVERBAL_ADVERBS.has(nodes[0]?.normalized) &&
      nodes[1]?.candidates?.some((candidate) => candidate.wordClass === "verb")
    ) {
      matchOrders.push([1, 0, ...naturalOrder.slice(2)]);
      if (nodes[2]?.normalized === "seg") {
        matchOrders.push([1, 2, 0, ...naturalOrder.slice(3)]);
      }
    }
    if (
      nodes.length > 2 &&
      nodes[nodes.length - 1]?.candidates?.some(
        (candidate) => candidate.wordClass === "verb",
      )
    ) {
      matchOrders.push([
        nodes.length - 1,
        ...naturalOrder.slice(0, nodes.length - 1),
      ]);
    }
    if (
      nodes.length > 1 &&
      nodes[1]?.candidates?.some((candidate) => candidate.wordClass === "verb")
    ) {
      matchOrders.push([1, 0, ...naturalOrder.slice(2)]);
      if (PREVERBAL_ADVERBS.has(nodes[2]?.normalized)) {
        matchOrders.push([1, 2, 0, ...naturalOrder.slice(3)]);
      }
    }
    const pattern = { display, nodes, matchOrders };
    let bestAlignment = null;
    for (const order of matchOrders) {
      const orderedPattern = {
        nodes: order.map((index) => nodes[index]),
      };
      const alignment = findBestAlignment(orderedPattern, example);
      if (!alignment) continue;
      alignment.matches = alignment.matches.map((match) => ({
        ...match,
        node: nodes[order[match.nodeIndex]],
        nodeIndex: order[match.nodeIndex],
      }));
      alignment.matchOrder = order;
      if (isBetterAlignment(alignment, bestAlignment)) bestAlignment = alignment;
    }
    applyAlignment(pattern, bestAlignment);
    inferNominalOrAdjectiveStructure(pattern);
    return pattern;
  }

  function matchNode(node, surfaceToken) {
    const surface = normalize(surfaceToken.text);
    if (node.reflexive && REFLEXIVE_FORMS.has(surface)) {
      return { slotIndexes: [], surfaceToken };
    }
    if (node.possessiveForms?.has(surface)) {
      return { slotIndexes: [], surfaceToken };
    }
    if (node.selected) {
      const slotIndexes = getSlotsContaining(node.selected, surface).filter(
        (slotIndex) => !node.infinitiveOnly || slotIndex === 0,
      );
      if (slotIndexes.length > 0) return { slotIndexes, surfaceToken };
    }
    return surface === node.normalized ? { slotIndexes: [], surfaceToken } : null;
  }

  function findPatternMatchesInOrder(
    pattern,
    orderedNodes,
    text,
    firstOnly = false,
  ) {
    const sentenceTokens = tokenize(text).filter(
      (token) => token.normalized !== "...",
    );
    const found = [];
    if (sentenceTokens.length === 0 || orderedNodes.length === 0) return found;

    const walk = (nodeIndex, sentenceIndex, matches, startToken) => {
      if (nodeIndex >= orderedNodes.length) {
        const visible = matches.filter((match) => {
          if (!match.variable) return true;
          if (
            !match.node.highlightWhenLiteral &&
            !match.node.displayLiteral
          ) {
            return false;
          }
          return (
            match.endToken - match.startToken === 1 &&
            sentenceTokens[match.startToken]?.normalized ===
              match.node.normalized
          );
        });
        if (visible.length === 0) return;
        const start = sentenceTokens[visible[0].startToken].start;
        const end = sentenceTokens[visible[visible.length - 1].endToken - 1].end;
        found.push({
          pattern,
          matches,
          sentenceTokens,
          start,
          end,
          spans: visible.map((match) => ({
            start: sentenceTokens[match.startToken].start,
            end: sentenceTokens[match.endToken - 1].end,
            node: match.node,
            slotIndexes: match.slotIndexes || [],
            surface: text.slice(
              sentenceTokens[match.startToken].start,
              sentenceTokens[match.endToken - 1].end,
            ),
          })),
        });
        return;
      }

      const node = orderedNodes[nodeIndex];
      if (node.type === "wildcard" || node.type === "placeholder") {
        const maximum = Math.min(
          node.maxWords || MAX_PLACEHOLDER_WORDS,
          sentenceTokens.length - sentenceIndex,
        );
        const minimum = node.minWords ?? 1;
        for (let count = minimum; count <= maximum; count++) {
          if (count === 0) {
            walk(
              nodeIndex + 1,
              sentenceIndex,
              [
                ...matches,
                {
                  node,
                  nodeIndex,
                  startToken: sentenceIndex,
                  endToken: sentenceIndex,
                  variable: true,
                },
              ],
              startToken,
            );
            if (firstOnly && found.length) return;
            continue;
          }
          const first = sentenceTokens[sentenceIndex];
          const last = sentenceTokens[sentenceIndex + count - 1];
          if (!first || !last || crossesStrongBoundary(text, first, last)) break;
          if (
            VARIABLE_TOKENS.has(node.normalized) &&
            !isAcceptableVariableTokenFiller(node.normalized, first.normalized)
          ) {
            continue;
          }
          walk(
            nodeIndex + 1,
            sentenceIndex + count,
            [
              ...matches,
              {
                node,
                nodeIndex,
                startToken: sentenceIndex,
                endToken: sentenceIndex + count,
                variable: true,
              },
            ],
            startToken < 0 ? sentenceIndex : startToken,
          );
          if (firstOnly && found.length) return;
        }
        return;
      }

      const maximumGap = nodeIndex === 0 ? sentenceTokens.length : node.maxGapBefore || 0;
      const latest = Math.min(sentenceTokens.length - 1, sentenceIndex + maximumGap);
      for (let index = sentenceIndex; index <= latest; index++) {
        const previous = matches.length
          ? sentenceTokens[matches[matches.length - 1].endToken - 1]
          : null;
        if (previous && crossesStrongBoundary(text, previous, sentenceTokens[index])) {
          break;
        }
        const nodeMatch = matchNode(node, sentenceTokens[index]);
        if (!nodeMatch) continue;
        walk(
          nodeIndex + 1,
          index + 1,
          [
            ...matches,
            {
              node,
              nodeIndex,
              startToken: index,
              endToken: index + 1,
              slotIndexes: nodeMatch.slotIndexes,
            },
          ],
          startToken < 0 ? index : startToken,
        );
        if (firstOnly && found.length) return;
      }
    };

    walk(0, 0, [], -1);
    return found;
  }

  function findPatternMatches(pattern, text, firstOnly = false) {
    const orders = pattern.matchOrders?.length
      ? pattern.matchOrders
      : [pattern.nodes.map((_, index) => index)];
    const matches = [];
    for (const order of orders) {
      matches.push(
        ...findPatternMatchesInOrder(
          pattern,
          order.map((index) => pattern.nodes[index]),
          text,
          firstOnly,
        ),
      );
      if (firstOnly && matches.length > 0) break;
    }
    return matches;
  }

  function createMatcher(analysis) {
    const find = (text) => {
      const matches = analysis.patterns
        .flatMap((pattern) => findPatternMatches(pattern, String(text ?? ""), true))
        .sort((left, right) => left.start - right.start || right.end - left.end);
      return matches[0] || null;
    };
    return Object.freeze({
      analysis,
      test: (text) => Boolean(find(text)),
      find,
      highlight: (text) => {
        const source = String(text ?? "").normalize("NFC");
        const matches = [];
        let cursor = 0;
        while (cursor < source.length) {
          const remaining = source.slice(cursor);
          const match = find(remaining);
          if (!match) break;
          const adjusted = match.spans.map((span) => ({
            ...span,
            start: span.start + cursor,
            end: span.end + cursor,
          }));
          matches.push(...adjusted);
          cursor += Math.max(match.end, 1);
        }
        if (matches.length === 0) return source;
        const ordered = matches
          .sort((left, right) => left.start - right.start || left.end - right.end)
          .filter(
            (span, index, spans) =>
              index === 0 || span.start >= spans[index - 1].end,
          );
        let html = "";
        let position = 0;
        for (const span of ordered) {
          html += source.slice(position, span.start);
          html += `<span style="color: #1f6fb3;">${source.slice(span.start, span.end)}</span>`;
          position = span.end;
        }
        return html + source.slice(position);
      },
    });
  }

  function getDefinitionGapLabel(entry) {
    const match = String(entry?.definisjon || "").match(
      /\((noen|noe|nokon|noko)\)/iu,
    );
    return match ? `[${normalize(match[1])}]` : "";
  }

  function combine(valuesByPosition, limit = 16) {
    let combinations = [""];
    for (const values of valuesByPosition) {
      combinations = combinations.flatMap((prefix) =>
        values.map((value) => (prefix ? `${prefix} ${value}` : value)),
      );
      if (combinations.length > limit) combinations = combinations.slice(0, limit);
    }
    return unique(combinations);
  }

  function renderPatternValues(
    pattern,
    replacements,
    entry,
    nodeOrder = null,
    insertBefore = null,
  ) {
    const positions = [];
    let insertedGap = false;
    const indexes = nodeOrder || pattern.nodes.map((_, index) => index);
    for (const index of indexes) {
      const node = pattern.nodes[index];
      if (node.type === "wildcard") {
        positions.push(["…"]);
        continue;
      }
      if (node.type === "placeholder") {
        positions.push([
          node.displayLiteral ? node.text : `[${node.normalized}]`,
        ]);
        continue;
      }
      if (node.primaryGapWords > 0 && !insertedGap) {
        const gapLabel = getDefinitionGapLabel(entry);
        if (gapLabel) positions.push([gapLabel]);
        insertedGap = true;
      }
      if (insertBefore?.has(index)) positions.push(insertBefore.get(index));
      positions.push(replacements.get(index) || [node.text]);
    }
    return combine(positions);
  }

  function displayValue(values) {
    const accepted = unique(values);
    if (accepted.length === 0) return "–";
    return accepted.length === 1 ? accepted[0] : accepted;
  }

  function createVerbExpressionForms(analysis) {
    const rows = [
      { label: "Infinitive", slot: 0, prefix: "å ", suffix: "" },
      { label: "Present", slot: 1, prefix: "", suffix: "" },
      { label: "Past", slot: 2, prefix: "", suffix: "" },
      { label: "Present perfect", slot: 3, prefix: "har ", suffix: "" },
      { label: "Imperative", slot: 4, prefix: "", suffix: "!" },
    ];
    const forms = rows.map((row) => {
      const values = [];
      for (const pattern of analysis.patterns) {
        const anchors = pattern.nodes
          .map((node, index) => ({ node, index }))
          .filter(({ node }) => node.selected?.wordClass === "verb");
        if (anchors.length === 0) continue;

        // A later verb governed by the authored infinitive marker "å" is not
        // another finite anchor.  Keep it in the infinitive while the head
        // verb moves through the table's tense/mood rows (ha/har/hadde mye å
        // si, never *har mye å sier).
        const independentlyInflected = anchors.filter(
          ({ node }) => !node.infinitiveOnly,
        );
        const primaryAnchor = independentlyInflected[0];
        if (!primaryAnchor) continue;
        const hasLeadingSubject =
          primaryAnchor.index > 0 &&
          !PREVERBAL_ADVERBS.has(pattern.nodes[0]?.normalized);
        if (hasLeadingSubject && [0, 4].includes(row.slot)) continue;
        const replacements = new Map();
        let complete = true;
        for (const { node, index } of anchors) {
          const slot = node.infinitiveOnly ? 0 : row.slot;
          const slotForms = node.selected.paradigm.slots[slot] || [];
          if (slotForms.length === 0) {
            complete = false;
            break;
          }
          replacements.set(index, slotForms);
        }
        if (!complete) continue;
        const finiteReordered =
          [1, 2].includes(row.slot) &&
          PREVERBAL_ADVERBS.has(pattern.nodes[0]?.normalized) &&
          primaryAnchor.index === 1;
        const nodeOrder = finiteReordered
          ? pattern.nodes[2]?.normalized === "seg"
            ? [1, 2, 0, ...pattern.nodes.map((_, index) => index).slice(3)]
            : [1, 0, ...pattern.nodes.map((_, index) => index).slice(2)]
          : null;
        const insertBefore =
          hasLeadingSubject && row.slot === 3
            ? new Map([[primaryAnchor.index, ["har"]]])
            : null;
        for (const value of renderPatternValues(
          pattern,
          replacements,
          analysis.entry,
          nodeOrder,
          insertBefore,
        )) {
          const prefix = insertBefore ? "" : row.prefix;
          values.push(`${prefix}${value}${row.suffix}`);
        }
      }
      return { label: row.label, value: displayValue(values) };
    });
    return { wordClass: "expression", forms };
  }

  function adjectiveSlotForNounGender(gender) {
    if (String(gender).split("-").includes("et")) return 2;
    if (String(gender).split("-").includes("ei")) return 1;
    return 0;
  }

  function createNominalExpressionForms(analysis) {
    const pattern = analysis.patterns.find((candidate) =>
      candidate.nodes.some((node) => node.selected?.wordClass === "noun"),
    );
    if (!pattern) return null;
    const nounNodes = pattern.nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node.selected?.wordClass === "noun");
    if (nounNodes.length === 0) return null;
    const firstPreposition = pattern.nodes.findIndex((node) =>
      PREPOSITIONS.has(node.normalized),
    );
    const beforePreposition = nounNodes.filter(
      ({ index }) => firstPreposition < 0 || index < firstPreposition,
    );
    const head =
      beforePreposition[beforePreposition.length - 1] ||
      nounNodes[nounNodes.length - 1];
    const nounParadigm = head.node.selected.paradigm;
    if (!nounParadigm?.slots?.length) return null;
    const adjectiveNodes = pattern.nodes
      .map((node, index) => ({ node, index }))
      .filter(
        ({ node, index }) =>
          index < head.index && node.selected?.wordClass === "adjective",
      );
    const gender = nounParadigm.gender || "en";
    const article = String(gender).split("-")[0] || "en";
    const rows = [
      { label: "Indefinite singular", nounSlot: 0, adjectiveSlot: adjectiveSlotForNounGender(gender), prefix: article },
      { label: "Definite singular", nounSlot: 1, adjectiveSlot: 3, prefix: article === "et" ? "det" : "den" },
      { label: "Indefinite plural", nounSlot: 2, adjectiveSlot: 4, prefix: "" },
      { label: "Definite plural", nounSlot: 3, adjectiveSlot: 4, prefix: "de" },
    ];
    const leadingDeterminers = new Set(["en", "ei", "et", "den", "det", "de"]);
    const forms = rows.map((row) => {
      const replacements = new Map();
      replacements.set(head.index, nounParadigm.slots[row.nounSlot] || []);
      for (const adjective of adjectiveNodes) {
        replacements.set(
          adjective.index,
          adjective.node.selected.paradigm.slots[row.adjectiveSlot] || [],
        );
      }
      let values = renderPatternValues(pattern, replacements, analysis.entry);
      values = values.map((value) => {
        const words = value.split(" ");
        if (leadingDeterminers.has(normalize(words[0]))) words.shift();
        return [row.prefix, words.join(" ")].filter(Boolean).join(" ");
      });
      return { label: row.label, value: displayValue(values) };
    });
    return { wordClass: "expression", forms };
  }

  function createAdjectiveExpressionForms(analysis) {
    const labels = [
      "Masculine",
      "Feminine",
      "Neuter",
      "Definite singular",
      "Plural",
      "Comparative",
      "Superlative",
      "Definite superlative",
    ];
    return {
      wordClass: "expression",
      forms: labels.map((label, slot) => {
        const values = [];
        for (const pattern of analysis.patterns) {
          const anchors = pattern.nodes
            .map((node, index) => ({ node, index }))
            .filter(({ node }) => node.selected?.wordClass === "adjective");
          if (anchors.length === 0) continue;
          const replacements = new Map();
          for (const { node, index } of anchors) {
            replacements.set(index, node.selected.paradigm.slots[slot] || []);
          }
          values.push(...renderPatternValues(pattern, replacements, analysis.entry));
        }
        return { label, value: displayValue(values) };
      }),
    };
  }

  function getSourceMetadata(analysis) {
    const selected = analysis.patterns.flatMap((pattern) =>
      pattern.nodes.map((node) => node.selected).filter(Boolean),
    );
    if (selected.length === 0) {
      return {
        source: "dictionary",
        sourceType: "expression-fixed",
      };
    }
    const estimated = selected.some(
      (candidate) =>
        candidate.estimated ||
        candidate.paradigm?.sourceType === "dictionary-only",
    );
    return {
      expressionHeads: unique(selected.map((candidate) => candidate.lemma)),
      isAuthoritative: !estimated,
      source: estimated ? "dictionary" : "Norsk Ordbank component paradigms",
      sourceType: estimated ? "expression-estimated" : "expression-ordbank",
    };
  }

  function createForms(analysis) {
    const selectedClasses = new Set(
      analysis.patterns.flatMap((pattern) =>
        pattern.nodes
          .map((node) => node.selected?.wordClass)
          .filter(Boolean),
      ),
    );
    let result;
    const hasIndependentVerb = analysis.patterns.some((pattern) =>
      pattern.nodes.some(
        (node) =>
          node.selected?.wordClass === "verb" && !node.infinitiveOnly,
      ),
    );
    if (hasIndependentVerb) {
      result = createVerbExpressionForms(analysis);
    } else if (selectedClasses.has("noun")) {
      result = createNominalExpressionForms(analysis);
    } else if (selectedClasses.has("adjective")) {
      result = createAdjectiveExpressionForms(analysis);
    }
    result ||= {
      wordClass: "expression",
      forms: [
        {
          label: "Fixed expression",
          value: displayValue(analysis.patterns.map((pattern) => pattern.display)),
        },
      ],
    };
    return { ...result, ...getSourceMetadata(analysis) };
  }

  function createSearchAlternatives(patterns) {
    return patterns.map((pattern) =>
      pattern.nodes
        .filter((node) => node.type === "lexeme")
        .map((node) =>
          node.selected
            ? node.infinitiveOnly
              ? unique(node.selected.paradigm?.slots?.[0] || []).map(normalize)
              : node.selected.wordClass === "noun"
              ? unique(
                  flattenParadigm(node.selected.paradigm).flatMap((form) => [
                    form,
                    /[sxz]$/iu.test(form) ? `${form}'` : `${form}s`,
                  ]),
                )
              : flattenParadigm(node.selected.paradigm)
            : node.reflexive
              ? [...REFLEXIVE_FORMS]
              : node.possessiveForms
                ? [...node.possessiveForms]
                : [node.normalized],
        )
        .filter((group) => group.length > 0),
    );
  }

  function needsReverseAnalysis(patterns) {
    return patterns.some((pattern) => {
      if (!pattern.alignment) return true;
      const selected = pattern.nodes.filter((node) => node.selected);
      if (selected.length === 0) {
        return (
          ["den", "det", "de"].includes(pattern.nodes[0]?.normalized) ||
          pattern.nodes.some((node) => node.type === "placeholder") ||
          pattern.nodes.some(
            (node) =>
              node.normalized === "seg" ||
              POSSESSIVE_FORMS.has(node.normalized),
          )
        );
      }
      const nounIndex = pattern.nodes.findIndex(
        (node) => node.selected?.wordClass === "noun",
      );
      return (
        nounIndex > 0 &&
        pattern.nodes
          .slice(0, nounIndex)
          .some(
            (node) =>
              node.type === "lexeme" &&
              !node.selected &&
              node.candidates.length === 0,
          )
      );
    });
  }

  async function compile(entry) {
    await window.Inflections?.preload?.();
    let patterns = [];
    for (const variant of getVariants(entry)) {
      const pattern = await buildPattern(variant, entry?.eksempel || "");
      if (pattern.nodes.length > 0) patterns.push(pattern);
    }
    if (needsReverseAnalysis(patterns)) {
      patterns = [];
      for (const variant of getVariants(entry)) {
        const pattern = await buildPattern(
          variant,
          entry?.eksempel || "",
          true,
        );
        if (pattern.nodes.length > 0) patterns.push(pattern);
      }
    }
    propagateSelections(patterns);
    applyVerbGovernment(patterns);
    const analysis = {
      entry,
      patterns,
      isExpression: true,
    };
    analysis.matcher = createMatcher(analysis);
    analysis.searchAlternatives = createSearchAlternatives(patterns);
    analysis.forms = createForms(analysis);
    return Object.freeze(analysis);
  }

  function getCacheKey(entry) {
    return [entry?.ord, entry?.gender, entry?.definisjon, entry?.eksempel]
      .map((value) => String(value ?? "").normalize("NFC"))
      .join("\u001f");
  }

  function getAnalysis(entry) {
    if (!entry?.ord || WordClass.getWordClass(entry.gender) !== "expression") {
      return Promise.resolve(null);
    }
    if (typeof entry === "object") {
      let pending = cache.get(entry);
      if (!pending) {
        pending = compile(entry);
        cache.set(entry, pending);
      }
      return pending;
    }
    const key = getCacheKey(entry);
    if (!primitiveCache.has(key)) primitiveCache.set(key, compile(entry));
    return primitiveCache.get(key);
  }

  async function getForms(entry) {
    return (await getAnalysis(entry))?.forms || null;
  }

  window.ExpressionPatterns = Object.freeze({
    createMatcher,
    getAnalysis,
    getForms,
    getVariants,
    tokenize,
  });
})();
