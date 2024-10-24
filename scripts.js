// Global Variables
let results = [];
const resultsContainer = document.getElementById('results-container');

// Function to show or hide the landing card
function showLandingCard(show) {
    const landingCard = document.getElementById('landing-card');
    if (landingCard) {
        landingCard.style.display = show ? 'block' : 'none';
    }
}

// Function to navigate back to the landing card when the H1 is clicked
function returnToLandingPage() {
    clearInput();  // Clear the search input field
    showLandingCard(true);  // Show the landing card again

    // Ensure that only results are cleared, not the landing card
    clearContainer();  // Ensure this does not remove landing card

    // Update the URL to indicate we're on the landing page
    const url = new URL(window.location);
    url.searchParams.set('landing', 'true');
    url.searchParams.delete('query');  // Remove the query parameter
    window.history.pushState({}, '', url);
}


// Debounce function to limit how often search is triggered
function debounceSearchTrigger(func, delay) {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(func, delay);
}

// Handle the key input, performing a search on 'Enter' or debouncing otherwise
function handleKey(event) {
    // Call search function when 'Enter' is pressed or debounce it otherwise
    debounceSearchTrigger(() => {
        if (event.key === 'Enter') {
            search();
            console.log('Enter key detected, search triggered.');
        }
    }, 300);  // Delay of 300ms before calling search()
}

function clearContainer() {
    const landingCard = document.getElementById('landing-card');
    if (landingCard) {
        // Temporarily remove the landing card from the container, then clear everything else
        landingCard.parentNode.removeChild(landingCard);
    }

    resultsContainer.innerHTML = ''; // Clear everything else in the container

    // Restore the landing card
    if (landingCard) {
        resultsContainer.appendChild(landingCard);
    }
}


function appendToContainer(content) {
    resultsContainer.innerHTML += content;
}

function shouldNotDecline(adjective) {
    // Pattern for adjectives that do not decline (same form in all genders)
    const noDeclinePattern = /(ende|bra|ing|y|ekte)$/i;
    
    return noDeclinePattern.test(adjective);
}

function shouldNotTakeTInNeuter(adjective) {
        // Pattern for adjectives that double the 't' in the neuter form
    const doubleTPattern = /[iy]$/i;  // e.g., adjectives ending in 'y' or 'i' take a 'tt' in neuter

    // Pattern for adjectives that do not take 't' in the neuter form
    const noTNeuterPattern = /(ende|ant|et|isk|ig|rt|sk)$/i;

    // Handle adjectives that double the 't'
    if (doubleTPattern.test(adjective)) {
        return 'double';
    }

    // Handle adjectives that do not take 't' in neuter form
    if (noTNeuterPattern.test(adjective)) {
        return true;
    }

    // Otherwise, it should take 't'
    return false;
}

function formatDefinitionWithMultipleSentences(definition) {
    return definition
        .split(/(?<=[.!?])\s+/)  // Split by sentence delimiters
        .map(sentence => `<p class="example">${sentence}</p>`)  // Wrap each sentence in a <p> tag
        .join('');  // Join them together into a string
}

function togglePronunciationGuide() {
    const pronunciationWrapper = document.querySelector('.pronunciation-wrapper'); // Target the wrapper div
    pronunciationWrapper.classList.toggle('hidden'); // Toggle hidden class
}

// Filter results based on selected part of speech (POS)
function filterResultsByPOS(results, selectedPOS) {
    if (!selectedPOS) return results;

    return results.filter(r => {
        // Handle nouns based on gender
        if (selectedPOS === 'noun') {
            return r.gender && ['en', 'et', 'ei', 'en-et', 'en-ei-et'].some(genderVal =>
                r.gender.toLowerCase().includes(genderVal));
        }

        // Handle all other POS types like "verb," "adjective," etc.
        return r.gender && r.gender.toLowerCase().includes(selectedPOS.toLowerCase());
    });
}


// Filter results based on selected CEFR level
function filterResultsByCEFR(results, selectedCEFR) {
    if (!selectedCEFR) return results;
    return results.filter(r => r.CEFR && r.CEFR.toUpperCase() === selectedCEFR.toUpperCase());
}


// Helper function to format 'gender' (grammatical gender) based on its value
function formatGender(gender) {
    return gender && ['en', 'et', 'ei'].includes(gender.substring(0, 2).toLowerCase()) ? 'noun - ' + gender : gender;
}

// Clear the search input field
function clearInput() {
    document.getElementById('search-bar').value = '';
}

// Fetch the dictionary data from the file or server
async function fetchAndLoadDictionaryData() {
    try {
        console.log('Attempting to load data from local CSV file...');
        const localResponse = await fetch('norwegianWords.csv');
        if (!localResponse.ok) throw new Error(`HTTP error! Status: ${localResponse.status}`);
        const localData = await localResponse.text();
        console.log('Data successfully loaded from local file.');
        parseCSVData(localData);
    } catch (localError) {
        console.error('Error fetching or parsing data from local CSV file:', localError);
        console.log('Falling back to Google Sheets.');

        // Fallback to Google Sheets CSV
        try {
            const response = await fetch('https://docs.google.com/spreadsheets/d/e/2PACX-1vSl2GxGiiO3qfEuVM6EaAbx_AgvTTKfytLxI1ckFE6c35Dv8cfYdx30vLbPPxadAjeDaSBODkiMMJ8o/pub?output=csv');
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            const data = await response.text();
            parseCSVData(data);  // Use PapaParse for CSV parsing
        } catch (googleSheetsError) {
            console.error('Error fetching or parsing data from Google Sheets:', googleSheetsError);
        }
    }
}

// Parse the CSV data using PapaParse
function parseCSVData(data) {
    Papa.parse(data, {
        header: true,
        skipEmptyLines: true,
        complete: function (resultsFromParse) {
            results = resultsFromParse.data.map(entry => {
                entry.ord = entry.ord.trim();  // Ensure the word is trimmed
                return entry;
            });
            console.log('Parsed and cleaned data:', results);
        },
        error: function (error) {
            console.error('Error parsing CSV:', error);
        }
    });
}

function flagMissingWordEntry(word) {
    // URL of your Google Form
    const formUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSdMpnbI2DyUo6SWBRR53ZnYucDPdAYXK9rksP3AhMrC7b91Dw/formResponse'; 

    // Prepare the data to be sent
    const formData = new FormData();
    formData.append('entry.279285583', word); // This is the field ID for the word entry

    // Send the form data via POST request
    fetch(formUrl, {
        method: 'POST',
        body: formData,
        mode: 'no-cors' // Necessary to avoid CORS issues
    })
    .then(() => {
        alert(`The word "${word}" has been flagged successfully!`);
    })
    .catch(error => {
        console.error('Error flagging the word:', error);
        alert('There was an issue flagging this word. Please try again later.');
    });
}

