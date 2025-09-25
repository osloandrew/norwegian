// pronunciation.js

// State for this module
let pronunciationResults = [];
let pronunciationEnglishVisible = true;

function buildPronAudioUrl(sentenceText) {
  return `/Resources/Sentences/${sentenceText.trim().replace(/\?$/, "")}.m4a`;
}

// Entry point: called when Pronunciation tab is activated
function initPronunciation() {
  console.log("Pronunciation module loaded");
  randomWord(); // 👈 use the same engine as the rest of the app

  if (!results.length) {
    console.warn("No dictionary data loaded yet");
    return;
  }

  // Show a random sentence on entry
  showRandomPronunciation();
}

function showRandomPronunciation() {
  const sentenceEntries = results.filter(
    (r) => r.eksempel && r.hasAudio === "X"
  );
  if (!sentenceEntries.length) {
    resultsContainer.innerHTML = "<p>No sentences available.</p>";
    return;
  }

  const randomEntry =
    sentenceEntries[Math.floor(Math.random() * sentenceEntries.length)];

  // Generate CEFR badge
  let cefrLabel = "";
  switch (randomEntry.CEFR) {
    case "A1":
      cefrLabel = '<div class="sentence-cefr-label easy">A1</div>';
      break;
    case "A2":
      cefrLabel = '<div class="sentence-cefr-label easy">A2</div>';
      break;
    case "B1":
      cefrLabel = '<div class="sentence-cefr-label medium">B1</div>';
      break;
    case "B2":
      cefrLabel = '<div class="sentence-cefr-label medium">B2</div>';
      break;
    case "C":
      cefrLabel = '<div class="sentence-cefr-label hard">C</div>';
      break;
  }

  // Clean sentence (strip old highlights if any)
  const cleanedEksempel = randomEntry.eksempel.replace(
    /<span[^>]*>(.*?)<\/span>/gi,
    "$1"
  );

  const selectedNorwegian = cleanedEksempel.trim();
  const selectedTranslation = randomEntry.sentenceTranslation || "";

  // Build audio URL using the whole sentence
  const audioFile = buildPronAudioUrl(selectedNorwegian);
  console.log("Pronunciation audio src →", audioFile);

  // Build sentence HTML
  let sentenceHTML = `
    <div class="result-header">
      <h2>Random Pronunciation Sentence</h2>
    </div>
    <button class="sentence-btn english-toggle-btn" onclick="toggleEnglishTranslations(this)">
      ${pronunciationEnglishVisible ? "Hide English" : "Show English"}
    </button>
    <div class="sentence-container">
      <div class="sentence-box-norwegian ${
        !pronunciationEnglishVisible ? "sentence-box-norwegian-hidden" : ""
      }">
        <div class="sentence-content">
          ${cefrLabel}
          <p class="sentence">${selectedNorwegian}</p>
          <audio controls autoplay onerror="showRandomPronunciation()">
            <source src="${audioFile}" type="audio/mp4">
            <source src="${audioFile}">
          </audio>
        </div>
      </div>
  `;

  if (selectedTranslation) {
    sentenceHTML += `
      <div class="sentence-box-english" style="display: ${
        pronunciationEnglishVisible ? "block" : "none"
      };">
        <p class="sentence">${selectedTranslation}</p>
      </div>
    `;
  }

  sentenceHTML += "</div>"; // close .sentence-container

  resultsContainer.innerHTML = sentenceHTML;
}
