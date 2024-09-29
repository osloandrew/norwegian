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

async function randomWord() {
    clearInput();  // Clear search bar when generating a random word

    if (!results.length) {
        console.warn('No results available to pick a random word.');
        return;
    }

    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';
    let filteredResults = results;

    // Show the spinner at the start of the search
    const spinner = document.getElementById('loading-spinner');
    spinner.style.display = 'block';

    // Filter the results by the selected part of speech
    if (selectedPOS) {
        filteredResults = results.filter(r => mapKjonnToPOS(r.kjønn) === selectedPOS);
    }

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
        spinner.style.display = 'none';
        return;
    }

    const randomResult = filteredResults[Math.floor(Math.random() * filteredResults.length)];
    randomResult.kjønn = formatKjonn(randomResult.kjønn);

    // Check for audio availability before rendering the result
    const audioUrl = await fetchAudioForWord(randomResult.ord);
    const pronunciationIcon = audioUrl 
        ? `<i class="fas fa-volume-up" style="cursor: pointer;" onclick="playPronunciation('${randomResult.ord}', this)"></i>`
        : `<i class="fas fa-volume-up" style="opacity: 0.5; cursor: not-allowed;"></i>`;

    const displayUttale = randomResult.uttale || (audioUrl ? `[${randomResult.ord}]` : '');
    const pronunciationSection = audioUrl || randomResult.uttale
        ? `<p class="pronunciation">${pronunciationIcon} ${displayUttale}</p>`
        : '';

    // Collect the entire HTML into a string
    let htmlString = `
        <div class="definition">
            <h2 class="word-kjonn">
                ${randomResult.ord}
                ${randomResult.kjønn ? `<span class="kjønn">${randomResult.kjønn}</span>` : ''}
            </h2>
            ${randomResult.definisjon ? `<p>${randomResult.definisjon}</p>` : ''}
            <div class="definition-content">
                ${randomResult.engelsk ? `<p class="english"><i class="fas fa-language"></i> ${randomResult.engelsk}</p>` : ''}
                ${pronunciationSection}
                ${randomResult.etymologi ? `<p class="etymology"><i class="fa-solid fa-flag"></i> ${randomResult.etymologi}</p>` : ''}
            </div>
            ${randomResult.eksempel ? `<p class="example">${randomResult.eksempel}</p>` : ''}
        </div>
    `;

    // Update the DOM in one go
    document.getElementById('results-container').innerHTML = htmlString;

    // Hide the spinner after results are displayed or an error is shown
    spinner.style.display = 'none';
}


async function fetchAudioForWord(word) {
    const encodedWord = encodeURIComponent(word);

    // Possible prefixes (e.g., No-, Nb-) and their combinations
    const prefixes = ['No-', 'Nb-', 'LL-Q9043_(nor)-', 'NB_-_Pronunciation_of_Norwegian_Bokmål_'];

    // Common number paths to check first
    const commonNumberPaths = ['3/38', '1/16', '5/58'];

    // Less likely number paths (fallback)
    const secondaryNumberPaths = ['2/20', '9/9b', '7/74', 'b/b6', '6/64'];

    // Dynamically generate URL combinations
    const generateUrls = (numberPaths) => {
        const urls = [];
        prefixes.forEach(prefix => {
            numberPaths.forEach(path => {
                urls.push(`https://upload.wikimedia.org/wikipedia/commons/${path}/${prefix}${encodedWord}.ogg`);
                urls.push(`https://upload.wikimedia.org/wikipedia/commons/${path}/${prefix}${encodedWord}.wav`);
            });
        });
        return urls;
    };

    // Function to check a batch of URLs using GET instead of HEAD
    const checkUrls = async (urls) => {
        const requests = urls.map(url => 
            fetch(url, { method: 'GET' })
                .then(response => ({ url, ok: response.ok }))
                .catch(() => ({ ok: false }))
        );
        const results = await Promise.all(requests);
        return results.find(response => response.ok)?.url || null;
    };

    // Try common paths first (faster)
    let urlsToCheck = generateUrls(commonNumberPaths);
    let validAudioUrl = await checkUrls(urlsToCheck);

    if (!validAudioUrl) {
        // If no valid URL is found, check secondary paths
        urlsToCheck = generateUrls(secondaryNumberPaths);
        validAudioUrl = await checkUrls(urlsToCheck);
    }

    if (validAudioUrl) {
        console.log(`Audio available for ${word}: ${validAudioUrl}`);
        return validAudioUrl;
    }

    console.log(`No audio found for ${word}`);
    return null;
}









async function playPronunciation(word, iconElement) {
    const audioUrl = await fetchAudioForWord(word);

    if (audioUrl) {
        const audioPlayer = document.getElementById('audio-player');
        audioPlayer.src = audioUrl;
        audioPlayer.play();  // Play the audio without showing the player
    } else {
        // If no audio is available, disable the click event
        iconElement.style.opacity = "0.5";
        iconElement.onclick = null;  // Disable the click event
    }
}



