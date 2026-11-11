/**
 * M3.1/M3.4 — import, raw-row and transaction stores.
 *
 * In-memory is the default for dev and tests; Postgres is selected by the same
 * database URL as the finance store and uses FORCE RLS through withUser().
 * descriptor_raw is encrypted with the account data key before it reaches
 * either store.
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { databaseUrlFromEnv } from './integrity-postgres.js';
import type { FieldCipher } from './envelope.js';
import {
  IMPORTS_UP_SQL,
  IMPORT_SCHEMA_VERSION,
  PIPELINE_VERSION,
  type ImportSource,
  type ImportStageId,
  type ImportStatus,
} from './imports-schema.js';
import type { ImportColumnMapping, ImportRejection, StatementMeta } from './importers.js';
import type { QualityGate, Reconciliation } from './import-quality.js';
import { sharedPool } from './pg-pool.js';
import { withUser } from './rls.js';
import { ensureSchemaOnce } from './schema-gate.js';

export type { FieldCipher };

export interface ImportCounts {
  parsed: number;
  rejected: number;
  duplicates: number;
  posted: number;
}

export interface ImportStageState {
  status: 'pending' | 'running' | 'passed' | 'failed';
  label: string;
  detail: string;
  at?: string;
}

export interface ImportRecord {
  id: string;
  accountId: string;
  fileHash: string;
  filename: string;
  source: ImportSource;
  status: ImportStatus;
  pipelineVersion: string;
  stages: Record<ImportStageId, ImportStageState>;
  counts: ImportCounts;
  statement: StatementMeta;
  quality: QualityGate[];
  reconciliation: Reconciliation;
  errors: ImportRejection[];
  presetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RawRowRecord {
  id: string;
  accountId: string;
  importId: string;
  lineNumber: number;
  payload: Record<string, unknown>;
  rejectReason: string | null;
  createdAt: string;
}

export interface StoredImportTransaction {
  id: string;
  accountId: string;
  importId: string;
  rawRowId: string | null;
  lineNumber: number;
  postedDate: string;
  amountMinor: number;
  currency: string;
  /** Ciphertext at rest; listTransactions returns plaintext. */
  descriptorRaw: string;
  descriptorClean: string;
  merchantId: string | null;
  categoryId: string;
  source: ImportSource;
  externalId: string | null;
  dedupeKey: string;
  idempotencyKey: string;
  pipelineVersion: string;
  createdAt: string;
}

export interface ImportTransactionInput extends Omit<StoredImportTransaction, 'descriptorRaw'> {
  descriptorRaw: string;
}

export interface NewImport {
  id?: string;
  accountId: string;
  fileHash: string;
  filename: string;
  source: ImportSource;
  status: ImportStatus;
  pipelineVersion?: string;
  stages: Record<ImportStageId, ImportStageState>;
  counts: ImportCounts;
  statement: StatementMeta;
  quality?: QualityGate[];
  reconciliation?: Reconciliation;
  errors?: ImportRejection[];
  presetId?: string | null;
}

export interface ImportPreset {
  id: string;
  name: string;
  source: ImportSource;
  mapping: ImportColumnMapping;
  builtIn: boolean;
  createdAt?: string;
}

