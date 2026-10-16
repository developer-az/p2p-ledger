const STORY_KEY = 'p2p-ledger:story-complete';

export function isStoryComplete(): boolean {
  try {
    return localStorage.getItem(STORY_KEY) === '1';
  } catch {
    return false;
  }
}

export function markStoryComplete(): void {
  try {
    localStorage.setItem(STORY_KEY, '1');
  } catch {
    /* private mode */
  }
}

export function clearStoryComplete(): void {
  try {
    localStorage.removeItem(STORY_KEY);
  } catch {
    /* ignore */
  }
}
