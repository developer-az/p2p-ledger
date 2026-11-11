/**
 * M2 follow-ups: atomic MFA confirmation, bounded export, and shared security
 * state (lockouts + second-factor challenges) across app instances.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { createApp } from '../src/server/app.js';
import {
  InMemoryAuthStore,
  PostgresAuthStore,
  SESSION_COOKIE,
  hashSessionToken,
  type AuthStore,
} from '../src/server/auth.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from '../src/server/ledger.js';
import { MemoryMailer } from '../src/server/mailer.js';
import {
  InMemoryPersonalFinanceStore,
  type IncomeLogEntry,
  type PersonalFinanceStore,
} from '../src/server/personal-finance.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import {
  InMemorySpendLogStore,
  type SpendLogEntry,
  type SpendLogStore,
} from '../src/server/spend-log.js';
import { base32Decode, encryptSecret, totp } from '../src/server/totp.js';

const PASSWORD = ['m2', 'follow', 'up', 'password'].join('-');
const WRONG_PASSWORD = ['not', 'the', 'password'].join('-');
const MFA_KEY = Buffer.alloc(32, 0x2a);
const DATABASE_URL = process.env.SETTLE_TEST_DATABASE_URL;
const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
let clockMs = T0;
let ipCounter = 40;

beforeEach(() => {
  clockMs = T0;
  ipCounter = 40;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(clockMs));
});

afterEach(() => {
  vi.useRealTimers();
});

function makeApp(options: {
  auth?: AuthStore;
  personalFinance?: PersonalFinanceStore;
  spendLogs?: SpendLogStore;
  now?: () => Date;
} = {}) {
  const auth = options.auth ?? new InMemoryAuthStore();
  const personalFinance = options.personalFinance ?? new InMemoryPersonalFinanceStore();
  const spendLogs = options.spendLogs ?? new InMemorySpendLogStore();
  const practice = new PracticeLedger();
  const reject = () => Promise.reject(new LedgerError(503, 'live ledger is down'));
  const live = new Proxy({}, { get: () => reject }) as LedgerReader & LedgerWriter & LedgerAuditor;
  const api = createApp({
    ledger: new CompositeLedger(live, practice, async () => false),
    practice,
    spendLogs,
    personalFinance,
    auth,
    mailer: new MemoryMailer(),
    appUrl: 'https://settle.example',
    now: options.now ?? (() => new Date(clockMs)),
    mfaKey: MFA_KEY,
    breachedPassword: async () => false,
    enforceWalletAuth: false,
  });
  return { api, auth, personalFinance, spendLogs };
}

type Api = ReturnType<typeof makeApp>['api'];

function jsonHeaders(cookie?: string, ip?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': ip ?? `198.51.100.${10 + (ipCounter++ % 200)}`,
  };
  if (cookie) headers.cookie = cookie;
  return headers;
}

async function post(api: Api, path: string, body: unknown, cookie?: string, ip?: string): Promise<Response> {
  return api.request(path, {
    method: 'POST',
    headers: jsonHeaders(cookie, ip),
    body: JSON.stringify(body),
  });
}

function sessionCookie(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? '';
  for (const part of raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/)) {
    const pair = part.trim().split(';')[0] ?? '';
    if (pair.startsWith(SESSION_COOKIE + '=')) return pair;
  }
  throw new Error(`missing session cookie: "${raw}"`);
}

async function signUp(api: Api, email: string): Promise<string> {
  const res = await post(api, '/api/auth/register', { email, password: PASSWORD, displayName: 'Sam Lee' });
  expect(res.status).toBe(201);
  return sessionCookie(res);
}

function parseCsv(text: string): string[][] {
  return text.trimEnd().split('\r\n').map((line) => line.split(','));
}

/** Records the page sizes the export actually asks for. */
class RecordingFinanceStore extends InMemoryPersonalFinanceStore {
  readonly pageLimits: number[] = [];

  override async listIncomePage(accountId: string, afterId: string | null, limit: number): Promise<IncomeLogEntry[]> {
    this.pageLimits.push(limit);
    return super.listIncomePage(accountId, afterId, limit);
  }
}

