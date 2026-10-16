import type { Integrity } from './ledger.js';

/** Same DB as ledger-service (Supabase / Render JDBC). Optional on Vercel when Java audit route is old. */
export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.LEDGER_DATABASE_URL?.trim() || env.DATABASE_URL?.trim();
  if (!raw) return undefined;
  return raw.startsWith('jdbc:') ? raw.slice('jdbc:'.length) : raw;
}

type Row = Record<string, string | number | null>;

export async function integrityFromPostgres(connectionString: string): Promise<Integrity | null> {
  try {
    const { default: pg } = await import('pg');
    const ssl = /supabase|sslmode=require/i.test(connectionString) ? { rejectUnauthorized: false } : undefined;
    const client = new pg.Client({ connectionString, ssl });
    await client.connect();
    try {
      const entry = await one(client, `
        select count(*)::bigint as entry_count,
               coalesce(sum(amount_minor), 0)::bigint as entries_sum_minor
        from ledger_entries`);
      const transfers = await one(client, 'select count(*)::bigint as c from transfers');
      const unbalanced = await one(client, `
        select count(*)::bigint as c from (
          select transfer_id from ledger_entries group by transfer_id having sum(amount_minor) <> 0
        ) u`);
      const rejected = await one(client, `
        select count(distinct t.id)::bigint as c
        from transfers t join ledger_entries e on e.transfer_id = t.id where t.status = 'REJECTED'`);
      const accounts = await one(client, "select count(*)::bigint as c from accounts where type = 'USER'");
      const drifted = await one(client, `
        select count(*)::bigint as c from (
          select a.id from accounts a
          left join ledger_entries e on e.account_id = a.id
          group by a.id, a.balance_minor
          having a.balance_minor <> coalesce(sum(e.amount_minor), 0)
        ) d`);
      const outbox = await one(client, `
        select count(*)::bigint as total,
               count(*) filter (where published_at is null)::bigint as pending,
               min(created_at) filter (where published_at is null) as oldest_pending
        from outbox_events`);
      const p95Row = await one(client, `
        select percentile_cont(0.95) within group (
          order by extract(epoch from (published_at - created_at)) * 1000
        ) as p95_ms
        from outbox_events where published_at is not null`);
      const entriesSumMinor = Number(entry.entries_sum_minor);
      const unbalancedTransfers = Number(unbalanced.c);
      const accountsDrifted = Number(drifted.c);
      const balanced = entriesSumMinor === 0 && unbalancedTransfers === 0 && accountsDrifted === 0;
      const p95 = p95Row.p95_ms === null ? null : Math.round(Number(p95Row.p95_ms));
      const oldestPendingAt = isoTimestamp(outbox.oldest_pending);
      return {
        checkedAt: new Date().toISOString(),
        entryCount: Number(entry.entry_count),
        entriesSumMinor,
        transferCount: Number(transfers.c),
        unbalancedTransfers,
        rejectedWithEntries: Number(rejected.c),
        accountCount: Number(accounts.c),
        accountsDrifted,
        outbox: {
          total: Number(outbox.total),
          pending: Number(outbox.pending),
          oldestPendingAt,
          p95DeliveryMs: p95,
        },
        balanced,
      };
    } finally {
      await client.end();
    }
  } catch (e) {
    console.error('integrityFromPostgres failed', e);
    return null;
  }
}

async function one(client: import('pg').Client, sql: string): Promise<Row> {
  const { rows } = await client.query(sql);
  return (rows[0] ?? {}) as Row;
}

function isoTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'object' && value instanceof Date) return value.toISOString();
  return String(value);
}
