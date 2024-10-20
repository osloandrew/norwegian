let currentWord;
let correctTranslation;
let gameActive = false;
let correctCount = 0;  // Tracks the total number of correct answers
let incorrectCount = 0; // Tracks the total number of incorrect answers
let currentCEFR = 'A1'; // Start at A1 by default
let levelThreshold = 0.95; // 95% correct to level up
let fallbackThreshold = 0.5; // Fall back if below 50%
let totalQuestions = 0; // Track total questions per level
let correctLevelAnswers = 0; // Track correct answers per level
let congratulationsBannerVisible = false;
let fallbackBannerVisible = false;
let recentAnswers = [];  // Track the last X answers, 1 for correct, 0 for incorrect

let goodChime = new Audio('goodChime.wav');
let badChime = new Audio('badChime.wav');
goodChime.volume = 0.2;
badChime.volume = 0.2;

const gameContainer = document.getElementById('results-container'); // Assume this is where you'll display the game
const statsContainer = document.getElementById('game-session-stats'); // New container for session stats

function updateRecentAnswers(isCorrect) {
    recentAnswers.push(isCorrect ? 1 : 0);
    if (recentAnswers.length > 50) {  // Adjusted to 50 instead of 20
        recentAnswers.shift();  // Keep only the last 50 answers
    }    
}

function renderStats() {
    const statsContainer = document.getElementById('game-session-stats');
    if (!statsContainer) {
        console.error("Stats container not found!");
        return;
    }

    const total = recentAnswers.length;
    const correctCount = recentAnswers.reduce((a, b) => a + b, 0);
    const incorrectCount = total - correctCount;

    const correctPercentage = total > 0 ? (correctCount / total) * 100 : 0;
    const incorrectPercentage = total > 0 ? (incorrectCount / total) * 100 : 0;

    // Always set flex-grow to 1 to maintain 100% width from the start
    const correctProportion = total > 0 ? (correctCount / total) : 1;
    const incorrectProportion = total > 0 ? (incorrectCount / total) : 1;

    // Render the stats with full width and percentages
    statsContainer.innerHTML = `
        <div class="game-stats-content" style="width: 100%;">
            <div class="game-stats-correct-box" style="flex-grow: ${correctProportion};">
                <p>${Math.round(correctPercentage)}%</p>
            </div>
            <div class="game-stats-incorrect-box" style="flex-grow: ${incorrectProportion};">
                <p>${Math.round(incorrectPercentage)}%</p>
            </div>
        </div>
    `;
    
}

async function startWordGame() {
    gameActive = true;

    // Use the currentCEFR directly, since it's dynamically updated when the user selects a new CEFR level
    if (!currentCEFR) {
        currentCEFR = 'A1'; // Default to A1 if no level is set
    }

    // Fetch a random word that respects CEFR and POS filters
    const randomWordObj = await fetchRandomWord();

    // If no words match the filters, stop the game
    if (!randomWordObj) return;

    currentWord = randomWordObj.ord;
    correctTranslation = randomWordObj.engelsk;

    // Fetch incorrect translations with the same gender
    const incorrectTranslations = fetchIncorrectTranslations(randomWordObj.gender, correctTranslation);

    // Shuffle correct and incorrect translations into an array
    const allTranslations = shuffleArray([correctTranslation, ...incorrectTranslations]);

    // Render the word game UI and pass the entire word object
    renderWordGameUI(randomWordObj, allTranslations);

    // Render the updated stats box
    renderStats();
}

function fetchIncorrectTranslations(gender, correctTranslation) {
    const incorrectResults = results.filter(r => {
        return r.gender === gender && r.engelsk !== correctTranslation && !noRandom.includes(r.ord.toLowerCase());
    });

    // Randomly select 3 incorrect translations
    const incorrectTranslations = [];
    for (let i = 0; i < 3; i++) {
        if (incorrectResults.length === 0) break;  // Handle case where there aren't enough matching results
        const randomIndex = Math.floor(Math.random() * incorrectResults.length);
        incorrectTranslations.push(incorrectResults[randomIndex].engelsk);
        incorrectResults.splice(randomIndex, 1);  // Remove selected translation to avoid duplicates
    }

    return incorrectTranslations;
}