class RecordingSpendLogStore extends InMemorySpendLogStore {
  readonly pageLimits: number[] = [];

  override async listSpendPage(accountId: string, afterId: string | null, limit: number): Promise<SpendLogEntry[]> {
    this.pageLimits.push(limit);
    return super.listSpendPage(accountId, afterId, limit);
  }
}

describe('1. MFA enable is a single conditional transition', () => {
  it('lets exactly one of two concurrent confirmations win', async () => {
    const { api, auth } = makeApp();
    const email = 'atomic-enable@example.com';
    const cookie = await signUp(api, email);

    const setup = await post(api, '/api/auth/mfa/setup', {}, cookie);
    expect(setup.status).toBe(200);
    const secret = base32Decode((await setup.json() as { secret: string }).secret);
    const body = { code: totp(secret, clockMs) };

    const [first, second] = await Promise.all([
      post(api, '/api/auth/mfa/enable', body, cookie),
      post(api, '/api/auth/mfa/enable', body, cookie),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
    const rejected = first.status === 409 ? first : second;
    expect(await rejected.json()).toEqual({ error: 'mfa_already_enabled' });

    const user = await auth.findByEmail(email);
    expect(user).not.toBeNull();
    expect(await auth.listRecoveryCodes(user!.id)).toHaveLength(10);
    expect((await auth.getMfaState(user!.id)).secret).not.toBeNull();
  });
});

describe('2. export streams bounded pages', () => {
  it('returns 1,234 income and spend rows exactly once in JSON and CSV', async () => {
    const finance = new RecordingFinanceStore();
    const spendLogs = new RecordingSpendLogStore();
    const { api, auth } = makeApp({ personalFinance: finance, spendLogs });
    const email = 'bounded-export@example.com';
    const cookie = await signUp(api, email);
    const user = await auth.findByEmail(email);
    expect(user).not.toBeNull();

    const ROWS = 1_234;
    for (let index = 0; index < ROWS; index++) {
      await finance.recordIncome(user!.accountId, {
        amountMinor: 100 + index,
        source: 'salary',
        note: `income-row-${index}`,
        occurredAt: new Date(T0 + index * 1_000).toISOString(),
      }, new Date(T0));
      await spendLogs.record(user!.accountId, {
        amountMinor: 200 + index,
        category: 'dining',
        note: `spend-row-${index}`,
        occurredAt: new Date(T0 + index * 1_000).toISOString(),
      }, new Date(T0));
    }
    const stepped = await post(api, '/api/auth/step-up', { password: PASSWORD }, cookie);
    expect(stepped.status).toBe(200);

    const expectedIncome = new Set(Array.from({ length: ROWS }, (_, index) => `income-row-${index}`));
    const expectedSpend = new Set(Array.from({ length: ROWS }, (_, index) => `spend-row-${index}`));

    const jsonRes = await api.request('/api/account/export?format=json', { headers: { cookie } });
    expect(jsonRes.status).toBe(200);
    expect(jsonRes.body).not.toBeNull();
    const body = await jsonRes.json() as {
      income: Array<{ note: string | null }>;
      spendLogs: Array<{ note: string | null }>;
    };
    const jsonIncome = body.income.map((row) => row.note ?? '');
    const jsonSpend = body.spendLogs.map((row) => row.note ?? '');
    expect(jsonIncome).toHaveLength(ROWS);
    expect(jsonSpend).toHaveLength(ROWS);
    expect(new Set(jsonIncome)).toEqual(expectedIncome);
    expect(new Set(jsonSpend)).toEqual(expectedSpend);

    const csvRes = await api.request('/api/account/export?format=csv', { headers: { cookie } });
    expect(csvRes.status).toBe(200);
    const rows = parseCsv(await csvRes.text());
    expect(rows[0]).toEqual(['kind', 'date', 'amount_minor', 'currency', 'note']);
    const csvIncome = rows.slice(1).filter((row) => row[0] === 'income').map((row) => row[4] ?? '');
    const csvSpend = rows.slice(1).filter((row) => row[0] === 'spend').map((row) => row[4] ?? '');
    expect(csvIncome).toHaveLength(ROWS);
    expect(csvSpend).toHaveLength(ROWS);
    expect(new Set(csvIncome)).toEqual(expectedIncome);
    expect(new Set(csvSpend)).toEqual(expectedSpend);

    expect(finance.pageLimits.length).toBeGreaterThan(0);
    expect(spendLogs.pageLimits.length).toBeGreaterThan(0);
    for (const limit of [...finance.pageLimits, ...spendLogs.pageLimits]) {
      expect(limit).toBeLessThanOrEqual(500);
    }
  }, 30_000);
});

describe.skipIf(!DATABASE_URL)('3. Postgres security state is shared by app instances', () => {
  interface PgFixture {
    apiA: Api;
    apiB: Api;
    authA: PostgresAuthStore;
    user: { id: string; accountId: string; email: string };
    email: string;
  }

  async function pgFixture(): Promise<PgFixture> {
    const url = DATABASE_URL!;
    const authA = new PostgresAuthStore(url);
    const authB = new PostgresAuthStore(url);
    const email = `m2-followup-${randomUUID()}@example.test`;
    const practice = new PracticeLedger();
    const user = await authA.provision({
      email,
      password: PASSWORD,
      displayName: 'Shared State',
    }, async (reserved) => {
      const account = await practice.openAccount(reserved.ownerId, 'USD');
      reserved.accountId = account.id;
    });
    return {
      apiA: makeApp({ auth: authA, now: () => new Date() }).api,
      apiB: makeApp({ auth: authB, now: () => new Date() }).api,
      authA,
      user: { id: user.id, accountId: user.accountId, email },
      email,
    };
  }

  async function cleanup(fixture: PgFixture, ip: string): Promise<void> {
    const client = new pg.Client({ connectionString: DATABASE_URL! });
    await client.connect();
    try {
      await client.query('delete from app_mfa_challenges where user_id = $1', [fixture.user.id]);
      await client.query(
        'delete from app_login_throttle where key in ($1, $2, $3)',
        ['acct:' + fixture.email, 'ip:' + ip, 'mfa:' + fixture.user.id],
      );
      await client.query('delete from app_auth_attempts where bucket = $1',
        [hashSessionToken('credentials:' + fixture.email)]);
      await client.query('delete from app_users where id = $1', [fixture.user.id]);
    } finally {
      await client.end();
    }
  }

  it('shares an account lockout between two instances', async () => {
    vi.useRealTimers();
    const fixture = await pgFixture();
    const ip = '203.0.113.240';
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await post(fixture.apiA, '/api/auth/login',
          { email: fixture.email, password: WRONG_PASSWORD }, undefined, ip);
        expect(res.status, `failed attempt ${attempt + 1}`).toBe(401);
      }
      const blocked = await post(fixture.apiB, '/api/auth/login',
        { email: fixture.email, password: PASSWORD }, undefined, ip);
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toEqual({ error: 'too_many_attempts' });
    } finally {
      await cleanup(fixture, ip);
    }
  }, 30_000);

  it('creates a challenge on one instance and verifies it on another', async () => {
    vi.useRealTimers();
    const fixture = await pgFixture();
    const ip = '203.0.113.241';
    const secret = Buffer.alloc(20, 0x3c);
    try {
      const encrypted = encryptSecret(secret, MFA_KEY);
      await fixture.authA.saveMfaPendingSecret(fixture.user.id, encrypted);
      expect(await fixture.authA.enableMfa(fixture.user.id, encrypted, [], null)).toBe(true);

      const login = await post(fixture.apiA, '/api/auth/login',
        { email: fixture.email, password: PASSWORD }, undefined, ip);
      expect(login.status).toBe(200);
      const { challenge } = await login.json() as { challenge?: string };
      expect(typeof challenge).toBe('string');

      const verified = await post(fixture.apiB, '/api/auth/mfa/verify',
        { challenge, code: totp(secret, Date.now()) }, undefined, ip);
      expect(verified.status).toBe(200);
      expect(await verified.json()).toEqual({ ok: true });
    } finally {
      await cleanup(fixture, ip);
    }
  }, 30_000);
});
