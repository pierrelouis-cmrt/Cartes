/**
 * Analytics tracking via Umami
 */

import { state } from '../state.js';

export const UMAMI_EVENTS = {
  cardFlip: 'Card flipped',
  nextButton: 'Next button',
  modeToggle: 'Mode toggle',
  randomToggle: 'Random toggle',
  favouritesToggle: 'Favourites toggle',
  filterGroup: 'Filter group',
};

/**
 * Track an event with Umami analytics
 * @param {string} name
 * @param {Object} [data]
 */
export function trackUmamiEvent(name, data) {
  if (!name) return;
  const context = {};
  if (state.chapter !== null && state.chapter !== undefined) {
    context.chapter = state.chapter;
  }
  const payload = Object.keys(context).length
    ? (data ? { ...context, ...data } : context)
    : data;
  if (window.umami && typeof window.umami.track === 'function') {
    if (payload) {
      window.umami.track(name, payload);
    } else {
      window.umami.track(name);
    }
  }
}
