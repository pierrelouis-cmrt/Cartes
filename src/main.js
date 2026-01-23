/**
 * Cartes - Flashcard Application
 * Entry point
 */

import './styles.css';
import { state } from './state.js';
import { qs } from './utils/helpers.js';
import { discoverChapters, loadChapter } from './features/chapters.js';
import { swipeGesture } from './features/swipe.js';
import { bindUI, checkWelcomeModal, initInfoTooltip, initTouchDetection } from './ui/events.js';
import {
  showSkeleton,
  hideSkeleton,
  updateShuffleUI,
  updateFavouritesUI,
  updateRevisionUI,
  updateTimerUI,
  updateDifficultyUI,
} from './ui/updates.js';

/**
 * Build the chapter select dropdown
 * @param {number[]} chapters
 * @returns {number}
 */
function buildChapterSelect(chapters) {
  const sel = qs('#chapterSelect');
  sel.innerHTML = '';
  chapters.forEach((n) => {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = `Chapitre ${n}`;
    sel.appendChild(opt);
  });
  const defaultChapter = chapters[chapters.length - 1];
  const initial = defaultChapter;
  sel.value = String(initial);
  sel.addEventListener('change', async (e) => {
    const val = parseInt(e.target.value, 10);
    await loadChapter(val);
  });
  return initial;
}

/**
 * Initialize the application
 */
async function init() {
  // Early touch detection
  initTouchDetection();

  // Restore body class for revision mode if needed
  if (state.revisionMode) {
    document.body.classList.add('mode-revision');
  }

  // Set up event listeners
  bindUI();
  initInfoTooltip();
  swipeGesture.init();

  // Initialize UI state
  updateShuffleUI();
  updateFavouritesUI();
  updateRevisionUI();
  updateTimerUI();
  updateDifficultyUI();

  // Load chapters
  showSkeleton();
  const chapters = await discoverChapters();

  if (!chapters.length) {
    hideSkeleton();
    qs('#counter').textContent = "Aucun chapitre trouvé (dossier 'flashcards/chN_cartes').";
    return;
  }

  const initial = buildChapterSelect(chapters);
  await loadChapter(initial);

  // Check and show welcome modal if needed
  checkWelcomeModal();
}

// Start the application
init();
