-- Accounts hold a cached balance that is only ever changed in the same
-- transaction that appends the ledger entries explaining the change.
create table accounts (
    id            uuid primary key,
    owner_id      text        not null,
    currency      char(3)     not null,
    type          text        not null check (type in ('USER', 'SYSTEM')),
    balance_minor bigint      not null default 0,
    created_at    timestamptz not null,
    -- SYSTEM accounts (external funding) may go negative; user accounts never can.
    constraint user_balance_non_negative check (type = 'SYSTEM' or balance_minor >= 0)
);

create index accounts_owner_idx on accounts (owner_id);

-- One row per request. The unique idempotency key is what makes retries safe:
-- a replay finds this row instead of moving money twice.
create table transfers (
    id                     uuid primary key,
    idempotency_key        text        not null unique,
    request_hash           text        not null,
    kind                   text        not null check (kind in ('TRANSFER', 'DEPOSIT')),
    source_account_id      uuid        not null references accounts (id),
    destination_account_id uuid        not null references accounts (id),
    amount_minor           bigint      not null check (amount_minor > 0),
    currency               char(3)     not null,
    memo                   text,
    status                 text        not null check (status in ('COMPLETED', 'REJECTED')),
    rejection_reason       text,
    created_at             timestamptz not null,
    constraint distinct_accounts check (source_account_id <> destination_account_id),
    constraint rejected_has_reason check ((status = 'REJECTED') = (rejection_reason is not null))
);

create index transfers_source_created_idx on transfers (source_account_id, created_at);

-- Double-entry ledger. Signed amounts: negative debits the account, positive credits it.
-- Every transfer's entries must sum to zero (enforced at commit by the trigger below).
create table ledger_entries (
    id                  bigint generated always as identity primary key,
    transfer_id         uuid        not null references transfers (id),
    account_id          uuid        not null references accounts (id),
    amount_minor        bigint      not null check (amount_minor <> 0),
    balance_after_minor bigint      not null,
    created_at          timestamptz not null
);

create index ledger_entries_account_idx on ledger_entries (account_id, id);
create index ledger_entries_transfer_idx on ledger_entries (transfer_id);

create function assert_transfer_balanced() returns trigger
    language plpgsql as
$$
begin
    if (select sum(amount_minor) from ledger_entries where transfer_id = new.transfer_id) <> 0 then
        raise exception 'ledger entries for transfer % do not sum to zero', new.transfer_id;
    end if;
    return null;
end
$$;

-- Deferred so both legs can be inserted before the check runs at commit.
create constraint trigger ledger_entries_balanced
    after insert on ledger_entries
    deferrable initially deferred
    for each row execute function assert_transfer_balanced();

create function reject_ledger_mutation() returns trigger
    language plpgsql as
$$
begin
    raise exception 'ledger_entries is append-only';
end
$$;

create trigger ledger_entries_append_only
    before update or delete on ledger_entries
    for each row execute function reject_ledger_mutation();

-- Transactional outbox: events are written in the same transaction as the money
-- movement and relayed to the broker afterwards, so an event is never lost or
-- published for a transfer that rolled back.
create table outbox_events (
    id           bigint generated always as identity primary key,
    event_id     uuid        not null unique,
    aggregate_id uuid        not null,
    event_type   text        not null,
    payload      jsonb       not null,
    created_at   timestamptz not null,
    published_at timestamptz
);

create index outbox_unpublished_idx on outbox_events (id) where published_at is null;

-- External funding source for deposits, one per supported currency.
insert into accounts (id, owner_id, currency, type, balance_minor, created_at)
values ('00000000-0000-7000-8000-000000000001', 'system:funding', 'USD', 'SYSTEM', 0, now());
