import { randomUUID } from 'node:crypto';
import type { SpendCategory } from '../spend-log.js';
import { databaseUrlFromEnv } from '../integrity-postgres.js';
import { sharedPool } from '../pg-pool.js';
import { withUser } from '../rls.js';
import { ensureSchemaOnce } from '../schema-gate.js';
import {
  defaultMerchantCatalog,
  normalizeMerchantName,
  type MerchantRecord,
} from './merchants.js';
import type {
  CategoryOverride,
  RuleDraft,
  UserRule,
} from './categorize.js';

export interface MerchantDraft {
  name: string;
  domain?: string | null;
  defaultCategory?: SpendCategory | null;
  aliases?: string[];
}

export interface EnrichmentStore {
  listMerchants(accountId: string): Promise<MerchantRecord[]>;
  addAlias(accountId: string, merchantId: string, alias: string): Promise<MerchantRecord | null>;
  createMerchant(accountId: string, draft: MerchantDraft, now?: Date): Promise<MerchantRecord>;
  listRules(accountId: string): Promise<UserRule[]>;
  listRuleVersions(accountId: string): Promise<UserRule[]>;
  createRule(accountId: string, draft: RuleDraft, now?: Date): Promise<UserRule>;
  updateRule(accountId: string, ruleId: string, draft: RuleDraft, now?: Date): Promise<UserRule | null>;
  archiveRule(accountId: string, ruleId: string): Promise<boolean>;
  getOverrides(accountId: string): Promise<Map<string, CategoryOverride>>;
  setOverride(accountId: string, transactionId: string, override: CategoryOverride, now?: Date): Promise<void>;
  clearOverride(accountId: string, transactionId: string): Promise<void>;
  deleteAll?(accountId: string): Promise<void>;
}

export function mergeMerchantAlias(merchant: MerchantRecord, alias: string): MerchantRecord {
  const clean = normalizeMerchantName(alias);
  if (!clean) return merchant;
  const aliases = new Set(merchant.aliases.map(normalizeMerchantName).filter(Boolean));
  aliases.add(clean);
  return { ...merchant, aliases: [...aliases].sort() };
}

function cloneMerchant(merchant: MerchantRecord): MerchantRecord {
  return { ...merchant, aliases: [...merchant.aliases] };
}

function ruleDraft(draft: RuleDraft): RuleDraft {
  return {
    merchantContains: draft.merchantContains.trim(),
    maxAmountMinor: draft.maxAmountMinor,
    category: draft.category,
  };
}

/** In-memory store used by tests, practice wallets, and a server without a database. */
export class InMemoryEnrichmentStore implements EnrichmentStore {
  private readonly merchants = new Map<string, MerchantRecord[]>();
  private readonly rules = new Map<string, UserRule[]>();
  private readonly overrides = new Map<string, Map<string, CategoryOverride>>();
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  private merchantList(accountId: string): MerchantRecord[] {
    let rows = this.merchants.get(accountId);
    if (!rows) {
      rows = defaultMerchantCatalog();
      this.merchants.set(accountId, rows);
    }
    return rows;
  }

  async listMerchants(accountId: string): Promise<MerchantRecord[]> {
    return this.merchantList(accountId).map(cloneMerchant);
  }

  async addAlias(accountId: string, merchantId: string, alias: string): Promise<MerchantRecord | null> {
    const clean = normalizeMerchantName(alias);
    if (!clean) return null;
    const rows = this.merchantList(accountId);
    const target = rows.find((merchant) => merchant.id === merchantId);
    if (!target) return null;
    // An alias has one owner. Correcting an old mapping moves it rather than
    // leaving an exact hit that still points at the wrong merchant.
    for (const merchant of rows) {
      if (merchant.id !== merchantId) {
        merchant.aliases = merchant.aliases.filter((entry) => normalizeMerchantName(entry) !== clean);
      }
    }
    target.aliases = mergeMerchantAlias(target, clean).aliases;
    return cloneMerchant(target);
  }

  async createMerchant(accountId: string, draft: MerchantDraft): Promise<MerchantRecord> {
    const rows = this.merchantList(accountId);
    const normalized = normalizeMerchantName(draft.name);
    const existing = rows.find((merchant) => normalizeMerchantName(merchant.name) === normalized);
    if (existing) {
      for (const alias of [draft.name, ...(draft.aliases ?? [])]) {
        await this.addAlias(accountId, existing.id, alias);
      }
      return cloneMerchant(rows.find((merchant) => merchant.id === existing.id)!);
    }
    const merchant: MerchantRecord = {
      id: randomUUID(),
      name: draft.name.trim(),
      domain: draft.domain ?? null,
      defaultCategory: draft.defaultCategory ?? null,
      aliases: [],
    };
    rows.push(merchant);
    for (const alias of [draft.name, ...(draft.aliases ?? [])]) {
      await this.addAlias(accountId, merchant.id, alias);
    }
    return cloneMerchant(merchant);
  }