function renderWordGameUI(wordObj, translations) {
    // Split the word at the comma and use the first part
    let displayedWord = wordObj.ord.split(',')[0].trim();
    
    if (wordObj.gender.startsWith('en') || wordObj.gender.startsWith('et') || wordObj.gender.startsWith('ei')) {
        displayedWord = `${wordObj.gender} ${displayedWord}`;  // Add gender in front of the word
    }

    // Check if CEFR is selected; if not, add a label based on wordObj.CEFR
    let cefrLabel = '';
    let spacerDiv = '';  // Spacer div placeholder

    // Always show the CEFR label if CEFR is available
    if (wordObj.CEFR === 'A1') {
        cefrLabel = '<div class="game-cefr-label easy">A1</div>';
        spacerDiv = '<div class="game-cefr-spacer"></div>';
    } else if (wordObj.CEFR === 'A2') {
        cefrLabel = '<div class="game-cefr-label easy">A2</div>';
        spacerDiv = '<div class="game-cefr-spacer"></div>';
    } else if (wordObj.CEFR === 'B1') {
        cefrLabel = '<div class="game-cefr-label medium">B1</div>';
        spacerDiv = '<div class="game-cefr-spacer"></div>';
    } else if (wordObj.CEFR === 'B2') {
        cefrLabel = '<div class="game-cefr-label medium">B2</div>';
        spacerDiv = '<div class="game-cefr-spacer"></div>';
    } else if (wordObj.CEFR === 'C') {
        cefrLabel = '<div class="game-cefr-label hard">C</div>';
        spacerDiv = '<div class="game-cefr-spacer"></div>';
    }

    gameContainer.innerHTML = `
        <!-- Session Stats Section -->
        <div class="game-stats-content" id="game-session-stats">
            <!-- Stats will be updated dynamically in renderStats() -->
        </div>

        <div class="definition result-header game-word-card">
            ${cefrLabel}  <!-- Add the CEFR label here if applicable -->
            <div class="game-word">
            <h2>${displayedWord}</h2>
            </div>
            ${spacerDiv}  <!-- Add the spacer div if CEFR label exists -->
        </div>

        <!-- Translations Grid Section -->
        <div class="game-grid">
            ${translations.map(translation => {
                // Split each translation at the comma and use the first part
                const displayedTranslation = translation.split(',')[0].trim();

                // Escape the translation for use in the onclick handler
                const escapedTranslation = displayedTranslation.replace(/'/g, "\\'");

                return `
                    <div class="game-translation-card" onclick="handleTranslationClick('${escapedTranslation}')">
                        ${displayedTranslation}
                    </div>
                `;
            }).join('')}
        </div>
        <!-- Congratulations Banner -->
        <div id="game-congratulations-banner" class="${congratulationsBannerVisible ? '' : 'hidden'}">
            <p>Great job! 🎉 You're now at level <span id="next-level">${currentCEFR}</span>!</p>
        </div>
        <!-- Fallback Banner (new) -->
        <div id="game-fallback-banner" class="${fallbackBannerVisible ? '' : 'hidden'}">
            <p>Nice try! 🎯 You're back at level <span id="prev-level">${currentCEFR}</span>.</p>
        </div>
    `;
}

let questionsAtCurrentLevel = 0; // Track questions answered at current level

