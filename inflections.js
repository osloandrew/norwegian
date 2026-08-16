// Generates a best-effort Norwegian inflection table (noun declension, verb
// conjugation, adjective comparison) for the "Word forms" section on the
// single-word definition page. This is NOT a full morphological analyzer —
// Norwegian has real, lexically-determined irregularity (which weak-verb
// class a verb belongs to, whether a neuter noun takes a zero or -er
// plural) that no spelling rule captures perfectly. The curated exceptions
// tables below cover the most common irregulars by hand; everything else
// falls back to the regular-pattern rules and can be corrected over time
// via the "Flag these forms" link (see openWordCardFeedbackDialog in
// scripts.js), which is the intended correction loop for whatever this
// gets wrong.
(function () {
  "use strict";

  // ---- Regular-pattern rule engine ----

  function computeNounStem(word) {
    return word.toLowerCase().endsWith("e") ? word.slice(0, -1) : word;
  }

  // Rough syllable count via vowel-group runs — good enough to tell
  // monosyllabic from polysyllabic for the neuter-plural heuristic below.
  function countVowelGroups(word) {
    const matches = word.toLowerCase().match(/[aeiouyæøå]+/g);
    return matches ? matches.length : 0;
  }

  function ruleBasedNounForms(article, base) {
    const stem = computeNounStem(base);

    if (article === "en") {
      // Agent nouns ending in unstressed "-er" (baker, lærer, arbeider...)
      // don't double up the ending — plural is "-e", not "-er" (which
      // would give the awkward "bakerer"), and the definite plural drops
      // straight to "-ne" off that already-"-e"-ending plural.
      if (base.toLowerCase().endsWith("er")) {
        return {
          indefiniteSingular: base,
          definiteSingular: base + "en",
          indefinitePlural: base + "e",
          definitePlural: base + "ne",
        };
      }
      // "-el" nouns (rubel, regel, sykkel...) drop that "e" in the
      // plural — rubler/rublene, not "rubeler"/"rubelene" — but the
      // definite singular is unaffected (rubelen). Doesn't cover cases
      // that also simplify a doubled consonant (sykkel → sykler) — those
      // are curated exceptions instead.
      if (base.toLowerCase().endsWith("el") && base.length > 3) {
        const syncopatedStem = base.slice(0, -2) + "l";
        return {
          indefiniteSingular: base,
          definiteSingular: base + "en",
          indefinitePlural: syncopatedStem + "er",
          definitePlural: syncopatedStem + "ene",
        };
      }
      return {
        indefiniteSingular: base,
        definiteSingular: stem + "en",
        indefinitePlural: stem + "er",
        definitePlural: stem + "ene",
      };
    }
    if (article === "ei") {
      return {
        indefiniteSingular: base,
        // Bokmål also accepts the masculine/common-gender "-en" ending as
        // an alternate to the feminine "-a" for ei-nouns.
        definiteSingular: [stem + "a", stem + "en"],
        indefinitePlural: stem + "er",
        definitePlural: stem + "ene",
      };
    }
    if (article === "et") {
      // One-syllable neuters are typically identical in the indefinite
      // singular and plural (hus/hus, år/år, bord/bord); longer ones
      // usually take -er (bilde → bilder). Syllable count is only an
      // approximation — Norwegian neuter plurals are lexically
      // determined, with real exceptions on both sides (e.g. "sted" is
      // one syllable but takes -er — see IRREGULAR_NOUNS).
      const takesZeroPlural = countVowelGroups(base) <= 1;
      const indefinitePlural = takesZeroPlural ? base : stem + "er";
      // Monosyllabic neuters with a zero-marked plural also commonly
      // accept an alternate "-a" definite plural (husene/husa, barn →
      // barnene/barna) alongside the standard "-ene" form.
      const definitePlural = takesZeroPlural
        ? [stem + "ene", stem + "a"]
        : stem + "ene";
      return {
        indefiniteSingular: base,
        definiteSingular: stem + "et",
        indefinitePlural,
        definitePlural,
      };
    }
    return null;
  }

  function ruleBasedAdjectiveForms(base) {
    const lower = base.toLowerCase();

    // Adjectives formed with the productive "-ete" suffix (klumpete,
    // flekkete, rutete...) are indeclinable — no neuter/plural ending,
    // and comparison is periphrastic ("mer klumpete", "mest klumpete")
    // rather than suffixed.
    if (lower.endsWith("ete")) {
      return {
        neuter: base,
        pluralDefinite: base,
        comparative: "mer " + base,
        superlative: "mest " + base,
      };
    }

    // Present participles used as adjectives (kvelende, skjelvende,
    // interessant-adjacent forms in "-ende") are invariant — one form for
    // every gender/number, and periphrastic comparison if any.
    if (lower.endsWith("ende")) {
      return {
        neuter: base,
        pluralDefinite: base,
        comparative: "mer " + base,
        superlative: "mest " + base,
      };
    }

    // Latinate "-iv" adjectives (informativ, aktiv, kreativ...) take
    // regular neuter/plural endings but compare periphrastically — "mer
    // informativ", not "informativere".
    if (lower.endsWith("iv")) {
      return {
        neuter: base + "t",
        pluralDefinite: base + "e",
        comparative: "mer " + base,
        superlative: "mest " + base,
      };
    }

    // Latinate "-ell" adjectives (aktuell, skulpturell, kulturell...) drop
    // one "l" in the neuter — aktuelt, not "aktuellt" — and, like -ete,
    // compare periphrastically rather than with a suffix.
    if (lower.endsWith("ell")) {
      return {
        neuter: base.slice(0, -1) + "t",
        pluralDefinite: base + "e",
        comparative: "mer " + base,
        superlative: "mest " + base,
      };
    }

    // Adjectives ending in unstressed "-er" (snever, mager...) drop that
    // "e" before any ending that starts with a vowel — snever → snevre,
    // not "snevere". Neuter is unaffected (snevert). Doesn't cover cases
    // that also simplify a doubled consonant (vakker → vakre, sikker →
    // sikre) — those are curated exceptions instead.
    if (lower.endsWith("er") && base.length > 3) {
      const syncopatedStem = base.slice(0, -2);
      return {
        neuter: base + "t",
        pluralDefinite: syncopatedStem + "re",
        comparative: syncopatedStem + "rere",
        superlative: syncopatedStem + "rest",
      };
    }

    // Adjectives ending in unstressed "-en" (leken, sulten, våken,
    // naken...) drop that "e" the same way — leken → lekne, not
    // "lekene". Neuter is unaffected (lekent). A handful of "-en"
    // adjectives are irregular beyond this (egen → eget, not "egent") —
    // those go in IRREGULAR_ADJECTIVES instead.
    if (lower.endsWith("en") && base.length > 3) {
      const syncopatedStem = base.slice(0, -2);
      return {
        neuter: base + "t",
        pluralDefinite: syncopatedStem + "ne",
        comparative: syncopatedStem + "nere",
        superlative: syncopatedStem + "nest",
      };
    }

    const endsIgOrSk = lower.endsWith("ig") || lower.endsWith("sk");
    const endsInT = lower.endsWith("t");
    const endsE = lower.endsWith("e");
    const stem = endsE ? base.slice(0, -1) : base;

    // -ig/-sk adjectives, and anything already ending in "t", don't take a
    // second neuter "-t" (hyggelig → hyggelig, svart → svart).
    const neuter = endsIgOrSk || endsInT ? base : base + "t";
    const pluralDefinite = endsE ? base : base + "e";
    const comparative = stem + "ere";
    // -ig adjectives drop the linking "e" in the superlative
    // (hyggelig → hyggeligst, not hyggeligest).
    const superlative = endsIgOrSk ? base + "st" : stem + "est";

    return { neuter, pluralDefinite, comparative, superlative };
  }

  const NORWEGIAN_VOWELS = "aeiouyæøå";

  // A handful of consonant+e verbs (sikre, vandre, fjetre...) reduce to a
  // stem ending in [consonant]+r when the imperative drops the final -e —
  // a cluster many speakers find awkward as a word-final sound. For those,
  // the unreduced infinitive is also accepted as the imperative.
  function endsInConsonantR(word) {
    if (!word.endsWith("r") || word.length < 2) return false;
    return !NORWEGIAN_VOWELS.includes(word[word.length - 2]);
  }

  function computeImperative(stem, fullInfinitive) {
    return endsInConsonantR(stem) ? [stem, fullInfinitive] : stem;
  }

  function ruleBasedVerbForms(base) {
    const lower = base.toLowerCase();

    if (!lower.endsWith("e")) {
      // Rare: infinitives ending in a stressed vowel (bo, gå, stå, snu...)
      // follow a different weak-verb class. Most common ones are in
      // IRREGULAR_VERBS below; this is a rough fallback only.
      return {
        present: base + "r",
        past: base + "dde",
        participle: base + "dd",
        imperative: base,
      };
    }

    const stem = base.slice(0, -1);

    // "-ere" verbs — mostly international/Latinate loanwords (praktisere,
    // studere, organisere, diskutere...) — are a large, reliably regular
    // class distinct from the standard weak-verb pattern: -erer/-erte/
    // -ert rather than -er/-et/-et.
    if (lower.endsWith("ere")) {
      return {
        present: stem + "er",
        past: stem + "te",
        participle: stem + "t",
        imperative: computeImperative(stem, base),
      };
    }

    return {
      present: stem + "er",
      // The standard -et past/perfect for this class also commonly
      // accepts a colloquial/traditional-Bokmål "-a" alternate
      // (snakket/snakka, har snakket/har snakka).
      past: [stem + "et", stem + "a"],
      participle: [stem + "et", stem + "a"],
      imperative: computeImperative(stem, base),
    };
  }

  // ---- Curated exceptions (hand-verified against standard Norwegian
  // grammar references, not rule-derived) ----

  const IRREGULAR_NOUNS = {
    // lemma: [definite singular, indefinite plural, definite plural]
    // "-er" words with syncope (the medial "e" drops before a vowel-
    // initial ending) rather than the regular agent-noun "-e" plural —
    // sommer → somre, not "sommere".
    sommer: ["sommeren", "somre", "somrene"],
    // Syncope + degemination together: sykler, not "sykkler".
    sykkel: ["sykkelen", "sykler", "syklene"],
    vinter: ["vinteren", "vintre", "vintrene"],
    finger: ["fingeren", "fingre", "fingrene"],
    mann: ["mannen", "menn", "mennene"],
    tre: ["treet", "trær", "trærne"],
    øye: ["øyet", "øyne", "øynene"],
    kne: ["kneet", "knær", "knærne"],
    bok: ["boka", "bøker", "bøkene"],
    fot: ["foten", "føtter", "føttene"],
    rot: ["roten", "røtter", "røttene"],
    kraft: ["kraften", "krefter", "kreftene"],
    // Regular in its own right — pinned here only to stop the 3-letter
    // compound-head search below from matching it against "mor" (mother)
    // and producing "humødre"/"humødrene".
    humor: ["humoren", "humorer", "humorene"],
    // Short vowel + single consonant doubles before a vowel-initial
    // ending (same phenomenon as ny → nytt): rommet, not "romet". Two
    // unrelated words share this spelling — "room" (et) and "rum" the
    // drink (en) — so this is keyed by article rather than a flat array.
    rom: {
      et: ["rommet", "rom", ["rommene", "romma"]],
      en: ["rommen", "rommer", "rommene"],
    },
    hånd: ["hånden", "hender", "hendene"],
    tann: ["tannen", "tenner", "tennene"],
    mus: ["musen", "mus", "musene"],
    far: ["faren", "fedre", "fedrene"],
    mor: ["moren", "mødre", "mødrene"],
    bror: ["broren", "brødre", "brødrene"],
    datter: ["datteren", "døtre", "døtrene"],
    ting: ["tingen", "ting", "tingene"],
    sko: ["skoen", "sko", "skoene"],
    sted: ["stedet", "steder", "stedene"],
    natt: ["natten", "netter", "nettene"],
    ku: ["kua", "kyr", "kyrne"],
  };

  const IRREGULAR_ADJECTIVES = {
    // lemma: [neuter, plural/definite, comparative, superlative]
    // Doubled-consonant "-er" adjectives simplify the consonant as well
    // as dropping the "e" (vakker → vakre, not "vakkre").
    vakker: ["vakkert", "vakre", "vakrere", "vakrest"],
    // Neuter drops the "n" instead of just adding "t" (eget, not "egent").
    egen: ["eget", "egne", "–", "–"],
    sikker: ["sikkert", "sikre", "sikrere", "sikrest"],
    liten: ["lite", "små", "mindre", "minst"],
    stor: ["stort", "store", "større", "størst"],
    god: ["godt", "gode", "bedre", "best"],
    bra: ["bra", "bra", "bedre", "best"],
    dårlig: ["dårlig", "dårlige", "verre", "verst"],
    gammel: ["gammelt", "gamle", "eldre", "eldst"],
    mange: ["mange", "mange", "flere", "flest"],
    ung: ["ungt", "unge", "yngre", "yngst"],
    tung: ["tungt", "tunge", "tyngre", "tyngst"],
    lang: ["langt", "lange", "lengre", "lengst"],
    ny: ["nytt", "nye", "nyere", "nyest"],
    blå: ["blått", "blå", "blåere", "blåest"],
    grå: ["grått", "grå", "gråere", "gråest"],
    fri: ["fritt", "frie", "friere", "friest"],
    lett: ["lett", "lette", "lettere", "lettest"],
    hvit: ["hvitt", "hvite", "hvitere", "hvitest"],
  };

  const IRREGULAR_VERBS = {
    // lemma: [present, past, perfect participle, imperative]
    være: ["er", "var", "vært", "vær"],
    ha: ["har", "hadde", "hatt", "ha"],
    gå: ["går", "gikk", "gått", "gå"],
    gjøre: ["gjør", "gjorde", "gjort", "gjør"],
    si: ["sier", "sa", "sagt", "si"],
    ta: ["tar", "tok", "tatt", "ta"],
    komme: ["kommer", "kom", "kommet", "kom"],
    se: ["ser", "så", "sett", "se"],
    gi: ["gir", "ga", "gitt", "gi"],
    få: ["får", "fikk", "fått", "få"],
    vite: ["vet", "visste", "visst", "vit"],
    bli: ["blir", "ble", "blitt", "bli"],
    stå: ["står", "sto", "stått", "stå"],
    dra: ["drar", "dro", "dratt", "dra"],
    finne: ["finner", "fant", "funnet", "finn"],
    sette: ["setter", "satte", "satt", "sett"],
    legge: ["legger", "la", "lagt", "legg"],
    ligge: ["ligger", "lå", "ligget", "ligg"],
    sitte: ["sitter", "satt", "sittet", "sitt"],
    spørre: ["spør", "spurte", "spurt", "spør"],
    sove: ["sover", "sov", "sovet", "sov"],
    holde: ["holder", "holdt", "holdt", "hold"],
    skrive: ["skriver", "skrev", "skrevet", "skriv"],
    lese: ["leser", "leste", "lest", "les"],
    kjøre: ["kjører", "kjørte", "kjørt", "kjør"],
    høre: ["hører", "hørte", "hørt", "hør"],
    lære: ["lærer", "lærte", "lært", "lær"],
    spise: ["spiser", "spiste", "spist", "spis"],
    reise: ["reiser", "reiste", "reist", "reis"],
    prøve: ["prøver", "prøvde", "prøvd", "prøv"],
    bruke: ["bruker", "brukte", "brukt", "bruk"],
    svare: ["svarer", "svarte", "svart", "svar"],
    vise: ["viser", "viste", "vist", "vis"],
    følge: ["følger", "fulgte", "fulgt", "følg"],
    fortelle: ["forteller", "fortalte", "fortalt", "fortell"],
    tenke: ["tenker", "tenkte", "tenkt", "tenk"],
    trenge: ["trenger", "trengte", "trengt", "treng"],
    drikke: ["drikker", "drakk", "drukket", "drikk"],
    skjære: ["skjærer", "skar", "skåret", "skjær"],
    bære: ["bærer", "bar", "båret", "bær"],
    bryte: ["bryter", "brøt", "brutt", "bryt"],
    dø: ["dør", "døde", "dødd", "dø"],
    forstå: ["forstår", "forsto", "forstått", "forstå"],
    hete: ["heter", "het", "hett", "het"],
    kunne: ["kan", "kunne", "kunnet", "–"],
    ville: ["vil", "ville", "villet", "–"],
    skulle: ["skal", "skulle", "skullet", "–"],
    måtte: ["må", "måtte", "måttet", "–"],
    burde: ["bør", "burde", "burdet", "–"],
    tørre: ["tør", "turte", "turt", "tør"],
    la: ["lar", "lot", "latt", "la"],
    treffe: ["treffer", "traff", "truffet", "treff"],
    rekke: ["rekker", "rakk", "rukket", "rekk"],
    bety: ["betyr", "betydde", "betydd", "bety"],
    selge: ["selger", "solgte", "solgt", "selg"],
    hjelpe: ["hjelper", "hjalp", "hjulpet", "hjelp"],
    slippe: ["slipper", "slapp", "sluppet", "slipp"],
    slite: ["sliter", "slet", "slitt", "slit"],
    stjele: ["stjeler", "stjal", "stjålet", "stjel"],
    synge: ["synger", "sang", "sunget", "syng"],
    vinne: ["vinner", "vant", "vunnet", "vinn"],
    trekke: ["trekker", "trakk", "trukket", "trekk"],
    rive: ["river", "rev", "revet", "riv"],
    skyte: ["skyter", "skjøt", "skutt", "skyt"],
    slå: ["slår", "slo", "slått", "slå"],
    sy: ["syr", "sydde", "sydd", "sy"],
    bo: ["bor", "bodde", "bodd", "bo"],
    tro: ["tror", "trodde", "trodd", "tro"],
    snu: ["snur", "snudde", "snudd", "snu"],
    leve: ["lever", "levde", "levd", "lev"],
    glemme: ["glemmer", "glemte", "glemt", "glem"],
    sende: ["sender", "sendte", "sendt", "send"],
    stenge: ["stenger", "stengte", "stengt", "steng"],
    kjenne: ["kjenner", "kjente", "kjent", "kjenn"],
    brenne: ["brenner", "brant", "brent", "brenn"],
    renne: ["renner", "rant", "rent", "renn"],
    rope: ["roper", "ropte", "ropt", "rop"],
  };

  // ---- Public API ----

  function extractLemma(entry) {
    return String(entry.ord ?? "")
      .split(",")[0]
      .trim();
  }

  function extractNounArticles(entry) {
    // By render time entry.gender has already been formatted to
    // "noun - en" (see WordClass.formatWordClassLabel) — strip that
    // prefix back off to get the raw article token(s). Words with more
    // than one listed gender (en-et, en-ei-et...) get every valid token
    // back, so their forms can be computed and merged per-article below.
    const stripped = WordClass.stripNounPrefix(entry.gender);
    return stripped
      .split("-")
      .filter((token) => token === "en" || token === "et" || token === "ei");
  }

  // A form's underlying value may be a single string or an array of
  // accepted alternates — apply a transform (adding a prefix for a
  // resolved compound, or a "har "/"!" decoration) across either shape.
  function mapFormValue(value, fn) {
    return Array.isArray(value) ? value.map(fn) : fn(value);
  }

  // Reattaches a compound's removed prefix to a head word's form —
  // except periphrastic comparatives/superlatives ("mer X", "mest X",
  // from the -ete/-ell/-iv adjective classes), where the prefix belongs
  // on the adjective itself, not glued onto the front of "mer"/"mest"
  // ("inmer formativ" would be wrong; "mer informativ" is right).
  function applyCompoundPrefix(prefix, value) {
    if (value.startsWith("mer ")) return "mer " + prefix + value.slice(4);
    if (value.startsWith("mest ")) return "mest " + prefix + value.slice(5);
    return prefix + value;
  }

  // Flattens a list of single-values-or-alternate-arrays into one
  // deduplicated list, collapsing back to a single value when everything
  // turned out identical (e.g. an en-ei noun's plural is usually the same
  // regardless of which gender computed it).
  function mergeAlternates(values) {
    const merged = [];
    values.forEach((value) => {
      const list = Array.isArray(value) ? value : [value];
      list.forEach((item) => {
        if (item !== undefined && item !== null && !merged.includes(item)) {
          merged.push(item);
        }
      });
    });
    return merged.length <= 1 ? merged[0] : merged;
  }

  function resolveNounForms(article, lemma) {
    const lowerLemma = lemma.toLowerCase();
    const rawException = IRREGULAR_NOUNS[lowerLemma];
    // Most entries are a flat [defSg, indefPl, defPl] array that applies
    // regardless of article. A few lemmas are genuine homographs with a
    // different gender per meaning (rom = "room" (et) vs. "rum" the
    // drink (en)) — those are keyed by article instead.
    const exception =
      rawException && !Array.isArray(rawException)
        ? rawException[article]
        : rawException;
    const computed = exception
      ? {
          indefiniteSingular: lemma,
          definiteSingular: exception[0],
          indefinitePlural: exception[1],
          definitePlural: exception[2],
        }
      : ruleBasedNounForms(article, lemma);
    if (computed && article === "ei" && exception) {
      // The masculine "-en" alternate applies to ANY ei-noun, including
      // curated exceptions whose irregularity lies elsewhere (e.g. "bok"
      // is only irregular in the plural — bøker/bøkene — not in how the
      // optional masculine-pattern singular is formed).
      computed.definiteSingular = [
        computed.definiteSingular,
        computeNounStem(lemma) + "en",
      ];
    }
    return { computed, isException: Boolean(exception) };
  }

  function resolveAdjectiveForms(lemma) {
    const exception = IRREGULAR_ADJECTIVES[lemma.toLowerCase()];
    const computed = exception
      ? {
          neuter: exception[0],
          pluralDefinite: exception[1],
          comparative: exception[2],
          superlative: exception[3],
        }
      : ruleBasedAdjectiveForms(lemma);
    return { computed, isException: Boolean(exception) };
  }

  function resolveVerbForms(lemma) {
    const exception = IRREGULAR_VERBS[lemma.toLowerCase()];
    const computed = exception
      ? {
          present: exception[0],
          past: exception[1],
          participle: exception[2],
          imperative: exception[3],
        }
      : ruleBasedVerbForms(lemma);
    return { computed, isException: Boolean(exception) };
  }

  // Norwegian compounds (allmennspråk, datamus, tilgi...) inherit their
  // inflection from their final component, not from the compound's own
  // (often much longer) shape. If the full word isn't itself a curated
  // exception, look for a shorter dictionary entry — of the same word
  // class, and for nouns the same article — that the word ends with, and
  // borrow that entry's forms with the removed prefix reattached. `results`
  // is scripts.js's parsed dictionary (a plain top-level `let`, so it's
  // resolvable by name from here without a `window.` prefix); this is
  // only ever called from click-time render functions, well after
  // scripts.js has populated it, so its availability is never in question
  // — the `typeof` guard below is just defensive, not load-order-critical.
  function findCompoundHeadEntry(lemma, wordClass, article) {
    if (typeof results === "undefined" || !Array.isArray(results)) {
      return null;
    }
    // 3-letter noun roots (løp, tak, mål, lag...) are extremely
    // productive compound heads in Norwegian (langløp, hustak,
    // fotballmål...), so they're allowed despite occasionally colliding
    // with an unrelated word by coincidence (e.g. "humor" ending in
    // "mor") — those specific collisions get a curated exception instead
    // of raising the threshold and losing genuine compounds.
    const minLength = wordClass === "noun" ? 3 : 2;
    const lowerLemma = lemma.toLowerCase();
    let best = null;

    for (let i = 0; i < results.length; i++) {
      const candidate = results[i];
      if (!candidate || !candidate.ord || !candidate.gender) continue;
      const candidateLemma = String(candidate.ord).split(",")[0].trim().toLowerCase();
      // The removed prefix also needs to be a real word-length chunk, not
      // just one leftover letter — otherwise "åpen" (open) gets treated
      // as a compound of "pen" (pretty), leaving a meaningless "å" prefix.
      if (
        candidateLemma.length < minLength ||
        lowerLemma.length - candidateLemma.length < 2 ||
        !lowerLemma.endsWith(candidateLemma)
      ) {
        continue;
      }

      const candidateGender = WordClass.formatWordClassLabel(candidate.gender);
      if (WordClass.getWordClass(candidateGender) !== wordClass) continue;
      if (wordClass === "noun") {
        const candidateArticle = WordClass.stripNounPrefix(candidateGender).split("-")[0];
        if (candidateArticle !== article) continue;
      }

      if (!best || candidateLemma.length > best.lemma.length) {
        best = { lemma: candidateLemma };
      }
    }

    return best;
  }

  // Proper nouns (Latvia, Oslo, Kari...) aren't inflected — a capitalized
  // headword is a reliable enough signal in this dataset, since every
  // regular dictionary entry (including nationalities-as-adjectives like
  // "latvisk") is lowercase.
  function isProperNoun(lemma) {
    const first = lemma.charAt(0);
    return first !== "" && first === first.toUpperCase() && first !== first.toLowerCase();
  }

  function getForms(entry) {
    if (!entry || !entry.ord || !entry.gender) return null;

    const lemma = extractLemma(entry);
    if (isProperNoun(lemma)) return null;

    const wordClass = WordClass.getWordClass(entry.gender);

    if (wordClass === "noun") {
      const articles = extractNounArticles(entry);
      // Bare "noun" gender (no article on file) — not enough information
      // to guess endings safely.
      if (articles.length === 0) return null;
      const primaryArticle = articles[0];

      let perArticle = articles.map((article) => ({
        article,
        ...resolveNounForms(article, lemma),
      }));
      let isException = perArticle.some((p) => p.isException);

      if (!isException) {
        const head = findCompoundHeadEntry(lemma, "noun", primaryArticle);
        if (head) {
          const prefix = lemma.slice(0, lemma.length - head.lemma.length);
          perArticle = articles.map((article) => {
            const headResolved = resolveNounForms(article, head.lemma);
            return {
              article,
              isException: headResolved.isException,
              computed: {
                indefiniteSingular: lemma,
                definiteSingular: mapFormValue(
                  headResolved.computed.definiteSingular,
                  (v) => applyCompoundPrefix(prefix, v),
                ),
                indefinitePlural: mapFormValue(
                  headResolved.computed.indefinitePlural,
                  (v) => applyCompoundPrefix(prefix, v),
                ),
                definitePlural: mapFormValue(
                  headResolved.computed.definitePlural,
                  (v) => applyCompoundPrefix(prefix, v),
                ),
              },
            };
          });
          isException = perArticle.some((p) => p.isException);
        }
      }

      // Indefinite singular gets one "article lemma" alternate per listed
      // gender, plus (per Bokmål's optional feminine) an "en" alternate
      // whenever "ei" is present, even as the word's only listed gender.
      const indefiniteSingularArticles =
        articles.includes("ei") && !articles.includes("en")
          ? [...articles, "en"]
          : articles;

      return {
        wordClass: "noun",
        isException,
        forms: [
          {
            label: "Indefinite singular",
            value: mergeAlternates(
              indefiniteSingularArticles.map((article) => `${article} ${lemma}`),
            ),
          },
          {
            label: "Definite singular",
            value: mergeAlternates(perArticle.map((p) => p.computed.definiteSingular)),
          },
          {
            label: "Indefinite plural",
            value: mergeAlternates(perArticle.map((p) => p.computed.indefinitePlural)),
          },
          {
            label: "Definite plural",
            value: mergeAlternates(perArticle.map((p) => p.computed.definitePlural)),
          },
        ],
      };
    }

    if (wordClass === "adjective") {
      let { computed, isException } = resolveAdjectiveForms(lemma);
      if (!isException) {
        const head = findCompoundHeadEntry(lemma, "adjective", null);
        if (head) {
          const prefix = lemma.slice(0, lemma.length - head.lemma.length);
          const headResolved = resolveAdjectiveForms(head.lemma);
          computed = {
            neuter: mapFormValue(headResolved.computed.neuter, (v) => applyCompoundPrefix(prefix, v)),
            pluralDefinite: mapFormValue(
              headResolved.computed.pluralDefinite,
              (v) => applyCompoundPrefix(prefix, v),
            ),
            comparative: mapFormValue(
              headResolved.computed.comparative,
              (v) => applyCompoundPrefix(prefix, v),
            ),
            superlative: mapFormValue(
              headResolved.computed.superlative,
              (v) => applyCompoundPrefix(prefix, v),
            ),
          };
          isException = headResolved.isException;
        }
      }

      return {
        wordClass: "adjective",
        isException,
        forms: [
          { label: "Masculine/feminine", value: lemma },
          { label: "Neuter", value: computed.neuter },
          { label: "Plural / definite", value: computed.pluralDefinite },
          { label: "Comparative", value: computed.comparative },
          { label: "Superlative", value: computed.superlative },
        ],
      };
    }

    if (wordClass === "verb") {
      let { computed, isException } = resolveVerbForms(lemma);
      if (!isException) {
        const head = findCompoundHeadEntry(lemma, "verb", null);
        if (head) {
          const prefix = lemma.slice(0, lemma.length - head.lemma.length);
          const headResolved = resolveVerbForms(head.lemma);
          computed = {
            present: mapFormValue(headResolved.computed.present, (v) => applyCompoundPrefix(prefix, v)),
            past: mapFormValue(headResolved.computed.past, (v) => applyCompoundPrefix(prefix, v)),
            participle: mapFormValue(
              headResolved.computed.participle,
              (v) => applyCompoundPrefix(prefix, v),
            ),
            imperative: mapFormValue(
              headResolved.computed.imperative,
              (v) => applyCompoundPrefix(prefix, v),
            ),
          };
          isException = headResolved.isException;
        }
      }

      // Modal verbs (kunne, ville, ...) have no real imperative — stored
      // as "–" and left unsuffixed rather than turned into "–!".
      const imperativeValue = mapFormValue(computed.imperative, (v) =>
        v === "–" ? v : v + "!",
      );

      return {
        wordClass: "verb",
        isException,
        forms: [
          { label: "Infinitive", value: "å " + lemma },
          { label: "Present", value: computed.present },
          { label: "Past (preteritum)", value: computed.past },
          {
            label: "Present perfect",
            value: mapFormValue(computed.participle, (v) => "har " + v),
          },
          { label: "Imperative", value: imperativeValue },
        ],
      };
    }

    return null;
  }

  window.Inflections = Object.freeze({ getForms });
})();
