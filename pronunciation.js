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

  // First channel
  const nativeData = nativeAudio.getChannelData(0);
  const userData = userAudio.getChannelData(0);

  // --- Feature extraction: short-time energy + zero-crossing rate ---
  function extractFeatures(data, targetLength = 200) {
    const blockSize = Math.floor(data.length / targetLength);
    const features = [];
    for (let i = 0; i < targetLength; i++) {
      const start = i * blockSize;
      const end = start + blockSize;
      let sumEnergy = 0,
        zeroCrossings = 0;
      for (let j = start; j < end && j < data.length; j++) {
        const val = data[j];
        sumEnergy += val * val; // energy
        if (j > start && data[j - 1] > 0 !== val > 0) {
          zeroCrossings++;
        }
      }
      const avgEnergy = Math.sqrt(sumEnergy / blockSize);
      const zcr = zeroCrossings / blockSize;
      features.push([avgEnergy, zcr]);
    }
    // Normalize each dimension
    const maxE = Math.max(...features.map((f) => f[0])) || 1;
    const maxZ = Math.max(...features.map((f) => f[1])) || 1;
    return features.map((f) => [f[0] / maxE, f[1] / maxZ]);
  }

  const n = extractFeatures(nativeData);
  const u = extractFeatures(userData, n.length);

  // --- DTW distance over feature vectors ---
  function dtwDistance(a, b) {
    const n = a.length,
      m = b.length;
    const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity));
    dp[0][0] = 0;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const cost = Math.hypot(
          a[i - 1][0] - b[j - 1][0],
          a[i - 1][1] - b[j - 1][1]
        );
        dp[i][j] =
          cost + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[n][m] / (n + m);
  }

  const dist = dtwDistance(n, u);

  // --- Correlation check ---
  function correlation(a, b) {
    const len = Math.min(a.length, b.length);
    let meanA = 0,
      meanB = 0;
    for (let i = 0; i < len; i++) {
      meanA += a[i][0]; // energy only
      meanB += b[i][0];
    }
    meanA /= len;
    meanB /= len;
    let num = 0,
      denA = 0,
      denB = 0;
    for (let i = 0; i < len; i++) {
      const da = a[i][0] - meanA;
      const db = b[i][0] - meanB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    }
    return num / (Math.sqrt(denA * denB) || 1);
  }

  const corr = correlation(n, u);

  // --- Convert distance + correlation → similarity score ---
  const scale = 250;
  const dtwScore = Math.max(0, 100 - dist * scale);

  // Blend DTW score with correlation (instead of multiplying)
  const corrScore = Math.max(0, Math.min(100, (corr + 1) * 50)); // map [-1,1] → [0,100]
  let score = 0.8 * dtwScore + 0.2 * corrScore;

  // Silence guard
  const meanEnergy = userData.reduce((a, v) => a + v * v, 0) / userData.length;
  if (meanEnergy < 1e-5) score = 0;

  return Math.round(score);
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
  <button id="start-recording">🎙️ Start Recording</button>
  <div id="recording-actions" style="display:none;">
    <button id="stop-recording">⏹️ Stop Recording</button>
    <button id="reset-recording">🔄 Reset</button>
    <button id="user-play">▶️ Play</button>
    <button id="user-pause">⏸️ Pause</button>
  </div>
</div>
      </div>
    </div>
      <div id="comparison-score" style="text-align:center; margin-top:10px;">
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

      // Enable playback + reset after recording finishes
      const playBtn = document.getElementById("user-play");
      const pauseBtn = document.getElementById("user-pause");

      playBtn.disabled = false;
      pauseBtn.disabled = false;
      document.getElementById("reset-recording").disabled = false;

      // 🔹 Attach handlers
      playBtn.onclick = () => window.wavesurferUser.play();
      pauseBtn.onclick = () => window.wavesurferUser.pause();
    };

    mediaRecorder.start();

    // Toggle visibility
    startBtn.style.display = "none";
    document.getElementById("recording-actions").style.display = "block";
  });

  stopBtn.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      // Instead of disabling, hide Stop after use
      stopBtn.style.display = "none";
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

    // Reset visibility
    document.getElementById("recording-actions").style.display = "none";
    document.getElementById("start-recording").style.display = "inline-block";
    document.getElementById("stop-recording").style.display = "inline-block"; // 👈 show Stop again

    // Reset score display
    const scoreEl = document.getElementById("comparison-score");
    if (scoreEl) scoreEl.textContent = "";
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
