# 0003 — Cloud split: AWS for the pipeline, nothing on Azure

## Status

Accepted, 2026-11-11 (PLAN.md Decisions, item 2).

## Context

Settle runs on free tiers: the BFF on Vercel, the Java ledger as a GraalVM native image
on Render's free instance, Postgres on Supabase. That covers the web app and the ledger.
It does not cover statement files, a queue with retries and a dead letter queue, a
long-running parser, or a key management service for envelope encryption. `infra/aws`
already holds Terraform for the queue the ledger's event sink uses and the adapter is
written, so one cloud is the shorter path; a second one buys redundancy nobody needs.

## Decision

The pipeline lives on AWS only:

- **S3** — statement uploads, versioned, SSE-KMS, public access blocked. The browser
  uploads through a presigned PUT with size and type limits.
- **SQS** — one work queue plus a dead letter queue, so a poisoned row does not block the
  rest and `settle replay` has somewhere to read from.
- **Lambda** — the Python worker (ADR 0002) as a container image, triggered by the S3
  event. Development uses LocalStack; self-hosting replaces these with MinIO and an
  in-process queue (M8.5).
- **KMS** — the key encryption key that wraps per-user data keys (ADR 0004), plus the S3
  key. Terraform in M8.3, least-privilege IAM, GitHub Actions through OIDC.

Nothing is deployed on Azure. Equivalents, recorded for completeness and not planned:
Key Vault for KMS, Blob Storage for S3, Queue Storage or Service Bus for SQS, Functions
or Container Apps for Lambda.

## Consequences

- One cloud, one Terraform state, one IAM model, one billing surface. Free tier covers S3,
  SQS and Lambda at this volume and stays inside it at roughly ten users.
- **Cost flag:** one KMS key costs about $1 per month plus a small per-request charge. It
  is the only recurring pipeline cost, it needs approval before it ships, and it is why
  envelope encryption is deferred to M3 instead of bundled into M2.
- Azure equivalents stay unwritten, so a future move is a migration, not a config flag.
  Accepted: portability is not a requirement for a single-household product.
- Free tiers are a known dependency. Cold starts and idle eviction show in the UI through
  the staged loader and are documented in M8.2, not hidden.
- Anything with a price tag (KMS, a paid bank connector) needs the owner's approval first.
