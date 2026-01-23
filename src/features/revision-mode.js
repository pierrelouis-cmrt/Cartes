/**
 * Revision mode (spaced repetition)
 */

import { state, getCurrentCard, getCurrentRevisionDeck } from '../state.js';
import { MAX_HISTORY } from '../config.js';
import { qs } from '../utils/helpers.js';
import { shuffleArray } from '../utils/helpers.js';
import {
  saveRevisionProgress,
  loadRevisionProgress,
  clearRevisionProgress,
  saveHistory,
} from '../core/storage.js';
import { rebuildDeck, resetFastNavState } from './navigation.js';
import {
  showCurrent,
  updateRevisionUI,
  updateShuffleUI,
  updateFavouritesUI,
  updateCounter,
  setModalVisibility,
} from '../ui/updates.js';

/**
 * Reset revision progress to initial state
 */
export function resetRevisionProgress() {
  state.revisionRound = 1;
  state.revisionIncorrect = new Set();
  state.revisionSeen = new Set();
  state.revisionMastered = new Set();
  clearRevisionProgress();
}

/**
 * Reset shuffle state for revision mode
 * @param {number|null} preferredCard
 */
export function resetShuffleForRevision(preferredCard = null) {
  const currentDeck = getCurrentRevisionDeck();
  state.unvisited = new Set(currentDeck);
  state.history = [];
  state.historyIndex = -1;

  if (!currentDeck.length) {
    state.shuffleQueue = [];
    return;
  }

  let firstCard = preferredCard;
  if (firstCard === null || firstCard === undefined || !state.unvisited.has(firstCard)) {
    const randomIdx = Math.floor(Math.random() * currentDeck.length);
    firstCard = currentDeck[randomIdx];
  }

  state.history = [firstCard];
  state.historyIndex = 0;
  state.unvisited.delete(firstCard);

  state.shuffleQueue = shuffleArray(Array.from(state.unvisited));
  saveHistory();
}

/**
 * Check if the current round is complete
 * @returns {boolean}
 */
export function checkRoundComplete() {
  const currentDeck = getCurrentRevisionDeck();
  return state.revisionSeen.size >= currentDeck.length;
}

/**
 * Start a new revision round with incorrect cards
 */
export function startNewRevisionRound() {
  state.revisionRound++;
  state.revisionSeen = new Set();

  if (state.revisionIncorrect.size > 0) {
    state.deck = Array.from(state.revisionIncorrect);
  }

  saveRevisionProgress();
  resetShuffleForRevision();

  showCurrent();
  updateRevisionUI();
  updateCounter();
}

/**
 * Handle round completion
 */
export function handleRoundComplete() {
  if (state.revisionIncorrect.size === 0) {
    showRevisionComplete();
  } else {
    startNewRevisionRound();
  }
}

/**
 * Show the revision complete modal
 */
export function showRevisionComplete() {
  const modal = qs('#revisionCompleteModal');
  if (modal) {
    const roundsEl = qs('#revisionRounds');
    const pluralEl = qs('#revisionRoundsPlural');
    const pluralCompleteEl = qs('#revisionRoundsPlural2');
    if (roundsEl) roundsEl.textContent = state.revisionRound.toString();
    if (pluralEl) {
      pluralEl.textContent = state.revisionRound > 1 ? 's' : '';
    }
    if (pluralCompleteEl) {
      pluralCompleteEl.textContent = state.revisionRound > 1 ? 's' : '';
    }
    setModalVisibility(modal, true);
  }
}

/**
 * Navigate to the next unseen card in revision mode
 */
export function nextRevisionCard() {
  if (!state.deck.length) return;

  const unseenCards = state.deck.filter((card) => !state.revisionSeen.has(card));

  if (unseenCards.length === 0) {
    handleRoundComplete();
    return;
  }

  const randomIndex = Math.floor(Math.random() * unseenCards.length);
  const nextCardNo = unseenCards[randomIndex];

  state.history.push(nextCardNo);
  if (state.history.length > MAX_HISTORY) {
    state.history.shift();
    state.historyIndex = MAX_HISTORY - 1;
  } else {
    state.historyIndex++;
  }

  state.unvisited.delete(nextCardNo);
  saveHistory();

  showCurrentWithScaleIn();
  updateCounter();
}

/**
 * Show current card with scale-in animation
 */
