// Global Variables
let results = [];
let debounceTimer;  // Global variable for debouncing

// Debounce function to limit how often search is triggered
function debounceSearchTrigger(func, delay) {
    clearTimeout(debounceTimer);  // Clear the previous timer
    debounceTimer = setTimeout(() => {
        func();  // Execute the function after the delay
    }, delay);  // Delay period
}

// Handle the key input, performing a search on 'Enter' or debouncing otherwise
function handleKey(event) {
    // Call search function when 'Enter' is pressed or debounce it otherwise
    debounceSearchTrigger(() => {
        if (event.key === 'Enter') {
            search();
        }
    }, 300);  // Delay of 300ms before calling search()
}

function shouldNotDecline(adjective) {
    console.log('shouldNotDecline called for:', adjective); // Debugging
    // Pattern for adjectives that do not decline (same form in all genders)
    const noDeclinePattern = /(ende|bra|ing|y|ekte)$/i;
    
    return noDeclinePattern.test(adjective);
}

function shouldNotTakeTInNeuter(adjective) {
    console.log('shouldNotTakeTInNeuter called for:', adjective); // Debugging
    
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

function toggleInflectionTableVisibility(button) {
    const container = button.parentElement;  // Get the parent element (inflections-container)
    const table = container.querySelector('.inflections-table');  // Select the table within the container
    const word = button.getAttribute('data-word');  // Get the word from the data attribute
    const pos = button.getAttribute('data-pos');    // Get the part of speech (POS)
    let gender = button.getAttribute('data-gender'); // Get the gender for nouns, if applicable

    // If the table doesn't exist, log an error and return early
    if (!table) {
        console.error('Table element not found.');
        return;
    }

    // Check if the table is visible using computed styles
    const isTableVisible = window.getComputedStyle(table).display !== "none";

    // Toggle visibility of the table
    if (isTableVisible) {
        table.style.display = "none";  // Hide the table
        button.textContent = "Show Inflections";  // Update button text
        console.log('Table is now hidden.');
    } else {
        // Log initial data for debugging
        console.log(`Word: ${word}, POS: ${pos}, Gender: ${gender}`);

        // Clear any previous content
        const tbody = table.querySelector('tbody');
        tbody.innerHTML = '';

        let variations = [];

        // Normalize gender and ensure it’s valid before generating variations (only for nouns)
        if (pos === 'noun') {
            gender = gender ? gender.toLowerCase().trim() : '';

            // Handle multiple genders by splitting the gender string (use both "/" and "-" as delimiters)
            const genders = gender.split(/[-/]/).map(g => g.trim());

            // Generate tables for each gender
            genders.forEach(singleGender => {
                if (singleGender.startsWith('substantiv - ')) {
                    singleGender = singleGender.replace('substantiv - ', '').trim();
                }

                // Handle gender detection for nouns
                if (singleGender.includes('neuter') || singleGender === 'et') {
                    singleGender = 'neuter';
                } else if (singleGender.includes('masculine') || singleGender === 'en') {
                    singleGender = 'masculine';
                } else if (singleGender.includes('feminine') || singleGender === 'ei') {
                    singleGender = 'feminine';
                } else {
                    console.error(`Unknown gender for noun: ${word}, gender: ${singleGender}`);
                    return;  // Exit if no valid gender is found
                }

                // Log the final gender
                console.log(`Final Gender for word "${word}": ${singleGender}`);

                // Generate the word variations based on the POS and gender
                variations = generateWordVariationsForInflections(word, pos, singleGender);
                console.log(`Generated Variations for ${singleGender}:`, variations);

                // Create a new table element for each gender
                const newTable = document.createElement('table');
                newTable.classList.add('inflections-table');  // Add the table class
                
                // Add a row in the table for each gender
                let tableContent = '';

                if (variations.length >= 4) {
                    tableContent = `
                        <tr><td>${variations[0]}</td><td>${variations[1]}</td></tr>
                        <tr><td>${variations[2]}</td><td>${variations[3]}</td></tr>
                    `;
                } else {
                    console.error(`Expected 4 noun variations, but got:`, variations);
                }

                // Append the content to the tbody
                tbody.innerHTML += tableContent;
            });
        } else {
            // Generate variations for adjectives, verbs, pronouns, and other parts of speech
            variations = generateWordVariationsForInflections(word, pos);

            // Log generated variations for debugging
            console.log(`Generated Variations for ${pos}:`, variations);

            let tableContent = '';

            // Handle adjectives with specific inflection forms
            if (pos === 'adjective' && variations.length > 0) {
                const adjectiveForms = variations[0];  // The variations array contains the forms
                tableContent = `
                    <tr><td>${adjectiveForms[0]}</td><td>${adjectiveForms[1]}</td><td>${adjectiveForms[2]}</td></tr>
                `;
            // Handle verbs and pronouns
            } else if (pos === 'verb' || pos === 'pronoun') {
                if (variations.length >= 6) {
                    tableContent = `
                        <tr><td>${variations[0]}</td><td>${variations[1]}</td><td>${variations[2]}</td></tr>
                        <tr><td>${variations[3]}</td><td>${variations[4]}</td><td>${variations[5]}</td></tr>
                    `;
                } else {
                    console.error(`Expected 6 verb/pronoun variations, but got:`, variations);
                }
            } else {
                // For other parts of speech, just list the variations
                tableContent = variations.map(variation => `<tr><td>${variation}</td></tr>`).join('');
            }

            // Populate the table with the content
            tbody.innerHTML = tableContent;
        }

        // Show the table and update the button text
        table.style.display = "table";  // Show the table
        button.textContent = "Hide Inflections";
        console.log('Table is now visible.');
    }
}




// Normalize word function to handle both Norwegian and English forms
function normalizeWord(word) {
    const baseWord = word.toLowerCase().trim();
    const variations = new Set([baseWord]); // Always include base form

    // Define common endings for Norwegian and English
    const endings = {
        norwegian: ['er', 'ene', 'en', 'et', 'es', 'te', 'de', 't', 'e'],
        english: ['s', 'es', 'ed', 'ing']
    };

    // Generate variations by removing common endings
    for (const ending of [...endings.norwegian, ...endings.english]) {
        if (baseWord.endsWith(ending)) {
            variations.add(baseWord.slice(0, -ending.length));
        }
    }

    return Array.from(variations); // Convert the set back to an array
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
async function fetchAndLoadDictionaryData() {
    // Show the spinner before fetching data
    document.getElementById('loading-spinner').style.display = 'block';

    try {
        const response = await fetch('https://docs.google.com/spreadsheets/d/e/2PACX-1vSl2GxGiiO3qfEuVM6EaAbx_AgvTTKfytLxI1ckFE6c35Dv8cfYdx30vLbPPxadAjeDaSBODkiMMJ8o/pub?output=csv');
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.text();
        parseCSVData(data);
    } catch (error) {
        console.error('Error fetching or parsing data from Google Sheets:', error);
        console.log('Falling back to local CSV file.');

        // Fallback to local CSV file
        try {
            const localResponse = await fetch('backupDataset');  // Replace with your local CSV file path
            if (!localResponse.ok) throw new Error(`HTTP error! Status: ${localResponse.status}`);
            const localData = await localResponse.text();
            parseCSVData(localData);
        } catch (localError) {
            console.error('Error fetching or parsing data from local CSV file:', localError);
        }
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
        const sentences = randomResult.eksempel.split(/(?<=[.!?])\s+/);  // Split by sentence delimiters
        const firstSentence = sentences[0];

        const sentenceHTML = `
            <div class="definition result-header">
                <h2>Random Sentence</h2>
            </div>
            <div class="definition">
                <p class="sentence">${firstSentence}</p>
            </div>
        `;
        document.getElementById('results-container').innerHTML = sentenceHTML;
    } else {
        // If it's a word, render it with highlighting (if needed)
        displaySearchResults([randomResult], randomResult.ord);
    }

    hideSpinner();  // Hide the spinner
}


// Perform a search based on the input query and selected POS
async function search() {
    const query = document.getElementById('search-bar').value.toLowerCase().trim();
    const selectedPOS = document.getElementById('pos-select') ? document.getElementById('pos-select').value.toLowerCase() : '';
    const type = document.getElementById('type-select').value; // Get the search type (words or sentences)

    // Normalize the query to handle variations
    const normalizedQueries = normalizeWord(query);  // Use normalizeWord to get variations

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
        matchingResults = results.filter(r => normalizedQueries.some(normQuery => r.eksempel && r.eksempel.toLowerCase().includes(normQuery)));

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
            const pos = mapKjonnToPOS(r.kjønn);
            const matchesQuery = normalizedQueries.some(variation => r.ord.toLowerCase().includes(variation) || r.engelsk.toLowerCase().includes(variation));
            return matchesQuery && (!selectedPOS || pos === selectedPOS);
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
                <i class="fas fa-flag"></i> Flag Missing Word Entry</button>
                </div>
            `;
            const flagButton = document.querySelector('.back-btn');
            if (flagButton) {  // Check if the flag button exists
                flagButton.addEventListener('click', function() {
                    const wordToFlag = document.getElementById('search-bar').value;
                    flagMissingWordEntry(wordToFlag);
                });
            }

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

        displaySearchResults(matchingResults); // Render word-specific results
    }

    hideSpinner(); // Hide the spinner
}

// Check if any sentences exist for a word or its variations
function checkForSentences(word) {
    const lowerCaseWord = word.trim().toLowerCase();

    // Split the word by commas to handle comma-separated entries like "anglifisere, anglisere"
    const wordParts = lowerCaseWord.split(',').map(w => w.trim());

    // Iterate through each part of the comma-separated list
    let sentenceFound = false;
    wordParts.forEach(wordPart => {
        // Find part of speech (POS) for each word part
        const matchingWordEntry = results.find(result => result.ord.toLowerCase().includes(wordPart));
        const pos = matchingWordEntry ? mapKjonnToPOS(matchingWordEntry.kjønn) : '';

        // Generate word variations
        const wordVariations = generateWordVariationsForSentences(wordPart, pos);

        // Check if any sentences in the data include this word or its variations in the 'eksempel' field
        if (results.some(result => 
            result.eksempel && wordVariations.some(variation => result.eksempel.toLowerCase().includes(variation))
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
function displaySearchResults(results, query = '') {
    const resultsContainer = document.getElementById('results-container');
    resultsContainer.innerHTML = '';  // Clear previous results

    query = query.toLowerCase().trim();  // Ensure the query is lowercased and trimmed

    let htmlString = '';

    // Limit to a maximum of 20 results
    results.slice(0, 20).forEach(result => {
        result.kjønn = formatKjonn(result.kjønn);

        // Check if sentences are available using enhanced checkForSentences
        const hasSentences = checkForSentences(result.ord);

        // Convert the word to lowercase and trim spaces when generating the ID
        const normalizedWord = result.ord.toLowerCase().trim();

        // Highlight the word being defined (result.ord) in the example sentence
        const highlightedExample = result.eksempel ? highlightQuery(result.eksempel, query || result.ord.toLowerCase()) : '';

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
                <!-- Render the highlighted example sentence here -->
                ${highlightedExample ? `<p class="example">${highlightedExample}</p>` : ''}
                <!-- Show "Show Sentences" button only if sentences exist -->
                ${hasSentences ? `<button class="sentence-btn" data-word="${result.ord}" onclick="fetchAndRenderSentences('${result.ord}')">Show Sentences</button>` : ''}
            </div>
            <!-- Sentences container is now outside the definition block -->
            <div class="sentences-container" id="sentences-container-${normalizedWord}"></div>
        `;    
    });
    document.getElementById('results-container').innerHTML = htmlString;
}

