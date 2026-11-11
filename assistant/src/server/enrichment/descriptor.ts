/**
 * Statement descriptors carry the processor, the terminal, the store number,
 * a phone support line, the city/state and a card suffix around the only two
 * words a person recognises: the merchant. cleanDescriptor() strips that noise
 * so matching, de-duplication and the rules page all talk about one string.
 *
 * The output is upper-case with punctuation reduced to single spaces. That is a
 * key, not a label: prettyDescriptor() renders it for a human.
 */

const STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
  // Canadian provinces, because card feeds are not limited to the US.
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
] as const;

/** Cities seen in US card descriptors. A city is only removed with a state code. */
const CITIES = [
  'ALBUQUERQUE', 'ANAHEIM', 'ANCHORAGE', 'ARLINGTON', 'ATLANTA', 'AUSTIN', 'BAKERSFIELD',
  'BALTIMORE', 'BATON ROUGE', 'BIRMINGHAM', 'BOISE', 'BOSTON', 'BUFFALO', 'CHARLESTON',
  'CHARLOTTE', 'CHATTANOOGA', 'CHICAGO', 'CINCINNATI', 'CLEVELAND', 'COLORADO SPRINGS',
  'COLUMBIA', 'COLUMBUS', 'CORPUS CHRISTI', 'DALLAS', 'DAYTON', 'DENVER', 'DES MOINES',
  'DETROIT', 'EL PASO', 'EUGENE', 'FORT WAYNE', 'FORT WORTH', 'FRESNO', 'GRAND RAPIDS',
  'GREENSBORO', 'HARTFORD', 'HONOLULU', 'HOUSTON', 'INDIANAPOLIS', 'JACKSONVILLE', 'JERSEY CITY',
  'KANSAS CITY', 'KNOXVILLE', 'LAS VEGAS', 'LEXINGTON', 'LINCOLN', 'LITTLE ROCK', 'LONG BEACH',
  'LOS ANGELES', 'LOUISVILLE', 'MADISON', 'MEMPHIS', 'MESA', 'MIAMI', 'MILWAUKEE', 'MINNEAPOLIS',
  'MOBILE', 'MODESTO', 'NASHVILLE', 'NEW ORLEANS', 'NEW YORK', 'NEWARK', 'NORFOLK', 'OAKLAND',
  'OKLAHOMA CITY', 'OMAHA', 'ORANGE', 'ORLANDO', 'PASADENA', 'PHILADELPHIA', 'PHOENIX',
  'PITTSBURGH', 'PORTLAND', 'PROVIDENCE', 'RALEIGH', 'RENO', 'RICHMOND', 'RIVERSIDE',
  'SACRAMENTO', 'SALT LAKE CITY', 'SAN ANTONIO', 'SAN BERNARDINO', 'SAN DIEGO', 'SAN FRANCISCO',
  'SAN JOSE', 'SANTA ANA', 'SAVANNAH', 'SCOTTSDALE', 'SEATTLE', 'SPOKANE', 'ST LOUIS',
  'ST PAUL', 'STOCKTON', 'SYRACUSE', 'TACOMA', 'TAMPA', 'TOLEDO', 'TUCSON', 'TULSA',
  'VIRGINIA BEACH', 'WASHINGTON', 'WICHITA', 'WINSTON SALEM', 'WORCESTER',
] as const;

const PREFIXES: RegExp[] = [
  /^(?:AMZN\s+MKTP(?:\s+US)?)\s*\*?.*$/,
  /^(?:AMAZON\s+MKTPL(?:ACE)?)\s*\*?.*$/,
  /^APPLE\s*\.?\s*COM\s*\/?\s*BILL\b.*$/,
  // Short codes (SQ, SP, PP, TST) are only processor prefixes with their
  // delimiter; SPR0UTS, SQUARESPACE and PPG are merchant names.
  /^(?:SQ|SQUARE)(?:\s*\*\s*|\s+)/,
  /^(?:TST|TOAST)(?:\s*\*\s*|\s+)/,
  /^(?:PAYPAL|PP)(?:\s*\*\s*|\s+)/,
  /^(?:SP|STRIPE)(?:\s*\*\s*|\s+)/,
  // Etsy is a merchant, not a processor; SHOPIFY *ETSY must keep ETSY.
  /^SHOPIFY(?:\s*\*\s*|\s+)/,
  /^IN\s*\*\s*/,
  /^GOOGLE(?:\s*\*\s*|\s+)/,
  /^POS\s+(?:DEBIT|PURCHASE|CREDIT)\s*/,
  /^CHECKCARD\s+\d{3,4}\s*/,
  /^CHECKCARD\s*/,
  /^DEBIT\s+(?:CARD\s+)?PURCHASE\s*[-:]?\s*/,
  /^CREDIT\s+(?:CARD\s+)?PURCHASE\s*[-:]?\s*/,
  /^PURCHASE\s+/,
  /^PAYMENT\s+TO\s+/,
  /^VISA\s+(?:DDA\s+)?/,
  /^ACH\s+(?:DEBIT|CREDIT)\s*/,
  /^PPD\s+ID\s*:?\s*\S+\s*/,
  /^WEB\s+AUTH\s*/,
  /^RECURRING\s+(?:PAYMENT|DEBIT)\s*/,
];

