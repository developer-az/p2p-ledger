/**
 * Command palette ranking: pure, no DOM, no React.
 *
 * `scoreMatch` grades one query against one string: prefix (3) beats word
 * start (2), which beats a scattered subsequence (1). A blank query is a weak
 * match for everything, so an empty palette box lists the actions. Everything
 * is compared lower-cased and trimmed.
 *
 * `rankPalette` scores each item by the best of its label and its keywords,
 * drops zeros, keeps the best few transactions (default 8), then sorts by
 * score, commands before transactions on a tie, and input order last. Callers
 * render `hint` and amounts; ranking never formats anything.
 */

/** One row the palette can show, either an action or a transaction. */
export interface PaletteItem {
  id: string;
  label: string;
  kind: 'command' | 'transaction';
  hint?: string;
  keywords?: string[];
}

export interface RankPaletteOptions {
  /** How many transaction rows survive, at most. Defaults to 8. */
  maxTransactions?: number;
}

const DEFAULT_MAX_TRANSACTIONS = 8;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** True when every character of `needle` appears in `haystack`, in order. */
function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (let i = 0; i < haystack.length && at < needle.length; i += 1) {
    if (haystack[i] === needle[at]) at += 1;
  }
  return at === needle.length;
}

/**
 * Grades `query` against `text`: 3 prefix, 2 word start, 1 subsequence, 0 no
 * match. A blank query scores 1 against anything.
 */
export function scoreMatch(query: string, text: string): number {
  const needle = normalize(query);
  if (needle === '') return 1;

  const haystack = normalize(text);
  if (haystack === '') return 0;
  if (haystack.startsWith(needle)) return 3;
  if (haystack.split(/\s+/).some((word) => word.startsWith(needle))) return 2;
  return isSubsequence(needle, haystack) ? 1 : 0;
}

interface RankedEntry {
  item: PaletteItem;
  score: number;
  /** Position in the array the item came from, for stable ties. */
  index: number;
  /** Whether the item came from `commands`, which win ties. */
  isCommand: boolean;
}

function scoreItem(query: string, item: PaletteItem): number {
  let best = scoreMatch(query, item.label);
  for (const keyword of item.keywords ?? []) {
    best = Math.max(best, scoreMatch(query, keyword));
  }
  return best;
}

function collect(query: string, items: readonly PaletteItem[], isCommand: boolean): RankedEntry[] {
  const entries: RankedEntry[] = [];
  items.forEach((item, index) => {
    const score = scoreItem(query, item);
    if (score > 0) entries.push({ item, score, index, isCommand });
  });
  return entries;
}

function byScoreThenSource(a: RankedEntry, b: RankedEntry): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.isCommand !== b.isCommand) return a.isCommand ? -1 : 1;
  return a.index - b.index;
}

/**
 * Returns the palette rows for `query`. A blank query lists every command in
 * order and no transactions; otherwise zero-score rows are dropped, only the
 * best `maxTransactions` transactions are kept, and the result is sorted by
 * score, then commands before transactions, then input order.
 *
 * Neither input array nor its items are modified.
 */
export function rankPalette(
  query: string,
  commands: readonly PaletteItem[],
  transactions: readonly PaletteItem[],
  opts: RankPaletteOptions = {},
): PaletteItem[] {
  if (normalize(query) === '') return [...commands];

  const maxTransactions = opts.maxTransactions ?? DEFAULT_MAX_TRANSACTIONS;

  // Stable sort before the cap, so equal-scoring transactions keep input order.
  const transactionHits = collect(query, transactions, false)
    .sort(byScoreThenSource)
    .slice(0, maxTransactions);

  return [...collect(query, commands, true), ...transactionHits]
    .sort(byScoreThenSource)
    .map((entry) => entry.item);
}
