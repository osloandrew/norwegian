// Global Variables
let results = [];
let debounceTimer;  // Global variable for debouncing

// Debounce function to limit how often search is triggered
function debounce(func, delay) {
    clearTimeout(debounceTimer);  // Clear the previous timer
    debounceTimer = setTimeout(() => {
        func();  // Execute the function after the delay
    }, delay);  // Delay period
}

// Handle the key input, performing a search on 'Enter' or debouncing otherwise
function handleKey(event) {
    // Call search function when 'Enter' is pressed or debounce it otherwise
    debounce(() => {
        if (event.key === 'Enter') {
            search();
        }
    }, 300);  // Delay of 300ms before calling search()
}

// Filter results based on selected part of speech (POS)
function filterResultsByPOS(results, selectedPOS) {
    if (!selectedPOS) return results;
    return results.filter(r => mapKjonnToPOS(r.kjønn) === selectedPOS);
}

// Helper function to format 'kjønn' (grammatical gender) based on its value
function formatKjonn(kjonn) {
    return kjonn && kjonn[0].toLowerCase() === 'e' ? 'substantiv - ' + kjonn : kjonn;
}

// Function to map 'kjønn' to part of speech (POS)
function mapKjonnToPOS(kjonn) {
    if (!kjonn) return '';

    kjønn = kjonn.toLowerCase().trim(); // Ensure lowercase and remove any extra spaces

    // Debugging: Log all the kjønn values
    console.log('Current kjønn value:', kjønn);

    // Check if the kjønn value includes "substantiv" for nouns
    if (kjønn.includes('substantiv')) {
        console.log('Mapped to noun');
        return 'noun';
    }
    // Handle verbs
    if (kjønn.startsWith('verb')) {
        console.log('Mapped to verb');
        return 'verb';
    }
    // Handle adjectives
    if (kjønn.startsWith('adjektiv')) {
        console.log('Mapped to adjective');
        return 'adjective';
    }
        // Handle adverbs
    if (kjønn.startsWith('adverb')) {
        console.log('Mapped to adverb');
        return 'adverb';
    }
    // Handle prepositions
    if (kjønn.startsWith('preposisjon')) {
        console.log('Mapped to preposition');
        return 'preposition';
    }
    // Handle interjections
    if (kjønn.startsWith('interjeksjon')) {
        console.log('Mapped to interjection');
        return 'interjection';
    }
    // Handle conjunctions
    if (kjønn.startsWith('konjunksjon') || kjønn.startsWith('subjunksjon')) {
        console.log('Mapped to conjunction');
        return 'conjunction';
    }
    // Handle pronouns
    if (kjønn.startsWith('pronomen')) {
        console.log('Mapped to pronoun');
        return 'pronoun';
    }
    // Handle articles
    if (kjønn.startsWith('artikkel')) {
        console.log('Mapped to article');
        return 'article';
    }
    // Handle expressions
    if (kjønn.startsWith('fast')) {
        console.log('Mapped to expression');
        return 'expression';
    }

    console.log('Mapped to unknown POS');
    return '';  // Return empty string if no valid part of speech found
}

// Clear the search input field
function clearInput() {
    document.getElementById('search-bar').value = '';
}

// Fetch the dictionary data from the server
async function fetchDictionaryData() {
    // Show the spinner before fetching data
    document.getElementById('loading-spinner').style.display = 'block';

    try {
        const response = await fetch('https://docs.google.com/spreadsheets/d/e/2PACX-1vSl2GxGiiO3qfEuVM6EaAbx_AgvTTKfytLxI1ckFE6c35Dv8cfYdx30vLbPPxadAjeDaSBODkiMMJ8o/pub?output=csv');
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.text();
        parseCSVData(data);
    } catch (error) {
        console.error('Error fetching or parsing data:', error);
    }
}

// Parse the CSV data using PapaParse
function parseCSVData(data) {
    Papa.parse(data, {
        header: true,
        skipEmptyLines: true,
        complete: function (resultsFromParse) {
            results = resultsFromParse.data;
            console.log('Parsed data:', results);  // Log the parsed data
            randomWord();  // Show a random entry after data is loaded
        },
        error: function (error) {
            console.error('Error parsing CSV:', error);
        }
    });
}

