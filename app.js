// Detect touch-capable devices early and flag the document
(function () {
  try {
    var isTouch =
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0 ||
      navigator.msMaxTouchPoints > 0;
    if (isTouch) document.documentElement.classList.add("is-touch");
  } catch (_) {}
})();

/* ==========================
 Configuration
 ========================== */
const CHAPTERS_MANUAL = [];
const CHAPTER_PREFIX = "ch";
const CHAPTER_SUFFIX = "_cartes";
const MAX_CHAPTERS_PROBE = 20;
const MAX_PROBE = 100;
const PRELOAD_RADIUS = 2;
const MAX_HISTORY = 5; // Maximum history for shuffle mode
const WELCOME_MODAL_VERSION = "1.0"; // Change this to show welcome modal again

/* ===== Helpers ===== */
const qs = (s, el = document) => el.querySelector(s);

// Add this to your initialization code
document.addEventListener("DOMContentLoaded", function () {
  // Check if device is touch-enabled
  const isTouchDevice =
    "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (isTouchDevice) {
    document.body.classList.add("is-touch");
  }

  // Info button tooltip functionality
  const infoBtn = document.getElementById("infoBtn");
  const helpTooltip = document.getElementById("helpTooltip");

  if (infoBtn && helpTooltip) {
    let tooltipVisible = false;
    let repositionFrame = null;

    const resetTooltipStyles = () => {
      helpTooltip.style.position = "";
      helpTooltip.style.top = "";
      helpTooltip.style.left = "";
      helpTooltip.style.right = "";
      helpTooltip.style.bottom = "";
      helpTooltip.style.removeProperty("--tooltip-offset-x");
      helpTooltip.dataset.placement = "bottom";
    };

    const closeTooltip = () => {
      if (!tooltipVisible) return;
      tooltipVisible = false;
      helpTooltip.classList.add("hidden");
      helpTooltip.setAttribute("aria-hidden", "true");
      if (repositionFrame !== null) {
        cancelAnimationFrame(repositionFrame);
        repositionFrame = null;
      }
      resetTooltipStyles();
    };

    const positionTooltip = () => {
      if (!tooltipVisible) return;

      const spacing = 12;
      const buttonRect = infoBtn.getBoundingClientRect();

      helpTooltip.style.position = "fixed";
      helpTooltip.style.right = "auto";
      helpTooltip.style.bottom = "auto";
      helpTooltip.dataset.placement = "bottom";

      const anchorX = buttonRect.left + buttonRect.width / 2;
      helpTooltip.style.left = `${anchorX}px`;
      helpTooltip.style.setProperty("--tooltip-offset-x", "0px");

      const tooltipRect = helpTooltip.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const halfWidth = tooltipRect.width / 2;

      const leftBoundary = anchorX - halfWidth;
      const rightBoundary = anchorX + halfWidth;
      const overflowLeft = Math.max(spacing - leftBoundary, 0);
      const overflowRight = Math.max(rightBoundary - (viewportWidth - spacing), 0);
      const offsetX = overflowLeft - overflowRight;
      helpTooltip.style.setProperty("--tooltip-offset-x", `${offsetX}px`);

      let top = buttonRect.bottom + spacing;
      let placement = "bottom";

      if (top + tooltipRect.height > viewportHeight - spacing) {
        const aboveTop = buttonRect.top - spacing - tooltipRect.height;
        if (aboveTop >= spacing) {
          top = aboveTop;
          placement = "top";
        } else {
          top = Math.max(spacing, viewportHeight - tooltipRect.height - spacing);
        }
      }

      const minTop = spacing;
      const maxTop = Math.max(spacing, viewportHeight - tooltipRect.height - spacing);
      top = Math.min(Math.max(top, minTop), maxTop);

      helpTooltip.style.top = `${top}px`;
      helpTooltip.dataset.placement = placement;
    };

    const scheduleTooltipReposition = () => {
      if (!tooltipVisible) return;
      if (repositionFrame !== null) return;
      repositionFrame = requestAnimationFrame(() => {
        repositionFrame = null;
        positionTooltip();
      });
    };

    const openTooltip = () => {
      if (tooltipVisible) return;
      tooltipVisible = true;
      helpTooltip.classList.remove("hidden");
      helpTooltip.setAttribute("aria-hidden", "false");
      scheduleTooltipReposition();
    };

    infoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (tooltipVisible) {
        closeTooltip();
      } else {
        openTooltip();
      }
    });

    document.addEventListener("click", (e) => {
      if (!infoBtn.contains(e.target) && !helpTooltip.contains(e.target)) {
        closeTooltip();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && tooltipVisible) {
        closeTooltip();
        infoBtn.focus();
      }
    });

    const handleViewportChange = () => {
      if (!tooltipVisible) return;
      scheduleTooltipReposition();
    };

    window.addEventListener("resize", handleViewportChange, { passive: true });
    window.addEventListener("scroll", handleViewportChange, { passive: true });
  }
});

// Image cache to avoid redundant loads
const imageCache = new Map();
const loadingImages = new Map();
const manifestCache = new Map();
const manifestFetches = new Map();
const formatCacheByBase = new Map();
const assetVersionByBase = new Map();