  async listRules(accountId: string): Promise<UserRule[]> {
    return (this.rules.get(accountId) ?? [])
      .filter((rule) => rule.status === 'active')
      .map((rule) => ({ ...rule }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.version - a.version);
  }

  async listRuleVersions(accountId: string): Promise<UserRule[]> {
    return [...(this.rules.get(accountId) ?? [])]
      .map((rule) => ({ ...rule }))
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId) || b.version - a.version);
  }

  async createRule(accountId: string, draft: RuleDraft, now = this.now()): Promise<UserRule> {
    const rows = this.rules.get(accountId) ?? [];
    const ruleId = randomUUID();
    const rule: UserRule = {
      id: `${ruleId}:v1`,
      ruleId,
      accountId,
      ...ruleDraft(draft),
      version: 1,
      status: 'active',
      createdAt: now.toISOString(),
    };
    rows.push(rule);
    this.rules.set(accountId, rows);
    return { ...rule };
  }

  async updateRule(accountId: string, ruleId: string, draft: RuleDraft, now = this.now()): Promise<UserRule | null> {
    const rows = this.rules.get(accountId) ?? [];
    const versions = rows.filter((rule) => rule.ruleId === ruleId);
    if (versions.length === 0) return null;
    const latest = Math.max(...versions.map((rule) => rule.version));
    for (const rule of versions) {
      if (rule.status === 'active') rule.status = 'archived';
    }
    const next: UserRule = {
      id: `${ruleId}:v${latest + 1}`,
      ruleId,
      accountId,
      ...ruleDraft(draft),
      version: latest + 1,
      status: 'active',
      createdAt: now.toISOString(),
    };
    rows.push(next);
    return { ...next };
  }

  async archiveRule(accountId: string, ruleId: string): Promise<boolean> {
    const rows = this.rules.get(accountId) ?? [];
    let changed = false;
    for (const rule of rows) {
      if (rule.ruleId === ruleId && rule.status === 'active') {
        rule.status = 'archived';
        changed = true;
      }
    }
    return changed;
  }

  async getOverrides(accountId: string): Promise<Map<string, CategoryOverride>> {
    const rows = this.overrides.get(accountId) ?? new Map<string, CategoryOverride>();
    return new Map([...rows.entries()].map(([id, override]) => [id, { ...override }]));
  }

  async setOverride(accountId: string, transactionId: string, override: CategoryOverride, _now = this.now()): Promise<void> {
    const rows = this.overrides.get(accountId) ?? new Map<string, CategoryOverride>();
    rows.set(transactionId, { ...override });
    this.overrides.set(accountId, rows);
  }

  async clearOverride(accountId: string, transactionId: string): Promise<void> {
    this.overrides.get(accountId)?.delete(transactionId);
  }

  async deleteAll(accountId: string): Promise<void> {
    this.merchants.delete(accountId);
    this.rules.delete(accountId);
    this.overrides.delete(accountId);
  }
}

const SCHEMA_SQL = `
create table if not exists merchants (
    id               uuid primary key,
    account_id       uuid not null,
    name             text not null,
    normalized_name  text not null,
    domain           text,
    default_category text,
    created_at       timestamptz not null default now(),
    unique (account_id, normalized_name)
);
create index if not exists merchants_account_idx on merchants (account_id);

create table if not exists merchant_aliases (
    id               uuid primary key,
    account_id       uuid not null,
    merchant_id      uuid not null references merchants(id) on delete cascade,
    alias            text not null,
    normalized_alias text not null,
    unique (account_id, normalized_alias)
);
create index if not exists merchant_aliases_merchant_idx on merchant_aliases (account_id, merchant_id);

create table if not exists categorization_rules (
    id                text primary key,
    account_id        uuid not null,
    rule_id           text not null,
    version           int not null,
    merchant_contains text not null,
    max_amount_minor  bigint,
    category          text not null,
    status            text not null,
    created_at        timestamptz not null,
    unique (account_id, rule_id, version)
);
create index if not exists categorization_rules_account_idx on categorization_rules (account_id, status);

create table if not exists categorization_overrides (
    account_id     uuid not null,
    transaction_id text not null,
    category       text not null,
    source         text not null,
    rule_id        text,
    rule_version   int,
    merchant_id    uuid,
    updated_at     timestamptz not null,
    primary key (account_id, transaction_id)
);
`;

