/**
 * Chapter management and discovery
 */

import { state } from '../state.js';
import {
  CHAPTERS_MANUAL,
  CHAPTER_PREFIX,
  CHAPTER_SUFFIX,
  MAX_CHAPTERS_PROBE,
  MAX_PROBE,
} from '../config.js';
import {
  fetchManifest,
  loadFrontImage,
  loadBackImage,
  registerAssetVersion,
  cacheFormatsForBase,
  getFormatsForBase,
} from '../core/image-loader.js';
import { getStoredCard, loadHistory, loadRevisionProgress } from '../core/storage.js';
import { asPositiveInt } from '../utils/helpers.js';
import { rebuildDeck } from './navigation.js';
import { showCurrent, showSkeleton, hideSkeleton } from '../ui/updates.js';
import { updateNavButtons } from '../ui/updates.js';
import { resetRevisionProgress } from './revision-mode.js';
import { resetFastNavState, ensureShuffleQueue } from './navigation.js';

/**
 * Discover available chapters
 * @returns {Promise<number[]>}
 */
export async function discoverChapters() {
  if (CHAPTERS_MANUAL.length) return CHAPTERS_MANUAL.slice();
  const found = [];

  const batchSize = 5;
  for (let start = 1; start <= MAX_CHAPTERS_PROBE; start += batchSize) {
    const batch = [];
    for (let n = start; n < Math.min(start + batchSize, MAX_CHAPTERS_PROBE + 1); n++) {
      const basePath = `flashcards/${CHAPTER_PREFIX}${n}${CHAPTER_SUFFIX}`;
      batch.push(
        (async () => {
          const manifest = await fetchManifest(basePath).catch(() => null);
          if (manifest) return n;
          const probe = await loadFrontImage(1, { basePath });
          return probe.ok ? n : null;
        })()
      );
    }
    const results = await Promise.all(batch);
    const validChapters = results.filter((n) => n !== null);
    found.push(...validChapters);

    if (validChapters.length < batch.length) break;
  }

  return found;
}

/**
 * Apply chapter settings to state
 * @param {number} n
 */
export function applyChapter(n) {
  state.chapter = n;
  state.basePath = `flashcards/${CHAPTER_PREFIX}${n}${CHAPTER_SUFFIX}`;
  state.formats = getFormatsForBase(state.basePath) || null;
  state.assetVersion = null;
}

/**
 * Load and apply manifest metadata
 * @param {Object} manifest
 * @returns {{total: number, hasSizes: boolean, defaultSize: Object|null}}
 */
export function applyManifestMetadata(manifest) {
  const info = { total: 0, hasSizes: false, defaultSize: null };
  if (!manifest || typeof manifest !== 'object') return info;

  if (Number.isFinite(manifest.total_cards)) {
    info.total = Number(manifest.total_cards);
  }

  const formats = cacheFormatsForBase(state.basePath, manifest);
  if (formats) {
    state.formats = formats;
  }

  let maxCard = info.total;
  let perCardSizeFound = false;

  if (manifest.per_card && typeof manifest.per_card === 'object') {
    for (const [key, value] of Object.entries(manifest.per_card)) {
      const cardNo = asPositiveInt(key);
      if (!cardNo) continue;
      if (cardNo > maxCard) maxCard = cardNo;
      if (value && typeof value === 'object') {
        let width = null;
        let height = null;
        if (value.front && typeof value.front === 'object') {
          width = asPositiveInt(value.front.width);
          height = asPositiveInt(value.front.height);
        }
        if (!width || !height) {
          width = asPositiveInt(value.width);
          height = asPositiveInt(value.height);
        }
        if (width && height) {
          state.sizes[cardNo] = { w: width, h: height };
          perCardSizeFound = true;
        }
      }
    }
  }

  if (maxCard > info.total) info.total = maxCard;
  info.hasSizes = perCardSizeFound;

  const dims = manifest.card_dimensions;
  if (dims && typeof dims === 'object') {
    const frontDims = dims.front && typeof dims.front === 'object' ? dims.front : dims;
    const width = asPositiveInt(frontDims.width);
    const height = asPositiveInt(frontDims.height);
    if (width && height) {
      info.defaultSize = { w: width, h: height };
    }
  }

  return info;
}

/**
 * Load manifest for current chapter
 * @param {Object} options
 * @returns {Promise<{manifest: Object|null, info: Object}>}
 */
export async function loadManifest(options = {}) {
  state.manifest = null;
  if (!state.basePath) {
    state.formats = null;
    state.assetVersion = null;
    return { manifest: null, info: { total: 0, hasSizes: false } };
  }
  const manifest = await fetchManifest(state.basePath, options);
  state.manifest = manifest;
  state.assetVersion = registerAssetVersion(state.basePath, manifest);
  state.formats = getFormatsForBase(state.basePath) || state.formats;
  const info = applyManifestMetadata(manifest);
  if (info.defaultSize && info.total) {
    for (let i = 1; i <= info.total; i++) {
      if (!state.sizes[i]) {
        state.sizes[i] = { ...info.defaultSize };
      }
    }
    info.hasSizes = true;
  }
  return { manifest, info };
}

