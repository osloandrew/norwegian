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

// Function to load the stories CSV file
async function fetchAndLoadStoryData() {
    try {
        console.log('Attempting to load stories from norwegianStories.csv...');
        const response = await fetch('norwegianStories.csv');
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.text();
        parseStoryCSVData(data);  // Parse the CSV data
    } catch (error) {
        console.error('Error fetching or parsing stories CSV file:', error);
    }
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

function displayStoryList(filteredStories = storyResults) {
    restoreSearchContainerInner();
    removeStoryHeader();
    clearContainer();  // Clear previous results

    let htmlString = `
        <div class="result-header">
            <h2>Available Stories</h2>
        </div>
    `;

    // Loop through either the filtered stories or all stories if no filter is applied
    filteredStories.forEach(story => {
        const cefrClass = getCefrClass(story.CEFR);  // Determine the CEFR class for styling
        const genreIcon = genreIcons[story.genre.toLowerCase()] || '';  // Get the appropriate genre icon, default to empty if not found

        htmlString += `
            <div class="stories-list-item" data-title="${story.titleNorwegian}" onclick="displayStory('${story.titleNorwegian}')">
                <div class="stories-content">
                    <h2>${story.titleNorwegian}</h2>
                    <p class="stories-subtitle">${story.titleEnglish}</p>
                </div>
                <div class="stories-detail-container"> <!-- Flex container for genre and CEFR -->
                    <div class="stories-genre">${genreIcon}</div>  <!-- Genre icon -->
                    <div class="game-cefr-label ${cefrClass}">${story.CEFR}</div>  <!-- CEFR label on the right -->
                </div>
            </div>
        `;
    });

    document.getElementById('results-container').innerHTML = htmlString;
}


function displayStory(titleNorwegian) {

    const searchContainerInner = document.getElementById('search-container-inner'); // The container to update
    const selectedStory = storyResults.find(story => story.titleNorwegian === titleNorwegian);

    if (!selectedStory) {
        console.error(`No story found with the title: ${titleNorwegian}`);
        return;
    }

    clearContainer();  // Clear the list of stories

    // Create the header HTML
    const headerHTML = `
    <div class="stories-story-header">
        <div class="stories-back-btn">
            <i class="fas fa-chevron-left" onclick="displayStoryList()"></i>
        </div>
        <div class="stories-title-container">
            <h2>${selectedStory.titleNorwegian}</h2>
            <p class="stories-subtitle">${selectedStory.titleEnglish}</p>
        </div>
        <div class="stories-english-btn">
            <i class="fas fa-comment-alt" onclick="toggleEnglishSentences()"></i>
        </div>
    </div>
    `;
    
    // Insert the header HTML at the end of the search-container's current content
    searchContainerInner.style.display = 'none';
    document.getElementById('search-container').insertAdjacentHTML('beforeend', headerHTML);

    // Improved regex to handle sentence splitting, ignoring quotes and ensuring no sentence starts with lowercase letters
    const sentenceRegex = /(?:(["“”]?.+?[.!?]["“”]?)(?=\s|$))/g;

    let norwegianSentences = selectedStory.norwegian.match(sentenceRegex) || [selectedStory.norwegian];
    let englishSentences = selectedStory.english.match(sentenceRegex) || [selectedStory.english];

    const combineSentences = (sentences) => {
        return sentences.reduce((acc, sentence) => {
            if (acc.length > 0 && /^[a-zæøå]/.test(sentence.trim())) {
                acc[acc.length - 1] += ' ' + sentence.trim();
            } else {
                acc.push(sentence.trim());
            }
            return acc;
        }, []);
    };

    norwegianSentences = combineSentences(norwegianSentences);
    englishSentences = combineSentences(englishSentences);

    let contentHTML = `<div class="stories-sentences-container">`;

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
}


// Function to toggle the visibility of English sentences and update Norwegian box styles
function toggleEnglishSentences() {
    const englishSentenceDivs = document.querySelectorAll('.stories-sentence-box-english');
    const norwegianSentenceDivs = document.querySelectorAll('.stories-sentence-box-norwegian');

    englishSentenceDivs.forEach((div, index) => {
        if (div.style.display === 'none') {
            div.style.display = 'block';  // Show the English div
            norwegianSentenceDivs[index].style.borderRadius = '';  // Revert to default border-radius from CSS
        } else {
            div.style.display = 'none';  // Hide the English div
            norwegianSentenceDivs[index].style.borderRadius = '12px';  // Add border-radius to Norwegian div
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
    const storyHeader = document.querySelector('.stories-story-header');
    if (storyHeader) {
        storyHeader.remove();
    }
}

// Helper function to restore the inner
function restoreSearchContainerInner() {
    const searchContainerInner = document.getElementById('search-container-inner'); // The container to update
    searchContainerInner.style.display = '';
}

