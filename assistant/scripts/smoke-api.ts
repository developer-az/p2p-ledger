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
  /** Resolves to a string to report the check as skipped. */
  run: () => Promise<void | string>;
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
    name: 'POST /api/accounts is closed to anonymous callers on the live ledger',
    run: async () => {
      // Live wallets are created only through registration; an anonymous open must be refused.
      // A practice-only deployment (no live ledger) still answers 201.
      const { res } = await fetchJson('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: `smoke-anon-${Date.now()}`, currency: 'USD' }),
      });
      if (res.status !== 403 && res.status !== 201) throw new Error(`status ${res.status}`);
    },
  },
  {
    name: 'GET /api/peers for live wallet (owner session, no practice bleed)',
    run: async () => {
      const email = process.env.SMOKE_EMAIL;
      const password = process.env.SMOKE_PASSWORD;
      if (!email || !password) return 'skipped: set SMOKE_EMAIL and SMOKE_PASSWORD for a registered smoke account';
      const login = await fetchJson('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (login.res.status !== 200) throw new Error(`login ${login.res.status}`);
      const cookie = login.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      if (!cookie) throw new Error('login set no session cookie');
      const id = (login.json as { account?: { id?: string } }).account?.id;
      if (!id) throw new Error('login returned no account id');

      const anon = await fetchJson(`/api/peers?accountId=${id}`);
      if (anon.res.status !== 401) throw new Error(`anonymous peers read must be 401, got ${anon.res.status}`);

      const { res, json } = await fetchJson(`/api/peers?accountId=${id}`, { headers: { cookie } });
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const peers = json as { id: string }[];
      if (!Array.isArray(peers)) throw new Error('expected array');
      const practiceBleed = peers.some((p) => p.id.startsWith('01111111-1111-7111-8111-'));
      if (practiceBleed) {
        throw new Error(`live wallet must not list practice peers: ${JSON.stringify(json)}`);
      }
      await fetchJson('/api/auth/logout', { method: 'POST', headers: { cookie } }).catch(() => undefined);
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
    name: 'GET /api/accounts/:id/statement.txt',
    run: async () => {
      const res = await fetch(`${base}/api/accounts/${PRACTICE_ALEX}/statement.txt`, { signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      assertNotVercelEdge404(res, text);
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      if (!text.includes('LEDGER ENTRIES')) throw new Error('missing statement body');
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
      const skipped = await check.run();
      if (typeof skipped === 'string') console.log(`  --  ${check.name} (${skipped})`);
      else console.log(`  ok  ${check.name} (${Date.now() - t0}ms)`);
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
