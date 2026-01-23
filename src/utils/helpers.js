/**
 * Utility helper functions
 */

/**
 * Query selector shorthand
 * @param {string} selector
 * @param {Element|Document} el
 * @returns {Element|null}
 */
export const qs = (selector, el = document) => el.querySelector(selector);

/**
 * Shuffle an array in place (Fisher-Yates)
 * @param {Array} arr
 * @returns {Array}
 */
export function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Create a shuffled copy of an array
 * @param {Array} items
 * @returns {Array}
 */
export function shuffleArray(items) {
  const arr = items.slice();
  return shuffleInPlace(arr);
}

/**
 * Parse value as positive integer or return null
 * @param {any} value
 * @returns {number|null}
 */
export function asPositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Get current time in milliseconds
 * @returns {number}
 */
export function nowMs() {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now();
  }
  return Date.now();
}

/**
 * Wait for animation to end on an element
 * @param {Element} el
 * @param {string} name
 * @param {number} fallback
 * @returns {Promise<void>}
 */
export function waitAnimationEnd(el, name, fallback = 600) {
  return new Promise((resolve) => {
    let done = false;
    const onEnd = (e) => {
      if (e.animationName === name) {
        done = true;
        el.removeEventListener('animationend', onEnd);
        resolve();
      }
    };
    el.addEventListener('animationend', onEnd);
    setTimeout(() => {
      if (!done) {
        el.removeEventListener('animationend', onEnd);
        resolve();
      }
    }, fallback);
  });
}

/**
 * Create a promise that resolves after ms milliseconds
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