// Generate and display a random word or sentence
async function randomWord() {
    clearInput();  // Clear search bar when generating a random word

    if (!results.length) {
        console.warn('No results available to pick a random word.');
        return;
    }

    const type = document.getElementById('type-select').value;
    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';

    // Show the spinner at the start of the random word or sentence generation
    const spinner = document.getElementById('loading-spinner');
    showSpinner();

    let filteredResults;

    if (type === 'sentences') {
        // Filter results that contain example sentences
        filteredResults = results.filter(r => r.eksempel);  // Assuming sentences are stored under the 'eksempel' key
    } else {
        // Filter results by the selected part of speech
        filteredResults = filterResultsByPOS(results, selectedPOS);
    }

    if (!filteredResults.length) {
        console.warn('No random entries available for the selected type.');
        document.getElementById('results-container').innerHTML = `
            <div class="definition error-message">
                <h2 class="word-kjonn">
                    Error <span class="kjønn">Unavailable Entry</span>
                </h2>
                <p>No random entries available. Try selecting another type or part of speech.</p>
            </div>
        `;
        hideSpinner();
        return;
    }

    // Randomly select a result from the filtered results
    const randomResult = filteredResults[Math.floor(Math.random() * filteredResults.length)];

    // If it's a sentence, render it with sentence styling
    if (type === 'sentences') {
        renderSentence(randomResult);
    } else {
        renderResults([randomResult]);  // Pass the result as an array to the render function for words
    }

    hideSpinner();  // Hide the spinner
}

// Perform a search based on the input query and selected POS
async function search() {
    const query = document.getElementById('search-bar').value.toLowerCase().trim();
    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';
    const type = document.getElementById('type-select').value; // Get the search type (words or sentences)

    // Show the spinner at the start of the search
    const spinner = document.getElementById('loading-spinner');
    showSpinner();

    // Update document title with the search term
    document.title = `${query} - Norwegian Dictionary`;

    const resultsContainer = document.getElementById('results-container');
    resultsContainer.innerHTML = ''; // Clear previous results

    // Handle empty search query
    if (!query) {
        resultsContainer.innerHTML = `
            <div class="definition error-message">
                <h2 class="word-kjonn">
                    Error <span class="kjønn">Empty Search</span>
                </h2>
                <p>Please enter a word in the search field before searching.</p>
            </div>
        `;
        hideSpinner();
        return;
    }

    let matchingResults;

    if (type === 'sentences') {
        // If searching sentences, look for matches in the 'eksempel' field
        matchingResults = results.filter(r => r.eksempel && r.eksempel.toLowerCase().includes(query));

        // Prioritize the matching results using the prioritizeResults function
        matchingResults = prioritizeResults(matchingResults, query, 'eksempel');

        // Highlight the query in the sentences
        matchingResults.forEach(result => {
            result.eksempel = highlightQuery(result.eksempel, query);
        });
        
        renderSentences(matchingResults, query); // Pass the query for highlighting
    } else {
        // Filter results by query and selected POS for words
        matchingResults = results.filter(r => {
            const matchesQuery = r.ord.toLowerCase().includes(query) || r.engelsk.toLowerCase().includes(query);
            const mappedPOS = mapKjonnToPOS(r.kjønn);
            return matchesQuery && (!selectedPOS || mappedPOS === selectedPOS);
        });

        // Prioritization logic for words (preserving the exact behavior)
        matchingResults = matchingResults.sort((a, b) => {
            const queryLower = query.toLowerCase();

            // Exact match in the Norwegian term
            const isExactMatchA = a.ord.toLowerCase() === queryLower;
            const isExactMatchB = b.ord.toLowerCase() === queryLower;
            if (isExactMatchA && !isExactMatchB) return -1;
            if (!isExactMatchA && isExactMatchB) return 1;

            // Exact match in comma-separated list of English definitions
            const aIsInCommaList = a.engelsk.toLowerCase().split(',').map(str => str.trim()).includes(queryLower);
            const bIsInCommaList = b.engelsk.toLowerCase().split(',').map(str => str.trim()).includes(queryLower);
            if (aIsInCommaList && !bIsInCommaList) return -1;
            if (!aIsInCommaList && bIsInCommaList) return 1;

            // Deprioritize compound words where the query appears in a larger word
            const aContainsInWord = a.ord.toLowerCase().includes(queryLower) && a.ord.toLowerCase() !== queryLower;
            const bContainsInWord = b.ord.toLowerCase().includes(queryLower) && b.ord.toLowerCase() !== queryLower;
            if (aContainsInWord && !bContainsInWord) return 1;
            if (!aContainsInWord && bContainsInWord) return -1;

            // Sort by position of query in the word (earlier is better)
            const aIndex = a.ord.toLowerCase().indexOf(queryLower);
            const bIndex = b.ord.toLowerCase().indexOf(queryLower);
            return aIndex - bIndex;
        });

        renderResults(matchingResults); // Render word-specific results
    }

    hideSpinner(); // Hide the spinner
}

