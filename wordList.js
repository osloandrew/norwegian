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
      /*
       * Remove an existing "noun -" prefix so it is not duplicated
       * after the Words renderer has previously handled this entry.
       */
      const nounGender = originalGender
        .toLocaleLowerCase("nb-NO")
        .replace(/^noun\s*-\s*/, "");

      return `noun - ${nounGender}`;
    }

    return originalGender;
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
      "",
      "word-list-class",
      "Word Class",
    );

    // Remove the placeholder inserted by createWordListCell().
    wordClassCell.textContent = "";

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

    const levelCell = createWordListCell("", "word-list-level", "Level");

    // Remove the placeholder added by createWordListCell().
    levelCell.textContent = "";

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
    const searchInput = document.getElementById("search-bar");
    const posSelect = document.getElementById("pos-select");
    const cefrSelect = document.getElementById("cefr-select");

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

  function escapeWordListCSVValue(value) {
    const cleanedValue = String(value ?? "")
      .replace(/\r?\n/g, " ")
      .trim();

    return `"${cleanedValue.replace(/"/g, '""')}"`;
  }

  function exportWordListCSV() {
    const entries = getFilteredWordListEntries();

    if (entries.length === 0) {
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
    return String(value ?? "")
      .replace(/\t/g, " ")
      .replace(/\r?\n/g, " ")
      .trim();
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

  function createWordListExportControls() {
    const controls = document.createElement("div");
    controls.className = "word-list-export-controls";

    const csvButton = document.createElement("button");
    csvButton.type = "button";
    csvButton.className = "word-list-export-button";
    csvButton.textContent = "Export CSV";

    csvButton.addEventListener("click", () => {
      exportWordListCSV();
    });

    const tsvButton = document.createElement("button");
    tsvButton.type = "button";
    tsvButton.className = "word-list-export-button";
    tsvButton.textContent = "Export TSV";

    tsvButton.addEventListener("click", () => {
      exportWordListTSV();
    });

    const pdfButton = document.createElement("button");
    pdfButton.type = "button";
    pdfButton.className = "word-list-export-button";
    pdfButton.textContent = "Export PDF";

    pdfButton.addEventListener("click", () => {
      exportWordListPDF();
    });

    controls.append(csvButton, tsvButton, pdfButton);

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

    /*
     * Very large PDFs can take a long time to prepare.
     * Give the user a choice before continuing.
     */
    if (entries.length > 2000) {
      const shouldContinue = window.confirm(
        `This PDF will contain ${entries.length} vocabulary entries ` +
          "and may take a while to prepare. Continue?",
      );

      if (!shouldContinue) {
        return;
      }
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
      panel.appendChild(createWordListExportControls());
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
