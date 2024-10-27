let currentWord;
let correctTranslation;
let correctlyAnsweredWords = [];  // Array to store correctly answered words
let correctLevelAnswers = 0; // Track correct answers per level
let correctCount = 0;  // Tracks the total number of correct answers
let correctStreak = 0; // Track the current streak of correct answers
let currentCEFR = 'A1'; // Start at A1 by default
let fallbackThreshold = 0.5; // Fall back if below 50%
let levelCorrectAnswers = 0;
let levelTotalQuestions = 0;
let gameActive = false;
let incorrectCount = 0; // Tracks the total number of incorrect answers
let incorrectWordQueue = [];  // Queue for storing incorrect words with counters
let levelThreshold = 0.95; // 95% correct to level up
let previousWord = null;
let recentAnswers = [];  // Track the last X answers, 1 for correct, 0 for incorrect
let reintroduceThreshold = 10; // Set how many words to show before reintroducing incorrect ones
let totalQuestions = 0; // Track total questions per level
let wordsSinceLastIncorrect = 0;  // Counter to track words shown since the last incorrect word
let wordDataStore = [];
let questionsAtCurrentLevel = 0; // Track questions answered at current level
let goodChime = new Audio('Resources/Audio/goodChime.wav');
let badChime = new Audio('Resources/Audio/badChime.wav');
let popChime = new Audio('Resources/Audio/popChime.wav');

goodChime.volume = 0.2;
badChime.volume = 0.2;

const gameContainer = document.getElementById('results-container'); // Assume this is where you'll display the game
const statsContainer = document.getElementById('game-session-stats'); // New container for session stats

// Centralized banner handler
const banners = {
    congratulations: 'game-congratulations-banner',
    fallback: 'game-fallback-banner',
    streak: 'game-streak-banner', // New banner for 10-word streak
    clearedPracticeWords: 'game-cleared-practice-banner' // New banner for clearing reintroduced words
};

function showBanner(type, message) {
    const bannerPlaceholder = document.getElementById('game-banner-placeholder');
    
    // You can manage different banner types by their `type` (e.g., 'congratulations', 'fallback')
    let bannerHTML = '';

    if (type === 'congratulations') {
        bannerHTML = `
            <div class="game-congratulations-banner">
                <p>Great job! 🎉 You're now at level <span id="next-level">${message}</span>!</p>
            </div>`;
    } else if (type === 'fallback') {
        bannerHTML = `
            <div class="game-fallback-banner">
                <p>Nice try! 🎯 You're back at level <span id="prev-level">${message}</span>.</p>
            </div>`;
    } else if (type === 'streak') {
        bannerHTML = `
            <div class="game-streak-banner">
                <p>Amazing! 🎉 You've got a 10-word streak!</p>
            </div>`;
    } else if (type === 'clearedPracticeWords') {
        bannerHTML = `
            <div class="game-cleared-practice-banner">
                <p>Awesome! 🎉 You cleared all practice words!</p>
            </div>`;
    }

    bannerPlaceholder.innerHTML = bannerHTML;  // Inject the banner into the placeholder
}

function hideAllBanners() {
    const bannerPlaceholder = document.getElementById('game-banner-placeholder');
    
    if (bannerPlaceholder) { // Check if the element exists
        bannerPlaceholder.innerHTML = '';  // Clear the banner placeholder
    } else {
        console.warn("Banner placeholder not found in the DOM.");
    }
}

// Track correct/incorrect answers for each question
function updateRecentAnswers(isCorrect) {
    recentAnswers.push(isCorrect ? 1 : 0);
    if (isCorrect) {
        levelCorrectAnswers++;
    }
    levelTotalQuestions++;
}

function renderStats() {
    const statsContainer = document.getElementById('game-session-stats');

    if (!statsContainer) {
        return;
    }

    const total = recentAnswers.length;
    const correctCount = recentAnswers.reduce((a, b) => a + b, 0);
    const incorrectCount = total - correctCount;

    const correctPercentage = total > 0 ? (correctCount / total) * 100 : 0;
    const incorrectPercentage = total > 0 ? (incorrectCount / total) * 100 : 0;
    const wordsToReview = incorrectWordQueue.length; // Number of words in review queue

    // Always set flex-grow to 1 to maintain 100% width from the start
    const correctProportion = total > 0 ? (correctCount / total) : 1;
    const incorrectProportion = total > 0 ? (incorrectCount / total) : 1;

    // Render the stats with full width and percentages
    statsContainer.innerHTML = `
        <div class="game-stats-content" style="width: 100%;">
            <!-- Streak box on the left -->
            <div class="game-stats-correct-box">
                <p>${correctStreak}</p>
            </div>
            <div class="game-stats-correct-box" style="flex-grow: ${correctProportion};">
                <p>${Math.round(correctPercentage)}%</p>
            </div>
            <div class="game-stats-incorrect-box" style="flex-grow: ${incorrectProportion};">
                <p>${Math.round(incorrectPercentage)}%</p>
            </div>
            <div class="game-stats-incorrect-box">
                <p>${wordsToReview}</p>
            </div>
        </div>
    `;
    
}

