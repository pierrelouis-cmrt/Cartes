/**
 * Analytics tracking via Umami
 */

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
  if (window.umami && typeof window.umami.track === 'function') {
    if (data) {
      window.umami.track(name, data);
    } else {
      window.umami.track(name);
    }
  }
}