// Generate and display a random word or sentence
async function randomWord() {
    const type = document.getElementById('type-select').value;
    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';
    const selectedCEFR = document.getElementById('cefr-select') ? document.getElementById('cefr-select').value.toUpperCase() : '';

    // Do not pass 'random' as the query, instead just update the URL to indicate it's a random query
    updateURL('', type, selectedPOS);  // Pass an empty string for the query part to avoid "random" in the URL

    // Ensure that the 'results' array is populated
    if (!results || !results.length) {
        console.warn('No results available to pick a random word or sentence.');
        document.getElementById('results-container').innerHTML = `
            <div class="definition error-message">
                <h2 class="word-gender">
                    Error <span class="gender">Unavailable Entry</span>
                </h2>
                <p>No random entries available. Please try again later.</p>
            </div>
        `;
        hideSpinner();
        return;
    }

    showSpinner();
    clearInput();  // Clear search bar when generating a random word or sentence
    showLandingCard(false);
    clearContainer();

    let filteredResults;

    if (type === 'sentences') {
        // Filter results that contain example sentences (for the 'sentences' type)
        filteredResults = results.filter(r => r.eksempel);  // Assuming sentences are stored under the 'eksempel' key

        // Additionally, filter by the selected CEFR level if applicable
        filteredResults = filteredResults.filter(r => !selectedCEFR || (r.CEFR && r.CEFR.toUpperCase() === selectedCEFR));

    } else {
        // Filter results by the selected part of speech (for 'words' type)
        filteredResults = filterResultsByPOS(results, selectedPOS);

        // Additionally, filter by the selected CEFR level if applicable
        filteredResults = filteredResults.filter(r => !selectedCEFR || (r.CEFR && r.CEFR.toUpperCase() === selectedCEFR));

        // Exclude certain words here
        filteredResults = filteredResults.filter(r => !noRandom.includes(r.ord.toLowerCase()));
    }

    if (!filteredResults.length) {
        console.warn('No random entries available for the selected type.');
        document.getElementById('results-container').innerHTML = `
            <div class="definition error-message">
                <h2 class="word-gender">
                    Error <span class="gender">Unavailable Entry</span>
                </h2>
                <p>No random entries available. Try selecting another type or part of speech.</p>
            </div>
        `;
        return;
    }

    // Randomly select a result from the filtered results
    const randomResult = filteredResults[Math.floor(Math.random() * filteredResults.length)];

    // Reset old highlights by removing any previous span tags
    randomResult.eksempel = randomResult.eksempel ? randomResult.eksempel.replace(/<span[^>]*>(.*?)<\/span>/gi, '$1') : '';

    // Generate CEFR label based on the result's CEFR value
    let cefrLabel = '';
    if (randomResult.CEFR === 'A1') {
        cefrLabel = '<div class="sentence-cefr-label easy">A1</div>';
    } else if (randomResult.CEFR === 'A2') {
        cefrLabel = '<div class="sentence-cefr-label easy">A2</div>';
    } else if (randomResult.CEFR === 'B1') {
        cefrLabel = '<div class="sentence-cefr-label medium">B1</div>';
    } else if (randomResult.CEFR === 'B2') {
        cefrLabel = '<div class="sentence-cefr-label medium">B2</div>';
    } else if (randomResult.CEFR === 'C') {
        cefrLabel = '<div class="sentence-cefr-label hard">C</div>';
    } else {
        console.warn("CEFR value is missing for this entry:", randomResult);
    }

    if (type === 'sentences') {
        // Split the Norwegian and English sentences
        const sentences = randomResult.eksempel.split(/(?<=[.!?])\s+/);  // Split by sentence delimiters
        const translations = randomResult.sentenceTranslation ? randomResult.sentenceTranslation.split(/(?<=[.!?])\s+/) : [];

        // Randomly select one sentence and its translation
        const randomIndex = Math.floor(Math.random() * sentences.length);
        const selectedSentence = sentences[randomIndex];
        const selectedTranslation = translations[randomIndex] || '';

        // Clear any existing highlights in the sentence
        const cleanedSentence = selectedSentence.replace(/<span style="color: #3c88d4;">(.*?)<\/span>/gi, '$1');

        // Build the sentence HTML
        let sentenceHTML = `
            <div class="result-header">
                <h2>Random Sentence</h2>
            </div>
            <div class="sentence-container">
                <div class="sentence-box-norwegian">
                    <div class="sentence-content">
                        ${cefrLabel}  <!-- Add the CEFR label in the upper-left corner -->
                        <p class="sentence">${cleanedSentence}</p>
                    </div>
                </div>
        `;

        if (selectedTranslation) {
            sentenceHTML += `
                <div class="sentence-box-english">
                    <p class="sentence">${selectedTranslation}</p>
                </div>
            `;
        }

        sentenceHTML += '</div>';  // Close the sentence-container div

        document.getElementById('results-container').innerHTML = sentenceHTML;
        document.title = 'Sentences - Norwegian Dictionary';
    } else {
        // If it's a word, render it with highlighting (if needed)
        displaySearchResults([randomResult], randomResult.ord);

        document.title = 'Words - Norwegian Dictionary';
    }
    hideSpinner();  // Hide the spinner
}

// Function to generate potential inexact matches by removing plural endings, etc.
function generateInexactMatches(query) {
    const variations = [query.toLowerCase().trim()]; // Always include the base query
    
    // Handle common suffixes like 'ing', 'ed', etc.
    const suffixes = ['a', 'e', 'ed', 'en', 'ene', 'er', 'es', 'et', 'ing', 'ly', '-ne', 'r', 's', 't', 'te'];  // Alphabetized
    suffixes.forEach(suffix => {
        if (query.endsWith(suffix)) {
            variations.push(query.slice(0, -suffix.length));
        }
    });
    
    return variations;
}

// Perform a search based on the input query and selected POS
async function search() {
    const query = document.getElementById('search-bar').value.toLowerCase().trim();
    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';
    const selectedCEFR = document.getElementById('cefr-select') ? document.getElementById('cefr-select').value.toUpperCase() : '';  // Fetch the selected CEFR level
    const type = document.getElementById('type-select').value; // Get the search type (words or sentences)
    const normalizedQueries = [query.toLowerCase().trim()]; // Use only the base query for matching

    // Clear any previous highlights by resetting the `query`
    let cleanResults = results.map(result => {
        if (result.eksempel) {
            result.eksempel = result.eksempel.replace(/<span[^>]*>(.*?)<\/span>/gi, '$1'); // Remove old highlights
        }
        return result;
    });

    // Update the URL with the search parameters
    updateURL(query, type, selectedPOS);  // <--- Trigger URL update

    // Show the spinner at the start of the search
    showSpinner();

    // Update document title with the search term
    document.title = `${query} - Norwegian Dictionary`;

    showLandingCard(false);
    clearContainer(); // Clear previous results

    // Handle empty search query
    if (!query) {
        resultsContainer.innerHTML = `
            <div class="definition error-message">
                <h2 class="word-gender">
                    Error <span class="gender">Empty Search</span>
                </h2>
                <p>Please enter a word in the search field before searching.</p>
            </div>
        `;
        hideSpinner();
        return;
    }

    let matchingResults;

    if (type === 'sentences') {
        // If searching sentences, look for matches in both 'eksempel' and 'sentenceTranslation' fields
        matchingResults = cleanResults.filter(r => {
            return normalizedQueries.some(normQuery => {
                const norwegianSentenceMatch = r.eksempel && r.eksempel.toLowerCase().includes(normQuery); // Match in 'eksempel'
                const englishTranslationMatch = r.sentenceTranslation && r.sentenceTranslation.toLowerCase().includes(normQuery); // Match in 'sentenceTranslation'
                return norwegianSentenceMatch || englishTranslationMatch;
            });
        });

        // Additionally, filter by the selected CEFR level
        matchingResults = filterResultsByCEFR(matchingResults, selectedCEFR);

        // Prioritize the matching results using the prioritizeResults function
        matchingResults = prioritizeResults(matchingResults, query, 'eksempel');

        // Highlight the query in both 'eksempel' and 'sentenceTranslation'
        matchingResults.forEach(result => {
            result.eksempel = highlightQuery(result.eksempel, query);
            if (result.sentenceTranslation) {
                result.sentenceTranslation = highlightQuery(result.sentenceTranslation, query);
            }
        });        
        renderSentences(matchingResults, query); // Pass the query for highlighting
    } else {

        // Filter results by query and selected POS for words
        matchingResults = cleanResults.filter(r => {
            // Exact and partial match logic
            const matchesQuery = normalizedQueries.some(variation => {
                const exactRegex = new RegExp(`\\b${variation}\\b`, 'i'); // Exact match regex for whole word
                const partialRegex = new RegExp(variation, 'i'); // Partial match for larger words like "bevegelsesfrihet"
        
                const wordMatch = exactRegex.test(r.ord.toLowerCase()) || partialRegex.test(r.ord.toLowerCase());
        
                const englishValues = r.engelsk.toLowerCase().split(',').map(e => e.trim());
                const englishMatch = englishValues.some(eng => exactRegex.test(eng) || partialRegex.test(eng));
        
                return wordMatch || englishMatch;
            });

            // Handle POS filtering for nouns and other parts of speech
            return matchesQuery && (!selectedPOS || (selectedPOS === 'noun' && ['en', 'et', 'ei', 'en-et', 'en-ei-et'].some(gender => r.gender.toLowerCase().includes(gender))) || r.gender.toLowerCase().includes(selectedPOS)) && (!selectedCEFR || r.CEFR === selectedCEFR);
        });

        matchingResults = prioritizeResults(matchingResults, query, 'ord');
        
        // Check if there are **no exact matches**
        const noExactMatches = matchingResults.length === 0;

        // If no exact matches are found, find inexact matches
        if (noExactMatches) {

            // Generate inexact matches based on transformations
            const inexactWordQueries = generateInexactMatches(query);
            console.log(`Inexact Queries Generated: ${inexactWordQueries}`);

            // Now search for results using these inexact queries
            let inexactWordMatches = results.filter(r => {
                const matchesInexact = inexactWordQueries.some(inexactQuery => r.ord.toLowerCase().includes(inexactQuery) || r.engelsk.toLowerCase().includes(inexactQuery));
                return matchesInexact && (!selectedPOS || (selectedPOS === 'noun' && ['en', 'et', 'ei', 'en-et', 'en-ei-et'].some(gender => r.gender.toLowerCase().includes(gender))) || r.gender.toLowerCase().includes(selectedPOS)) && (!selectedCEFR || r.CEFR === selectedCEFR);
            }).slice(0, 10); // Limit to 10 results

            // Display the "No Exact Matches" message
            resultsContainer.innerHTML = `
                <div class="definition error-message">
                    <h2 class="word-gender">
                        No Exact Matches Found <span class="gender"></span>
                    </h2>
                    <p>We couldn't find exact matches for "${query}". Here are some inexact results:</p>
                    <button class="sentence-btn back-btn">
                        <i class="fas fa-flag"></i> Flag Missing Word Entry
                    </button>
                </div>
            `;

            // Add flag button functionality
            const flagButton = document.querySelector('.back-btn');
            if (flagButton) {
                flagButton.addEventListener('click', function() {
                    const wordToFlag = document.getElementById('search-bar').value;
                    flagMissingWordEntry(wordToFlag);
                });
            }

            // If inexact matches are found, display them below the message
            if (inexactWordMatches.length > 0) {
                displaySearchResults(inexactWordMatches);

                // Reattach the flag button functionality AFTER rendering the search results
                const flagButton = document.querySelector('.back-btn');
                if (flagButton) {
                    flagButton.addEventListener('click', function() {
                        const wordToFlag = document.getElementById('search-bar').value;
                        console.log("Flagging word:", wordToFlag);  // Debugging log
                        flagMissingWordEntry(wordToFlag);
                    });
                }
            } else {
                clearContainer();
                appendToContainer(`
            <div class="definition error-message">
                <h2 class="word-gender">
                    No Matches Found <span class="gender"></span>
                </h2>
                <p>We couldn't find any matches for "${query}".</p>
                <button class="sentence-btn back-btn">
                    <i class="fas fa-flag"></i> Flag Missing Word Entry
                </button>
            </div>`
            );

            const flagButton = document.querySelector('.back-btn');
            if (flagButton) {
                flagButton.addEventListener('click', function () {
                    const wordToFlag = document.getElementById('search-bar').value;
                    flagMissingWordEntry(wordToFlag);
                });
            }
        }

            hideSpinner();
            return;
        }

        // Prioritization logic for words (preserving the exact behavior)
        matchingResults = matchingResults.sort((a, b) => {
            const queryLower = query.toLowerCase();
                
            // 1. Prioritize exact match in the Norwegian term
            const isExactMatchA = a.ord.toLowerCase() === queryLower;
            const isExactMatchB = b.ord.toLowerCase() === queryLower;
            if (isExactMatchA && !isExactMatchB) {
                return -1;
            }
            if (!isExactMatchA && isExactMatchB) {
                return 1;
            }
        
            // 2. Prioritize whole word match (even if part of a phrase or longer sentence)
            const regexExactMatch = new RegExp(`\\b${queryLower}\\b`, 'i'); // Whole word boundary match
            const aExactInPhrase = regexExactMatch.test(a.ord);
            const bExactInPhrase = regexExactMatch.test(b.ord);
            if (aExactInPhrase && !bExactInPhrase) {
                return -1;
            }
            if (!aExactInPhrase && bExactInPhrase) {
                return 1;
            }
        
            // 3. Prioritize exact match in the comma-separated list of English definitions
            const aIsInCommaList = a.engelsk.toLowerCase().split(',').map(str => str.trim()).includes(queryLower);
            const bIsInCommaList = b.engelsk.toLowerCase().split(',').map(str => str.trim()).includes(queryLower);
            if (aIsInCommaList && !bIsInCommaList) {
                return -1;
            }
            if (!aIsInCommaList && bIsInCommaList) {
                return 1;
            }
        
            // 4. Deprioritize compound words where the query appears in a larger word
            const aContainsInWord = a.ord.toLowerCase().includes(queryLower) && a.ord.toLowerCase() !== queryLower;
            const bContainsInWord = b.ord.toLowerCase().includes(queryLower) && b.ord.toLowerCase() !== queryLower;
            if (aContainsInWord && !bContainsInWord) {
                return 1;
            }
            if (!aContainsInWord && bContainsInWord) {
                return -1;
            }
        
            // 5. Sort by the position of the query in the word (earlier is better)
            const aIndex = a.ord.toLowerCase().indexOf(queryLower);
            const bIndex = b.ord.toLowerCase().indexOf(queryLower);
            return aIndex - bIndex;
        });                

        displaySearchResults(matchingResults); // Render word-specific results
    }

    hideSpinner(); // Hide the spinner
}

