/**
 * End-to-end HTTP smoke for deployed assistant (Vercel routing + Hono routes).
 * Usage: ASSISTANT_URL=https://p2p-ledger-pi.vercel.app npm run smoke:api
 */
import {
  PRACTICE_ALEX,
  PRACTICE_SAM,
} from '../src/server/practice-ledger.js';

const base = (process.env.ASSISTANT_URL ?? process.argv[2] ?? '').replace(/\/$/, '');
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? '25000');

if (!base) {
  console.error('Set ASSISTANT_URL or pass base URL as first argument.');
  process.exit(2);
}

type Check = {
  name: string;
  run: () => Promise<void>;
};

function assertNotVercelEdge404(res: Response, bodyText: string): void {
  if (res.status === 404 && /NOT_FOUND/i.test(bodyText) && bodyText.length < 80) {
    throw new Error('Vercel edge NOT_FOUND (function not reached — check api/index + rewrite)');
  }
}

async function fetchJson(path: string, init?: RequestInit): Promise<{ res: Response; json: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { ...init, signal: controller.signal });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    assertNotVercelEdge404(res, text);
    return { res, json, text };
  } finally {
    clearTimeout(timer);
  }
}

const checks: Check[] = [
  {
    name: 'SPA index',
    run: async () => {
      const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`GET / → ${res.status}`);
      const html = await res.text();
      if (!html.includes('p2p-ledger') && !html.includes('root')) {
        throw new Error('GET / did not look like the Vite shell');
      }
    },
  },
  {
    name: 'GET /api/health',
    run: async () => {
      const { res, json } = await fetchJson('/api/health');
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      if ((json as { status?: string }).status !== 'ok') throw new Error(`body ${JSON.stringify(json)}`);
    },
  },
  {
    name: 'GET /api/bootstrap',
    run: async () => {
      const { res, json } = await fetchJson('/api/bootstrap');
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const practice = (json as { practice?: { accounts?: unknown[] } }).practice;
      if (!practice?.accounts?.length) throw new Error('missing practice.accounts');
    },
  },
  {
    name: 'GET /api/accounts?id=',
    run: async () => {
      const { res, json } = await fetchJson(`/api/accounts?id=${PRACTICE_ALEX}`);
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      if ((json as { owner?: string }).owner !== 'alex') throw new Error(`body ${JSON.stringify(json)}`);
    },
  },
  {
    name: 'GET /api/accounts/:id',
    run: async () => {
      const { res, json } = await fetchJson(`/api/accounts/${PRACTICE_ALEX}`);
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      if ((json as { owner?: string }).owner !== 'alex') throw new Error(`body ${JSON.stringify(json)}`);
    },
  },
  {
    name: 'GET /api/peers?accountId= (practice)',
    run: async () => {
      const { res, json } = await fetchJson(`/api/peers?accountId=${PRACTICE_ALEX}`);
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const peers = json as { id: string }[];
      if (!Array.isArray(peers) || !peers.some((p) => p.id === PRACTICE_SAM)) {
        throw new Error(`unexpected peers ${JSON.stringify(json)}`);
      }
    },
  },
  {
    name: 'GET /api/peers for live wallet (no practice bleed)',
    run: async () => {
      const created = await fetchJson('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: `smoke-peer-${Date.now()}`, currency: 'USD' }),
      });
      if (created.res.status !== 201) {
        throw new Error(`open account ${created.res.status}`);
      }
      const id = (created.json as { id: string }).id;
      const { res, json } = await fetchJson(`/api/peers?accountId=${id}`);
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const peers = json as { id: string }[];
      if (!Array.isArray(peers)) throw new Error('expected array');
      const practiceBleed = peers.some((p) => p.id.startsWith('01111111-1111-7111-8111-'));
      if (practiceBleed) {
        throw new Error(`live wallet must not list practice peers: ${JSON.stringify(json)}`);
      }
    },
  },
  {
    name: 'GET /api/accounts/:id/entries',
    run: async () => {
      const { res, json } = await fetchJson(`/api/accounts/${PRACTICE_ALEX}/entries?limit=10`);
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const entries = (json as { entries?: unknown[] }).entries;
      if (!entries?.length) throw new Error('expected statement lines');
    },
  },
  {
    name: 'POST /api/accounts/:id/deposits',
    run: async () => {
      const { res, json } = await fetchJson(`/api/accounts/${PRACTICE_ALEX}/deposits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountMinor: 1 }),
      });
      if (res.status !== 201) throw new Error(`status ${res.status} body ${JSON.stringify(json)}`);
      const row = json as { kind?: string; status?: string };
      if (row.kind !== 'DEPOSIT' || row.status !== 'COMPLETED') {
        throw new Error(`unexpected transfer ${JSON.stringify(json)}`);
      }
    },
  },
  {
    name: 'POST /api/transfers',
    run: async () => {
      const { res, json } = await fetchJson('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceAccountId: PRACTICE_ALEX,
          destinationAccountId: PRACTICE_SAM,
          amountMinor: 1,
          currency: 'USD',
        }),
      });
      if (res.status !== 201) throw new Error(`status ${res.status} body ${JSON.stringify(json)}`);
      const row = json as { kind?: string; status?: string };
      if (row.kind !== 'TRANSFER' || row.status !== 'COMPLETED') {
        throw new Error(`unexpected transfer ${JSON.stringify(json)}`);
      }
    },
  },
];

async function main(): Promise<void> {
  console.log(`smoke: ${base} (${checks.length} checks, timeout ${timeoutMs}ms)`);
  const failed: string[] = [];
  for (const check of checks) {
    const t0 = Date.now();
    try {
      await check.run();
      console.log(`  ok  ${check.name} (${Date.now() - t0}ms)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  FAIL ${check.name}: ${msg}`);
      failed.push(check.name);
    }
  }
  if (failed.length) {
    console.error(`\n${failed.length} failed: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log('\nAll smoke checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
