import type { SpendCategory } from '../spend-log.js';
import { cleanDescriptor } from './descriptor.js';

/**
 * Merchant catalog and resolver.
 *
 * Exact aliases are authoritative: a descriptor a person corrected yesterday
 * must resolve the same way today, so an alias hit beats any fuzzy score. When
 * no alias matches, a trigram Dice score in plain TypeScript (no pg_trgm, no
 * extension to install) proposes the nearest name. The default threshold is
 * conservative: a wrong category is worse than an "unresolved" row a person can
 * fix in one click.
 */

export interface MerchantRecord {
  id: string;
  name: string;
  domain: string | null;
  defaultCategory: SpendCategory | null;
  aliases: string[];
}

export type MerchantMethod = 'exact_alias' | 'similarity' | 'unresolved';

export interface MerchantMatch {
  merchant: MerchantRecord | null;
  method: MerchantMethod;
  confidence: number;
}

export interface ResolveOptions {
  threshold?: number;
}

/** Conservative default selected by scripts/eval-merchants.ts. */
export const MERCHANT_SIMILARITY_THRESHOLD = 0.62;

const CATALOG: Array<[id: string, name: string, category: SpendCategory, domain: string | null, aliases: string[]]> = [
  ['m_starbucks', 'Starbucks', 'dining', 'starbucks.com', ['STARBUCKS COFFEE', 'SBUX']],
  ['m_blue_bottle', 'Blue Bottle Coffee', 'dining', 'bluebottlecoffee.com', ['BLUE BOTTLE', 'BLUE BOTTLE COFFEE']],
  ['m_chipotle', 'Chipotle Mexican Grill', 'dining', 'chipotle.com', ['CHIPOTLE']],
  ['m_mcdonalds', 'McDonald\'s', 'dining', 'mcdonalds.com', ['MCDONALDS', 'MCDONALD S']],
  ['m_sweetgreen', 'Sweetgreen', 'dining', 'sweetgreen.com', ['SWEETGREEN NYC']],
  ['m_shake_shack', 'Shake Shack', 'dining', 'shakeshack.com', ['SHAKE SHACK']],
  ['m_doordash', 'DoorDash', 'dining', 'doordash.com', ['DOORDASH', 'DD DOORDASH']],
  ['m_uber_eats', 'Uber Eats', 'dining', 'ubereats.com', ['UBER EATS', 'UBEREATS']],
  ['m_grubhub', 'Grubhub', 'dining', 'grubhub.com', ['GRUBHUB', 'GRUB HUB']],
  ['m_trader_joes', 'Trader Joe\'s', 'groceries', 'traderjoes.com', ['TRADER JOES', 'TRADER JOE S']],
  ['m_whole_foods', 'Whole Foods Market', 'groceries', 'wholefoodsmarket.com', ['WHOLE FOODS', 'WHOLEFDS', 'WHOLE FOODS MKT']],
  ['m_safeway', 'Safeway', 'groceries', 'safeway.com', ['SAFEWAY']],
  ['m_kroger', 'Kroger', 'groceries', 'kroger.com', ['KROGER', 'KROGER FUEL']],
  ['m_costco', 'Costco Wholesale', 'groceries', 'costco.com', ['COSTCO', 'COSTCO WHSE']],
  ['m_walmart', 'Walmart', 'groceries', 'walmart.com', ['WALMART', 'WAL MART']],
  ['m_target', 'Target', 'shopping', 'target.com', ['TARGET', 'TARGET T']],
  ['m_amazon', 'Amazon', 'shopping', 'amazon.com', ['AMAZON', 'AMAZON MKTPLACE']],
  ['m_best_buy', 'Best Buy', 'shopping', 'bestbuy.com', ['BEST BUY']],
  ['m_home_depot', 'Home Depot', 'shopping', 'homedepot.com', ['HOME DEPOT', 'THE HOME DEPOT']],
  ['m_apple', 'Apple', 'shopping', 'apple.com', ['APPLE STORE', 'APPLE COM BILL']],
  ['m_etsy', 'Etsy', 'shopping', 'etsy.com', ['ETSY', 'ETSY INC']],
  ['m_shell', 'Shell', 'transport', 'shell.com', ['SHELL OIL', 'SHELL GAS']],
  ['m_chevron', 'Chevron', 'transport', 'chevron.com', ['CHEVRON', 'CHEVRON GAS']],
  ['m_exxon', 'Exxon', 'transport', 'exxon.com', ['EXXON', 'EXXONMOBIL', 'EXXON MOBIL']],
  ['m_uber', 'Uber', 'transport', 'uber.com', ['UBER', 'UBER TRIP', 'UBER TECH']],
  ['m_lyft', 'Lyft', 'transport', 'lyft.com', ['LYFT', 'LYFT RIDE']],
  ['m_mta', 'MTA', 'transport', 'mta.info', ['MTA', 'MTA NYC TRANSIT', 'METRO TRANSIT']],
  ['m_delta', 'Delta Air Lines', 'transport', 'delta.com', ['DELTA AIR', 'DELTA AIR LINES']],
  ['m_netflix', 'Netflix', 'entertainment', 'netflix.com', ['NETFLIX', 'NETFLIX COM']],
  ['m_spotify', 'Spotify', 'entertainment', 'spotify.com', ['SPOTIFY', 'SPOTIFY USA']],
  ['m_hulu', 'Hulu', 'entertainment', 'hulu.com', ['HULU', 'HULU LLC']],
  ['m_disney', 'Disney Plus', 'entertainment', 'disneyplus.com', ['DISNEY PLUS', 'DISNEY BUNDLE']],
  ['m_amc', 'AMC Theatres', 'entertainment', 'amctheatres.com', ['AMC THEATRES', 'AMC']],
  ['m_comcast', 'Comcast Xfinity', 'housing', 'xfinity.com', ['COMCAST', 'COMCAST XFINITY', 'XFINITY']],
  ['m_verizon', 'Verizon Wireless', 'housing', 'verizon.com', ['VERIZON', 'VERIZON WIRELESS']],
  ['m_att', 'AT&T', 'housing', 'att.com', ['AT AND T', 'AT T', 'ATT']],
  ['m_pge', 'PG&E', 'housing', 'pge.com', ['PG AND E', 'PG E', 'PACIFIC GAS']],
  ['m_cvs', 'CVS Pharmacy', 'health', 'cvs.com', ['CVS', 'CVS PHARMACY']],
  ['m_walgreens', 'Walgreens', 'health', 'walgreens.com', ['WALGREENS', 'WALGREENS PHARMACY']],
  ['m_kaiser', 'Kaiser Permanente', 'health', 'kaiserpermanente.org', ['KAISER', 'KAISER PERMANENTE']],
  ['m_planet_fitness', 'Planet Fitness', 'health', 'planetfitness.com', ['PLANET FITNESS']],
  ['m_petco', 'Petco', 'shopping', 'petco.com', ['PETCO', 'PETCO ANIMAL']],
  ['m_marriott', 'Marriott', 'entertainment', 'marriott.com', ['MARRIOTT', 'MARRIOTT HOTELS']],
];