const TRAILING_NOISE = /\b(?:PURCHASE|PAYMENT|DEBIT|CREDIT|ONLINE|WEB|RECURRING|AUTOPAY)\b\s*$/;

function escapeWord(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const cityAlternation = [...CITIES]
  .sort((a, b) => b.length - a.length)
  .map(escapeWord)
  .join('|');
const stateAlternation = STATE_CODES.join('|');
const CITY_STATE_TAIL = new RegExp(
  `[,\\s]+(?:${cityAlternation})[,\\s]+(?:${stateAlternation})(?:\\s+\\d{5}(?:-\\d{4})?)?\\s*$`,
);
const STATE_ZIP_TAIL = new RegExp(`[,\\s]+(?:${stateAlternation})(?:\\s+\\d{5}(?:-\\d{4})?)?\\s*$`);

/**
 * Clean one statement descriptor. Unknown input still yields a stable key:
 * empty/whitespace becomes "", and punctuation-only becomes "".
 */
export function cleanDescriptor(raw: string | null | undefined): string {
  if (raw == null) return '';
  let text = String(raw).toUpperCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, ' ');
  text = text.replace(/\u00a0/g, ' ');
  // Apostrophes join the word they split: McDonald's -> MCDONALDS, not MCDONALD S.
  text = text.replace(/['’`]/gu, '');

  // Whole-descriptor marketplace forms: the remainder is an order code, not a merchant.
  text = text.replace(/\bAMZN\s+MKTP(?:\s+US)?\s*\*?.*$/g, ' AMAZON ');
  text = text.replace(/\bAMAZON\s+MKTPL(?:ACE)?\s*\*?.*$/g, ' AMAZON ');
  text = text.replace(/\b(?:AMZN|AMAZON)\s*\.?\s*COM\s*\/?\s*BILL\b.*$/g, ' AMAZON ');
  text = text.replace(/\b(?:AMZN|AMAZON)\s*\.?\s*COM\s*\*.*$/g, ' AMAZON ');
  text = text.replace(/\bAMZN\s*\*.*$/g, ' AMAZON ');
  text = text.replace(/\bAPPLE\s*\.?\s*COM\s*\/?\s*BILL\b.*$/g, ' APPLE ');
  // Bare domains, including subdomains, are support/web noise after the name.
  text = text.replace(/\bWWW\./g, ' ');
  text = text.replace(/\.(?:COM|NET|ORG|CO|IO)\b/g, ' ');

  // Card suffix run before the bare-number rules, so XXXX1234 is not read as a store.
  text = text.replace(/\b(?:CARD|CC|VISA|MC|AMEX|DEBIT)\s+(?:ENDING\s+)?(?:IN\s+)?#?\s*\d{4}\b/g, ' ');
  text = text.replace(/\b(?:CARD|CC|VISA|MC|AMEX|DEBIT)\s*#?\s*[X*]{2,}\s*\d{4}\b/g, ' ');
  text = text.replace(/\b[X*]{2,}\s*\d{4}\b/g, ' ');

  // Phone support lines: 800-555-1212, (800) 555-1212, (800)555-1212, 8005551212.
  text = text.replace(/(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s*|\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g, ' ');
  text = text.replace(/\b1?\d{10}\b/g, ' ');

  // Store, terminal and register numbers.
  text = text.replace(/\b(?:STORE|LOC|LOCATION|TERM|TERMINAL|POS|REG|REGISTER)\s*(?:#|NO\.?)?\s*\d{1,6}\b/g, ' ');
  text = text.replace(/#\s*\d{1,6}\b/g, ' ');

  // Authorization, trace and invoice references.
  text = text.replace(/\b(?:REF|AUTH|TRACE|INV|ORDER|TXN|TRANSACTION|ID)\s*[:#]?\s*[A-Z0-9-]{3,}\b/g, ' ');
  // Dates and printed amounts from the statement.
  text = text.replace(/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/g, ' ');
  text = text.replace(/\$?\d+\.\d{2}\b/g, ' ');

  text = text.replace(/^\s+/, '');
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of PREFIXES) {
      const next = text.replace(prefix, '').replace(/^\s+/, '');
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
  }

  // City + state (and optional ZIP) first; then a bare state tail.
  text = text.replace(CITY_STATE_TAIL, ' ');
  text = text.replace(STATE_ZIP_TAIL, ' ');
  text = text.replace(/\b(?:USA|UNITED STATES|U S A)\b/g, ' ');

  // Terminal designators such as "TARGET T-1234" (a single letter, not the
  // last letter of the merchant name).
  text = text.replace(/(^|\s)[A-Z]\s*[-#]\s*\d{3,6}\s*$/, ' ');
  // A bare store number left after the explicit prefixes: "STARBUCKS 1234".
  text = text.replace(/[\s#-]+\d{3,6}\s*$/, ' ');
  text = text.replace(TRAILING_NOISE, ' ');

  // Everything that is not a word character becomes one space; punctuation and
  // accents never change an alias key.
  text = text.replace(/[^A-Z0-9]+/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

/** Human-readable label for a cleaned key ("BLUE BOTTLE COFFEE"). */
export function prettyDescriptor(clean: string): string {
  return clean
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