// Check if any sentences exist for a word or its variations
function checkForSentences(word, pos) {
    const lowerCaseWord = word.trim().toLowerCase();
    const wordParts = lowerCaseWord.split(',').map(w => w.trim());
    let sentenceFound = false;

    // Iterate through each part of the comma-separated list
    wordParts.forEach(wordPart => {
        // Find matching word entry by both word and POS
        const matchingWordEntry = results.find(result => {
            const wordMatch = result.ord.toLowerCase().includes(wordPart);
            // Handle POS matching for nouns and other parts of speech
            const posMatch = (pos === 'noun' && ['en', 'et', 'ei', 'en-et', 'en-ei-et'].some(gender => result.gender.toLowerCase().includes(gender))) 
                            || result.gender.toLowerCase().includes(pos.toLowerCase());
            return wordMatch && posMatch;  // Ensure both word and POS match
        });

        if (!matchingWordEntry) {
            console.log(`No matching word entry for '${wordPart}' with POS '${pos}'`);
            return;
        }

        // Generate word variations
        const wordVariations = generateWordVariationsForSentences(wordPart, pos);

        // Check if any sentences in the data include this word or its variations in the 'eksempel' field
        if (results.some(result => 
            result.eksempel && wordVariations.some(variation => {
                if (pos === 'adverb' || pos === 'conjunction' || pos === 'preposition' || pos === 'interjection' || pos === 'numeral') {
                // Apply the strict match logic for these POS types (perfect match, no special endings)
                const regex = new RegExp(`(^|\\s)${variation}($|[\\s.,!?;])`, 'gi');
                const match = regex.test(result.eksempel);
                return match;
                } else {
                const regex = new RegExp(`\\b${variation}`, 'i');  // Match word boundaries
                const match = regex.test(result.eksempel.toLowerCase().trim());
                return match;
            }
            })
        )) {
            sentenceFound = true;  // If a sentence is found for any variation, mark as true
        }
    });
    return sentenceFound;
}

// Handle change in part of speech (POS) filter
function handlePOSChange() {
    const query = document.getElementById('search-bar').value.toLowerCase().trim();
    const selectedPOS = document.getElementById('pos-select').value.toLowerCase(); // Fetch POS
    if (gameActive && document.getElementById('type-select').value === 'word-game') {
        // Adjust the word game instead of triggering a dictionary search
        startWordGame();  // Re-fetch a new word for the game based on the new POS filter
    } else {
    // Update the URL with the search parameters
    updateURL(query, 'words', selectedPOS);  // <--- Trigger URL update with type 'words'
    
    // If the search field is empty, generate a random word based on the POS
    if (!query) {
        console.log('Search field is empty. Generating random word based on selected POS.');
        randomWord();
    } else {
        search(); // If there is a query, perform the search with the selected POS
    }
}
}