function loadImage(url, useCache = true) {
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

function probeImage(url) {
  const sep = url.includes("?") ? "&" : "?";
  return loadImage(`${url}${sep}probe=${Date.now()}`, false);
}

const IMAGE_FORMATS = ["webp", "png"];
const imageFormatCache = new Map();

function imageFormatCacheKey(basePath, prefix, n) {
  return `${basePath}|${prefix}|${n}`;
}

function appendQueryParam(url, key, value) {
  if (value == null || value === "") return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function deriveAssetVersion(manifest) {
  if (!manifest || typeof manifest !== "object") return null;
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
    if (candidate == null) continue;
    const str = String(candidate).trim();
    if (str) return str;
  }
  return null;
}

function registerAssetVersion(basePath, manifest) {
  if (!basePath) return null;
  const version = deriveAssetVersion(manifest);
  if (version) {
    assetVersionByBase.set(basePath, version);
  } else {
    assetVersionByBase.delete(basePath);
  }
  return version;
}

function getAssetVersion(basePath = state.basePath) {
  if (!basePath) return null;
  if (basePath === state.basePath && state.assetVersion) {
    return state.assetVersion;
  }
  return assetVersionByBase.get(basePath) || null;
}

function addCacheBustParam(url, token = Date.now().toString(36)) {
  return appendQueryParam(url, "cb", token);
}

function buildImageURL(basePath, prefix, n, ext) {
  let url = `${basePath}/${prefix}${n}.${ext}`;
  const assetVersion = getAssetVersion(basePath);
  if (assetVersion) {
    url = appendQueryParam(url, "v", assetVersion);
  }
  return url;
}

function normalizeExt(ext) {
  return typeof ext === "string" ? ext.trim().toLowerCase() : "";
}

function deriveFormatsFromManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return null;
  const formats = {};
  const imgFormats = manifest.image_formats || manifest.formats;
  if (imgFormats && typeof imgFormats === "object") {
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

function cacheFormatsForBase(basePath, manifest) {
  if (!basePath) return null;
  const derived = deriveFormatsFromManifest(manifest);
  if (derived) {
    formatCacheByBase.set(basePath, derived);
  }
  return derived;
}

function getPreferredFormats(prefix, basePath = state.basePath) {
  if (!basePath) return [];
  const formats =
    (basePath === state.basePath && state.formats) ||
    formatCacheByBase.get(basePath);
  if (!formats) return [];
  const ordered = [];
  if (formats[prefix]) ordered.push(formats[prefix]);
  if (formats.default) ordered.push(formats.default);
  return Array.from(new Set(ordered.filter(Boolean)));
}

function asPositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchManifest(basePath, { forceReload = false } = {}) {
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
    cache: forceReload ? "reload" : "no-cache",
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

function applyManifestMetadata(manifest) {
  const info = { total: 0, hasSizes: false, defaultSize: null };
  if (!manifest || typeof manifest !== "object") return info;

  if (Number.isFinite(manifest.total_cards)) {
    info.total = Number(manifest.total_cards);
  }

  const formats = cacheFormatsForBase(state.basePath, manifest);
  if (formats) {
    state.formats = formats;
  }

  let maxCard = info.total;
  let perCardSizeFound = false;

  if (manifest.per_card && typeof manifest.per_card === "object") {
    for (const [key, value] of Object.entries(manifest.per_card)) {
      const cardNo = asPositiveInt(key);
      if (!cardNo) continue;
      if (cardNo > maxCard) maxCard = cardNo;
      if (value && typeof value === "object") {
        let width = null;
        let height = null;
        if (value.front && typeof value.front === "object") {
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
  if (dims && typeof dims === "object") {
    const frontDims =
      dims.front && typeof dims.front === "object" ? dims.front : dims;
    const width = asPositiveInt(frontDims.width);
    const height = asPositiveInt(frontDims.height);
    if (width && height) {
      info.defaultSize = { w: width, h: height };
    }
  }

  return info;
}

async function loadCardImage(prefix, n, options = {}) {
  const { basePath = state.basePath, probe = false, useCache = true } = options;

  if (!basePath) {
    return { ok: false, src: "" };
  }

  const key = imageFormatCacheKey(basePath, prefix, n);
  const cachedExt = imageFormatCache.get(key);
  const baseCandidates = getPreferredFormats(prefix, basePath);
  const candidateSet = [];
  if (cachedExt) candidateSet.push(cachedExt);
  baseCandidates.forEach((ext) => candidateSet.push(ext));
  IMAGE_FORMATS.forEach((ext) => candidateSet.push(ext));
  const candidates = Array.from(new Set(candidateSet.filter(Boolean)));
  if (!candidates.length) return { ok: false, src: "" };

  let lastTried = "";
  for (const ext of candidates) {
    const url = buildImageURL(basePath, prefix, n, ext);
    lastTried = url;
    let cacheBusted = false;
    let result = probe
      ? await probeImage(url)
      : await loadImage(url, useCache);
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

function loadFrontImage(n, options) {
  return loadCardImage("front", n, options);
}

function loadBackImage(n, options) {
  return loadCardImage("back", n, options);
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Favourites management
function getFavouritesKey() {
  return `fc_favourites_ch${state.chapter}`;
}

function loadFavourites() {
  const key = getFavouritesKey();
  const stored = localStorage.getItem(key);
  return stored ? new Set(JSON.parse(stored)) : new Set();
}

function saveFavourites(favourites) {
  const key = getFavouritesKey();
  localStorage.setItem(key, JSON.stringify(Array.from(favourites)));
  updateFavouritesCount();
}

function toggleFavourite(cardNo) {
  const favourites = loadFavourites();
  if (favourites.has(cardNo)) {
    favourites.delete(cardNo);
  } else {
    favourites.add(cardNo);
  }
  saveFavourites(favourites);
  return favourites.has(cardNo);
}

function updateFavouritesCount() {
  const count = loadFavourites().size;
  const countEl = qs("#favouritesCount");
  if (countEl) countEl.textContent = count.toString();
}

function updateBookmarkButton() {
  const btn = qs("#bookmarkBtn");
  if (!btn) return;
  const currentCard = getCurrentCard();
  const favourites = loadFavourites();
  const isFavourite = favourites.has(currentCard);
  btn.classList.toggle("active", isFavourite);
  btn.setAttribute("aria-pressed", String(isFavourite));
  const textEl = btn.querySelector(".btn-text");
  if (textEl) {
    textEl.textContent = isFavourite ? "Retirer" : "Ajouter";
  }
  btn.setAttribute(
    "aria-label",
    isFavourite ? "Retirer des favoris" : "Ajouter aux favoris"
  );
}

// History management for shuffle mode
function getHistoryKey() {
  return `fc_history_ch${state.chapter}`;
}

function saveHistory() {
  if (!state.shuffle || !state.chapter) return;
  const key = getHistoryKey();
  // Only save up to MAX_HISTORY items
  const toSave = state.history.slice(-MAX_HISTORY);
  localStorage.setItem(key, JSON.stringify(toSave));
}

function loadHistory() {
  if (!state.chapter) return [];
  const key = getHistoryKey();
  const stored = localStorage.getItem(key);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      // Filter to only include cards that are in current deck
      return parsed
        .filter((card) => state.deck.includes(card))
        .slice(-MAX_HISTORY);
    }
  } catch (_) {}
  return [];
}

function clearHistory() {
  if (!state.chapter) return;
  const key = getHistoryKey();
  localStorage.removeItem(key);
}

// Révision mode management
function getRevisionKey() {
  return `fc_revision_ch${state.chapter}`;
}

function saveRevisionProgress() {
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

function loadRevisionProgress() {
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

function resetRevisionProgress() {
  state.revisionRound = 1;
  state.revisionIncorrect = new Set();
  state.revisionSeen = new Set();
  state.revisionMastered = new Set();
  if (state.chapter) {
    const key = getRevisionKey();
    localStorage.removeItem(key);
  }
}

function restartRevisionSession() {
  if (!state.revisionMode) return;

  resetRevisionProgress();
  rebuildDeck();

  if (!state.deck.length) {
    updateCounter();
    return;
  }

  if (!state.shuffle) {
    state.shuffle = true;
    localStorage.setItem("fc_shuffle", "true");
  }

  resetShuffleForRevision();
  showCurrent();
  updateRevisionUI();
  updateCounter();
}

function markCardOK() {
  const currentCard = getCurrentCard();
  if (!currentCard) return;

  // Remove from incorrect set if present
  state.revisionIncorrect.delete(currentCard);
  // Add to mastered set
  state.revisionMastered.add(currentCard);
  // Mark as seen in this round
  state.revisionSeen.add(currentCard);

  saveRevisionProgress();

  // Check if we've completed the round
  if (checkRoundComplete()) {
    swipeCard("right", () => handleRoundComplete());
  } else {
    // Move to next card with swipe animation
    swipeCard("right", () => nextRevisionCard());
  }
}

function markCardPasOK() {
  const currentCard = getCurrentCard();
  if (!currentCard) return;

  // Add to incorrect set
  state.revisionIncorrect.add(currentCard);
  // Mark as seen in this round
  state.revisionSeen.add(currentCard);
  // Remove from mastered if it was there
  state.revisionMastered.delete(currentCard);

  saveRevisionProgress();

  // Check if we've completed the round
  if (checkRoundComplete()) {
    swipeCard("left", () => handleRoundComplete());
  } else {
    // Move to next card with swipe animation
    swipeCard("left", () => nextRevisionCard());
  }
}

function checkRoundComplete() {
  // In révision mode, a round is complete when we've seen all cards in the current deck
  const currentDeck = getCurrentRevisionDeck();
  return state.revisionSeen.size >= currentDeck.length;
}

function getCurrentRevisionDeck() {
  // In révision mode, the deck itself is already filtered to the correct cards
  return state.deck.slice();
}

function nextRevisionCard() {
  // Navigate to the next unseen card in révision mode
  if (!state.deck.length) return;

  // Find next unseen card
  const unseenCards = state.deck.filter(card => !state.revisionSeen.has(card));

  if (unseenCards.length === 0) {
    // All cards seen - round should be complete
    handleRoundComplete();
    return;
  }

  // Pick a random unseen card
  const randomIndex = Math.floor(Math.random() * unseenCards.length);
  const nextCardNo = unseenCards[randomIndex];

  // Update history for shuffle mode compatibility
  state.history.push(nextCardNo);
  if (state.history.length > MAX_HISTORY) {
    state.history.shift();
    state.historyIndex = MAX_HISTORY - 1;
  } else {
    state.historyIndex++;
  }

  // Update unvisited set
  state.unvisited.delete(nextCardNo);

  // Save history
  saveHistory();

  // Show the new card with scale-in animation
  showCurrentWithScaleIn();
  updateCounter();
}

function swipeCard(direction, callback) {
  // Swipe the current card away (Tinder-style)
  const cardShell = qs("#cardShell");
  if (!cardShell) return;

  // Prevent interaction during animation
  state.isTransitioning = true;

  // Add swipe animation class
  const animationClass = direction === "right" ? "swiping-right" : "swiping-left";
  cardShell.classList.add(animationClass);

  // Wait for animation to complete
  setTimeout(() => {
    cardShell.classList.remove(animationClass);
    state.isTransitioning = false;

    // Call the callback to load next card or handle completion
    if (callback) callback();
  }, 300);
}

function showCurrentWithScaleIn() {
  // Show current card with scale-in animation
  const cardShell = qs("#cardShell");
  if (!cardShell) {
    // Fallback to regular showCurrent
    showCurrent();
    return;
  }

  // Add scaling-in class
  cardShell.classList.add("scaling-in");

  // Show the card
  showCurrent();

  // Remove class after animation
  setTimeout(() => {
    cardShell.classList.remove("scaling-in");
  }, 300);
}

function handleRoundComplete() {
  // Check if all cards are mastered
  if (state.revisionIncorrect.size === 0) {
    // All cards mastered! Show congratulations
    showRevisionComplete();
  } else {
    // Start a new round with incorrect cards
    startNewRevisionRound();
  }
}

function startNewRevisionRound() {
  state.revisionRound++;
  state.revisionSeen = new Set();

  // Rebuild deck to only include incorrect cards
  if (state.revisionIncorrect.size > 0) {
    state.deck = Array.from(state.revisionIncorrect);
  }

  saveRevisionProgress();
  // Reset shuffle state for new round
  resetShuffleForRevision();

  // Show first card of new round
  showCurrent();
  updateRevisionUI();
  updateCounter();
}

function showRevisionComplete() {
  // Show congratulations modal
  const modal = qs("#revisionCompleteModal");
  if (modal) {
    const roundsEl = qs("#revisionRounds");
    const pluralEl = qs("#revisionRoundsPlural");
    const pluralCompleteEl = qs("#revisionRoundsPlural2");
    if (roundsEl) roundsEl.textContent = state.revisionRound.toString();
    if (pluralEl) {
      pluralEl.textContent = state.revisionRound > 1 ? "s" : "";
    }
    if (pluralCompleteEl) {
      pluralCompleteEl.textContent = state.revisionRound > 1 ? "s" : "";
    }
    modal.classList.add("show");
  }
}

function resetShuffleForRevision(preferredCard = null) {
  // Reset shuffle state to start fresh with current deck
  const currentDeck = getCurrentRevisionDeck();
  state.unvisited = new Set(currentDeck);
  state.history = [];
  state.historyIndex = -1;

  if (!currentDeck.length) {
    state.shuffleQueue = [];
    return;
  }

  let firstCard = preferredCard;
  if (firstCard == null || !state.unvisited.has(firstCard)) {
    const randomIdx = Math.floor(Math.random() * currentDeck.length);
    firstCard = currentDeck[randomIdx];
  }

  state.history = [firstCard];
  state.historyIndex = 0;
  state.unvisited.delete(firstCard);

  state.shuffleQueue = shuffleArray(Array.from(state.unvisited));
  saveHistory();
}

function toggleRevisionMode() {
  const previousCard = getCurrentCard();
  state.revisionMode = !state.revisionMode;
  localStorage.setItem("fc_revision_mode", JSON.stringify(state.revisionMode));

  if (state.revisionMode) {
    // Entering révision mode
    // Load any existing progress or reset
    const progress = loadRevisionProgress();
    if (progress) {
      state.revisionRound = progress.round;
      state.revisionIncorrect = progress.incorrect;
      state.revisionSeen = progress.seen;
      state.revisionMastered = progress.mastered;

      // If we're in round 2+, rebuild deck with only incorrect cards
      if (state.revisionRound > 1 && state.revisionIncorrect.size > 0) {
        state.deck = Array.from(state.revisionIncorrect);
      }
    } else {
      resetRevisionProgress();
    }

    // Enable shuffle mode and lock it
    if (!state.shuffle) {
      state.shuffle = true;
      localStorage.setItem("fc_shuffle", "true");
    }
    resetShuffleForRevision(previousCard);

    // Disable favourites-only mode
    if (state.showFavouritesOnly) {
      state.showFavouritesOnly = false;
    }
  } else {
    // Exiting révision mode - rebuild deck with all cards
    const keep = getCurrentCard();
    rebuildDeck(keep);
  }

  updateRevisionUI();
  updateShuffleUI();
  updateFavouritesUI();
  updateCounter();
  showCurrent();
}

// Welcome modal functions
function checkWelcomeModal() {
  const seenVersion = localStorage.getItem("fc_welcome_modal_version");
  if (seenVersion !== WELCOME_MODAL_VERSION) {
    showWelcomeModal();
  }
}

function showWelcomeModal() {
  const modal = qs("#welcomeModal");
  if (modal) {
    modal.classList.add("show");
  }
}

function dismissWelcomeModal() {
  const modal = qs("#welcomeModal");
  if (modal) {
    modal.classList.remove("show");
    localStorage.setItem("fc_welcome_modal_version", WELCOME_MODAL_VERSION);
  }
}

const state = {
  total: 0,
  deck: [], // All available cards (filtered)
  history: [], // Cards visited in order (for shuffle mode)
  historyIndex: -1, // Current position in history (for shuffle mode)
  currentIndex: 0, // Current position in deck (for sequential mode)
  unvisited: new Set(), // Cards not yet visited in shuffle mode
  flipped: false,
  shuffle: JSON.parse(localStorage.getItem("fc_shuffle") || "false"),
  showFavouritesOnly: false,
  chapter: null,
  basePath: "",
  assetVersion: null,
  sizes: {},
  isTransitioning: false,
  imagesLoaded: new Set(),
  preloading: new Set(),
  manifest: null,
  filterTimer: "all",
  filterDifficulty: "all",
  formats: null,
  shuffleQueue: [],
  // Révision mode state
  revisionMode: JSON.parse(localStorage.getItem("fc_revision_mode") || "false"),
  revisionIncorrect: new Set(), // Cards marked "Pas OK" in current round
  revisionSeen: new Set(), // Cards seen in current round
  revisionRound: 1, // Current round number
  revisionMastered: new Set(), // Cards that have been marked "OK"
};

const LAST_CARD_KEY_PREFIX = "fc_last_card_";

function shuffleArray(items) {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function ensureShuffleQueue(currentCard) {
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

function getStoredCard(chapter) {
  if (!chapter) return null;
  const raw = localStorage.getItem(`${LAST_CARD_KEY_PREFIX}${chapter}`);
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function storeCurrentCard(cardNo) {
  if (!state.chapter || !cardNo) return;
  try {
    localStorage.setItem(
      `${LAST_CARD_KEY_PREFIX}${state.chapter}`,
      String(cardNo)
    );
  } catch (_) {}
}

function getCurrentCard() {
  if (state.shuffle) {
    // In shuffle mode, use history
    if (state.history.length === 0) return null;
    if (state.historyIndex < 0 || state.historyIndex >= state.history.length)
      return null;
    return state.history[state.historyIndex];
  } else {
    // In sequential mode, use deck index
    if (state.deck.length === 0) return null;
    if (state.currentIndex < 0 || state.currentIndex >= state.deck.length)
      return null;
    return state.deck[state.currentIndex];
  }
}

// Timer states cycle
const timerStates = ["all", "green", "yellow", "orange"];
const difficultyStates = ["all", "green", "orange", "red"];

function showSkeleton() {
  const skeleton = qs("#skeleton");
  skeleton.classList.add("visible");
}

function hideSkeleton() {
  const skeleton = qs("#skeleton");
  skeleton.classList.remove("visible");
}

async function discoverChapters() {
  if (CHAPTERS_MANUAL.length) return CHAPTERS_MANUAL.slice();
  const found = [];

  const batchSize = 5;
  for (let start = 1; start <= MAX_CHAPTERS_PROBE; start += batchSize) {
    const batch = [];
    for (
      let n = start;
      n < Math.min(start + batchSize, MAX_CHAPTERS_PROBE + 1);
      n++
    ) {
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

function applyChapter(n) {
  state.chapter = n;
  state.basePath = `flashcards/${CHAPTER_PREFIX}${n}${CHAPTER_SUFFIX}`;
  state.formats = formatCacheByBase.get(state.basePath) || null;
  state.assetVersion = assetVersionByBase.get(state.basePath) || null;
  updateFavouritesCount();
}

async function loadManifest(options = {}) {
  state.manifest = null;
  if (!state.basePath) {
    state.formats = null;
    state.assetVersion = null;
    return { manifest: null, info: { total: 0, hasSizes: false } };
  }
  const manifest = await fetchManifest(state.basePath, options);
  state.manifest = manifest;
  state.assetVersion = registerAssetVersion(state.basePath, manifest);
  state.formats = formatCacheByBase.get(state.basePath) || state.formats;
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

async function loadChapter(n) {
  showSkeleton();
  applyChapter(n);
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
  state.formats = formatCacheByBase.get(state.basePath) || null;

  // Reset révision progress when changing chapter
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
    qs(
      "#counter"
    ).textContent = `Aucune image de carte trouvée dans "${state.basePath}".`;
    updateNavButtons();
    return;
  }

  const storedCard = getStoredCard(state.chapter);
  rebuildDeck(storedCard);

  // If in révision mode and round 2+, filter deck to only incorrect cards
  if (state.revisionMode && state.revisionRound > 1 && state.revisionIncorrect.size > 0) {
    state.deck = state.deck.filter(card => state.revisionIncorrect.has(card));
  }

  if (!state.deck.length) {
    hideSkeleton();
    qs("#counter").textContent = "Aucune carte disponible.";
    updateNavButtons();
    return;
  }

  // Initialize based on mode
  if (state.shuffle) {
    // Load saved history
    const savedHistory = loadHistory();
    if (savedHistory.length > 0) {
      state.history = savedHistory;
      state.historyIndex = savedHistory.length - 1;
      // Update unvisited set
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
      // Start with a random card
      const randomIdx = Math.floor(Math.random() * state.deck.length);
      const firstCard = state.deck[randomIdx];
      state.history = [firstCard];
      state.historyIndex = 0;
      state.unvisited = new Set(state.deck);
      state.unvisited.delete(firstCard);
      state.shuffleQueue = [];
    }
  } else {
    // Sequential mode
    if (storedCard && state.deck.includes(storedCard)) {
      state.currentIndex = state.deck.indexOf(storedCard);
    } else {
      state.currentIndex = 0;
    }
  }

  ensureShuffleQueue(getCurrentCard());
  await showCurrent();
}

function buildChapterSelect(chapters) {
  const sel = qs("#chapterSelect");
  sel.innerHTML = "";
  chapters.forEach((n) => {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = `Chapitre ${n}`;
    sel.appendChild(opt);
  });
  const defaultChapter = chapters[chapters.length - 1];
  const initial = defaultChapter;
  sel.value = String(initial);
  sel.addEventListener("change", async (e) => {
    const val = parseInt(e.target.value, 10);
    await loadChapter(val);
  });
  return initial;
}

async function discoverPairs() {
  let left = 1,
    right = MAX_PROBE,
    lastValid = 0;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const [pf, pb] = await Promise.all([
      loadFrontImage(mid),
      loadBackImage(mid),
    ]);

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

async function ensureCardSizes(total) {
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

function rebuildDeck(keepCardNo = null) {
  const { total, manifest } = state;
  let newDeck = null;

  if (manifest && manifest.per_card && typeof manifest.per_card === "object") {
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
    const purple = new Set();
    if (manifest.per_card && typeof manifest.per_card === "object") {
      for (const [k, v] of Object.entries(manifest.per_card)) {
        if (v && v.border === "purple") purple.add(parseInt(k, 10));
      }
    } else if (
      manifest.cards_by_border &&
      Array.isArray(manifest.cards_by_border.purple)
    ) {
      manifest.cards_by_border.purple.forEach((n) =>
        purple.add(parseInt(n, 10))
      );
    }
    if (purple.size) {
      newDeck = newDeck.filter((n) => !purple.has(n));
    }

    const tf = state.filterTimer;
    if (tf && tf !== "all") {
      const allowedTimer = new Set();
      if (
        manifest.cards_by_timer &&
        Array.isArray(manifest.cards_by_timer[tf])
      ) {
        manifest.cards_by_timer[tf].forEach((n) =>
          allowedTimer.add(parseInt(n, 10))
        );
      } else if (manifest.per_card && typeof manifest.per_card === "object") {
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

    const df = state.filterDifficulty;
    if (df && df !== "all") {
      const allowedBorder = new Set();
      if (
        manifest.cards_by_border &&
        Array.isArray(manifest.cards_by_border[df])
      ) {
        manifest.cards_by_border[df].forEach((n) =>
          allowedBorder.add(parseInt(n, 10))
        );
      } else if (manifest.per_card && typeof manifest.per_card === "object") {
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

  // Sort the deck deterministically (don't shuffle here)
  newDeck.sort((a, b) => a - b);

  state.deck = newDeck;

  // Reset position based on mode
  if (state.shuffle) {
    // In shuffle mode, update history if needed
    if (keepCardNo != null && newDeck.includes(keepCardNo)) {
      // Keep the card in history
      if (!state.history.includes(keepCardNo)) {
        state.history = [keepCardNo];
        state.historyIndex = 0;
      }
    } else {
      // Filter history to only include cards still in deck
      state.history = state.history.filter((card) => newDeck.includes(card));
      if (state.history.length === 0 && newDeck.length > 0) {
        // Pick a random card to start
        const randomIdx = Math.floor(Math.random() * newDeck.length);
        state.history = [newDeck[randomIdx]];
        state.historyIndex = 0;
      } else {
        state.historyIndex = Math.min(
          state.historyIndex,
          state.history.length - 1
        );
      }
    }
    // Update unvisited set
    state.unvisited = new Set(newDeck);
    state.history.forEach((card) => state.unvisited.delete(card));
    state.shuffleQueue = [];
  } else {
    // Sequential mode
    if (keepCardNo != null && newDeck.includes(keepCardNo)) {
      state.currentIndex = newDeck.indexOf(keepCardNo);
    } else {
      state.currentIndex = 0;
    }
  }
}

function updateCounter() {
  const el = qs("#counter");
  if (!state.deck.length) {
    if (state.showFavouritesOnly) {
      el.textContent = "Aucun favori disponible.";
    } else {
      el.textContent = "Aucune image trouvée.";
    }
    return;
  }

  const currentCard = getCurrentCard();
  if (!currentCard) {
    el.textContent = "Aucune carte sélectionnée.";
    return;
  }

  if (state.revisionMode) {
    // Show révision-specific counter
    const currentDeck = getCurrentRevisionDeck();
    const remaining = currentDeck.length - state.revisionSeen.size;
    const roundText = state.revisionRound > 1 ? `Tour ${state.revisionRound} · ` : "";
    if (remaining > 0) {
      el.textContent = `${roundText}${remaining} carte${remaining > 1 ? "s" : ""} restante${remaining > 1 ? "s" : ""}`;
    } else {
      el.textContent = `${roundText}Dernière carte !`;
    }
  } else if (state.showFavouritesOnly) {
    const position = state.deck.indexOf(currentCard);
    const displayNumber = position >= 0 ? position + 1 : currentCard || "?";
    el.textContent = `Favori ${displayNumber} sur ${state.deck.length}`;
  } else {
    el.textContent = `Carte n°${currentCard}, ${state.deck.length} résultats`;
  }
}

function setFlipped(on) {
  state.flipped = on;
  const card3d = qs("#card3d");
  card3d.classList.add("flipping");
  setTimeout(() => card3d.classList.remove("flipping"), 600);
  card3d.classList.toggle("flipped", on);
  card3d.setAttribute("aria-pressed", String(on));
}

function sizeStageForImage(naturalW, naturalH) {
  const stage = qs("#stage");
  const maxWidth = Math.min(window.innerWidth * 0.9, 900);
  const availableHeight = window.innerHeight - 300; // Leave room for controls
  const maxHeight = Math.max(availableHeight, 200);

  const widthByHeight = maxHeight * (naturalW / naturalH);
  const finalWidth = Math.min(maxWidth, widthByHeight);
  const finalHeight = finalWidth * (naturalH / naturalW);

  stage.style.width = `${finalWidth}px`;
  stage.style.height = `${finalHeight}px`;
}

function waitAnimationEnd(el, name, fallback = 600) {
  return new Promise((resolve) => {
    let done = false;
    const onEnd = (e) => {
      if (e.animationName === name) {
        done = true;
        el.removeEventListener("animationend", onEnd);
        resolve();
      }
    };
    el.addEventListener("animationend", onEnd);
    setTimeout(() => {
      if (!done) {
        el.removeEventListener("animationend", onEnd);
        resolve();
      }
    }, fallback);
  });
}

async function showCurrent(direction = "none") {
  if (state.isTransitioning) return;

  const n = getCurrentCard();
  if (!n) return;

  const size = state.sizes[n];
  if (size && size.w > 0 && size.h > 0) {
    sizeStageForImage(size.w, size.h);
  }

  const cardShell = qs("#cardShell");
  const card3d = qs("#card3d");
  const frontImg = qs("#frontImg");
  const backImg = qs("#backImg");

  const isFirstLoad = !state.imagesLoaded.has(n);
  if (isFirstLoad) {
    showSkeleton();
  }

  state.isTransitioning = true;

  const swapImages = async () => {
    if (state.flipped) {
      card3d.classList.add("no-anim");
      card3d.classList.remove("flipped", "flipping");
      card3d.setAttribute("aria-pressed", "false");
      state.flipped = false;
      void card3d.offsetHeight;
      card3d.classList.remove("no-anim");
    }

    frontImg.classList.remove("loaded");
    backImg.classList.remove("loaded");

    const [front, back] = await Promise.all([
      loadFrontImage(n),
      loadBackImage(n),
    ]);

    if (front && front.ok && front.width && front.height) {
      state.sizes[n] = { w: front.width, h: front.height };
      sizeStageForImage(front.width, front.height);
    } else if (back && back.ok && back.width && back.height) {
      state.sizes[n] = { w: back.width, h: back.height };
      sizeStageForImage(back.width, back.height);
    }

    frontImg.src = front.src;
    backImg.src = back.src;

    try {
      if (frontImg.decode && backImg.decode) {
        await Promise.all([frontImg.decode(), backImg.decode()]);
      } else {
        await Promise.all([
          new Promise((resolve) => {
            if (frontImg.complete) resolve();
            else frontImg.onload = resolve;
          }),
          new Promise((resolve) => {
            if (backImg.complete) resolve();
            else backImg.onload = resolve;
          }),
        ]);
      }
    } catch (_) {
      await Promise.all([
        new Promise((resolve) => {
          if (frontImg.complete) resolve();
          else frontImg.onload = resolve;
        }),
        new Promise((resolve) => {
          if (backImg.complete) resolve();
          else backImg.onload = resolve;
        }),
      ]);
    }

    state.imagesLoaded.add(n);
    frontImg.classList.add("loaded");
    backImg.classList.add("loaded");
    hideSkeleton();
    updateCounter();
    updateBookmarkButton();
  };

  if (direction === "none") {
    await swapImages();
    updateNavButtons();
    state.isTransitioning = false;
    if (n) {
      storeCurrentCard(n);
    }
    preloadNearbyCards();
    return;
  }

  const outClass = direction === "next" ? "out-left" : "out-right";
  const outName = direction === "next" ? "outLeft" : "outRight";
  const inClass = direction === "next" ? "in-right" : "in-left";
  const inName = direction === "next" ? "inRight" : "inLeft";

  cardShell.classList.remove("out-left", "out-right", "in-left", "in-right");
  void cardShell.offsetWidth;

  cardShell.classList.add(outClass);
  await waitAnimationEnd(cardShell, outName, 400);

  await swapImages();

  cardShell.classList.remove(outClass);
  void cardShell.offsetWidth;
  cardShell.classList.add(inClass);
  await waitAnimationEnd(cardShell, inName, 500);
  cardShell.classList.remove(inClass);

  state.isTransitioning = false;
  updateNavButtons();

  if (n) {
    storeCurrentCard(n);
  }

  preloadNearbyCards();
}

function queuePreload(cardNo) {
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

  if ("requestIdleCallback" in window) {
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

function preloadNearbyCards() {
  // Preload based on what might be shown next
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
      const prevIdx =
        (state.currentIndex - offset + state.deck.length) % state.deck.length;
      if (state.deck[nextIdx]) queuePreload(state.deck[nextIdx]);
      if (state.deck[prevIdx]) queuePreload(state.deck[prevIdx]);
    }
  }
}

function nextCard() {
  if (state.isTransitioning) return;
  if (!state.deck.length) return;

  if (state.shuffle) {
    // Shuffle mode: use history

    // Check if we're navigating forward in history
    if (state.historyIndex < state.history.length - 1) {
      // We have forward history, go to next in history
      state.historyIndex++;
      saveHistory();
      showCurrent("next");
      return;
    }

    // We're at the end of history, need to add a new card
    const current = getCurrentCard();
    let nextCardNo = null;

    ensureShuffleQueue(current);

    if (state.shuffleQueue.length > 0) {
      nextCardNo = state.shuffleQueue.pop();
    } else if (state.deck.length > 0) {
      // Edge case: only one card or queue exhausted unexpectedly
      nextCardNo = state.deck[0];
    }

    if (nextCardNo != null) {
      // Add to history (limit to MAX_HISTORY)
      state.history.push(nextCardNo);
      if (state.history.length > MAX_HISTORY) {
        state.history.shift();
        state.historyIndex = MAX_HISTORY - 1;
      } else {
        state.historyIndex++;
      }

      // Remove from unvisited
      state.unvisited.delete(nextCardNo);
      ensureShuffleQueue(nextCardNo);

      saveHistory();
      showCurrent("next");
    }
  } else {
    // Sequential mode: just go to next in deck
    state.currentIndex = (state.currentIndex + 1) % state.deck.length;
    showCurrent("next");
  }
}

function prevCard() {
  if (state.isTransitioning) return;
  if (!state.deck.length) return;

  if (state.shuffle) {
    // Shuffle mode: go back in history
    if (state.historyIndex > 0) {
      state.historyIndex--;
      showCurrent("prev");
    }
  } else {
    // Sequential mode: always enabled, go to previous in deck
    state.currentIndex =
      (state.currentIndex - 1 + state.deck.length) % state.deck.length;
    showCurrent("prev");
  }
}

function toggleShuffle() {
  if (state.showFavouritesOnly && !state.shuffle) {
    return;
  }
  state.shuffle = !state.shuffle;
  localStorage.setItem("fc_shuffle", JSON.stringify(state.shuffle));

  if (state.shuffle) {
    // Switching TO shuffle mode
    const currentCard = getCurrentCard();

    // Load saved history or start fresh
    const savedHistory = loadHistory();
    if (
      savedHistory.length > 0 &&
      savedHistory[savedHistory.length - 1] === currentCard
    ) {
      // Use saved history if it ends with current card
      state.history = savedHistory;
      state.historyIndex = savedHistory.length - 1;
    } else {
      // Start fresh history with current card
      state.history = currentCard ? [currentCard] : [];
      state.historyIndex = currentCard ? 0 : -1;
    }

    // Initialize unvisited set
    state.unvisited = new Set(state.deck);
    state.history.forEach((card) => state.unvisited.delete(card));
    state.shuffleQueue = [];

    saveHistory();
  } else {
    // Switching TO sequential mode
    clearHistory(); // Clear saved history
    const currentCard = getCurrentCard();
    if (currentCard) {
      state.currentIndex = state.deck.indexOf(currentCard);
      if (state.currentIndex === -1) state.currentIndex = 0;
    }
    state.shuffleQueue = [];
  }

  ensureShuffleQueue(getCurrentCard());
  updateShuffleUI();
  updateCounter();
  updateNavButtons();
}

function toggleFavouritesOnly() {
  state.showFavouritesOnly = !state.showFavouritesOnly;
  let keep = getCurrentCard();

  if (state.showFavouritesOnly && state.shuffle) {
    toggleShuffle();
    keep = getCurrentCard();
  }

  rebuildDeck(keep);
  updateFavouritesUI();
  updateShuffleUI();

  if (!state.deck.length) {
    qs("#counter").textContent = "Aucun favori disponible.";
    hideSkeleton();
    updateNavButtons();
    return;
  }
  showCurrent();
}

function updateRevisionUI() {
  const modeToggle = qs("#modeToggle");
  if (modeToggle) {
    modeToggle.classList.toggle("active", state.revisionMode);
    const textEl = modeToggle.querySelector(".toggle-text");
    if (textEl) {
      textEl.textContent = state.revisionMode ? "Lecture" : "Révision";
    }
  }

  // Show/hide appropriate navigation buttons
  const prevBtn = qs("#prevBtn");
  const nextBtn = qs("#nextBtn");
  const bookmarkBtn = qs("#bookmarkBtn");
  const pasOkBtn = qs("#pasOkBtn");
  const okBtn = qs("#okBtn");

  if (state.revisionMode) {
    // Hide lecture mode buttons
    if (prevBtn) prevBtn.style.display = "none";
    if (nextBtn) nextBtn.style.display = "none";
    if (bookmarkBtn) bookmarkBtn.style.display = "none";
    // Show révision buttons
    if (pasOkBtn) pasOkBtn.style.display = "";
    if (okBtn) okBtn.style.display = "";
  } else {
    // Show lecture mode buttons
    if (prevBtn) prevBtn.style.display = "";
    if (nextBtn) nextBtn.style.display = "";
    if (bookmarkBtn) bookmarkBtn.style.display = "";
    // Hide révision buttons
    if (pasOkBtn) pasOkBtn.style.display = "none";
    if (okBtn) okBtn.style.display = "none";
  }

  // Completely hide random and favourites toggles in révision mode
  const randomToggle = qs("#randomToggle");
  const favToggle = qs("#favouritesToggle");
  const timerGroup = qs("#timerFilter")?.closest(".filter-group");
  const diffGroup = qs("#difficultyFilter")?.closest(".filter-group");

  if (state.revisionMode) {
    // Hide all filter controls in révision mode
    if (randomToggle) randomToggle.style.display = "none";
    if (favToggle) favToggle.style.display = "none";
    if (timerGroup) timerGroup.style.display = "none";
    if (diffGroup) diffGroup.style.display = "none";
  } else {
    // Show all filter controls in lecture mode
    if (randomToggle) randomToggle.style.display = "";
    if (favToggle) favToggle.style.display = "";
    if (timerGroup) timerGroup.style.display = "";
    if (diffGroup) diffGroup.style.display = "";
  }

  // Show/hide restart button
  const restartBtn = qs("#restartRevisionInlineBtn");
  if (restartBtn) {
    restartBtn.style.display = state.revisionMode ? "" : "none";
  }
}

function updateShuffleUI() {
  const toggle = qs("#randomToggle");
  if (!toggle) return;
  const disabled = state.showFavouritesOnly || state.revisionMode;
  toggle.classList.toggle("active", state.shuffle);
  toggle.classList.toggle("disabled", disabled);
  toggle.setAttribute("aria-checked", String(state.shuffle));
  toggle.setAttribute("aria-disabled", String(disabled));
  toggle.setAttribute("tabindex", disabled ? "-1" : "0");
}

function updateFavouritesUI() {
  const toggle = qs("#favouritesToggle");
  if (!toggle) return;
  const disabled = state.revisionMode;
  toggle.classList.toggle("active", state.showFavouritesOnly);
  toggle.classList.toggle("disabled", disabled);
  toggle.setAttribute("aria-checked", String(state.showFavouritesOnly));
  toggle.setAttribute("aria-disabled", String(disabled));
  toggle.setAttribute("tabindex", disabled ? "-1" : "0");
}

function updateNavButtons() {
  const prev = qs("#prevBtn");
  const next = qs("#nextBtn");

  if (state.shuffle) {
    // In shuffle mode: disable prev only if at beginning of history
    if (prev) prev.disabled = state.historyIndex <= 0;
  } else {
    // In sequential mode: prev is always enabled (wraps around)
    if (prev) prev.disabled = false;
  }

  // Next is disabled only if deck is empty
  if (next) next.disabled = state.deck.length === 0;
}

function cycleTimer() {
  // Disable filter cycling in révision mode
  if (state.revisionMode) return;

  const currentIndex = timerStates.indexOf(state.filterTimer);
  const nextIndex = (currentIndex + 1) % timerStates.length;
  state.filterTimer = timerStates[nextIndex];
  updateTimerUI();

  const keep = getCurrentCard();
  rebuildDeck(keep);
  if (!state.deck.length) {
    qs("#counter").textContent = "Aucune carte disponible pour ce filtre.";
    hideSkeleton();
    updateNavButtons();
    return;
  }
  showCurrent();
}

function updateTimerUI() {
  const pills = qs("#timerFilter");
  if (pills) {
    pills.setAttribute("data-level", state.filterTimer);
  }
}

function cycleDifficulty() {
  // Disable filter cycling in révision mode
  if (state.revisionMode) return;

  const currentIndex = difficultyStates.indexOf(state.filterDifficulty);
  const nextIndex = (currentIndex + 1) % difficultyStates.length;
  state.filterDifficulty = difficultyStates[nextIndex];
  updateDifficultyUI();

  const keep = getCurrentCard();
  rebuildDeck(keep);
  if (!state.deck.length) {
    qs("#counter").textContent = "Aucune carte disponible pour ce filtre.";
    hideSkeleton();
    updateNavButtons();
    return;
  }
  showCurrent();
}

function updateDifficultyUI() {
  const pills = qs("#difficultyFilter");
  if (pills) {
    pills.setAttribute("data-level", state.filterDifficulty);
  }
}

function bindUI() {
  const shell = qs("#cardShell");
  shell.addEventListener("click", (e) => {
    if (!state.isTransitioning) {
      setFlipped(!state.flipped);
    }
  });

  // Bookmark button
  const bookmarkBtn = qs("#bookmarkBtn");
  if (bookmarkBtn) {
    bookmarkBtn.addEventListener("click", (e) => {
      const currentCard = getCurrentCard();
      if (currentCard) {
        toggleFavourite(currentCard);
        updateBookmarkButton();
      }
    });
  }

  qs("#nextBtn").addEventListener("click", nextCard);
  qs("#prevBtn").addEventListener("click", prevCard);

  // Révision mode buttons
  const pasOkBtn = qs("#pasOkBtn");
  const okBtn = qs("#okBtn");
  if (pasOkBtn) {
    pasOkBtn.addEventListener("click", markCardPasOK);
  }
  if (okBtn) {
    okBtn.addEventListener("click", markCardOK);
  }

  // Mode toggle
  const modeToggle = qs("#modeToggle");
  if (modeToggle) {
    modeToggle.addEventListener("click", toggleRevisionMode);
  }

  // Révision complete modal buttons
  const restartRevisionBtn = qs("#restartRevisionBtn");
  const backToLectureBtn = qs("#backToLectureBtn");
  if (restartRevisionBtn) {
    restartRevisionBtn.addEventListener("click", () => {
      restartRevisionSession();
      const modal = qs("#revisionCompleteModal");
      if (modal) modal.classList.remove("show");
    });
  }
  if (backToLectureBtn) {
    backToLectureBtn.addEventListener("click", () => {
      const modal = qs("#revisionCompleteModal");
      if (modal) modal.classList.remove("show");
      // Switch to lecture mode
      toggleRevisionMode();
    });
  }

  // Welcome modal dismiss button
  const dismissWelcomeBtn = qs("#dismissWelcomeBtn");
  if (dismissWelcomeBtn) {
    dismissWelcomeBtn.addEventListener("click", dismissWelcomeModal);
  }

  // Inline restart button
  const restartRevisionInlineBtn = qs("#restartRevisionInlineBtn");
  if (restartRevisionInlineBtn) {
    restartRevisionInlineBtn.addEventListener("click", () => {
      if (confirm("Recommencer la révision depuis le début ?")) {
        restartRevisionSession();
      }
    });
  }

  // Random toggle
  const randomToggle = qs("#randomToggle");
  if (randomToggle) {
    randomToggle.addEventListener("click", () => {
      if (randomToggle.classList.contains("disabled")) return;
      toggleShuffle();
    });
    randomToggle.addEventListener("keydown", (e) => {
      if (randomToggle.classList.contains("disabled")) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleShuffle();
      }
    });
  }

  // Favourites toggle
  const favouritesToggle = qs("#favouritesToggle");
  if (favouritesToggle) {
    favouritesToggle.addEventListener("click", toggleFavouritesOnly);
    favouritesToggle.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleFavouritesOnly();
      }
    });
  }

  // Timer filter
  const timerFilter = qs("#timerFilter");
  timerFilter.addEventListener("click", cycleTimer);
  // Also allow clicking the whole group (incl. label)
  const timerGroup = timerFilter ? timerFilter.closest(".filter-group") : null;
  if (timerGroup) {
    timerGroup.addEventListener("click", (e) => {
      // Avoid double-trigger when clicking directly on the pills
      if (timerFilter.contains(e.target)) return;
      cycleTimer();
    });
  }
  timerFilter.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      cycleTimer();
    }
  });

  // Difficulty filter
  const diffFilter = qs("#difficultyFilter");
  diffFilter.addEventListener("click", cycleDifficulty);
  // Also allow clicking the whole group (incl. label)
  const diffGroup = diffFilter ? diffFilter.closest(".filter-group") : null;
  if (diffGroup) {
    diffGroup.addEventListener("click", (e) => {
      if (diffFilter.contains(e.target)) return;
      cycleDifficulty();
    });
  }
  diffFilter.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      cycleDifficulty();
    }
  });

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (
      e.target &&
      ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(e.target.tagName)
    )
      return;

    // In révision mode, arrow keys trigger OK/Pas OK
    if (state.revisionMode) {
      if (e.key === "ArrowLeft") markCardPasOK();
      else if (e.key === "ArrowRight") markCardOK();
      else if (e.key === " ") {
        e.preventDefault();
        if (!state.isTransitioning) {
          setFlipped(!state.flipped);
        }
      }
    } else {
      // In lecture mode, arrow keys navigate
      if (e.key === "ArrowRight") nextCard();
      else if (e.key === "ArrowLeft") prevCard();
      else if (e.key === " ") {
        e.preventDefault();
        if (!state.isTransitioning) {
          setFlipped(!state.flipped);
        }
      } else if (
        e.key.toLowerCase() === "r" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !state.showFavouritesOnly
      ) {
        toggleShuffle();
      } else if (e.key.toLowerCase() === "f" && !e.ctrlKey && !e.metaKey) {
        toggleFavouritesOnly();
      } else if (e.key.toLowerCase() === "b" && !e.ctrlKey && !e.metaKey) {
        // Keyboard shortcut for bookmarking
        const currentCard = getCurrentCard();
        if (currentCard) {
          toggleFavourite(currentCard);
          updateBookmarkButton();
        }
      }
    }
  });
}

(async function init() {
  bindUI();
  updateShuffleUI();
  updateFavouritesUI();
  updateRevisionUI();
  updateTimerUI();
  updateDifficultyUI();

  showSkeleton();
  const chapters = await discoverChapters();

  if (!chapters.length) {
    hideSkeleton();
    qs("#counter").textContent =
      "Aucun chapitre trouvé (dossier 'flashcards/chN_cartes').";
    return;
  }

  const initial = buildChapterSelect(chapters);
  await loadChapter(initial);

  // Check and show welcome modal if needed
  checkWelcomeModal();
})();
