-- Compatible with the request book previously created by the TypeScript BFF.
create table if not exists payment_requests (
    id uuid primary key,
    requester_account_id uuid not null,
    payer_account_id uuid not null,
    amount_minor bigint not null check (amount_minor > 0),
    currency char(3) not null default 'USD',
    memo text,
    status text not null default 'PENDING' check (status in ('PENDING','PAID','DECLINED','CANCELLED')),
    transfer_id uuid,
    settled_via text,
    declined_attempts int not null default 0,
    created_at timestamptz not null default now(),
    resolved_at timestamptz,
    constraint request_distinct_accounts check (requester_account_id <> payer_account_id)
);
alter table payment_requests add column if not exists settled_via text;
create index if not exists payment_requests_requester_idx on payment_requests(requester_account_id, created_at desc);
create index if not exists payment_requests_payer_idx on payment_requests(payer_account_id, created_at desc);

create table payment_request_batches (
    requester_account_id uuid not null references accounts(id),
    idempotency_key text not null,
    request_hash char(64) not null,
    request_ids uuid[] not null,
    primary key (requester_account_id, idempotency_key)
);
create table payment_request_attempts (
    request_id uuid not null references payment_requests(id),
    idempotency_key text not null,
    transfer_id uuid not null references transfers(id),
    primary key (request_id, idempotency_key)
);

-- Reconcile the old BFF's possible crash between transfer commit and request resolution.
-- Stop old BFF writers before applying this migration; see the rollout guide.
with completed as (
    select distinct on (r.id) r.id,t.id as transfer_id,t.created_at
    from payment_requests r join transfers t
      on t.idempotency_key ~ ('^request-' || r.id::text || '-[0-9]+$')
     and t.source_account_id=r.payer_account_id and t.destination_account_id=r.requester_account_id
     and t.amount_minor=r.amount_minor and t.currency=r.currency
    where r.status='PENDING' and t.status='COMPLETED' and t.kind='TRANSFER'
    order by r.id,t.created_at,t.id
)
update payment_requests r set status='PAID',transfer_id=c.transfer_id,resolved_at=c.created_at
from completed c where r.id=c.id;
