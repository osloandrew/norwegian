let storyResults = [];  // Global variable to store the stories

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
                entry.title = entry.title.trim();  // Ensure the title is trimmed
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
    clearContainer();  // Clear previous results

    let htmlString = `
        <div class="result-header">
            <h2>Available Stories</h2>
        </div>
    `;

    // Loop through either the filtered stories or all stories if no filter is applied
    filteredStories.forEach(story => {
        const cefrClass = getCefrClass(story.CEFR);  // Determine the CEFR class for styling

        htmlString += `
            <div class="stories-list-item" data-title="${story.title}" onclick="displayStory('${story.title}')">
                <div class="stories-content">
                    <h2>${story.title}</h2>
                    <p class="stories-genre">${story.genre}</p>
                </div>
                <div class="game-cefr-label ${cefrClass}">${story.CEFR}</div>
            </div>
        `;
    });

    document.getElementById('results-container').innerHTML = htmlString;
}


function displayStory(title) {
    const selectedStory = storyResults.find(story => story.title === title);

    if (!selectedStory) {
        console.error(`No story found with the title: ${title}`);
        return;
    }

    clearContainer();  // Clear the list of stories

    // Improved regex to handle sentence splitting, ignoring quotes and ensuring no sentence starts with lowercase letters
    const sentenceRegex = /(?:(["“”]?.+?[.!?]["“”]?)(?=\s|$))/g;

    // Apply the regex to split Norwegian and English stories into sentences
    let norwegianSentences = selectedStory.norwegian.match(sentenceRegex) || [selectedStory.norwegian];
    let englishSentences = selectedStory.english.match(sentenceRegex) || [selectedStory.english];

    // Function to combine sentences if they start with a lowercase letter
    const combineSentences = (sentences) => {
        return sentences.reduce((acc, sentence) => {
            // If sentence starts with a lowercase letter, append it to the previous sentence
            if (acc.length > 0 && /^[a-zæøå]/.test(sentence.trim())) {
                acc[acc.length - 1] += ' ' + sentence.trim();
            } else {
                acc.push(sentence.trim());
            }
            return acc;
        }, []);
    };

    // Combine Norwegian and English sentences properly
    norwegianSentences = combineSentences(norwegianSentences);
    englishSentences = combineSentences(englishSentences);

    // Log the results of the splits for debugging
    console.log('Norwegian Sentences:', norwegianSentences);
    console.log('English Sentences:', englishSentences);

    let htmlString = `
    <div class="result-header">
        <i class="fas fa-chevron-left" style="cursor: pointer;" onclick="displayStoryList()"></i> <!-- Left arrow -->
        <h2>${selectedStory.title}</h2>
    </div>
    `;

    // Add the sentences in two columns: Norwegian on the left and English on the right
    htmlString += `<div class="stories-sentences-container">`;

    // Loop through both the Norwegian and English sentences
    for (let i = 0; i < norwegianSentences.length; i++) {
        const norwegianSentence = norwegianSentences[i].trim();
        const englishSentence = englishSentences[i] ? englishSentences[i].trim() : '';

        htmlString += `
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

    htmlString += `</div>`;

    document.getElementById('results-container').innerHTML = htmlString;
}

function handleGenreChange() {
    const selectedGenre = document.getElementById('genre-select').value.trim().toLowerCase();

    // Filter the stories based on the selected genre
    const filteredStories = selectedGenre 
        ? storyResults.filter(story => story.genre.trim().toLowerCase() === selectedGenre)
        : storyResults;  // If no genre is selected, show all stories

    // Call displayStoryList with the filtered stories
    displayStoryList(filteredStories);
}
