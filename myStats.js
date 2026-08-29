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
// "Source Sans 3" (see the comment above .my-stats in the shell/landing/stats
// stylesheet for why that has to be explicit, not inherited).
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

  // Records are now multi-skill memories (see spacedRepetition.js's
  // normalizeMemory: { skills: { recognition, production, listening,
  // context }, updatedAt }) rather than a single scheduled record, so
  // there's no top-level dueAt to compare directly. Reuse
  // SpacedRepetition.getSnapshot the same way wordGame.js's
  // getVocabProgressSummary does — its aggregate `isDue` is already true
  // when any practiced skill is due — evaluated once at `now` and once at
  // the horizon so "due this week" excludes words already due now.
  function getUpcomingDueCount(days, now = Date.now()) {
    const dayMs = window.SpacedRepetition?.DAY_MS ?? 24 * 60 * 60 * 1000;
    const horizon = now + days * dayMs;
    const records = Object.values(window.WordStrengthAPI?.getAll?.() ?? {});
    const isDueBy = (record, timestamp) =>
      Boolean(window.SpacedRepetition?.getSnapshot?.(record, timestamp)?.isDue);

    return records.filter(
      (record) => !isDueBy(record, now) && isDueBy(record, horizon),
    ).length;
  }

  // A memory's lapses are tracked per skill (see spacedRepetition.js's
  // scheduleIncorrect), so a word's total is the sum across whichever
  // skills it's been practiced in.
  function getTotalLapses(record) {
    return Object.values(record?.skills ?? {}).reduce(
      (sum, skillRecord) => sum + (skillRecord?.lapses ?? 0),
      0,
    );
  }

  // Every word ever missed at least once, ranked by how many times.
  function getTroubleEntries(limit = MAX_TROUBLE_WORDS_SHOWN) {
    const allRecords = window.WordStrengthAPI?.getAll?.() ?? {};

    return Object.entries(allRecords)
      .map(([entryId, record]) => [entryId, getTotalLapses(record)])
      .filter(([, lapses]) => lapses > 0)
      .sort((a, b) => b[1] - a[1])
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
    const bestWordStreak = window.BestWordStreakAPI?.getState?.() ?? 0;
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
      createStatTile(streak.count, "Day Streak"),
      createStatTile(streak.longestCount, "Longest Streak"),
      createStatTile(bestWordStreak, "Best Word Streak"),
      createStatTile(dueNow, "Due Now"),
      createStatTile(dueThisWeek, "Due This Week"),
    );
    card.appendChild(grid);

    const actionRow = document.createElement("div");
    actionRow.className = "my-stats-overview-action";

    const practiceBtn = document.createElement("button");
    practiceBtn.type = "button";
    practiceBtn.className = "game-summary-primary-btn";
    practiceBtn.textContent =
      dueNow > 0 ? "Practice Due Words" : "Practice Now";
    practiceBtn.addEventListener("click", () => {
      selectType("word-game");
    });
    actionRow.appendChild(practiceBtn);
    card.appendChild(actionRow);

    return card;
  }

  // Lifetime count of daily-quest gems earned (see completeDailyQuestRound()
  // in wordGame.js) — a running total that, unlike completedRounds, never
  // resets when the day rolls over.
  function createGemsCard() {
    const gemCounts = window.DailyQuestAPI?.getState?.()?.gemCounts ?? {};
    // Keyed off gemCounts' own keys (always all three reward types once
    // normalized -- see normalizeDailyPracticeState in wordGame.js) rather
    // than reaching into wordGame.js's DAILY_QUESTS directly, so this
    // keeps to the same "read an *API, don't reach into internals"
    // convention as the rest of this file.
    const rewards = Object.keys(gemCounts);
    const total = rewards.reduce((sum, reward) => sum + (gemCounts[reward] ?? 0), 0);

    const card = document.createElement("section");
    card.className = "my-stats-box my-stats-gems";
    card.innerHTML = `
      <div class="my-stats-gems-header">
        <h3 class="my-stats-section-heading">Gems Earned</h3>
        <strong class="landing-progress-summary-count">${total.toLocaleString("en-US")} total</strong>
      </div>
      <div class="my-stats-gems-row">
        ${rewards
          .map(
            (reward) => `
          <div class="my-stats-gems-tile">
            ${getDailyQuestGemMarkup(reward, "my-stats-gems-icon")}
            <p class="game-summary-stat-value">${(gemCounts[reward] ?? 0).toLocaleString("en-US")}</p>
            <p class="game-summary-stat-label">${reward.charAt(0).toUpperCase()}${reward.slice(1)}</p>
          </div>
        `,
          )
          .join("")}
      </div>
    `;

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
        <h3 class="my-stats-section-heading">Vocabulary Profile</h3>
        <p class="my-stats-empty">Play the Word Game to start building your vocabulary profile — words you practice will show up here, grouped by how well you know them.</p>
      `;
      return card;
    }

    card.innerHTML = `
      <div class="my-stats-vocabulary-header">
        <h3 class="my-stats-section-heading">Vocabulary Profile</h3>
        <strong class="landing-progress-summary-count">${total.toLocaleString("en-US")} word${total === 1 ? "" : "s"}</strong>
      </div>
      <p class="my-stats-vocabulary-intro">Words you’ve practiced, grouped by how well you know them.</p>
      ${window.WordGameHelpers.buildVocabProgressBarMarkup(counts, total)}
      <a class="my-stats-see-all-link" href="?type=word-list">See All Words</a>
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
    heading.textContent = "Words You’ve Missed the Most";
    card.appendChild(heading);

    if (troubleEntries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "my-stats-empty";
      empty.textContent =
        "No trouble words yet — nice work! Words you miss more than once will show up here.";
      card.appendChild(empty);
      return card;
    }

    const tableContainer = window.WordListAPI.createList(troubleEntries, {
      ariaLabel: "Words you've missed the most",
      containerClass: "my-stats-trouble-table-container",
    });
    card.appendChild(tableContainer);

    return card;
  }

  // The one destructive action on this page, split out into its own visually
  // distinct box (danger colors, bottom of the page) rather than folded into
  // the Overview card above — someone scanning their stats shouldn't stumble
  // into an irreversible action sitting next to "Practice Now".
  function createDangerZoneCard() {
    const card = document.createElement("section");
    card.className = "my-stats-box my-stats-danger";

    const heading = document.createElement("h3");
    heading.className = "my-stats-section-heading";
    heading.textContent = "Danger Zone";
    card.appendChild(heading);

    const description = document.createElement("p");
    description.className = "my-stats-danger-text";
    description.textContent =
      "Permanently delete your saved words, practice history, streaks, and quest progress — including from your account if you're signed in. This can't be undone.";
    card.appendChild(description);

    const actionRow = document.createElement("div");
    actionRow.className = "my-stats-danger-action";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "my-stats-danger-btn";
    resetBtn.textContent = "Reset My Progress";
    resetBtn.addEventListener("click", async () => {
      const confirmed = window.confirm(
        "Reset all your Word Game progress? This deletes your saved words, " +
          "practice history, streaks, and daily quest progress everywhere " +
          "you're signed in. This can't be undone.",
      );
      if (!confirmed) return;

      window.trackEvent?.("reset_progress");
      resetBtn.disabled = true;
      resetBtn.textContent = "Resetting…";

      try {
        await window.ProgressResetAPI?.resetAllProgress?.();
      } catch (error) {
        console.warn("Progress reset failed.", error);
        window.alert(
          "Your progress could not be reset. Please check your connection and try again.",
        );
        resetBtn.disabled = false;
        resetBtn.textContent = "Reset My Progress";
      }
    });

    actionRow.appendChild(resetBtn);
    card.appendChild(actionRow);

    return card;
  }

  function renderMyStats() {
    const container = getResultsContainer();
    if (!container) return;

    if (!Array.isArray(results) || results.length === 0) {
      const loadingMessage = document.createElement("div");
      loadingMessage.className = "definition";

      const heading = document.createElement("h2");
      heading.textContent = "Loading Vocabulary";

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
      createGemsCard(),
      createVocabularyCard(),
      createTroubleWordsCard(),
      createDangerZoneCard(),
    );

    container.appendChild(section);
  }

  function initMyStats() {
    if (getCurrentMode() !== "my-stats") {
      return;
    }

    showLandingCard(false);
    clearContainer();
    renderMyStats();
  }

  window.initMyStats = initMyStats;
})();
