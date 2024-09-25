let results = [];

// Helper function to prepend "substantiv -" to 'kjønn' starting with 'e'
function formatKjonn(kjonn) {
    return kjonn && kjonn[0].toLowerCase() === 'e' ? 'substantiv - ' + kjonn : kjonn;
}

function clearInput() {
    document.getElementById('search-bar').value = '';
}

function debounceSearch(func, delay) {
    let debounceTimeout;
    return function (...args) {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => func.apply(this, args), delay);
    };
}

async function fetchDictionaryData() {
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
            randomWord();  // Show a random entry after data is loaded
        },
        error: function (error) {
            console.error('Error parsing CSV:', error);
        }
    });
}

function randomWord() {
    if (!results.length) {
        console.warn('No results available to pick a random word.');
        return;
    }

    const randomResult = results[Math.floor(Math.random() * results.length)];
    randomResult.kjønn = formatKjonn(randomResult.kjønn);

    document.getElementById('results-container').innerHTML = `
        <div class="definition">
            <h2>${randomResult.ord}</h2>
            ${randomResult.kjønn ? `<p class="kjønn">${randomResult.kjønn}</p>` : ''}
            ${randomResult.engelsk ? `<p><span class="definition-label">English:</span> ${randomResult.engelsk}</p>` : ''}
            ${randomResult.uttale ? `<p><span class="definition-label">Pronunciation:</span> ${randomResult.uttale}</p>` : ''}
            ${randomResult.etymologi ? `<p><span class="definition-label">Etymology:</span> ${randomResult.etymologi}</p>` : ''}
            ${randomResult.definisjon ? `<p><span class="definition-label">Definition:</span> ${randomResult.definisjon}</p>` : ''}
            ${randomResult.eksempel ? `<p class="example">${randomResult.eksempel}</p>` : ''}
        </div>
    `;
}

function search() {
    const query = document.getElementById('search-bar').value.toLowerCase();
    if (!query) {
        alert('Please enter a word to search');
        return;
    }

    const resultsContainer = document.getElementById('results-container');
    resultsContainer.innerHTML = '';

    const matchingResults = results.filter(r => {
        return r.ord.toLowerCase().includes(query) || r.engelsk.toLowerCase().includes(query);
    });

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
                    <h2>${result.ord}</h2>
                    ${result.kjønn ? `<p class="kjønn">${result.kjønn}</p>` : ''}
                    ${result.engelsk ? `<p><span class="definition-label">English:</span> ${result.engelsk}</p>` : ''}
                    ${result.uttale ? `<p><span class="definition-label">Pronunciation:</span> ${result.uttale}</p>` : ''}
                    ${result.etymologi ? `<p><span class="definition-label">Etymology:</span> ${result.etymologi}</p>` : ''}
                    ${result.definisjon ? `<p><span class="definition-label">Definition:</span> ${result.definisjon}</p>` : ''}
                    ${result.eksempel ? `<p class="example">${result.eksempel}</p>` : ''}
                </div>
            `;
        }).join('');
    } else {
        resultsContainer.innerHTML = `
            <div class="definition">
                <p>No results found for "${query}". Try searching for another word or use the Random Word feature.</p>
            </div>
        `;
    }
}

window.onload = function() {
    fetchDictionaryData();  // Load dictionary data when the page is refreshed

    const searchTerm = window.location.hash.substring(1) || new URLSearchParams(window.location.search).get('q');
    if (searchTerm) {
        document.getElementById('search-bar').value = decodeURIComponent(searchTerm);
        search();  // Automatically perform the search if there's a search term in the URL
    }
};