export interface ImportStore {
  createImport(input: NewImport): Promise<ImportRecord>;
  getImport(accountId: string, importId: string): Promise<ImportRecord | null>;
  findImportByHash(accountId: string, fileHash: string): Promise<ImportRecord | null>;
  updateImport(accountId: string, importId: string, patch: Partial<Omit<ImportRecord, 'id' | 'accountId' | 'createdAt'>>): Promise<ImportRecord>;
  listImports(accountId: string, opts?: { limit?: number }): Promise<ImportRecord[]>;
  stageRawRow(input: Omit<RawRowRecord, 'id' | 'createdAt'> & { id?: string }): Promise<RawRowRecord>;
  insertTransaction(input: ImportTransactionInput): Promise<{ inserted: boolean; row: StoredImportTransaction }>;
  listTransactions(
    accountId: string,
    opts?: { limit?: number; offset?: number; from?: string; to?: string; importId?: string },
  ): Promise<StoredImportTransaction[]>;
  existingDedupeKeys(accountId: string, keys: readonly string[]): Promise<Set<string>>;
  listPresets(accountId: string): Promise<ImportPreset[]>;
  savePreset(accountId: string, preset: Omit<ImportPreset, 'id' | 'createdAt' | 'builtIn'> & { id?: string }): Promise<ImportPreset>;
  deleteImport(accountId: string, importId: string): Promise<void>;
  deleteAll(accountId: string): Promise<void>;
}

export const BUILT_IN_PRESETS: ImportPreset[] = [
  {
    id: 'builtin-generic-csv',
    name: 'Generic CSV',
    source: 'csv',
    builtIn: true,
    mapping: {
      date: 'Date',
      description: 'Description',
      amount: 'Amount',
      dateFormat: 'auto',
      amountSign: 'as-is',
      currency: 'USD',
    },
  },
  {
    id: 'builtin-bank-checking',
    name: 'Bank checking export',
    source: 'csv',
    builtIn: true,
    mapping: {
      date: 'Posted Date',
      description: 'Description',
      amount: 'Amount',
      balance: 'Running Balance',
      dateFormat: 'auto',
      amountSign: 'as-is',
      currency: 'USD',
    },
  },
];

const EMPTY_RECONCILIATION: Reconciliation = {
  reconciled: false,
  statementOpenedMinor: null,
  statementClosedMinor: null,
  computedClosedMinor: null,
  differenceMinor: null,
  rowsMatched: 0,
  detail: 'Not reconciled yet.',
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

const SEALED_PAYLOAD_KEY = '$encrypted';

/** Raw statement text is sensitive, so the whole staged payload is sealed. */
async function sealRawPayload(
  cipher: FieldCipher | undefined,
  accountId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!cipher) return clone(payload);
  return { [SEALED_PAYLOAD_KEY]: await cipher.encryptField(accountId, JSON.stringify(payload)) };
}

async function openRawPayload(
  cipher: FieldCipher | undefined,
  accountId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sealed = payload[SEALED_PAYLOAD_KEY];
  if (!cipher || typeof sealed !== 'string') return clone(payload);
  return asObject(await cipher.decryptField(accountId, sealed), {});
}

export class InMemoryImportStore implements ImportStore {
  private imports: ImportRecord[] = [];
  private rawRows: RawRowRecord[] = [];
  private transactions: StoredImportTransaction[] = [];
  private presets: Array<ImportPreset & { accountId: string }> = [];

  constructor(private readonly cipher?: FieldCipher) {}

