# Threat model — Settle

Scope: one self-hosted household, roughly ten invited accounts, on free tiers. The
model covers the surfaces that exist today and the ones the plan adds, and it names
the step that ships each mitigation. A mitigation marked **Live** is in the running
build. Anything marked **Planned · <step>** does not exist yet and is never described
elsewhere in the product as if it did.

Related: [SECURITY.md](SECURITY.md), [ARCHITECTURE.md](ARCHITECTURE.md),
[ADR 0004](adr/0004-encryption-model.md), [PLAN.md](../PLAN.md).

## Data classes

| Class | Definition | Examples | Handling rule |
|---|---|---|---|
| **Public** | Safe to publish, no link to a person | Landing copy, the sample-household figures, brand icons from the merchant directory, open-source code | No controls. Cached freely. |
| **Internal** | Operational data that reveals how the system runs | Import job ids, stage timings, row counts, queue depth, model name and version, error codes, SLO numbers | Authenticated operator or the owning account. Never in a public response body. |
| **Personal-financial** | Identifies a person and describes their money | Email, display name, account last4, balances, transaction amounts and dates, merchant, category, notes, forecasts, alerts, uploaded statement files | Owner-scoped at every read, encrypted at rest once 2.5 ships, excluded from logs, never sent to a third party in raw form. |
| **Secret** | Grants access to something | Password hashes, TOTP seeds, recovery-code hashes, session tokens, KEK and per-user data keys, `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`, AWS credentials, `DATABASE_PASSWORD`, `RENDER_DEPLOY_HOOK_URL` | Server memory or KMS only. Never logged, never returned to a browser, never committed. `.env*` is ignored except `.env.example`. |

A category boundary case: a cleaned merchant name plus flag is Internal on its own, but
the pair (merchant, amount) for a specific account is Personal-financial. Treat the pair
as the higher class.

## Data lineage

```
raw              normalized            enriched                 ledger
statement file → raw_rows → transactions → merchant, category, → balanced ledger_entries
(S3, encrypted)  (Postgres)  (dedupe key)   subscription, alerts   (append-only, per account)
```

| Stage | Where it lives | What it holds | Class | Notes |
|---|---|---|---|---|
| **Raw** | S3 object (M3.4), plus a content hash in `imports` (M3.1) | The statement file exactly as the bank exported it, including any account numbers the bank prints | Personal-financial | Encrypted with SSE-KMS at the bucket (M8.3) and with the user's data key once 2.5 ships. Purged after the retention window (2.7). Never parsed in the browser. |
| **Normalized** | `raw_rows` (immutable, file hash plus line number) and `transactions` (M3.1) | Posted date, amount in minor units, currency, descriptor as printed, source line | Personal-financial | `descriptor_raw` is listed for column-level encryption in 2.5. The immutable row is what makes a posting auditable. |
| **Enriched** | Same database, derived columns | `descriptor_clean`, `merchant_id`, `category_id`, match method and confidence, rule id, recurring-stream id, alert reason code | Personal-financial, with some fields Internal | Cleaning drops processor prefixes and store numbers (4.1). The LLM, if used at all, sees only the cleaned name and an amount bucket (4.4). |
| **Ledger** | `ledger_entries` plus the cached balance, in Java | Balanced debit and credit per posting, idempotency key, lineage ids back to the row | Personal-financial (aggregates are Internal) | Append-only with a zero-sum constraint (Live). Net worth and reports are queries over this stage, not a copy of it (ADR 0001). |

Deletion walks the same path backwards: the wrapped data key is destroyed (2.5), so raw,
normalized and enriched ciphertext all become unreadable at once, and backups with it.

## STRIDE per component

Each row is one threat against one component. "Step" is the PLAN.md step that ships the
mitigation; where the mitigation is already in the build the step is the one that added
it, and the state column says **Live**.

