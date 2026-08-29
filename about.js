// About — a short, static page describing the site: what it does and where
// to leave feedback. No vocabulary data, no personal state — renders
// immediately regardless of dictionary-load state, unlike My Stats/Settings/
// Word List. Reuses the same "personal page" component classes as Settings
// (see settings.js's own comment on this) purely for visual consistency
// between the account menu's destinations.
(function () {
  "use strict";

  function getResultsContainer() {
    return document.getElementById("results-container");
  }

  function createHeaderCard() {
    const card = document.createElement("section");
    card.className = "my-stats-header";
    card.innerHTML = `
      <h2 class="my-stats-heading">About</h2>
      <p class="my-stats-subheading">What Norwegian Dictionary is, and where to send feedback.</p>
    `;
    return card;
  }

  // APP_ROOT_URL (scripts.js, loaded earlier) rather than a plain relative
  // href: this markup can render after a pushState has moved the address
  // bar to a pretty word/story path, and there's no <base> tag on the live
  // app shell to anchor a relative "updates/" correctly at that point — see
  // updateURL()'s own use of APP_ROOT_URL for the same reason.
  function createAboutCard() {
    const updatesHref = new URL("updates/", APP_ROOT_URL).href;

    const card = document.createElement("section");
    card.className = "my-stats-box";
    card.innerHTML = `
      <p class="my-stats-danger-text">
        Norwegian Dictionary is a free, browser-based tool for learning
        Norwegian — word and sentence search with audio, short stories at
        every CEFR level, and an adaptive Word Game with spaced repetition
        to help vocabulary stick.
      </p>
      <p class="my-stats-danger-text">
        It's built and maintained independently, with small improvements
        shipped regularly — see <a href="${updatesHref}">What's New</a> for
        the latest.
      </p>
    `;
    return card;
  }

  function createConnectCard() {
    const card = document.createElement("section");
    card.className = "my-stats-box";

    const heading = document.createElement("h3");
    heading.className = "my-stats-section-heading";
    heading.textContent = "Get in Touch";
    card.appendChild(heading);

    const description = document.createElement("p");
    description.className = "my-stats-danger-text";
    description.textContent =
      "Found a bug, or have an idea for something to add?";
    card.appendChild(description);

    const actionRow = document.createElement("div");
    actionRow.className = "my-stats-danger-action";

    const feedbackBtn = document.createElement("button");
    feedbackBtn.type = "button";
    feedbackBtn.className = "my-stats-danger-btn";
    feedbackBtn.textContent = "Send Feedback";
    feedbackBtn.addEventListener("click", () => {
      window.openGeneralFeedbackDialog?.(feedbackBtn);
    });

    actionRow.appendChild(feedbackBtn);
    card.appendChild(actionRow);

    return card;
  }

  function renderAbout() {
    const container = getResultsContainer();
    if (!container) return;

    const section = document.createElement("section");
    section.id = "about";
    section.className = "definition account-page";
    section.append(
      createHeaderCard(),
      createAboutCard(),
      createConnectCard(),
    );

    container.appendChild(section);
  }

  function initAbout() {
    if (getCurrentMode() !== "about") {
      return;
    }

    showLandingCard(false);
    clearContainer();
    renderAbout();
  }

  window.initAbout = initAbout;
})();
