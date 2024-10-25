let storyResults = [];  // Global variable to store the stories

// Define an object mapping genres to Font Awesome icons
const genreIcons = {
    'action': '<i class="fas fa-bolt"></i>',              // Action genre icon
    'adventure': '<i class="fas fa-compass"></i>',        // Adventure genre icon
    'art': '<i class="fas fa-paint-brush"></i>',          // Art genre icon
    'biography': '<i class="fas fa-user"></i>',           // Biography genre icon
    'business': '<i class="fas fa-briefcase"></i>',       // Business genre icon
    'children': '<i class="fas fa-child"></i>',           // Children’s genre icon
    'comedy': '<i class="fas fa-laugh"></i>',             // Comedy genre icon
    'crime': '<i class="fas fa-gavel"></i>',              // Crime genre icon
    'dialogue': '<i class="fas fa-comments"></i>',        // Dialogue genre icon
    'drama': '<i class="fas fa-theater-masks"></i>',      // Drama genre icon
    'economics': '<i class="fas fa-chart-line"></i>',     // Economics genre icon
    'education': '<i class="fas fa-book-reader"></i>',    // Education genre icon
    'fantasy': '<i class="fas fa-dragon"></i>',           // Fantasy genre icon
    'food': '<i class="fas fa-utensils"></i>',            // Food genre icon
    'health': '<i class="fas fa-heartbeat"></i>',         // Health genre icon
    'history': '<i class="fas fa-landmark"></i>',         // History genre icon
    'horror': '<i class="fas fa-ghost"></i>',             // Horror genre icon
    'mystery': '<i class="fas fa-search"></i>',           // Mystery genre icon
    'music': '<i class="fas fa-music"></i>',              // Music genre icon
    'nature': '<i class="fas fa-leaf"></i>',              // Nature genre icon
    'philosophy': '<i class="fas fa-brain"></i>',         // Philosophy genre icon
    'poetry': '<i class="fas fa-feather-alt"></i>',       // Poetry genre icon
    'politics': '<i class="fas fa-balance-scale"></i>',   // Politics genre icon
    'psychology': '<i class="fas fa-brain"></i>',         // Psychology genre icon
    'religion': '<i class="fas fa-praying-hands"></i>',   // Religion genre icon
    'romance': '<i class="fas fa-heart"></i>',            // Romance genre icon
    'science': '<i class="fas fa-flask"></i>',            // Science genre icon
    'science fiction': '<i class="fas fa-rocket"></i>',   // Sci-Fi genre icon
    'self-help': '<i class="fas fa-hands-helping"></i>',  // Self-help genre icon
    'sports': '<i class="fas fa-football-ball"></i>',     // Sports genre icon
    'technology': '<i class="fas fa-microchip"></i>',     // Technology genre icon
    'thriller': '<i class="fas fa-skull"></i>',           // Thriller genre icon
    'travel': '<i class="fas fa-plane"></i>',             // Travel genre icon
};

// Function to load the stories CSV file and display based on URL parameter
async function fetchAndLoadStoryData() {
    return new Promise(async (resolve, reject) => {
        try {
            console.log('Attempting to load stories from norwegianStories.csv...');
            const response = await fetch('norwegianStories.csv');
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            const data = await response.text();
            
            // Parse CSV data and resolve when done
            parseStoryCSVData(data);
            resolve();
        } catch (error) {
            console.error('Error fetching or parsing stories CSV file:', error);
            reject(error);
        }
    });
}

// Parse the CSV data for stories
function parseStoryCSVData(data) {
    Papa.parse(data, {
        header: true,
        skipEmptyLines: true,
        complete: function (resultsFromParse) {
            storyResults = resultsFromParse.data.map(entry => {
                entry.titleNorwegian = entry.titleNorwegian.trim();  // Ensure the title is trimmed
                return entry;
            });
            console.log('Parsed and cleaned story data:', storyResults);
        },
        error: function (error) {
            console.error('Error parsing story CSV:', error);
        }
    });
}

