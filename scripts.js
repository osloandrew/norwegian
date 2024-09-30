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

function handleKey(event) {
    // Call search function when 'Enter' is pressed or debounce it otherwise
    debounce(() => {
        if (event.key === 'Enter') {
            search();
        }
    }, 300);  // Delay of 300ms before calling search()
}

function filterResultsByPOS(results, selectedPOS) {
    if (!selectedPOS) return results;
    return results.filter(r => mapKjonnToPOS(r.kjønn) === selectedPOS);
}

// Helper function to prepend "substantiv -" to 'kjønn' starting with 'e'
function formatKjonn(kjonn) {
    return kjonn && kjonn[0].toLowerCase() === 'e' ? 'substantiv - ' + kjonn : kjonn;
}

// Function to map kjønn to part of speech
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

function clearInput() {
    document.getElementById('search-bar').value = '';
}

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

async function randomWord() {
    clearInput();  // Clear search bar when generating a random word

    if (!results.length) {
        console.warn('No results available to pick a random word.');
        return;
    }

    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';

    // Show the spinner at the start of the random word generation
    const spinner = document.getElementById('loading-spinner');
    showSpinner()

    // Filter results by the selected part of speech
    const filteredResults = filterResultsByPOS(results, selectedPOS);

    if (!filteredResults.length) {
        console.warn('No random words available for the selected part of speech.');
        document.getElementById('results-container').innerHTML = `
            <div class="definition error-message">
                <h2 class="word-kjonn">
                    Error <span class="kjønn">Unavailable Word</span>
                </h2>
                <p>No random words available for the selected part of speech. Try selecting another.</p>
            </div>
        `;
        hideSpinner()
        return;
    }

    // Randomly select a result from the filtered results
    const randomResult = filteredResults[Math.floor(Math.random() * filteredResults.length)];

    // Render the result
    renderResults([randomResult]);  // Pass the result as an array to the render function

    hideSpinner()  // Hide the spinner
}

async function search() {
    const query = document.getElementById('search-bar').value.toLowerCase().trim();
    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';

    // Show the spinner at the start of the search
    const spinner = document.getElementById('loading-spinner');
    showSpinner()

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
        hideSpinner()
        return;
    }

    // Filter results by query and selected POS
    const matchingResults = results.filter(r => {
        const matchesQuery = r.ord.toLowerCase().includes(query) || r.engelsk.toLowerCase().includes(query);
        const mappedPOS = mapKjonnToPOS(r.kjønn);
        return matchesQuery && (!selectedPOS || mappedPOS === selectedPOS);
    });

    // Prioritization logic
    const sortedResults = matchingResults.sort((a, b) => {
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

    const limitedResults = sortedResults.slice(0, 20); // Limit to 20 results

    if (limitedResults.length) {
        renderResults(limitedResults); // Use the helper function to render the results
    } else {
        resultsContainer.innerHTML = `
            <div class="definition error-message">
                <h2 class="word-kjonn">
                    Error <span class="kjønn">No Results</span>
                </h2>
                <p>No results found for "${query}".</p>
            </div>
        `;
    }

    hideSpinner() // Hide the spinner
}

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

// Rendering Functions
function renderResults(results) {
    let htmlString = '';
    results.forEach(result => {
        result.kjønn = formatKjonn(result.kjønn);
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
            </div>
        `;
    });
    document.getElementById('results-container').innerHTML = htmlString;
}

// Spinner Control Functions
function showSpinner() {
    document.getElementById('loading-spinner').style.display = 'block';
}

function hideSpinner() {
    document.getElementById('loading-spinner').style.display = 'none';
}

// Initialization
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
