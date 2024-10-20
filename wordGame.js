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
let wordDataStore = [];
let recentAnswers = [];  // Track the last X answers, 1 for correct, 0 for incorrect
let incorrectWordQueue = [];  // Queue for storing incorrect words with counters
let previousWord = null;
let wordsSinceLastIncorrect = 0;  // Counter to track words shown since the last incorrect word
let reintroduceThreshold = 10; // Set how many words to show before reintroducing incorrect ones

let goodChime = new Audio('goodChime.wav');
let badChime = new Audio('badChime.wav');
let popChime = new Audio('popChime.wav');

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

    // First, check if there is an incorrect word to reintroduce
    if (incorrectWordQueue.length > 0 && wordsSinceLastIncorrect >= reintroduceThreshold) {
        const firstWordInQueue = incorrectWordQueue[0];
        if (firstWordInQueue.counter >= 5) {
            console.log('Reintroducing word from incorrectWordQueue:', firstWordInQueue.wordObj);

            // Play the popChime when reintroducing an incorrect word
            popChime.currentTime = 0; // Reset audio to the beginning
            popChime.play(); // Play the pop sound

            // Reintroduce the word
            currentWord = firstWordInQueue.wordObj.ord;
            correctTranslation = firstWordInQueue.wordObj.engelsk;

            // Fetch incorrect translations with the same gender
            const incorrectTranslations = fetchIncorrectTranslations(firstWordInQueue.wordObj.gender, correctTranslation);

            // Shuffle correct and incorrect translations into an array
            const allTranslations = shuffleArray([correctTranslation, ...incorrectTranslations]);

            // Log wordObj being passed to renderWordGameUI
            console.log('Passing wordObj to renderWordGameUI:', firstWordInQueue.wordObj);

            // Render the word game UI, mark this word as reintroduced
            renderWordGameUI(firstWordInQueue.wordObj, allTranslations, true);  // 'true' flag for reintroduced word

            // Remove the word from the queue
            incorrectWordQueue.shift();

            // Reset counter for new words shown
            wordsSinceLastIncorrect = 0;
            
            // Render the updated stats box
            renderStats();
            return;
        } else {
            // Increment the counter for this word
            incorrectWordQueue.forEach(word => word.counter++);
        }
    }

    wordsSinceLastIncorrect++; // Increment counter for words since last incorrect word

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
    renderWordGameUI(randomWordObj, allTranslations, false);  // 'false' flag for non-reintroduced word

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

function renderWordGameUI(wordObj, translations, isReintroduced = false) {
    // Add the word object to the data store and get its index
    const wordId = wordDataStore.push(wordObj) - 1;

    // Split the word at the comma and use the first part
    let displayedWord = wordObj.ord.split(',')[0].trim();

    // Log the wordObj to see if it has CEFR
    console.log('renderWordGameUI called with wordObj:', wordObj);
    
    if (wordObj.gender.startsWith('en') || wordObj.gender.startsWith('et') || wordObj.gender.startsWith('ei')) {
        displayedWord = `${wordObj.gender} ${displayedWord}`;  // Add gender in front of the word
    }

    // Check if CEFR is selected; if not, add a label based on wordObj.CEFR
    let cefrLabel = '';
    let spacerDiv = '<div class="game-cefr-spacer"></div>';  // Default empty spacer div
    let trickyLabel = '';  // Placeholder for the tricky word label

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
    } else {
        console.warn("CEFR value is missing for this word:", wordObj);
    }

    // Add "tricky word" label if the word is reintroduced
    if (isReintroduced) {
        trickyLabel = '<div class="game-tricky-word""><i class="fa fa-repeat" aria-hidden="true"></i></div>';
    }

    gameContainer.innerHTML = `
        <!-- Session Stats Section -->
        <div class="game-stats-content" id="game-session-stats">
            <!-- Stats will be updated dynamically in renderStats() -->
        </div>

        <div class="definition result-header game-word-card">
            <div class="game-labels-container">
                ${cefrLabel}  <!-- Add the CEFR label here if applicable -->
                ${trickyLabel}  <!-- Add the tricky word label if applicable -->
            </div>
            <div class="game-word">
            <h2>${displayedWord}</h2>
            </div>
            ${spacerDiv}  <!-- Add the spacer div if CEFR label exists -->
        </div>

        <!-- Translations Grid Section -->
        <div class="game-grid">
            ${translations.map((translation, index) => `
                <div class="game-translation-card" data-id="${wordId}" data-index="${index}">
                    ${translation.split(',')[0].trim()}
                </div>
            `).join('')}
        </div>

        <!-- Congratulations Banner -->
        <div id="game-congratulations-banner" class="${congratulationsBannerVisible ? '' : 'hidden'}">
            <p>Great job! 🎉 You're now at level <span id="next-level">${currentCEFR}</span>!</p>
        </div>
        <!-- Fallback Banner (new) -->
        <div id="game-fallback-banner" class="${fallbackBannerVisible ? '' : 'hidden'}">
            <p>Nice try! 🎯 You're back at level <span id="prev-level">${currentCEFR}</span>.</p>
        </div>
        <!-- Next Word Button -->
        <div class="game-next-button-container">
            <button id="game-next-word-button">Next Word</button>
        </div>
    `;

    // Add event listeners for translation cards
    document.querySelectorAll('.game-translation-card').forEach(card => {
        card.addEventListener('click', function () {
            const wordId = this.getAttribute('data-id');  // Retrieve the word ID
            const selectedTranslation = this.innerText.trim();
            const wordObj = wordDataStore[wordId];  // Get the word object from the data store

            handleTranslationClick(selectedTranslation, wordObj);
        });
    });

    // Add event listener for the next word button
    document.getElementById('game-next-word-button').addEventListener('click', async function () {
        hideCongratulationsBanner();  // Hide the banner when an answer is clicked
        hideFallbackBanner();  // Hide the banner when an answer is clicked    
        await startWordGame();  // Move to the next word
    });

}

