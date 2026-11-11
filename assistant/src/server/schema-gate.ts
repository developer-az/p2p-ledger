import type { ClientBase } from 'pg';

/**
 * Run a store's schema DDL at most once per process and once per database
 * version.
 *
 * Every process used to run the full `create table if not exists` / `alter
 * table add column if not exists` / `create or replace function` bundle on its
 * first request. Those statements still take strong table locks on Postgres,
 * so a handful of instances starting together deadlock against each other even
 * though nothing changes. The fast path here is a single select against
 * `app_schema_versions`; only a database that is actually behind runs DDL, and
 * it does so under one transaction-scoped advisory lock so instances serialize
 * instead of colliding.
 */

const VERSIONS_DDL = `create table if not exists app_schema_versions (
    name       text primary key,
    version    int  not null,
    applied_at timestamptz default now()
)`;

const VERSION_SQL = 'select version from app_schema_versions where name = $1';

/** Per-process results, keyed by store name and target version. */
const applied = new Map<string, Promise<void>>();

function keyFor(name: string, version: number): string {
  return `${name}\u0000${version}`;
}

async function currentVersion(client: ClientBase, name: string): Promise<number> {
  const result = await client.query(VERSION_SQL, [name]);
  const row = result.rows[0] as { version?: string | number } | undefined;
  return row?.version === undefined ? 0 : Number(row.version);
}

async function runOnce(
  client: ClientBase,
  name: string,
  version: number,
  ddl: () => Promise<void>,
): Promise<void> {
  // Creating the bookkeeping table is cheap when it already exists and does
  // not take a strong lock, so it stays on the fast path.
  await client.query(VERSIONS_DDL);
  if (await currentVersion(client, name) >= version) return;

  await client.query('begin');
  try {
    // One lock name for every store: schema changes are rare, so serializing
    // all of them keeps a startup burst from holding several table locks at
    // once in different orders.
    await client.query("select pg_advisory_xact_lock(hashtext('settle-schema'))");
    if (await currentVersion(client, name) < version) {
      await ddl();
      await client.query(
        `insert into app_schema_versions(name, version, applied_at)
         values($1, $2, now())
         on conflict (name) do update
           set version = greatest(app_schema_versions.version, excluded.version),
               applied_at = now()`,
        [name, version],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

/**
 * Apply `ddl` for `name` at `version` unless this process already did or the
 * database is already at that version.
 *
 * The promise is memoized per name/version. A rejected promise is removed so a
 * later call retries after a transient database failure.
 */
export function ensureSchemaOnce(
  client: ClientBase,
  name: string,
  version: number,
  ddl: () => Promise<void>,
): Promise<void> {
  const key = keyFor(name, version);
  const cached = applied.get(key);
  if (cached) return cached;

  const pending = runOnce(client, name, version, ddl);
  applied.set(key, pending);
  void pending.catch(() => {
    if (applied.get(key) === pending) applied.delete(key);
  });
  return pending;
}
