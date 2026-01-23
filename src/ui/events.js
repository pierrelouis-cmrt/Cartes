/**
 * UI event bindings
 */

import { state, getCurrentCard } from '../state.js';
import { qs } from '../utils/helpers.js';
import { UMAMI_EVENTS, trackUmamiEvent } from '../utils/analytics.js';
import { WELCOME_MODAL_ENABLED, WELCOME_MODAL_VERSION } from '../config.js';
import { toggleFavourite } from '../core/storage.js';
import { nextCard, prevCard, toggleShuffle, toggleFavouritesOnly } from '../features/navigation.js';
import {
  toggleRevisionMode,
  markCardOK,
  markCardPasOK,
  restartRevisionSession,
} from '../features/revision-mode.js';
import { swipeGesture } from '../features/swipe.js';
import {
  setFlipped,
  setModalVisibility,
  cycleTimer,
  cycleDifficulty,
  updateBookmarkButton,
  updateFavouritesCount,
} from './updates.js';

/**
 * Bind all UI event listeners
 */
export function bindUI() {
  const shell = qs('#cardShell');

  // Card click to flip
  shell.addEventListener('click', () => {
    // Don't flip if we were swiping
    if (swipeGesture && swipeGesture.hasMovedHorizontally) return;
    if (!state.isTransitioning) {
      setFlipped(!state.flipped);
    }
  });

  // Bookmark button
  const bookmarkBtn = qs('#bookmarkBtn');
  if (bookmarkBtn) {
    bookmarkBtn.addEventListener('click', () => {
      const currentCard = getCurrentCard();
      if (currentCard) {
        toggleFavourite(currentCard);
        updateBookmarkButton();
        updateFavouritesCount();
      }
    });
  }

  // Navigation buttons
  const nextBtn = qs('#nextBtn');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      trackUmamiEvent(UMAMI_EVENTS.nextButton, {
        mode: state.revisionMode ? 'revision' : 'lecture',
      });
      nextCard();
    });
  }
  qs('#prevBtn').addEventListener('click', prevCard);

  // Revision mode buttons
  const pasOkBtn = qs('#pasOkBtn');
  const okBtn = qs('#okBtn');
  if (pasOkBtn) {
    pasOkBtn.addEventListener('click', markCardPasOK);
  }
  if (okBtn) {
    okBtn.addEventListener('click', markCardOK);
  }

  // Mode toggle
  const modeToggle = qs('#modeToggle');
  if (modeToggle) {
    modeToggle.addEventListener('click', () => {
      toggleRevisionMode();
      trackUmamiEvent(UMAMI_EVENTS.modeToggle, {
        mode: state.revisionMode ? 'revision' : 'lecture',
      });
    });
  }

  // Revision complete modal buttons
  const restartRevisionBtn = qs('#restartRevisionBtn');
  const backToLectureBtn = qs('#backToLectureBtn');
  if (restartRevisionBtn) {
    restartRevisionBtn.addEventListener('click', () => {
      restartRevisionSession();
      const modal = qs('#revisionCompleteModal');
      setModalVisibility(modal, false);
    });
  }
  if (backToLectureBtn) {
    backToLectureBtn.addEventListener('click', () => {
      const modal = qs('#revisionCompleteModal');
      setModalVisibility(modal, false);
      toggleRevisionMode();
    });
  }

  // Welcome modal dismiss button
  const dismissWelcomeBtn = qs('#dismissWelcomeBtn');
  if (dismissWelcomeBtn) {
    dismissWelcomeBtn.addEventListener('click', dismissWelcomeModal);
  }

  // Inline restart button
  const restartRevisionInlineBtn = qs('#restartRevisionInlineBtn');
  if (restartRevisionInlineBtn) {
    restartRevisionInlineBtn.addEventListener('click', () => {
      if (confirm('Recommencer la révision depuis le début ?')) {
        restartRevisionSession();
      }
    });
  }

  // Random toggle
  const randomToggle = qs('#randomToggle');
  if (randomToggle) {
    randomToggle.addEventListener('click', () => {
      if (randomToggle.classList.contains('disabled')) return;
      const wasShuffle = state.shuffle;
      toggleShuffle();
      if (state.shuffle !== wasShuffle) {
        trackUmamiEvent(UMAMI_EVENTS.randomToggle, {
          enabled: state.shuffle,
          mode: state.revisionMode ? 'revision' : 'lecture',
        });
      }
    });
    randomToggle.addEventListener('keydown', (e) => {
      if (randomToggle.classList.contains('disabled')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const wasShuffle = state.shuffle;
        toggleShuffle();
        if (state.shuffle !== wasShuffle) {
          trackUmamiEvent(UMAMI_EVENTS.randomToggle, {
            enabled: state.shuffle,
            mode: state.revisionMode ? 'revision' : 'lecture',
          });
        }
      }
    });
  }

  // Favourites toggle
  const favouritesToggle = qs('#favouritesToggle');
  if (favouritesToggle) {
    favouritesToggle.addEventListener('click', () => {
      const wasFavouritesOnly = state.showFavouritesOnly;
      toggleFavouritesOnly();
      if (state.showFavouritesOnly !== wasFavouritesOnly) {
        trackUmamiEvent(UMAMI_EVENTS.favouritesToggle, {
          enabled: state.showFavouritesOnly,
          mode: state.revisionMode ? 'revision' : 'lecture',
        });
      }
    });
    favouritesToggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const wasFavouritesOnly = state.showFavouritesOnly;
        toggleFavouritesOnly();
        if (state.showFavouritesOnly !== wasFavouritesOnly) {
          trackUmamiEvent(UMAMI_EVENTS.favouritesToggle, {
            enabled: state.showFavouritesOnly,
            mode: state.revisionMode ? 'revision' : 'lecture',
          });
        }
      }
    });
  }

  // Timer filter
  const timerFilter = qs('#timerFilter');
  timerFilter.addEventListener('click', cycleTimer);
  const timerGroup = timerFilter ? timerFilter.closest('.filter-group') : null;
  if (timerGroup) {
    timerGroup.addEventListener('click', (e) => {
      if (timerFilter.contains(e.target)) return;
      cycleTimer();
    });
  }
  timerFilter.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      cycleTimer();
    }
  });

  // Difficulty filter
  const diffFilter = qs('#difficultyFilter');
  diffFilter.addEventListener('click', cycleDifficulty);
  const diffGroup = diffFilter ? diffFilter.closest('.filter-group') : null;
  if (diffGroup) {
    diffGroup.addEventListener('click', (e) => {
      if (diffFilter.contains(e.target)) return;
      cycleDifficulty();
    });
  }
  diffFilter.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      cycleDifficulty();
    }
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName)) return;

    if (state.revisionMode) {
      if (e.key === 'ArrowLeft') markCardPasOK();
      else if (e.key === 'ArrowRight') markCardOK();
      else if (e.key === ' ') {
        e.preventDefault();
        if (!state.isTransitioning) {
          setFlipped(!state.flipped);
        }
      }
    } else {
      if (e.key === 'ArrowRight') nextCard();
      else if (e.key === 'ArrowLeft') prevCard();
      else if (e.key === ' ') {
        e.preventDefault();
        if (!state.isTransitioning) {
          setFlipped(!state.flipped);
        }
      } else if (
        e.key.toLowerCase() === 'r' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !state.showFavouritesOnly
      ) {
        toggleShuffle();
      } else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
        toggleFavouritesOnly();
      } else if (e.key.toLowerCase() === 'b' && !e.ctrlKey && !e.metaKey) {
        const currentCard = getCurrentCard();
        if (currentCard) {
          toggleFavourite(currentCard);
          updateBookmarkButton();
          updateFavouritesCount();
        }
      }
    }
  });
}

