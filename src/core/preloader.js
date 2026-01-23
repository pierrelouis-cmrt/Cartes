/**
 * Preloading system for nearby cards
 */

import { state } from '../state.js';
import { PRELOAD_RADIUS } from '../config.js';
import { loadFrontImage, loadBackImage } from './image-loader.js';

/**
 * Queue a card for preloading
 * @param {number} cardNo
 */
export function queuePreload(cardNo) {
  if (!cardNo) return;
  if (state.imagesLoaded.has(cardNo)) return;
  if (state.preloading.has(cardNo)) return;

  const startLoad = () => {
    const frontPromise = loadFrontImage(cardNo).then((front) => {
      if (front && front.ok && front.width && front.height) {
        state.sizes[cardNo] = { w: front.width, h: front.height };
      }
    });
    const backPromise = loadBackImage(cardNo);
    Promise.all([frontPromise, backPromise])
      .catch(() => {})
      .finally(() => {
        state.preloading.delete(cardNo);
      });
  };

  state.preloading.add(cardNo);

  if ('requestIdleCallback' in window) {
    requestIdleCallback(
      () => {
        startLoad();
      },
      { timeout: 1500 }
    );
  } else {
    setTimeout(() => {
      startLoad();
    }, 120);
  }
}

/**
 * Preload cards near the current position
 */
export function preloadNearbyCards() {
  if (state.shuffle) {
    // In shuffle mode, preload a few random unvisited cards
    const unvisitedArray = Array.from(state.unvisited);
    const toPreload = Math.min(PRELOAD_RADIUS, unvisitedArray.length);
    for (let i = 0; i < toPreload; i++) {
      const randomIdx = Math.floor(Math.random() * unvisitedArray.length);
      queuePreload(unvisitedArray[randomIdx]);
    }

    // Also preload cards in history near current position
    for (let offset = 1; offset <= PRELOAD_RADIUS; offset++) {
      if (state.historyIndex - offset >= 0) {
        queuePreload(state.history[state.historyIndex - offset]);
      }
      if (state.historyIndex + offset < state.history.length) {
        queuePreload(state.history[state.historyIndex + offset]);
      }
    }
  } else {
    // In sequential mode, preload next and previous cards
    for (let offset = 1; offset <= PRELOAD_RADIUS; offset++) {
      const nextIdx = (state.currentIndex + offset) % state.deck.length;
      const prevIdx = (state.currentIndex - offset + state.deck.length) % state.deck.length;
      if (state.deck[nextIdx]) queuePreload(state.deck[nextIdx]);
      if (state.deck[prevIdx]) queuePreload(state.deck[prevIdx]);
    }
  }
}