// Utility function to generate word variations for verbs ending in -ere and handle adjective/noun forms
function generateWordVariationsForSentences(word, pos) {
    const variations = [];
    
    // Split the word into parts in case it's a phrase (e.g., "vedtatt sannhet")
    const wordParts = word.split(' ');

    // If it's a single word
    if (wordParts.length === 1) {
        const singleWord = wordParts[0];
        
        // Handle verb variations if the word is a verb and ends with "ere"
        if (singleWord.endsWith('ere') && pos === 'verb') {
            const stem = singleWord.slice(0, -3);  // Remove the -ere part
            variations.push(
                singleWord,        // infinitive: anglifisere
                `${stem}er`,       // present tense: anglifiserer
                `${stem}te`,       // past tense: anglifiserte
                `${stem}t`,        // past participle: anglifisert
                `${stem}`,         // imperative: anglifiser
                `${stem}es`        // passive: anglifiseres
            );
        } else {
            // For non-verbs, just add the word itself as a variation
            variations.push(singleWord);
        }

    // If it's a phrase (e.g., "vedtatt sannhet"), handle each part separately
    } else if (wordParts.length === 2) {
        const [adjectivePart, nounPart] = wordParts;

        // Handle adjective inflection (e.g., "vedtatt" -> "vedtatte")
        const adjectiveVariations = [adjectivePart, adjectivePart.replace(/t$/, 'te')];  // Add plural/adjective form

        // Handle noun pluralization (e.g., "sannhet" -> "sannheter")
        const nounVariations = [nounPart, nounPart + 'er'];  // Add plural form for nouns

        // Combine all variations of adjective and noun
        adjectiveVariations.forEach(adj => {
            nounVariations.forEach(noun => {
                variations.push(`${adj} ${noun}`);
            });
        });
    }

    return variations;
}

