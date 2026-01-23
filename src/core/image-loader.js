/**
 * Image loading and caching system
 */

import { state } from '../state.js';
import { IMAGE_FORMATS } from '../config.js';

// Caches
const imageCache = new Map();
const loadingImages = new Map();
export const manifestCache = new Map();
const manifestFetches = new Map();
const formatCacheByBase = new Map();
const assetVersionByBase = new Map();
const imageFormatCache = new Map();

/**
 * Load an image and return its metadata
 * @param {string} url
 * @param {boolean} useCache
 * @returns {Promise<{ok: boolean, width?: number, height?: number, src: string}>}
 */
export function loadImage(url, useCache = true) {
  if (useCache && imageCache.has(url)) {
    return Promise.resolve(imageCache.get(url));
  }

  if (loadingImages.has(url)) {
    return loadingImages.get(url);
  }

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const result = {
        ok: true,
        width: img.naturalWidth,
        height: img.naturalHeight,
        src: url,
      };
      if (useCache) imageCache.set(url, result);
      loadingImages.delete(url);
      resolve(result);
    };
    img.onerror = () => {
      const result = { ok: false, src: url };
      loadingImages.delete(url);
      resolve(result);
    };
    img.src = url;
  });

  loadingImages.set(url, promise);
  return promise;
}

/**
 * Probe an image with cache busting
 * @param {string} url
 * @returns {Promise}
 */
export function probeImage(url) {
  const sep = url.includes('?') ? '&' : '?';
  return loadImage(`${url}${sep}probe=${Date.now()}`, false);
}

// ==================== URL Helpers ====================

function appendQueryParam(url, key, value) {
  if (value === null || value === undefined || value === '') return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function addCacheBustParam(url, token = Date.now().toString(36)) {
  return appendQueryParam(url, 'cb', token);
}

function normalizeExt(ext) {
  return typeof ext === 'string' ? ext.trim().toLowerCase() : '';
}

// ==================== Asset Versioning ====================

function deriveAssetVersion(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  const candidates = [
    manifest.asset_version,
    manifest.assetVersion,
    manifest.cache_bust,
    manifest.cacheBust,
    manifest.version,
    manifest.generated_at,
    manifest.generatedAt,
    manifest.updated_at,
    manifest.updatedAt,
  ];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const str = String(candidate).trim();
    if (str) return str;
  }
  return null;
}

export function registerAssetVersion(basePath, manifest) {
  if (!basePath) return null;
  const version = deriveAssetVersion(manifest);
  if (version) {
    assetVersionByBase.set(basePath, version);
  } else {
    assetVersionByBase.delete(basePath);
  }
  return version;
}

export function getAssetVersion(basePath = state.basePath) {
  if (!basePath) return null;
  if (basePath === state.basePath && state.assetVersion) {
    return state.assetVersion;
  }
  return assetVersionByBase.get(basePath) || null;
}

// ==================== Format Handling ====================

function deriveFormatsFromManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  const formats = {};
  const imgFormats = manifest.image_formats || manifest.formats;
  if (imgFormats && typeof imgFormats === 'object') {
    if (imgFormats.front) formats.front = normalizeExt(imgFormats.front);
    if (imgFormats.back) formats.back = normalizeExt(imgFormats.back);
    if (imgFormats.default) formats.default = normalizeExt(imgFormats.default);
  }
  if (manifest.image_format) {
    const ext = normalizeExt(manifest.image_format);
    if (ext) {
      if (!formats.front) formats.front = ext;
      if (!formats.back) formats.back = ext;
      if (!formats.default) formats.default = ext;
    }
  }
  const keys = Object.keys(formats);
  if (!keys.length) return null;
  if (!formats.default) {
    if (formats.front && formats.back && formats.front === formats.back) {
      formats.default = formats.front;
    } else if (formats.front) {
      formats.default = formats.front;
    } else if (formats.back) {
      formats.default = formats.back;
    }
  }
  if (!formats.front && formats.default) formats.front = formats.default;
  if (!formats.back && formats.default) formats.back = formats.default;
  return formats;
}

