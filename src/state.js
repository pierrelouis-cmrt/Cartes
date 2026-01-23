/**
 * Application state management
 */

/**
 * Global application state
 */
export const state = {
  total: 0,
  deck: [],
  history: [],
  historyIndex: -1,
  currentIndex: 0,
  unvisited: new Set(),
  flipped: false,
  shuffle: JSON.parse(localStorage.getItem('fc_shuffle') || 'false'),
  showFavouritesOnly: false,
  chapter: null,
  basePath: '',
  assetVersion: null,
  sizes: {},
  isTransitioning: false,
  imagesLoaded: new Set(),
  preloading: new Set(),
  manifest: null,
  filterTimer: 'all',
  filterDifficulty: 'all',
  formats: null,
  shuffleQueue: [],
  navBurstCount: 0,
  navLastTime: 0,
  navFastMode: false,
  navQueue: [],
  lastCardBeforeFavourites: null,
  wasShuffleBeforeFavourites: false,
  // Revision mode state
  revisionMode: JSON.parse(localStorage.getItem('fc_revision_mode') || 'false'),
  revisionIncorrect: new Set(),
  revisionSeen: new Set(),
  revisionRound: 1,
  revisionMastered: new Set(),
};

/**
 * Get the currently displayed card number
 * @returns {number|null}
 */
export function getCurrentCard() {
  if (state.shuffle) {
    if (state.history.length === 0) return null;
    if (state.historyIndex < 0 || state.historyIndex >= state.history.length) return null;
    return state.history[state.historyIndex];
  } else {
    if (state.deck.length === 0) return null;
    if (state.currentIndex < 0 || state.currentIndex >= state.deck.length) return null;
    return state.deck[state.currentIndex];
  }
}

/**
 * Get the current revision deck
 * @returns {Array<number>}
 */
export function getCurrentRevisionDeck() {
  return state.deck.slice();
}
