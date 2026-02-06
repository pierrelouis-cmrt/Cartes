/**
 * Card navigation system
 */

import { state, getCurrentCard } from '../state.js';
import { MAX_HISTORY, FAST_NAV_THRESHOLD, FAST_NAV_WINDOW_MS } from '../config.js';
import { shuffleArray, asPositiveInt, nowMs } from '../utils/helpers.js';
import { loadFavourites, saveHistory, clearHistory, loadHistory } from '../core/storage.js';
import {
  showCurrent,
  updateNavButtons,
  updateShuffleUI,
  updateFavouritesUI,
} from '../ui/updates.js';

// ==================== Fast Navigation ====================

export function resetFastNavState() {
  state.navBurstCount = 0;
  state.navLastTime = 0;
  state.navFastMode = false;
  state.navQueue = [];
}

function recordFastNavBurst() {
  if (state.revisionMode) {
    resetFastNavState();
    return false;
  }

  const now = nowMs();
  if (now - state.navLastTime <= FAST_NAV_WINDOW_MS) {
    state.navBurstCount += 1;
  } else {
    state.navBurstCount = 1;
  }
  state.navLastTime = now;
  state.navFastMode = state.navBurstCount > FAST_NAV_THRESHOLD;
  return state.navFastMode;
}

function enqueueNavAction(type) {
  if (state.revisionMode) return;
  if (!Array.isArray(state.navQueue)) {
    state.navQueue = [];
  }
  state.navQueue.push(type);
}

export function processNavQueue() {
  if (state.revisionMode) {
    state.navQueue = [];
    return;
  }
  if (!Array.isArray(state.navQueue) || state.navQueue.length === 0) {
    return;
  }
  if (state.isTransitioning) {
    return;
  }
  const action = state.navQueue.shift();
  if (action === 'next') {
    nextCard({ queued: true });
  } else if (action === 'prev') {
    prevCard({ queued: true });
  }
}

// ==================== Shuffle Queue ====================

export function ensureShuffleQueue(currentCard) {
  if (!state.shuffle) return;

  if (!Array.isArray(state.shuffleQueue)) {
    state.shuffleQueue = [];
  }

  if (state.shuffleQueue.length === 0) {
    if (state.unvisited.size === 0) {
      state.unvisited = new Set(state.deck);
      if (currentCard) state.unvisited.delete(currentCard);
    }

    const pool = Array.from(state.unvisited);
    state.shuffleQueue = shuffleArray(pool);
  }
}

// ==================== Deck Management ====================

