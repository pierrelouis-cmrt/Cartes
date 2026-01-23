/**
 * UI state synchronization and updates
 */

import { state, getCurrentCard, getCurrentRevisionDeck } from '../state.js';
import { TIMER_STATES, DIFFICULTY_STATES } from '../config.js';
import { qs, waitAnimationEnd } from '../utils/helpers.js';
import { UMAMI_EVENTS, trackUmamiEvent } from '../utils/analytics.js';
import { loadFrontImage, loadBackImage } from '../core/image-loader.js';
import { loadFavourites } from '../core/storage.js';
import { storeCurrentCard } from '../core/storage.js';
import { preloadNearbyCards } from '../core/preloader.js';
import { processNavQueue, rebuildDeck } from '../features/navigation.js';

// ==================== Modal State ====================

let modalScrollY = 0;
let modalLockActive = false;

function updateModalOpenState() {
  if (!document.body) return;
  const hasOpenModal = Boolean(qs('.modal.show'));
  if (hasOpenModal && !modalLockActive) {
    modalScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.top = `-${modalScrollY}px`;
    document.body.classList.add('modal-open');
    modalLockActive = true;
  } else if (!hasOpenModal && modalLockActive) {
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    window.scrollTo(0, modalScrollY);
    modalLockActive = false;
  }
}

export function setModalVisibility(modal, shouldShow) {
  if (!modal) return;
  modal.classList.toggle('show', shouldShow);
  updateModalOpenState();
}

// ==================== Skeleton ====================

export function showSkeleton() {
  const skeleton = qs('#skeleton');
  skeleton.classList.add('visible');
}

export function hideSkeleton() {
  const skeleton = qs('#skeleton');
  skeleton.classList.remove('visible');
}

// ==================== Stage Sizing ====================

export function sizeStageForImage(naturalW, naturalH) {
  const stage = qs('#stage');
  const maxWidth = Math.min(window.innerWidth * 0.9, 900);
  const availableHeight = window.innerHeight - 300;
  const maxHeight = Math.max(availableHeight, 200);

  const widthByHeight = maxHeight * (naturalW / naturalH);
  const finalWidth = Math.min(maxWidth, widthByHeight);
  const finalHeight = finalWidth * (naturalH / naturalW);

  stage.style.width = `${finalWidth}px`;
  stage.style.height = `${finalHeight}px`;
}

// ==================== Card Display ====================

export function setFlipped(on) {
  state.flipped = on;
  trackUmamiEvent(UMAMI_EVENTS.cardFlip, {
    mode: state.revisionMode ? 'revision' : 'lecture',
    side: on ? 'back' : 'front',
  });
  const card3d = qs('#card3d');
  card3d.classList.add('flipping');
  setTimeout(() => card3d.classList.remove('flipping'), 600);
  card3d.classList.toggle('flipped', on);
  card3d.setAttribute('aria-pressed', String(on));
}

export async function showCurrent(direction = 'none', options = {}) {
  if (state.isTransitioning) return;

  const keepHidden = Boolean(options.keepHidden);

  const n = getCurrentCard();
  if (!n) return;

  const size = state.sizes[n];
  if (size && size.w > 0 && size.h > 0) {
    sizeStageForImage(size.w, size.h);
  }

  const cardShell = qs('#cardShell');
  const card3d = qs('#card3d');
  const frontImg = qs('#frontImg');
  const backImg = qs('#backImg');

  const isFirstLoad = !state.imagesLoaded.has(n);
  if (isFirstLoad) {
    showSkeleton();
  }

  state.isTransitioning = true;

  const finishTransition = () => {
    state.isTransitioning = false;
    updateNavButtons();
    if (n) {
      storeCurrentCard(n);
    }
    preloadNearbyCards();
    processNavQueue();
  };

  const swapImages = async () => {
    if (state.flipped) {
      card3d.classList.add('no-anim');
      card3d.classList.remove('flipped', 'flipping');
      card3d.setAttribute('aria-pressed', 'false');
      state.flipped = false;
      void card3d.offsetHeight;
      card3d.classList.remove('no-anim');
    }

    frontImg.classList.remove('loaded');
    backImg.classList.remove('loaded');

    const [front, back] = await Promise.all([loadFrontImage(n), loadBackImage(n)]);

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
    frontImg.classList.add('loaded');
    backImg.classList.add('loaded');

    if (!keepHidden) {
      cardShell.style.opacity = '';
      cardShell.style.visibility = '';
      cardShell.style.transition = '';
    }

    hideSkeleton();
    updateCounter();
    updateBookmarkButton();
  };

  if (direction === 'none') {
    await swapImages();
    finishTransition();
    return;
  }

  const outClass = direction === 'next' ? 'out-left' : 'out-right';
  const outName = direction === 'next' ? 'outLeft' : 'outRight';
  const inClass = direction === 'next' ? 'in-right' : 'in-left';
  const inName = direction === 'next' ? 'inRight' : 'inLeft';

  const useInstant = Boolean(options && options.instant);

  cardShell.classList.remove('out-left', 'out-right', 'in-left', 'in-right');
  void cardShell.offsetWidth;

  if (useInstant) {
    await swapImages();
    finishTransition();
    return;
  }

  cardShell.classList.add(outClass);
  await waitAnimationEnd(cardShell, outName, 400);

  await swapImages();

  cardShell.classList.remove(outClass);
  void cardShell.offsetWidth;
  cardShell.classList.add(inClass);
  await waitAnimationEnd(cardShell, inName, 500);
  cardShell.classList.remove(inClass);

  finishTransition();
}