// Check if any sentences exist for a word
function checkForSentences(word) {
    const lowerCaseWord = word.trim().toLowerCase();
    
    // Check if any sentences in the data include this word or its variations in the 'eksempel' field
    const sentenceFound = results.some(result => 
        result.eksempel && (
            result.eksempel.toLowerCase().includes(lowerCaseWord) ||  // Direct match in sentence
            result.ord.toLowerCase().includes(lowerCaseWord)  // Match on base word
        )
    );

    return sentenceFound;
}

// Handle change in part of speech (POS) filter
function handlePOSChange() {
    const query = document.getElementById('search-bar').value.toLowerCase().trim();
    
    // If the search field is empty, generate a random word based on the POS
    if (!query) {
        console.log('Search field is empty. Generating random word based on selected POS.');
        randomWord();
    } else {
        search(); // If there is a query, perform the search with the selected POS
    }
}

// Handle change in search type (words/sentences)
function handleTypeChange() {
    const type = document.getElementById('type-select').value;
    const posSelect = document.getElementById('pos-select');
    const posFilterContainer = document.querySelector('.pos-filter');  // Parent container

    console.log(`Search type changed to: ${type}`);

    if (type === 'sentences') {
        // Disable the POS dropdown and gray it out
        posSelect.disabled = true;
        posSelect.value = '';  // Reset to "Part of Speech" option
        posFilterContainer.classList.add('disabled');  // Add the 'disabled' class

        // Immediately generate a random sentence
        randomWord();  // This ensures that a random sentence is generated when "sentences" is selected
    } else {
        // Enable the POS dropdown and restore color
        posSelect.disabled = false;
        posFilterContainer.classList.remove('disabled');  // Remove the 'disabled' class

        // Optionally, generate a random word if needed when switching back to words
        randomWord();  // You can call randomWord here as well, depending on your desired behavior
    }
}