  async createImport(input: NewImport): Promise<ImportRecord> {
    const now = new Date().toISOString();
    const record: ImportRecord = {
      id: input.id ?? randomUUID(),
      accountId: input.accountId,
      fileHash: input.fileHash,
      filename: input.filename,
      source: input.source,
      status: input.status,
      pipelineVersion: input.pipelineVersion ?? PIPELINE_VERSION,
      stages: clone(input.stages),
      counts: clone(input.counts),
      statement: clone(input.statement),
      quality: clone(input.quality ?? []),
      reconciliation: clone(input.reconciliation ?? EMPTY_RECONCILIATION),
      errors: clone(input.errors ?? []),
      presetId: input.presetId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.imports.push(record);
    return clone(record);
  }

  async getImport(accountId: string, importId: string): Promise<ImportRecord | null> {
    const found = this.imports.find((row) => row.accountId === accountId && row.id === importId);
    return found ? clone(found) : null;
  }

  async findImportByHash(accountId: string, fileHash: string): Promise<ImportRecord | null> {
    const found = this.imports.find((row) => row.accountId === accountId && row.fileHash === fileHash);
    return found ? clone(found) : null;
  }

  async updateImport(
    accountId: string,
    importId: string,
    patch: Partial<Omit<ImportRecord, 'id' | 'accountId' | 'createdAt'>>,
  ): Promise<ImportRecord> {
    const index = this.imports.findIndex((row) => row.accountId === accountId && row.id === importId);
    if (index < 0) throw new Error('import_not_found');
    const current = this.imports[index]!;
    this.imports[index] = {
      ...current,
      ...clone(patch),
      id: current.id,
      accountId,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };
    return clone(this.imports[index]!);
  }

  async listImports(accountId: string, opts: { limit?: number } = {}): Promise<ImportRecord[]> {
    return this.imports
      .filter((row) => row.accountId === accountId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, opts.limit ?? 50)
      .map(clone);
  }

  async stageRawRow(input: Omit<RawRowRecord, 'id' | 'createdAt'> & { id?: string }): Promise<RawRowRecord> {
    const existing = this.rawRows.find(
      (row) => row.accountId === input.accountId && row.importId === input.importId && row.lineNumber === input.lineNumber,
    );
    if (existing) return { ...clone(existing), payload: await openRawPayload(this.cipher, input.accountId, existing.payload) };
    const row: RawRowRecord = {
      ...input,
      payload: await sealRawPayload(this.cipher, input.accountId, input.payload),
      id: input.id ?? randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.rawRows.push(row);
    return { ...clone(row), payload: clone(input.payload) };
  }

  async insertTransaction(input: ImportTransactionInput): Promise<{ inserted: boolean; row: StoredImportTransaction }> {
    const conflict = this.transactions.find((row) => row.accountId === input.accountId
      && (row.dedupeKey === input.dedupeKey || row.idempotencyKey === input.idempotencyKey));
    const encrypted = this.cipher
      ? await this.cipher.encryptField(input.accountId, input.descriptorRaw)
      : input.descriptorRaw;
    const stored: StoredImportTransaction = {
      ...input,
      descriptorRaw: encrypted,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    if (conflict) return { inserted: false, row: clone(conflict) };
    this.transactions.push(stored);
    return { inserted: true, row: clone(stored) };
  }

  async listTransactions(
    accountId: string,
    opts: { limit?: number; offset?: number; from?: string; to?: string; importId?: string } = {},
  ): Promise<StoredImportTransaction[]> {
    const offset = Math.max(0, opts.offset ?? 0);
    const rows = this.transactions
      .filter((row) => row.accountId === accountId
        && (!opts.importId || row.importId === opts.importId)
        && (!opts.from || row.postedDate >= opts.from)
        && (!opts.to || row.postedDate <= opts.to))
      .sort((a, b) => b.postedDate.localeCompare(a.postedDate)
        || b.createdAt.localeCompare(a.createdAt)
        || b.id.localeCompare(a.id))
      .slice(offset, offset + (opts.limit ?? 500));
    return Promise.all(rows.map(async (row) => ({
      ...clone(row),
      descriptorRaw: this.cipher ? await this.cipher.decryptField(accountId, row.descriptorRaw) : row.descriptorRaw,
    })));
  }

  async existingDedupeKeys(accountId: string, keys: readonly string[]): Promise<Set<string>> {
    const wanted = new Set(keys);
    return new Set(this.transactions
      .filter((row) => row.accountId === accountId && wanted.has(row.dedupeKey))
      .map((row) => row.dedupeKey));
  }

  async listPresets(accountId: string): Promise<ImportPreset[]> {
    return [
      ...clone(BUILT_IN_PRESETS),
      ...this.presets.filter((preset) => preset.accountId === accountId).map(({ accountId: _id, ...preset }) => clone(preset)),
    ];
  }

  async savePreset(
    accountId: string,
    preset: Omit<ImportPreset, 'id' | 'createdAt' | 'builtIn'> & { id?: string },
  ): Promise<ImportPreset> {
    const saved: ImportPreset & { accountId: string } = {
      id: preset.id ?? randomUUID(),
      accountId,
      name: preset.name,
      source: preset.source,
      mapping: clone(preset.mapping),
      builtIn: false,
      createdAt: new Date().toISOString(),
    };
    const existing = this.presets.findIndex((row) => row.accountId === accountId && row.name === saved.name);
    if (existing >= 0) this.presets[existing] = saved;
    else this.presets.push(saved);
    const { accountId: _id, ...publicPreset } = saved;
    return clone(publicPreset);
  }

  async deleteImport(accountId: string, importId: string): Promise<void> {
    this.imports = this.imports.filter((row) => !(row.accountId === accountId && row.id === importId));
    this.rawRows = this.rawRows.filter((row) => !(row.accountId === accountId && row.importId === importId));
    this.transactions = this.transactions.filter((row) => !(row.accountId === accountId && row.importId === importId));
  }

  async deleteAll(accountId: string): Promise<void> {
    const importIds = new Set(this.imports.filter((row) => row.accountId === accountId).map((row) => row.id));
    this.imports = this.imports.filter((row) => row.accountId !== accountId);
    this.rawRows = this.rawRows.filter((row) => row.accountId !== accountId && !importIds.has(row.importId));
    this.transactions = this.transactions.filter((row) => row.accountId !== accountId && !importIds.has(row.importId));
    this.presets = this.presets.filter((row) => row.accountId !== accountId);
  }
}

/* ------------------------------------------------------------------ */
/* Postgres                                                            */
/* ------------------------------------------------------------------ */

function asObject<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

function rowToImport(row: Record<string, unknown>): ImportRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    fileHash: String(row.file_hash),
    filename: String(row.filename),
    source: row.source as ImportSource,
    status: row.status as ImportStatus,
    pipelineVersion: String(row.pipeline_version),
    stages: asObject(row.stages, {} as ImportRecord['stages']),
    counts: asObject(row.counts, { parsed: 0, rejected: 0, duplicates: 0, posted: 0 }),
    statement: asObject(row.statement, {} as StatementMeta),
    quality: asObject(row.quality, []),
    reconciliation: asObject(row.reconciliation, EMPTY_RECONCILIATION),
    errors: asObject(row.errors, []),
    presetId: row.preset_id == null ? null : String(row.preset_id),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function rowToTransaction(row: Record<string, unknown>): StoredImportTransaction {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    importId: String(row.import_id),
    rawRowId: row.raw_row_id == null ? null : String(row.raw_row_id),
    lineNumber: Number(row.line_number),
    postedDate: String(row.posted_date).slice(0, 10),
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    descriptorRaw: String(row.descriptor_raw),
    descriptorClean: String(row.descriptor_clean),
    merchantId: row.merchant_id == null ? null : String(row.merchant_id),
    categoryId: String(row.category_id),
    source: row.source as ImportSource,
    externalId: row.external_id == null ? null : String(row.external_id),
    dedupeKey: String(row.dedupe_key),
    idempotencyKey: String(row.idempotency_key),
    pipelineVersion: String(row.pipeline_version),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export class PostgresImportStore implements ImportStore {
  constructor(
    private readonly connectionString: string,
    private readonly cipher?: FieldCipher,
  ) {}

  private async client(): Promise<PoolClient> {
    return sharedPool(this.connectionString).connect();
  }

  private async ensureSchema(client: PoolClient): Promise<void> {
    await ensureSchemaOnce(client, this.connectionString, 'imports', IMPORT_SCHEMA_VERSION, async () => {
      await client.query(IMPORTS_UP_SQL);
    });
  }

  async createImport(input: NewImport): Promise<ImportRecord> {
    const client = await this.client();
    try {
      await this.ensureSchema(client);
      return await withUser(client, input.accountId, async () => {
        const id = input.id ?? randomUUID();
        const res = await client.query(
          `insert into imports (id, account_id, file_hash, filename, source, status, pipeline_version,
             counts, statement, stages, quality, reconciliation, errors, preset_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14)
           returning *`,
          [
            id,
            input.accountId,
            input.fileHash,
            input.filename,
            input.source,
            input.status,
            input.pipelineVersion ?? PIPELINE_VERSION,
            JSON.stringify(input.counts),
            JSON.stringify(input.statement),
            JSON.stringify(input.stages),
            JSON.stringify(input.quality ?? []),
            JSON.stringify(input.reconciliation ?? EMPTY_RECONCILIATION),
            JSON.stringify(input.errors ?? []),
            input.presetId ?? null,
          ],
        );
        return rowToImport(res.rows[0] as Record<string, unknown>);
      });
    } finally {
      client.release();
    }
  }

  async getImport(accountId: string, importId: string): Promise<ImportRecord | null> {
    const client = await this.client();
    try {
      await this.ensureSchema(client);
      return await withUser(client, accountId, async () => {
        const res = await client.query('select * from imports where account_id = $1 and id = $2', [accountId, importId]);
        return res.rows[0] ? rowToImport(res.rows[0] as Record<string, unknown>) : null;
      });
    } finally {
      client.release();
    }
  }

  async findImportByHash(accountId: string, fileHash: string): Promise<ImportRecord | null> {
    const client = await this.client();
    try {
      await this.ensureSchema(client);
      return await withUser(client, accountId, async () => {
        const res = await client.query('select * from imports where account_id = $1 and file_hash = $2', [accountId, fileHash]);
        return res.rows[0] ? rowToImport(res.rows[0] as Record<string, unknown>) : null;
      });
    } finally {
      client.release();
    }
  }

  async updateImport(
    accountId: string,
    importId: string,
    patch: Partial<Omit<ImportRecord, 'id' | 'accountId' | 'createdAt'>>,
  ): Promise<ImportRecord> {
    const client = await this.client();
    try {
      await this.ensureSchema(client);
      return await withUser(client, accountId, async () => {
        const current = await client.query('select * from imports where account_id = $1 and id = $2', [accountId, importId]);
        if (!current.rows[0]) throw new Error('import_not_found');
        const merged = { ...rowToImport(current.rows[0] as Record<string, unknown>), ...patch };
        const res = await client.query(
          `update imports set status = $3, stages = $4::jsonb, counts = $5::jsonb, statement = $6::jsonb,
             quality = $7::jsonb, reconciliation = $8::jsonb, errors = $9::jsonb, preset_id = $10,
             updated_at = now()
           where account_id = $1 and id = $2 returning *`,
          [
            accountId,
            importId,
            merged.status,
            JSON.stringify(merged.stages),
            JSON.stringify(merged.counts),
            JSON.stringify(merged.statement),
            JSON.stringify(merged.quality),
            JSON.stringify(merged.reconciliation),
            JSON.stringify(merged.errors),
            merged.presetId,
          ],
        );
        return rowToImport(res.rows[0] as Record<string, unknown>);
      });
    } finally {
      client.release();
    }
  }

  async listImports(accountId: string, opts: { limit?: number } = {}): Promise<ImportRecord[]> {
    const client = await this.client();
    try {
      await this.ensureSchema(client);
      return await withUser(client, accountId, async () => {
        const res = await client.query(
          'select * from imports where account_id = $1 order by created_at desc limit $2',
          [accountId, opts.limit ?? 50],
        );
        return res.rows.map((row) => rowToImport(row as Record<string, unknown>));
      });
    } finally {
      client.release();
    }
  }

  async stageRawRow(input: Omit<RawRowRecord, 'id' | 'createdAt'> & { id?: string }): Promise<RawRowRecord> {
    const sealed = await sealRawPayload(this.cipher, input.accountId, input.payload);
    const client = await this.client();
    try {
      await this.ensureSchema(client);
      return await withUser(client, input.accountId, async () => {
        const res = await client.query(
          `insert into raw_rows (id, account_id, import_id, line_number, payload, reject_reason)
           values ($1, $2, $3, $4, $5::jsonb, $6)
           on conflict (import_id, line_number) do update set payload = excluded.payload,
             reject_reason = excluded.reject_reason
           returning *`,
          [
            input.id ?? randomUUID(),
            input.accountId,
            input.importId,
            input.lineNumber,
            JSON.stringify(sealed),
            input.rejectReason,
          ],
        );
        const row = res.rows[0] as Record<string, unknown>;
        return {
          id: String(row.id),
          accountId: String(row.account_id),
          importId: String(row.import_id),
          lineNumber: Number(row.line_number),
          payload: await openRawPayload(this.cipher, input.accountId, asObject(row.payload, {})),
          rejectReason: row.reject_reason == null ? null : String(row.reject_reason),
          createdAt: new Date(String(row.created_at)).toISOString(),
        };
      });
    } finally {
      client.release();
    }
  }

  async insertTransaction(input: ImportTransactionInput): Promise<{ inserted: boolean; row: StoredImportTransaction }> {
    const encrypted = this.cipher
      ? await this.cipher.encryptField(input.accountId, input.descriptorRaw)
      : input.descriptorRaw;
    const client = await this.client();
    try {
      await this.ensureSchema(client);
      return await withUser(client, input.accountId, async () => {
        const res = await client.query(
          `insert into transactions (id, account_id, import_id, raw_row_id, line_number, posted_date, amount_minor,
             currency, descriptor_raw, descriptor_clean, merchant_id, category_id, source, external_id,
             dedupe_key, idempotency_key, pipeline_version)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           on conflict do nothing
           returning *`,
          [
            input.id,
            input.accountId,
            input.importId,
            input.rawRowId,
            input.lineNumber,
            input.postedDate,
            input.amountMinor,
            input.currency,
            encrypted,
            input.descriptorClean,
            input.merchantId,
            input.categoryId,
            input.source,
            input.externalId,
            input.dedupeKey,
            input.idempotencyKey,
            input.pipelineVersion,
          ],
        );
        if (res.rows[0]) {
          return { inserted: true, row: rowToTransaction(res.rows[0] as Record<string, unknown>) };
        }
        const existing = await client.query(
          'select * from transactions where account_id = $1 and (dedupe_key = $2 or idempotency_key = $3) limit 1',
          [input.accountId, input.dedupeKey, input.idempotencyKey],
        );
        if (!existing.rows[0]) throw new Error('transaction_conflict_without_row');
        return { inserted: false, row: rowToTransaction(existing.rows[0] as Record<string, unknown>) };
      });
    } finally {
      client.release();
    }
  }

  async listTransactions(
    accountId: string,
    opts: { limit?: number; offset?: number; from?: string; to?: string; importId?: string } = {},
  ): Promise<StoredImportTransaction[]> {
    const client = await this.client();
    try {
      await this.ensureSchema(client);
      const rows = await withUser(client, accountId, async () => {
        const res = await client.query(
          `select * from transactions
           where account_id = $1
             and ($2::date is null or posted_date >= $2::date)
             and ($3::date is null or posted_date <= $3::date)
             and ($4::uuid is null or import_id = $4::uuid)
           order by posted_date desc, created_at desc, id desc
           limit $5 offset $6`,
          [
            accountId,
            opts.from ?? null,
            opts.to ?? null,
            opts.importId ?? null,
            opts.limit ?? 500,
            Math.max(0, opts.offset ?? 0),
          ],
        );
        return res.rows.map((row) => rowToTransaction(row as Record<string, unknown>));
      });
      return await Promise.all(rows.map(async (row) => ({
        ...row,
        descriptorRaw: this.cipher ? await this.cipher.decryptField(accountId, row.descriptorRaw) : row.descriptorRaw,
      })));
    } finally {
      client.release();
    }
  }

  async existingDedupeKeys(accountId: string, keys: readonly string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const client = await this.client();
    try {
      await this.ensureSchema(client);
      return await withUser(client, accountId, async () => {
        const res = await client.query(
          'select dedupe_key from transactions where account_id = $1 and dedupe_key = any($2::text[])',
          [accountId, keys],
        );
        return new Set(res.rows.map((row) => String((row as { dedupe_key: string }).dedupe_key)));
      });
    } finally {
      client.release();
    }
  }

  async listPresets(accountId: string): Promise<ImportPreset[]> {
    const client = await this.client();
    try {
      await this.ensureSchema(client);
      const saved = await withUser(client, accountId, async () => {
        const res = await client.query('select * from import_presets where account_id = $1 order by name', [accountId]);
        return res.rows.map((row) => {
          const r = row as Record<string, unknown>;
          return {
            id: String(r.id),
            name: String(r.name),
            source: r.source as ImportSource,
            mapping: asObject(r.mapping, {} as ImportColumnMapping),
            builtIn: false,
            createdAt: new Date(String(r.created_at)).toISOString(),
          } satisfies ImportPreset;
        });
      });
      return [...clone(BUILT_IN_PRESETS), ...saved];
    } finally {
      client.release();
    }
  }

  async savePreset(
    accountId: string,
    preset: Omit<ImportPreset, 'id' | 'createdAt' | 'builtIn'> & { id?: string },
  ): Promise<ImportPreset> {
    const client = await this.client();
    try {
      await this.ensureSchema(client);
      return await withUser(client, accountId, async () => {
        const res = await client.query(
          `insert into import_presets (id, account_id, name, source, mapping)
           values ($1, $2, $3, $4, $5::jsonb)
           on conflict (account_id, name) do update set source = excluded.source, mapping = excluded.mapping
           returning *`,
          [preset.id ?? randomUUID(), accountId, preset.name, preset.source, JSON.stringify(preset.mapping)],
        );
        const r = res.rows[0] as Record<string, unknown>;
        return {
          id: String(r.id),
          name: String(r.name),
          source: r.source as ImportSource,
          mapping: asObject(r.mapping, preset.mapping),
          builtIn: false,
          createdAt: new Date(String(r.created_at)).toISOString(),
        };
      });
    } finally {
      client.release();
    }
  }

  async deleteImport(accountId: string, importId: string): Promise<void> {
    const client = await this.client();
    try {
      await this.ensureSchema(client);
      await withUser(client, accountId, async () => {
        await client.query('delete from transactions where account_id = $1 and import_id = $2', [accountId, importId]);
        await client.query('delete from raw_rows where account_id = $1 and import_id = $2', [accountId, importId]);
        await client.query('delete from imports where account_id = $1 and id = $2', [accountId, importId]);
      });
    } finally {
      client.release();
    }
  }

  async deleteAll(accountId: string): Promise<void> {
    const client = await this.client();
    try {
      await this.ensureSchema(client);
      await withUser(client, accountId, async () => {
        await client.query('delete from transactions where account_id = $1', [accountId]);
        await client.query('delete from raw_rows where account_id = $1', [accountId]);
        await client.query('delete from imports where account_id = $1', [accountId]);
        await client.query('delete from import_presets where account_id = $1', [accountId]);
      });
    } finally {
      client.release();
    }
  }
}

export function createImportStore(
  env: NodeJS.ProcessEnv = process.env,
  cipher?: FieldCipher,
): ImportStore {
  const url = databaseUrlFromEnv(env);
  if (url) return new PostgresImportStore(url, cipher);
  return new InMemoryImportStore(cipher);
}
