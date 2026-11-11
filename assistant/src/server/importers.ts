/**
 * M3.2 — pure importers for generic CSV and OFX/QFX statements.
 *
 * PDF is deliberately unsupported. Every failure is an ImportParseError with a
 * stable reason so the API and UI can show why a file was rejected instead of
 * silently posting a partial statement.
 */
import { createHash } from 'node:crypto';
import type { SpendCategory } from './spend-log.js';
import { SPEND_CATEGORIES } from './spend-log.js';
import { isCalendarDate, type ImportSource } from './imports-schema.js';

export type DateFormat = 'auto' | 'YMD' | 'MDY' | 'DMY';
export type AmountSign = 'as-is' | 'invert';

export interface ImportColumnMapping {
  date: string;
  description: string;
  amount?: string | null;
  debit?: string | null;
  credit?: string | null;
  balance?: string | null;
  category?: string | null;
  dateFormat?: DateFormat;
  amountSign?: AmountSign;
  currency?: string;
}

export type ImportRejectReason =
  | 'empty_file'
  | 'unsupported_type'
  | 'unterminated_quote'
  | 'missing_header'
  | 'missing_column'
  | 'no_transactions'
  | 'malformed_ofx'
  | 'bad_date'
  | 'bad_amount'
  | 'bad_balance'
  | 'empty_description';

export class ImportParseError extends Error {
  readonly reason: ImportRejectReason;

  constructor(reason: ImportRejectReason, message: string = reason) {
    super(message);
    this.name = 'ImportParseError';
    this.reason = reason;
  }
}

export interface ParsedImportRow {
  lineNumber: number;
  postedDate: string;
  amountMinor: number;
  currency: string;
  descriptorRaw: string;
  descriptorClean: string;
  categoryId: SpendCategory;
  source: ImportSource;
  externalId: string | null;
  raw: Record<string, string>;
}

export interface ImportRejection {
  lineNumber: number;
  reason: ImportRejectReason;
  detail: string;
}

export interface StatementMeta {
  currency: string;
  start: string | null;
  end: string | null;
  openingBalanceMinor: number | null;
  closingBalanceMinor: number | null;
  rowCount: number;
  balanceIssues: number;
}

export interface ParseResult {
  source: ImportSource;
  rows: ParsedImportRow[];
  rejections: ImportRejection[];
  statement: StatementMeta;
}

export interface CsvPreview {
  columns: string[];
  delimiter: string;
  suggestedMapping: ImportColumnMapping | null;
  sampleRows: string[][];
}

/* ------------------------------------------------------------------ */
/* Descriptor cleanup and category inference                           */
/* ------------------------------------------------------------------ */

export function cleanDescriptor(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+#\d+$/, '')
    .replace(/^pos\s+(debit|purchase)\s+/, '')
    .trim();
}

const CATEGORY_HINTS: Array<[SpendCategory, RegExp]> = [
  ['dining', /coffee|bottle|starbucks|chipotle|restaurant|cafe|doordash|grubhub|pizza|deli/],
  ['groceries', /trader joe|whole foods|grocer|safeway|kroger|market|aldi/],
  ['transport', /shell|chevron|uber|lyft|transit|metro|parking|gas|fuel/],
  ['entertainment', /netflix|spotify|hulu|disney|comcast|movie|theater|steam/],
  ['shopping', /amazon|target|walmart|costco|shop|store|etsy/],
  ['housing', /pg&e|rent|mortgage|utility|water|electric|hoa/],
  ['health', /pharmacy|cvs|walgreen|clinic|dental|doctor|health/],
];

export function inferCategory(descriptorClean: string): SpendCategory {
  for (const [category, hint] of CATEGORY_HINTS) {
    if (hint.test(descriptorClean)) return category;
  }
  return 'other';
}

