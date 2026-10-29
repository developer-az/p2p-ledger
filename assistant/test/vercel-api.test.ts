import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAssistantApi } from '../src/server/instance.js';
import {
  PRACTICE_ANTHONY,
  PRACTICE_SAM,
} from '../src/server/practice-ledger.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Same object shape as assistant/api/index.ts (Vercel Web Standard export). */
function vercelFetch(request: Request): Response | Promise<Response> {
  const app = createAssistantApi();
  return app.fetch(request);
}

function req(path: string, init?: RequestInit): Request {
  return new Request(`https://p2p-ledger.example${path}`, init);
}

describe('Vercel API entry (fetch export)', () => {
  it('vercel.json routes nested /api/* to api/index.ts', () => {
    const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
      functions?: Record<string, unknown>;
      rewrites?: { source: string; destination: string }[];
    };
    expect(vercel.functions).toHaveProperty('api/index.ts');
    const apiRewrite = vercel.rewrites?.find((r) => r.source.includes('/api/'));
    expect(apiRewrite?.destination).toBe('/api/index');
    expect(readFileSync(join(root, 'api', 'index.ts'), 'utf8')).toContain('fetch(request: Request)');
  });

  it('GET /api/health', async () => {
    const res = await vercelFetch(req('/api/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/bootstrap', async () => {
    const res = await vercelFetch(req('/api/bootstrap'));
    expect(res.status).toBe(200);
    const body = await res.json() as { practice: { accounts: unknown[] } };
    expect(body.practice.accounts.length).toBeGreaterThanOrEqual(3);
  });

  it('GET /api/accounts?id= (query style used by UI)', async () => {
    const res = await vercelFetch(req(`/api/accounts?id=${PRACTICE_ANTHONY}`));
    expect(res.status).toBe(200);
    const body = await res.json() as { owner: string };
    expect(body.owner).toBe('anthony');
  });

  it('GET /api/accounts/:id (nested path)', async () => {
    const res = await vercelFetch(req(`/api/accounts/${PRACTICE_ANTHONY}`));
    expect(res.status).toBe(200);
    const body = await res.json() as { owner: string };
    expect(body.owner).toBe('anthony');
  });

  it('GET /api/peers?accountId=', async () => {
    const res = await vercelFetch(req(`/api/peers?accountId=${PRACTICE_ANTHONY}`));
    expect(res.status).toBe(200);
    const peers = await res.json() as { id: string }[];
    expect(peers.some((p) => p.id === PRACTICE_SAM)).toBe(true);
  });

  it('POST /api/accounts/:id/deposits (multi-segment — Vercel edge 404 without rewrite)', async () => {
    const res = await vercelFetch(req(`/api/accounts/${PRACTICE_ANTHONY}/deposits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountMinor: 1 }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as { kind: string; status: string };
    expect(body).toMatchObject({ kind: 'DEPOSIT', status: 'COMPLETED' });
  });

  it('POST /api/transfers', async () => {
    const res = await vercelFetch(req('/api/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceAccountId: PRACTICE_ANTHONY,
        destinationAccountId: PRACTICE_SAM,
        amountMinor: 1,
        currency: 'USD',
      }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as { kind: string; status: string };
    expect(body).toMatchObject({ kind: 'TRANSFER', status: 'COMPLETED' });
  });
});
