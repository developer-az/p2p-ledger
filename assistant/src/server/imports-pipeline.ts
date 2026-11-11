/**
 * M3.4 — in-process import pipeline.
 *
 * parse → validate → stage → dedupe → post, all in this process. No queue and
 * no AWS. The idempotency key is import-<fileHash>-<lineNumber>, and the file
 * hash also makes a re-upload of the same bytes return the original report.
 */
import { randomUUID } from 'node:crypto';
import type { FieldCipher } from './envelope.js';
import { enrichSpendDraft } from './enrichment/service.js';
import type { EnrichmentStore } from './enrichment/store.js';
import { assignDedupeKeys, dedupeKeyFor, splitNewRows } from './import-dedupe.js';
import { importFileHash, ImportParseError, parseImportFile, type ImportColumnMapping, type ImportRejection, type ParsedImportRow } from './importers.js';
import { reconcileStatement, runQualityGates } from './import-quality.js';
import { IMPORT_STAGE_IDS, PIPELINE_VERSION, validateTransactionRow, type ImportStageId } from './imports-schema.js';
import type {
  ImportRecord,
  ImportStageState,
  ImportStore,
  ImportTransactionInput,
  StoredImportTransaction,
} from './imports-store.js';

export interface RunImportInput {
  accountId: string;
  filename: string;
  content: string;
  mapping?: ImportColumnMapping;
  presetId?: string | null;
  accountKind?: 'checking' | 'credit';
  expectedRowCount?: number;
  expectedOutflowMinor?: number;
  openingBalanceMinor?: number | null;
  /** M4 aliases/rules applied to every imported row when available. */
  enrichment?: EnrichmentStore;
}

export interface RunImportResult {
  import: ImportRecord;
  transactions: StoredImportTransaction[];
  created: boolean;
}

const STAGE_LABELS: Record<ImportStageId, string> = {
  parse: 'Parse',
  validate: 'Validate',
  stage: 'Stage',
  dedupe: 'Dedupe',
  post: 'Post',
};

function initialStages(): Record<ImportStageId, ImportStageState> {
  return Object.fromEntries(IMPORT_STAGE_IDS.map((id) => [
    id,
    { status: 'pending', label: STAGE_LABELS[id], detail: 'Waiting.' },
  ])) as Record<ImportStageId, ImportStageState>;
}

function stamp(stage: ImportStageState, now: Date): ImportStageState {
  return { ...stage, at: now.toISOString() };
}

const EMPTY_STATEMENT = {
  currency: 'USD',
  start: null,
  end: null,
  openingBalanceMinor: null,
  closingBalanceMinor: null,
  rowCount: 0,
  balanceIssues: 0,
};

const EMPTY_RECONCILIATION = {
  reconciled: false,
  statementOpenedMinor: null,
  statementClosedMinor: null,
  computedClosedMinor: null,
  differenceMinor: null,
  rowsMatched: 0,
  detail: 'Not reconciled yet.',
};

function rejectionFromError(error: unknown): ImportRejection {
  if (error instanceof ImportParseError) {
    return { lineNumber: 1, reason: error.reason, detail: error.message };
  }
  return {
    lineNumber: 1,
    reason: 'malformed_ofx',
    detail: error instanceof Error ? error.message : 'The file could not be parsed.',
  };
}

