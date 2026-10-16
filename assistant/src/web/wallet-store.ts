const HANDLES_KEY = 'p2p-ledger:wallets';

export interface SavedWallet {
  id: string;
  owner: string;
  live: boolean;
  savedAt: string;
}

export function loadSavedWallets(): SavedWallet[] {
  try {
    const raw = localStorage.getItem(HANDLES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedWallet[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function rememberWallet(wallet: SavedWallet): void {
  const list = loadSavedWallets().filter((w) => w.id !== wallet.id);
  list.unshift(wallet);
  localStorage.setItem(HANDLES_KEY, JSON.stringify(list.slice(0, 12)));
}
