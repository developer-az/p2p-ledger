/**
 * Acceptance tests for step 2.7-lite — data export and account deletion.
 *
 * These encode the target behaviour and are expected to fail until the routes
 * below exist. They are written against the current AuthStore surface, so the
 * only TypeScript failures should be the not-yet-implemented HTTP routes.
 *
 * Assumed routes (JSON unless noted):
 *   GET    /api/account/export?format=json  (session + recent step-up)
 *     -> 200 application/json
 *        Content-Disposition: attachment; filename="settle-export-YYYY-MM-DD.json"
 *        { exportedAt, user: { id, email, displayName }, profile,
 *          income: [...], spendLogs: [...], sessions: [...], audit: [...] }
 *   GET    /api/account/export?format=csv   (session + recent step-up)
 *     -> 200 text/csv
 *        Content-Disposition: attachment; filename="settle-export-YYYY-MM-DD.csv"
 *        header: kind,date,amount_minor,currency,note
 *   DELETE /api/account                     (session + recent step-up)
 *     body { confirm: 'DELETE' } -> 200 { deleted: true } + cleared session cookie
 *
 * Store methods used by these assertions (all already on AuthStore):
 *   findById, findByEmail, listSessions, getMfaState, listRecoveryCodes,
 *   listAudit, appendAudit, saveSession.
 * The deletion implementation may add its own write path; the tests only read
 * back through the existing store API.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import {
  InMemoryAuthStore,
  SESSION_COOKIE,
  hashSessionToken,
  newSessionToken,
  type AuditInput,
  type AuthRecord,
  type AuthStore,
} from '../src/server/auth.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from '../src/server/ledger.js';
import { MemoryMailer } from '../src/server/mailer.js';
import { InMemoryPersonalFinanceStore } from '../src/server/personal-finance.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { base32Decode, totp } from '../src/server/totp.js';

/** Midday UTC keeps the export filename date stable in ordinary test runners. */
const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);
const MFA_KEY = Buffer.alloc(32, 0x2a);
const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60_000;

/** Built with join() so no credential-shaped literal sits in the test. */
const PASSWORD = ['data', 'rights', 'correct', 'horse'].join('-');
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

type ExportBody = {
  exportedAt: string;
  user: { id: string; email: string; displayName: string };
  profile: {
    accountId: string;
    currency: string;
    walletCashMinor: number | null;
    creditOwedMinor: number;
    weeklyBudgetMinor: number | null;
  };
  income: Array<{ id: string; amountMinor: number; currency: string; note: string | null; occurredAt: string }>;
  spendLogs: Array<{ id: string; amountMinor: number; currency: string; note: string | null; occurredAt: string }>;
  sessions: Array<{ id: string; createdAt: string; lastSeenAt: string; device: string; ipPrefix: string | null }>;
  audit: Array<{ id: string; type: string; at: string; ipPrefix: string | null; device: string | null }>;
};

let clockMs = T0;
let ipCounter = 10;

beforeEach(() => {
  clockMs = T0;
  ipCounter = 10;
});

afterEach(() => {
  clockMs = T0;
});

function advance(ms: number): void {
  clockMs += ms;
}

/** Short IPv4 literal helper: no scattered address strings in assertions. */
function testIp(last: number): string {
  return ['203', '0', '113', String(last)].join('.');
}

function todayFileDate(): string {
  return new Date(clockMs).toISOString().slice(0, 10);
}

function makeApp(store: AuthStore = new InMemoryAuthStore()) {
  const practice = new PracticeLedger();
  const reject = () => Promise.reject(new LedgerError(503, 'live ledger is down'));
  const live = new Proxy({}, { get: () => reject }) as LedgerReader & LedgerWriter & LedgerAuditor;
  const personalFinance = new InMemoryPersonalFinanceStore();
  const spendLogs = new InMemorySpendLogStore();
  const api = createApp({
    ledger: new CompositeLedger(live, practice, async () => false),
    practice,
    spendLogs,
    personalFinance,
    auth: store,
    mailer: new MemoryMailer(),
    appUrl: 'https://settle.example',
    now: () => new Date(clockMs),
    mfaKey: MFA_KEY,
    breachedPassword: async () => false,
  });
  return { api, store, personalFinance, spendLogs };
}

type App = ReturnType<typeof makeApp>['api'];

function jsonHeaders(cookie?: string, lastIp?: number): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': testIp(lastIp ?? ipCounter++),
    'user-agent': USER_AGENT,
  };
  if (cookie) headers.cookie = cookie;
  return headers;
}