async function search() {
    const query = document.getElementById('search-bar').value.toLowerCase().trim();
    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';

    // Show the spinner at the start of the search
    const spinner = document.getElementById('loading-spinner');
    spinner.style.display = 'block';

    // Update the page title with the search term
    document.title = `${query} - Norwegian Dictionary`;

    console.log('Search query:', query, 'Selected POS:', selectedPOS);

    const resultsContainer = document.getElementById('results-container');
    resultsContainer.innerHTML = '';

    // If the search bar is empty, show an error message
    if (!query) {
        console.log('Search field is empty. Showing error message.');
        resultsContainer.innerHTML = `
            <div class="definition error-message">
                <h2 class="word-kjonn">
                    Error <span class="kjønn">Empty Search</span>
                </h2>
                <p>Please enter a word in the search field before searching.</p>
            </div>
        `;
        spinner.style.display = 'none';
        return;
    }

    // Update the URL to /search/word format without reloading the page
    const newUrl = `#search/${encodeURIComponent(query)}`;
    window.location.hash = newUrl;

    // Trigger a search event in Google Analytics
    gtag('event', 'search', {
        'search_term': query,
        'part_of_speech': selectedPOS || 'none'
    });

    // Trigger a virtual pageview in Google Analytics
    gtag('config', 'G-M5H81RF3DT', {
        'page_path': location.pathname + location.hash
    });

    const matchingResults = results.filter(r => {
        const matchesQuery = r.ord.toLowerCase().includes(query) || r.engelsk.toLowerCase().includes(query);
        const mappedPOS = mapKjonnToPOS(r.kjønn);

        const matchesPOS = !selectedPOS || mappedPOS === selectedPOS; // Exact match for POS
        console.log('Mapped POS:', mappedPOS, 'Matches POS:', matchesPOS, 'for word:', r.ord);

        return matchesQuery && matchesPOS;
    });

    console.log('Filtered results:', matchingResults); // Log filtered results

    // Sort the results: prioritize exact matches in both the Norwegian and English term
    const sortedResults = matchingResults.sort((a, b) => {
        const queryLower = query.toLowerCase();

        // Check for exact match in the Norwegian term
        const isExactMatchA = a.ord.toLowerCase() === queryLower;
        const isExactMatchB = b.ord.toLowerCase() === queryLower;

        if (isExactMatchA && !isExactMatchB) return -1;
        if (!isExactMatchA && isExactMatchB) return 1;

        // Check if the search term appears in the comma-separated list in the English definition
        const aIsInCommaList = a.engelsk.toLowerCase().split(',').map(str => str.trim()).includes(queryLower);
        const bIsInCommaList = b.engelsk.toLowerCase().split(',').map(str => str.trim()).includes(queryLower);

        if (aIsInCommaList && !bIsInCommaList) return -1;
        if (!aIsInCommaList && bIsInCommaList) return 1;

        // Deprioritize compound words where the query appears within a larger word (e.g., 'appelsintre')
        const aContainsInWord = a.ord.toLowerCase().includes(queryLower) && a.ord.toLowerCase() !== queryLower;
        const bContainsInWord = b.ord.toLowerCase().includes(queryLower) && b.ord.toLowerCase() !== queryLower;

        if (aContainsInWord && !bContainsInWord) return 1;
        if (!aContainsInWord && bContainsInWord) return -1;

        // Sort by position of query in the word (earlier is better)
        const aIndex = a.ord.toLowerCase().indexOf(queryLower);
        const bIndex = b.ord.toLowerCase().indexOf(queryLower);

        return aIndex - bIndex;
    });

    // Limit the number of results to a maximum of 20
    const limitedResults = sortedResults.slice(0, 20);

    if (limitedResults.length) {
        // Collect all HTML in a single string to reduce DOM manipulation
        let htmlString = '';
        for (const result of limitedResults) {
            result.kjønn = formatKjonn(result.kjønn);

            // Check for audio availability asynchronously
            const audioUrl = await fetchAudioForWord(result.ord);
            const pronunciationIcon = audioUrl 
                ? `<i class="fas fa-volume-up" style="cursor: pointer;" onclick="playPronunciation('${result.ord}', this)"></i>`
                : `<i class="fas fa-volume-up" style="opacity: 0.5; cursor: not-allowed;"></i>`;

            const displayUttale = result.uttale || (audioUrl ? `[${result.ord}]` : '');
            const pronunciationSection = audioUrl || result.uttale
            ? `<p class="pronunciation">${pronunciationIcon} ${displayUttale}</p>`
            : '';
        
            // Append the HTML for each result
            htmlString += `
                <div class="definition">
                    <h2 class="word-kjonn">
                        ${result.ord}
                        ${result.kjønn ? `<span class="kjønn">${result.kjønn}</span>` : ''}
                    </h2>
                    ${result.definisjon ? `<p>${result.definisjon}</p>` : ''}
                    <div class="definition-content">
                        ${result.engelsk ? `<p class="english"><i class="fas fa-language"></i> ${result.engelsk}</p>` : ''}
                        ${pronunciationSection}
                        ${result.etymologi ? `<p class="etymology"><i class="fa-solid fa-flag"></i> ${result.etymologi}</p>` : ''}
                    </div>
                    ${result.eksempel ? `<p class="example">${result.eksempel}</p>` : ''}
                </div>
            `;
        }
        // Update the DOM in one go
        resultsContainer.innerHTML = htmlString;
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
            <div class="definition error-message">
                <h2 class="word-kjonn">
                    Error <span class="kjønn">No Results</span>
                </h2>
                <p>${noResultsMessage}</p>
            </div>
        `;
    }

    // Hide the spinner after results are displayed or an error is shown
    spinner.style.display = 'none';
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
};