// Utility function to generate word variations for verbs ending in -ere and handle adjective/noun forms
function generateWordVariationsForInflections(word, pos, gender = null) {
    const variations = [];

    // Helper to get the stem of a word by removing the last characters
    function getStem(word, endingLength) {
        return word.slice(0, -endingLength);
    }

    // Irregular verbs dictionary
    const irregularVerbs = {
        "gå": { present: "går", past: "gikk", pastParticiple: "gått", imperative: "gå" },
        "spise": { present: "spiser", past: "spiste", pastParticiple: "spist", imperative: "spis" },
        "gjøre": { present: "gjør", past: "gjorde", pastParticiple: "gjort", imperative: "gjør" },
        "bli": { present: "blir", past: "ble", pastParticiple: "blitt", imperative: "bli" },
        "være": { present: "er", past: "var", pastParticiple: "vært", imperative: "vær" },
        "kunne": { present: "kan", past: "kunne", pastParticiple: "kunnet", imperative: "" }, // Modal verb, no imperative
        "skulle": { present: "skal", past: "skulle", pastParticiple: "skullet", imperative: "" }, // Modal verb
        "ville": { present: "vil", past: "ville", pastParticiple: "villet", imperative: "" }, // Modal verb
        "måtte": { present: "må", past: "måtte", pastParticiple: "måttet", imperative: "" }, // Modal verb
        // Add more irregular verbs as needed
    };

    // Helper function to check if a word ends with an irregular verb and conjugate accordingly
    function conjugateIrregularVerb(verb) {
        for (const baseVerb in irregularVerbs) {
            if (verb.endsWith(baseVerb)) {
                const stem = verb.slice(0, -baseVerb.length); // Remove the base verb part from the word
                const verbForms = irregularVerbs[baseVerb];
                return [
                    verb,  // infinitive
                    stem + verbForms.present,  // present tense
                    stem + verbForms.past,  // past tense
                    stem + verbForms.pastParticiple,  // past participle
                    stem + verbForms.imperative,  // imperative (if any)
                    stem + baseVerb + 's'  // passive form (regular pattern)
                ];
            }
        }
        return null; // Return null if no irregular verb matches
    }

    // Handle verbs
    if (pos === 'verb') {
        // Check if the word is or ends with an irregular verb
        const irregularConjugations = conjugateIrregularVerb(word);
        if (irregularConjugations) {
            variations.push(...irregularConjugations);
        } else {
            if (word.endsWith('ere')) {
                // For verbs like "insistere"
                const stem = getStem(word, 1);
                variations.push(
                    word,                // infinitive
                    stem + 'er',          // present tense
                    stem + 'te',        // past tense
                    stem + 't',         // past participle
                    stem,           // imperative
                    stem + 'es'           // passive form
                );
            } else if (word.endsWith('e')) {
                const stem = getStem(word, 1);
                if (stem.endsWith('s')) {
                    // Handle verbs like "lese" where the past is "leste" and past participle is "lest"
                    variations.push(
                        word,                // infinitive: lese
                        stem + 'er',         // present: leser
                        stem + 'te',         // past: leste
                        stem + 't',          // past participle: lest
                        stem,           // imperative: les
                        stem + 'es'          // passive: leses
                    );
                } else {
                    // Regular verbs, Group 1 pattern
                    variations.push(
                        word,                // infinitive: kaste
                        stem + 'er',         // present: kaster
                        stem + 'et',         // past: kastet
                        stem + 'et',         // past participle: kastet
                        stem,           // imperative: kast
                        stem + 'es'          // passive: kastes
                    );
                }
            } else if (word.endsWith('a')) {
                // For verbs like "dra" -> "drar" (Group 3)
                const stem = getStem(word, 1);
                variations.push(
                    word,                // infinitive
                    stem + 'r',          // present tense
                    stem + 'dde',        // past tense
                    stem + 'dd',         // past participle
                    stem,           // imperative
                    stem + 's'           // passive form
                );
            } else {
                // Strong verb pattern (Group 4)
                const stem = getStem(word, 1);
                variations.push(
                    word,                // infinitive
                    stem + 'r',          // present
                    stem + 't',          // past (default strong verb)
                    stem + 'tt',         // past participle
                    stem,           // imperative
                    stem + 's'           // passive form
                );
            }
        }

    // Handle nouns
    } else if (pos === 'noun') {
        if (!gender) {
            console.warn(`No gender found for noun: ${word}. Applying default (masculine).`);
            gender = 'masculine';  
        }

        // Adjust endings for words that already end in 'e'
        function adjustEndings(baseWord, singularDefiniteEnding, pluralIndefiniteEnding, pluralDefiniteEnding) {
            if (baseWord.endsWith('e')) {
                // For feminine nouns like "jente", handle singular definite and plural forms
                return [
                    baseWord.slice(0, -1) + singularDefiniteEnding,  // singular definite: jenta
                    baseWord + 'r',  // plural indefinite: jenter (keep the final 'e' and just add 'r')
                    baseWord + 'ne'  // plural definite: jentene
                ];
            }
            return [
                baseWord + singularDefiniteEnding,  // singular definite
                baseWord + pluralIndefiniteEnding,  // plural indefinite
                baseWord + pluralDefiniteEnding     // plural definite
            ];
        }

        if (gender === 'masculine') {
            const [singularDefinite, pluralIndefinite, pluralDefinite] = adjustEndings(word, 'en', 'er', 'ene');
            variations.push(
                'en ' + word,        // singular indefinite: en stol
                singularDefinite,    // singular definite: stolen
                pluralIndefinite,    // plural indefinite: stoler
                pluralDefinite       // plural definite: stolene
            );
        } else if (gender === 'feminine') {
            const stem = word.endsWith('e') ? word.slice(0, -1) : word;
            const [singularDefinite, pluralIndefinite, pluralDefinite] = adjustEndings(word, 'a', 'er', 'ene');
            variations.push(
                'en/ei ' + word,     // singular indefinite: en/ei jente
                stem + 'en/' + singularDefinite,  // singular definite: jenten/jenta
                pluralIndefinite,    // plural indefinite: jenter
                pluralDefinite       // plural definite: jentene
            );
        } else if (gender === 'neuter') {
            // Handle neuter nouns, with special attention to no plural ending cases
            const [singularDefinite, pluralIndefinite, pluralDefinite] = adjustEndings(word, 'et', '', 'ene');
            variations.push(
                'et ' + word,        // singular indefinite: et hus
                singularDefinite,    // singular definite: huset
                pluralIndefinite || word,  // plural indefinite: hus (sometimes the same as singular indefinite)
                pluralDefinite       // plural definite: husene
            );
        }
    // Handle adjectives
    } else if (pos === 'adjective') {
        if (shouldNotDecline(word) === true) {
            // Handle adjectives that don't decline
            variations.push([word, word, word]);  // Same word for all forms
        } else if (shouldNotTakeTInNeuter(word) === true) {
            // Handle adjectives that don't take 't' in the neuter form
            variations.push([word, word, word + 'e']);
        } else if (shouldNotTakeTInNeuter(word) === 'double') {
            // Handle adjectives that take 'tt' in the neuter form
            variations.push([word, word + 'tt', word + 'e']);
        } else {
            // Regular adjectives
            variations.push([word, word + 't', word + 'e']);
        }
    // Handle pronouns, conjunctions, etc.
    } else if (pos === 'pronoun') {
        variations.push(word); // Pronouns generally don’t inflect in the same way
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

    if (combinedMatches.length > 0) {
        // Generate the header card
        htmlString += `
            <div class="definition result-header">
                <h2>Sentence Results for "${word}"</h2>
            </div>
        `;
    }

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


// Highlight search query in text, accounting for Norwegian characters (å, æ, ø) and verb variations
function highlightQuery(sentence, query) {
    if (!query) return sentence; // If no query, return sentence as is.

    // Log the sentence and query to see what's being processed
    console.log('Original sentence:', sentence);
    console.log('Query:', query);

    // Check if the sentence is already highlighted to avoid double highlighting
    if (sentence.includes('<span style="color: #3c88d4;">')) {
        return sentence;  // Already highlighted, return the sentence as is
    }

    // First, remove any existing highlights by replacing the <span> tags to avoid persistent old highlights
    let cleanSentence = sentence.replace(/<span style="color: #3c88d4;">(.*?)<\/span>/gi, '$1');
    console.log('Cleaned sentence:', cleanSentence);

    // Define a regex pattern that includes Norwegian characters and dynamically inserts the query
    const norwegianLetters = '[\\wåæøÅÆØ]'; // Include Norwegian letters in the pattern
    const regex = new RegExp(`(${norwegianLetters}*${query}${norwegianLetters}*)`, 'gi');
    console.log('Generated regex:', regex);

    // Highlight all occurrences of the query in the sentence
    cleanSentence = cleanSentence.replace(regex, '<span style="color: #3c88d4;">$1</span>');
    console.log('Highlighted sentence:', cleanSentence);

    // Get part of speech (POS) for the query to pass into `generateWordVariationsForSentences`
    const matchingWordEntry = results.find(result => result.ord.toLowerCase().includes(query));
    const pos = matchingWordEntry ? mapKjonnToPOS(matchingWordEntry.kjønn) : '';

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

    // Log word variations for debugging
    console.log(`Word Variations for rendering:`, wordVariations);

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

                console.log(`Processing sentence: "${trimmedSentence}"`);  // Log the sentence being processed

                // Check if the sentence contains any of the word variations
                let matchedVariation = wordVariations.find(variation => sentence.toLowerCase().includes(variation));
                console.log(`Matched variation for sentence:`, matchedVariation);  // Log the matched variation

                if (matchedVariation) {
                    console.log(`Found matched variation: "${matchedVariation}" in sentence: "${sentence}"`);

                    // Use a regular expression to match the full word containing any of the variations
                    const norwegianPattern = '[\\wåæøÅÆØ]'; // Pattern including Norwegian letters
                    const regex = new RegExp(`(${norwegianPattern}*${matchedVariation}${norwegianPattern}*)`, 'gi');
                    
                    const highlightedSentence = sentence.replace(regex, '<span style="color: #3c88d4;">$1</span>');

                    // Determine if it's an exact match (contains the exact search term as a full word)
                    const exactMatchRegex = new RegExp(`\\b${matchedVariation.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
                    console.log(`Testing for exact match: "${sentence}" against "${matchedVariation}" with regex: ${exactMatchRegex}`);

                    if (exactMatchRegex.test(sentence)) {
                        console.log(`Exact match found for "${matchedVariation}"`);
                        exactMatches.push(highlightedSentence);  // Exact match
                    } else {
                        console.log(`Inexact match found for "${matchedVariation}"`);
                        inexactMatches.push(highlightedSentence);  // Inexact match
                    }
                } else {
                    console.log(`No match found for variations: ${wordVariations.join(', ')} in sentence: "${sentence}"`);
                }
            }
        });
    });

    // Log results to understand why no matches are being found
    console.log("Exact matches:", exactMatches);
    console.log("Inexact matches:", inexactMatches);

    // Combine exact matches first, then inexact matches, respecting the 20 sentence limit
    const combinedMatches = [...exactMatches, ...inexactMatches].slice(0, 20);

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
                <h2 class="word-kjonn">
                    Error <span class="kjønn">No Matching Sentences</span>
                </h2>
                <p>No sentences found for the word "${wordVariations.join(', ')}".</p>
            </div>
        `;
    }

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
        displaySearchResults(matchingResults);
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
    
    console.log(`Fetching and rendering sentences for word/phrase: "${trimmedWord}"`);

    // Find the part of speech (POS) of the word
    const matchingWordEntry = results.find(result => result.ord.toLowerCase().includes(trimmedWord));
    const pos = matchingWordEntry ? mapKjonnToPOS(matchingWordEntry.kjønn) : '';

    // Generate word variations using the external function
    const wordVariations = trimmedWord.split(',').flatMap(w => generateWordVariationsForSentences(w.trim(), pos));
        
    // Log to check the generated word variations
    console.log(`Generated word variations: ${wordVariations}`);

    // Filter results to find sentences that contain any of the word variations in the 'eksempel' field
    let matchingResults = results.filter(r => {
        console.log("Checking sentence:", r.eksempel);
        // Loop through each variation and check if it exists in the sentence
        return wordVariations.some(variation => {
            const matchFound = r.eksempel.toLowerCase().includes(variation);
            if (matchFound) {
                console.log(`Found match in sentence: "${r.eksempel}" for variation "${variation}"`);
            }
            return matchFound;
        });
    });

    // Log the sentences that were matched
    console.log(`Matching results for "${trimmedWord}":`, matchingResults);

    // Check if there are any matching results
    if (matchingResults.length === 0) {
        console.warn(`No sentences found for the word variations.`);
        sentenceContainer.innerHTML = `
            <div class="definition error-message">
                <h2 class="word-kjonn">
                    Error <span class="kjønn">No Sentences Available</span>
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
            console.log(`Applying highlight for variation: ${variation}`);
            result.eksempel = highlightQuery(result.eksempel, variation);  // Reset and apply highlight for the current word
        });
    });

    let backButtonHTML = `
        <button class="sentence-btn back-btn" onclick="renderWordDefinition('${trimmedWord}')">
            <i class="fas fa-angle-left"></i> Back to Definition
        </button>
    `;

    let sentenceContent = renderSentencesHTML(matchingResults, wordVariations);

    if (sentenceContent) {
        sentenceContainer.innerHTML = sentenceContent;
        sentenceContainer.style.display = "block";  // Show the container
        button.innerText = "Hide Sentences";
        button.classList.remove('show');
        button.classList.add('hide');
        console.log("Sentence content added:", sentenceContent);
    } else {
        console.warn("No content to show for the word:", trimmedWord);
    }

    console.log(`Final rendered content for "${trimmedWord}":`, sentenceContent);
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
    fetchAndLoadDictionaryData();  // Load dictionary data when the page is refreshed

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
