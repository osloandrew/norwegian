let results = [];

// Clear input field function
function clearInput() {
    document.getElementById('search-bar').value = ''; // Clear the search input field
}

// Debounced search function
function debounceSearch(func, delay) {
    return function() {
        const context = this, args = arguments;
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => func.apply(context, args), delay);
    };
}

// Fetch data from the Google Sheets CSV
async function fetchDictionaryData() {
    try {
        console.log('Fetching data from Google Sheets...');
        const response = await fetch('https://docs.google.com/spreadsheets/d/e/2PACX-1vSl2GxGiiO3qfEuVM6EaAbx_AgvTTKfytLxI1ckFE6c35Dv8cfYdx30vLbPPxadAjeDaSBODkiMMJ8o/pub?output=csv');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.text();
        parseCSVData(data);  // Use PapaParse to handle CSV data
    } catch (error) {
        console.error('Error fetching or parsing data:', error);
    }
}

// Handle Enter key press to trigger search
function handleKey(event) {
    if (event.key === 'Enter') {
        search();
    }
}

// Parse CSV data using PapaParse
function parseCSVData(data) {
    Papa.parse(data, {
        header: true, // Treat the first row as the header
        skipEmptyLines: true, // Skip empty rows
        complete: function(resultsFromParse) {
            results = resultsFromParse.data; // Save parsed data
            console.log('Parsed Results:', results); // Log for debugging
            showFirstResult();  // Show first word when data is loaded
        },
        error: function(error) {
            console.error('Error parsing CSV:', error);
        }
    });
}

// Random word function
function randomWord() {
    if (results.length === 0) {
        console.warn('No results available to pick a random word.');
        return;
    }
    const randomIndex = Math.floor(Math.random() * results.length);
    const randomResult = results[randomIndex];

    const resultsContainer = document.getElementById('results-container');
    resultsContainer.innerHTML = `
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

        // Update the URL to include the random word
        const newUrl = `${window.location.protocol}//${window.location.host}/${randomResult.ord}`;
        history.pushState({ search: randomResult.ord }, '', newUrl);  // Update the URL without reloading the page

    console.log('Displayed random result:', randomResult);
}

// Search function
function search() {
    const query = document.getElementById('search-bar').value.toLowerCase();

    // Check if the search input is empty
    if (query === '') {
        alert('Please enter a word to search');
        return;  // Do not clear the results container or proceed further
    }

    const resultsContainer = document.getElementById('results-container');
    resultsContainer.innerHTML = '';  // Clear the results container only if a valid search is made

    console.log('Searching for:', query);

    // Update the URL with the search query
    const newUrl = `${window.location.protocol}//${window.location.host}/${query}`;
    history.pushState({ search: query }, '', newUrl);  // Update the URL without reloading the page

    // Scroll the user to the top of the page smoothly
    window.scrollTo({
    top: 0,
    behavior: 'smooth'
    });

    // Search by Norwegian word (ord) or English translation (engelsk)
    const matchingResults = results.filter(r => {
        const norwegianWord = r.ord.toLowerCase();
        const englishWord = r.engelsk.toLowerCase();

        // Return only exact or partial matches for Norwegian or English word
        return norwegianWord.includes(query) || englishWord.includes(query);
    });

    // Sort results to prioritize exact matches first
    const sortedResults = matchingResults.sort((a, b) => {
        const norwegianWordA = a.ord.toLowerCase();
        const norwegianWordB = b.ord.toLowerCase();
        const englishWordA = a.engelsk.toLowerCase();
        const englishWordB = b.engelsk.toLowerCase();

        const isExactMatchA = norwegianWordA === query || englishWordA === query;
        const isExactMatchB = norwegianWordB === query || englishWordB === query;

        // If A is an exact match and B is not, A should come first
        if (isExactMatchA && !isExactMatchB) return -1;
        if (!isExactMatchA && isExactMatchB) return 1;

        // If both are exact matches or neither is, keep the default order
        return 0;
    });

    if (sortedResults.length > 0) {
        resultsContainer.innerHTML = sortedResults.map(result => `
            <div class="definition">
                <h2>${result.ord}</h2>
                ${result.kjønn ? `<p class="kjønn">${result.kjønn}</p>` : ''}
                ${result.engelsk ? `<p><span class="definition-label">English:</span> ${result.engelsk}</p>` : ''}
                ${result.uttale ? `<p><span class="definition-label">Pronunciation:</span> ${result.uttale}</p>` : ''}
                ${result.etymologi ? `<p><span class="definition-label">Etymology:</span> ${result.etymologi}</p>` : ''}
                ${result.definisjon ? `<p><span class="definition-label">Definition:</span> ${result.definisjon}</p>` : ''}
                ${result.eksempel ? `<p class="example">${result.eksempel}</p>` : ''}
            </div>
        `).join('');
    } else {
        resultsContainer.innerHTML = `
            <div class="definition">
                <p>No results found for "${query}". Try searching for another word or use the Random Word feature.</p>
            </div>
        `;
    }
}

// Function to ensure one result is always visible (first entry)
function showFirstResult() {
    if (results.length === 0) {
        console.warn('No results available to display.');
        return;
    }
    const firstResult = results[0];
    const resultsContainer = document.getElementById('results-container');
    const resultHTML = `
        <div class="definition">
            <h2>${firstResult.ord}</h2>
            ${firstResult.kjønn ? `<p class="kjønn">${firstResult.kjønn}</p>` : ''}
            ${firstResult.engelsk ? `<p><span class="definition-label">English:</span> ${firstResult.engelsk}</p>` : ''}
            ${firstResult.uttale ? `<p><span class="definition-label">Pronunciation:</span> ${firstResult.uttale}</p>` : ''}
            ${firstResult.etymologi ? `<p><span class="definition-label">Etymology:</span> ${firstResult.etymologi}</p>` : ''}
            ${firstResult.definisjon ? `<p><span class="definition-label">Definition:</span> ${firstResult.definisjon}</p>` : ''}
            ${firstResult.eksempel ? `<p class="example">${firstResult.eksempel}</p>` : ''}
        </div>
    `;
    resultsContainer.innerHTML = resultHTML;
    console.log('Displayed first result:', firstResult);
}

window.onload = function() {
    // Fetch the dictionary data when the page loads
    fetchDictionaryData();

    // Check if there's a search term in the URL and perform a search
    const searchTerm = window.location.pathname.split('/')[1];
    if (searchTerm) {
        document.getElementById('search-bar').value = decodeURIComponent(searchTerm);
        search();  // Automatically perform the search for the term in the URL
    }
};

// Only update the URL if you're not running on a local file system
if (window.location.protocol !== 'file:') {
    const newUrl = `${window.location.protocol}//${window.location.host}/${query}`;
    history.pushState({ search: query }, '', newUrl);  // Update the URL without reloading the page
}