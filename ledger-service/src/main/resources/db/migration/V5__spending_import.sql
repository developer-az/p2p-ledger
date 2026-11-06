create table if not exists spend_logs (
    id uuid primary key,
    account_id uuid not null,
    amount_minor bigint not null check(amount_minor>0),
    currency char(3) not null default 'USD',
    category text not null,
    note text,
    occurred_at timestamptz not null,
    source text not null default 'manual',
    created_at timestamptz not null default now()
);
alter table spend_logs add column if not exists import_key text;
create index if not exists spend_logs_account_occurred_idx on spend_logs(account_id,occurred_at desc);
create unique index spend_logs_import_key_idx on spend_logs(account_id,import_key) where import_key is not null;
create table spend_log_operations (
    account_id uuid not null references accounts(id),
    idempotency_key text not null,
    request_hash char(64) not null,
    spend_id uuid not null,
    primary key(account_id,idempotency_key)
);