/** Splits combined Set-Cookie headers without breaking on attribute commas. */
function setCookieParts(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = res.headers.get('set-cookie') ?? '';
  return raw
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sessionPair(res: Response): string | null {
  for (const part of setCookieParts(res)) {
    const pair = part.split(';')[0] ?? '';
    if (pair.startsWith(SESSION_COOKIE + '=')) return pair;
  }
  return null;
}

function sessionCookie(res: Response): string {
  const pair = sessionPair(res);
  if (!pair) throw new Error(`missing session cookie: "${res.headers.get('set-cookie') ?? ''}"`);
  return pair;
}

function cookieValue(pair: string): string {
  return pair.slice(pair.indexOf('=') + 1);
}

/** True when the response expires the session cookie rather than setting a new value. */
function clearsSessionCookie(res: Response): boolean {
  for (const part of setCookieParts(res)) {
    const pair = part.split(';')[0] ?? '';
    if (pair === SESSION_COOKIE + '=') return true;
    if (pair.startsWith(SESSION_COOKIE + '=') && /max-age\s*=\s*0/i.test(part)) return true;
  }
  return false;
}

async function register(
  api: App,
  store: AuthStore,
  email: string,
  displayName = 'Sam Lee',
): Promise<{ cookie: string; user: AuthRecord }> {
  const res = await api.request('/api/auth/register', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password: PASSWORD, displayName }),
  });
  expect(res.status).toBe(201);
  const user = await store.findByEmail(email.toLowerCase());
  expect(user, 'registration must create the user').not.toBeNull();
  return { cookie: sessionCookie(res), user: user! };
}

async function stepUpWithPassword(api: App, cookie: string): Promise<void> {
  const res = await api.request('/api/auth/step-up', {
    method: 'POST',
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ password: PASSWORD }),
  });
  expect(res.status).toBe(200);
}

async function stepUpWithCode(api: App, cookie: string, code: string): Promise<void> {
  const res = await api.request('/api/auth/step-up', {
    method: 'POST',
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ code }),
  });
  expect(res.status).toBe(200);
}

async function enableMfa(
  api: App,
  cookie: string,
): Promise<{ cookie: string; secret: Buffer; recoveryCodes: string[] }> {
  const setup = await api.request('/api/auth/mfa/setup', { method: 'POST', headers: jsonHeaders(cookie) });
  expect(setup.status).toBe(200);
  const { secret: base32 } = await setup.json() as { secret: string };
  expect(base32).toMatch(/^[A-Z2-7]+$/);
  const secret = base32Decode(base32);

  const enabled = await api.request('/api/auth/mfa/enable', {
    method: 'POST',
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ code: totp(secret, clockMs) }),
  });
  expect(enabled.status).toBe(200);
  const body = await enabled.json() as { recoveryCodes: string[] };
  expect(body.recoveryCodes).toHaveLength(10);
  return { cookie: sessionCookie(enabled), secret, recoveryCodes: body.recoveryCodes };
}

/**
 * Minimal RFC 4180 reader: enough to prove quoting and escaping in the export
 * without depending on the implementation's own CSV parser.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const ch = text[index]!;
    if (quoted) {
      if (ch === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Records whether the user still existed when account_deleted was appended. */
class DeletionSpyStore extends InMemoryAuthStore {
  readonly accountDeleted: AuditInput[] = [];
  userPresentWhenAccountDeleted: boolean | null = null;

  override async appendAudit(event: AuditInput): Promise<void> {
    if (event.type === 'account_deleted') {
      this.accountDeleted.push({ ...event, at: new Date(event.at.getTime()) });
      this.userPresentWhenAccountDeleted = (await this.findById(event.userId)) !== null;
    }
    await super.appendAudit(event);
  }
}