function handleTranslationClick(selectedTranslation) {
    if (!gameActive) return;  // Prevent further clicks if the game is not active

    gameActive = false; // Disable further clicks until the next word is generated

    hideCongratulationsBanner();  // Hide the banner when an answer is clicked

    hideFallbackBanner();  // Hide the banner when an answer is clicked

    const cards = document.querySelectorAll('.game-translation-card');

    // Reset all cards to the default background before applying the color change
    cards.forEach(card => {
        card.classList.remove('game-correct-card', 'game-incorrect-card');
    });

    // Extract the part before the comma for both correct and selected translations
    const correctTranslationPart = correctTranslation.split(',')[0].trim();
    const selectedTranslationPart = selectedTranslation.split(',')[0].trim();

    let delay; // Variable to store delay time

    totalQuestions++; // Increment total questions for this level
    questionsAtCurrentLevel++; // Increment questions at this level

    if (selectedTranslationPart === correctTranslationPart) {
        // Mark the selected card as green (correct)
        cards.forEach(card => {
            if (card.innerText.trim() === selectedTranslationPart) {
                card.classList.add('game-correct-card');
                goodChime.currentTime = 0; // Reset audio to the beginning
                goodChime.play(); // Play the chime sound when correct
            }
        });
        correctCount++;  // Increment correct count globally
        correctLevelAnswers++; // Increment correct count for this level
        updateRecentAnswers(true);  // Track this correct answer
        delay = 500; // 0.5 second delay if correct
    } else {
        // Mark the incorrect card as red
        cards.forEach(card => {
            if (card.innerText.trim() === selectedTranslationPart) {
                card.classList.add('game-incorrect-card'); // Mark incorrect card
                badChime.currentTime = 0; // Reset audio to the beginning
                badChime.play(); // Play the chime sound when incorrect
            }
            // Also ensure the correct card is still marked green
            if (card.innerText.trim() === correctTranslationPart) {
                card.classList.add('game-correct-card'); // Highlight the correct card
            }
        });
        incorrectCount++;  // Increment incorrect count
        updateRecentAnswers(false);  // Track this correct answer
        delay = 2500; // 2.5 seconds delay if incorrect
    }

    // Update the stats after the answer
    renderStats();

    // Only evaluate progression if at least 10 questions have been answered at the current level
    if (questionsAtCurrentLevel >= 10) {
        evaluateProgression();
        questionsAtCurrentLevel = 0; // Reset the counter after progression evaluation
    }

    // Await the new word generation after the specified delay
    setTimeout(async () => {
        await startWordGame(); // Ensure async function is awaited
        gameActive = true;  // Re-enable clicking for the next round
    }, delay);
}

async function fetchRandomWord() {
    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';

    // Always use the current CEFR level, whether it's A1 by default or selected by the user
    const cefrLevel = currentCEFR;

    // Filter results based on the dynamically changing CEFR level
    let filteredResults = results.filter(r => r.engelsk && !noRandom.includes(r.ord.toLowerCase()));

    if (selectedPOS) {
        filteredResults = filteredResults.filter(r => {
            const gender = r.gender ? r.gender.toLowerCase() : '';

            // Handle nouns: Include "en", "et", "ei" but exclude "pronoun"
            if (selectedPOS === 'noun') {
                return (gender.startsWith('en') || gender.startsWith('et') || gender.startsWith('ei')) && gender !== 'pronoun';
            }

            // For non-noun POS, filter based on the selectedPOS value
            return gender.startsWith(selectedPOS);
        });
    }

    if (cefrLevel) {
        // Filter by CEFR level if selected
        filteredResults = filteredResults.filter(r => r.CEFR && r.CEFR.toUpperCase() === cefrLevel);
    }

    // Filter out words where the Norwegian word and its English translation are identical
    filteredResults = filteredResults.filter(r => {
        // Split and trim the Norwegian word (handle comma-separated words)
        const norwegianWord = r.ord.split(',')[0].trim().toLowerCase();
        
        // Split and trim the English translation (handle comma-separated translations)
        const englishTranslation = r.engelsk.split(',')[0].trim().toLowerCase();
    
        // Return true if the Norwegian and English words are not the same
        return norwegianWord !== englishTranslation;
    });
    
    // If no words match the filters, return a message
    if (filteredResults.length === 0) {
        alert('No words found matching the selected CEFR and POS filters.');
        return null;
    }

    // Randomly select a result from the filtered results
    const randomResult = filteredResults[Math.floor(Math.random() * filteredResults.length)];

    return {
        ord: randomResult.ord,
        engelsk: randomResult.engelsk,
        gender: randomResult.gender, // Add gender
        CEFR: randomResult.CEFR // Make sure CEFR is returned here
    };
}