// ==================== Counter ====================

export function updateCounter() {
  const el = qs('#counter');
  if (!state.deck.length) {
    if (state.showFavouritesOnly) {
      el.textContent = 'Aucun favori disponible.';
    } else {
      el.textContent = 'Aucune image trouvée.';
    }
    return;
  }

  const currentCard = getCurrentCard();
  if (!currentCard) {
    el.textContent = 'Aucune carte sélectionnée.';
    return;
  }

  if (state.revisionMode) {
    const currentDeck = getCurrentRevisionDeck();
    const remaining = currentDeck.length - state.revisionSeen.size;
    const roundText = state.revisionRound > 1 ? `Tour ${state.revisionRound} · ` : '';
    if (remaining > 0) {
      el.textContent = `${roundText}${remaining} carte${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}`;
    } else {
      el.textContent = `${roundText}Dernière carte !`;
    }
  } else if (state.showFavouritesOnly) {
    const position = state.deck.indexOf(currentCard);
    const displayNumber = position >= 0 ? position + 1 : currentCard || '?';
    el.textContent = `Favori ${displayNumber} sur ${state.deck.length}`;
  } else {
    el.textContent = `Carte n°${currentCard}, ${state.deck.length} résultats`;
  }
}

// ==================== Bookmark ====================

export function updateBookmarkButton() {
  const btn = qs('#bookmarkBtn');
  if (!btn) return;
  const currentCard = getCurrentCard();
  const favourites = loadFavourites();
  const isFavourite = favourites.has(currentCard);
  btn.classList.toggle('active', isFavourite);
  btn.setAttribute('aria-pressed', String(isFavourite));
  const textEl = btn.querySelector('.btn-text');
  if (textEl) {
    textEl.textContent = isFavourite ? 'Retirer' : 'Ajouter';
  }
  btn.setAttribute('aria-label', isFavourite ? 'Retirer des favoris' : 'Ajouter aux favoris');
}

export function updateFavouritesCount() {
  const count = loadFavourites().size;
  const countEl = qs('#favouritesCount');
  if (countEl) countEl.textContent = count.toString();
}

// ==================== Navigation Buttons ====================

export function updateNavButtons() {
  const prev = qs('#prevBtn');
  const next = qs('#nextBtn');

  if (state.shuffle) {
    if (prev) prev.disabled = state.historyIndex <= 0;
  } else {
    if (prev) prev.disabled = false;
  }

  if (next) next.disabled = state.deck.length === 0;
}

// ==================== Mode/Filter UI ====================

