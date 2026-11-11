import { databaseUrlFromEnv } from './integrity-postgres.js';
import { sharedPool } from './pg-pool.js';
import { withUser } from './rls.js';
import { ensureSchemaOnce } from './schema-gate.js';

/**
 * Dismissed alert ids, scoped per account. The in-memory store serves tests and
 * local development; production uses the same shared Postgres pool and the
 * RLS identity helper as the rest of the personal-finance tables.
 */
export interface AlertDismissalStore {
  list(accountId: string): Promise<Set<string>>;
  dismiss(accountId: string, alertId: string, now?: Date): Promise<void>;
  deleteAll(accountId: string): Promise<void>;
}

export class InMemoryAlertDismissalStore implements AlertDismissalStore {
  private readonly byAccount = new Map<string, Set<string>>();

  async list(accountId: string): Promise<Set<string>> {
    return new Set(this.byAccount.get(accountId) ?? []);
  }

  async dismiss(accountId: string, alertId: string, _now?: Date): Promise<void> {
    const current = this.byAccount.get(accountId);
    if (current) current.add(alertId);
    else this.byAccount.set(accountId, new Set([alertId]));
  }

  async deleteAll(accountId: string): Promise<void> {
    this.byAccount.delete(accountId);
  }
}

const SCHEMA_SQL = `
create table if not exists alert_dismissals (
    account_id   uuid        not null,
    alert_id     text        not null,
    dismissed_at timestamptz not null default now(),
    primary key (account_id, alert_id)
);
create index if not exists alert_dismissals_account_idx on alert_dismissals (account_id);
`;

const ALERT_RLS_DDL = `
alter table if exists alert_dismissals enable row level security;
alter table if exists alert_dismissals force row level security;

drop policy if exists alert_dismissals_owner on alert_dismissals;
create policy alert_dismissals_owner on alert_dismissals
    using (account_id::text = current_setting('app.user_id', true))
    with check (account_id::text = current_setting('app.user_id', true));

do $$
begin
    grant select, insert, update, delete on alert_dismissals to settle_app;
exception
    when undefined_object then
        raise notice 'settle_app role is not present; alert dismissal grants skipped';
    when insufficient_privilege then
        raise notice 'alert dismissal grant skipped: %', sqlerrm;
end
$$;
`;

export class PostgresAlertDismissalStore implements AlertDismissalStore {
  constructor(private readonly connectionString: string) {}

  private async client() {
    return sharedPool(this.connectionString).connect();
  }

  private async ensureSchema(c: import('pg').PoolClient) {
    await ensureSchemaOnce(c, this.connectionString, 'alert-dismissals', 1, async () => {
      await c.query(SCHEMA_SQL);
      await c.query(ALERT_RLS_DDL);
    });
  }

  async list(accountId: string): Promise<Set<string>> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      const rows = await withUser(c, accountId, async () => {
        const res = await c.query(
          `select alert_id from alert_dismissals where account_id = $1 order by alert_id`,
          [accountId],
        );
        return res.rows as { alert_id: string }[];
      });
      return new Set(rows.map((row) => row.alert_id));
    } finally {
      c.release();
    }
  }

  async dismiss(accountId: string, alertId: string, now = new Date()): Promise<void> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      await withUser(c, accountId, async () => {
        await c.query(
          `insert into alert_dismissals (account_id, alert_id, dismissed_at)
           values ($1, $2, $3)
           on conflict (account_id, alert_id) do update set dismissed_at = excluded.dismissed_at`,
          [accountId, alertId, now.toISOString()],
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
        await c.query(`delete from alert_dismissals where account_id = $1`, [accountId]);
      });
    } finally {
      c.release();
    }
  }
}

export function createAlertDismissalStore(env: NodeJS.ProcessEnv = process.env): AlertDismissalStore {
  const url = databaseUrlFromEnv(env);
  if (url) return new PostgresAlertDismissalStore(url);
  return new InMemoryAlertDismissalStore();
}