const ENRICHMENT_RLS_DDL = `
alter table if exists merchants enable row level security;
alter table if exists merchants force row level security;
alter table if exists merchant_aliases enable row level security;
alter table if exists merchant_aliases force row level security;
alter table if exists categorization_rules enable row level security;
alter table if exists categorization_rules force row level security;
alter table if exists categorization_overrides enable row level security;
alter table if exists categorization_overrides force row level security;

drop policy if exists merchants_owner on merchants;
create policy merchants_owner on merchants
    using (account_id::text = current_setting('app.user_id', true))
    with check (account_id::text = current_setting('app.user_id', true));

drop policy if exists merchant_aliases_owner on merchant_aliases;
create policy merchant_aliases_owner on merchant_aliases
    using (account_id::text = current_setting('app.user_id', true))
    with check (account_id::text = current_setting('app.user_id', true));

drop policy if exists categorization_rules_owner on categorization_rules;
create policy categorization_rules_owner on categorization_rules
    using (account_id::text = current_setting('app.user_id', true))
    with check (account_id::text = current_setting('app.user_id', true));

drop policy if exists categorization_overrides_owner on categorization_overrides;
create policy categorization_overrides_owner on categorization_overrides
    using (account_id::text = current_setting('app.user_id', true))
    with check (account_id::text = current_setting('app.user_id', true));

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'settle_app') then
        create role settle_app nologin;
    end if;
    grant select, insert, update, delete on merchants to settle_app;
    grant select, insert, update, delete on merchant_aliases to settle_app;
    grant select, insert, update, delete on categorization_rules to settle_app;
    grant select, insert, update, delete on categorization_overrides to settle_app;
exception
    when insufficient_privilege then
        raise notice 'settle_app role setup skipped: %', sqlerrm;
end
$$;
`;

function mapMerchant(row: Record<string, unknown>, aliases: string[]): MerchantRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    domain: row.domain == null ? null : String(row.domain),
    defaultCategory: (row.default_category as SpendCategory | null) ?? null,
    aliases,
  };
}

