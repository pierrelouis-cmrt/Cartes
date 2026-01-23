/**
 * LocalStorage helpers for persisting app state
 */

import { state } from '../state.js';
import { LAST_CARD_KEY_PREFIX, MAX_HISTORY } from '../config.js';

// ==================== Favourites ====================

export function getFavouritesKey() {
  return `fc_favourites_ch${state.chapter}`;
}

export function loadFavourites() {
  const key = getFavouritesKey();
  const stored = localStorage.getItem(key);
  return stored ? new Set(JSON.parse(stored)) : new Set();
}

export function saveFavourites(favourites) {
  const key = getFavouritesKey();
  localStorage.setItem(key, JSON.stringify(Array.from(favourites)));
}

export function toggleFavourite(cardNo) {
  const favourites = loadFavourites();
  if (favourites.has(cardNo)) {
    favourites.delete(cardNo);
  } else {
    favourites.add(cardNo);
  }
  saveFavourites(favourites);
  return favourites.has(cardNo);
}

// ==================== History ====================

export function getHistoryKey() {
  return `fc_history_ch${state.chapter}`;
}

export function saveHistory() {
  if (!state.shuffle || !state.chapter) return;
  const key = getHistoryKey();
  const toSave = state.history.slice(-MAX_HISTORY);
  localStorage.setItem(key, JSON.stringify(toSave));
}

export function loadHistory() {
  if (!state.chapter) return [];
  const key = getHistoryKey();
  const stored = localStorage.getItem(key);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return parsed.filter((card) => state.deck.includes(card)).slice(-MAX_HISTORY);
    }
  } catch {
    // Ignore parsing errors
  }
  return [];
}

export function clearHistory() {
  if (!state.chapter) return;
  const key = getHistoryKey();
  localStorage.removeItem(key);
}

// ==================== Revision Progress ====================

export function getRevisionKey() {
  return `fc_revision_ch${state.chapter}`;
}

export function saveRevisionProgress() {
  if (!state.chapter || !state.revisionMode) return;
  const key = getRevisionKey();
  const data = {
    round: state.revisionRound,
    incorrect: Array.from(state.revisionIncorrect),
    seen: Array.from(state.revisionSeen),
    mastered: Array.from(state.revisionMastered),
  };
  localStorage.setItem(key, JSON.stringify(data));
}

export function loadRevisionProgress() {
  if (!state.chapter) return null;
  const key = getRevisionKey();
  const stored = localStorage.getItem(key);
  if (!stored) return null;
  try {
    const data = JSON.parse(stored);
    return {
      round: data.round || 1,
      incorrect: new Set(data.incorrect || []),
      seen: new Set(data.seen || []),
      mastered: new Set(data.mastered || []),
    };
  } catch (_) {
    return null;
  }
}

export function clearRevisionProgress() {
  if (!state.chapter) return;
  const key = getRevisionKey();
  localStorage.removeItem(key);
}

// ==================== Last Card ====================

export function getStoredCard(chapter) {
  if (!chapter) return null;
  const raw = localStorage.getItem(`${LAST_CARD_KEY_PREFIX}${chapter}`);
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function storeCurrentCard(cardNo) {
  if (!state.chapter || !cardNo) return;
  try {
    localStorage.setItem(`${LAST_CARD_KEY_PREFIX}${state.chapter}`, String(cardNo));
  } catch {
    // Ignore parsing errors
  }
}
