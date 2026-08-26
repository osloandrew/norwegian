// Single-letter dictionary headwords — the alphabet's own letter-name
// entries (e.g. "å" glossed as "the letter and sound å") — kept out of the
// word game's and the random-word feature's random picks, since quizzing
// "what does the letter b mean" isn't a useful vocabulary question.
//
// Deliberately separate from noRandom.js: several of these letters (most
// notably "å", the infinitive marker/interjection/"stream") are also
// legitimate, extremely common real words under the same spelling. A story
// hint popover needs those senses, so stories.js must NOT filter against
// this list — only scripts.js/wordGame.js's random-selection paths should.
const noRandomLetters = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "æ",
  "ø",
  "å",
];