describe('GET /api/account/export (JSON)', () => {
  it('requires a recent step-up, then returns the account data as an attachment', async () => {
    const { api, store, personalFinance, spendLogs } = makeApp();
    const { cookie, user } = await register(api, store, 'export-json@example.com');
    await personalFinance.updateProfile(user.accountId, 'USD', {
      walletCashMinor: 125_000,
      creditOwedMinor: 4_200,
      weeklyBudgetMinor: 30_000,
    }, new Date(clockMs));
    await personalFinance.recordIncome(user.accountId, {
      amountMinor: 500_000,
      source: 'salary',
      note: 'Monthly pay',
      occurredAt: new Date(clockMs).toISOString(),
    }, new Date(clockMs));
    await spendLogs.record(user.accountId, {
      amountMinor: 1_250,
      category: 'dining',
      note: 'Coffee',
      occurredAt: new Date(clockMs).toISOString(),
    }, new Date(clockMs));

    const denied = await api.request('/api/account/export?format=json', { headers: { cookie } });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'step_up_required' });

    await stepUpWithPassword(api, cookie);
    const res = await api.request('/api/account/export?format=json', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/^application\/json/);
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition.toLowerCase()).toContain('attachment');
    expect(disposition).toContain(`filename="settle-export-${todayFileDate()}.json"`);

    const body = await res.json() as ExportBody;
    expect(Date.parse(body.exportedAt)).not.toBeNaN();
    expect(Object.keys(body.user).sort()).toEqual(['displayName', 'email', 'id']);
    expect(body.user).toEqual({ id: user.id, email: user.email, displayName: user.displayName });

    expect(body.profile).toMatchObject({
      accountId: user.accountId,
      currency: 'USD',
      walletCashMinor: 125_000,
      creditOwedMinor: 4_200,
      weeklyBudgetMinor: 30_000,
    });
    expect(body.income.map((entry) => entry.note)).toContain('Monthly pay');
    expect(body.income.find((entry) => entry.note === 'Monthly pay')?.amountMinor).toBe(500_000);
    expect(body.spendLogs.map((entry) => entry.note)).toContain('Coffee');
    expect(body.spendLogs.find((entry) => entry.note === 'Coffee')?.amountMinor).toBe(1_250);

    const sessionsRes = await api.request('/api/auth/sessions', { headers: { cookie } });
    expect(sessionsRes.status).toBe(200);
    const listedSessions = (await sessionsRes.json() as { sessions: Array<{ id: string }> }).sessions;
    expect(body.sessions.length).toBe(listedSessions.length);
    const listedIds = new Set(listedSessions.map((session) => session.id));
    for (const session of body.sessions) {
      expect(listedIds.has(session.id), 'exported sessions must use the list-route ids').toBe(true);
      expect(typeof session.id).toBe('string');
      expect(new Date(session.createdAt).toISOString()).toBe(session.createdAt);
      expect(new Date(session.lastSeenAt).toISOString()).toBe(session.lastSeenAt);
      expect(typeof session.device).toBe('string');
      expect(session).toHaveProperty('ipPrefix');
      expect(session).not.toHaveProperty('tokenHash');
    }

    expect(body.audit.map((event) => event.type)).toContain('step_up');
    for (const event of body.audit) {
      expect(typeof event.id).toBe('string');
      expect((event.id as string).length).toBeGreaterThan(0);
      expect(typeof event.type).toBe('string');
      expect(new Date(event.at).toISOString()).toBe(event.at);
      expect(event).toHaveProperty('ipPrefix');
      expect(event).toHaveProperty('device');
      expect(event).not.toHaveProperty('detail');
    }
  });

  it('never contains password, session-token, MFA-secret or recovery-code hashes', async () => {
    const { api, store } = makeApp();
    const { cookie, user } = await register(api, store, 'export-secrets@example.com');
    const enabled = await enableMfa(api, cookie);
    advance(60_000);
    await stepUpWithCode(api, enabled.cookie, totp(enabled.secret, clockMs));

    const mfaState = await store.getMfaState(user.id);
    const recoveryCodes = await store.listRecoveryCodes(user.id);
    const tokenHash = hashSessionToken(cookieValue(enabled.cookie));
    expect(mfaState.secret).not.toBeNull();
    expect(recoveryCodes.length).toBeGreaterThan(0);

    const storedSecrets = [
      user.passwordHash,
      tokenHash,
      mfaState.secret!,
      ...recoveryCodes.map((code) => code.codeHash),
    ];

    const res = await api.request('/api/account/export?format=json', { headers: { cookie: enabled.cookie } });
    expect(res.status).toBe(200);
    const text = await res.text();

    for (const secret of storedSecrets) {
      expect(secret.length).toBeGreaterThan(0);
      expect(text, 'the export must not contain a stored hash or secret').not.toContain(secret);
    }
    for (const key of [
      'passwordHash',
      'password_hash',
      'mfa_secret',
      'mfaSecret',
      'code_hash',
      'codeHash',
      'tokenHash',
      'token_hash',
    ]) {
      expect(text, `the export must not expose ${key}`).not.toContain(key);
    }
    for (const code of enabled.recoveryCodes) {
      expect(text, 'the export must not contain a plaintext recovery code').not.toContain(code);
    }
  });

  it('writes an export audit event', async () => {
    const { api, store } = makeApp();
    const { cookie, user } = await register(api, store, 'export-audit@example.com');
    await stepUpWithPassword(api, cookie);

    const res = await api.request('/api/account/export?format=json', { headers: { cookie } });
    expect(res.status).toBe(200);
    await res.text();

    const events = await store.listAudit(user.id);
    expect(events.some((event) => event.type === 'export')).toBe(true);
    expect(events[0]?.type, 'the export event is newest').toBe('export');
  });
});