function advanceToNextLevel() {
    let nextLevel = '';
    
    if (currentCEFR === 'A1') {
        nextLevel = 'A2';
    } else if (currentCEFR === 'A2') {
        nextLevel = 'B1';
    } else if (currentCEFR === 'B1') {
        nextLevel = 'B2';
    } else if (currentCEFR === 'B2') {
        nextLevel = 'C';
    }

    // Only advance if we are not already at the next level
    if (currentCEFR !== nextLevel && nextLevel) {
        currentCEFR = nextLevel;
        showCongratulationsBanner(nextLevel);  // Show the banner

        // Update the CEFR selection to reflect the new level
        updateCEFRSelection();
    }
}

function fallbackToPreviousLevel() {
    let previousLevel = '';  // Initialize previousLevel

    // Determine the previous level based on currentCEFR
    if (currentCEFR === 'A2') {
        previousLevel = 'A1';
    } else if (currentCEFR === 'B1') {
        previousLevel = 'A2';
    } else if (currentCEFR === 'B2') {
        previousLevel = 'B1';
    } else if (currentCEFR === 'C') {
        previousLevel = 'B2';
    }

    // Only change the level if it is actually falling back to a previous level
    if (currentCEFR !== previousLevel && previousLevel) {
        currentCEFR = previousLevel;  // Update the current level to the previous one
        showFallbackBanner(previousLevel);  // Show the fallback banner

        // Update the CEFR selection to reflect the new level
        updateCEFRSelection();
    }
}

function evaluateProgression() {
    const correctCount = recentAnswers.reduce((a, b) => a + b, 0);
    const total = recentAnswers.length;
    const accuracy = total > 0 ? (correctCount / total) : 0;

    console.log("Current accuracy:", accuracy);

    if (accuracy >= levelThreshold) {
        advanceToNextLevel();
    } else if (accuracy < fallbackThreshold) {
        fallbackToPreviousLevel();
    }
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function updateCEFRSelection() {
    const cefrSelect = document.getElementById('cefr-select');
    // Update the actual selected value in the dropdown to reflect the current CEFR level
    cefrSelect.value = currentCEFR;
}

function resetGame() {
    recentAnswers = [];  // Clear the recent answers array
    correctCount = 0;    // Reset correct answers count
    incorrectCount = 0;  // Reset incorrect answers count
    totalQuestions = 0;  // Reset total questions for the current level
    correctLevelAnswers = 0;  // Reset correct answers for the current level
    questionsAtCurrentLevel = 0; // Reset questions counter for the level
    renderStats();  // Re-render the stats display to reflect the reset
}

function showCongratulationsBanner(level) {
    const banner = document.getElementById('game-congratulations-banner');
    const levelSpan = document.getElementById('next-level');

    if (levelSpan.textContent !== level) {
        levelSpan.textContent = level;  // Update the level only if it changed
    }

    banner.classList.remove('hidden');  // Show the banner
    congratulationsBannerVisible = true;  // Set banner visibility flag
}

function hideCongratulationsBanner() {
    const banner = document.getElementById('game-congratulations-banner');
    banner.classList.add('hidden');  // Hide the banner
    congratulationsBannerVisible = false;  // Reset banner visibility flag
}

function showFallbackBanner(level) {
    const fallbackBanner = document.getElementById('game-fallback-banner');
    const levelSpan = document.getElementById('prev-level');
    
    if (levelSpan.textContent !== level) {
        levelSpan.textContent = level;  // Update the level only if it changed
    }

    fallbackBanner.classList.remove('hidden');  // Show the banner
    fallbackBannerVisible = true;  // Set banner visibility flag
}

function hideFallbackBanner() {
    const banner = document.getElementById('game-fallback-banner');
    banner.classList.add('hidden');  // Hide the banner
    fallbackBannerVisible = false;  // Reset banner visibility flag
}


document.getElementById('cefr-select').addEventListener('change', function() {
    const selectedCEFR = this.value.toUpperCase(); // Get the newly selected CEFR level
    currentCEFR = selectedCEFR; // Set the current CEFR level to the new one
    resetGame(); // Reset the game stats
    startWordGame(); // Start the game with the new CEFR level
});