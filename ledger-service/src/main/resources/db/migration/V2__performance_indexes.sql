-- Performance indexes for P2P Ledger queries

-- 1. Index for inbound transfers by destination account (eliminates full table scan on transfers for findByAccount)
create index if not exists transfers_destination_created_idx on transfers (destination_account_id, created_at);

-- 2. Indexes for keyset/id-ordered transfer lookups for source and destination accounts
create index if not exists transfers_source_id_idx on transfers (source_account_id, id desc);
create index if not exists transfers_destination_id_idx on transfers (destination_account_id, id desc);

-- 3. Partial index on rejected transfers for audit join query (AuditRepository.rejectedWithEntries)
create index if not exists transfers_rejected_idx on transfers (id) where status = 'REJECTED';

-- 4. Covering index for ledger entries by account and amount for index-only scans on balance sums (AuditRepository.accountsDrifted)
create index if not exists ledger_entries_account_covering_idx on ledger_entries (account_id, amount_minor);

-- 5. Partial index on published outbox events for P95 latency calculation
create index if not exists outbox_published_idx on outbox_events (published_at, created_at) where published_at is not null;