| Component | STRIDE | Threat | Mitigation | Step | State |
|---|---|---|---|---|---|
| Browser | Spoofing | Stolen session token used from another machine | httpOnly, `SameSite=Lax`, `Secure` cookie; `__Host-` prefix and rotation on login and privilege change; idle 30 min and absolute 7 day timeouts | 2.1 | Cookie flags Live, prefix and timeouts Planned · 2.1 |
| Browser | Spoofing | Session fixation before sign-in | New session id issued on authentication; old id invalidated | 2.1 | Planned · 2.1 |
| Browser | Tampering | Request body altered before it reaches the API | Zod validation on every route; amounts and account ids re-derived server-side | Live | Live |
| Browser | Tampering | Cross-site request forged with the user's cookie | `Origin` / `Sec-Fetch-Site` check on every mutating route, on top of `SameSite=Lax` | 2.1 | Planned · 2.1 |
| Browser | Information disclosure | Script reads page data or tokens | CSP `script-src 'self'`, no inline script, `frame-ancestors 'none'`, tokens never in `localStorage` | Live | Live |
| Browser | Information disclosure | Another origin learns which merchant a user views | Logos fetched server-side and cached same-origin; CSP stays `img-src 'self'` | 4.3 | Planned · M4 |
| Browser | Elevation of privilege | Client-side gating treated as authorization | Every check repeated on the server; the UI only hides what the API refuses | Live | Live |
| Browser | Repudiation | A person's action on a shared or handed-over browser cannot be attributed | Audit log records the action with device and IP prefix, not just the account | 2.6 | Planned · 2.6 |
| Browser | Denial of service | Client-side flood | The SPA holds no server state; every limit is enforced in the BFF, so a tampered client gains nothing | 0.4 | Live |
| BFF on Vercel | Spoofing | Credential stuffing or account enumeration | Per-account and per-IP backoff, identical responses for known and unknown emails, breached-password check by HIBP k-anonymity | 2.3 | Planned · 2.3 |
| BFF on Vercel | Spoofing | Password or session replay after a stolen second factor | TOTP as a second step, single-use recovery codes, step-up for export and delete | 2.2 | Planned · 2.2 |
| BFF on Vercel | Tampering | User A reads or writes user B's rows through a hand-made request | Ownership predicate in every query today; Postgres row-level security with `app.user_id` on a non-owner role | 2.4 | Ownership Live, RLS Planned · 2.4 |
| BFF on Vercel | Repudiation | A sensitive action leaves no trace | Append-only audit log (login, MFA change, session revoke, export, delete, key change), UPDATE/DELETE blocked by a trigger | 2.6 | Planned · 2.6 |
| BFF on Vercel | Information disclosure | Provider keys or database credentials reach the client | Secrets read only in server modules, never in a response; `.env.example` documents them; `.env*` ignored | Live | Live |
| BFF on Vercel | Information disclosure | A database dump or backup is stolen | Envelope encryption of sensitive columns under per-user data keys wrapped by KMS | 2.5 | Planned · M3 |
| BFF on Vercel | Denial of service | Write or LLM flood burns quota and money | Sliding-window per-IP limits on writes and LLM routes with a shared Postgres store; LLM answer cache, in-flight coalescing and a daily budget | 0.4 | Live (per-instance fallback accepted) |
| BFF on Vercel | Denial of service | One noisy instance starves others | Shared rate-limit store; documented fallback to a local limiter so a database blip cannot lock everyone out of writes | 0.4 | Live |
| BFF on Vercel | Elevation of privilege | Stale session keeps access after an account change | Session rotation, both timeouts, revoke-one-session and revoke-all from Settings → Security | 2.1 | Planned · 2.1 |
| Java ledger on Render | Spoofing | Ledger API called by anyone who finds the URL | Kept off the public surface where possible; least-privilege network rules and a service credential in front, with IAM-scoped access from CI | 8.3 | Open today, Planned · M8.3 |
| Java ledger on Render | Tampering | Unbalanced or mutated postings | Zero-sum deferred constraint trigger, append-only `ledger_entries`, `CHECK` on non-negative balances | Live | Live |
| Java ledger on Render | Tampering | Duplicate posting from a retried request | `UNIQUE` idempotency key per transfer; `import-<fileHash>-<row>` for imports; a reused key with a different body returns 422 | Live | Live (import keys Planned · M3) |
| Java ledger on Render | Information disclosure | Database link intercepted with an untrusted certificate | `rejectUnauthorized: false` today accepts any certificate; pin the Supabase CA and verify the full chain | 2.3b | Weakness Live, fix Planned · 2.3b |
| Java ledger on Render | Denial of service | Traffic burst exhausts memory on a 512 MB container | `InFlightLimitFilter` caps concurrent requests and sheds with `503` plus `Retry-After`; clients retry safely because requests are idempotent | Live | Live |
| Java ledger on Render | Elevation of privilege | Fraud rules raced past by concurrent requests | Rules evaluated against the locked rows inside the same transaction, locks taken in primary-key order | Live | Live |
| Java ledger on Render | Repudiation | A posted entry cannot be tied to the operator action that caused it | Every write carries an idempotency key and keeps its transfer id; the actor is added by the audit log | 2.6 | Ids Live, actor Planned · 2.6 |
| Ingestion worker | Spoofing | A forged event or a direct invoke starts a parse | Only the S3 event triggers the worker; the Lambda role can read one bucket prefix and send to one queue | 8.3 | Planned · M3 + M8.3 |
| Ingestion worker | Tampering | A crafted file exploits the parser or injects rows | Presigned PUT with size and type limits; JSON Schema validation per row; section-total check refuses partial output; poisoned rows go to the DLQ | 3.2, 3.4 | Planned · M3 |
| Ingestion worker | Tampering | Worker writes tables directly and bypasses ledger invariants | Design forbids it: the worker posts through the ledger API (ADR 0001, ADR 0002), so it cannot skip the zero-sum or idempotency checks | 3.4 | Planned · M3 |
| Ingestion worker | Information disclosure | Raw descriptors end up in logs or traces | Structured JSON logs with a redaction filter, tested to keep descriptors and emails out; traces carry ids, not payloads | 8.1 | Planned · M8.1 |
| Ingestion worker | Denial of service | One huge or looping statement blocks the queue | Lambda time and memory limits, 3 retries with backoff, then the DLQ; `settle replay` for the rest | 3.4 | Planned · M3 |
| Ingestion worker | Repudiation | An import cannot be attributed to the person who uploaded it | `imports` stores the file hash, source and owning account; the audit log records the upload and any replay | 3.1, 2.6 | Planned · M3 + 2.6 |
| Ingestion worker | Elevation of privilege | A compromised worker reaches more than the pipeline | No database credentials in the worker environment; it can call the ledger API only, with a scoped token | 3.4, 8.3 | Planned · M3 + M8.3 |
| S3 | Spoofing | Bucket reachable directly, or a presigned URL shared onward | Block public access; short-lived presigned PUT; no presigned GET for raw files | 3.4, 8.3 | Planned · M3 + M8.3 |
| S3 | Tampering | An object is replaced after upload | Bucket versioning; content hash recorded on `imports`; the parse rejects a file whose hash does not match the queued job | 3.1, 8.3 | Planned · M3 + M8.3 |
| S3 | Information disclosure | Objects readable without the app | SSE-KMS on the bucket, plus the user's data key on the file once 2.5 ships; retention purge after N days | 2.5, 8.3 | Planned · M3/M8.3 |
| S3 | Denial of service | Upload flood fills the bucket or the quota | Presigned PUT with size and type limits, per-IP rate limits on the request that issues it, and a retention purge | 3.4, 0.4, 2.7 | Planned · M3, purge 2.7 |
| S3 | Elevation of privilege | A leaked credential reads every user's files | No public access, least-privilege role on one prefix, short-lived OIDC credentials, KMS grants per environment | 8.3 | Planned · M8.3 |
| S3 | Repudiation | An object read or delete cannot be traced | S3 server access logging plus CloudTrail data events | 8.3 | Planned · M8.3 |
| SQS | Spoofing | A foreign principal sends or consumes messages | Queue policy limited to the worker role; no public queue; DLQ redrive restricted to the operator | 8.3 | Planned · M8.3 |
| SQS | Tampering | A message is altered to point at another user's file | Messages carry an import id and an object key already scoped to a user; the worker re-reads the import row and checks ownership | 3.4 | Planned · M3 |
| SQS | Information disclosure | Descriptors or amounts travel in the message body | Message body holds ids and the S3 key only; payload stays in the encrypted object | 3.4 | Planned · M3 |
| SQS | Denial of service | Retry storm after a bad deploy | Backoff, a dead letter queue after 3 attempts, and replay run by hand so a loop cannot restart itself | 3.4 | Planned · M3 |
| SQS | Repudiation | A replay cannot be attributed | `settle replay` runs as an operator action and is recorded in the audit log with the import id | 2.6 | Planned · 2.6 |
| SQS | Elevation of privilege | A leaked AWS key drains the queue and reads the bucket | Short-lived credentials through GitHub OIDC instead of long-lived keys; role scoped to one queue and one prefix | 8.3 | Planned · M8.3 |
| Postgres / Supabase | Spoofing | A stolen connection string reaches the database | TLS verification with the Supabase CA pinned, plus a least-privilege role with no DDL | 2.3b, 2.4 | Open today, fix Planned · 2.3b |
| Postgres / Supabase | Tampering | Cross-tenant write through the app role | RLS policies on every per-user table with `app.user_id` set per transaction by a non-owner role | 2.4 | Planned · 2.4 |
| Postgres / Supabase | Repudiation | An edit cannot be attributed | Audit log with a blocking trigger; ledger tables are already append-only | 2.6 | Ledger Live, audit Planned · 2.6 |
| Postgres / Supabase | Information disclosure | Stolen dump or backup read offline | Provider at-rest encryption today; envelope encryption with per-user keys and crypto-shredding so a shredded user's rows stay unreadable | 2.5 | At rest Live, envelope Planned · M3 |
| Postgres / Supabase | Information disclosure | Encrypted descriptors still need matching and dedupe | Blind indexes (HMAC-SHA256 over the normalized value) so equality works without decryption | 2.5 | Planned · M3 |
| Postgres / Supabase | Denial of service | Connection exhaustion from serverless instances | Small pools, request timeouts, load shedding in the ledger, local rate-limit fallback documented in 0.4 | 0.4 | Live |
| Postgres / Supabase | Elevation of privilege | App role owns the tables and can disable RLS | Migrations run as owner; the runtime connects as a non-owner role without `BYPASSRLS` | 2.4 | Planned · 2.4 |
| LLM provider | Spoofing | A provider answer is treated as authoritative data | Read-only tools scoped to one account; answers render as text, never as instructions the UI executes | Live | Live |
| LLM provider | Tampering | Prompt injection arrives inside a merchant descriptor | The prompt receives a cleaned merchant name and an amount bucket, never the raw descriptor or the user's text; tool calls are read-only | 4.4 | Planned · M4 |
| LLM provider | Information disclosure | Account data leaves the server in a prompt | Only cleaned merchant name, amount bucket and category list are sent; no email, account id, balance or descriptor; the user's own key is used where configured | 4.4, 2.8 | Planned · M4 |
| LLM provider | Denial of service | Cost spiral from repeated questions | Answer cache, in-flight coalescing, per-account and global daily budget, deterministic fallback when the budget is spent | Live | Live |
| LLM provider | Repudiation | A wrong answer cannot be traced to a model | Each classification stores its source and model version | 4.4 | Planned · M4 |
| LLM provider | Elevation of privilege | Model output steers the app into a privileged path | No write tool exists for the model; it can read a summary and nothing else, and the BFF re-checks ownership on every follow-up call | Live | Live |
| Logo provider | Spoofing | A wrong or look-alike brand image appears next to a charge | Logo matched by the merchant's recorded domain only; monogram fallback in neutral tones when the match is uncertain | 4.3 | Planned · M4 |
| Logo provider | Information disclosure | The third party learns which merchant a user views | Fetch happens server-side, keyed by domain, then cached in S3/Postgres and served same-origin; the browser never contacts the provider | 4.3 | Planned · M4 |
| Logo provider | Tampering | A malicious image or an SSRF attempt through a crafted domain | Only the configured provider endpoint is called with a validated domain; responses are size- and type-checked and re-served from our origin | 4.3 | Planned · M4 |
| Logo provider | Denial of service | Slow provider stalls a page render | Server-side cache first, short timeout, and a monogram fallback so a missing logo never blocks the row | 4.3 | Planned · M4 |
| Logo provider | Elevation of privilege | A fetched asset becomes a script or an open redirect | Images are re-served from our origin with a fixed content type, SVG from a third party is not accepted, and the response is size-checked | 4.3 | Planned · M4 |

## Accepted risks and open items

- **Ledger API reachable on Render (until M8.3).** Documented in SECURITY.md as a demo
  deployment trade-off. The ledger is idempotent and fraud-limited, and it moves
  simulated money only, which is why this is accepted rather than hidden.
- **Database TLS accepts any certificate (until 2.3b).** Tracked, flagged in the
  DO-NOT-FLAG list, and the first fix in the M2 chain.
- **Per-instance rate-limit fallback (0.4).** Deliberate: a shared-store outage must not
  fail every write closed.
- **No audit log yet (until 2.6).** Logins and deletions cannot be attributed. Nothing
  in the interface claims otherwise.
- **Free-tier availability.** Cold starts and idle eviction are availability, not
  confidentiality, risks. The staged loader is the UX mitigation and M8.2 records the
  trade-off.

## Review

Re-read this model at the end of each milestone that adds a component or a data class,
and whenever a control moves from Planned to Live. Every change updates the state column
in the same commit that ships the control.