describe('GET /api/account/export (CSV)', () => {
  it('writes one header row and RFC 4180-safe income and spend rows with an injection guard', async () => {
    const { api, store, personalFinance, spendLogs } = makeApp();
    const { cookie, user } = await register(api, store, 'export-csv@example.com');
    const occurredAt = new Date(clockMs).toISOString();
    const incomeNote = 'Salary, "January"';
    const injected = [
      { note: '=SUM(A1:A2)', amountMinor: 1_100 },
      { note: '+1', amountMinor: 2_200 },
      { note: '-50', amountMinor: 3_300 },
      { note: '@cmd', amountMinor: 4_400 },
    ];

    await personalFinance.recordIncome(user.accountId, {
      amountMinor: 250_000,
      source: 'salary',
      note: incomeNote,
      occurredAt,
    }, new Date(clockMs));
    for (const entry of injected) {
      await spendLogs.record(user.accountId, {
        amountMinor: entry.amountMinor,
        category: 'other',
        note: entry.note,
        occurredAt,
      }, new Date(clockMs));
    }

    await stepUpWithPassword(api, cookie);
    const res = await api.request('/api/account/export?format=csv', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/^text\/csv/);
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition.toLowerCase()).toContain('attachment');
    expect(disposition).toContain(`filename="settle-export-${todayFileDate()}.csv"`);

    const text = await res.text();
    expect(text.split(/\r?\n/)[0]).toBe('kind,date,amount_minor,currency,note');
    expect(text, 'a comma/quote cell is quoted and quotes are doubled').toContain('"Salary, ""January"""');

    const rows = parseCsv(text);
    expect(rows[0]).toEqual(['kind', 'date', 'amount_minor', 'currency', 'note']);
    expect(rows.filter((row) => row[0] === 'kind')).toHaveLength(1);

    const incomeRow = rows.find((row) => row[0] === 'income' && row[4] === incomeNote);
    expect(incomeRow, 'the income row must survive CSV quoting').toBeDefined();
    expect(incomeRow?.[2]).toBe('250000');
    expect(incomeRow?.[3]).toBe('USD');
    expect(Date.parse(incomeRow?.[1] ?? '')).not.toBeNaN();

    for (const entry of injected) {
      const spendRow = rows.find((row) => row[0] === 'spend' && row[4] === `'${entry.note}`);
      expect(spendRow, `CSV injection guard must prefix ${entry.note}`).toBeDefined();
      expect(spendRow?.[2]).toBe(String(entry.amountMinor));
      expect(spendRow?.[3]).toBe('USD');
      expect(Date.parse(spendRow?.[1] ?? '')).not.toBeNaN();
    }
  });
});

