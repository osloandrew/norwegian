// State for this module
let pronunciationResults = [];

function buildPronAudioUrl(sentenceText) {
  return `/Resources/Sentences/${sentenceText.trim().replace(/\?$/, "")}.m4a`;
}

async function computeSimilarity(nativeUrl, userUrl) {
  const [nativeBuf, userBuf] = await Promise.all([
    fetch(nativeUrl).then((r) => r.arrayBuffer()),
    fetch(userUrl).then((r) => r.arrayBuffer()),
  ]);

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const [nativeAudio, userAudio] = await Promise.all([
    ctx.decodeAudioData(nativeBuf),
    ctx.decodeAudioData(userBuf),
  ]);

  // Grab first channel data
  const nativeData = nativeAudio.getChannelData(0);
  const userData = userAudio.getChannelData(0);

  // Normalize length by resampling (downsample to ~1000 points)
  function downsample(data, targetLength = 1000) {
    const blockSize = Math.floor(data.length / targetLength);
    const arr = [];
    for (let i = 0; i < targetLength; i++) {
      arr.push(Math.abs(data[i * blockSize] || 0));
    }
    return arr;
  }

  const n = downsample(nativeData);
  const u = downsample(userData, n.length);

  // Compute cosine similarity
  let dot = 0,
    normN = 0,
    normU = 0;
  for (let i = 0; i < n.length; i++) {
    dot += n[i] * u[i];
    normN += n[i] * n[i];
    normU += u[i] * u[i];
  }
  const score = dot / (Math.sqrt(normN) * Math.sqrt(normU));
  return Math.round(score * 100); // %
}

// Entry point: called when Pronunciation tab is activated
function initPronunciation() {
  showLandingCard(false);
  console.log("Pronunciation module loaded");

  if (!results.length) {
    console.warn("No dictionary data loaded yet");
    return;
  }

  // Show a random sentence on entry
  showRandomPronunciation();
}

function showRandomPronunciation() {
  const selectedCEFR = document.getElementById("cefr-select")
    ? document.getElementById("cefr-select").value.toUpperCase()
    : "";
  // Filter by audio + CEFR
  const sentenceEntries = results.filter(
    (r) =>
      r.eksempel &&
      r.hasAudio === "X" &&
      (!selectedCEFR || (r.CEFR && r.CEFR.toUpperCase() === selectedCEFR))
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
  <button class="sentence-btn english-toggle-btn" onclick="toggleEnglishTranslations(this)">
    ${isEnglishVisible ? "Hide English" : "Show English"}
  </button>
  <div class="sentence-container">
    <div class="sentence-box-norwegian ${
      !isEnglishVisible ? "sentence-box-norwegian-hidden" : ""
    }">
      <div class="sentence-content">
        ${cefrLabel}
        <p class="sentence">${selectedNorwegian}</p>
      </div>
    </div>
`;

  // English translation box if available
  if (selectedTranslation) {
    sentenceHTML += `
    <div class="sentence-box-english" style="display: ${
      isEnglishVisible ? "block" : "none"
    };">
      <p class="sentence">${selectedTranslation}</p>
    </div>
  `;
  }

  sentenceHTML += "</div>"; // close .sentence-container

  // 🔹 New dedicated practice box
  sentenceHTML += `
<div class="sentence-box-practice">
    <div class="practice-row">
      <div class="native-col">
        <p class="practice-row-header">Native</p>
        <div id="waveform"></div>
        <div class="native-controls">
          <button id="native-play">▶️ Play</button>
          <button id="native-pause">⏸️ Pause</button>
        </div>
      </div>
      <div class="user-col">
        <p class="practice-row-header">You</p>
        <div id="user-waveform"></div>
        <div class="user-controls">
          <button id="user-play" disabled>▶️ Play</button>
          <button id="user-pause" disabled>⏸️ Pause</button>
          <button id="start-recording">🎙️ Start Recording</button>
          <button id="stop-recording" disabled>⏹️ Stop Recording</button>
          <button id="reset-recording" disabled>🔄 Reset</button>
        </div>
      </div>
    </div>
      <div id="comparison-score" style="text-align:center; margin-top:10px;">
    🎯 Similarity Score: –
  </div>