export async function showCurrentWithScaleIn() {
  const cardShell = qs('#cardShell');
  if (!cardShell) {
    showCurrent();
    return;
  }

  // Import swipeGesture to reset transforms
  const { swipeGesture } = await import('./swipe.js');
  swipeGesture.resetCardTransform();

  cardShell.style.transition = 'none';
  cardShell.style.transform = '';
  cardShell.style.opacity = '0';
  cardShell.style.visibility = 'hidden';

  void cardShell.offsetWidth;

  await showCurrent('none', { keepHidden: true });

  cardShell.classList.add('scaling-in');
  cardShell.style.visibility = '';
  cardShell.style.opacity = '';

  setTimeout(() => {
    cardShell.classList.remove('scaling-in');
    cardShell.style.transition = '';
  }, 300);
}

/**
 * Swipe the current card away with animation
 * @param {string} direction
 * @param {Function} callback
 */
export async function swipeCard(direction, callback) {
  const cardShell = qs('#cardShell');
  if (!cardShell) return;

  state.isTransitioning = true;

  const { swipeGesture } = await import('./swipe.js');
  swipeGesture.resetCardTransform();
  cardShell.style.transform = '';

  void cardShell.offsetWidth;

  const animationClass = direction === 'right' ? 'swiping-right' : 'swiping-left';
  cardShell.classList.add(animationClass);

  setTimeout(() => {
    cardShell.style.transition = 'none';
    cardShell.style.opacity = '0';
    cardShell.style.visibility = 'hidden';

    void cardShell.offsetWidth;

    cardShell.classList.remove(animationClass);
    cardShell.style.transform = '';
    state.isTransitioning = false;

    if (callback) callback();
  }, 300);
}

/**
 * Mark current card as OK (mastered)
 */
export function markCardOK() {
  const currentCard = getCurrentCard();
  if (!currentCard) return;

  state.revisionIncorrect.delete(currentCard);
  state.revisionMastered.add(currentCard);
  state.revisionSeen.add(currentCard);

  saveRevisionProgress();

  if (checkRoundComplete()) {
    swipeCard('right', () => handleRoundComplete());
  } else {
    swipeCard('right', () => nextRevisionCard());
  }
}

/**
 * Mark current card as not OK (needs review)
 */
export function markCardPasOK() {
  const currentCard = getCurrentCard();
  if (!currentCard) return;

  state.revisionIncorrect.add(currentCard);
  state.revisionSeen.add(currentCard);
  state.revisionMastered.delete(currentCard);

  saveRevisionProgress();

  if (checkRoundComplete()) {
    swipeCard('left', () => handleRoundComplete());
  } else {
    swipeCard('left', () => nextRevisionCard());
  }
}

/**
 * Restart the revision session
 */
export function restartRevisionSession() {
  if (!state.revisionMode) return;

  resetRevisionProgress();
  rebuildDeck();

  if (!state.deck.length) {
    updateCounter();
    return;
  }

  if (!state.shuffle) {
    state.shuffle = true;
    localStorage.setItem('fc_shuffle', 'true');
  }

  resetShuffleForRevision();
  showCurrent();
  updateRevisionUI();
  updateCounter();
}

/**
 * Toggle revision mode on/off
 */
export function toggleRevisionMode() {
  const previousCard = getCurrentCard();
  state.revisionMode = !state.revisionMode;
  localStorage.setItem('fc_revision_mode', JSON.stringify(state.revisionMode));
  resetFastNavState();

  document.body.classList.toggle('mode-revision', state.revisionMode);

  if (state.revisionMode) {
    const progress = loadRevisionProgress();
    if (progress) {
      state.revisionRound = progress.round;
      state.revisionIncorrect = progress.incorrect;
      state.revisionSeen = progress.seen;
      state.revisionMastered = progress.mastered;

      if (state.revisionRound > 1 && state.revisionIncorrect.size > 0) {
        state.deck = Array.from(state.revisionIncorrect);
      }
    } else {
      resetRevisionProgress();
    }

    if (!state.shuffle) {
      state.shuffle = true;
      localStorage.setItem('fc_shuffle', 'true');
    }
    resetShuffleForRevision(previousCard);

    if (state.showFavouritesOnly) {
      state.showFavouritesOnly = false;
    }
  } else {
    const keep = getCurrentCard();
    rebuildDeck(keep);
  }

  updateRevisionUI();
  updateShuffleUI();
  updateFavouritesUI();
  updateCounter();
  showCurrent();
}