// Handle change in search type (words/sentences)
function handleTypeChange() {
    // Retrieve selected type and query from the search bar
    const type = document.getElementById('type-select').value;
    const query = document.getElementById('search-bar').value.toLowerCase().trim();

    // Container to update and other UI elements
    const searchContainerInner = document.getElementById('search-container-inner'); // The container to update
    const searchBarWrapper = document.getElementById('search-bar-wrapper');
    const randomBtn = document.getElementById('random-btn');
    
    // Retrieve selected part of speech (POS) if available
    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';

    // Filter containers for POS, Genre, and CEFR
    const posFilterContainer = document.querySelector('.pos-filter');
    const genreFilterContainer = document.getElementById('genre-filter'); // Get the Genre filter container
    const cefrFilterContainer = document.querySelector('.cefr-filter'); // Get the CEFR filter container

    // Filter dropdowns for POS, Genre, and CEFR
    const posSelect = document.getElementById('pos-select');
    const genreSelect = document.getElementById('genre-select');
    const cefrSelect = document.getElementById('cefr-select');  // Get the CEFR filter dropdown

    // Update the URL with the selected type, query, and POS
    updateURL(query, type, selectedPOS);  // This ensures the type is reflected in the URL

    // Add logic for the "Stories" type
    if (type === 'stories') {

        genreFilterContainer.style.display = 'inline-flex'; // Show genre dropdown in story mode
        searchBarWrapper.style.display = 'none'; // Hide search-bar-wrapper
        posFilterContainer.style.display = 'none';
        randomBtn.style.display = 'none'; // Hide random button
        searchContainerInner.style.display = 'inline-block'; // Show search container
        
        showLandingCard(false);

        cefrSelect.disabled = false; // Enable CEFR filter
        cefrFilterContainer.classList.remove('disabled'); // Visually enable the CEFR filter
        cefrSelect.value = '';  // Reset to default "CEFR Level"
        cefrSelect.options[0].text = "CEFR Level";  // Revert CEFR label to default

        document.title = 'Stories - Norwegian Dictionary';

        // Load stories data if not already loaded
        if (!storyResults.length) {
            fetchAndLoadStoryData().then(() => {
                displayStoryList();  // Display the list of stories
            });
        } else {
            displayStoryList();  // Display the list of stories if already loaded
        }

    } else if (type === 'sentences') {

        // Show POS and CEFR dropdowns, hide Genre dropdown
        genreFilterContainer.style.display = 'none'; // Hide genre dropdown in sentences mode

        searchBarWrapper.style.display = 'inline-flex';
        randomBtn.style.display = 'block';
        searchContainerInner.style.display = 'flex';
        
        searchContainerInner.classList.remove('word-game-active');
        gameActive = false;

        // Disable the POS dropdown and gray it out
        posFilterContainer.style.display = 'inline-flex'; // Show POS dropdown
        posSelect.disabled = true; // Disable POS dropdown
        posSelect.value = '';  // Reset to "Part of Speech" option
        posFilterContainer.classList.add('disabled');  // Add the 'disabled' class

        // Disable the CEFR dropdown and gray it out
        cefrSelect.disabled = false;  // Enable CEFR filter when sentences are selected
        cefrSelect.value = '';  // Reset to "CEFR Level" option
        cefrFilterContainer.classList.remove('disabled');  // Visually enable the CEFR filter

        cefrSelect.options[0].text = "CEFR Level";  // Revert CEFR label to default

        document.title = 'Sentences - Norwegian Dictionary'; // Update browser tab title
        
        // If the search bar is not empty, perform a sentence search
        if (query) {
            console.log('Searching for sentences with query:', query);
            search();  // This will trigger a search for sentences based on the search bar query
        } else {
            console.log('Search bar empty, generating a random sentence.');
            randomWord();  // Generate a random sentence if the search bar is empty
        }
    } else if (type === 'word-game') {
        // Handle "Word Game" type
        searchBarWrapper.style.display = 'none'; // Hide search-bar-wrapper
        randomBtn.style.display = 'none'; // Hide random button
        searchContainerInner.style.display = 'inline-block'; // Set search container layout

        searchContainerInner.classList.add('word-game-active'); // Indicate word game is active

        // Handle "word-game" option
        showLandingCard(false);

        // Show POS and CEFR dropdowns, hide Genre dropdown
        genreFilterContainer.style.display = 'none'; // Hide genre dropdown in sentences mode

        // Ensure POS and CEFR are enabled for the word game
        posFilterContainer.style.display = 'inline-flex';
        posSelect.value = '';  // Reset to "Part of Speech" option
        posSelect.disabled = false;
        posFilterContainer.classList.remove('disabled');  // Remove the 'disabled' class

        cefrSelect.disabled = false;
        cefrFilterContainer.classList.remove('disabled');
        cefrSelect.value = '';  // Reset to "CEFR Level" option

        // Change the label to something more compact when "WORD GAME" is selected
        cefrSelect.options[0].text = "Starting Level";

        // Remove the query from the URL
        const url = new URL(window.location);
        url.searchParams.delete('query');
        window.history.replaceState({}, '', url);  // Update the URL without reloading the page

        // Change the browser tab title to reflect the word game
        document.title = 'Word Game - Norwegian Dictionary';
        
        resetGame();
        startWordGame();  // Call the word game function

    } else {
        // Handle default case (e.g., "Words" type)
        genreFilterContainer.style.display = 'none'; // Hide genre dropdown

        searchBarWrapper.style.display = 'inline-flex'; // Show search-bar-wrapper
        randomBtn.style.display = 'block'; // Show random button
        searchContainerInner.style.display = 'flex'; // Set search container layout

        gameActive = false;
        searchContainerInner.classList.remove('word-game-active');

        // Enable the POS dropdown and restore color
        posFilterContainer.style.display = 'inline-flex';
        posSelect.disabled = false;
        posSelect.value = '';  // Reset to "Part of Speech" option
        posFilterContainer.classList.remove('disabled');  // Remove the 'disabled' class

        // Enable the CEFR dropdown and restore color
        cefrSelect.disabled = false;
        cefrSelect.value = '';  // Reset to "CEFR Level" option
        cefrFilterContainer.classList.remove('disabled');

        cefrSelect.options[0].text = "CEFR Level";  // Revert CEFR label to default

        // Change the browser tab title to reflect words
        document.title = 'Words - Norwegian Dictionary';

        // Optionally, generate a random word if needed when switching back to words
        if (query) {
            console.log('Searching for words with query:', query);
            search();  // Trigger a word search if the search bar has a value
        } else {
            console.log('Search bar empty, generating a random word.');
            randomWord();  // Generate a random word if the search bar is empty
        }
    }
}

// Handle change in CEFR filter
function handleCEFRChange() {
    const query = document.getElementById('search-bar').value.toLowerCase().trim();
    const type = document.getElementById('type-select').value;
    const selectedCEFR = document.getElementById('cefr-select').value.toUpperCase();
    const selectedGenre = document.getElementById('genre-select').value.trim().toLowerCase();

    // Check if the 'stories' tab is active
    if (type === 'stories') {
        // Filter the stories by the selected CEFR level
        const filteredStories = storyResults.filter(story => {
            const genreMatch = selectedGenre ? story.genre.trim().toLowerCase() === selectedGenre : true;
            const cefrMatch = selectedCEFR ? story.CEFR && story.CEFR.toUpperCase() === selectedCEFR : true;

            return genreMatch && cefrMatch;
        });

        // Display the filtered list of stories
        displayStoryList(filteredStories);
    } 
    // Handle the word game logic or dictionary search when 'word-game' or 'words' are selected
    else if (gameActive && type === 'word-game') {
        startWordGame();  // Adjust the word game based on the new CEFR filter
    } else {
        // If the search field is empty, generate a random word based on the CEFR level
        if (!query) {
            console.log('Search field is empty. Generating random word based on selected CEFR.');
            randomWord();  // Ensure randomWord() applies the CEFR filter
        } else {
            search(); // Perform a search with the selected CEFR
        }
    }
}


// Render a list of results (words)
function displaySearchResults(results, query = '') {
    //clearContainer(); // Don't clear the container to avoid overwriting existing content like the "No Exact Matches" message

    query = query.toLowerCase().trim();  // Ensure the query is lowercased and trimmed
    const defaultResult = results.length <= 1; // Determine if there are multiple results
    const multipleResults = results.length > 1; // Determine if there are multiple results

    let htmlString = '';

    // Limit to a maximum of 10 results
    results.slice(0, 10).forEach(result => {
        result.gender = formatGender(result.gender);
        // Directly handle the POS based on the gender field
        result.pos = (['en', 'et', 'ei', 'en-et', 'en-ei-et'].some(gender => result.gender.toLowerCase().includes(gender))) 
                      ? 'noun' : result.gender.toLowerCase();

        // Check if sentences are available using enhanced checkForSentences
        const hasSentences = checkForSentences(result.ord, result.pos);

        // Convert the word to lowercase and trim spaces when generating the ID
        const normalizedWord = result.ord.toLowerCase().trim();

        // Highlight the word being defined (result.ord) in the example sentence
        const highlightedExample = result.eksempel ? highlightQuery(result.eksempel, query || result.ord.toLowerCase()) : '';

        // Determine whether to initially hide the content for multiple results
        const multipleResultsExposedContent = defaultResult ? 'default-hidden-content' : ''; 

        const multipleResultsDefinition = multipleResults ? 'multiple-results-definition' : '';  // Hide content if multiple results
        const multipleResultsHiddenContent = multipleResults ? 'multiple-results-hidden-content' : '';  // Hide content if multiple results
        const multipleResultsDefinitionHeader = multipleResults ? 'multiple-results-definition-header' : ''; 
        const multipleResultsWordgender = multipleResults ? 'multiple-results-word-gender' : ''; 
        const multipleResultsDefinitionText = multipleResults ? 'multiple-results-definition-text' : ''; 
        const multipleResultsgenderClass = multipleResults ? 'multiple-results-gender-class' : ''; 

        // Safely escape the word in JavaScript by replacing special characters
        const escapedWord = result.ord.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\r?\n|\r/g, '');  // Escapes single quotes, double quotes, and removes newlines


        htmlString += `
<div 
  class="definition ${multipleResultsDefinition}" 
  data-word="${escapedWord}" 
  data-pos="${result.pos}" 
  data-engelsk="${result.engelsk}" 
  onclick="if (!window.getSelection().toString()) handleCardClick(event, '${escapedWord}', '${result.pos.replace(/'/g, "\\'").trim()}', '${result.engelsk.replace(/'/g, "\\'").trim()}')">
                <div class="${multipleResultsDefinitionHeader}">
                <h2 class="word-gender ${multipleResultsWordgender}">
                    ${result.ord}
                    ${result.gender ? `<span class="gender ${multipleResultsgenderClass}">${result.gender}</span>` : ''}
                    ${result.engelsk ? `<p class="english ${multipleResultsExposedContent}">${result.engelsk}</p>` : ''}
                    ${result.CEFR ? `<div class="game-cefr-label ${multipleResultsExposedContent} ${getCefrClass(result.CEFR)}">${result.CEFR}</div>` : ''} 
                </h2>
                ${result.definisjon ? `<p class="${multipleResultsDefinitionText}">${result.definisjon}</p>` : ''}
                </div>
                <div class="definition-content ${multipleResultsHiddenContent}"> <!-- Apply the hidden class conditionally -->
                    ${result.engelsk ? `<p class="english"><i class="fas fa-language"></i> ${result.engelsk}</p>` : ''}
                    ${result.uttale ? `<p class="pronunciation"><i class="fas fa-volume-up"></i> ${result.uttale}</p>` : ''}
                    ${result.etymologi ? `<p class="etymology"><i class="fa-solid fa-flag"></i> ${result.etymologi}</p>` : ''}
                    ${result.CEFR ? `<p style="display: inline-flex; align-items: center; font-family: 'Noto Sans', sans-serif; font-weight: bold; text-transform: uppercase; font-size: 12px; color: #4F4F4F;"><i class="fa-solid fa-signal" style="margin-right: 5px;"></i><span style="display: inline-block; padding: 3px 7px; border-radius: 4px; background-color: ${getCefrColor(result.CEFR)};">${result.CEFR}</span></p>` : ''}
                </div>
                <!-- Render the highlighted example sentence here -->
                <div class="${multipleResultsHiddenContent}">${highlightedExample ? `<p class="example">${formatDefinitionWithMultipleSentences(highlightedExample)}</p>` : ''}</div>
                <!-- Show "Show Sentences" button only if sentences exist -->
                <div class="${multipleResultsHiddenContent}">${hasSentences ? `<button class="sentence-btn" data-word="${escapedWord}" onclick="event.stopPropagation(); fetchAndRenderSentences('${escapedWord}', '${result.pos}')">Show Sentences</button>` : ''}</div>
            </div>
            <!-- Sentences container is now outside the definition block -->
            <div class="sentences-container" id="sentences-container-${normalizedWord}"></div>
        `;
    });
    appendToContainer(htmlString);
}