// ==================== Welcome Modal ====================

export function checkWelcomeModal() {
  if (!WELCOME_MODAL_ENABLED) return;
  const seenVersion = localStorage.getItem('fc_welcome_modal_version');
  if (seenVersion !== WELCOME_MODAL_VERSION) {
    showWelcomeModal();
  }
}

export function showWelcomeModal() {
  const modal = qs('#welcomeModal');
  setModalVisibility(modal, true);
}

export function dismissWelcomeModal() {
  const modal = qs('#welcomeModal');
  if (modal) {
    setModalVisibility(modal, false);
    localStorage.setItem('fc_welcome_modal_version', WELCOME_MODAL_VERSION);
  }
}

// ==================== Info Tooltip ====================

export function initInfoTooltip() {
  const infoBtn = document.getElementById('infoBtn');
  const helpTooltip = document.getElementById('helpTooltip');

  if (infoBtn && helpTooltip) {
    let tooltipVisible = false;
    let repositionFrame = null;

    const resetTooltipStyles = () => {
      helpTooltip.style.position = '';
      helpTooltip.style.top = '';
      helpTooltip.style.left = '';
      helpTooltip.style.right = '';
      helpTooltip.style.bottom = '';
      helpTooltip.style.removeProperty('--tooltip-offset-x');
      helpTooltip.dataset.placement = 'bottom';
    };

    const closeTooltip = () => {
      if (!tooltipVisible) return;
      tooltipVisible = false;
      helpTooltip.classList.add('hidden');
      helpTooltip.setAttribute('aria-hidden', 'true');
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

      helpTooltip.style.position = 'fixed';
      helpTooltip.style.right = 'auto';
      helpTooltip.style.bottom = 'auto';
      helpTooltip.dataset.placement = 'bottom';

      const anchorX = buttonRect.left + buttonRect.width / 2;
      helpTooltip.style.left = `${anchorX}px`;
      helpTooltip.style.setProperty('--tooltip-offset-x', '0px');

      const tooltipRect = helpTooltip.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const halfWidth = tooltipRect.width / 2;

      const leftBoundary = anchorX - halfWidth;
      const rightBoundary = anchorX + halfWidth;
      const overflowLeft = Math.max(spacing - leftBoundary, 0);
      const overflowRight = Math.max(rightBoundary - (viewportWidth - spacing), 0);
      const offsetX = overflowLeft - overflowRight;
      helpTooltip.style.setProperty('--tooltip-offset-x', `${offsetX}px`);

      let top = buttonRect.bottom + spacing;
      let placement = 'bottom';

      if (top + tooltipRect.height > viewportHeight - spacing) {
        const aboveTop = buttonRect.top - spacing - tooltipRect.height;
        if (aboveTop >= spacing) {
          top = aboveTop;
          placement = 'top';
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
      helpTooltip.classList.remove('hidden');
      helpTooltip.setAttribute('aria-hidden', 'false');
      scheduleTooltipReposition();
    };

    infoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (tooltipVisible) {
        closeTooltip();
      } else {
        openTooltip();
      }
    });

    document.addEventListener('click', (e) => {
      if (!infoBtn.contains(e.target) && !helpTooltip.contains(e.target)) {
        closeTooltip();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && tooltipVisible) {
        closeTooltip();
        infoBtn.focus();
      }
    });

    const handleViewportChange = () => {
      if (!tooltipVisible) return;
      scheduleTooltipReposition();
    };

    window.addEventListener('resize', handleViewportChange, { passive: true });
    window.addEventListener('scroll', handleViewportChange, { passive: true });
  }
}

// ==================== Touch Detection ====================

export function initTouchDetection() {
  try {
    const isTouch =
      'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;
    if (isTouch) document.documentElement.classList.add('is-touch');
  } catch {
    // Ignore touch detection errors
  }
}
