import { noRandom } from 'noRandom.js';  // Adjust the path if needed

let currentWord;
let correctTranslation;
let gameActive = false;
let correctCount = 0;  // Tracks the number of correct answers
let incorrectCount = 0; // Tracks the number of incorrect answers
let chimeAudio = new Audio('chime.mp3'); // Path to your chime sound file
chimeAudio.volume = 0.2;
const gameContainer = document.getElementById('results-container'); // Assume this is where you'll display the game
const statsContainer = document.getElementById('game-session-stats'); // New container for session stats

function renderStats() {
    const statsContainer = document.getElementById('game-session-stats');
    if (!statsContainer) {
        console.error("Stats container not found!");
        return;
    }

    // Calculate the total number of answers
    const total = correctCount + incorrectCount;

    // Prevent division by zero; assign minimum value 1 for proportions
    const correctProportion = total > 0 ? correctCount / total : 0.5;
    const incorrectProportion = total > 0 ? incorrectCount / total : 0.5;

    // Check that proportions are being calculated correctly
    console.log('Correct Proportion:', correctProportion);
    console.log('Incorrect Proportion:', incorrectProportion);

    // Render the stats with flex-grow values
    statsContainer.innerHTML = `
        <div class="game-stats-content">
            <div class="game-stats-correct-box" style="flex-grow: ${correctProportion};">
                <p>${correctCount}</p>
            </div>
            <div class="game-stats-incorrect-box" style="flex-grow: ${incorrectProportion};">
                <p>${incorrectCount}</p>
            </div>
        </div>
    `;
    
}

async function startWordGame() {
    gameActive = true;
    
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
    `;
}

function handleTranslationClick(selectedTranslation) {
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

    let delay; // Variable to store delay time

    if (selectedTranslationPart === correctTranslationPart) {
        // Mark the selected card as green (correct)
        cards.forEach(card => {
            if (card.innerText.trim() === selectedTranslationPart) {
                card.classList.add('game-correct-card');
                chimeAudio.currentTime = 0; // Reset audio to the beginning
                chimeAudio.play(); // Play the chime sound when correct
            }
        });
        correctCount++;  // Increment correct count
        delay = 600; // 0.6 second delay if correct
    } else {
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
        delay = 2500; // 2.5 seconds delay if incorrect
    }

    // Update the stats after the answer
    renderStats();

    // Await the new word generation after the specified delay
    setTimeout(async () => {
        await startWordGame(); // Ensure async function is awaited
        gameActive = true;  // Re-enable clicking for the next round
    }, delay);
}

async function fetchRandomWord() {
    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';
    const selectedCEFR = document.getElementById('cefr-select') ? document.getElementById('cefr-select').value.toUpperCase() : '';

    console.log("Selected POS:", selectedPOS);
    console.log("Selected CEFR:", selectedCEFR);

    // Filter results based on selected CEFR and POS values
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

    if (selectedCEFR) {
        // Filter by CEFR level if selected
        filteredResults = filteredResults.filter(r => r.CEFR && r.CEFR.toUpperCase() === selectedCEFR);
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
    
    console.log("Filtered Results:", filteredResults);

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


function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}