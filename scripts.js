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
            
            // Check if a query exists in the URL
            const url = new URL(window.location);
            const query = url.searchParams.get('query');

            if (!query) {
                randomWord();  // Only show a random entry if no query is present
            }
        },
        error: function (error) {
            console.error('Error parsing CSV:', error);
        }
    });
}


// Generate and display a random word or sentence
async function randomWord() {
    clearInput();  // Clear search bar when generating a random word or sentence

    const type = document.getElementById('type-select').value;
    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';

    // Do not pass 'random' as the query, instead just update the URL to indicate it's a random query
    updateURL('', type, selectedPOS);  // Pass an empty string for the query part to avoid "random" in the URL

    if (!results.length) {
        console.warn('No results available to pick a random word or sentence.');
        return;
    }

    // Show the spinner at the start of the random word or sentence generation
    const spinner = document.getElementById('loading-spinner');
    showSpinner();

    let filteredResults;

    if (type === 'sentences') {
        // Filter results that contain example sentences (for the 'sentences' type)
        filteredResults = results.filter(r => r.eksempel);  // Assuming sentences are stored under the 'eksempel' key
    } else {
        // Filter results by the selected part of speech (for 'words' type)
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

    if (type === 'sentences') {
        // If it's a sentence, render it as a sentence
        renderSentence(randomResult);
    } else {
        // If it's a word, render it with highlighting (if needed)
        renderResults([randomResult], randomResult.ord);
    }

    hideSpinner();  // Hide the spinner
}


// Perform a search based on the input query and selected POS
async function search() {
    const query = document.getElementById('search-bar').value.toLowerCase().trim();
    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';
    const type = document.getElementById('type-select').value; // Get the search type (words or sentences)

    // Clear any previous highlights by resetting the `query`
    let cleanResults = results.map(result => {
        result.eksempel = result.eksempel.replace(/<span[^>]*>(.*?)<\/span>/gi, '$1'); // Remove previous highlights
        return result;
    });

    // Update the URL with the search parameters
    updateURL(query, type, selectedPOS);  // <--- Trigger URL update

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

          // If no matching results, display an error message
          if (matchingResults.length === 0) {
            resultsContainer.innerHTML = `
                <div class="definition error-message">
                    <h2 class="word-kjonn">
                        Error <span class="kjønn">No Results Found</span>
                    </h2>
                    <p>No words found matching "${query}". Please try another word.</p>
                                <button class="sentence-btn back-btn">
                <i class="fas fa-flag"></i> Flag Missing Word Entry (Currently Disabled)</button>
                </div>
            `;
            hideSpinner();
            return;
        }


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
    const selectedPOS = document.getElementById('pos-select').value.toLowerCase(); // Fetch POS

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

// Handle change in search type (words/sentences)
function handleTypeChange() {
    const type = document.getElementById('type-select').value;
    const query = document.getElementById('search-bar').value.toLowerCase().trim();
    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';

    // Update the URL with the type, query, and selected POS
    updateURL(query, type, selectedPOS);  // <--- Trigger URL update based on type change

    const posSelect = document.getElementById('pos-select');
    const posFilterContainer = document.querySelector('.pos-filter');

    if (type === 'sentences') {
        // Disable the POS dropdown and gray it out
        posSelect.disabled = true;
        posSelect.value = '';  // Reset to "Part of Speech" option
        posFilterContainer.classList.add('disabled');  // Add the 'disabled' class

        // If the search bar is not empty, perform a sentence search
        if (query) {
            console.log('Searching for sentences with query:', query);
            search();  // This will trigger a search for sentences based on the search bar query
        } else {
            console.log('Search bar empty, generating a random sentence.');
            randomWord();  // Generate a random sentence if the search bar is empty
        }
    } else {
        // Enable the POS dropdown and restore color
        posSelect.disabled = false;
        posFilterContainer.classList.remove('disabled');  // Remove the 'disabled' class

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

// Render a list of results (words)
function renderResults(results, query = '') {
    const resultsContainer = document.getElementById('results-container');
    resultsContainer.innerHTML = '';  // Clear previous results

    query = query.toLowerCase().trim();  // Ensure the query is lowercased and trimmed

    let htmlString = '';
    results.forEach(result => {
        result.kjønn = formatKjonn(result.kjønn);

        // Check if sentences are available using enhanced checkForSentences
        const hasSentences = checkForSentences(result.ord);

        // Highlight the word being defined (result.ord) in the example sentence
        const highlightedExample = result.eksempel ? highlightQuery(result.eksempel, result.ord.toLowerCase()) : '';


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
                ${highlightedExample ? `<p class="example">${highlightedExample}</p>` : ''}
                <!-- Show "Show Sentences" button only if sentences exist -->
                ${hasSentences ? `<button class="sentence-btn" data-word="${result.ord}" onclick="fetchAndRenderSentences('${result.ord}')">Show Sentences</button>` : ''}
            </div>
            <!-- Sentences container is now outside the definition block -->
            <div class="sentences-container" id="sentences-container-${result.ord}"></div>
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
    const resultsContainer = document.getElementById('results-container');
    resultsContainer.innerHTML = ''; // Clear previous results

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


// Highlight search query in text, accounting for Norwegian characters (å, æ, ø)
function highlightQuery(sentence, query) {
    // Check if the sentence is already highlighted to avoid double highlighting
    if (sentence.includes('<span style="color: #3c88d4;">')) {
        return sentence;  // Already highlighted, return the sentence as is
    }

    // First, remove any existing highlights by replacing the <span> tags to avoid persistent old highlights
    const cleanSentence = sentence.replace(/<span style="color: #3c88d4;">(.*?)<\/span>/gi, '$1');

    // Adjust the regex to highlight entire words that contain the query, including Norwegian characters
    // \w is replaced with [\\wåæøÅÆØ] to include Norwegian letters
    const regex = new RegExp(`([\\wåæøÅÆØ]*${query}[\\wåæøÅÆØ]*)`, 'gi');

    // Return the cleaned sentence with the new query highlighted
    return cleanSentence.replace(regex, '<span style="color: #3c88d4;">$1</span>');
} 


function renderSentencesHTML(sentenceResults, word) {
    const wordVariations = word.toLowerCase().split(',').map(w => w.trim()); // Split by commas and trim
    let htmlString = '';
    let exactMatches = [];
    let inexactMatches = [];
    let uniqueSentences = new Set(); // Track unique sentences

    sentenceResults.forEach(result => {
        // Split the example sentence into individual sentences, handling sentence delimiters correctly
        const sentences = result.eksempel.match(/[^.!?]+[.!?]*/g) || [result.eksempel];

        sentences.forEach(sentence => {
            const trimmedSentence = sentence.trim();
            if (!uniqueSentences.has(trimmedSentence)) {
                // Only add unique sentences
                uniqueSentences.add(trimmedSentence);

                // Check if sentence contains any of the word variations
                let matchedVariation = wordVariations.find(variation => sentence.toLowerCase().includes(variation));

                if (matchedVariation) {
                    // Use a regular expression to match the full word containing any of the variations
                    const regex = new RegExp(`(\\b\\w*${matchedVariation}\\w*\\b)`, 'gi');
                    const highlightedSentence = sentence.replace(regex, '<span style="color: #3c88d4;">$1</span>');

                    // Determine if it's an exact match (contains the exact search term as a full word)
                    const exactMatchRegex = new RegExp(`\\b${matchedVariation}\\b`, 'i');
                    if (exactMatchRegex.test(sentence)) {
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

    console.log("Generated Sentence HTML:", htmlString); // Log the HTML being generated for the sentences
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

// Fetch and render sentences for a word or phrase, including handling comma-separated variations
function fetchAndRenderSentences(word) {
    const trimmedWord = word.trim().toLowerCase();
    const button = document.querySelector(`button[data-word='${word}']`);

    // If the sentences are already visible, toggle them off
    const sentenceContainer = document.getElementById(`sentences-container-${trimmedWord}`);
    sentenceContainer.innerHTML = '';  // Clear previous sentences

    if (sentenceContainer.style.display === "block") {
        sentenceContainer.style.display = "none";
        button.innerText = "Show Sentences";
        return;
    }
    
    console.log(`Fetching and rendering sentences for word/phrase: "${trimmedWord}"`);

    // Split the word by commas to handle multiple word variations (e.g., "fremtid, framtid")
    const wordVariations = trimmedWord.split(',').map(w => w.trim());

    // Filter results to find sentences that contain any of the word variations in the 'eksempel' field
    let matchingResults = results.filter(r => 
        r.eksempel && wordVariations.some(variation => r.eksempel.toLowerCase().includes(variation))
    );

    // Check if there are any matching results
    if (!matchingResults.length) {
        console.warn(`No sentences found for: "${trimmedWord}"`);
    }

    // Prioritize the matching results using the prioritizeResults function
    matchingResults = prioritizeResults(matchingResults, trimmedWord, 'eksempel');

    // Highlight the query in the sentences (handling multiple word variations)
    matchingResults.forEach(result => {
        wordVariations.forEach(variation => {
            result.eksempel = highlightQuery(result.eksempel, variation);
        });
    });

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

    // Append the sentences below the word definition, without replacing the definition
    sentenceContainer.innerHTML = sentenceContent;  
    sentenceContainer.style.display = "block";  // Show sentences
    button.innerText = "Hide Sentences";  // Change button to hide sentences

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

// Update URL based on current search parameters
function updateURL(query, type, selectedPOS) {
    const url = new URL(window.location);
    url.searchParams.set('query', query);
    url.searchParams.set('type', type);
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
    const type = url.searchParams.get('type') || 'words';  // Use the type from the URL or default to 'words'
    const selectedPOS = url.searchParams.get('pos') || '';  // Default to an empty POS if not present

    // Set the correct values in the DOM elements
    document.getElementById('search-bar').value = query;
    document.getElementById('type-select').value = type;  // Respect the type from the URL (sentences or words)
    
    if (selectedPOS) {
        document.getElementById('pos-select').value = selectedPOS;
    }

    // Only trigger a search if there is a query, otherwise show a random word or sentence
    if (query) {
        search();  // Perform the search with the loaded parameters
    } else {
        randomWord();  // If no query, load a random word or sentence
    }
}





// Initialization of the dictionary data and event listeners
window.onload = function() {
    fetchDictionaryData();  // Load dictionary data when the page is refreshed

    // Wait for the data to be fetched before triggering the search
    const checkDataLoaded = setInterval(() => {
        if (results.length > 0) {  // Ensure results are loaded
            clearInterval(checkDataLoaded);
            
            // Load state from URL
            loadStateFromURL();  // This checks the URL for query/type/POS and triggers the appropriate search
        }
    }, 100);

    // Add event listener to POS filter dropdown
    document.getElementById('pos-select').addEventListener('change', handlePOSChange);

    // Add event listener to the search bar to trigger handleKey on key press
    document.getElementById('search-bar').addEventListener('keyup', handleKey);
};