let questionsAtCurrentLevel = 0; // Track questions answered at current level

async function handleTranslationClick(selectedTranslation, wordObj) {
    if (!gameActive) return;  // Prevent further clicks if the game is not active

    gameActive = false; // Disable further clicks until the next word is generated

    const cards = document.querySelectorAll('.game-translation-card');

    // Reset all cards to the default background before applying the color change
    cards.forEach(card => {
        card.classList.remove('game-correct-card', 'game-incorrect-card');
    });

    // Extract the part before the comma for both correct and selected translations
    const correctTranslationPart = correctTranslation.split(',')[0].trim();
    const selectedTranslationPart = selectedTranslation.split(',')[0].trim();

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

        // Add incorrect word to the queue with the CEFR value included
        incorrectWordQueue.push({
            wordObj: { 
                ord: currentWord, 
                engelsk: correctTranslation, 
                gender: wordObj.gender, 
                CEFR: wordObj.CEFR  // Include CEFR value here
            },
            counter: 0 // Start counter for this word
        });
    }

    // Update the stats after the answer
    renderStats();

    // Only evaluate progression if at least 10 questions have been answered at the current level
    if (questionsAtCurrentLevel >= 10) {
        evaluateProgression();
        questionsAtCurrentLevel = 0; // Reset the counter after progression evaluation
    }

    // Fetch an example sentence from the database and display it
    const exampleSentence = await fetchExampleSentence(wordObj);
    if (exampleSentence) {
        document.querySelector('.game-cefr-spacer').innerHTML = `<p>${exampleSentence}</p>`;
    } else {
        document.querySelector('.game-cefr-spacer').innerHTML = '';  // Clear if no sentence found
    }

    // Show the "Next Word" button after an answer is selected
    document.getElementById('game-next-word-button').style.display = 'block';
}

async function fetchExampleSentence(wordObj) {
    // Find the exact matching word object based on 'ord', 'definisjon', 'gender', and 'CEFR'
    const matchingEntry = results.find(result => 
        result.ord.toLowerCase() === wordObj.ord.toLowerCase() &&
        result.gender === wordObj.gender &&
        result.CEFR === wordObj.CEFR
    );

    // If no matching entry is found or if there is no 'eksempel' field, return null
    if (!matchingEntry || !matchingEntry.eksempel) {
        console.warn(`No example sentence available for word: ${wordObj.ord}`);
        return null;
    }

    // Split example sentences if there are multiple in the 'eksempel' field (assuming they are separated by a common delimiter like '. ')
    const exampleSentences = matchingEntry.eksempel.split(/(?<=[.!?])\s+/);

    // If there is only one sentence, return it
    if (exampleSentences.length === 1) {
        return exampleSentences[0];
    }

    // If there are multiple sentences, pick one at random
    const randomIndex = Math.floor(Math.random() * exampleSentences.length);
    return exampleSentences[randomIndex];
}

async function fetchRandomWord() {
    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';

    // Always use the current CEFR level, whether it's A1 by default or selected by the user
    const cefrLevel = currentCEFR;

    // Filter results based on CEFR, POS, and excluding the previous word
    let filteredResults = results.filter(r => r.engelsk && !noRandom.includes(r.ord.toLowerCase()) && r.ord !== previousWord);

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

    previousWord = randomResult.ord; // Update the previous word

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

document.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && document.getElementById('type-select').value === 'word-game') {
        const nextWordButton = document.getElementById('game-next-word-button');
        
        // Check if the button exists and is visible using computed styles
        if (nextWordButton && window.getComputedStyle(nextWordButton).display !== 'none') {
            nextWordButton.click();  // Simulate a click on the next word button
        }
    }
});