// Render a list of results (words)
function renderResults(results) {
    let htmlString = '';
    results.forEach(result => {
        result.kjønn = formatKjonn(result.kjønn);
        
        // Check if sentences are available using enhanced checkForSentences
        const hasSentences = checkForSentences(result.ord);

        htmlString += `
            <div class="definition">
                <h2 class="word-kjonn">
                    ${result.ord}
                    ${result.kjønn ? `<span class="kjønn">${result.kjønn}</span>` : ''}
                </h2>
                ${result.definisjon ? `<p>${result.definisjon}</p>` : ''}
                <div class="definition-content">
                    ${result.engelsk ? `<p class="english"><i class="fas fa-language"></i> ${result.engelsk}</p>` : ''}
                    ${result.uttale ? `<p class="pronunciation"><i class="fas fa-volume-up"></i> ${result.uttale}</p>` : ''}
                    ${result.etymologi ? `<p class="etymology"><i class="fa-solid fa-flag"></i> ${result.etymologi}</p>` : ''}
                </div>
                ${result.eksempel ? `<p class="example">${result.eksempel}</p>` : ''}
                <!-- Show "Show Sentences" button only if sentences exist -->
                ${hasSentences ? `<button class="sentence-btn" onclick="fetchAndRenderSentences('${result.ord}')">Show Sentences</button>` : ''}
            </div>
        `;
    });
    document.getElementById('results-container').innerHTML = htmlString;
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

// Render multiple sentences based on a word or query
function renderSentences(sentenceResults, word) {
    const query = word.trim().toLowerCase(); // Trim and lower-case the search term for consistency

    let exactMatches = [];
    let partialMatches = [];
    let uniqueSentences = new Set(); // Track unique sentences

    const regexExactMatch = new RegExp(`\\b${query}\\b`, 'i');

    sentenceResults.forEach(result => {
        // Split example sentences by common sentence delimiters (period, question mark, exclamation mark)
        const sentences = result.eksempel.match(/[^.!?]+[.!?]*/g) || [result.eksempel];

        sentences.forEach(sentence => {
            const trimmedSentence = sentence.trim();
            if (!uniqueSentences.has(trimmedSentence)) {
                // Only add unique sentences
                uniqueSentences.add(trimmedSentence);

                // Exact match (whole word match)
                if (regexExactMatch.test(sentence.toLowerCase())) {
                    exactMatches.push(highlightQuery(sentence, query));
                } else if (sentence.toLowerCase().includes(query)) {
                    partialMatches.push(highlightQuery(sentence, query));
                }
            }
        });
    });

    // Combine exact matches first, then partial matches
    const combinedMatches = [...exactMatches, ...partialMatches].slice(0, 20);

    // Generate HTML for the combined matches
    let htmlString = '';
    combinedMatches.forEach(sentence => {
        htmlString += `
            <div class="definition">
                <p class="sentence">${sentence}</p>
            </div>
        `;
    });

    // If no matches were found, display a "No Results" message
    if (!htmlString) {
        htmlString = `
            <div class="definition error-message">
                <h2 class="word-kjonn">
                    Error <span class="kjønn">No Matching Sentences</span>
                </h2>
                <p>No sentences found containing "${query}".</p>
            </div>
        `;
    }

    // Insert the generated HTML into the results container
    document.getElementById('results-container').innerHTML = htmlString;

    console.log("Exact matches:", exactMatches);
    console.log("Partial matches:", partialMatches);
}

// Highlight search query in text
function highlightQuery(sentence, query) {
    // Use a regex to find the entire word containing the query and highlight it
    const regex = new RegExp(`(\\b\\w*${query}\\w*\\b)`, 'gi');
    return sentence.replace(regex, '<span style="color: #3c88d4;">$1</span>');
}

function renderSentencesHTML(sentenceResults, word) {
    const query = word.toLowerCase(); // Use the word passed from the button click

    let htmlString = '';
    let exactMatches = [];
    let inexactMatches = [];
    let uniqueSentences = new Set(); // Track unique sentences

    sentenceResults.forEach(result => {
        // Split the example sentence into individual sentences, handling sentence delimiters correctly
        const sentences = result.eksempel.match(/[^.!?]+[.!?]*/g) || [result.eksempel];

        // Loop through each sentence and categorize as exact or inexact match
        sentences.forEach(sentence => {
            const trimmedSentence = sentence.trim();
            if (!uniqueSentences.has(trimmedSentence)) {
                // Only add unique sentences
                uniqueSentences.add(trimmedSentence);

                if (sentence.toLowerCase().includes(query)) {
                    // Use a regular expression to match the full word containing the search term
                    const regex = new RegExp(`(\\b\\w*${query}\\w*\\b)`, 'gi');
                    const highlightedSentence = sentence.replace(regex, '<span style="color: #3c88d4;">$1</span>');

                    // Determine if it's an exact match (contains the exact search term as a full word)
                    if (new RegExp(`\\b${query}\\b`, 'i').test(sentence)) {
                        exactMatches.push(highlightedSentence);  // Exact match
                    } else {
                        inexactMatches.push(highlightedSentence);  // Inexact match
                    }
                }
            }
        });
    });

    // Combine exact matches first, then inexact matches, respecting the 20 sentence limit
    const combinedMatches = [...exactMatches, ...inexactMatches].slice(0, 20);

    // Generate HTML for the combined matches
    combinedMatches.forEach(sentence => {
        htmlString += `
            <div class="definition">
                <p class="sentence">${sentence}</p>
            </div>
        `;
    });

    return htmlString;
}

function renderWordDefinition(word) {
    const trimmedWord = word.trim().toLowerCase();

    console.log(`Rendering word definition for: "${trimmedWord}"`);

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
        renderResults(matchingResults);
    } else {
        document.getElementById('results-container').innerHTML = `
            <div class="definition error-message">
                <h2 class="word-kjonn">
                    Error <span class="kjønn">No Definition Found</span>
                </h2>
                <p>No definition found for "${trimmedWord}".</p>
            </div>
        `;
    }
}