function mapRule(row: Record<string, unknown>): UserRule {
  return {
    id: String(row.id),
    ruleId: String(row.rule_id),
    accountId: String(row.account_id),
    merchantContains: String(row.merchant_contains),
    maxAmountMinor: row.max_amount_minor == null ? null : Number(row.max_amount_minor),
    category: row.category as SpendCategory,
    version: Number(row.version),
    status: row.status as UserRule['status'],
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

/** Postgres store: one row per rule version, one alias owner, RLS on every table. */
export class PostgresEnrichmentStore implements EnrichmentStore {
  constructor(private readonly connectionString: string) {}

  private async client() {
    return sharedPool(this.connectionString).connect();
  }

  private async ensureSchema(c: import('pg').PoolClient) {
    await ensureSchemaOnce(c, this.connectionString, 'enrichment', 1, async () => {
      await c.query(SCHEMA_SQL);
      await c.query(ENRICHMENT_RLS_DDL);
    });
  }

  private async rowsToMerchants(c: import('pg').PoolClient, accountId: string): Promise<MerchantRecord[]> {
    const merchants = await c.query(
      `select id, name, domain, default_category from merchants where account_id = $1 order by name`,
      [accountId],
    );
    const aliases = await c.query(
      `select merchant_id, alias from merchant_aliases where account_id = $1 order by alias`,
      [accountId],
    );
    const byMerchant = new Map<string, string[]>();
    for (const row of aliases.rows) {
      const id = String((row as Record<string, unknown>).merchant_id);
      const list = byMerchant.get(id) ?? [];
      list.push(String((row as Record<string, unknown>).alias));
      byMerchant.set(id, list);
    }
    return merchants.rows.map((row) => mapMerchant(row as Record<string, unknown>, byMerchant.get(String((row as Record<string, unknown>).id)) ?? []));
  }

  private async seedCatalog(c: import('pg').PoolClient, accountId: string): Promise<void> {
    for (const merchant of defaultMerchantCatalog()) {
      const id = randomUUID();
      await c.query(
        `insert into merchants (id, account_id, name, normalized_name, domain, default_category)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (account_id, normalized_name) do nothing`,
        [id, accountId, merchant.name, normalizeMerchantName(merchant.name), merchant.domain, merchant.defaultCategory],
      );
      const found = await c.query(
        `select id from merchants where account_id = $1 and normalized_name = $2`,
        [accountId, normalizeMerchantName(merchant.name)],
      );
      const merchantId = String((found.rows[0] as { id?: unknown } | undefined)?.id ?? id);
      for (const alias of merchant.aliases) {
        await c.query(
          `insert into merchant_aliases (id, account_id, merchant_id, alias, normalized_alias)
           values ($1, $2, $3, $4, $5)
           on conflict (account_id, normalized_alias) do update
             set merchant_id = excluded.merchant_id, alias = excluded.alias`,
          [randomUUID(), accountId, merchantId, alias, normalizeMerchantName(alias)],
        );
      }
    }
  }

  async listMerchants(accountId: string): Promise<MerchantRecord[]> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      return await withUser(c, accountId, async () => {
        const count = await c.query('select count(*)::int as count from merchants where account_id = $1', [accountId]);
        if (Number((count.rows[0] as { count?: unknown } | undefined)?.count ?? 0) === 0) {
          await this.seedCatalog(c, accountId);
        }
        return this.rowsToMerchants(c, accountId);
      });
    } finally {
      c.release();
    }
  }

  async addAlias(accountId: string, merchantId: string, alias: string): Promise<MerchantRecord | null> {
    const clean = normalizeMerchantName(alias);
    if (!clean) return null;
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      return await withUser(c, accountId, async () => {
        const merchant = await c.query('select id from merchants where account_id = $1 and id = $2', [accountId, merchantId]);
        if (!merchant.rows[0]) return null;
        await c.query(
          `insert into merchant_aliases (id, account_id, merchant_id, alias, normalized_alias)
           values ($1, $2, $3, $4, $5)
           on conflict (account_id, normalized_alias) do update
             set merchant_id = excluded.merchant_id, alias = excluded.alias`,
          [randomUUID(), accountId, merchantId, alias, clean],
        );
        const rows = await this.rowsToMerchants(c, accountId);
        return rows.find((row) => row.id === merchantId) ?? null;
      });
    } finally {
      c.release();
    }
  }

  async createMerchant(accountId: string, draft: MerchantDraft, now = new Date()): Promise<MerchantRecord> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      return await withUser(c, accountId, async () => {
        const normalized = normalizeMerchantName(draft.name);
        const existing = await c.query(
          'select id from merchants where account_id = $1 and normalized_name = $2',
          [accountId, normalized],
        );
        let id = String((existing.rows[0] as { id?: unknown } | undefined)?.id ?? '');
        if (!id) {
          id = randomUUID();
          await c.query(
            `insert into merchants (id, account_id, name, normalized_name, domain, default_category, created_at)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [id, accountId, draft.name.trim(), normalized, draft.domain ?? null, draft.defaultCategory ?? null, now.toISOString()],
          );
        }
        for (const alias of [draft.name, ...(draft.aliases ?? [])]) {
          const clean = normalizeMerchantName(alias);
          if (!clean) continue;
          await c.query(
            `insert into merchant_aliases (id, account_id, merchant_id, alias, normalized_alias)
             values ($1, $2, $3, $4, $5)
             on conflict (account_id, normalized_alias) do update
               set merchant_id = excluded.merchant_id, alias = excluded.alias`,
            [randomUUID(), accountId, id, alias, clean],
          );
        }
        const rows = await this.rowsToMerchants(c, accountId);
        return rows.find((row) => row.id === id)!;
      });
    } finally {
      c.release();
    }
  }

  async listRules(accountId: string): Promise<UserRule[]> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      return await withUser(c, accountId, async () => {
        const res = await c.query(
          `select * from categorization_rules
           where account_id = $1 and status = 'active' order by created_at desc, version desc`,
          [accountId],
        );
        return res.rows.map((row) => mapRule(row as Record<string, unknown>));
      });
    } finally {
      c.release();
    }
  }

  async listRuleVersions(accountId: string): Promise<UserRule[]> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      return await withUser(c, accountId, async () => {
        const res = await c.query(
          `select * from categorization_rules where account_id = $1
           order by rule_id, version desc`,
          [accountId],
        );
        return res.rows.map((row) => mapRule(row as Record<string, unknown>));
      });
    } finally {
      c.release();
    }
  }

  async createRule(accountId: string, draft: RuleDraft, now = new Date()): Promise<UserRule> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      return await withUser(c, accountId, async () => {
        const ruleId = randomUUID();
        const id = `${ruleId}:v1`;
        const values = ruleDraft(draft);
        await c.query(
          `insert into categorization_rules
             (id, account_id, rule_id, version, merchant_contains, max_amount_minor, category, status, created_at)
           values ($1, $2, $3, 1, $4, $5, $6, 'active', $7)`,
          [id, accountId, ruleId, values.merchantContains, values.maxAmountMinor, values.category, now.toISOString()],
        );
        return {
          id,
          ruleId,
          accountId,
          ...values,
          version: 1,
          status: 'active',
          createdAt: now.toISOString(),
        };
      });
    } finally {
      c.release();
    }
  }

  async updateRule(accountId: string, ruleId: string, draft: RuleDraft, now = new Date()): Promise<UserRule | null> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      return await withUser(c, accountId, async () => {
        const latest = await c.query(
          `select max(version)::int as version from categorization_rules where account_id = $1 and rule_id = $2`,
          [accountId, ruleId],
        );
        const version = (latest.rows[0] as { version?: unknown } | undefined)?.version;
        if (version == null) return null;
        await c.query(
          `update categorization_rules set status = 'archived'
           where account_id = $1 and rule_id = $2 and status = 'active'`,
          [accountId, ruleId],
        );
        const nextVersion = Number(version) + 1;
        const id = `${ruleId}:v${nextVersion}`;
        const values = ruleDraft(draft);
        await c.query(
          `insert into categorization_rules
             (id, account_id, rule_id, version, merchant_contains, max_amount_minor, category, status, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, 'active', $8)`,
          [id, accountId, ruleId, nextVersion, values.merchantContains, values.maxAmountMinor, values.category, now.toISOString()],
        );
        return {
          id,
          ruleId,
          accountId,
          ...values,
          version: nextVersion,
          status: 'active',
          createdAt: now.toISOString(),
        };
      });
    } finally {
      c.release();
    }
  }

  async archiveRule(accountId: string, ruleId: string): Promise<boolean> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      return await withUser(c, accountId, async () => {
        const res = await c.query(
          `update categorization_rules set status = 'archived'
           where account_id = $1 and rule_id = $2 and status = 'active'`,
          [accountId, ruleId],
        );
        return (res.rowCount ?? 0) > 0;
      });
    } finally {
      c.release();
    }
  }

  async getOverrides(accountId: string): Promise<Map<string, CategoryOverride>> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      return await withUser(c, accountId, async () => {
        const res = await c.query(
          `select transaction_id, category, source, rule_id, rule_version, merchant_id
           from categorization_overrides where account_id = $1`,
          [accountId],
        );
        const out = new Map<string, CategoryOverride>();
        for (const row of res.rows) {
          const value = row as Record<string, unknown>;
          out.set(String(value.transaction_id), {
            category: value.category as SpendCategory,
            source: value.source as CategoryOverride['source'],
            ruleId: value.rule_id == null ? null : String(value.rule_id),
            ruleVersion: value.rule_version == null ? null : Number(value.rule_version),
            merchantId: value.merchant_id == null ? null : String(value.merchant_id),
          });
        }
        return out;
      });
    } finally {
      c.release();
    }
  }

  async setOverride(accountId: string, transactionId: string, override: CategoryOverride, now = new Date()): Promise<void> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      await withUser(c, accountId, async () => {
        await c.query(
          `insert into categorization_overrides
             (account_id, transaction_id, category, source, rule_id, rule_version, merchant_id, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (account_id, transaction_id) do update
             set category = excluded.category,
                 source = excluded.source,
                 rule_id = excluded.rule_id,
                 rule_version = excluded.rule_version,
                 merchant_id = excluded.merchant_id,
                 updated_at = excluded.updated_at`,
          [
            accountId,
            transactionId,
            override.category,
            override.source,
            override.ruleId,
            override.ruleVersion,
            override.merchantId,
            now.toISOString(),
          ],
        );
      });
    } finally {
      c.release();
    }
  }

  async clearOverride(accountId: string, transactionId: string): Promise<void> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      await withUser(c, accountId, async () => {
        await c.query(
          'delete from categorization_overrides where account_id = $1 and transaction_id = $2',
          [accountId, transactionId],
        );
      });
    } finally {
      c.release();
    }
  }

  async deleteAll(accountId: string): Promise<void> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      await withUser(c, accountId, async () => {
        await c.query('delete from categorization_overrides where account_id = $1', [accountId]);
        await c.query('delete from categorization_rules where account_id = $1', [accountId]);
        await c.query('delete from merchant_aliases where account_id = $1', [accountId]);
        await c.query('delete from merchants where account_id = $1', [accountId]);
      });
    } finally {
      c.release();
    }
  }
}

export function createEnrichmentStore(
  env: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
): EnrichmentStore {
  const url = databaseUrlFromEnv(env);
  if (url) return new PostgresEnrichmentStore(url);
  return new InMemoryEnrichmentStore(now);
}
