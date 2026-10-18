-- User-curated spending (not bank sync). Safe to run on the same Postgres as ledger-service.
create table if not exists spend_logs (
    id            uuid primary key,
    account_id    uuid        not null,
    amount_minor  bigint      not null check (amount_minor > 0),
    currency      char(3)     not null default 'USD',
    category      text        not null,
    note          text,
    occurred_at   timestamptz not null,
    source        text        not null default 'manual',
    created_at    timestamptz not null default now()
);

create index if not exists spend_logs_account_occurred_idx on spend_logs (account_id, occurred_at desc);