// Function to find the gender of a word
function getWordGender(word) {
    const matchingWord = results.find(result => result.ord.toLowerCase() === word.toLowerCase());
    return matchingWord ? matchingWord.gender : 'unknown';  // Default to 'unknown' if not found
}

function getCefrClass(cefrLevel) {
    if (cefrLevel === 'A1' || cefrLevel === 'A2') {
        return 'easy';
    } else if (cefrLevel === 'B1' || cefrLevel === 'B2') {
        return 'medium';
    } else if (cefrLevel === 'C') {
        return 'hard';
    }
    return '';
}

function getCefrColor(cefrLevel) {
    switch (cefrLevel) {
        case 'A1':
        case 'A2':
            return '#C7E3B6';  // Green for 'easy'
        case 'B1':
        case 'B2':
            return '#F2D96B';  // Yellow for 'medium'
        case 'C':
            return '#E9A895';  // Red for 'hard'
        default:
            return '#ccc';     // Default background color
    }
}



// Utility function to generate word variations for verbs ending in -ere and handle adjective/noun forms
function generateWordVariationsForSentences(word, pos) {
    const variations = [];
    
    // Split the word into parts in case it's a phrase (e.g., "vedtatt sannhet")
    const wordParts = word.split(' ');

    // Handle phrases with slashes (e.g., "være/vær så snill", "logge inn/på")
    if (word.includes('/')) {
        // Split on the slash and create variations for both parts
        const [firstPart, secondPart] = word.split('/');
        const restOfPhrase = word.split(' ').slice(1).join(' ');  // Get the rest of the phrase after the first word
        
        variations.push(`${firstPart} ${restOfPhrase}`);  // Add the first part with the rest of the phrase
        variations.push(`${secondPart} ${restOfPhrase}`); // Add the second part with the rest of the phrase
        return variations;
    }

    // Reflexive pronouns to handle reflexive verbs with variations (e.g., "seg", "deg", "meg", "oss", etc.)
    const reflexivePronouns = ['seg', 'deg', 'meg', 'oss', 'dere'];

    // If it's a single word
    if (wordParts.length === 1) {
        const singleWord = wordParts[0];
        let stem = singleWord;
        let gender = getWordGender(singleWord);

        if (singleWord.length <= 2) {
            // Handle the case where the word is too short to generate meaningful variations
            console.warn(`Word "${singleWord}" is too short to generate variations.`);
            variations.push(singleWord);  // Just return the word as is
            return variations;
        }

        if (pos === 'noun' && gender.includes('ei')) {
            if (singleWord.endsWith('e')) {
                stem = singleWord.slice(0, -1);  // Remove the final -e from the word
            }
                variations.push(
                    `${stem}`,        // setning
                    `${stem}e`,       // jente
                    `${stem}a`,       // jenta
                    `${stem}en`,      // jenten
                    `${stem}er`,      // jenter
                    `${stem}ene`,     // jentene
                );
        // Handle verb variations if the word is a verb and ends with "e"
        } else if (pos === 'verb') {
            if (singleWord.endsWith('e')) {
                stem = singleWord.slice(0, -1);  // Remove the final -e from the verb
            } 
            variations.push(
                `${stem}`,         // imperative: anglifiser
                `${stem}a`,        // past tense: snakka
                `${stem}e`,        // infinitive: anglifisere
                `${stem}er`,       // present tense: anglifiserer
                `${stem}es`,       // passive: anglifiseres
                `${stem}et`,       // past tense: snakket
                `${stem}r`,        // present tense: bor
                `${stem}t`,        // past participle: anglifisert
                `${stem}te`        // past tense: anglifiserte
            );
        } else {
            // For non-verbs, just add the word itself as a variation
            variations.push(singleWord);
        }

    // If it's a phrase (e.g., "vedtatt sannhet"), handle each part separately
    } else if (wordParts.length >= 2) {
        const [firstWord, secondWord, ...restOfPhrase] = wordParts;
        const remainingPhrase = restOfPhrase.join(' ');

        // Handle reflexive verbs like "beklage seg" with variations for reflexive pronouns
        if (reflexivePronouns.includes(secondWord)) {
            let stem;
            // Only remove the final 'e' if it exists; otherwise, use the full word (e.g., for "bry")
            if (firstWord.endsWith('e')) {
                stem = firstWord.slice(0, -1);  // Remove the final -e from the verb
            } else {
                stem = firstWord;  // Use the full word if it doesn't end with 'e'
            }
            // Add variations for all reflexive pronouns (seg, deg, meg, etc.)
            reflexivePronouns.forEach(reflexive => {
                variations.push(
                    `${stem}e ${reflexive} ${remainingPhrase}`,   // infinitive
                    `${stem}er ${reflexive} ${remainingPhrase}`,  // present tense
                    `${stem}te ${reflexive} ${remainingPhrase}`,  // past tense
                    `${stem}t ${reflexive} ${remainingPhrase}`,   // past participle
                    `${stem}et ${reflexive} ${remainingPhrase}`,  // past tense/past participle
                    `${stem}a ${reflexive} ${remainingPhrase}`,  // past tense/past participle
                    `${stem} ${reflexive} ${remainingPhrase}`,    // imperative
                    `${stem}es ${reflexive} ${remainingPhrase}`   // passive
                );
            });

        } else if (wordParts.length === 2) {

            // Handle adjective inflection (e.g., "vedtatt" -> "vedtatte")
            const adjectiveVariations = [firstWord, firstWord.replace(/t$/, 'te')];  // Add plural/adjective form

            // Handle noun pluralization (e.g., "sannhet" -> "sannheter")
            const nounVariations = [secondWord, secondWord + 'er'];  // Add plural form for nouns

            // Combine all variations of adjective and noun
            adjectiveVariations.forEach(adj => {
                nounVariations.forEach(noun => {
                    variations.push(`${adj} ${noun}`);
                });
            });
        } else {
            // For other longer phrases, just return the phrase as is
            variations.push(word);
        }

    } else {
        // Add the original phrase as a variation (no transformation needed for long phrases)
        variations.push(word);
    }

    return variations;
}