describe('DELETE /api/account', () => {
  it('requires an exact confirm token and a recent step-up', async () => {
    const { api, store } = makeApp();
    const { cookie, user } = await register(api, store, 'delete-confirm@example.com');

    const noStepUp = await api.request('/api/account', {
      method: 'DELETE',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    expect(noStepUp.status).toBe(403);
    expect(await noStepUp.json()).toEqual({ error: 'step_up_required' });

    await stepUpWithPassword(api, cookie);
    for (const body of [{}, { confirm: 'delete' }, { confirm: 'DELETE!' }]) {
      const res = await api.request('/api/account', {
        method: 'DELETE',
        headers: jsonHeaders(cookie),
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'confirm_required' });
    }
    expect(await store.findById(user.id), 'a refused delete must not remove the user').not.toBeNull();
  });

  it('audits first, then removes the user, sessions, MFA, finance data and audit history', async () => {
    const spy = new DeletionSpyStore();
    const { api, store, personalFinance, spendLogs } = makeApp(spy);
    const email = 'delete-account@example.com';
    const { cookie, user } = await register(api, store, email);
    const enabled = await enableMfa(api, cookie);
    const accountId = user.accountId;

    await personalFinance.updateProfile(accountId, 'USD', {
      walletCashMinor: 90_000,
      creditOwedMinor: 7_800,
      weeklyBudgetMinor: 25_000,
    }, new Date(clockMs));
    await personalFinance.recordIncome(accountId, {
      amountMinor: 300_000,
      source: 'freelance',
      note: 'Invoice 42',
      occurredAt: new Date(clockMs).toISOString(),
    }, new Date(clockMs));
    await spendLogs.record(accountId, {
      amountMinor: 950,
      category: 'groceries',
      note: 'Market',
      occurredAt: new Date(clockMs).toISOString(),
    }, new Date(clockMs));
    await store.saveSession(
      hashSessionToken(newSessionToken()),
      user.id,
      new Date(clockMs + SESSION_ABSOLUTE_MS),
      { device: 'phone' },
    );

    advance(60_000);
    await stepUpWithCode(api, enabled.cookie, totp(enabled.secret, clockMs));

    expect(await store.listSessions(user.id)).toHaveLength(2);
    expect((await store.getMfaState(user.id)).secret).not.toBeNull();
    expect(await store.listRecoveryCodes(user.id)).toHaveLength(10);
    expect(await personalFinance.listIncome(accountId)).toHaveLength(1);
    expect(await spendLogs.list(accountId)).toHaveLength(1);
    expect((await store.listAudit(user.id)).length).toBeGreaterThan(0);

    const res = await api.request('/api/account', {
      method: 'DELETE',
      headers: jsonHeaders(enabled.cookie),
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(clearsSessionCookie(res), 'deletion must clear the session cookie').toBe(true);

    expect(spy.accountDeleted).toHaveLength(1);
    expect(spy.accountDeleted[0]?.type).toBe('account_deleted');
    expect(spy.accountDeleted[0]?.userId).toBe(user.id);
    expect(spy.userPresentWhenAccountDeleted, 'account_deleted must be written before removal').toBe(true);

    expect(await store.findById(user.id)).toBeNull();
    expect(await store.findByEmail(email)).toBeNull();
    expect(await store.listSessions(user.id)).toEqual([]);
    expect(await store.getMfaState(user.id)).toEqual({
      secret: null,
      pendingSecret: null,
      lastUsedStep: null,
      recoveryCodesLeft: 0,
    });
    expect(await store.listRecoveryCodes(user.id)).toEqual([]);
    expect(await personalFinance.listIncome(accountId)).toEqual([]);
    expect(await spendLogs.list(accountId, { limit: 100 })).toEqual([]);
    expect(await personalFinance.getProfile(accountId, 'USD')).toMatchObject({
      walletCashMinor: null,
      creditOwedMinor: 0,
      weeklyBudgetMinor: null,
    });

    // 2.7-lite removes the rows outright. The 7-day grace period and
    // crypto-shredding of a retained account_deleted marker follow in 2.5.
    // Therefore the old user id must have no audit history after deletion.
    expect(await store.listAudit(user.id)).toEqual([]);

    const oldCookie = await api.request('/api/account/export?format=json', {
      headers: { cookie: enabled.cookie },
    });
    expect(oldCookie.status, 'the old session cookie must stop authenticating').toBe(401);

    const login = await api.request('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.status).toBe(401);
    const loginBody = await login.json() as { error?: unknown; user?: unknown };
    expect(loginBody.user).toBeUndefined();

    const again = await api.request('/api/auth/register', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, password: PASSWORD, displayName: 'Sam Lee' }),
    });
    expect(again.status, 'the email must be reusable after deletion').toBe(201);
    const replacement = await store.findByEmail(email);
    expect(replacement).not.toBeNull();
    expect(replacement?.id).not.toBe(user.id);
  });

  it('rejects anonymous callers on both data-rights routes', async () => {
    const { api } = makeApp();
    const exportRes = await api.request('/api/account/export?format=json');
    expect(exportRes.status).toBe(401);

    const deleteRes = await api.request('/api/account', {
      method: 'DELETE',
      headers: jsonHeaders(),
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    expect(deleteRes.status).toBe(401);
  });

  it('rejects a cross-site Origin on the mutating route', async () => {
    // The existing CSRF middleware guards mutating methods; the export is a read.
    const { api, store } = makeApp();
    const { cookie } = await register(api, store, 'delete-cross-site@example.com');
    const res = await api.request('/api/account', {
      method: 'DELETE',
      headers: { ...jsonHeaders(cookie), origin: 'https://evil.example' },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'cross_origin' });
  });
});