function categoryFrom(value: string | undefined, descriptorClean: string): SpendCategory {
  const normalized = (value ?? '').trim().toLowerCase();
  if ((SPEND_CATEGORIES as readonly string[]).includes(normalized)) return normalized as SpendCategory;
  return inferCategory(descriptorClean);
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

interface CsvRecord {
  lineNumber: number;
  fields: string[];
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = -1;
  for (const { char } of [
    { char: ',' }, { char: ';' }, { char: '\t' },
  ]) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < firstLine.length; i++) {
      const c = firstLine[i];
      if (c === '"') quoted = !quoted;
      else if (!quoted && c === char) count++;
    }
    if (count > bestCount) {
      best = char;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Minimal RFC-4180 parser: quoted fields, doubled quotes, embedded newlines.
 * It tracks the physical line where each record starts for row-level errors.
 */
function parseCsvRecords(text: string, delimiter: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const pushField = () => {
    fields.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    // Skip fully blank lines instead of treating them as rows.
    if (fields.some((value) => value.trim() !== '')) {
      records.push({ lineNumber: recordLine, fields });
    }
    fields = [];
    recordLine = line + 1;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === delimiter) {
      pushField();
      continue;
    }
    if (c === '\r') {
      if (text[i + 1] === '\n') continue;
      pushRecord();
      line++;
      continue;
    }
    if (c === '\n') {
      pushRecord();
      line++;
      continue;
    }
    field += c;
  }
  if (quoted) throw new ImportParseError('unterminated_quote', 'A quoted field is not closed.');
  if (field !== '' || fields.length > 0) pushRecord();
  return records;
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findColumn(columns: string[], candidate: string | null | undefined): number {
  if (!candidate) return -1;
  const wanted = normalizeHeader(candidate);
  return columns.findIndex((column) => normalizeHeader(column) === wanted);
}

const HEADER_HINTS: Array<[keyof ImportColumnMapping, RegExp[]]> = [
  ['date', [/^date$/, /posted date/, /post date/, /transaction date/, /^posted$/]],
  ['description', [/description/, /^memo$/, /payee/, /^name$/, /narrative/, /details/]],
  ['amount', [/^amount$/, /transaction amount/, /^value$/]],
  ['debit', [/^debit$/, /withdrawal/, /money out/]],
  ['credit', [/^credit$/, /deposit/, /money in/]],
  ['balance', [/balance/, /running balance/, /ledger balance/]],
  ['category', [/^category$/, /category/]],
];

/** Best-effort mapping from headers. Users can override every field in the UI. */
export function suggestMapping(columns: string[]): ImportColumnMapping | null {
  const normalized = columns.map(normalizeHeader);
  const picked: Record<string, string | null> = {};
  for (const [field, hints] of HEADER_HINTS) {
    let found: string | null = null;
    for (const hint of hints) {
      const index = normalized.findIndex((column) => hint.test(column));
      if (index >= 0) {
        found = columns[index] ?? null;
        break;
      }
    }
    picked[field] = found;
  }
  if (!picked.date || !picked.description) return null;
  if (!picked.amount && !(picked.debit || picked.credit)) return null;
  const mapping: ImportColumnMapping = {
    date: picked.date,
    description: picked.description,
    amount: picked.amount,
    debit: picked.debit,
    credit: picked.credit,
    balance: picked.balance,
    category: picked.category,
    dateFormat: 'auto',
    amountSign: 'as-is',
    currency: 'USD',
  };
  return mapping;
}

export function previewCsvImport(text: string): CsvPreview {
  if (text.trim() === '') throw new ImportParseError('empty_file');
  const delimiter = detectDelimiter(text);
  const records = parseCsvRecords(text, delimiter);
  if (records.length === 0) throw new ImportParseError('missing_header');
  const columns = records[0]!.fields.map((value) => value.replace(/^\uFEFF/, '').trim());
  if (columns.length < 2) throw new ImportParseError('missing_header');
  const sampleRows = records.slice(1, 4).map((record) => record.fields);
  return { columns, delimiter, suggestedMapping: suggestMapping(columns), sampleRows };
}

function parseDateCell(value: string, format: DateFormat = 'auto'): string | null {
  const cleaned = value.trim().replace(/^['"]|['"]$/g, '');
  if (!cleaned) return null;
  const datePart = cleaned.split(/[T\s]/)[0] ?? '';
  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(datePart);
  if (ymd) {
    const year = ymd[1] ?? '';
    const month = (ymd[2] ?? '').padStart(2, '0');
    const day = (ymd[3] ?? '').padStart(2, '0');
    const iso = `${year}-${month}-${day}`;
    return isCalendarDate(iso) ? iso : null;
  }
  const parts = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(datePart);
  if (!parts) return null;
  const a = Number(parts[1] ?? 0);
  const b = Number(parts[2] ?? 0);
  const year = parts[3] ?? '';
  let month: number;
  let day: number;
  if (format === 'DMY' || (format === 'auto' && a > 12)) {
    day = a;
    month = b;
  } else {
    month = a;
    day = b;
  }
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isCalendarDate(iso) ? iso : null;
}

/** Exact decimal parsing; never routes money through floating point. */
export function parseMoneyCell(value: string | null | undefined): number | null {
  if (value == null) return null;
  let text = String(value).trim().replace(/[$\s]/g, '');
  if (text === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/,/g, '');
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  if (match[1] === '-') negative = !negative;
  const whole = Number(match[2]);
  const fraction = Number((match[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(whole)) return null;
  const minor = whole * 100 + fraction;
  return negative ? -minor : minor;
}

export function parseCsvImport(
  text: string,
  mapping: ImportColumnMapping,
  opts: {
    accountKind?: 'checking' | 'credit';
    openingBalanceMinor?: number | null;
    expectedRowCount?: number;
  } = {},
): ParseResult {
  if (text.trim() === '') throw new ImportParseError('empty_file');
  const delimiter = detectDelimiter(text);
  const records = parseCsvRecords(text, delimiter);
  if (records.length === 0) throw new ImportParseError('missing_header');
  const header = records[0]!.fields.map((value) => value.replace(/^\uFEFF/, '').trim());
  const dateIndex = findColumn(header, mapping.date);
  const descriptionIndex = findColumn(header, mapping.description);
  const amountIndex = findColumn(header, mapping.amount);
  const debitIndex = findColumn(header, mapping.debit);
  const creditIndex = findColumn(header, mapping.credit);
  const balanceIndex = findColumn(header, mapping.balance);
  const categoryIndex = findColumn(header, mapping.category);

  if (dateIndex < 0 || descriptionIndex < 0) {
    throw new ImportParseError('missing_column', 'The date or description column is missing.');
  }
  if (amountIndex < 0 && debitIndex < 0 && creditIndex < 0) {
    throw new ImportParseError('missing_column', 'Pick an amount column, or debit and credit columns.');
  }

  const currency = (mapping.currency ?? 'USD').toUpperCase();
  const invert = mapping.amountSign === 'invert';
  const rows: ParsedImportRow[] = [];
  const rejections: ImportRejection[] = [];
  const balances: Array<{ lineNumber: number; balance: number; amount: number }> = [];
  const dataRecords = records.slice(1);
  let start: string | null = null;
  let end: string | null = null;

  for (const record of dataRecords) {
    const raw: Record<string, string> = {};
    header.forEach((column, index) => { raw[column] = record.fields[index] ?? ''; });
    const postedDate = parseDateCell(record.fields[dateIndex] ?? '', mapping.dateFormat ?? 'auto');
    if (!postedDate) {
      rejections.push({
        lineNumber: record.lineNumber,
        reason: 'bad_date',
        detail: `${record.fields[dateIndex] || '(blank)'} is not a recognized date`,
      });
      continue;
    }

    let amount: number | null = null;
    if (amountIndex >= 0) {
      amount = parseMoneyCell(record.fields[amountIndex]);
    } else {
      const debit = parseMoneyCell(record.fields[debitIndex]);
      const credit = parseMoneyCell(record.fields[creditIndex]);
      if (debit != null && debit !== 0) amount = -Math.abs(debit);
      else if (credit != null && credit !== 0) amount = Math.abs(credit);
      else if (debit != null || credit != null) amount = 0;
    }
    if (amount == null) {
      rejections.push({
        lineNumber: record.lineNumber,
        reason: 'bad_amount',
        detail: `${record.fields[amountIndex] || '(blank)'} is not money`,
      });
      continue;
    }
    if (invert) amount = -amount;

    const descriptorRaw = (record.fields[descriptionIndex] ?? '').trim();
    const descriptorClean = cleanDescriptor(descriptorRaw);
    if (!descriptorClean) {
      rejections.push({
        lineNumber: record.lineNumber,
        reason: 'empty_description',
        detail: 'The description column is blank',
      });
      continue;
    }

    if (balanceIndex >= 0) {
      const balance = parseMoneyCell(record.fields[balanceIndex]);
      if (balance != null) balances.push({ lineNumber: record.lineNumber, balance, amount });
    }

    rows.push({
      lineNumber: record.lineNumber,
      postedDate,
      amountMinor: amount,
      currency,
      descriptorRaw,
      descriptorClean,
      categoryId: categoryIndex >= 0
        ? categoryFrom(record.fields[categoryIndex], descriptorClean)
        : inferCategory(descriptorClean),
      source: 'csv',
      externalId: null,
      raw,
    });
    if (!start || postedDate < start) start = postedDate;
    if (!end || postedDate > end) end = postedDate;
  }

  let balanceIssues = 0;
  for (let i = 1; i < balances.length; i++) {
    const previous = balances[i - 1]!;
    const current = balances[i]!;
    if (previous.balance + current.amount !== current.balance) balanceIssues++;
  }
  const firstBalance = balances[0];
  const lastBalance = balances.at(-1);
  const opening = opts.openingBalanceMinor !== undefined
    ? opts.openingBalanceMinor
    : firstBalance
      ? firstBalance.balance - firstBalance.amount
      : null;

  return {
    source: 'csv',
    rows,
    rejections,
    statement: {
      currency,
      start,
      end,
      openingBalanceMinor: opening,
      closingBalanceMinor: lastBalance?.balance ?? null,
      rowCount: dataRecords.length,
      balanceIssues,
    },
  };
}

/* ------------------------------------------------------------------ */
/* OFX / QFX                                                           */
/* ------------------------------------------------------------------ */

function ofxTag(block: string, name: string): string | null {
  const match = new RegExp(`<\\s*${name}\\s*>([^<]*)`, 'i').exec(block);
  return match ? (match[1] ?? '').trim() : null;
}

function ofxDate(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, '').slice(0, 8);
  if (digits.length !== 8) return null;
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return isCalendarDate(iso) ? iso : null;
}

export function parseOfxImport(text: string): ParseResult {
  if (text.trim() === '') throw new ImportParseError('empty_file');
  if (!/<OFX[\s>]/i.test(text)) throw new ImportParseError('malformed_ofx', 'The file has no OFX header.');
  const blocks = [...text.matchAll(/<\s*STMTTRN\s*>([\s\S]*?)<\s*\/\s*STMTTRN\s*>/gi)].map((m) => m[1] ?? '');
  if (blocks.length === 0) throw new ImportParseError('no_transactions', 'The statement contains no transactions.');

  const currency = (ofxTag(text, 'CURDEF') ?? 'USD').toUpperCase();
  const closing = parseMoneyCell(ofxTag(text, 'BALAMT'));
  const rows: ParsedImportRow[] = [];
  const rejections: ImportRejection[] = [];
  let start: string | null = null;
  let end: string | null = null;

  blocks.forEach((block, index) => {
    const lineNumber = index + 2;
    const postedDate = ofxDate(ofxTag(block, 'DTPOSTED'));
    const amount = parseMoneyCell(ofxTag(block, 'TRNAMT'));
    const descriptorRaw = (ofxTag(block, 'NAME') ?? ofxTag(block, 'MEMO') ?? '').trim();
    if (!postedDate) {
      rejections.push({ lineNumber, reason: 'bad_date', detail: 'OFX DTPOSTED is missing or invalid' });
      return;
    }
    if (amount == null) {
      rejections.push({ lineNumber, reason: 'bad_amount', detail: 'OFX TRNAMT is missing or invalid' });
      return;
    }
    const descriptorClean = cleanDescriptor(descriptorRaw);
    if (!descriptorClean) {
      rejections.push({ lineNumber, reason: 'empty_description', detail: 'OFX NAME and MEMO are blank' });
      return;
    }
    rows.push({
      lineNumber,
      postedDate,
      amountMinor: amount,
      currency,
      descriptorRaw,
      descriptorClean,
      categoryId: inferCategory(descriptorClean),
      source: 'ofx',
      externalId: ofxTag(block, 'FITID'),
      raw: { block },
    });
    if (!start || postedDate < start) start = postedDate;
    if (!end || postedDate > end) end = postedDate;
  });

  return {
    source: 'ofx',
    rows,
    rejections,
    statement: {
      currency,
      start: start ?? ofxDate(ofxTag(text, 'DTSTART')),
      end: end ?? ofxDate(ofxTag(text, 'DTEND')),
      openingBalanceMinor: null,
      closingBalanceMinor: closing,
      rowCount: blocks.length,
      balanceIssues: 0,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function sourceForFilename(filename: string): ImportSource {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.ofx')) return 'ofx';
  if (lower.endsWith('.qfx')) return 'qfx';
  throw new ImportParseError('unsupported_type', 'Only CSV, OFX and QFX files are supported.');
}

export function parseImportFile(
  filename: string,
  content: string,
  mapping?: ImportColumnMapping,
  opts: Parameters<typeof parseCsvImport>[2] = {},
): ParseResult {
  const source = sourceForFilename(filename);
  if (source === 'csv') {
    const resolved = mapping ?? suggestMapping(previewCsvImport(content).columns);
    if (!resolved) {
      throw new ImportParseError('missing_column', 'Map a date, description and amount column before importing.');
    }
    return parseCsvImport(content, resolved, opts);
  }
  const parsed = parseOfxImport(content);
  const sourceForFile = filename.toLowerCase().endsWith('.qfx') ? 'qfx' : 'ofx';
  return {
    ...parsed,
    source: sourceForFile,
    rows: parsed.rows.map((row) => ({ ...row, source: sourceForFile })),
  };
}

/** Stable content hash used by the idempotency key and file-level replay. */
export function importFileHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