export function updateRevisionUI() {
  const modeToggle = qs('#modeToggle');
  if (modeToggle) {
    modeToggle.classList.toggle('active', state.revisionMode);
    const textEl = modeToggle.querySelector('.toggle-text');
    if (textEl) {
      textEl.textContent = state.revisionMode ? 'Lecture' : 'Révision';
    }
  }

  const prevBtn = qs('#prevBtn');
  const nextBtn = qs('#nextBtn');
  const bookmarkBtn = qs('#bookmarkBtn');
  const pasOkBtn = qs('#pasOkBtn');
  const okBtn = qs('#okBtn');

  if (state.revisionMode) {
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
    if (bookmarkBtn) bookmarkBtn.style.display = 'none';
    if (pasOkBtn) pasOkBtn.style.display = '';
    if (okBtn) okBtn.style.display = '';
  } else {
    if (prevBtn) prevBtn.style.display = '';
    if (nextBtn) nextBtn.style.display = '';
    if (bookmarkBtn) bookmarkBtn.style.display = '';
    if (pasOkBtn) pasOkBtn.style.display = 'none';
    if (okBtn) okBtn.style.display = 'none';
  }

  const randomToggle = qs('#randomToggle');
  const favToggle = qs('#favouritesToggle');
  const timerGroup = qs('#timerFilter')?.closest('.filter-group');
  const diffGroup = qs('#difficultyFilter')?.closest('.filter-group');

  if (state.revisionMode) {
    if (randomToggle) randomToggle.style.display = 'none';
    if (favToggle) favToggle.style.display = 'none';
    if (timerGroup) timerGroup.style.display = 'none';
    if (diffGroup) diffGroup.style.display = 'none';
  } else {
    if (randomToggle) randomToggle.style.display = '';
    if (favToggle) favToggle.style.display = '';
    if (timerGroup) timerGroup.style.display = '';
    if (diffGroup) diffGroup.style.display = '';
  }

  const restartBtn = qs('#restartRevisionInlineBtn');
  if (restartBtn) {
    restartBtn.style.display = state.revisionMode ? '' : 'none';
  }
}

export function updateShuffleUI() {
  const toggle = qs('#randomToggle');
  if (!toggle) return;
  const disabled = state.showFavouritesOnly || state.revisionMode;
  toggle.classList.toggle('active', state.shuffle);
  toggle.classList.toggle('disabled', disabled);
  toggle.setAttribute('aria-checked', String(state.shuffle));
  toggle.setAttribute('aria-disabled', String(disabled));
  toggle.setAttribute('tabindex', disabled ? '-1' : '0');
}

export function updateFavouritesUI() {
  const toggle = qs('#favouritesToggle');
  if (!toggle) return;
  const disabled = state.revisionMode;
  toggle.classList.toggle('active', state.showFavouritesOnly);
  toggle.classList.toggle('disabled', disabled);
  toggle.setAttribute('aria-checked', String(state.showFavouritesOnly));
  toggle.setAttribute('aria-disabled', String(disabled));
  toggle.setAttribute('tabindex', disabled ? '-1' : '0');
}

export function updateTimerUI() {
  const pills = qs('#timerFilter');
  if (pills) {
    pills.setAttribute('data-level', state.filterTimer);
  }
}

export function updateDifficultyUI() {
  const pills = qs('#difficultyFilter');
  if (pills) {
    pills.setAttribute('data-level', state.filterDifficulty);
  }
}

// ==================== Filter Cycling ====================

export function cycleTimer() {
  if (state.revisionMode) return;

  const currentIndex = TIMER_STATES.indexOf(state.filterTimer);
  const nextIndex = (currentIndex + 1) % TIMER_STATES.length;
  state.filterTimer = TIMER_STATES[nextIndex];
  trackUmamiEvent(UMAMI_EVENTS.filterGroup, {
    group: 'timer',
    level: state.filterTimer,
  });
  updateTimerUI();

  const keep = getCurrentCard();
  rebuildDeck(keep);
  if (!state.deck.length) {
    qs('#counter').textContent = 'Aucune carte disponible pour ce filtre.';
    hideSkeleton();
    updateNavButtons();
    return;
  }
  showCurrent();
}

export function cycleDifficulty() {
  if (state.revisionMode) return;

  const currentIndex = DIFFICULTY_STATES.indexOf(state.filterDifficulty);
  const nextIndex = (currentIndex + 1) % DIFFICULTY_STATES.length;
  state.filterDifficulty = DIFFICULTY_STATES[nextIndex];
  trackUmamiEvent(UMAMI_EVENTS.filterGroup, {
    group: 'difficulty',
    level: state.filterDifficulty,
  });
  updateDifficultyUI();

  const keep = getCurrentCard();
  rebuildDeck(keep);
  if (!state.deck.length) {
    qs('#counter').textContent = 'Aucune carte disponible pour ce filtre.';
    hideSkeleton();
    updateNavButtons();
    return;
  }
  showCurrent();
}