async function displayStoryList(filteredStories = storyResults) {
    restoreSearchContainerInner();
    removeStoryHeader();
    clearContainer();  // Clear previous results

    // Reset the page title and URL to the main list view
    document.title = 'Stories - Norwegian Dictionary';
    history.replaceState({}, '', `${window.location.origin}${window.location.pathname}`);
    updateURL(null, 'stories', null);

    // Retrieve selected CEFR and genre filter values
    const selectedCEFR = document.getElementById('cefr-select').value.toUpperCase().trim();
    const selectedGenre = document.getElementById('genre-select').value.toLowerCase().trim();

    // Filter stories based on selected CEFR and genre
    let filtered = filteredStories.filter(story => {
        const genreMatch = selectedGenre ? story.genre && story.genre.trim().toLowerCase() === selectedGenre : true;
        const cefrMatch = selectedCEFR ? story.CEFR && story.CEFR.trim().toUpperCase() === selectedCEFR : true;
        return genreMatch && cefrMatch;
    });

    // Shuffle the filtered stories using Fisher-Yates algorithm
    for (let i = filtered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
    }

    // Limit the results to a maximum of 20 stories
    const limitedStories = filtered.slice(0, 20);

    // Generate HTML for the filtered, shuffled stories
    let htmlString = `
        <div class="result-header">
            <h2>Available Stories</h2>
        </div>
    `;

    // Use Promise.all to handle asynchronous audio checks for each story
    const storiesWithAudio = await Promise.all(
        limitedStories.map(async (story) => {
            const cefrClass = getCefrClass(story.CEFR);  // Determine the CEFR class for styling
            const genreIcon = genreIcons[story.genre.toLowerCase()] || '';  // Get the appropriate genre icon

            // Check if audio file exists asynchronously
            const audioExists = await hasAudio(story.titleNorwegian);

            return `
                <div class="stories-list-item" data-title="${story.titleNorwegian}" onclick="displayStory('${story.titleNorwegian.replace(/'/g, "\\'")}')">
                    <div class="stories-content">
                        <h2>${story.titleNorwegian}</h2>
                        ${story.titleNorwegian !== story.titleEnglish ? `<p class="stories-subtitle">${story.titleEnglish}</p>` : ''}
                    </div>
                    <div class="stories-detail-container">
                        ${audioExists ? `<div class="stories-genre"><i class="fas fa-volume-up"></i></div>` : ''}  <!-- Audio icon if available -->
                        <div class="stories-genre">${genreIcon}</div>  <!-- Genre icon -->
                        <div class="game-cefr-label ${cefrClass}">${story.CEFR}</div>  <!-- CEFR label -->
                    </div>
                </div>
            `;
        })
    );

    // Join the generated HTML for each story and insert into results container
    htmlString += storiesWithAudio.join('');
    document.getElementById('results-container').innerHTML = htmlString;
}