export function rebuildDeck(keepCardNo = null) {
  const { total, manifest } = state;
  let newDeck = null;

  if (manifest && manifest.per_card && typeof manifest.per_card === 'object') {
    const numbers = Array.from(
      new Set(
        Object.keys(manifest.per_card)
          .map((key) => asPositiveInt(key))
          .filter(Boolean)
      )
    ).sort((a, b) => a - b);
    if (numbers.length) {
      newDeck = numbers;
    }
  }

  if (!newDeck) {
    newDeck = Array.from({ length: total }, (_, i) => i + 1);
  } else if (total && newDeck.length < total) {
    const existing = new Set(newDeck);
    for (let i = 1; i <= total; i++) {
      if (!existing.has(i)) newDeck.push(i);
    }
  }

  if (manifest) {
    // Filter out purple cards
    const purple = new Set();
    if (manifest.per_card && typeof manifest.per_card === 'object') {
      for (const [k, v] of Object.entries(manifest.per_card)) {
        if (v && v.border === 'purple') purple.add(parseInt(k, 10));
      }
    } else if (manifest.cards_by_border && Array.isArray(manifest.cards_by_border.purple)) {
      manifest.cards_by_border.purple.forEach((n) => purple.add(parseInt(n, 10)));
    }
    if (purple.size) {
      newDeck = newDeck.filter((n) => !purple.has(n));
    }

    // Apply timer filter
    const tf = state.filterTimer;
    if (tf && tf !== 'all') {
      const allowedTimer = new Set();
      if (manifest.cards_by_timer && Array.isArray(manifest.cards_by_timer[tf])) {
        manifest.cards_by_timer[tf].forEach((n) => allowedTimer.add(parseInt(n, 10)));
      } else if (manifest.per_card && typeof manifest.per_card === 'object') {
        for (const [k, v] of Object.entries(manifest.per_card)) {
          if (v && v.timer === tf) allowedTimer.add(parseInt(k, 10));
        }
      }
      if (allowedTimer.size) {
        newDeck = newDeck.filter((n) => allowedTimer.has(n));
      } else {
        newDeck = [];
      }
    }

    // Apply difficulty filter
    const df = state.filterDifficulty;
    if (df && df !== 'all') {
      const allowedBorder = new Set();
      if (manifest.cards_by_border && Array.isArray(manifest.cards_by_border[df])) {
        manifest.cards_by_border[df].forEach((n) => allowedBorder.add(parseInt(n, 10)));
      } else if (manifest.per_card && typeof manifest.per_card === 'object') {
        for (const [k, v] of Object.entries(manifest.per_card)) {
          if (v && v.border === df) allowedBorder.add(parseInt(k, 10));
        }
      }
      if (allowedBorder.size) {
        newDeck = newDeck.filter((n) => allowedBorder.has(n));
      } else {
        newDeck = [];
      }
    }
  }

  // Apply favourites filter if active
  if (state.showFavouritesOnly) {
    const favourites = loadFavourites();
    newDeck = newDeck.filter((n) => favourites.has(n));
  }

  // Sort the deck deterministically
  newDeck.sort((a, b) => a - b);

  state.deck = newDeck;

  // Reset position based on mode
  if (state.shuffle) {
    if (keepCardNo !== null && newDeck.includes(keepCardNo)) {
      if (!state.history.includes(keepCardNo)) {
        state.history = [keepCardNo];
      }
      state.historyIndex = state.history.indexOf(keepCardNo);
      if (state.historyIndex < 0) state.historyIndex = 0;
    } else {
      state.history = state.history.filter((card) => newDeck.includes(card));
      if (state.history.length === 0 && newDeck.length > 0) {
        const randomIdx = Math.floor(Math.random() * newDeck.length);
        state.history = [newDeck[randomIdx]];
        state.historyIndex = 0;
      } else {
        state.historyIndex = Math.min(state.historyIndex, state.history.length - 1);
      }
    }
    state.unvisited = new Set(newDeck);
    state.history.forEach((card) => state.unvisited.delete(card));
    state.shuffleQueue = [];
  } else {
    if (keepCardNo !== null && newDeck.includes(keepCardNo)) {
      state.currentIndex = newDeck.indexOf(keepCardNo);
    } else {
      state.currentIndex = 0;
    }
  }
}

// ==================== Navigation ====================

export function nextCard(options = {}) {
  const { queued = false } = options;
  if (!state.deck.length) return;

  if (!queued && !state.revisionMode) {
    recordFastNavBurst();
  }

  if (state.isTransitioning) {
    if (!state.revisionMode && !queued) {
      enqueueNavAction('next');
    }
    return;
  }

  const instantNav = !state.revisionMode && state.navFastMode;
  const showOptions = instantNav ? { instant: true } : undefined;

  if (state.shuffle) {
    // Check if we're navigating forward in history
    if (state.historyIndex < state.history.length - 1) {
      state.historyIndex++;
      saveHistory();
      showCurrent('next', showOptions);
      return;
    }

    // We're at the end of history, need to add a new card
    const current = getCurrentCard();
    let nextCardNo = null;

    ensureShuffleQueue(current);

    if (state.shuffleQueue.length > 0) {
      nextCardNo = state.shuffleQueue.pop();
    } else if (state.deck.length > 0) {
      nextCardNo = state.deck[0];
    }

    if (nextCardNo !== null) {
      state.history.push(nextCardNo);
      if (state.history.length > MAX_HISTORY) {
        state.history.shift();
        state.historyIndex = MAX_HISTORY - 1;
      } else {
        state.historyIndex++;
      }

      state.unvisited.delete(nextCardNo);
      ensureShuffleQueue(nextCardNo);

      saveHistory();
      showCurrent('next', showOptions);
    }
  } else {
    state.currentIndex = (state.currentIndex + 1) % state.deck.length;
    showCurrent('next', showOptions);
  }
}