// Fetch and render sentences for a word
function fetchAndRenderSentences(word) {
    const trimmedWord = word.trim().toLowerCase();

    console.log(`Fetching and rendering sentences for word/phrase: "${trimmedWord}"`);

    // Filter results to find sentences that contain the word or phrase directly in the 'eksempel' field
    let matchingResults = results.filter(r =>
        r.eksempel && (r.eksempel.toLowerCase().includes(trimmedWord))
    );

    // Prioritize the matching results using the prioritizeResults function
    matchingResults = prioritizeResults(matchingResults, trimmedWord, 'eksempel');

    // Highlight the query in the sentences
    matchingResults.forEach(result => {
        result.eksempel = highlightQuery(result.eksempel, trimmedWord);
    });

    // Set the type selector to "sentences"
    const typeSelect = document.getElementById('type-select');
    typeSelect.value = 'sentences';  // Set the type select to "sentences"

    // Disable the POS filter
    const posSelect = document.getElementById('pos-select');
    posSelect.disabled = true;
    const posFilterContainer = document.querySelector('.pos-filter');
    posFilterContainer.classList.add('disabled');  // Add the 'disabled' class for visual effect

    let backButtonHTML = `
        <button class="sentence-btn back-btn" onclick="renderWordDefinition('${trimmedWord}')">
            <i class="fas fa-angle-left"></i> Back to Definition
        </button>
    `;

    let sentenceContent = '';
    if (matchingResults.length > 0) {
        sentenceContent = renderSentencesHTML(matchingResults, trimmedWord);
    } else {
        sentenceContent = `
            <div class="definition error-message">
                <h2 class="word-kjonn">
                    Error <span class="kjønn">No Sentences Available</span>
                </h2>
                <p>No example sentences available for "${trimmedWord}".</p>
            </div>
        `;
    }

    document.getElementById('results-container').innerHTML = sentenceContent + backButtonHTML;
    console.log(`Matching Results for "${trimmedWord}":`, matchingResults);
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

    return results.sort((a, b) => {
        const aText = a[key].toLowerCase();
        const bText = b[key].toLowerCase();

        // Check if the query appears at the start of a word
        const aStartsWithWord = regexStartOfWord.test(aText);
        const bStartsWithWord = regexStartOfWord.test(bText);

        // Log the matches for each result
        console.log('Comparing:', {aText, bText});
        console.log('Starts with Word:', {aStartsWithWord, bStartsWithWord});

        // First, prioritize where the query starts a word
        if (aStartsWithWord && !bStartsWithWord) {
            console.log('Prioritize a: Starts with query');
            return -1;
        }
        if (!aStartsWithWord && bStartsWithWord) {
            console.log('Prioritize b: Starts with query');
            return 1;
        }

        // Then, prioritize exact matches
        const aExactMatch = regexExactMatch.test(aText);
        const bExactMatch = regexExactMatch.test(bText);
        
        if (aExactMatch && !bExactMatch) {
            console.log('Prioritize a: Exact match');
            return -1;
        }
        if (!aExactMatch && bExactMatch) {
            console.log('Prioritize b: Exact match');
            return 1;
        }

        // Otherwise, sort by the position of the query in the text (earlier is better)
        const aIndex = aText.indexOf(query);
        const bIndex = bText.indexOf(query);

        console.log('Query Position in a:', aIndex);
        console.log('Query Position in b:', bIndex);

        return aIndex - bIndex;
    });
}

// Initialization of the dictionary data and event listeners
window.onload = function() {
    fetchDictionaryData();  // Load dictionary data when the page is refreshed

    // Wait for the data to be fetched before triggering the search
    const checkDataLoaded = setInterval(() => {
        if (results.length > 0) {
            clearInterval(checkDataLoaded);

            // Check if the URL contains a hash like #search/word
            const hash = window.location.hash;
            const searchPrefix = '#search/';

            if (hash.startsWith(searchPrefix)) {
                const searchTerm = decodeURIComponent(hash.substring(searchPrefix.length)); // Extract the word after #search/
                if (searchTerm) {
                    document.getElementById('search-bar').value = searchTerm;
                    search();  // Automatically perform the search with the extracted word
                    
                    // Update the page title with the search term
                    document.title = `${searchTerm} - Norwegian Dictionary`;

                    // Trigger a virtual pageview in Google Analytics
                    gtag('config', 'G-M5H81RF3DT', {
                        'page_path': location.pathname + location.hash
                    });
                }
            }
        }
    }, 100);

    // Add event listener to POS filter dropdown
    document.getElementById('pos-select').addEventListener('change', handlePOSChange);

    // Add event listener to the search bar to trigger handleKey on key press
    document.getElementById('search-bar').addEventListener('keyup', handleKey);

};
