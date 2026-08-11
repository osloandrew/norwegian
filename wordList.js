(function () {
  "use strict";

  // Norwegian alphabetical sorting places æ, ø, and å correctly.
  const norwegianCollator = new Intl.Collator("nb-NO", {
    sensitivity: "base",
    numeric: true,
  });

  const WORD_LIST_BATCH_SIZE = 100;

  let activeWordListEntries = [];
  let renderedWordListCount = 0;
  let wordListBatchIsLoading = false;
  let wordListReturnState = null;

  /**
   * Convert a value into normalized searchable text.
   */
  function normalizeWordListText(value, locale = "nb-NO") {
    return String(value ?? "")
      .trim()
      .toLocaleLowerCase(locale);
  }

  /**
   * Determine whether a CSV gender value represents a noun.
   *
   * Nouns in norwegianWords.csv use articles such as:
   * en
   * ei
   * et
   * en-et
   * en-ei-et
   */
  function isWordListNoun(genderValue) {
    const normalizedGender = normalizeWordListText(genderValue);

    return /^(en|ei|et)(?:$|[-/,\s])/.test(normalizedGender);
  }

  /**
   * Determine whether an entry matches the selected Word Class.
   */
  function wordListEntryMatchesPOS(entry, selectedPOS) {
    if (!selectedPOS) {
      return true;
    }

    const normalizedPOS = normalizeWordListText(selectedPOS);
    const normalizedGender = normalizeWordListText(entry.gender);

    if (normalizedPOS === "noun") {
      return isWordListNoun(normalizedGender);
    }

    return normalizedGender.startsWith(normalizedPOS);
  }

  /**
   * Convert the CSV gender value into a readable Word Class label.
   */
  function getWordListClassLabel(entry) {
    const originalGender = String(entry.gender ?? "").trim();

    if (!originalGender) {
      return "—";
    }

    if (isWordListNoun(originalGender)) {
      return `Noun (${originalGender})`;
    }

    return originalGender.charAt(0).toUpperCase() + originalGender.slice(1);
  }

  /**
   * Create one table cell.
   */
  function createWordListCell(value, className, mobileLabel) {
    const cell = document.createElement("td");

    cell.textContent = value || "—";
    cell.className = className;
    cell.dataset.label = mobileLabel;

    return cell;
  }

  function returnToWordList() {
    const typeSelect = document.getElementById("type-select");
    const searchInput = document.getElementById("search-bar");
    const posSelect = document.getElementById("pos-select");
    const cefrSelect = document.getElementById("cefr-select");

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

    const typeSelect = document.getElementById("type-select");
    const searchInput = document.getElementById("search-bar");
    const posSelect = document.getElementById("pos-select");
    const cefrSelect = document.getElementById("cefr-select");

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

    resultsContainer.insertBefore(backButton, resultsContainer.firstChild);

    updateURL("", "words", "", null, word);

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
    row.tabIndex = 0;
    row.setAttribute("role", "link");

    const norwegianWord = String(entry.ord ?? "").trim();
    const englishTranslation = String(entry.engelsk ?? "").trim();

    row.setAttribute("aria-label", `Open the definition for ${norwegianWord}`);

    const norwegianCell = createWordListCell(
      norwegianWord,
      "word-list-norwegian",
      "Norwegian",
    );

    const englishCell = createWordListCell(
      englishTranslation,
      "word-list-english",
      "English",
    );

    const wordClassCell = createWordListCell(
      getWordListClassLabel(entry),
      "word-list-class",
      "Word Class",
    );

    const levelCell = createWordListCell(
      String(entry.CEFR ?? "").trim(),
      "word-list-level",
      "Level",
    );

    row.append(norwegianCell, englishCell, wordClassCell, levelCell);

    // Mouse and touchscreen activation.
    row.addEventListener("click", () => {
      openWordListDefinition(entry);
    });

    // Keyboard activation.
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openWordListDefinition(entry);
      }
    });

    return row;
  }

  /**
   * Read the current search field and Word Class selection, then return
   * the matching entries.
   */
  function getFilteredWordListEntries() {
    const searchInput = document.getElementById("search-bar");
    const posSelect = document.getElementById("pos-select");
    const cefrSelect = document.getElementById("cefr-select");

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
  function createWordListHeader(visibleCount, totalCount) {
    const header = document.createElement("div");

    header.className =
      "definition multiple-results-definition word-list-header";

    const count = document.createElement("p");
    count.id = "word-list-count";
    count.className = "word-list-count";
    count.setAttribute("aria-live", "polite");

    if (visibleCount === totalCount) {
      count.textContent =
        totalCount === 1
          ? "1 vocabulary entry"
          : `${totalCount} vocabulary entries`;
    } else {
      count.textContent = `${visibleCount} of ${totalCount} vocabulary entries`;
    }

    header.appendChild(count);

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
    heading.textContent = "No matching words";

    const explanation = document.createElement("p");
    explanation.textContent =
      "Try a different search or choose another Word Class.";

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

    const loadStatus = document.createElement("p");
    loadStatus.id = "word-list-load-status";
    loadStatus.className = "word-list-load-status";
    loadStatus.setAttribute("aria-live", "polite");

    tableContainer.append(table, loadStatus);

    tableContainer.addEventListener("scroll", handleWordListScroll);

    return tableContainer;
  }

  function updateWordListLoadStatus() {
    const status = document.getElementById("word-list-load-status");

    if (!status) {
      return;
    }

    if (renderedWordListCount < activeWordListEntries.length) {
      status.textContent =
        `Showing ${renderedWordListCount} of ` +
        `${activeWordListEntries.length} matching entries. ` +
        "Scroll down to load more.";
    } else {
      status.textContent =
        `Showing all ${activeWordListEntries.length} ` + "matching entries.";
    }
  }

  function appendNextWordListBatch() {
    if (wordListBatchIsLoading) {
      return;
    }

    if (renderedWordListCount >= activeWordListEntries.length) {
      updateWordListLoadStatus();
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

    updateWordListLoadStatus();
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

    const allEntries = results.filter((entry) =>
      Boolean(normalizeWordListText(entry.ord)),
    );
    const filteredEntries = getFilteredWordListEntries();

    // Reset batching whenever the search or filters change.
    activeWordListEntries = filteredEntries;
    renderedWordListCount = 0;
    wordListBatchIsLoading = false;

    panel.appendChild(
      createWordListHeader(filteredEntries.length, allEntries.length),
    );

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

  // Make these functions available to scripts.js.
  window.initWordList = initWordList;
  window.renderWordList = renderWordList;
})();
