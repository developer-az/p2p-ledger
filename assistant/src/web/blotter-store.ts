const HIDDEN_KEY = (accountId: string) => `bb-blotter-hidden:${accountId}`;
const SKIP_CONFIRM_KEY = 'bb-delete-skip-until';

export function loadHiddenTransfers(accountId: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(HIDDEN_KEY(accountId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function saveHiddenTransfers(accountId: string, ids: Set<string>): void {
  sessionStorage.setItem(HIDDEN_KEY(accountId), JSON.stringify([...ids]));
}

export function deleteConfirmSkipped(): boolean {
  const until = Number(sessionStorage.getItem(SKIP_CONFIRM_KEY) ?? '0');
  return Date.now() < until;
}

export function setDeleteConfirmSkip(minutes = 1): void {
  sessionStorage.setItem(SKIP_CONFIRM_KEY, String(Date.now() + minutes * 60_000));
}
