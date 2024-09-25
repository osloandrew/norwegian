// Declare a global array to store the dictionary results fetched from the Google Sheets CSV
let results = [];

// Clear input field function
function clearInput() {
    // Clear the value of the search bar input field
    document.getElementById('search-bar').value = '';
}

// Debounced search function to delay search execution
function debounceSearch(func, delay) {
    let debounceTimeout; // Declare debounceTimeout to keep track of the timeout
    return function () {
        const context = this, args = arguments;
        clearTimeout(debounceTimeout); // Clear previous timeout to reset the delay
        debounceTimeout = setTimeout(() => func.apply(context, args), delay); // Set a new timeout
    };
}

// Fetch data from the Google Sheets CSV using async/await
async function fetchDictionaryData() {
    try {
        console.log('Fetching data from Google Sheets...');
        const response = await fetch('https://docs.google.com/spreadsheets/d/e/2PACX-1vSl2GxGiiO3qfEuVM6EaAbx_AgvTTKfytLxI1ckFE6c35Dv8cfYdx30vLbPPxadAjeDaSBODkiMMJ8o/pub?output=csv');
        
        // Check if the fetch request is successful
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.text(); // Get the CSV data as text
        parseCSVData(data);  // Parse the CSV data using PapaParse
    } catch (error) {
        console.error('Error fetching or parsing data:', error); // Handle errors gracefully
    }
}

// Handle Enter key press to trigger search
function handleKey(event) {
    if (event.key === 'Enter') {
        search(); // Trigger the search when Enter key is pressed
    }
}

// Parse CSV data using PapaParse
function parseCSVData(data) {
    Papa.parse(data, {
        header: true, // Treat the first row of the CSV as header
        skipEmptyLines: true, // Skip any empty rows in the CSV file
        complete: function (resultsFromParse) {
            results = resultsFromParse.data; // Store parsed data in the global results array
            console.log('Parsed Results:', results); // Log parsed results for debugging
            showFirstResult();  // Show the first result after data is loaded
        },
        error: function (error) {
            console.error('Error parsing CSV:', error); // Handle parsing errors
        }
    });
}

// Function to pick and display a random word from the results
function randomWord() {
    if (results.length === 0) {
        console.warn('No results available to pick a random word.'); // Warn if no results are available
        return;
    }

    const randomIndex = Math.floor(Math.random() * results.length); // Pick a random index
    const randomResult = results[randomIndex]; // Get the random word based on the index

    // Update the results container with the random word's details
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

    console.log('Displayed random result:', randomResult);
}

// Main search function to search by a query and update the page
function search() {
    const query = document.getElementById('search-bar').value.toLowerCase();

    // Check if the search input is empty, and prevent further execution if true
    if (query === '') {
        alert('Please enter a word to search'); // Notify the user to enter a search query
        return;
    }

    // Clear the results container before displaying new results
    const resultsContainer = document.getElementById('results-container');
    resultsContainer.innerHTML = '';

    console.log('Searching for:', query);

    // Smooth scroll to the top after search
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });

    // Filter the results based on the search query (match by Norwegian word or English translation)
    const matchingResults = results.filter(r => {
        const norwegianWord = r.ord.toLowerCase();
        const englishWord = r.engelsk.toLowerCase();
        return norwegianWord.includes(query) || englishWord.includes(query);
    });

    // Sort results to prioritize exact matches first
    const sortedResults = matchingResults.sort((a, b) => {
        const norwegianWordA = a.ord.toLowerCase();
        const norwegianWordB = b.ord.toLowerCase();
        const englishWordA = a.engelsk.toLowerCase();
        const englishWordB = b.engelsk.toLowerCase();

        // Prioritize exact matches
        const isExactMatchA = norwegianWordA === query || englishWordA === query;
        const isExactMatchB = norwegianWordB === query || englishWordB === query;

        if (isExactMatchA && !isExactMatchB) return -1;
        if (!isExactMatchA && isExactMatchB) return 1;
        return 0;
    });

    // Display the sorted search results
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
        // Display message if no results are found
        resultsContainer.innerHTML = `
            <div class="definition">
                <p>No results found for "${query}". Try searching for another word or use the Random Word feature.</p>
            </div>
        `;
    }
}

// Function to display the first result from the fetched data
function showFirstResult() {
    if (results.length === 0) {
        console.warn('No results available to display.'); // Warn if no data is available
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

// Load dictionary data and perform any URL-based search when the page is loaded
window.onload = function () {
    fetchDictionaryData(); // Fetch dictionary data from Google Sheets when the page loads

    // Check if there's a search term in the URL and perform a search automatically
    const searchTerm = window.location.pathname.split('/')[1];
    if (searchTerm) {
        document.getElementById('search-bar').value = decodeURIComponent(searchTerm);
        search();  // Perform the search using the term from the URL
    }
};