function catalogMerchant(row: (typeof CATALOG)[number]): MerchantRecord {
  const [id, name, defaultCategory, domain, aliases] = row;
  const merged = new Set<string>([normalizeMerchantName(name), ...aliases.map(normalizeMerchantName)]);
  return { id, name, domain, defaultCategory, aliases: [...merged].sort() };
}

/** A fresh copy per store/account so an alias correction cannot leak between users. */
export function defaultMerchantCatalog(): MerchantRecord[] {
  return CATALOG.map(catalogMerchant);
}

export const MERCHANT_CATALOG: MerchantRecord[] = defaultMerchantCatalog();

/**
 * Alias key used by the store and resolver. Beyond punctuation and processor
 * noise, drop support words and repeated tokens so `UBER TRIP HELP UBER.COM`
 * and `UBER TRIP` share one key. The cleaner's human-facing key keeps them.
 */
export function normalizeMerchantName(raw: string | null | undefined): string {
  const tokens = cleanDescriptor(raw)
    .split(' ')
    .filter((token) => token && token !== 'HELP' && token !== 'SUPPORT');
  return [...new Set(tokens)].join(' ');
}

function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (value: string): Map<string, number> => {
    const padded = ` ${value} `;
    const out = new Map<string, number>();
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      const gram = padded.slice(i, i + 3);
      out.set(gram, (out.get(gram) ?? 0) + 1);
    }
    return out;
  };
  const leftGrams = grams(a);
  const rightGrams = grams(b);
  let overlap = 0;
  for (const [gram, count] of leftGrams) {
    overlap += Math.min(count, rightGrams.get(gram) ?? 0);
  }
  const total = a.length + 2 + b.length + 2;
  return (2 * overlap) / total;
}

