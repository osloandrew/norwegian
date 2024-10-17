let currentWord;
let correctTranslation;
let gameActive = false;
let chimeAudio = new Audio('chime.mp3'); // Path to your chime sound file
chimeAudio.volume = 0.2;
const gameContainer = document.getElementById('results-container'); // Assume this is where you'll display the game

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
}


function fetchIncorrectTranslations(gender, correctTranslation) {
    const incorrectResults = results.filter(r => {
        return r.gender === gender && r.engelsk !== correctTranslation;
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

    gameContainer.innerHTML = `
        <div class="definition result-header game-word-card">
            <h2>${displayedWord}</h2>
        </div>
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

    // Add CSS styling to the grid
    gameContainer.querySelector('.game-grid').style.display = 'grid';
    gameContainer.querySelector('.game-grid').style.gridTemplateColumns = 'repeat(2, 1fr)';
    gameContainer.querySelector('.game-grid').style.gap = '10px';
}

function handleTranslationClick(selectedTranslation) {
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
        delay = 2500; // 2.5 seconds delay if incorrect
    }

    // Generate a new word after 1.5 seconds
    setTimeout(startWordGame, delay);
}

async function fetchRandomWord() {
    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';
    const selectedCEFR = document.getElementById('cefr-select') ? document.getElementById('cefr-select').value.toUpperCase() : '';

    console.log("Selected POS:", selectedPOS);
    console.log("Selected CEFR:", selectedCEFR);

    // Filter results based on selected CEFR and POS values
    let filteredResults = results.filter(r => r.engelsk); // Ensure only words with English translations

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
    filteredResults = filteredResults.filter(r => r.ord.toLowerCase() !== r.engelsk.toLowerCase());

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
    };
}


function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