async function transactionsFor(store: ImportStore, accountId: string, importId: string): Promise<StoredImportTransaction[]> {
  const pageSize = 1_000;
  const all: StoredImportTransaction[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await store.listTransactions(accountId, { importId, limit: pageSize, offset });
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

/**
 * Run one file through every stage. Partial files post their valid rows; a
 * failed quality gate posts nothing. The returned import record is the report
 * rendered by the Imports page.
 */
export async function runImport(
  store: ImportStore,
  input: RunImportInput,
  now: () => Date = () => new Date(),
): Promise<RunImportResult> {
  const fileHash = importFileHash(input.content);
  const existing = await store.findImportByHash(input.accountId, fileHash);
  if (existing?.status === 'posted') {
    return {
      import: existing,
      transactions: await transactionsFor(store, input.accountId, existing.id),
      created: false,
    };
  }
  // A rejected or failed report reflects the options used last time. The same
  // bytes may be valid after the user corrects a mapping/sign setting, so the
  // old report is replaced instead of blocking the retry.
  if (existing) await store.deleteImport(input.accountId, existing.id);

  const at = now();
  const stages = initialStages();
  const parsed = (() => {
    try {
      return parseImportFile(input.filename, input.content, input.mapping, {
        accountKind: input.accountKind,
        openingBalanceMinor: input.openingBalanceMinor,
      });
    } catch (error) {
      return { error } as const;
    }
  })();

  if ('error' in parsed) {
    const rejection = rejectionFromError(parsed.error);
    stages.parse = stamp({
      status: 'failed',
      label: STAGE_LABELS.parse,
      detail: `${rejection.reason}: ${rejection.detail}`,
    }, at);
    const created = await store.createImport({
      accountId: input.accountId,
      fileHash,
      filename: input.filename,
      source: input.filename.toLowerCase().endsWith('.ofx')
        ? 'ofx'
        : input.filename.toLowerCase().endsWith('.qfx')
          ? 'qfx'
          : 'csv',
      status: 'rejected',
      pipelineVersion: PIPELINE_VERSION,
      stages,
      counts: { parsed: 0, rejected: 0, duplicates: 0, posted: 0 },
      statement: EMPTY_STATEMENT,
      quality: [],
      reconciliation: EMPTY_RECONCILIATION,
      errors: [rejection],
      presetId: input.presetId ?? null,
    });
    return { import: created, transactions: [], created: true };
  }

  stages.parse = stamp({
    status: 'passed',
    label: STAGE_LABELS.parse,
    detail: `Read ${parsed.statement.rowCount} rows from ${input.filename}.`,
  }, at);

  let rows = parsed.rows;
  if (input.enrichment && rows.length > 0) {
    const enrichment = input.enrichment;
    rows = await Promise.all(rows.map(async (row) => {
      const enriched = await enrichSpendDraft(enrichment, input.accountId, {
        amountMinor: row.amountMinor,
        descriptor: row.descriptorRaw,
        occurredAt: `${row.postedDate}T12:00:00.000Z`,
        source: 'import',
      }, at);
      return {
        ...row,
        descriptorClean: enriched.descriptorClean || row.descriptorClean,
        categoryId: enriched.category,
        merchantId: enriched.merchantId,
      };
    }));
  }

  const keyed = assignDedupeKeys(input.accountId, rows);
  const validationErrors: ImportRejection[] = [];
  const validated: Array<(typeof keyed)[number] & { idempotencyKey: string }> = [];
  for (const entry of keyed) {
    const idempotencyKey = importIdempotencyKey(fileHash, entry.row.lineNumber);
    const verdict = validateTransactionRow({ ...entry.row, dedupeKey: entry.dedupeKey, idempotencyKey });
    if (!verdict.ok) {
      validationErrors.push({
        lineNumber: entry.row.lineNumber,
        reason: 'bad_amount',
        detail: verdict.reasons.join(', '),
      });
      continue;
    }
    validated.push({ ...entry, idempotencyKey });
  }
  const errors = [...parsed.rejections, ...validationErrors];
  stages.validate = stamp({
    status: validated.length > 0 ? 'passed' : 'failed',
    label: STAGE_LABELS.validate,
    detail: validated.length > 0
      ? `${validated.length} valid, ${errors.length} rejected.`
      : `No valid rows (${errors.length} rejected).`,
  }, at);

  const quality = runQualityGates({
    rows: validated.map((entry) => entry.row),
    rejections: errors,
    statement: parsed.statement,
    accountKind: input.accountKind,
    openingBalanceMinor: input.openingBalanceMinor,
    expectedRowCount: input.expectedRowCount,
    expectedOutflowMinor: input.expectedOutflowMinor,
    now: at,
  });
  const blocking = quality.filter((gate) => gate.status === 'failed');
  const reconciliation = reconcileStatement({
    rows: validated.map((entry) => entry.row),
    statement: parsed.statement,
    openingBalanceMinor: input.openingBalanceMinor,
    rejections: errors,
  });

  const counts = { parsed: parsed.statement.rowCount, rejected: errors.length, duplicates: 0, posted: 0 };
  if (blocking.length > 0) {
    for (const id of ['stage', 'dedupe', 'post'] as const) {
      stages[id] = stamp({ status: 'pending', label: STAGE_LABELS[id], detail: 'Blocked by quality gates.' }, at);
    }
    const failed = await store.createImport({
      accountId: input.accountId,
      fileHash,
      filename: input.filename,
      source: parsed.source,
      status: 'failed',
      pipelineVersion: PIPELINE_VERSION,
      stages,
      counts,
      statement: parsed.statement,
      quality,
      reconciliation,
      errors,
      presetId: input.presetId ?? null,
    });
    return { import: failed, transactions: [], created: true };
  }

  if (validated.length === 0) {
    stages.stage = stamp({ status: 'failed', label: STAGE_LABELS.stage, detail: 'Nothing valid to stage.' }, at);
    const failed = await store.createImport({
      accountId: input.accountId,
      fileHash,
      filename: input.filename,
      source: parsed.source,
      status: 'failed',
      pipelineVersion: PIPELINE_VERSION,
      stages,
      counts,
      statement: parsed.statement,
      quality,
      reconciliation,
      errors,
      presetId: input.presetId ?? null,
    });
    return { import: failed, transactions: [], created: true };
  }

  const created = await store.createImport({
    accountId: input.accountId,
    fileHash,
    filename: input.filename,
    source: parsed.source,
    status: 'received',
    pipelineVersion: PIPELINE_VERSION,
    stages,
    counts,
    statement: parsed.statement,
    quality,
    reconciliation,
    errors,
    presetId: input.presetId ?? null,
  });

  // Stage every parsed row we are willing to post. Rejected rows stay in the
  // report, not in raw_rows, so a poisoned row cannot block the batch.
  const rawByLine = new Map<number, string>();
  for (const entry of validated) {
    const raw = await store.stageRawRow({
      accountId: input.accountId,
      importId: created.id,
      lineNumber: entry.row.lineNumber,
      payload: entry.row.raw,
      rejectReason: null,
    });
    rawByLine.set(entry.row.lineNumber, raw.id);
  }
  stages.stage = stamp({
    status: 'passed',
    label: STAGE_LABELS.stage,
    detail: `Staged ${validated.length} raw rows.`,
  }, at);

  // Probe one occurrence past each group so splitNewRows can tell "the account
  // already has more copies than this file" from a plain duplicate.
  const probes = new Map<string, { next: number; row: ParsedImportRow }>();
  for (const entry of validated) {
    if (entry.external) continue;
    const probe = probes.get(entry.groupKey);
    const next = entry.occurrenceIndex + 1;
    if (!probe) probes.set(entry.groupKey, { next, row: entry.row });
    else probe.next = Math.max(probe.next, next);
  }
  const lookupKeys = [
    ...validated.map((entry) => entry.dedupeKey),
    ...[...probes.values()].map((probe) => dedupeKeyFor(input.accountId, probe.row, probe.next)),
  ];
  const existingKeys = await store.existingDedupeKeys(input.accountId, lookupKeys);
  const deduped = splitNewRows(validated, existingKeys);
  stages.dedupe = stamp({
    status: 'passed',
    label: STAGE_LABELS.dedupe,
    detail: `${deduped.duplicates.length} duplicate(s) skipped, ${deduped.fresh.length} new.`,
  }, at);

  let posted = 0;
  for (const entry of deduped.fresh) {
    const transaction: ImportTransactionInput = {
      id: randomUUID(),
      accountId: input.accountId,
      importId: created.id,
      rawRowId: rawByLine.get(entry.row.lineNumber) ?? null,
      lineNumber: entry.row.lineNumber,
      postedDate: entry.row.postedDate,
      amountMinor: entry.row.amountMinor,
      currency: entry.row.currency,
      descriptorRaw: entry.row.descriptorRaw,
      descriptorClean: entry.row.descriptorClean,
      merchantId: entry.row.merchantId ?? null,
      categoryId: entry.row.categoryId,
      source: entry.row.source,
      externalId: entry.row.externalId,
      dedupeKey: entry.dedupeKey,
      idempotencyKey: entry.idempotencyKey,
      pipelineVersion: PIPELINE_VERSION,
      createdAt: at.toISOString(),
    };
    const inserted = await store.insertTransaction(transaction);
    if (inserted.inserted) posted++;
  }
  stages.post = stamp({
    status: 'passed',
    label: STAGE_LABELS.post,
    detail: posted === 0
      ? 'No new transactions to post.'
      : `Posted ${posted} transaction(s).`,
  }, at);

  const finished = await store.updateImport(input.accountId, created.id, {
    status: 'posted',
    stages,
    counts: { ...counts, duplicates: deduped.duplicates.length, posted },
    quality,
    reconciliation,
  });
  return {
    import: finished,
    transactions: await transactionsFor(store, input.accountId, created.id),
    created: true,
  };
}


export function importIdempotencyKey(fileHash: string, lineNumber: number): string {
  return `import-${fileHash}-${lineNumber}`;
}

export type ImportRunner = (
  store: ImportStore,
  input: RunImportInput,
  now?: () => Date,
) => Promise<RunImportResult>;

export type { FieldCipher };
