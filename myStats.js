// "My Stats" — a personal report, not a browsable list, which is why it's
// its own top-level type (alongside Word Game / Word List) rather than a
// tab bolted onto Word List's All Words/My Words switcher: those two share
// one table renderer for a filtered slice of the dictionary, while this
// page is a single summary card, a fundamentally different shape.
//
// Rendered as one .definition "paper" (the same card chrome the landing
// page's own #landing-card uses) containing a plain-text header plus one
// light-blue .my-stats-box per section — mirroring the landing page's
// .landing-daily-quests / .landing-progress-summary boxes exactly, rather
// than stacking separate white cards. Every text element explicitly sets
// "Noto Sans" (see the comment above .my-stats in styles.css for why that
// has to be explicit, not inherited).
//
// Every number here already exists somewhere in WordStrengthAPI or
// StreakAPI — this file is pure aggregation/rendering, no new tracking.
// The vocabulary breakdown reuses wordGame.js's buildVocabProgressBarMarkup
// so it can never drift from the landing page's compact "Vocabulary
// profile" widget, which this page is the detail view for (see its
// "See full stats" button).
(function () {
  "use strict";

  const MAX_TROUBLE_WORDS_SHOWN = 20;

  function getResultsContainer() {
    return document.getElementById("results-container");
  }

  function getUpcomingDueCount(days, now = Date.now()) {
    const dayMs = window.SpacedRepetition?.DAY_MS ?? 24 * 60 * 60 * 1000;
    const horizon = now + days * dayMs;
    const records = Object.values(window.WordStrengthAPI?.getAll?.() ?? {});

    return records.filter(
      (record) => record.dueAt > now && record.dueAt <= horizon,
    ).length;
  }

  // Every word ever missed at least once, ranked by how many times —
  // record.lapses is tracked on every incorrect answer (see
  // spacedRepetition.js's scheduleIncorrect) but wasn't surfaced anywhere
  // in the UI before this page.
  function getTroubleEntries(limit = MAX_TROUBLE_WORDS_SHOWN) {
    const allRecords = window.WordStrengthAPI?.getAll?.() ?? {};

    return Object.entries(allRecords)
      .filter(([, record]) => (record.lapses ?? 0) > 0)
      .sort((a, b) => b[1].lapses - a[1].lapses)
      .slice(0, limit)
      .map(([entryId]) => window.WordListAPI?.getEntryById?.(entryId))
      .filter(Boolean);
  }

  function createStatTile(value, label) {
    const tile = document.createElement("div");
    tile.className = "game-summary-stat";

    const valueEl = document.createElement("p");
    valueEl.className = "game-summary-stat-value";
    valueEl.textContent = value;

    const labelEl = document.createElement("p");
    labelEl.className = "game-summary-stat-label";
    labelEl.textContent = label;

    tile.append(valueEl, labelEl);
    return tile;
  }

  function createHeaderCard() {
    const card = document.createElement("section");
    card.className = "my-stats-header";
    card.innerHTML = `
      <h2 class="my-stats-heading">My Stats</h2>
      <p class="my-stats-subheading">A closer look at your vocabulary and practice history.</p>
    `;
    return card;
  }

  function createOverviewCard() {
    const streak = window.StreakAPI?.getState?.() ?? {
      count: 0,
      longestCount: 0,
    };
    const dueNow = window.WordGameHelpers?.getVocabProgressSummary?.().dueCount ?? 0;
    const dueThisWeek = getUpcomingDueCount(7);

    const card = document.createElement("section");
    card.className = "my-stats-box my-stats-overview";

    const heading = document.createElement("h3");
    heading.className = "my-stats-section-heading";
    heading.textContent = "Overview";
    card.appendChild(heading);

    const grid = document.createElement("div");
    grid.className = "game-summary-stats my-stats-overview-grid";
    grid.append(
      createStatTile(streak.count, "Day streak"),
      createStatTile(streak.longestCount, "Longest streak"),
      createStatTile(dueNow, "Due now"),
      createStatTile(dueThisWeek, "Due this week"),
    );
    card.appendChild(grid);

    const actionRow = document.createElement("div");
    actionRow.className = "my-stats-overview-action";

    const practiceBtn = document.createElement("button");
    practiceBtn.type = "button";
    practiceBtn.className = "game-summary-primary-btn";
    practiceBtn.textContent =
      dueNow > 0 ? "Practice due words" : "Practice now";
    practiceBtn.addEventListener("click", () => {
      selectType("word-game");
    });
    actionRow.appendChild(practiceBtn);
    card.appendChild(actionRow);

    return card;
  }

  function createVocabularyCard() {
    const { total, counts } = window.WordGameHelpers?.getVocabProgressSummary?.() ?? {
      total: 0,
      counts: [],
    };

    const card = document.createElement("section");
    card.className = "my-stats-box my-stats-vocabulary";

    if (total === 0) {
      card.innerHTML = `
        <h3 class="my-stats-section-heading">Vocabulary profile</h3>
        <p class="my-stats-empty">Play the Word Game to start building your vocabulary profile — words you practice will show up here, grouped by how well you know them.</p>
      `;
      return card;
    }

    card.innerHTML = `
      <div class="my-stats-vocabulary-header">
        <h3 class="my-stats-section-heading">Vocabulary profile</h3>
        <strong class="landing-progress-summary-count">${total.toLocaleString("en-US")} word${total === 1 ? "" : "s"}</strong>
      </div>
      <p class="my-stats-vocabulary-intro">Words you’ve practiced, grouped by how well you know them.</p>
      ${window.WordGameHelpers.buildVocabProgressBarMarkup(counts, total)}
      <a class="my-stats-see-all-link" href="?type=word-list">See all words</a>
    `;

    card
      .querySelector(".my-stats-see-all-link")
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        window.goToAllWords?.();
      });

    return card;
  }

  function createTroubleWordsCard() {
    const troubleEntries = getTroubleEntries();

    const card = document.createElement("section");
    card.className = "my-stats-box my-stats-trouble";

    const heading = document.createElement("h3");
    heading.className = "my-stats-section-heading";
    heading.textContent = "Words you’ve missed the most";
    card.appendChild(heading);

    if (troubleEntries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "my-stats-empty";
      empty.textContent =
        "No trouble words yet — nice work! Words you miss more than once will show up here.";
      card.appendChild(empty);
      return card;
    }

    const tableContainer = document.createElement("div");
    tableContainer.className =
      "word-list-table-container my-stats-trouble-table-container";

    const table = document.createElement("table");
    table.className = "word-list-table";
    table.setAttribute("aria-label", "Words you've missed the most");

    const tbody = document.createElement("tbody");
    const fragment = document.createDocumentFragment();
    troubleEntries.forEach((entry) => {
      fragment.appendChild(window.WordListAPI.createRow(entry));
    });
    tbody.appendChild(fragment);
    table.appendChild(tbody);
    tableContainer.appendChild(table);
    card.appendChild(tableContainer);

    return card;
  }

  function renderMyStats() {
    const container = getResultsContainer();
    if (!container) return;

    if (!Array.isArray(results) || results.length === 0) {
      const loadingMessage = document.createElement("div");
      loadingMessage.className = "definition";

      const heading = document.createElement("h2");
      heading.textContent = "Loading vocabulary";

      const explanation = document.createElement("p");
      explanation.textContent =
        "Your stats will be ready once the vocabulary data finishes loading.";

      loadingMessage.append(heading, explanation);
      container.appendChild(loadingMessage);
      return;
    }

    const section = document.createElement("section");
    section.id = "my-stats";
    section.className = "definition my-stats";
    section.append(
      createHeaderCard(),
      createOverviewCard(),
      createVocabularyCard(),
      createTroubleWordsCard(),
    );

    container.appendChild(section);
  }

  function initMyStats() {
    const typeSelect = document.getElementById("type-select");
    if (!typeSelect || typeSelect.value !== "my-stats") {
      return;
    }

    showLandingCard(false);
    clearContainer();
    renderMyStats();
  }

  window.initMyStats = initMyStats;
})();