/**
 * Normalized edit distance. Trigram overlap is strong for transposed words but
 * weak on short one-letter typos (NETFLX vs NETFLIX scores 0.47), which is the
 * most common bank-feed corruption. Take the better of the two signals.
 */
function editSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 4 || b.length < 4) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      previous[j] = Math.min(previous[j - 1]! + 1, above + 1, diagonal + cost);
      diagonal = above;
    }
  }
  const distance = previous[b.length]!;
  return 1 - distance / Math.max(a.length, b.length);
}

/** Best of trigram Dice and normalized edit similarity. Identical -> 1, unrelated -> near 0. */
export function similarity(left: string, right: string): number {
  const a = normalizeMerchantName(left).replace(/\s+/g, ' ');
  const b = normalizeMerchantName(right).replace(/\s+/g, ' ');
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.abs(a.length - b.length) > 3) return dice(a, b);
  return Math.max(dice(a, b), editSimilarity(a, b));
}

/** Exact alias lookup over a catalog. */
export function merchantByAlias(
  merchants: readonly MerchantRecord[],
  alias: string,
): MerchantRecord | null {
  const key = normalizeMerchantName(alias);
  if (!key) return null;
  for (const merchant of merchants) {
    if (merchant.aliases.some((entry) => normalizeMerchantName(entry) === key)) return merchant;
  }
  return null;
}

function bestSimilarity(
  merchants: readonly MerchantRecord[],
  key: string,
): { merchant: MerchantRecord; score: number } | null {
  let best: { merchant: MerchantRecord; score: number } | null = null;
  for (const merchant of merchants) {
    const candidates = [merchant.name, ...merchant.aliases];
    for (const candidate of candidates) {
      const score = similarity(key, candidate);
      if (!best || score > best.score) best = { merchant, score };
    }
  }
  return best;
}

/**
 * Resolve one descriptor against one account's merchant list. An exact alias is
 * returned with confidence 1; a fuzzy hit carries its actual score so the UI can
 * show how sure it is. Below the threshold the result is explicitly unresolved.
 */
export function resolveMerchant(
  descriptor: string,
  merchants: readonly MerchantRecord[],
  options: ResolveOptions = {},
): MerchantMatch {
  const key = normalizeMerchantName(descriptor);
  if (!key) return { merchant: null, method: 'unresolved', confidence: 0 };

  const exact = merchantByAlias(merchants, key);
  if (exact) return { merchant: exact, method: 'exact_alias', confidence: 1 };

  const threshold = options.threshold ?? MERCHANT_SIMILARITY_THRESHOLD;
  const best = bestSimilarity(merchants, key);
  if (!best || best.score < threshold) {
    return { merchant: null, method: 'unresolved', confidence: 0 };
  }
  return {
    merchant: best.merchant,
    method: 'similarity',
    confidence: Math.round(best.score * 100) / 100,
  };
}