export function cacheFormatsForBase(basePath, manifest) {
  if (!basePath) return null;
  const derived = deriveFormatsFromManifest(manifest);
  if (derived) {
    formatCacheByBase.set(basePath, derived);
  }
  return derived;
}

export function getFormatsForBase(basePath) {
  return formatCacheByBase.get(basePath) || null;
}

function getPreferredFormats(prefix, basePath = state.basePath) {
  if (!basePath) return [];
  const formats = (basePath === state.basePath && state.formats) || formatCacheByBase.get(basePath);
  if (!formats) return [];
  const ordered = [];
  if (formats[prefix]) ordered.push(formats[prefix]);
  if (formats.default) ordered.push(formats.default);
  return Array.from(new Set(ordered.filter(Boolean)));
}

// ==================== Image URL Building ====================

function imageFormatCacheKey(basePath, prefix, n) {
  return `${basePath}|${prefix}|${n}`;
}

function buildImageURL(basePath, prefix, n, ext) {
  let url = `${basePath}/${prefix}${n}.${ext}`;
  const assetVersion = getAssetVersion(basePath);
  if (assetVersion) {
    url = appendQueryParam(url, 'v', assetVersion);
  }
  return url;
}

// ==================== Manifest Loading ====================

export async function fetchManifest(basePath, { forceReload = false } = {}) {
  if (!basePath) return null;
  if (!forceReload && manifestCache.has(basePath)) {
    const cached = manifestCache.get(basePath);
    registerAssetVersion(basePath, cached);
    return cached;
  }
  if (manifestFetches.has(basePath)) {
    return manifestFetches.get(basePath);
  }
  const url = `${basePath}/manifest.json`;
  const fetchPromise = fetch(url, {
    cache: forceReload ? 'reload' : 'no-cache',
  })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((data) => {
      manifestFetches.delete(basePath);
      if (data) {
        manifestCache.set(basePath, data);
        cacheFormatsForBase(basePath, data);
        registerAssetVersion(basePath, data);
      }
      return data;
    });
  manifestFetches.set(basePath, fetchPromise);
  return fetchPromise;
}

// ==================== Card Image Loading ====================

export async function loadCardImage(prefix, n, options = {}) {
  const { basePath = state.basePath, probe = false, useCache = true } = options;

  if (!basePath) {
    return { ok: false, src: '' };
  }

  const key = imageFormatCacheKey(basePath, prefix, n);
  const cachedExt = imageFormatCache.get(key);
  const baseCandidates = getPreferredFormats(prefix, basePath);
  const candidateSet = [];
  if (cachedExt) candidateSet.push(cachedExt);
  baseCandidates.forEach((ext) => candidateSet.push(ext));
  IMAGE_FORMATS.forEach((ext) => candidateSet.push(ext));
  const candidates = Array.from(new Set(candidateSet.filter(Boolean)));
  if (!candidates.length) return { ok: false, src: '' };

  let lastTried = '';
  for (const ext of candidates) {
    const url = buildImageURL(basePath, prefix, n, ext);
    lastTried = url;
    let cacheBusted = false;
    let result = probe ? await probeImage(url) : await loadImage(url, useCache);
    if (!probe && !result.ok) {
      const bustedUrl = addCacheBustParam(url);
      lastTried = bustedUrl;
      result = await loadImage(bustedUrl, false);
      cacheBusted = true;
    }
    if (result.ok) {
      result.ext = ext;
      imageFormatCache.set(key, ext);
      if (!result.src) {
        result.src = lastTried || url;
      }
      if (cacheBusted && useCache && !imageCache.has(url)) {
        imageCache.set(url, { ...result });
      }
      return result;
    }
  }

  return { ok: false, src: lastTried };
}

export function loadFrontImage(n, options) {
  return loadCardImage('front', n, options);
}

export function loadBackImage(n, options) {
  return loadCardImage('back', n, options);
}