async function startWordGame() {
    gameActive = true;
    showLandingCard(false);
    hideAllBanners(); // Hide banners before starting the new word

    // Check if all available words have been answered correctly
    const totalWords = results.filter(r => r.CEFR === currentCEFR && !noRandom.includes(r.ord.toLowerCase()));
    if (correctlyAnsweredWords.length >= totalWords.length) {
        console.log("All words answered correctly, resetting correctlyAnsweredWords array.");
        correctlyAnsweredWords = []; // Reset the array
    }

    // First, check if there is an incorrect word to reintroduce
    if (incorrectWordQueue.length > 0 && wordsSinceLastIncorrect >= reintroduceThreshold) {
        const firstWordInQueue = incorrectWordQueue[0];
        if (firstWordInQueue.counter >= 10) {
            // Play the popChime when reintroducing an incorrect word
            popChime.currentTime = 0; // Reset audio to the beginning
            popChime.play(); // Play the pop sound

            console.log('Reintroducing word from incorrectWordQueue:', firstWordInQueue.wordObj);

            // Reintroduce the word
            currentWord = firstWordInQueue.wordObj.ord;
            correctTranslation = firstWordInQueue.wordObj.engelsk;

            // Fetch incorrect translations with the same gender and CEFR level
            let incorrectTranslations = fetchIncorrectTranslations(
                firstWordInQueue.wordObj.gender, 
                correctTranslation, 
                firstWordInQueue.wordObj.CEFR // Use the CEFR from the reintroduced word
            );

            // If there aren't enough translations, fetch from other CEFR levels with the same gender
            if (incorrectTranslations.length < 3) {
                const additionalTranslations = fetchIncorrectTranslationsFromOtherCEFRLevels(
                    firstWordInQueue.wordObj.gender,
                    correctTranslation
                );
                incorrectTranslations = incorrectTranslations.concat(additionalTranslations);
            }

            // Shuffle correct and incorrect translations into an array
            const allTranslations = shuffleArray([correctTranslation, ...incorrectTranslations]);

            // Ensure no duplicate displayed values
            const uniqueDisplayedTranslations = ensureUniqueDisplayedValues(allTranslations);

            // Log wordObj being passed to renderWordGameUI
            console.log('Passing wordObj to renderWordGameUI:', firstWordInQueue.wordObj);

            // Render the word game UI, mark this word as reintroduced
            renderWordGameUI(firstWordInQueue.wordObj, uniqueDisplayedTranslations, true);  // 'true' flag for reintroduced word

            // Do not remove the word from the queue yet. It will be removed when answered correctly.
            firstWordInQueue.shown = true; // Mark that this word has been shown again

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
    const incorrectTranslations = fetchIncorrectTranslations(randomWordObj.gender, correctTranslation, currentCEFR);

    // Shuffle correct and incorrect translations into an array
    const allTranslations = shuffleArray([correctTranslation, ...incorrectTranslations]);

    // Ensure no duplicate displayed values
    const uniqueDisplayedTranslations = ensureUniqueDisplayedValues(allTranslations);

    // Render the word game UI and pass the entire word object
    renderWordGameUI(randomWordObj, uniqueDisplayedTranslations, false);  // 'false' flag for non-reintroduced word

    // Render the updated stats box
    renderStats();
}

function ensureUniqueDisplayedValues(translations) {
    const uniqueTranslations = [];
    const displayedSet = new Set();  // To track displayed parts

    translations.forEach(translation => {
        const displayedPart = translation.split(',')[0].trim();
        if (!displayedSet.has(displayedPart)) {
            displayedSet.add(displayedPart);
            uniqueTranslations.push(translation);
        }
    });

    return uniqueTranslations;
}

function fetchIncorrectTranslations(gender, correctTranslation, currentCEFR) {
    const isCapitalized = /^[A-Z]/.test(correctTranslation); // Check if the current word starts with a capital letter

    let incorrectResults = results.filter(r => {
        const isMatchingCase = /^[A-Z]/.test(r.engelsk) === isCapitalized; // Check if the word's case matches
        return r.gender === gender && 
               r.engelsk !== correctTranslation && 
               r.CEFR === currentCEFR &&  // Ensure CEFR matches
               isMatchingCase &&  // Ensure the case matches
               !noRandom.includes(r.ord.toLowerCase());
    });


    // Shuffle the incorrect results to ensure randomness
    incorrectResults = shuffleArray(incorrectResults);

    // Use a Set to track the displayed parts of translations to avoid duplicates
    const displayedTranslationsSet = new Set();
    const incorrectTranslations = [];

    // First, try to collect translations from the same CEFR level
    for (let i = 0; i < incorrectResults.length && incorrectTranslations.length < 3; i++) {
        const displayedTranslation = incorrectResults[i].engelsk.split(',')[0].trim();
        if (!displayedTranslationsSet.has(displayedTranslation)) {
            incorrectTranslations.push(incorrectResults[i].engelsk);
            displayedTranslationsSet.add(displayedTranslation);
        }
    }

    // If we still don't have enough, broaden the search to include words of the same gender but any CEFR level
    if (incorrectTranslations.length < 4) {
        let additionalResults = results.filter(r => {
            const isMatchingCase = /^[A-Z]/.test(r.engelsk) === isCapitalized; // Ensure case matches for fallback
            return r.gender === gender && 
                   r.engelsk !== correctTranslation &&  // Exclude the correct translation
                   isMatchingCase &&  // Ensure the case matches
                   !noRandom.includes(r.ord.toLowerCase()) &&
                   !displayedTranslationsSet.has(r.engelsk.split(',')[0].trim());  // Ensure no duplicates
        });

        for (let i = 0; i < additionalResults.length && incorrectTranslations.length < 3; i++) {
            const displayedTranslation = additionalResults[i].engelsk.split(',')[0].trim();
            if (!displayedTranslationsSet.has(displayedTranslation)) {
                incorrectTranslations.push(additionalResults[i].engelsk);
                displayedTranslationsSet.add(displayedTranslation);
            }
        }
    }

    // If we still don't have enough, broaden the search to include any word, ignoring CEFR and gender
    if (incorrectTranslations.length < 4) {
        let fallbackResults = results.filter(r => {
            const isMatchingCase = /^[A-Z]/.test(r.engelsk) === isCapitalized; // Ensure case matches for fallback
            return r.engelsk !== correctTranslation &&  // Exclude the correct translation
                   isMatchingCase &&  // Ensure the case matches
                   !noRandom.includes(r.ord.toLowerCase()) &&
                   !displayedTranslationsSet.has(r.engelsk.split(',')[0].trim());  // Ensure no duplicates
        });

        for (let i = 0; i < fallbackResults.length && incorrectTranslations.length < 3; i++) {
            const displayedTranslation = fallbackResults[i].engelsk.split(',')[0].trim();
            if (!displayedTranslationsSet.has(displayedTranslation)) {
                incorrectTranslations.push(fallbackResults[i].engelsk);
                displayedTranslationsSet.add(displayedTranslation);
            }
        }
    }

    return incorrectTranslations;
}

function renderWordGameUI(wordObj, translations, isReintroduced = false) {
    // Add the word object to the data store and get its index
    const wordId = wordDataStore.push(wordObj) - 1;

    // Split the word at the comma and use the first part
    let displayedWord = wordObj.ord.split(',')[0].trim();

    // Check if the first character is lowercase before adding the article (en, et, ei)
    if (!/^[A-ZÆØÅ]/.test(displayedWord) && 
        (wordObj.gender.startsWith('en') || wordObj.gender.startsWith('et') || wordObj.gender.startsWith('ei'))) {
        
        displayedWord = `<span class="game-gender-style">${wordObj.gender}</span> ${displayedWord}`;
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
        trickyLabel = '<div class="game-tricky-word visible"><i class="fa fa-repeat" aria-hidden="true"></i></div>';
    } else {
        trickyLabel = '<div class="game-tricky-word"><i class="fa fa-repeat" aria-hidden="true"></i></div>';  // Hidden by default
    }

    // Create placeholder for banners (this will be dynamically updated when banners are shown)
    let bannerPlaceholder = '<div id="game-banner-placeholder"></div>';

    gameContainer.innerHTML = `
        <!-- Session Stats Section -->
        <div class="game-stats-content" id="game-session-stats">
            <!-- Stats will be updated dynamically in renderStats() -->
        </div>

        <div class="game-word-card">
            <div class="game-labels-container">
                ${cefrLabel}  <!-- Add the CEFR label here if applicable -->
                ${bannerPlaceholder}  <!-- This is where banners will appear dynamically -->
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

        <!-- Next Word Button -->
        <div class="game-next-button-container">
            <button id="game-next-word-button" disabled>Next Word</button>
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
        hideAllBanners(); // Hide all banners when Next Word is clicked
        await startWordGame();  // Move to the next word
    });

}

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
        goodChime.currentTime = 0; // Reset audio to the beginning
        goodChime.play(); // Play the chime sound when correct
        // Mark the selected card as green (correct)
        cards.forEach(card => {
            if (card.innerText.trim() === selectedTranslationPart) {
                card.classList.add('game-correct-card');
            }
        });
        correctCount++;  // Increment correct count globally
        correctStreak++; // Increment the streak
        correctLevelAnswers++; // Increment correct count for this level
        updateRecentAnswers(true);  // Track this correct answer
        // Add the word to the correctly answered words array to exclude it from future questions
        correctlyAnsweredWords.push(wordObj.ord);

        // If the word was in the review queue and the user answered it correctly, remove it
        const indexInQueue = incorrectWordQueue.findIndex(incorrectWord => incorrectWord.wordObj.ord === wordObj.ord && incorrectWord.shown);
        if (indexInQueue !== -1) {
            incorrectWordQueue.splice(indexInQueue, 1); // Remove from review queue once answered correctly
        }
        // Trigger the streak banner if the user reaches a 10-word streak
        if (correctStreak === 10) {
            showBanner('streak'); // Show the streak banner
        }
        // Trigger the cleared practice words banner ONLY if the queue is now empty
        if (incorrectWordQueue.length === 0 && indexInQueue !== -1) {
            showBanner('clearedPracticeWords'); // Show the cleared practice words banner
        }
    } else {
        badChime.currentTime = 0; // Reset audio to the beginning
        badChime.play(); // Play the chime sound when incorrect
        // Mark the incorrect card as red
        cards.forEach(card => {
            if (card.innerText.trim() === selectedTranslationPart) {
                card.classList.add('game-incorrect-card'); // Mark incorrect card
            }
            // Also ensure the correct card is still marked green
            if (card.innerText.trim() === correctTranslationPart) {
                card.classList.add('game-correct-card'); // Highlight the correct card
            }
        });
        incorrectCount++;  // Increment incorrect count
        correctStreak = 0; // Reset the streak
        updateRecentAnswers(false);  // Track this correct answer

        // If the word isn't already in the review queue, add it
        const inQueueAlready = incorrectWordQueue.some(incorrectWord => incorrectWord.wordObj.ord === wordObj.ord);
        if (!inQueueAlready) {
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
    }

    // Enable the "Next Word" button
    document.getElementById('game-next-word-button').disabled = false;

    // Update the stats after the answer
    renderStats();

    // Only evaluate progression if at least 20 questions have been answered at the current level
    if (questionsAtCurrentLevel >= 20) {
        evaluateProgression();
        questionsAtCurrentLevel = 0; // Reset the counter after progression evaluation
    }

    // Fetch an example sentence from the database and display it
    const exampleSentence = await fetchExampleSentence(wordObj);
    console.log('Fetched example sentence:', exampleSentence); // Check if this logs correctly
    if (exampleSentence) {
        document.querySelector('.game-cefr-spacer').innerHTML = `<p>${exampleSentence}</p>`;
    } else {
        document.querySelector('.game-cefr-spacer').innerHTML = '';  // Clear if no sentence found
    }

    // Show the "Next Word" button after an answer is selected
    document.getElementById('game-next-word-button').style.display = 'block';
}

async function fetchExampleSentence(wordObj) {
    console.log("Fetching example sentence for:", wordObj);

    // Ensure gender and CEFR are defined before performing the search
    if (!wordObj.gender || !wordObj.CEFR || !wordObj.ord) {
        console.warn('Missing required fields for search:', wordObj);
        return null;
    }

    // Find the exact matching word object based on 'ord', 'definisjon', 'gender', and 'CEFR'
    let matchingEntry = results.find(result => 
        result.ord.toLowerCase() === wordObj.ord.toLowerCase() &&
        result.gender === wordObj.gender &&
        result.CEFR === wordObj.CEFR
    );

    // Log the matching entry or lack thereof
    if (matchingEntry) {
        console.log("Matching entry found:", matchingEntry);
        console.log("Example sentence found:", matchingEntry.eksempel);
    } else {
        console.warn(`No matching entry found for word: ${wordObj.ord}`);
    }

    // Step 2: Check if the matching entry has an example sentence
    if (!matchingEntry || !matchingEntry.eksempel || matchingEntry.eksempel.trim() === "") {
        console.log(`No example sentence available for word: ${wordObj.ord} with specified gender and CEFR.`);

        // Step 3: Search for another entry with the same 'ord' but without considering 'gender' or 'CEFR'
        matchingEntry = results.find(result => 
            result.eksempel && result.eksempel.toLowerCase().startsWith(wordObj.ord.toLowerCase())
        );
        if (matchingEntry) {
            console.log("Found example sentence from another word entry:", matchingEntry.eksempel);
        } else {
            console.warn(`No example sentence found in the entire dataset containing the word: ${wordObj.ord}`);
            return null;  // No example sentence found at all
        }                       
    }

    // Split example sentences and remove any empty entries
    const exampleSentences = matchingEntry.eksempel.split(/(?<=[.!?])\s+/).filter(sentence => sentence.trim() !== "");

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
    let filteredResults = results.filter(r => 
        r.engelsk && 
        !noRandom.includes(r.ord.toLowerCase()) && 
        r.ord !== previousWord &&
        r.CEFR === cefrLevel && // Ensure the word belongs to the same CEFR level
        !correctlyAnsweredWords.includes(r.ord) // Exclude words already answered correctly
    );

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
        console.log('No words found matching the selected CEFR and POS filters.');
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

    if (incorrectWordQueue.length > 0) {
        // Block level advancement if there are still incorrect words
        console.log('The user must review all incorrect words before advancing to the next level.');
        return;
    }

    let nextLevel = '';
    if (currentCEFR === 'A1') nextLevel = 'A2';
    else if (currentCEFR === 'A2') nextLevel = 'B1';
    else if (currentCEFR === 'B1') nextLevel = 'B2';
    else if (currentCEFR === 'B2') nextLevel = 'C';

    // Only advance if we are not already at the next level
    if (currentCEFR !== nextLevel && nextLevel) {
        currentCEFR = nextLevel;
        resetGame(false);  // Preserve streak when progressing
        showBanner('congratulations', nextLevel);  // Show the banner
        updateCEFRSelection();
    }
}

function fallbackToPreviousLevel() {
    let previousLevel = '';
    if (currentCEFR === 'A2') previousLevel = 'A1';
    else if (currentCEFR === 'B1') previousLevel = 'A2';
    else if (currentCEFR === 'B2') previousLevel = 'B1';
    else if (currentCEFR === 'C') previousLevel = 'B2';

    // Only change the level if it is actually falling back to a previous level
    if (currentCEFR !== previousLevel && previousLevel) {
        currentCEFR = previousLevel;  // Update the current level to the previous one
        resetGame(false);  // Preserve streak when progressing
        incorrectWordQueue = []; // Reset the incorrect word queue on fallback
        showBanner('fallback', previousLevel);  // Show the fallback banner
        updateCEFRSelection(); // Update the CEFR selection to reflect the new level
    }
}

// Check if the user can level up or fall back after 10 questions
function evaluateProgression() {
    if (levelTotalQuestions >= 10) {
        const accuracy = levelCorrectAnswers / levelTotalQuestions;
        console.log(`Evaluating: Accuracy is ${accuracy * 100}%`);

        if (accuracy >= levelThreshold && incorrectWordQueue.length === 0) {
            advanceToNextLevel();
        } else if (accuracy < fallbackThreshold) {
            fallbackToPreviousLevel();
        }
        resetLevelStats();  // Reset for the next set of questions
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

function resetGame(resetStreak = true) {
    correctCount = 0;    // Reset correct answers count
    correctLevelAnswers = 0;  // Reset correct answers for the current level
    if (resetStreak) {
        correctStreak = 0;  // Reset the streak if the flag is true
    }
    levelCorrectAnswers = 0;
    incorrectCount = 0;  // Reset incorrect answers count
    incorrectWordQueue = [];
    levelTotalQuestions = 0;  // Reset this here too
    questionsAtCurrentLevel = 0; // Reset questions counter for the level
    recentAnswers = [];  // Clear the recent answers array
    totalQuestions = 0;  // Reset total questions for the current level
    renderStats();  // Re-render the stats display to reflect the reset
}

// Reset level stats after progression or fallback
function resetLevelStats() {
    levelCorrectAnswers = 0;
    levelTotalQuestions = 0;
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