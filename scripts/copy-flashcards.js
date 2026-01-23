import { cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const sourceDir = path.join(rootDir, 'flashcards');
const targetDir = path.join(rootDir, 'dist', 'flashcards');

async function exists(dir) {
  try {
    await stat(dir);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(sourceDir))) {
    console.warn('[copy-flashcards] No flashcards directory found, skipping.');
    return;
  }

  await rm(targetDir, { recursive: true, force: true });
  await cp(sourceDir, targetDir, { recursive: true });
  console.log(`[copy-flashcards] Copied flashcards to ${path.relative(rootDir, targetDir)}`);
}

main().catch((err) => {
  console.error('[copy-flashcards] Failed to copy flashcards:', err);
  process.exit(1);
});
