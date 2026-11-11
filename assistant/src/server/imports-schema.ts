/**
 * M3.1 — canonical transaction contract and imports migration.
 *
 * The JSON Schema is the shared document; this module also exposes a small
 * runtime validator so importers and the pipeline reject rows before they are
 * staged. SQL lives here too, next to the fields it describes.
 */
import { fileURLToPath } from 'node:url';

export const IMPORT_SCHEMA_VERSION = 1;
export const PIPELINE_VERSION = 'm3.1.0';
export const TRANSACTION_SCHEMA_ID = 'https://settle.local/schemas/transaction.v1.json';
export const IMPORT_SCHEMA_JSON_PATH = fileURLToPath(
  new URL('../../../schemas/transaction.v1.json', import.meta.url),
);

export const IMPORT_SOURCES = ['csv', 'ofx', 'qfx'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const IMPORT_STAGE_IDS = ['parse', 'validate', 'stage', 'dedupe', 'post'] as const;
export type ImportStageId = (typeof IMPORT_STAGE_IDS)[number];

export const IMPORT_STATUSES = ['received', 'posted', 'failed', 'rejected'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const DELIMITERS = [
  { char: ',', label: 'comma' },
  { char: ';', label: 'semicolon' },
  { char: '\t', label: 'tab' },
] as const;

export interface CanonicalTransaction {
  postedDate: string;
  amountMinor: number;
  currency: string;
  descriptorRaw: string;
  descriptorClean: string;
  merchantId: string | null;
  categoryId: string;
  source: ImportSource;
  externalId: string | null;
  dedupeKey: string;
  idempotencyKey: string;
}

export interface TransactionValidation {
  ok: boolean;
  reasons: string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const IDEMPOTENCY = /^import-[a-f0-9]{64}-\d+$/;

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A real calendar date, not just three numbers with dashes. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Validate the normalized fields that every importer must produce. Reasons are
 * stable machine strings; UI copy is added by the caller.
 */
export function validateTransactionRow(input: unknown): TransactionValidation {
  const row = input as Partial<CanonicalTransaction> | null;
  const reasons: string[] = [];
  if (!row || typeof row !== 'object') return { ok: false, reasons: ['not_an_object'] };
  if (!isCalendarDate(row.postedDate)) reasons.push('bad_date');
  if (!Number.isSafeInteger(row.amountMinor)) reasons.push('amount_not_integer');
  if (typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency)) reasons.push('bad_currency');
  if (!nonEmptyString(row.descriptorRaw)) reasons.push('empty_descriptor');
  if (!nonEmptyString(row.descriptorClean)) reasons.push('empty_descriptor');
  if (!nonEmptyString(row.categoryId)) reasons.push('bad_category');
  if (!IMPORT_SOURCES.includes(row.source as ImportSource)) reasons.push('bad_source');
  if (typeof row.dedupeKey !== 'string' || !HEX64.test(row.dedupeKey)) reasons.push('bad_dedupe_key');
  if (typeof row.idempotencyKey !== 'string' || !IDEMPOTENCY.test(row.idempotencyKey)) {
    reasons.push('bad_idempotency_key');
  }
  return { ok: reasons.length === 0, reasons };
}

const RLS_TABLES = ['imports', 'raw_rows', 'transactions', 'import_presets'];

/**
 * Idempotent DDL. Every table is account-scoped and FORCE RLS applies to the
 * owner too; queries must run through withUser(). Uniqueness is per account so
 * one wallet's history can never block another's.
 */
export const IMPORTS_UP_SQL = `
create table if not exists imports (
    id                uuid        primary key,
    account_id        uuid        not null,
    file_hash         char(64)    not null,
    filename          text        not null,
    source            text        not null check (source in ('csv', 'ofx', 'qfx')),
    status            text        not null,
    pipeline_version  text        not null,
    counts            jsonb       not null default '{}'::jsonb,
    statement         jsonb       not null default '{}'::jsonb,
    stages            jsonb       not null default '{}'::jsonb,
    quality           jsonb       not null default '[]'::jsonb,
    reconciliation    jsonb       not null default '{}'::jsonb,
    errors            jsonb       not null default '[]'::jsonb,
    preset_id         text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    unique (account_id, file_hash)
);

create table if not exists raw_rows (
    id             uuid        primary key,
    account_id     uuid        not null,
    import_id      uuid        not null references imports(id) on delete cascade,
    line_number    int         not null,
    payload        jsonb       not null,
    reject_reason  text,
    created_at     timestamptz not null default now(),
    unique (import_id, line_number)
);

create table if not exists transactions (
    id                uuid        primary key,
    account_id        uuid        not null,
    import_id         uuid        not null references imports(id) on delete cascade,
    raw_row_id        uuid        references raw_rows(id) on delete set null,
    line_number       int         not null,
    posted_date       date        not null,
    amount_minor      bigint      not null,
    currency          char(3)     not null,
    descriptor_raw    text        not null,
    descriptor_clean  text        not null,
    merchant_id       text,
    category_id       text        not null,
    source            text        not null check (source in ('csv', 'ofx', 'qfx')),
    external_id       text,
    dedupe_key        char(64)    not null,
    idempotency_key   text        not null,
    pipeline_version  text        not null,
    created_at        timestamptz not null default now(),
    unique (account_id, dedupe_key),
    unique (account_id, idempotency_key)
);

create table if not exists import_presets (
    id          uuid        primary key,
    account_id  uuid        not null,
    name        text        not null,
    source      text        not null check (source in ('csv', 'ofx', 'qfx')),
    mapping     jsonb       not null,
    built_in    boolean     not null default false,
    created_at  timestamptz not null default now(),
    unique (account_id, name)
);

create index if not exists imports_account_created_idx on imports (account_id, created_at desc);
create index if not exists transactions_account_posted_idx on transactions (account_id, posted_date desc);
create index if not exists transactions_import_idx on transactions (import_id);

alter table imports enable row level security;
alter table imports force row level security;
alter table raw_rows enable row level security;
alter table raw_rows force row level security;
alter table transactions enable row level security;
alter table transactions force row level security;
alter table import_presets enable row level security;
alter table import_presets force row level security;

drop policy if exists imports_owner on imports;
create policy imports_owner on imports
    using (account_id::text = current_setting('app.user_id', true))
    with check (account_id::text = current_setting('app.user_id', true));

drop policy if exists raw_rows_owner on raw_rows;
create policy raw_rows_owner on raw_rows
    using (account_id::text = current_setting('app.user_id', true))
    with check (account_id::text = current_setting('app.user_id', true));

drop policy if exists transactions_owner on transactions;
create policy transactions_owner on transactions
    using (account_id::text = current_setting('app.user_id', true))
    with check (account_id::text = current_setting('app.user_id', true));

drop policy if exists import_presets_owner on import_presets;
create policy import_presets_owner on import_presets
    using (account_id::text = current_setting('app.user_id', true))
    with check (account_id::text = current_setting('app.user_id', true));

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'settle_app') then
        create role settle_app nologin;
    end if;
    grant select, insert, update, delete on imports, raw_rows, transactions, import_presets to settle_app;
exception
    when insufficient_privilege then
        raise notice 'settle_app role setup skipped: %', sqlerrm;
end
$$;
`;

/** Reverse migration, child tables first. */
export const IMPORTS_DOWN_SQL = `
drop table if exists transactions;
drop table if exists raw_rows;
drop table if exists import_presets;
drop table if exists imports;
`;

export function importsDdlForTables(tables: readonly string[] = RLS_TABLES): string {
  return tables.map((table) => `alter table ${table} enable row level security;`).join('\n');
}