function displayStory(titleNorwegian) {
    const searchContainer = document.getElementById('search-container');
    const searchContainerInner = document.getElementById('search-container-inner');
    const selectedStory = storyResults.find(story => story.titleNorwegian === titleNorwegian);

    console.log(`Trying to display story with title: ${titleNorwegian}`);

    if (!selectedStory) {
        console.error(`No story found with the title: ${titleNorwegian}`);
        return;
    }

    document.title = selectedStory.titleNorwegian + ' - Norwegian Dictionary';
    updateURL(null, 'story', null, titleNorwegian);  // Update URL with story parameter

    clearContainer();

    if (!document.querySelector('.stories-story-header')) {
        const headerHTML = `
            <div class="stories-story-header">
                <div class="stories-back-btn">
                    <i class="fas fa-chevron-left" onclick="displayStoryList()"></i>
                </div>
                <div class="stories-title-container">
                    <h2>${selectedStory.titleNorwegian}</h2>
                    ${selectedStory.titleNorwegian !== selectedStory.titleEnglish ? `<p class="stories-subtitle">${selectedStory.titleEnglish}</p>` : ''}
                </div>
                <div class="stories-english-btn">
                    <i class="fas fa-comment-alt" onclick="toggleEnglishSentences()"></i>
                </div>
            </div>
        `;

        searchContainer.style.display = 'block';
        searchContainerInner.style.display = 'none';
        document.getElementById('search-container').insertAdjacentHTML('beforeend', headerHTML);
    }

    // Check for the audio file
    const audioFileName = `audio-${titleNorwegian}.m4a`;
    const audioFileURL = `${audioFileName}`;  // Adjust path as needed
    const audioHTML = `<audio controls src="${audioFileURL}" class="stories-audio-player"></audio>`;

    // Set up the audio file handling
    const audio = new Audio(audioFileURL);

    // Generate content with sentences and optionally include the audio player
    let contentHTML = `<div class="stories-sentences-container">`;

    // Function to finalize and display the story content, with or without audio
    const finalizeContent = (includeAudio = false) => {
        if (includeAudio) {
            contentHTML = audioHTML + contentHTML;
        }

        // Loop to create sentence display
        for (let i = 0; i < norwegianSentences.length; i++) {
            const norwegianSentence = norwegianSentences[i].trim();
            const englishSentence = englishSentences[i] ? englishSentences[i].trim() : '';

            contentHTML += `
                <div class="sentence-container">
                    <div class="stories-sentence-box-norwegian">
                        <div class="sentence-content">
                            <p class="sentence">${norwegianSentence}</p>
                        </div>
                    </div>
                    <div class="stories-sentence-box-english">
                        <div class="sentence-content">
                            <p class="sentence">${englishSentence}</p>
                        </div>
                    </div>
                </div>
            `;
        }

        contentHTML += `</div>`;
        document.getElementById('results-container').innerHTML = contentHTML;
    };

    // Check if the audio file exists before finalizing content
    audio.onerror = () => {
        console.log(`No audio file found for: ${audioFileName}`);
        finalizeContent(false);  // Display without audio
    };
    audio.onloadedmetadata = () => {
        console.log(`Audio file found: ${audioFileName}`);
        finalizeContent(true);  // Display with audio
    };

    // Process story text into sentences
    const standardizedNorwegian = selectedStory.norwegian.replace(/[“”«»]/g, '"');
    const standardizedEnglish = selectedStory.english.replace(/[“”«»]/g, '"');
    const sentenceRegex = /(?:(["]?.+?[.!?…]["]?)(?=\s|$)|(?:\.\.\."))/g;

    let norwegianSentences = standardizedNorwegian.match(sentenceRegex) || [standardizedNorwegian];
    let englishSentences = standardizedEnglish.match(sentenceRegex) || [standardizedEnglish];

    const combineSentences = (sentences, combineIfContains) => {
        return sentences.reduce((acc, sentence) => {
            const trimmedSentence = sentence.trim();

            if (acc.length > 0 && /^[a-zæøå]/.test(trimmedSentence)) {
                acc[acc.length - 1] += ' ' + trimmedSentence;
            } else if (acc.length > 0 && combineIfContains && combineIfContains.test(trimmedSentence)) {
                acc[acc.length - 1] += ' ' + trimmedSentence;
            } else {
                acc.push(trimmedSentence);
            }
            return acc;
        }, []);
    };

    norwegianSentences = combineSentences(norwegianSentences);
    englishSentences = combineSentences(englishSentences, /\basked\b/i);
}


// Function to toggle the visibility of English sentences and update Norwegian box styles
function toggleEnglishSentences() {
    const englishSentenceDivs = document.querySelectorAll('.stories-sentence-box-english');
    const norwegianSentenceDivs = document.querySelectorAll('.stories-sentence-box-norwegian');

    englishSentenceDivs.forEach((div, index) => {
        if (div.style.display === 'none') {
            div.style.display = 'block';  // Show the English div
            norwegianSentenceDivs[index].style.borderRadius = '';  // Revert to default border-radius from CSS
            norwegianSentenceDivs[index].style.boxShadow = '';  // Add border-radius to Norwegian div
        } else {
            div.style.display = 'none';  // Hide the English div
            norwegianSentenceDivs[index].style.borderRadius = '12px';  // Add border-radius to Norwegian div
            norwegianSentenceDivs[index].style.boxShadow = '0 4px 10px rgba(0, 0, 0, 0.1)';  // Add border-radius to Norwegian div
        }
    });
}

function handleGenreChange() {
    const selectedGenre = document.getElementById('genre-select').value.trim().toLowerCase();
    const selectedCEFR = document.getElementById('cefr-select').value.toUpperCase();

    // Filter the stories based on both the selected genre and CEFR level
    const filteredStories = storyResults.filter(story => {
        const genreMatch = selectedGenre ? story.genre.trim().toLowerCase() === selectedGenre : true;
        const cefrMatch = selectedCEFR ? story.CEFR && story.CEFR.toUpperCase() === selectedCEFR : true;

        return genreMatch && cefrMatch;
    });

    // Call displayStoryList with the filtered stories
    displayStoryList(filteredStories);
}

// Helper function to remove the story header
function removeStoryHeader() {
    const searchContainer = document.getElementById('search-container'); // The container to update
    const storyHeader = document.querySelector('.stories-story-header');
    searchContainer.style.display = '';
    if (storyHeader) {
        storyHeader.remove();
    }
}

// Helper function to restore the inner
function restoreSearchContainerInner() {
    const searchContainerInner = document.getElementById('search-container-inner'); // The container to update
    searchContainerInner.style.display = '';
}

// Async function to check if audio file exists
async function hasAudio(titleNorwegian) {
    const audioFileName = `audio-${titleNorwegian}.m4a`;
    const audioFileURL = `${audioFileName}`;  // Adjust to the correct path

    try {
        const response = await fetch(audioFileURL, { method: 'HEAD', cache: 'no-cache' });
        return response.ok;  // true if the audio file exists, false if not
    } catch (error) {
        console.error(`Error checking audio file for ${titleNorwegian}:`, error);
        return false;
    }
}

// Initialization on page load
window.addEventListener('DOMContentLoaded', async () => {
    // Load the story data and wait for it to complete
    await fetchAndLoadStoryData();    
    // Now that the data is loaded, check the URL and display based on the URL parameters
    loadStateFromURL();
});