-- Personal period, cash/credit balances, and income logs (user-curated).
create table if not exists money_profiles (
    account_id               uuid primary key,
    currency                 char(3)     not null default 'USD',
    period_label             text        not null,
    period_start             timestamptz not null,
    wallet_cash_minor        bigint,
    credit_owed_minor        bigint      not null default 0 check (credit_owed_minor >= 0),
    spend_logs_affect_wallet boolean     not null default true,
    updated_at               timestamptz not null default now()
);

create table if not exists income_logs (
    id            uuid primary key,
    account_id    uuid        not null,
    amount_minor  bigint      not null check (amount_minor > 0),
    currency      char(3)     not null default 'USD',
    source        text        not null,
    note          text,
    occurred_at   timestamptz not null,
    created_at    timestamptz not null default now()
);

create index if not exists income_logs_account_occurred_idx on income_logs (account_id, occurred_at desc);
