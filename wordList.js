(function () {
  "use strict";

  // Norwegian alphabetical sorting places æ, ø, and å correctly.
  const norwegianCollator = new Intl.Collator("nb-NO", {
    sensitivity: "base",
    numeric: true,
  });

  function getWordListFilterElements() {
    return {
      typeSelect: document.getElementById("type-select"),
      searchInput: document.getElementById("search-bar"),
      posSelect: document.getElementById("pos-select"),
      cefrSelect: document.getElementById("cefr-select"),
    };
  }

  const WORD_LIST_BATCH_SIZE = 100;
  const MY_WORDS_STORAGE_KEY = "norwegian-dictionary-my-words-v1";
  const WORD_STRENGTH_STORAGE_KEY = "norwegian-dictionary-word-strength-v1";
  const WORD_STRENGTH_MAX = 5;

  let activeWordListEntries = [];
  let renderedWordListCount = 0;
  let wordListBatchIsLoading = false;
  let wordListReturnState = null;
  let myWordsEntryIds = loadMyWordsEntryIds();
  let wordStrengths = loadWordStrengths();
  let activeWordListView = "all";

  /**
   * Convert a value into normalized searchable text.
   */
  function normalizeWordListText(value, locale = "nb-NO") {
    return String(value ?? "")
      .trim()
      .toLocaleLowerCase(locale);
  }

  /**
   * Determine whether an entry matches the selected Word Class.
   * Grammatical-category classification lives in wordClass.js (loaded
   * before this file — see window.WordClass), shared with scripts.js and
   * wordGame.js.
   */
  function wordListEntryMatchesPOS(entry, selectedPOS) {
    return WordClass.matchesWordClass(entry.gender, selectedPOS);
  }

  /**
   * Convert the CSV gender value into a readable Word Class label.
   */
  function getWordListClassLabel(entry) {
    const originalGender = String(entry.gender ?? "").trim();

    if (!originalGender) {
      return "—";
    }

    return WordClass.formatWordClassLabel(originalGender);
  }

  /**
   * Return the URL-compatible word class for an entry.
   */
  function getWordListEntryPOS(entry) {
    return WordClass.stripNounPrefix(entry.gender);
  }

  /**
   * Create a genuine, crawlable URL for a Word List entry.
   */
  function createWordListDefinitionURL(entry) {
    const primaryWord = String(entry.ord ?? "")
      .split(",")[0]
      .trim();

    const entryPOS = getWordListEntryPOS(entry);

    const url = new URL(window.location.origin + window.location.pathname);

    url.searchParams.set("type", "words");

    if (entryPOS) {
      url.searchParams.set("pos", entryPOS);
    }

    if (primaryWord) {
      url.searchParams.set("word", primaryWord);
    }

    return url.href;
  }

  /**
   * Create one table cell.
   */
  function createWordListCell(
    value,
    className,
    mobileLabel,
    { richContent = false } = {},
  ) {
    const cell = document.createElement("td");

    // richContent cells are about to have their real content (an icon,
    // badge, or link) appended by the caller — skip the "—" placeholder
    // rather than setting then immediately discarding it.
    cell.textContent = richContent ? "" : value || "—";
    cell.className = className;
    cell.dataset.label = mobileLabel;

    return cell;
  }

  function getMyWordsEntryId(entry) {
    return [
      entry.ord,
      entry.engelsk,
      getWordListClassLabel(entry),
      entry.definisjon,
    ]
      .map((value) =>
        String(value ?? "")
          .trim()
          .normalize("NFC"),
      )
      .join("\u001f");
  }

  function loadMyWordsEntryIds() {
    try {
      const storedValue = window.localStorage.getItem(MY_WORDS_STORAGE_KEY);

      if (!storedValue) {
        return new Set();
      }

      const parsedValue = JSON.parse(storedValue);
      const entryIds = Array.isArray(parsedValue.entryIds)
        ? parsedValue.entryIds
        : [];

      return new Set(entryIds);
    } catch (error) {
      console.warn("My Words could not be loaded.", error);
      return new Set();
    }
  }

  function saveMyWordsEntryIds({ syncRemote = true } = {}) {
    try {
      window.localStorage.setItem(
        MY_WORDS_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          entryIds: Array.from(myWordsEntryIds),
        }),
      );
    } catch (error) {
      console.warn("My Words could not be saved.", error);
    }

    // Let myWordsAuth.js know My Words changed, so it can sync to Firestore
    // when a user is signed in. syncRemote is false when the change came
    // from a remote merge, to avoid immediately writing it back.
    window.dispatchEvent(
      new CustomEvent("my-words:updated", {
        detail: { entryIds: Array.from(myWordsEntryIds), syncRemote },
      }),
    );
  }

  function replaceMyWordsEntryIds(entryIds) {
    myWordsEntryIds = new Set(entryIds);
    saveMyWordsEntryIds({ syncRemote: false });

    if (activeWordListView === "my") {
      renderWordList();
    }
  }

  function loadWordStrengths() {
    try {
      const storedValue = window.localStorage.getItem(
        WORD_STRENGTH_STORAGE_KEY,
      );

      if (!storedValue) {
        return {};
      }

      const parsedValue = JSON.parse(storedValue);

      return parsedValue.strengths && typeof parsedValue.strengths === "object"
        ? parsedValue.strengths
        : {};
    } catch (error) {
      console.warn("Word strength could not be loaded.", error);
      return {};
    }
  }

  function saveWordStrengths({ syncRemote = true } = {}) {
    try {
      window.localStorage.setItem(
        WORD_STRENGTH_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          strengths: wordStrengths,
        }),
      );
    } catch (error) {
      console.warn("Word strength could not be saved.", error);
    }

    // Let myWordsAuth.js know word strength changed, so it can sync to
    // Firestore when a user is signed in. syncRemote is false when the
    // change came from a remote merge, to avoid immediately writing it back.
    window.dispatchEvent(
      new CustomEvent("word-strength:updated", {
        detail: { strengths: { ...wordStrengths }, syncRemote },
      }),
    );
  }

  function replaceWordStrengths(strengths) {
    wordStrengths = { ...strengths };
    saveWordStrengths({ syncRemote: false });

    const typeSelect = document.getElementById("type-select");

    if (typeSelect?.value === "word-list") {
      renderWordList();
    }
  }

  function recordWordStrengthResult(entry, isCorrect) {
    const resolvedEntry = resolveMyWordsEntry(entry);

    if (!resolvedEntry) {
      return;
    }

    const entryId = getMyWordsEntryId(resolvedEntry);
    const currentValue = wordStrengths[entryId] ?? 0;

    wordStrengths[entryId] = Math.min(
      WORD_STRENGTH_MAX,
      Math.max(0, currentValue + (isCorrect ? 1 : -1)),
    );

    saveWordStrengths();
  }

  function toggleMyWordsEntry(entry) {
    const entryId = getMyWordsEntryId(entry);

    if (myWordsEntryIds.has(entryId)) {
      myWordsEntryIds.delete(entryId);
    } else {
      myWordsEntryIds.add(entryId);
    }

    saveMyWordsEntryIds();

    return entryId;
  }

  function updateMyWordsButton(button, entryId, word) {
    const isSaved = myWordsEntryIds.has(entryId);
    const icon = button.querySelector("i");
    const action = isSaved ? "Remove" : "Add";
    const destination = isSaved ? "from My Words" : "to My Words";

    button.classList.toggle("is-saved", isSaved);
    button.setAttribute("aria-pressed", String(isSaved));
    button.setAttribute("aria-label", `${action} ${word} ${destination}`);
    button.title = `${action} ${word} ${destination}`;

    icon.className = `${isSaved ? "fas" : "far"} fa-star`;
  }

  function createMyWordsCell(entry) {
    const cell = createWordListCell("", "word-list-favorite", "My Words", {
      richContent: true,
    });

    const button = document.createElement("button");
    const icon = document.createElement("i");
    const entryId = getMyWordsEntryId(entry);
    const word = String(entry.ord ?? "").trim();

    button.type = "button";
    button.className = "word-list-favorite-button";
    button.setAttribute("aria-pressed", "false");

    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);

    updateMyWordsButton(button, entryId, word);

    button.addEventListener("click", (event) => {
      // Do not open the definition when clicking the star.
      event.stopPropagation();

      toggleMyWordsEntry(entry);
      updateMyWordsButton(button, entryId, word);
      if (activeWordListView === "my") {
        renderWordList();
      }
    });

    button.addEventListener("keydown", (event) => {
      // Prevent the event from reaching the row's keyboard handler.
      event.stopPropagation();
    });

    cell.appendChild(button);

    return cell;
  }

  function createWordStrengthCell(entry) {
    const cell = createWordListCell("", "word-list-strength", "Strength", {
      richContent: true,
    });

    const entryId = getMyWordsEntryId(entry);
    const strengthValue = wordStrengths[entryId];

    if (typeof strengthValue !== "number") {
      cell.textContent = "—";
      return cell;
    }

    const meter = document.createElement("span");
    meter.className = "word-strength-meter";
    meter.setAttribute(
      "aria-label",
      `Strength: ${strengthValue} out of ${WORD_STRENGTH_MAX}`,
    );

    for (let position = 0; position < WORD_STRENGTH_MAX; position++) {
      const dot = document.createElement("i");
      const isFilled = position < strengthValue;

      dot.className = `word-strength-dot ${
        isFilled ? "fa-solid" : "fa-regular"
      } fa-circle`;
      dot.setAttribute("aria-hidden", "true");
      meter.appendChild(dot);
    }

    cell.appendChild(meter);

    return cell;
  }

  function openWordList(view) {
    const { typeSelect, searchInput, posSelect, cefrSelect } =
      getWordListFilterElements();

    if (!typeSelect) {
      return;
    }

    activeWordListView = view === "my" ? "my" : "all";

    if (searchInput) {
      searchInput.value = "";
    }

    if (posSelect) {
      posSelect.value = "";
    }

    if (cefrSelect) {
      cefrSelect.value = "";
    }

    typeSelect.value = "word-list";
    handleTypeChange("word-list");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function goToAllWords() {
    openWordList("all");
  }

  function goToMyWords() {
    openWordList("my");
  }

  // getSavedWordStudyEntries() runs once per word-game question (see
  // wordGame.js's My Words weighting), so rebuilding an entryId->entry map
  // over the entire ~29,000-word dictionary on every call was a real,
  // measurable cost regardless of how many words were actually saved.
  // results is only ever assigned once (at initial CSV load), so this
  // index is cached and only rebuilt if that reference ever changes.
  let entriesByIdCache = null;
  let entriesByIdCacheSource = null;

  function getEntriesByIdIndex() {
    if (entriesByIdCacheSource !== results) {
      entriesByIdCache = new Map(
        results.map((entry) => [getMyWordsEntryId(entry), entry]),
      );
      entriesByIdCacheSource = results;
    }

    return entriesByIdCache;
  }

  function getSavedWordStudyEntries() {
    const entriesById = getEntriesByIdIndex();

    return Array.from(myWordsEntryIds)
      .map((entryId) => {
        const entry = entriesById.get(entryId);

        return entry ? { entryId, entry } : null;
      })
      .filter(Boolean);
  }

  function attachSingleResultMyWordsControls(entry) {
    const card = resultsContainer.querySelector(
      ".definition.single-result-definition",
    );

    if (!card || !entry) {
      return;
    }

    // Prevent duplicate controls if the definition is rendered again.
    card.querySelector(".single-result-my-words-controls")?.remove();

    const controls = document.createElement("div");
    controls.className = "single-result-my-words-controls";

    const starButton = document.createElement("button");
    const starIcon = document.createElement("i");
    const entryId = getMyWordsEntryId(entry);
    const word = String(entry.ord ?? "").trim();

    starButton.type = "button";
    starButton.className =
      "word-list-favorite-button single-result-my-words-star";

    starIcon.setAttribute("aria-hidden", "true");
    starButton.appendChild(starIcon);

    updateMyWordsButton(starButton, entryId, word);

    starButton.addEventListener("click", (event) => {
      // The definition card itself has a click handler.
      event.stopPropagation();

      toggleMyWordsEntry(entry);
      updateMyWordsButton(starButton, entryId, word);
    });

    starButton.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });

    // Reporting an issue lives in the definition-content grid below
    // (see displaySearchResults in scripts.js), not up here with the star.
    controls.appendChild(starButton);
    card.prepend(controls);

    // Create or reuse the navigation row above the card.
    let navigation = resultsContainer.querySelector(
      ".single-result-navigation",
    );

    if (!navigation) {
      navigation = document.createElement("div");
      navigation.className = "single-result-navigation";
      navigation.setAttribute("aria-label", "Definition navigation");

      resultsContainer.insertBefore(navigation, card);
    }

    // Move the existing Back to Results button into the left side.
    const backNavigation = Array.from(resultsContainer.children).find(
      (element) => element.classList?.contains("back-navigation"),
    );

    if (backNavigation) {
      navigation.prepend(backNavigation);
    }
  }

  function attachMultipleResultMyWordsStars(entries) {
    const cards = Array.from(
      resultsContainer.querySelectorAll(
        ".definition.multiple-results-definition:not(.word-list-header)",
      ),
    );

    cards.forEach((card, index) => {
      const entry = entries[index];

      if (!entry) {
        return;
      }

      // Prevent duplicate stars if results are rendered again.
      card.querySelector(".multiple-results-my-words-star")?.remove();

      const starButton = document.createElement("button");
      const starIcon = document.createElement("i");
      const entryId = getMyWordsEntryId(entry);
      const word = String(entry.ord ?? "").trim();

      starButton.type = "button";
      starButton.className =
        "word-list-favorite-button multiple-results-my-words-star";

      starIcon.setAttribute("aria-hidden", "true");
      starButton.appendChild(starIcon);

      updateMyWordsButton(starButton, entryId, word);

      starButton.addEventListener("click", (event) => {
        // Do not open the definition when clicking the star.
        event.stopPropagation();

        toggleMyWordsEntry(entry);
        updateMyWordsButton(starButton, entryId, word);
      });

      starButton.addEventListener("keydown", (event) => {
        event.stopPropagation();
      });

      card.appendChild(starButton);
    });
  }

  function returnToWordList() {
    const { typeSelect, searchInput, posSelect, cefrSelect } =
      getWordListFilterElements();

    if (!typeSelect) {
      return;
    }

    const savedState = wordListReturnState || {
      search: "",
      pos: "",
      cefr: "",
    };

    // Switch back to Word List.
    typeSelect.value = "word-list";
    handleTypeChange("word-list");

    /*
     * handleTypeChange() resets the filters, so restore the saved values
     * after calling it.
     */
    if (searchInput) {
      searchInput.value = savedState.search;
    }

    if (posSelect) {
      posSelect.value = savedState.pos;
    }

    if (cefrSelect) {
      cefrSelect.value = savedState.cefr;
    }

    // Render again using the restored search and filters.
    renderWordList();

    // Restore the Word List URL.
    updateURL(savedState.search, "word-list", savedState.pos);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function createWordListBackButton() {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "back-navigation word-list-back-navigation";

    const icon = document.createElement("i");
    icon.className = "fas fa-chevron-left";
    icon.setAttribute("aria-hidden", "true");

    const text = document.createTextNode(" Back to Word List");

    button.append(icon, text);

    button.addEventListener("click", (event) => {
      /*
       * Prevent the existing multiple-results back-navigation handler
       * in scripts.js from processing this button.
       */
      event.stopPropagation();
      returnToWordList();
    });

    return button;
  }

  function openWordListDefinition(entry) {
    const word = String(entry.ord ?? "").trim();
    const english = String(entry.engelsk ?? "").trim();

    if (!word) {
      return;
    }

    const { typeSelect, searchInput, posSelect, cefrSelect } =
      getWordListFilterElements();

    if (!typeSelect || !searchInput) {
      return;
    }

    /*
     * Save the current Word List state before leaving it.
     */
    wordListReturnState = {
      search: searchInput.value,
      pos: posSelect ? posSelect.value : "",
      cefr: cefrSelect ? cefrSelect.value : "",
    };

    /*
     * Switch to Words and perform the same search that would happen
     * if the user entered this word in the Words search field.
     */
    typeSelect.value = "words";
    searchInput.value = word;

    handleTypeChange("words");

    /*
     * At this point, the normal Words search has rendered either:
     *
     * 1. One complete definition, or
     * 2. Several multiple-result cards
     *
     * If several cards were returned, click the card matching the
     * Word List entry. This invokes the normal handleCardClick()
     * path used by the Words tab.
     */
    const resultCards = Array.from(
      resultsContainer.querySelectorAll(
        ".definition.multiple-results-definition",
      ),
    );

    if (resultCards.length > 0) {
      const normalizedWord = word.toLowerCase();
      const normalizedEnglish = english.toLowerCase();

      const matchingCard =
        resultCards.find((card) => {
          const cardWord = String(card.dataset.word ?? "")
            .trim()
            .toLowerCase();

          const cardEnglish = String(card.dataset.engelsk ?? "")
            .trim()
            .toLowerCase();

          return (
            cardWord === normalizedWord && cardEnglish === normalizedEnglish
          );
        }) ||
        resultCards.find((card) => {
          const cardWord = String(card.dataset.word ?? "")
            .trim()
            .toLowerCase();

          return cardWord === normalizedWord;
        });

      if (matchingCard) {
        /*
         * This runs the card's existing onclick code and therefore uses
         * handleCardClick(), displaySearchResults(), and the ordinary
         * sentence-loading sequence.
         */
        matchingCard.click();
      }
    }

    /*
     * The ordinary search or card-click path may have created its own
     * "Back to Results" button. Remove that because this visit came
     * from Word List.
     */
    resultsContainer
      .querySelectorAll(".back-navigation")
      .forEach((backElement) => {
        backElement.remove();
      });

    latestMultipleResults = null;

    /*
     * The search was necessary to use the normal Words loading path,
     * but the search field should be blank on the definition page.
     */
    searchInput.value = "";

    /*
     * Add the dedicated Word List return button after the normal Words
     * rendering has finished.
     */
    const backButton = createWordListBackButton();

    const navigation = resultsContainer.querySelector(
      ".single-result-navigation",
    );

    if (navigation) {
      navigation.prepend(backButton);
    } else {
      resultsContainer.insertBefore(backButton, resultsContainer.firstChild);
    }
    const primaryWord = String(entry.ord ?? "")
      .split(",")[0]
      .trim();

    const entryPOS = getWordListEntryPOS(entry);

    updateURL("", "words", entryPOS, null, primaryWord);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  /**
   * Create one vocabulary table row.
   */
  function createWordListRow(entry) {
    const row = document.createElement("tr");

    row.className = "word-list-row";

    const norwegianWord = String(entry.ord ?? "").trim();
    const englishTranslation = String(entry.engelsk ?? "").trim();
    const norwegianCell = createWordListCell(
      "",
      "word-list-norwegian",
      "Norwegian",
      { richContent: true },
    );

    const norwegianLink = document.createElement("a");
    const wordTextBlock = document.createElement("span");
    const spellings = norwegianWord
      .split(",")
      .map((spelling) => spelling.trim())
      .filter(Boolean);

    norwegianLink.className = "word-list-word-link";
    norwegianLink.href = createWordListDefinitionURL(entry);
    norwegianLink.setAttribute(
      "aria-label",
      `Open the definition for ${norwegianWord}`,
    );

    wordTextBlock.className = "word-text-block";
    wordTextBlock.append(spellings[0] || norwegianWord);

    if (spellings.length > 1) {
      const alternateSpellings = document.createElement("span");

      alternateSpellings.className = "alt-spelling";
      alternateSpellings.textContent = spellings.slice(1).join(", ");
      wordTextBlock.appendChild(alternateSpellings);
    }

    norwegianLink.appendChild(wordTextBlock);

    /*
     * Preserve the existing single-page navigation for human users.
     * Search engines can still discover the real href above.
     */
    norwegianLink.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openWordListDefinition(entry);
    });

    norwegianCell.appendChild(norwegianLink);

    const englishCell = createWordListCell(
      englishTranslation,
      "word-list-english",
      "English",
    );

    norwegianCell.lang = "nb";
    englishCell.lang = "en";

    const wordClassCell = createWordListCell(
      "",
      "word-list-class",
      "Word Class",
      { richContent: true },
    );

    const wordClassBadge = document.createElement("span");

    /*
     * Reuse the exact classes from Words multiple results.
     */
    wordClassBadge.className =
      "gender multiple-results-gender-class word-list-class-badge";

    wordClassBadge.textContent = getWordListClassLabel(entry);

    wordClassCell.appendChild(wordClassBadge);

    const level = String(entry.CEFR ?? "")
      .trim()
      .toUpperCase();

    const levelCell = createWordListCell("", "word-list-level", "Level", {
      richContent: true,
    });

    if (level) {
      const levelBadge = document.createElement("span");

      /*
       * Reuse the exact CEFR classes already used by Words results:
       *
       * A1/A2 → easy
       * B1/B2 → medium
       * C     → hard
       */
      levelBadge.className = `game-cefr-label ${getCefrClass(level)}`;

      levelBadge.textContent = level;

      levelCell.appendChild(levelBadge);
    } else {
      levelCell.textContent = "—";
    }

    const strengthCell = createWordStrengthCell(entry);
    const myWordsCell = createMyWordsCell(entry);

    row.append(
      norwegianCell,
      englishCell,
      wordClassCell,
      levelCell,
      strengthCell,
      myWordsCell,
    );

    // Mouse and touchscreen activation.
    row.addEventListener("click", () => {
      openWordListDefinition(entry);
    });

    return row;
  }

  /**
   * Read the current search field and Word Class selection, then return
   * the matching entries.
   */
  function getFilteredWordListEntries() {
    const { searchInput, posSelect, cefrSelect } = getWordListFilterElements();

    const searchText = normalizeWordListText(
      searchInput ? searchInput.value : "",
    );

    const selectedPOS = normalizeWordListText(posSelect ? posSelect.value : "");

    const selectedCEFR = String(cefrSelect ? cefrSelect.value : "")
      .trim()
      .toUpperCase();

    if (!Array.isArray(results)) {
      return [];
    }

    return results
      .filter((entry) => {
        // Do not display an entry without a Norwegian word.
        if (!normalizeWordListText(entry.ord)) {
          return false;
        }

        if (
          activeWordListView === "my" &&
          !myWordsEntryIds.has(getMyWordsEntryId(entry))
        ) {
          return false;
        }

        const matchesWordClass = wordListEntryMatchesPOS(entry, selectedPOS);

        const entryCEFR = String(entry.CEFR ?? "")
          .trim()
          .toUpperCase();

        const matchesLevel = !selectedCEFR || entryCEFR === selectedCEFR;

        if (!matchesWordClass || !matchesLevel) {
          return false;
        }

        // An empty search displays all entries matching the filters.
        if (!searchText) {
          return true;
        }

        const norwegian = normalizeWordListText(entry.ord);
        const english = normalizeWordListText(entry.engelsk, "en");

        return norwegian.includes(searchText) || english.includes(searchText);
      })
      .sort((firstEntry, secondEntry) => {
        const norwegianComparison = norwegianCollator.compare(
          String(firstEntry.ord ?? ""),
          String(secondEntry.ord ?? ""),
        );

        if (norwegianComparison !== 0) {
          return norwegianComparison;
        }

        return norwegianCollator.compare(
          String(firstEntry.engelsk ?? ""),
          String(secondEntry.engelsk ?? ""),
        );
      });
  }

  /**
   * Add the Word List heading and result count.
   */
  function createWordListHeader(visibleCount) {
    const header = document.createElement("div");

    header.className =
      "definition multiple-results-definition word-list-header";

    header.appendChild(createWordListControls(visibleCount));

    return header;
  }

  /**
   * Create the empty-results message.
   */
  function createWordListEmptyMessage() {
    const message = document.createElement("div");
    message.className = "definition error-message";

    const heading = document.createElement("h2");
    heading.className = "word-gender";

    const explanation = document.createElement("p");

    if (activeWordListView === "my" && myWordsEntryIds.size === 0) {
      heading.textContent = "No saved words yet";
      explanation.textContent =
        "Select All Words and click a star to add a word to My Words.";
    } else {
      heading.textContent = "No matching words";
      explanation.textContent =
        "Try a different search, filter, or word-list view.";
    }

    message.append(heading, explanation);

    return message;
  }

  /**
   * Create the vocabulary table.
   */
  function createWordListTable() {
    const tableContainer = document.createElement("div");
    tableContainer.className = "word-list-table-container";

    const table = document.createElement("table");
    table.className = "word-list-table";
    table.setAttribute("aria-label", "Vocabulary entries");

    // Rows are added later in batches of 100.
    const tableBody = document.createElement("tbody");
    tableBody.id = "word-list-table-body";

    table.appendChild(tableBody);

    tableContainer.appendChild(table);

    tableContainer.addEventListener("scroll", handleWordListScroll);

    return tableContainer;
  }

  function appendNextWordListBatch() {
    if (wordListBatchIsLoading) {
      return;
    }

    if (renderedWordListCount >= activeWordListEntries.length) {
      return;
    }

    const tableBody = document.getElementById("word-list-table-body");

    if (!tableBody) {
      return;
    }

    wordListBatchIsLoading = true;

    const nextBatch = activeWordListEntries.slice(
      renderedWordListCount,
      renderedWordListCount + WORD_LIST_BATCH_SIZE,
    );

    const fragment = document.createDocumentFragment();

    nextBatch.forEach((entry) => {
      fragment.appendChild(createWordListRow(entry));
    });

    tableBody.appendChild(fragment);

    renderedWordListCount += nextBatch.length;
    wordListBatchIsLoading = false;
  }

  function handleWordListScroll(event) {
    const container = event.currentTarget;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    // Load another batch when the user is close to the bottom.
    if (distanceFromBottom <= 100) {
      appendNextWordListBatch();
    }
  }

  function downloadWordListFile(filename, content, mimeType) {
    /*
     * The UTF-8 marker helps spreadsheet programs display
     * æ, ø, and å correctly.
     */
    const utf8Content = "\uFEFF" + content;

    const blob = new Blob([utf8Content], {
      type: `${mimeType};charset=utf-8`,
    });

    const downloadURL = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = downloadURL;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(downloadURL);
  }

  function createWordListExportFilename(extension) {
    const { searchInput, posSelect, cefrSelect } = getWordListFilterElements();

    const search = String(searchInput?.value ?? "").trim();
    const wordClass = String(posSelect?.value ?? "").trim();
    const level = String(cefrSelect?.value ?? "").trim();

    const filenameParts = ["norwegian-word-list"];

    if (wordClass) {
      filenameParts.push(wordClass);
    }

    if (level) {
      filenameParts.push(level.toLowerCase());
    }

    if (search) {
      const safeSearch = search
        .toLocaleLowerCase("nb-NO")
        .replace(/[^a-z0-9æøå]+/gi, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);

      if (safeSearch) {
        filenameParts.push(`search-${safeSearch}`);
      }
    }

    return `${filenameParts.join("-")}.${extension}`;
  }

  function cleanWordListExportValue(value) {
    return String(value ?? "")
      .replace(/\r?\n/g, " ")
      .trim();
  }

  function escapeWordListCSVValue(value) {
    const cleanedValue = cleanWordListExportValue(value);

    return `"${cleanedValue.replace(/"/g, '""')}"`;
  }

  function confirmWordListExport(format, entryCount) {
    const viewName = activeWordListView === "my" ? "My Words" : "All Words";

    const entryLabel = entryCount === 1 ? "entry" : "entries";

    const largePDFWarning =
      format === "PDF" && entryCount > 2000
        ? "\n\nThis is a large PDF and may take a while to prepare."
        : "";

    return window.confirm(
      `Export ${entryCount.toLocaleString()} ${entryLabel} ` +
        `from ${viewName} as ${format}?${largePDFWarning}`,
    );
  }

  function exportWordListCSV() {
    const entries = getFilteredWordListEntries();

    if (entries.length === 0) {
      return;
    }

    if (!confirmWordListExport("CSV", entries.length)) {
      return;
    }

    const rows = [["Norwegian", "English", "Word Class", "Level"]];

    entries.forEach((entry) => {
      rows.push([
        entry.ord,
        entry.engelsk,
        getWordListClassLabel(entry),
        entry.CEFR,
      ]);
    });

    const csvContent = rows
      .map((row) => row.map(escapeWordListCSVValue).join(","))
      .join("\r\n");

    downloadWordListFile(
      createWordListExportFilename("csv"),
      csvContent,
      "text/csv",
    );
  }

  function escapeWordListTSVValue(value) {
    return cleanWordListExportValue(value).replace(/\t/g, " ");
  }

  function createWordListTag(value) {
    return String(value ?? "")
      .trim()
      .toLocaleLowerCase("nb-NO")
      .replace(/[^a-z0-9æøå]+/gi, "-")
      .replace(/^-|-$/g, "");
  }

  function exportWordListTSV() {
    const entries = getFilteredWordListEntries();

    if (entries.length === 0) {
      return;
    }

    if (!confirmWordListExport("TSV", entries.length)) {
      return;
    }

    const rows = [["Norwegian", "English", "Word Class", "Level"]];

    entries.forEach((entry) => {
      rows.push([
        entry.ord,
        entry.engelsk,
        getWordListClassLabel(entry),
        entry.CEFR,
      ]);
    });

    const tsvContent = rows
      .map((row) => row.map(escapeWordListTSVValue).join("\t"))
      .join("\r\n");

    downloadWordListFile(
      createWordListExportFilename("tsv"),
      tsvContent,
      "text/tab-separated-values",
    );
  }
  function createControlGroup(className, ariaLabel) {
    const group = document.createElement("div");

    group.className = `word-list-control-group ${className}`;
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", ariaLabel);

    return group;
  }

  function createControlButton(label, onClick) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "word-list-export-button";
    button.textContent = label;

    if (typeof onClick === "function") {
      button.addEventListener("click", onClick);
    }

    return button;
  }

  function createWordListControls(visibleCount) {
    const controls = document.createElement("div");
    controls.className = "word-list-controls";

    /*
     * View selection
     */
    const viewControls = createControlGroup(
      "word-list-view-controls",
      "Choose word-list view",
    );

    const allWordsButton = createControlButton("All Words", () => {
      if (activeWordListView === "all") {
        return;
      }

      activeWordListView = "all";
      renderWordList();
    });

    allWordsButton.classList.toggle("is-active", activeWordListView === "all");

    allWordsButton.setAttribute(
      "aria-pressed",
      String(activeWordListView === "all"),
    );

    const myWordsButton = createControlButton("My Words", () => {
      if (activeWordListView === "my") {
        return;
      }

      activeWordListView = "my";
      renderWordList();
    });

    myWordsButton.classList.toggle("is-active", activeWordListView === "my");

    myWordsButton.setAttribute(
      "aria-pressed",
      String(activeWordListView === "my"),
    );

    viewControls.append(allWordsButton, myWordsButton);
    controls.appendChild(viewControls);

    /*
     * My Words actions
     */
    if (activeWordListView === "my") {
      const myWordsActions = createControlGroup(
        "word-list-my-words-actions",
        "My Words actions",
      );

      const learnWordsButton = createControlButton("Learn Words", () => {
        selectType("word-game");
        window.scrollTo({ top: 0, behavior: "smooth" });
      });

      learnWordsButton.disabled = myWordsEntryIds.size === 0;
      learnWordsButton.title =
        myWordsEntryIds.size === 0
          ? "Save at least one word first"
          : "Start the Word Game with My Words prioritized";

      const removeAllButton = createControlButton("Remove All Words", () => {
        const savedWordCount = myWordsEntryIds.size;

        if (savedWordCount === 0) {
          return;
        }

        const wordLabel = savedWordCount === 1 ? "saved word" : "saved words";

        const shouldRemoveAll = window.confirm(
          `Remove all ${savedWordCount} ${wordLabel} from My Words? ` +
            "This cannot be undone.",
        );

        if (!shouldRemoveAll) {
          return;
        }

        myWordsEntryIds.clear();
        saveMyWordsEntryIds();
        renderWordList();
      });

      removeAllButton.classList.add("is-danger");
      removeAllButton.disabled = myWordsEntryIds.size === 0;

      myWordsActions.append(learnWordsButton, removeAllButton);

      controls.appendChild(myWordsActions);
    }

    /*
     * Export actions
     */
    const exportControls = createControlGroup(
      "word-list-export-controls",
      "Export words",
    );

    const csvButton = createControlButton("Export CSV", exportWordListCSV);

    const tsvButton = createControlButton("Export TSV", exportWordListTSV);

    const pdfButton = createControlButton("Export PDF", exportWordListPDF);

    const exportsDisabled = visibleCount === 0;

    csvButton.disabled = exportsDisabled;
    tsvButton.disabled = exportsDisabled;
    pdfButton.disabled = exportsDisabled;

    exportControls.append(csvButton, tsvButton, pdfButton);

    controls.appendChild(exportControls);

    return controls;
  }

  function escapeWordListHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function exportWordListPDF() {
    const entries = getFilteredWordListEntries();

    if (entries.length === 0) {
      return;
    }

    if (!confirmWordListExport("PDF", entries.length)) {
      return;
    }

    const printWindow = window.open("", "_blank");

    if (!printWindow) {
      window.alert(
        "The PDF window was blocked. Please allow pop-ups and try again.",
      );

      return;
    }

    /*
     * Prevent the new window from controlling the original page.
     */
    printWindow.opener = null;

    const filename = createWordListExportFilename("pdf");
    const documentTitle = filename.replace(/\.pdf$/i, "");

    const tableRows = entries
      .map(
        (entry) => `
        <tr>
          <td>${escapeWordListHTML(entry.ord)}</td>
          <td>${escapeWordListHTML(entry.engelsk)}</td>
          <td>${escapeWordListHTML(getWordListClassLabel(entry))}</td>
          <td>${escapeWordListHTML(entry.CEFR)}</td>
        </tr>
      `,
      )
      .join("");

    const printableDocument = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>${escapeWordListHTML(documentTitle)}</title>

        <style>
          @page {
            size: A4;
            margin: 12mm;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            color: #222222;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 10pt;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }

          thead {
            display: table-header-group;
          }

          tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          th,
          td {
            padding: 7px 8px;
            border: 1px solid #cccccc;
            overflow-wrap: anywhere;
            text-align: left;
            vertical-align: top;
          }

          th {
            background-color: #eeeeee;
            font-size: 9pt;
            letter-spacing: 0.03em;
            text-transform: uppercase;
          }

          th:nth-child(1),
          td:nth-child(1) {
            width: 30%;
          }

          th:nth-child(2),
          td:nth-child(2) {
            width: 35%;
          }

          th:nth-child(3),
          td:nth-child(3) {
            width: 25%;
          }

          th:nth-child(4),
          td:nth-child(4) {
            width: 10%;
          }

          tbody tr:nth-child(even) {
            background-color: #f7f7f7;
          }
        </style>
      </head>

      <body>
        <table>
          <thead>
            <tr>
              <th>Norwegian</th>
              <th>English</th>
              <th>Word Class</th>
              <th>Level</th>
            </tr>
          </thead>

          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </body>
    </html>
  `;

    printWindow.document.open();
    printWindow.document.write(printableDocument);
    printWindow.document.close();

    /*
     * The document contains no external resources, so a short delay
     * is sufficient before opening the print dialog.
     */
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);
  }

  /**
   * Render the complete Word List using the current search and Word Class.
   *
   * scripts.js calls this function whenever:
   * - The user performs a search
   * - The user clears the search
   * - The user changes Word Class
   */
  function renderWordList() {
    const typeSelect = document.getElementById("type-select");

    // Do not replace another tab's content.
    if (!typeSelect || typeSelect.value !== "word-list") {
      return;
    }

    showLandingCard(false);
    clearContainer();

    const panel = document.createElement("section");
    panel.id = "word-list";
    panel.className = "word-list";

    if (!Array.isArray(results) || results.length === 0) {
      const loadingMessage = document.createElement("div");
      loadingMessage.className = "definition";

      const heading = document.createElement("h2");
      heading.textContent = "Loading vocabulary";

      const explanation = document.createElement("p");
      explanation.textContent =
        "The vocabulary data has not finished loading yet.";

      loadingMessage.append(heading, explanation);
      panel.appendChild(loadingMessage);
      resultsContainer.appendChild(panel);

      return;
    }

    const filteredEntries = getFilteredWordListEntries();

    // Reset batching whenever the search or filters change.
    activeWordListEntries = filteredEntries;
    renderedWordListCount = 0;
    wordListBatchIsLoading = false;

    panel.appendChild(createWordListHeader(filteredEntries.length));

    if (filteredEntries.length === 0) {
      panel.appendChild(createWordListEmptyMessage());
    } else {
      panel.appendChild(createWordListTable());
    }

    resultsContainer.appendChild(panel);

    // Display the first 100 matching entries.
    if (filteredEntries.length > 0) {
      appendNextWordListBatch();
    }
  }

  /**
   * Entry point called by handleTypeChange("word-list").
   */
  function initWordList() {
    const typeSelect = document.getElementById("type-select");

    if (!typeSelect || typeSelect.value !== "word-list") {
      return;
    }

    renderWordList();
  }

  function resolveMyWordsEntry(entry) {
    if (!entry) {
      return null;
    }

    const sameValue = (first, second) =>
      String(first ?? "")
        .trim()
        .normalize("NFC") ===
      String(second ?? "")
        .trim()
        .normalize("NFC");

    /*
     * Most Word Game objects are the original result objects.
     */
    const identicalEntry = results.find((candidate) => candidate === entry);

    if (identicalEntry) {
      return identicalEntry;
    }

    /*
     * Reintroduced Word Game objects may contain only a subset of the
     * original entry's properties — try the most specific field set first,
     * then fall back to a looser one that drops "engelsk".
     */
    const fieldTiers = [
      ["ord", "engelsk", "gender", "CEFR"],
      ["ord", "gender", "CEFR"],
    ];

    for (const fields of fieldTiers) {
      const match = results.find((candidate) =>
        fields.every((field) => sameValue(candidate[field], entry[field])),
      );

      if (match) {
        return match;
      }
    }

    return entry;
  }

  function isMyWordsEntrySaved(entry) {
    const resolvedEntry = resolveMyWordsEntry(entry);

    if (!resolvedEntry) {
      return false;
    }

    return myWordsEntryIds.has(getMyWordsEntryId(resolvedEntry));
  }

  function toggleResolvedMyWordsEntry(entry) {
    const resolvedEntry = resolveMyWordsEntry(entry);

    if (!resolvedEntry) {
      return null;
    }

    toggleMyWordsEntry(resolvedEntry);

    return isMyWordsEntrySaved(resolvedEntry);
  }

  // Make these functions available to scripts.js.
  window.initWordList = initWordList;
  window.renderWordList = renderWordList;
  window.attachSingleResultMyWordsControls = attachSingleResultMyWordsControls;
  window.attachMultipleResultMyWordsStars = attachMultipleResultMyWordsStars;
  window.goToAllWords = goToAllWords;
  window.goToMyWords = goToMyWords;
  window.MyWordsAPI = Object.freeze({
    getSavedEntries: getSavedWordStudyEntries,
    returnToMyWords: goToMyWords,
    isSaved: isMyWordsEntrySaved,
    toggle: toggleResolvedMyWordsEntry,
    getEntryIds: () => Array.from(myWordsEntryIds),
    replaceEntryIds: replaceMyWordsEntryIds,
  });
  window.WordStrengthAPI = Object.freeze({
    recordResult: recordWordStrengthResult,
    getAll: () => ({ ...wordStrengths }),
    replaceAll: replaceWordStrengths,
    // Direct O(1) lookup, valid only for canonical `results` entries (not
    // resolved/partial copies) — the Word Game always hands over the
    // original entry reference, so this is safe for that caller.
    get: (entry) => {
      const raw = wordStrengths[getMyWordsEntryId(entry)];

      return typeof raw === "number" && Number.isFinite(raw)
        ? Math.min(WORD_STRENGTH_MAX, Math.max(0, raw))
        : null;
    },
  });
})();
