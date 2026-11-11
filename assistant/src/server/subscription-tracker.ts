import { databaseUrlFromEnv } from './integrity-postgres.js';
import { sharedPool } from './pg-pool.js';
import { withUser } from './rls.js';
import { ensureSchemaOnce } from './schema-gate.js';
import type { SubscriptionMark } from './subscriptions.js';

/**
 * "Mark to cancel" is the only mutable subscription state. The streams are
 * derived from spending on every read, so a mark is stored by stream id and
 * disappears with the account.
 */
export interface SubscriptionTrackerStore {
  list(accountId: string): Promise<SubscriptionMark[]>;
  set(accountId: string, streamId: string, markedToCancel: boolean, now?: Date): Promise<SubscriptionMark>;
  deleteAll(accountId: string): Promise<void>;
}

function markKey(accountId: string, streamId: string): string {
  return `${accountId}\u0000${streamId}`;
}

export class InMemorySubscriptionTrackerStore implements SubscriptionTrackerStore {
  private readonly marks = new Map<string, SubscriptionMark>();

  async list(accountId: string): Promise<SubscriptionMark[]> {
    return [...this.marks.values()]
      .filter((mark) => mark.accountId === accountId && mark.markedToCancel)
      .sort((a, b) => a.streamId.localeCompare(b.streamId));
  }

  async set(accountId: string, streamId: string, markedToCancel: boolean, now = new Date()): Promise<SubscriptionMark> {
    const mark: SubscriptionMark = { accountId, streamId, markedToCancel, markedAt: now.toISOString() };
    if (markedToCancel) this.marks.set(markKey(accountId, streamId), mark);
    else this.marks.delete(markKey(accountId, streamId));
    return mark;
  }

  async deleteAll(accountId: string): Promise<void> {
    for (const key of this.marks.keys()) {
      if (key.startsWith(`${accountId}\u0000`)) this.marks.delete(key);
    }
  }
}

const SCHEMA_SQL = `
create table if not exists subscription_marks (
    account_id       uuid        not null,
    stream_id        text        not null,
    marked_to_cancel boolean     not null default true,
    marked_at        timestamptz not null default now(),
    primary key (account_id, stream_id)
);
alter table subscription_marks enable row level security;
alter table subscription_marks force row level security;
drop policy if exists subscription_marks_owner on subscription_marks;
create policy subscription_marks_owner on subscription_marks
    using (account_id::text = current_setting('app.user_id', true))
    with check (account_id::text = current_setting('app.user_id', true));
do $$
begin
    grant select, insert, update, delete on subscription_marks to settle_app;
exception
    when undefined_object then null;
    when insufficient_privilege then null;
end
$$;
`;

export class PostgresSubscriptionTrackerStore implements SubscriptionTrackerStore {
  constructor(private readonly connectionString: string) {}

  private async ensureSchema(c: import('pg').PoolClient) {
    await ensureSchemaOnce(c, this.connectionString, 'subscription-marks', 1, async () => {
      await c.query(SCHEMA_SQL);
    });
  }

  private rowToMark(row: Record<string, unknown>): SubscriptionMark {
    return {
      accountId: String(row.account_id),
      streamId: String(row.stream_id),
      markedToCancel: Boolean(row.marked_to_cancel),
      markedAt: new Date(String(row.marked_at)).toISOString(),
    };
  }

  async list(accountId: string): Promise<SubscriptionMark[]> {
    const c = await sharedPool(this.connectionString).connect();
    try {
      await this.ensureSchema(c);
      return await withUser(c, accountId, async () => {
        const res = await c.query(
          `select account_id, stream_id, marked_to_cancel, marked_at
             from subscription_marks
            where account_id = $1 and marked_to_cancel
            order by stream_id`,
          [accountId],
        );
        return res.rows.map((row) => this.rowToMark(row as Record<string, unknown>));
      });
    } finally {
      c.release();
    }
  }

  async set(accountId: string, streamId: string, markedToCancel: boolean, now = new Date()): Promise<SubscriptionMark> {
    const c = await sharedPool(this.connectionString).connect();
    try {
      await this.ensureSchema(c);
      return await withUser(c, accountId, async () => {
        if (!markedToCancel) {
          await c.query('delete from subscription_marks where account_id = $1 and stream_id = $2', [accountId, streamId]);
          return { accountId, streamId, markedToCancel: false, markedAt: now.toISOString() };
        }
        const res = await c.query(
          `insert into subscription_marks (account_id, stream_id, marked_to_cancel, marked_at)
           values ($1, $2, true, $3)
           on conflict (account_id, stream_id) do update
             set marked_to_cancel = true, marked_at = excluded.marked_at
           returning account_id, stream_id, marked_to_cancel, marked_at`,
          [accountId, streamId, now.toISOString()],
        );
        return this.rowToMark(res.rows[0] as Record<string, unknown>);
      });
    } finally {
      c.release();
    }
  }

  async deleteAll(accountId: string): Promise<void> {
    const c = await sharedPool(this.connectionString).connect();
    try {
      await this.ensureSchema(c);
      await withUser(c, accountId, async () => {
        await c.query('delete from subscription_marks where account_id = $1', [accountId]);
      });
    } finally {
      c.release();
    }
  }
}

export function createSubscriptionTrackerStore(
  env: NodeJS.ProcessEnv = process.env,
): SubscriptionTrackerStore {
  const url = databaseUrlFromEnv(env);
  if (url) return new PostgresSubscriptionTrackerStore(url);
  return new InMemorySubscriptionTrackerStore();
}
