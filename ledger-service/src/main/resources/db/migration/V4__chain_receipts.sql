-- Independent of the broker outbox: broker publication cannot consume a chain job.
create table chain_receipts (
    transfer_id uuid primary key references transfers(id),
    transfer_key char(66) not null unique,
    commitment char(66) not null,
    preimage text not null,
    chain_id bigint not null,
    contract_address char(42) not null,
    status text not null default 'PENDING' check (status in ('PENDING','SUBMITTED','FINALIZED','FAILED')),
    transaction_hash char(66),
    submitted_at timestamptz,
    block_number bigint,
    attempts int not null default 0,
    last_error text,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    next_attempt_at timestamptz not null
);
create index chain_receipts_pending_idx on chain_receipts(next_attempt_at)
    where status in ('PENDING','SUBMITTED');