export function prevCard(options = {}) {
  const { queued = false } = options;
  if (!state.deck.length) return;

  const canNavigate = state.shuffle ? state.historyIndex > 0 : true;
  if (!canNavigate) return;

  if (!queued && !state.revisionMode) {
    recordFastNavBurst();
  }

  if (state.isTransitioning) {
    if (!state.revisionMode && !queued) {
      enqueueNavAction('prev');
    }
    return;
  }

  const instantNav = !state.revisionMode && state.navFastMode;
  const showOptions = instantNav ? { instant: true } : undefined;

  if (state.shuffle) {
    state.historyIndex--;
    showCurrent('prev', showOptions);
  } else {
    state.currentIndex = (state.currentIndex - 1 + state.deck.length) % state.deck.length;
    showCurrent('prev', showOptions);
  }
}

// ==================== Toggle Functions ====================

export function toggleShuffle() {
  if (state.showFavouritesOnly && !state.shuffle) {
    return;
  }
  const currentCardBeforeToggle = getCurrentCard();
  state.shuffle = !state.shuffle;
  localStorage.setItem('fc_shuffle', JSON.stringify(state.shuffle));

  if (state.shuffle) {
    const currentCard = currentCardBeforeToggle;
    const savedHistory = loadHistory();
    if (savedHistory.length > 0 && savedHistory[savedHistory.length - 1] === currentCard) {
      state.history = savedHistory;
      state.historyIndex = savedHistory.length - 1;
    } else {
      state.history = currentCard ? [currentCard] : [];
      state.historyIndex = currentCard ? 0 : -1;
    }

    state.unvisited = new Set(state.deck);
    state.history.forEach((card) => state.unvisited.delete(card));
    state.shuffleQueue = [];

    saveHistory();
  } else {
    clearHistory();
    const currentCard = currentCardBeforeToggle;
    if (currentCard) {
      state.currentIndex = state.deck.indexOf(currentCard);
      if (state.currentIndex === -1) state.currentIndex = 0;
    }
    state.shuffleQueue = [];
  }

  ensureShuffleQueue(getCurrentCard());
  updateShuffleUI();
  showCurrent();
}

export async function toggleFavouritesOnly() {
  if (state.isTransitioning) return;

  const entering = !state.showFavouritesOnly;
  if (entering) {
    state.lastCardBeforeFavourites = getCurrentCard();
    state.wasShuffleBeforeFavourites = state.shuffle;
  }

  state.showFavouritesOnly = !state.showFavouritesOnly;
  let keep;

  if (state.showFavouritesOnly) {
    keep = getCurrentCard();
    if (state.shuffle) {
      toggleShuffle();
      keep = getCurrentCard();
    }
  } else {
    keep = state.lastCardBeforeFavourites;
    if (state.wasShuffleBeforeFavourites && !state.shuffle) {
      state.shuffle = true;
      localStorage.setItem('fc_shuffle', 'true');
    }
  }

  rebuildDeck(keep);
  updateFavouritesUI();
  updateShuffleUI();

  if (!state.deck.length) {
    const { qs } = await import('../utils/helpers.js');
    const { hideSkeleton } = await import('../ui/updates.js');
    qs('#counter').textContent = 'Aucun favori disponible.';
    hideSkeleton();
    updateNavButtons();
    return;
  }
  showCurrent();
}