/**
 * Discover card pairs using binary search
 * @returns {Promise<number>}
 */
export async function discoverPairs() {
  let left = 1,
    right = MAX_PROBE,
    lastValid = 0;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const [pf, pb] = await Promise.all([loadFrontImage(mid), loadBackImage(mid)]);

    if (pf.ok && pb.ok) {
      lastValid = mid;
      state.sizes[mid] = { w: pf.width, h: pf.height };
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  if (lastValid > 0) {
    const checks = [];
    for (let k = 1; k <= lastValid; k++) {
      if (!state.sizes[k]) {
        checks.push(
          loadFrontImage(k).then((pf) => {
            if (pf.ok) {
              state.sizes[k] = { w: pf.width, h: pf.height };
            }
          })
        );
      }
    }
    await Promise.all(checks);
  }

  return lastValid;
}

/**
 * Ensure all card sizes are loaded
 * @param {number} total
 */
export async function ensureCardSizes(total) {
  if (!total) return;
  const pending = [];
  for (let k = 1; k <= total; k++) {
    if (!state.sizes[k]) pending.push(k);
  }
  const batchSize = 6;
  while (pending.length) {
    const slice = pending.splice(0, batchSize);
    await Promise.all(
      slice.map((cardNo) =>
        loadFrontImage(cardNo).then((pf) => {
          if (pf.ok && pf.width && pf.height) {
            state.sizes[cardNo] = { w: pf.width, h: pf.height };
          }
        })
      )
    );
  }
}

/**
 * Load a chapter
 * @param {number} n
 */
export async function loadChapter(n) {
  const { qs } = await import('../utils/helpers.js');
  const { updateFavouritesCount } = await import('../ui/updates.js');

  showSkeleton();
  applyChapter(n);
  updateFavouritesCount();

  state.sizes = {};
  state.total = 0;
  state.deck = [];
  state.history = [];
  state.historyIndex = -1;
  state.currentIndex = 0;
  state.unvisited.clear();
  state.shuffleQueue = [];
  state.imagesLoaded.clear();
  state.preloading.clear();
  state.formats = getFormatsForBase(state.basePath) || null;
  resetFastNavState();

  // Reset revision progress when changing chapter
  if (state.revisionMode) {
    const progress = loadRevisionProgress();
    if (progress) {
      state.revisionRound = progress.round;
      state.revisionIncorrect = progress.incorrect;
      state.revisionSeen = progress.seen;
      state.revisionMastered = progress.mastered;
    } else {
      resetRevisionProgress();
    }
  }

  const { info } = await loadManifest();
  let total = info.total || 0;
  let hasSizes = info.hasSizes;

  if (!total) {
    total = await discoverPairs();
    hasSizes = true;
  } else if (!hasSizes && total > 0) {
    await ensureCardSizes(total);
    hasSizes = true;
  }

  state.total = total;

  if (!total) {
    hideSkeleton();
    qs('#counter').textContent = `Aucune image de carte trouvée dans "${state.basePath}".`;
    updateNavButtons();
    return;
  }

  const storedCard = getStoredCard(state.chapter);
  rebuildDeck(storedCard);

  // If in revision mode and round 2+, filter deck to only incorrect cards
  if (state.revisionMode && state.revisionRound > 1 && state.revisionIncorrect.size > 0) {
    state.deck = state.deck.filter((card) => state.revisionIncorrect.has(card));
  }

  if (!state.deck.length) {
    hideSkeleton();
    qs('#counter').textContent = 'Aucune carte disponible.';
    updateNavButtons();
    return;
  }

  // Initialize based on mode
  if (state.shuffle) {
    const savedHistory = loadHistory();
    if (savedHistory.length > 0) {
      state.history = savedHistory;
      state.historyIndex = savedHistory.length - 1;
      state.unvisited = new Set(state.deck);
      savedHistory.forEach((card) => state.unvisited.delete(card));
      state.shuffleQueue = [];
    } else if (storedCard && state.deck.includes(storedCard)) {
      state.history = [storedCard];
      state.historyIndex = 0;
      state.unvisited = new Set(state.deck);
      state.unvisited.delete(storedCard);
      state.shuffleQueue = [];
    } else {
      const randomIdx = Math.floor(Math.random() * state.deck.length);
      const firstCard = state.deck[randomIdx];
      state.history = [firstCard];
      state.historyIndex = 0;
      state.unvisited = new Set(state.deck);
      state.unvisited.delete(firstCard);
      state.shuffleQueue = [];
    }
  } else {
    if (storedCard && state.deck.includes(storedCard)) {
      state.currentIndex = state.deck.indexOf(storedCard);
    } else {
      state.currentIndex = 0;
    }
  }

  ensureShuffleQueue();
  await showCurrent();
}
