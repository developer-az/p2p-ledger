import type { ClientBase } from 'pg';

/**
 * Run a store's schema DDL at most once per process, per database and per
 * schema version.
 *
 * Every process used to run the full `create table if not exists` / `alter
 * table add column if not exists` / `create or replace function` bundle on its
 * first request. Those statements still take strong table locks on Postgres,
 * so a handful of instances starting together deadlock against each other even
 * though nothing changes. The fast path here is a single select against
 * `app_schema_versions`; only a database that is actually behind runs DDL, and
 * it does so under one transaction-scoped advisory lock so instances serialize
 * instead of colliding.
 *
 * The memo is keyed by connection string and effective schema as well as store
 * name and version. A process that talks to two databases (or two schemas of
 * one database, for example a private test schema) must run the DDL for each of
 * them; keying on name/version alone skipped the second target.
 */

const VERSIONS_DDL = `create table if not exists app_schema_versions (
    name       text primary key,
    version    int  not null,
    applied_at timestamptz default now()
)`;

const VERSION_SQL = 'select version from app_schema_versions where name = $1';

/** Per-process results, keyed by connection string, schema, store name and version. */
const applied = new Map<string, Promise<void>>();

/** Effective schema per connection string; search_path is fixed by the URL. */
const schemas = new Map<string, Promise<string>>();

function keyFor(connectionString: string, schema: string, name: string, version: number): string {
  return `${connectionString}\u0000${schema}\u0000${name}\u0000${version}`;
}

function isUndefinedTable(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: unknown }).code === '42P01';
}

/**
 * `select current_schema()` for this connection string, cached per process. The
 * schema comes from the URL (`options=-c search_path=...`), so it does not
 * change between pooled clients of the same connection string.
 */
function effectiveSchema(client: ClientBase, connectionString: string): Promise<string> {
  const cached = schemas.get(connectionString);
  if (cached) return cached;

  const pending = (async () => {
    const result = await client.query('select current_schema() as schema');
    const row = result.rows[0] as { schema?: string | null } | undefined;
    return String(row?.schema ?? 'public');
  })();
  schemas.set(connectionString, pending);
  void pending.catch(() => {
    if (schemas.get(connectionString) === pending) schemas.delete(connectionString);
  });
  return pending;
}

async function currentVersion(client: ClientBase, name: string): Promise<number> {
  const result = await client.query(VERSION_SQL, [name]);
  const row = result.rows[0] as { version?: string | number } | undefined;
  return row?.version === undefined ? 0 : Number(row.version);
}

/**
 * Fast-path version read. A missing `app_schema_versions` table is treated as
 * "version 0": the table is only created after the advisory lock is held, so a
 * concurrent first startup cannot win a `create table if not exists` race.
 */
async function currentVersionOrBehind(client: ClientBase, name: string): Promise<number | null> {
  try {
    return await currentVersion(client, name);
  } catch (error) {
    if (isUndefinedTable(error)) return null;
    throw error;
  }
}

async function runOnce(
  client: ClientBase,
  name: string,
  version: number,
  ddl: () => Promise<void>,
): Promise<void> {
  // Fast path: one select, no transaction, no locks. Only an already-created
  // bookkeeping table with a current version can skip the work.
  const known = await currentVersionOrBehind(client, name);
  if (known !== null && known >= version) return;

  await client.query('begin');
  try {
    // One lock name for every store: schema changes are rare, so serializing
    // all of them keeps a startup burst from holding several table locks at
    // once in different orders. The lock comes before creating the bookkeeping
    // table: concurrent `create table if not exists` still races on pg_type and
    // raises duplicate-key errors.
    await client.query("select pg_advisory_xact_lock(hashtext('settle-schema'))");
    await client.query(VERSIONS_DDL);
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
 * Apply `ddl` for `name` at `version` unless this process already did for this
 * database/schema or the database is already at that version.
 *
 * The promise is memoized per connection string, effective schema, name and
 * version. A rejected promise is removed so a later call retries after a
 * transient database failure.
 */
export async function ensureSchemaOnce(
  client: ClientBase,
  connectionString: string,
  name: string,
  version: number,
  ddl: () => Promise<void>,
): Promise<void> {
  const schema = await effectiveSchema(client, connectionString);
  const key = keyFor(connectionString, schema, name, version);
  const cached = applied.get(key);
  if (cached) return cached;

  const pending = runOnce(client, name, version, ddl);
  applied.set(key, pending);
  void pending.catch(() => {
    if (applied.get(key) === pending) applied.delete(key);
  });
  return pending;
}
