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

  // English translation box if available
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

  // 🔹 New dedicated practice box
  sentenceHTML += `
  <div class="sentence-box-practice">
    <div class="sentence-content">
      <h3>Practice</h3>
      <div class="practice-row">
        <div class="native-col">
          <p><strong>Native</strong></p>
          <div id="waveform"></div>
        </div>
        <div class="user-col">
          <p><strong>You</strong></p>
          <div id="user-waveform"></div>
          <div id="user-playback"></div>
        </div>
      </div>
      <div id="recording-controls">
        <button id="start-recording">🎙️ Start Recording</button>
        <button id="stop-recording" disabled>⏹️ Stop Recording</button>
        <button id="reset-recording" disabled>🔄 Reset</button>
      </div>
    </div>
  </div>
</div> <!-- close .sentence-container -->
`;

  resultsContainer.innerHTML = sentenceHTML;
  // Visualize native audio
  const wavesurfer = WaveSurfer.create({
    container: "#waveform",
    waveColor: "#ccc",
    progressColor: "#007bff",
    height: 80,
  });
  wavesurfer.load(audioFile);
  let mediaRecorder;
  let recordedChunks = [];

  const startBtn = document.getElementById("start-recording");
  const stopBtn = document.getElementById("stop-recording");
  const resetBtn = document.getElementById("reset-recording");

  startBtn.addEventListener("click", async () => {
    recordedChunks = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);

      // Destroy any previous waveform if it exists
      if (window.userWave && window.userWave.destroy) {
        window.userWave.destroy();
      }

      // Create user waveform
      window.userWave = WaveSurfer.create({
        container: "#user-waveform",
        waveColor: "#ccc",
        progressColor: "#28a745",
        height: 80,
      });
      window.userWave.load(url);

      // Playback button below waveform
      document.getElementById(
        "user-playback"
      ).innerHTML = `<audio controls src="${url}"></audio>`;

      resetBtn.disabled = false;
    };

    mediaRecorder.start();
    startBtn.disabled = true;
    stopBtn.disabled = false;
    resetBtn.disabled = true;
  });

  stopBtn.addEventListener("click", () => {
    mediaRecorder.stop();
    startBtn.disabled = false;
    stopBtn.disabled = true;
  });

  resetBtn.addEventListener("click", () => {
    // Clear user waveform + playback
    document.getElementById("user-waveform").innerHTML = "";
    document.getElementById("user-playback").innerHTML = "";

    // Reset button states
    startBtn.disabled = false;
    stopBtn.disabled = true;
    resetBtn.disabled = true;
  });
}
