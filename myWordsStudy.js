(function () {
  "use strict";

  const STUDY_STORAGE_KEY = "norwegian-dictionary-my-words-study-v1";
  const DAY_IN_MS = 24 * 60 * 60 * 1000;
  const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60];

  const MAX_WORDS_PER_SESSION = 15;
  const MAX_NEW_WORDS_PER_SESSION = 5;
  const REQUEUE_GAP = 2;

  let session = null;

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeAnswer(value) {
    return String(value ?? "")
      .trim()
      .toLocaleLowerCase("en")
      .normalize("NFC");
  }

  function firstValue(value) {
    return String(value ?? "")
      .split(",")[0]
      .trim();
  }

  function loadStudyStore() {
    try {
      const storedValue = window.localStorage.getItem(STUDY_STORAGE_KEY);

      if (!storedValue) {
        return {
          version: 1,
          records: {},
        };
      }

      const parsedValue = JSON.parse(storedValue);

      if (
        !parsedValue ||
        typeof parsedValue !== "object" ||
        !parsedValue.records ||
        typeof parsedValue.records !== "object"
      ) {
        return {
          version: 1,
          records: {},
        };
      }

      return {
        version: 1,
        records: parsedValue.records,
      };
    } catch (error) {
      console.warn("My Words study progress could not be loaded.", error);

      return {
        version: 1,
        records: {},
      };
    }
  }

  function saveStudyStore(store) {
    try {
      window.localStorage.setItem(STUDY_STORAGE_KEY, JSON.stringify(store));
    } catch (error) {
      console.warn("My Words study progress could not be saved.", error);
    }
  }

  function createDefaultRecord() {
    return {
      stage: 0,
      successfulSessions: 0,
      lapses: 0,
      dueAt: 0,
      lastReviewedAt: 0,
      lastResult: "new",
      state: "new",
    };
  }

  function getRecord(entryId) {
    if (!session.store.records[entryId]) {
      session.store.records[entryId] = createDefaultRecord();
    }

    return session.store.records[entryId];
  }

  function shuffleCopy(values) {
    const copy = values.slice();
    const helpers = window.WordGameHelpers;

    if (helpers && typeof helpers.shuffleArray === "function") {
      return helpers.shuffleArray(copy);
    }

    for (let index = copy.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));

      [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
    }

    return copy;
  }

  function buildSessionItems(savedEntries, store) {
    const now = Date.now();
    const dueEntries = [];
    const newEntries = [];

    savedEntries.forEach((savedEntry) => {
      if (!savedEntry.entry?.ord || !savedEntry.entry?.engelsk) {
        return;
      }

      const record = store.records[savedEntry.entryId];

      if (!record) {
        newEntries.push(savedEntry);
        return;
      }

      const dueAt = Number(record.dueAt) || 0;

      if (dueAt <= now) {
        dueEntries.push({
          ...savedEntry,
          dueAt,
        });
      }
    });

    // The most overdue words come first.
    dueEntries.sort((first, second) => first.dueAt - second.dueAt);

    const selectedEntries = dueEntries.slice(0, MAX_WORDS_PER_SESSION);

    const spacesRemaining = MAX_WORDS_PER_SESSION - selectedEntries.length;

    const newWordLimit = Math.min(MAX_NEW_WORDS_PER_SESSION, spacesRemaining);

    selectedEntries.push(...newEntries.slice(0, newWordLimit));

    /*
     * A new word must be answered correctly twice when there are
     * enough saved words to place other questions between attempts.
     */
    const requireTwoCorrectAnswers = savedEntries.length >= 3;

    return selectedEntries.map((savedEntry) => {
      const record = store.records[savedEntry.entryId];
      const isNew = !record || Number(record.successfulSessions) === 0;

      return {
        entryId: savedEntry.entryId,
        entry: savedEntry.entry,
        isNew,
        correctThisSession: 0,
        requiredCorrect: isNew && requireTwoCorrectAnswers ? 2 : 1,
      };
    });
  }

  function getDisplayedWordClass(entry) {
    const value = String(entry.gender ?? "").trim();
    const lowerValue = value.toLocaleLowerCase("nb-NO");

    if (/^(en|ei|et)(?:$|[-/,\s])/.test(lowerValue)) {
      return `N - ${lowerValue.replace(/^noun\s*-\s*/, "")}`;
    }

    const shortLabels = {
      adjective: "Adj",
      adverb: "Adv",
      conjunction: "Conj",
      determiner: "Det",
      expression: "Exp",
      interjection: "Inter",
      numeral: "Num",
      possessive: "Poss",
      preposition: "Prep",
      pronoun: "Pron",
      verb: "Verb",
    };

    const matchingKey = Object.keys(shortLabels).find((key) =>
      lowerValue.startsWith(key),
    );

    return matchingKey ? shortLabels[matchingKey] : value || "Word";
  }

  function getCEFRMarkup(entry) {
    const level = String(entry.CEFR ?? "")
      .trim()
      .toUpperCase();

    if (!level) {
      return "";
    }

    let levelClass = "hard";

    if (level === "A1" || level === "A2") {
      levelClass = "easy";
    } else if (level === "B1" || level === "B2") {
      levelClass = "medium";
    }

    return `
      <div class="game-cefr-label ${levelClass}">
        ${escapeHTML(level)}
      </div>
    `;
  }

  function buildTranslationChoices(entry) {
    const correctTranslation = String(entry.engelsk ?? "").trim();

    const correctDisplay = firstValue(correctTranslation);
    let incorrectTranslations = [];

    try {
      incorrectTranslations = window.WordGameHelpers.fetchIncorrectTranslations(
        entry.gender,
        correctTranslation,
        entry.CEFR,
      );
    } catch (error) {
      console.warn("Distractors could not be generated for this word.", error);
    }

    const uniqueChoices = [];
    const seenChoices = new Set();

    [correctTranslation, ...incorrectTranslations].forEach((translation) => {
      const displayedTranslation = firstValue(translation);
      const normalizedTranslation = normalizeAnswer(displayedTranslation);

      if (!displayedTranslation || seenChoices.has(normalizedTranslation)) {
        return;
      }

      seenChoices.add(normalizedTranslation);
      uniqueChoices.push(displayedTranslation);
    });

    if (!seenChoices.has(normalizeAnswer(correctDisplay))) {
      uniqueChoices.unshift(correctDisplay);
    }

    return shuffleCopy(uniqueChoices.slice(0, 4));
  }

  function hideWordListControlsForStudy() {
    const selectors = [
      "#search-bar-wrapper",
      "#random-btn",
      ".pos-filter",
      ".cefr-filter",
      "#genre-filter",
      "#game-english-filter",
    ];

    selectors.forEach((selector) => {
      const element = document.querySelector(selector);

      if (element) {
        element.style.display = "none";
      }
    });

    const searchContainerInner = document.getElementById(
      "search-container-inner",
    );

    searchContainerInner?.classList.add("my-words-study-active");
  }

  function returnToMyWords() {
    window.WordGameHelpers?.stopAllAudio?.();

    session = null;

    const searchContainerInner = document.getElementById(
      "search-container-inner",
    );

    searchContainerInner?.classList.remove("my-words-study-active");

    if (window.MyWordsAPI?.returnToMyWords) {
      window.MyWordsAPI.returnToMyWords();
    }
  }

  function renderShell() {
    const resultsContainer = document.getElementById("results-container");

    if (!resultsContainer) {
      return false;
    }

    resultsContainer.innerHTML = `
      <div class="my-words-study-toolbar">
        <button
          type="button"
          id="my-words-study-back"
          class="word-list-export-button"
        >
          <i
            class="fas fa-chevron-left"
            aria-hidden="true"
          ></i>
          Back to My Words
        </button>

        <p
          id="my-words-study-progress"
          class="my-words-study-progress"
        ></p>
      </div>

      <div id="my-words-study-content"></div>
    `;

    document
      .getElementById("my-words-study-back")
      ?.addEventListener("click", returnToMyWords);

    return true;
  }

  function updateProgress() {
    const progress = document.getElementById("my-words-study-progress");

    if (!progress || !session) {
      return;
    }

    progress.textContent =
      `${session.completedCount} of ` + `${session.totalCount} learned today`;
  }

  function getNextDueDate(savedEntries, store) {
    const now = Date.now();

    const futureDates = savedEntries
      .map(({ entryId }) => Number(store.records[entryId]?.dueAt))
      .filter((dueAt) => Number.isFinite(dueAt) && dueAt > now);

    if (futureDates.length === 0) {
      return "";
    }

    const nextDueAt = Math.min(...futureDates);

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(nextDueAt));
  }

  function renderMessage(title, message, showRestartButton = false) {
    const content = document.getElementById("my-words-study-content");

    if (!content) {
      return;
    }

    content.innerHTML = `
      <section
        class="
          definition
          multiple-results-definition
          my-words-study-message
        "
      >
        <h2>${escapeHTML(title)}</h2>
        <p>${escapeHTML(message)}</p>

        ${
          showRestartButton
            ? `
              <button
                type="button"
                id="my-words-study-again"
                class="word-list-export-button"
              >
                Study More Words
              </button>
            `
            : ""
        }
      </section>
    `;

    document
      .getElementById("my-words-study-again")
      ?.addEventListener("click", startMyWordsStudy);
  }

  function completeItem(item) {
    const record = getRecord(item.entryId);

    const oldStage = Math.max(
      0,
      Math.min(REVIEW_INTERVAL_DAYS.length - 1, Number(record.stage) || 0),
    );

    const intervalDays = REVIEW_INTERVAL_DAYS[oldStage];

    const now = Date.now();

    record.stage = Math.min(oldStage + 1, REVIEW_INTERVAL_DAYS.length);

    record.successfulSessions = (Number(record.successfulSessions) || 0) + 1;

    record.dueAt = now + intervalDays * DAY_IN_MS;

    record.lastReviewedAt = now;
    record.lastResult = "correct";

    record.state = record.stage >= 5 ? "mastered" : "review";

    saveStudyStore(session.store);

    session.completedCount += 1;
  }

  function recordIncorrectAnswer(item) {
    const record = getRecord(item.entryId);
    const now = Date.now();

    record.stage = Math.max(0, (Number(record.stage) || 0) - 1);

    record.lapses = (Number(record.lapses) || 0) + 1;

    record.dueAt = now;
    record.lastReviewedAt = now;
    record.lastResult = "incorrect";
    record.state = "learning";

    saveStudyStore(session.store);
  }

  function requeueCurrentItem() {
    if (!session?.currentItem) {
      return;
    }

    const insertionIndex = Math.min(REQUEUE_GAP, session.queue.length);

    session.queue.splice(insertionIndex, 0, session.currentItem);
  }

  function finishCurrentAnswer() {
    if (!session?.currentItem || !session.pendingAction) {
      return;
    }

    window.WordGameHelpers.stopAllAudio();

    if (session.pendingAction === "complete") {
      completeItem(session.currentItem);
    } else {
      requeueCurrentItem();
    }

    session.currentItem = null;
    session.pendingAction = null;

    renderNextQuestion();
  }

  function handleChoice(choice, selectedButton) {
    if (!session?.currentItem || session.answerLocked) {
      return;
    }

    session.answerLocked = true;

    const item = session.currentItem;
    const correctAnswer = firstValue(item.entry.engelsk);

    const isCorrect =
      normalizeAnswer(choice) === normalizeAnswer(correctAnswer);

    const buttons = document.querySelectorAll(".my-words-study-choice");

    const feedback = document.getElementById("my-words-study-feedback");

    const nextButton = document.getElementById("game-next-word-button");

    buttons.forEach((button) => {
      const buttonIsCorrect =
        normalizeAnswer(button.dataset.choice) ===
        normalizeAnswer(correctAnswer);

      button.disabled = true;

      if (buttonIsCorrect) {
        button.classList.add("game-correct-card");
      } else if (button === selectedButton) {
        button.classList.add("game-incorrect-card");
      } else {
        button.classList.add("distractor-muted");
      }
    });

    if (isCorrect) {
      item.correctThisSession += 1;

      if (item.correctThisSession >= item.requiredCorrect) {
        session.pendingAction = "complete";
        nextButton.textContent = "Next Word";
      } else {
        session.pendingAction = "requeue";
        nextButton.textContent = "See It Again Later";
      }

      if (feedback) {
        const remaining = item.requiredCorrect - item.correctThisSession;

        feedback.innerHTML = remaining
          ? `
            <p>
              <strong>Correct.</strong>
              You will see this new word once more.
            </p>
          `
          : `
            <p>
              <strong>Correct.</strong>
              ${escapeHTML(firstValue(item.entry.ord))}
              means ${escapeHTML(correctAnswer)}.
            </p>
          `;
      }
    } else {
      item.correctThisSession = 0;
      session.pendingAction = "requeue";

      recordIncorrectAnswer(item);

      nextButton.textContent = "Try Again Later";

      if (feedback) {
        feedback.innerHTML = `
          <p>
            <strong>Not quite.</strong>
            ${escapeHTML(firstValue(item.entry.ord))}
            means ${escapeHTML(correctAnswer)}.
          </p>
        `;
      }
    }

    nextButton.disabled = false;
    nextButton.focus();
  }

  function renderQuestion(item) {
    const content = document.getElementById("my-words-study-content");

    if (!content) {
      return;
    }

    const entry = item.entry;
    const displayedWord = firstValue(entry.ord);
    const choices = buildTranslationChoices(entry);

    content.innerHTML = `
      <div
        class="
          game-word-card
          my-words-study-word-card
        "
      >
        <div class="game-labels-container">
          <div class="game-label-subgroup">
            <div class="game-gender">
              ${escapeHTML(getDisplayedWordClass(entry))}
            </div>

            ${getCEFRMarkup(entry)}
          </div>

          <button
            type="button"
            id="my-words-study-audio"
            class="my-words-study-audio"
            aria-label="
              Play pronunciation of
              ${escapeHTML(displayedWord)}
            "
            title="Play pronunciation"
          >
            <i
              class="fas fa-volume-high"
              aria-hidden="true"
            ></i>
          </button>

<div class="game-label-subgroup">
  <div class="my-words-study-pass-label">
    ${item.requiredCorrect === 2 ? "New word · pass twice" : "Review"}
  </div>
</div>
        </div>

        <div class="game-word">
          <h2>${escapeHTML(displayedWord)}</h2>
        </div>

        <div
          id="my-words-study-feedback"
          class="
            game-cefr-spacer
            my-words-study-feedback
          "
          aria-live="polite"
        ></div>
      </div>

      <div
        class="game-grid"
        aria-label="Choose the English meaning"
      >
        ${choices
          .map(
            (choice) => `
              <button
                type="button"
                class="
                  game-translation-card
                  my-words-study-choice
                "
                data-choice="${escapeHTML(choice)}"
              >
                ${escapeHTML(choice)}
              </button>
            `,
          )
          .join("")}
      </div>

      <div class="game-next-button-container">
        <button
          type="button"
          id="game-next-word-button"
          disabled
        >
          Choose an Answer
        </button>
      </div>
    `;

    document.querySelectorAll(".my-words-study-choice").forEach((button) => {
      button.addEventListener("click", () => {
        handleChoice(button.dataset.choice, button);
      });
    });

    document
      .getElementById("game-next-word-button")
      ?.addEventListener("click", finishCurrentAnswer);

    document
      .getElementById("my-words-study-audio")
      ?.addEventListener("click", () => {
        window.WordGameHelpers.stopAllAudio();
        window.WordGameHelpers.playWordAudio(entry);
      });

    window.WordGameHelpers.stopAllAudio();
    window.WordGameHelpers.playWordAudio(entry);
  }

  function renderNextQuestion() {
    if (!session) {
      return;
    }

    updateProgress();

    if (session.queue.length === 0) {
      const nextDueDate = getNextDueDate(session.savedEntries, session.store);

      const message = nextDueDate
        ? `You completed ${session.completedCount} words. ` +
          `Your next review is due ${nextDueDate}.`
        : `You completed ${session.completedCount} words.`;

      renderMessage("Session complete", message, true);

      return;
    }

    session.currentItem = session.queue.shift();
    session.answerLocked = false;
    session.pendingAction = null;

    renderQuestion(session.currentItem);
  }

  function startMyWordsStudy() {
    const api = window.MyWordsAPI;
    const helpers = window.WordGameHelpers;

    if (!api?.getSavedEntries || !api?.returnToMyWords) {
      console.error("MyWordsAPI is not available.");
      return;
    }

    if (
      !helpers?.fetchIncorrectTranslations ||
      !helpers?.playWordAudio ||
      !helpers?.stopAllAudio
    ) {
      console.error("WordGameHelpers is not available.");

      return;
    }

    helpers.stopAllAudio();
    hideWordListControlsForStudy();

    if (typeof showLandingCard === "function") {
      showLandingCard(false);
    }

    const savedEntries = api.getSavedEntries();
    const store = loadStudyStore();

    const queue = buildSessionItems(savedEntries, store);

    session = {
      savedEntries,
      store,
      queue,
      currentItem: null,
      answerLocked: false,
      pendingAction: null,
      completedCount: 0,
      totalCount: queue.length,
    };

    if (!renderShell()) {
      return;
    }

    updateProgress();

    if (savedEntries.length === 0) {
      renderMessage(
        "No saved words yet",
        "Return to All Words and use the star " + "to add words to My Words.",
      );
    } else if (queue.length === 0) {
      const nextDueDate = getNextDueDate(savedEntries, store);

      const message = nextDueDate
        ? `Your next review is due ${nextDueDate}.`
        : "There are no words due for review right now.";

      renderMessage("You’re all caught up", message, true);
    } else {
      renderNextQuestion();
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  window.startMyWordsStudy = startMyWordsStudy;
})();