// Render a single sentence
function renderSentence(sentenceResult) {
    // Split the example by common sentence delimiters (period, question mark, exclamation mark)
    const sentences = sentenceResult.eksempel.split(/(?<=[.!?])\s+/);

    // Get the first sentence from the array
    const firstSentence = sentences[0];

    const sentenceHTML = `
        <div class="definition">
            <p class="sentence">${firstSentence}</p>
        </div>
    `;

    document.getElementById('results-container').innerHTML = sentenceHTML;
}

function renderSentences(sentenceResults, word) {
    clearContainer(); // Clear previous results

    const query = word.trim().toLowerCase(); // Trim and lower-case the search term for consistency
    let exactMatches = [];
    let partialMatches = [];
    let uniqueSentences = new Set(); // Track unique sentences

    const regexExactMatch = new RegExp(`\\b${query}\\b`, 'i');

    sentenceResults.forEach(result => {
        // Split example sentences by common sentence delimiters (period, question mark, exclamation mark)
        const sentences = result.eksempel.match(/[^.!?]+[.!?]*/g) || [result.eksempel];
        const translations = result.sentenceTranslation ? result.sentenceTranslation.match(/[^.!?]+[.!?]*/g) : [];

        // Generate the CEFR label based on the result's CEFR value
        let cefrLabel = '';
        if (result.CEFR === 'A1') {
            cefrLabel = '<div class="sentence-cefr-label easy">A1</div>';
        } else if (result.CEFR === 'A2') {
            cefrLabel = '<div class="sentence-cefr-label easy">A2</div>';
        } else if (result.CEFR === 'B1') {
            cefrLabel = '<div class="sentence-cefr-label medium">B1</div>';
        } else if (result.CEFR === 'B2') {
            cefrLabel = '<div class="sentence-cefr-label medium">B2</div>';
        } else if (result.CEFR === 'C') {
            cefrLabel = '<div class="sentence-cefr-label hard">C</div>';
        }

        // Iterate through each sentence and match it with its translation
        sentences.forEach((sentence, index) => {
            const trimmedSentence = sentence.trim();
            const translation = translations[index] || '';

            if (!uniqueSentences.has(trimmedSentence)) {
                // Only add unique sentences
                uniqueSentences.add(trimmedSentence);

                // Check for exact match (whole word match) in both the Norwegian sentence and English translation
                if (regexExactMatch.test(sentence.toLowerCase()) || regexExactMatch.test(translation.toLowerCase())) {
                    exactMatches.push({ cefrLabel, sentence: highlightQuery(sentence, query), translation: highlightQuery(translation, query) });
                } 
                // Check for partial match in both Norwegian sentence and English translation
                else if (sentence.toLowerCase().includes(query) || translation.toLowerCase().includes(query)) {
                    partialMatches.push({ cefrLabel, sentence: highlightQuery(sentence, query), translation: highlightQuery(translation, query) });
                }
            }
        });
    });

    // Combine exact matches first, then partial matches
    const combinedMatches = [...exactMatches, ...partialMatches].slice(0, 10);

    // Debugging log
    console.log("Exact Matches:", exactMatches);
    console.log("Partial Matches:", partialMatches);
    console.log("Combined Matches:", combinedMatches);

    // Check if no results found
    if (combinedMatches.length === 0) {
        document.getElementById('results-container').innerHTML = `
            <div class="definition error-message">
                <h2 class="word-gender">
                    Error <span class="gender">No Matching Sentences</span>
                </h2>
                <p>No sentences found containing "${query}".</p>
            </div>
        `;
        return;  // Exit early since there's nothing to render
    }

    // Generate HTML for the combined matches
    let htmlString = '';

    if (combinedMatches.length > 0) {
        // Generate the header card
        htmlString += `
            <div class="result-header">
                <h2>Sentence Results for "${word}"</h2>
            </div>
        `;
    }

    combinedMatches.forEach(match => {
        htmlString += `
            <div class="sentence-container">
                <div class="sentence-box-norwegian">
                    <div class="sentence-content">
                        ${match.cefrLabel}
                        <p class="sentence">${match.sentence}</p>
                    </div>
                </div>
        `;

        // Only add the English translation box if it exists
        if (match.translation) {
            htmlString += `
                <div class="sentence-box-english">
                    <p class="sentence">${match.translation}</p>
                </div>
            `;
        }

        htmlString += '</div>';  // Close the sentence-container div
    });

    // Insert the generated HTML into the results container
    document.getElementById('results-container').innerHTML = htmlString;
}


// Highlight search query in text, accounting for Norwegian characters (å, æ, ø) and verb variations
function highlightQuery(sentence, query) {
    if (!query) return sentence; // If no query, return sentence as is.

    // Always remove any existing highlights by replacing the <span> tags to avoid persistent old highlights
    let cleanSentence = sentence.replace(/<span style="color: #3c88d4;">(.*?)<\/span>/gi, '$1');

    // Define a regex pattern that includes Norwegian characters and dynamically inserts the query
    const norwegianLetters = '[\\wåæøÅÆØ]'; // Include Norwegian letters in the pattern
    const regex = new RegExp(`(${norwegianLetters}*${query}${norwegianLetters}*)`, 'gi');

    // Highlight all occurrences of the query in the sentence
    cleanSentence = cleanSentence.replace(regex, '<span style="color: #3c88d4;">$1</span>');

    // Split the query by commas to handle multiple spelling variations
    const queries = query.split(',').map(q => q.trim());

    // Highlight each query variation in the sentence
    queries.forEach(q => {
        // Define a regex pattern that includes Norwegian characters and dynamically inserts the query
        const regex = new RegExp(`(\\b${q}\\b|\\b${q}(?![\\wåæøÅÆØ]))`, 'gi');

        // Highlight all occurrences of the query variation in the sentence
        cleanSentence = cleanSentence.replace(regex, '<span style="color: #3c88d4;">$1</span>');
    });

    // Get part of speech (POS) for the query to pass into `generateWordVariationsForSentences`
    const matchingWordEntry = results.find(result => result.ord.toLowerCase().includes(query));
    const pos = matchingWordEntry ? 
        (['en', 'et', 'ei', 'en-et', 'en-ei-et'].some(gender => matchingWordEntry.gender.toLowerCase().includes(gender)) 
            ? 'noun' 
            : matchingWordEntry.gender.toLowerCase()) 
        : '';

    // Generate word variations using the external function
    const wordVariations = generateWordVariationsForSentences(query, pos);

    // Apply highlighting for all word variations in sequence
    wordVariations.forEach(variation => {
        const norwegianWordBoundary = `\\b${variation}\\b`;
        const regex = new RegExp(norwegianWordBoundary, 'gi');
        cleanSentence = cleanSentence.replace(regex, '<span style="color: #3c88d4;">$&</span>');
    });
    
    return cleanSentence;  // Return the fully updated sentence
}

