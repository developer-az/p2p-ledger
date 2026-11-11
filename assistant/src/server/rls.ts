import type { ClientBase } from 'pg';

/**
 * Row-level security for the Postgres personal-finance tables.
 *
 * Every per-user table carries an owner column (money_profiles.account_id,
 * income_logs.account_id). The policies compare that column to the value the
 * caller bound with set_config('app.user_id', ...). When the setting is missing
 * current_setting(..., true) returns NULL, the comparison is NULL, and no rows
 * are visible or writable -- there is no "no user means admin" fallback.
 *
 * `force row level security` matters because the application connects as the
 * table owner: without FORCE the owner would silently bypass the policies.
 *
 * The role block is idempotent (pg_roles guard) and tolerates hosted databases
 * where the connection user lacks CREATEROLE: the insufficient_privilege branch
 * raises a NOTICE instead of aborting startup.
 */
export const RLS_DDL = `
alter table if exists money_profiles enable row level security;
alter table if exists money_profiles force row level security;
alter table if exists income_logs enable row level security;
alter table if exists income_logs force row level security;

drop policy if exists money_profiles_owner on money_profiles;
create policy money_profiles_owner on money_profiles
    using (account_id::text = current_setting('app.user_id', true))
    with check (account_id::text = current_setting('app.user_id', true));

drop policy if exists income_logs_owner on income_logs;
create policy income_logs_owner on income_logs
    using (account_id::text = current_setting('app.user_id', true))
    with check (account_id::text = current_setting('app.user_id', true));

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'settle_app') then
        create role settle_app nologin;
    end if;
    grant select, insert, update, delete on money_profiles to settle_app;
    grant select, insert, update, delete on income_logs to settle_app;
exception
    when insufficient_privilege then
        raise notice 'settle_app role setup skipped: %', sqlerrm;
end
$$;
`;

/**
 * Bind the per-user RLS identity for the duration of one transaction and run
 * `fn` inside it. The id travels as a query parameter, never as SQL text.
 *
 * Callers must pass the id that owns the rows they are about to read or write:
 * the policies use it for both USING and WITH CHECK.
 */
export async function withUser<T>(
  client: ClientBase,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    await client.query(`select set_config('app.user_id', $1, true)`, [userId]);
    const result = await fn();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}