</div>
`;

  resultsContainer.innerHTML = sentenceHTML;

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

      if (window.wavesurferUser && window.wavesurferUser.destroy) {
        window.wavesurferUser.destroy();
      }

      window.wavesurferUser = WaveSurfer.create({
        container: "#user-waveform",
        waveColor: "#ccc",
        progressColor: "#28a745",
        height: 80,
        cursorColor: "#28a745",
      });
      window.wavesurferUser.load(url);

      computeSimilarity(audioFile, url).then((score) => {
        document.getElementById(
          "comparison-score"
        ).textContent = `🎯 Similarity Score: ${score}%`;
      });

      // Enable playback + reset
      const playBtn = document.getElementById("user-play");
      const pauseBtn = document.getElementById("user-pause");

      playBtn.disabled = false;
      pauseBtn.disabled = false;
      resetBtn.disabled = false;

      // 🔹 Hook up handlers
      playBtn.onclick = () => window.wavesurferUser.play();
      pauseBtn.onclick = () => window.wavesurferUser.pause();
    };

    mediaRecorder.start();

    // toggle button states
    startBtn.disabled = true;
    stopBtn.disabled = false;
    resetBtn.disabled = true;
    document.getElementById("user-play").disabled = true;
    document.getElementById("user-pause").disabled = true;
  });

  stopBtn.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      stopBtn.disabled = true; // disable stop after use
      // leave Start disabled until Reset
    }
  });

  resetBtn.addEventListener("click", () => {
    if (window.wavesurferUser && window.wavesurferUser.destroy) {
      window.wavesurferUser.destroy();
    }
    document.getElementById("user-waveform").innerHTML = "";

    // reload dummy waveform
    const silenceBlob = new Blob([new Uint8Array([0])], { type: "audio/webm" });
    const silenceUrl = URL.createObjectURL(silenceBlob);
    window.wavesurferUser = WaveSurfer.create({
      container: "#user-waveform",
      waveColor: "#ccc",
      progressColor: "#28a745",
      height: 80,
      cursorColor: "#28a745",
    });
    window.wavesurferUser.load(silenceUrl);

    // reset buttons
    startBtn.disabled = false;
    stopBtn.disabled = true;
    resetBtn.disabled = true;
    document.getElementById("user-play").disabled = true;
    document.getElementById("user-pause").disabled = true;
  });

  // Native waveform
  if (window.wavesurferNative && window.wavesurferNative.destroy) {
    window.wavesurferNative.destroy();
  }
  window.wavesurferNative = WaveSurfer.create({
    container: "#waveform",
    waveColor: "#ccc",
    progressColor: "#007bff",
    height: 80,
    cursorColor: "#007bff",
  });
  window.wavesurferNative.load(audioFile);

  // Auto-play as soon as the audio is ready
  window.wavesurferNative.on("ready", () => {
    window.wavesurferNative.play();
  });

  // Hook up buttons
  document.getElementById("native-play").onclick = () =>
    window.wavesurferNative.play();
  document.getElementById("native-pause").onclick = () =>
    window.wavesurferNative.pause();

  // Dummy "You" waveform so layout always matches
  if (window.wavesurferUser && window.wavesurferUser.destroy) {
    window.wavesurferUser.destroy();
  }

  const silenceBlob = new Blob([new Uint8Array([0])], { type: "audio/webm" });
  const silenceUrl = URL.createObjectURL(silenceBlob);

  window.wavesurferUser = WaveSurfer.create({
    container: "#user-waveform",
    waveColor: "#ccc",
    progressColor: "#28a745",
    height: 80,
    cursorColor: "#28a745",
  });
  window.wavesurferUser.load(silenceUrl);
}
