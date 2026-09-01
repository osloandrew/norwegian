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

  function createDataSourcesCard() {
    const card = document.createElement("section");
    card.className = "my-stats-box";
    card.innerHTML = `
      <h3 class="my-stats-section-heading">Data sources and acknowledgements</h3>
      <p class="my-stats-danger-text">
        Dictionary content includes input from <a href="https://sprakradet.no/" target="_blank" rel="noopener noreferrer">Språkrådet</a>,
        the <a href="https://www.uib.no/" target="_blank" rel="noopener noreferrer">University of Bergen</a>, and
        <a href="https://naob.no/" target="_blank" rel="noopener noreferrer">Det Norske Akademi for Språk og Litteratur</a>.
        When a lookup needs an official fallback, results come from
        <a href="https://ordbokene.no/" target="_blank" rel="noopener noreferrer">Bokmålsordboka</a>, published by Språkrådet and the University of Bergen.
      </p>
      <p class="my-stats-danger-text">
        Word forms are derived from <a href="https://ord.uib.no/ord_1_Ordlister.html" target="_blank" rel="noopener noreferrer">Norsk Ordbank – Bokmål</a>,
        maintained by the University of Bergen and Språkrådet, under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>.
        Synonym prompts are derived from the linked headwords in this dictionary's own definitions.
      </p>
      <p class="my-stats-danger-text">
        Vocabulary-frequency signals in the Word Game combine <a href="https://repo.clarino.uib.no/xmlui/handle/11509/157" target="_blank" rel="noopener noreferrer">CLARINO Norsk aviskorpus</a>
        (CC BY-NC 4.0), <a href="https://github.com/hermitdave/FrequencyWords" target="_blank" rel="noopener noreferrer">OpenSubtitles2018 via hermitdave/FrequencyWords</a>
        (CC BY-SA 4.0), and <a href="https://www.nb.no/sprakbanken/en/resource-catalogue/oai-nb-no-sbr-70/" target="_blank" rel="noopener noreferrer">NB N-gram digibok</a>
        from Nasjonalbiblioteket/Språkbanken (CC0).
      </p>
      <p class="my-stats-danger-text">
        Stories adapted from third-party work retain their source, author, and licence credit on the individual story.
      </p>
    `;
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
      createDataSourcesCard(),
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