function renderSentencesHTML(sentenceResults, wordVariations) {
    let htmlString = '';  // String to accumulate the generated HTML
    let exactMatches = [];
    let inexactMatches = [];
    let uniqueSentences = new Set(); // Track unique sentences

    sentenceResults.forEach(result => {
        // Strip out any existing <span> tags from the example sentence
        const rawSentence = result.eksempel.replace(/<[^>]*>/g, '');

        // Split the example sentence into individual sentences, handling sentence delimiters correctly
        const sentences = rawSentence.match(/[^.!?]+[.!?]*/g) || [rawSentence];

        sentences.forEach(sentence => {
            const trimmedSentence = sentence.trim();
            if (!uniqueSentences.has(trimmedSentence)) {
                // Only add unique sentences
                uniqueSentences.add(trimmedSentence);

                // Check if the sentence contains any of the word variations
                let matchedVariation = wordVariations.find(variation => sentence.toLowerCase().includes(variation));

                if (matchedVariation) {

                    // Use a regular expression to match the full word containing any of the variations
                    const norwegianPattern = '[\\wåæøÅÆØ]'; // Pattern including Norwegian letters
                    const regex = new RegExp(`(${norwegianPattern}*${matchedVariation}${norwegianPattern}*)`, 'gi');
                    
                    const highlightedSentence = sentence.replace(regex, '<span style="color: #3c88d4;">$1</span>');

                    // Determine if it's an exact match (contains the exact search term as a full word)
                    const exactMatchRegex = new RegExp(`\\b${matchedVariation.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');

                    if (exactMatchRegex.test(sentence)) {
                        exactMatches.push(highlightedSentence);  // Exact match
                    } else {
                        inexactMatches.push(highlightedSentence);  // Inexact match
                    }
                } else {
                }
            }
        });
    });

    // Combine exact matches first, then inexact matches, respecting the 10 sentence limit
    const combinedMatches = [...exactMatches, ...inexactMatches].slice(0, 10);

    if (combinedMatches.length === 0) {
        console.warn("No sentences found for the word variations.");
    }

    // Generate HTML for the combined matches
    combinedMatches.forEach(sentence => {
        htmlString += `
            <div class="definition">
                <p class="sentence">${sentence}</p>
            </div>
        `;
    });

    // If no sentences were matched, return a message indicating that
    if (htmlString === '') {
        htmlString = `
            <div class="definition error-message">
                <h2 class="word-gender">
                    Error <span class="gender">No Matching Sentences</span>
                </h2>
                <p>No sentences found for the word "${wordVariations.join(', ')}".</p>
            </div>
        `;
    }

    return htmlString;
}


function renderWordDefinition(word) {
    const trimmedWord = word.trim().toLowerCase();

    // Switch the type selector back to "words"
    const typeSelect = document.getElementById('type-select');
    typeSelect.value = 'words';

    // Re-enable the POS filter
    const posSelect = document.getElementById('pos-select');
    posSelect.disabled = false;
    const posFilterContainer = document.querySelector('.pos-filter');
    posFilterContainer.classList.remove('disabled');  // Remove the 'disabled' class for visual effect

    const matchingResults = results.filter(r => r.ord.toLowerCase().trim() === trimmedWord);

    if (matchingResults.length > 0) {
        displaySearchResults(matchingResults);
    } else {
        document.getElementById('results-container').innerHTML = `
            <div class="definition error-message">
                <h2 class="word-gender">
                    Error <span class="gender">No Definition Found</span>
                </h2>
                <p>No definition found for "${trimmedWord}".</p>
            </div>
        `;
    }
}

// Fetch and render sentences for a word or phrase, including handling comma-separated variations
function fetchAndRenderSentences(word, pos) {

    const trimmedWord = word.trim().toLowerCase().replace(/[\r\n]+/g, ''); // Remove any carriage returns or newlines
    const button = document.querySelector(`button[data-word='${word}']`);

    // If the sentences are already visible, toggle them off
    const sentenceContainer = document.getElementById(`sentences-container-${trimmedWord}`);
    
    if (!sentenceContainer) {
        console.error(`Sentence container not found for: ${trimmedWord}`);
        return;
    }

    // Toggle visibility without re-fetching sentences
    if (sentenceContainer.getAttribute('data-fetched') === 'true') {
        if (sentenceContainer.style.display === "block") {
            sentenceContainer.style.display = "none";
            button.innerText = "Show Sentences";
            button.classList.remove('hide');
            button.classList.add('show');
        } else {
            sentenceContainer.style.display = "block";
            button.innerText = "Hide Sentences";
            button.classList.remove('show');
            button.classList.add('hide');
        }
        return;
    }

    sentenceContainer.innerHTML = '';  // Clear previous sentences
    
    // Find the part of speech (POS) of the word
    const matchingWordEntry = results.find(result => result.ord.toLowerCase() === trimmedWord);  // Updated to use exact match

    if (!matchingWordEntry) {
        console.error(`No matching word found for "${trimmedWord}".`);
        return; // Stop if the word isn't found
    }

    // Generate word variations using the external function
    const wordVariations = trimmedWord.split(',').flatMap(w => generateWordVariationsForSentences(w.trim(), pos));

    // First, filter results to get relevant entries
    let relevantEntries = results.filter(r => {
        return wordVariations.some(variation => {
            if (pos === 'adverb' || pos === 'conjunction' || pos === 'preposition' || pos === 'interjection' || pos === 'numeral') {
                const regex = new RegExp(`(^|\\s)${variation}($|[\\s.,!?;])`, 'gi');
                return regex.test(r.eksempel);
            } else {
                // For other parts of speech, ensure the word starts a word
                const regexStartOfWord = new RegExp(`(^|[^\\wåæøÅÆØ])${variation}`, 'i');
                return regexStartOfWord.test(r.eksempel);
            }
        });
    });

    // Now, split sentences and align translations
    let matchingResults = relevantEntries.map(r => {

        // Split both the example sentences and their translations
        const sentences = r.eksempel.split(/(?<=[.!?])\s+/);
        const translations = r.sentenceTranslation ? r.sentenceTranslation.split(/(?<=[.!?])\s+/) : [];

        // Filter sentences that match any of the word variations, and align corresponding translations
        const matchedSentencesAndTranslations = sentences.reduce((acc, sentence, index) => {
            const isMatched = wordVariations.some(variation => {
                if (pos === 'adverb' || pos === 'conjunction' || pos === 'preposition' || pos === 'interjection' || pos === 'numeral') {
                    const regex = new RegExp(`(^|\\s)${variation}($|[\\s.,!?;])`, 'gi');
                    return regex.test(sentence);
                } else {
                    const regexStartOfWord = new RegExp(`(^|[^\\wåæøÅÆØ])${variation}`, 'i');
                    return regexStartOfWord.test(sentence);
                }
            });

            if (isMatched) {
                acc.matchedSentences.push(sentence);
                if (translations[index]) {
                    acc.matchedTranslations.push(translations[index]);
                }
            }

            return acc;
        }, { matchedSentences: [], matchedTranslations: [] });

        // Log the matched sentences and their translations
        console.log(`Matched sentences for '${r.ord}':`, matchedSentencesAndTranslations.matchedSentences);
        console.log(`Matched translations for '${r.ord}':`, matchedSentencesAndTranslations.matchedTranslations);
        
        // Return only the matched sentences and aligned translations, or null if none
        return matchedSentencesAndTranslations.matchedSentences.length > 0 ? { 
            ...r, 
            eksempel: matchedSentencesAndTranslations.matchedSentences.join(' '), 
            sentenceTranslation: matchedSentencesAndTranslations.matchedTranslations.join(' ') 
        } : null;
    }).filter(result => result !== null);

    // Check if there are any matching results
    if (matchingResults.length === 0) {
        console.warn(`No sentences found for the word variations.`);
        sentenceContainer.innerHTML = `
            <div class="definition error-message">
                <h2 class="word-gender">
                    Error <span class="gender">No Sentences Available</span>
                </h2>
                <p>No example sentences available for "${trimmedWord}".</p>
            </div>
        `;
        sentenceContainer.style.display = "block";
        button.innerText = "Show Sentences";
        button.classList.remove('hide');
        button.classList.add('show');
        return;
    }

    // Prioritize the matching results using the prioritizeResults function
    matchingResults = prioritizeResults(matchingResults, trimmedWord, 'eksempel');

    // Apply highlighting for the new word and reset any previous highlighting
    matchingResults.forEach(result => {
        wordVariations.forEach(variation => {
            const highlightedSentence = highlightQuery(result.eksempel, variation);  // Highlight query in sentence
            result.eksempel = highlightedSentence;  // Set the highlighted sentence back
        });
    });

    let backButtonHTML = `function fetchAndRenderSentences(word, pos) {

        <button class="sentence-btn back-btn" onclick="renderWordDefinition('${trimmedWord}')">
            <i class="fas fa-angle-left"></i> Back to Definition
        </button>
    `;

    // Create the sentence content with CEFR labels
    let sentenceContent = matchingResults.slice(0, 10).map(result => {
        // Split example sentences by common sentence delimiters (period, question mark, exclamation mark)
        const sentences = result.eksempel ? result.eksempel.split(/(?<=[.!?])\s+/) : [];
        const translations = result.sentenceTranslation ? result.sentenceTranslation.split(/(?<=[.!?])\s+/) : [];

        // Log the sentenceContent being created
        console.log(`Final Sentences:`, sentences);
        console.log(`Final Translations:`, translations);
        
        // Generate the CEFR label based on the result's CEFR value
        let cefrLabel = '';
        if (result.CEFR === 'A1') {
            cefrLabel = '<div class="sentence-cefr-label easy">A1</div>';
        } else if (result.CEFR === 'A2') {
            cefrLabel = '<div class="sentence-cefr-label easy">A2</div>';
        } else if (result.CEFR === 'B1') {
            cefrLabel = '<div class="sentence-cefr-label medium">B1</div>';
        } else if (result.CEFR === 'B2') {
            cefrLabel = '<div class="sentence-cefr-label medium">B2</div>';
        } else if (result.CEFR === 'C') {
            cefrLabel = '<div class="sentence-cefr-label hard">C</div>';
        }

        // For each sentence, map it to a card
        return sentences.map((sentence, index) => `
            <div class="sentence-container">
                <div class="sentence-box-norwegian">
                    <div class="sentence-content">
                        ${cefrLabel}
                        <p class="sentence">${sentence}</p>
                    </div>
                </div>
                ${translations[index] ? `
                <div class="sentence-box-english">
                    <p class="sentence-translation">${translations[index]}</p>
                </div>` : ''}
            </div>
        `).join('');
    }).join('');



    if (sentenceContent) {
        sentenceContainer.innerHTML = sentenceContent;
        sentenceContainer.style.display = "block";  // Show the container
        button.innerText = "Hide Sentences";
        button.classList.remove('show');
        button.classList.add('hide');
    } else {
        console.warn("No content to show for the word:", trimmedWord);
    }

    sentenceContainer.setAttribute('data-fetched', 'true');
}



// Spinner Control Functions
function showSpinner() {
    document.getElementById('loading-spinner').style.display = 'block';
}

function hideSpinner() {
    document.getElementById('loading-spinner').style.display = 'none';
}

// Prioritize results based on query position or exact match
function prioritizeResults(results, query, key) {
    // Adjust the regex to match the query at the start of a word
    const regexStartOfWord = new RegExp(`\\b${query}`, 'i');  // Match query at word boundary
    const regexExactMatch = new RegExp(`\\b${query}\\b`, 'i'); // Exact match of the whole word

    // Define CEFR level order
    const CEFROrder = ['A1', 'A2', 'B1', 'B2', 'C'];


    return results.sort((a, b) => {
        const aText = a[key].toLowerCase();
        const bText = b[key].toLowerCase();

        // First, prioritize CEFR levels (lower levels come first)
        if (a.CEFR && b.CEFR) {
            // Handle missing CEFR values by assigning a default
            const aCEFR = a.CEFR ? a.CEFR.toUpperCase() : 'C2';
            const bCEFR = b.CEFR ? b.CEFR.toUpperCase() : 'C2';

            const aCEFRIndex = CEFROrder.indexOf(aCEFR);
            const bCEFRIndex = CEFROrder.indexOf(bCEFR);

            if (aCEFRIndex !== bCEFRIndex) {
                return aCEFRIndex - bCEFRIndex;
            }

        }

        // Prioritize exact matches
        const aExactMatch = regexExactMatch.test(aText);
        const bExactMatch = regexExactMatch.test(bText);
        
        if (aExactMatch && !bExactMatch) {
            return -2;
        }
        if (!aExactMatch && bExactMatch) {
            return 2;
        }

        // Check if the query appears at the start of a word
        const aStartsWithWord = regexStartOfWord.test(aText);
        const bStartsWithWord = regexStartOfWord.test(bText);
        
        // Prioritize where the query starts a word
        if (aStartsWithWord && !bStartsWithWord) {
            return -1;
                }
        if (!aStartsWithWord && bStartsWithWord) {
            return 1;
        }

        // Otherwise, sort by the position of the query in the text (earlier is better)
        const aIndex = aText.indexOf(query);
        const bIndex = bText.indexOf(query);

        return aIndex - bIndex;
    });
}

// Update URL based on current search parameters
function updateURL(query, type, selectedPOS) {
    const url = new URL(window.location);

    if (query) {
        url.searchParams.set('query', query);
    } else {
        url.searchParams.delete('query');
    }

    url.searchParams.set('type', type);  // Always set the type in the URL

    if (selectedPOS) {
        url.searchParams.set('pos', selectedPOS);
    } else {
        url.searchParams.delete('pos');
    }

    window.history.pushState({}, '', url);
}

// Load the state from the URL and trigger the appropriate search
function loadStateFromURL() {
    const url = new URL(window.location);
    const query = url.searchParams.get('query') || '';  // Default to an empty query if not present
    const type = url.searchParams.get('type') || 'words';  // Default to 'words' if not specified
    const selectedPOS = url.searchParams.get('pos') || '';  // Default to empty POS if not present

    // Set the search bar and type select based on the URL parameters
    document.getElementById('search-bar').value = query;
    document.getElementById('type-select').value = type;

    // Set the POS select if provided in the URL
    if (selectedPOS) {
        document.getElementById('pos-select').value = selectedPOS;
    }

    // Only call handleTypeChange if the type is not "words"
    if (type !== 'words') {
        handleTypeChange();
    }
    // If there's a query in the URL, trigger a search; otherwise, show the landing page
    if (query) {
        search();  // Perform the search based on the URL state
    } else if (type === 'word-game') {
        // If it's the word game, start it directly (the landing card is already hidden in handleTypeChange)
        startWordGame();
    } else {
        showLandingCard(true);  // Show landing card if no query
    }
}

// Function to handle clicking on a search result card
function handleCardClick(event, word, pos, engelsk) {

    console.log(`Word clicked: ${word}, POS: ${pos}`); // Correct POS logged here

    // Filter results by word, POS (part of speech), and the English translation
    const clickedResult = results.filter(r => {
        const resolvedPOS = (['en', 'et', 'ei', 'en-et', 'en-ei-et'].some(gender => r.gender.toLowerCase().includes(gender))) 
        ? 'noun' 
        : r.gender.toLowerCase().trim();
        // Check if each comparison is true and log it
        const wordMatch = r.ord.toLowerCase().trim() === word.toLowerCase().trim();
        // Directly handle POS logic for nouns and other parts of speech
        const posMatch = resolvedPOS === pos.toLowerCase().trim();
        const engelskMatch = r.engelsk.toLowerCase().trim() === engelsk.toLowerCase().trim();
        return wordMatch && posMatch && engelskMatch;
    });

    if (clickedResult.length === 0) {
        console.error(`No result found for word: "${word}" with POS: "${pos}" and English: "${engelsk}"`);
        return;
    }

    // Clear all other results and keep only the clicked card
    resultsContainer.innerHTML = '';  // Clear the container

    // Display the clicked result
    displaySearchResults(clickedResult);  // This ensures only the clicked card remains

}

// Initialization of the dictionary data and event listeners
window.onload = function() {

    // Check if the buttons exist in the DOM
    const searchBtn = document.getElementById('search-btn');
    const randomBtn = document.getElementById('random-btn');
    const searchBar = document.getElementById('search-bar');
    const clearBtn = document.getElementById('clear-btn');
    const typeSelect = document.getElementById('type-select');
    const posSelect = document.getElementById('pos-select');
    const cefrSelect = document.getElementById('cefr-select');
    const typeFilterContainer = document.querySelector('.type-filter');
    const posFilterContainer = document.querySelector('.pos-filter');
    const cefrFilterContainer = document.querySelector('.cefr-filter');

    if (searchBtn && randomBtn && searchBar && clearBtn && posSelect && cefrSelect) {
        searchBtn.disabled = true;
        randomBtn.disabled = true;
        searchBar.disabled = true;
        clearBtn.disabled = true;
        posSelect.disabled = true;
        cefrSelect.disabled = true;
        typeSelect.disabled = true;

        // Apply the disabled styling
        searchBtn.style.color = '#ccc';
        searchBtn.style.cursor = 'not-allowed';
        randomBtn.style.color = '#ccc';
        randomBtn.style.cursor = 'not-allowed';
        searchBar.style.color = '#ccc';
        searchBar.style.cursor = 'not-allowed';
        clearBtn.style.color = '#ccc';
        clearBtn.style.cursor = 'not-allowed';
        typeFilterContainer.classList.add('disabled');
        posFilterContainer.classList.add('disabled');  // Add the 'disabled' class to visually disable POS filter
        cefrFilterContainer.classList.add('disabled');  // Add the 'disabled' class to visually disable CEFR filter
        } 

    fetchAndLoadDictionaryData();  // Load dictionary data when the page is refreshed

    // Wait for the data to be fetched before triggering the search
    const checkDataLoaded = setInterval(() => {
        if (results.length > 0) {  // Ensure results are loaded
            clearInterval(checkDataLoaded);

            // Enable the buttons once data is fully loaded
            // Enable the buttons and filters once data is fully loaded
            searchBtn.disabled = false;
            randomBtn.disabled = false;
            searchBar.disabled = false;
            clearBtn.disabled = false;
            typeSelect.disabled = false;
            posSelect.disabled = false;
            cefrSelect.disabled = false;

            // Restore original styling
            searchBtn.style.color = '';
            searchBtn.style.cursor = 'pointer';
            randomBtn.style.color = '';
            randomBtn.style.cursor = 'pointer';
            searchBar.style.color = '';
            searchBar.style.cursor = 'text';
            clearBtn.style.color = '';
            clearBtn.style.cursor = 'pointer';
            typeFilterContainer.classList.remove('disabled');  // Remove 'disabled' class for POS filter
            posFilterContainer.classList.remove('disabled');  // Remove 'disabled' class for POS filter
            cefrFilterContainer.classList.remove('disabled');  // Remove 'disabled' class for CEFR filter

            // Load state from URL
            loadStateFromURL();  // This checks the URL for query/type/POS and triggers the appropriate search
        }
    }, 100);

    // Add event listener to POS filter dropdown
    document.getElementById('pos-select').addEventListener('change', handlePOSChange);

    // Add event listener to POS filter dropdown
    document.getElementById('cefr-select').addEventListener('change', handleCEFRChange);

    // Add event listener to the search bar to trigger handleKey on key press
    document.getElementById('search-bar').addEventListener('keyup', handleKey);
};