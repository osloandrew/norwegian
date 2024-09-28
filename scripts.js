let results = [];

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

function handleKey(event) {
    if (event.key === 'Enter') search();
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

function randomWord() {
    // Clear the search bar when the random button is clicked
    clearInput();

    if (!results.length) {
        console.warn('No results available to pick a random word.');
        return;
    }

    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';

    let filteredResults = results;

    // If a part of speech is selected, filter the results by that POS
    if (selectedPOS) {
        filteredResults = results.filter(r => mapKjonnToPOS(r.kjønn) === selectedPOS);
    }

    if (!filteredResults.length) {
        console.warn('No results available for the selected part of speech.');
        document.getElementById('results-container').innerHTML = `
            <div class="definition">
                <p>No random words available for the selected part of speech. Try selecting another.</p>
            </div>
        `;
        return;
    }

    const randomResult = filteredResults[Math.floor(Math.random() * filteredResults.length)];
    randomResult.kjønn = formatKjonn(randomResult.kjønn);

    document.getElementById('results-container').innerHTML = `
    <div class="definition">
        <h2 class="word-kjonn">
            ${randomResult.ord}
            ${randomResult.kjønn ? `<span class="kjønn">${randomResult.kjønn}</span>` : ''}
        </h2>
        ${randomResult.definisjon ? `<p>${randomResult.definisjon}</p>` : ''}
        <div class="definition-content">
            ${randomResult.engelsk ? `<p class="english"><span class="definition-label">English:</span> ${randomResult.engelsk}</p>` : ''}
            ${randomResult.uttale ? `<p class="pronunciation"><span class="definition-label">Pronunciation:</span> ${randomResult.uttale}</p>` : ''}
            ${randomResult.etymologi ? `<p class="etymology"><span class="definition-label">Etymology:</span> ${randomResult.etymologi}</p>` : ''}
        </div>
        ${randomResult.eksempel ? `<p class="example">${randomResult.eksempel}</p>` : ''}
    </div>
    `;
}



function search() {
    const query = document.getElementById('search-bar').value.toLowerCase().trim();
    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';

    console.log('Search query:', query, 'Selected POS:', selectedPOS);

    const resultsContainer = document.getElementById('results-container');
    resultsContainer.innerHTML = '';

    // If the search bar is empty, do nothing
    if (!query) {
        console.log('Search field is empty. Doing nothing.');
        return;
    }

    const matchingResults = results.filter(r => {
        const matchesQuery = r.ord.toLowerCase().includes(query) || r.engelsk.toLowerCase().includes(query);
        const mappedPOS = mapKjonnToPOS(r.kjønn);

        const matchesPOS = !selectedPOS || mappedPOS === selectedPOS; // Exact match for POS
        console.log('Mapped POS:', mappedPOS, 'Matches POS:', matchesPOS, 'for word:', r.ord);

        return matchesQuery && matchesPOS;
    });

    console.log('Filtered results:', matchingResults); // Log filtered results

    const sortedResults = matchingResults.sort((a, b) => {
        const isExactMatchA = a.ord.toLowerCase() === query || a.engelsk.toLowerCase() === query;
        const isExactMatchB = b.ord.toLowerCase() === query || b.engelsk.toLowerCase() === query;
        return isExactMatchA ? -1 : isExactMatchB ? 1 : 0;
    });

    if (sortedResults.length) {
        resultsContainer.innerHTML = sortedResults.map(result => {
            result.kjønn = formatKjonn(result.kjønn);
            return `
                <div class="definition">
                    <h2 class="word-kjonn">
                        ${result.ord}
                        ${result.kjønn ? `<span class="kjønn">${result.kjønn}</span>` : ''}
                    </h2>
                    ${result.definisjon ? `<p>${result.definisjon}</p>` : ''}
                    <div class="definition-content">
                        ${result.engelsk ? `<p class="english"><span class="definition-label">English:</span> ${result.engelsk}</p>` : ''}
                        ${result.uttale ? `<p class="pronunciation"><span class="definition-label">Pronunciation:</span> ${result.uttale}</p>` : ''}
                        ${result.etymologi ? `<p class="etymology"><span class="definition-label">Etymology:</span> ${result.etymologi}</p>` : ''}
                    </div>
                    ${result.eksempel ? `<p class="example">${result.eksempel}</p>` : ''}
                </div>
            `;
        }).join('');
    } else {
        let noResultsMessage = `No results found for "${query}"`;
        if (selectedPOS) {
            noResultsMessage += ` with part of speech "${selectedPOS}".`;
        } else {
            noResultsMessage += `.`;
        }
        noResultsMessage += ` Try searching for another word or use the Random Word feature.`;

        console.log('No results found for:', query, 'with POS:', selectedPOS);
        resultsContainer.innerHTML = `
            <div class="definition">
                <p>${noResultsMessage}</p>
            </div>
        `;
    }
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

window.onload = function() {
    fetchDictionaryData();  // Load dictionary data when the page is refreshed

    const searchTerm = window.location.hash.substring(1) || new URLSearchParams(window.location.search).get('q');
    if (searchTerm) {
        document.getElementById('search-bar').value = decodeURIComponent(searchTerm);
        search();  // Automatically perform the search if there's a search term in the URL
    }

    // Add event listener to POS filter dropdown
    document.getElementById('pos-select').addEventListener('change', handlePOSChange);
};

