import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { LedgerError, type LedgerAuditor, type LedgerWriter } from '../src/server/ledger.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { ScriptedProvider } from '../src/server/providers/scripted.js';
import { FixtureLedger, ME } from '../evals/fixture.js';

const practice = new PracticeLedger();

const readOnly = () => Promise.reject(new Error('read-only fixture'));
const writer: LedgerWriter & LedgerAuditor = {
  openAccount: readOnly,
  deposit: readOnly,
  transfer: readOnly,
  trail: readOnly,
  integrity: readOnly,
  tamperChecks: readOnly,
  postTransfer: readOnly,
  postDeposit: readOnly,
};
const app = createApp({
  ledger: new CompositeLedger(Object.assign(new FixtureLedger(), writer), practice, async () => false),
  practice,
  provider: () => new ScriptedProvider([{ answer: 'Hello!' }]),
});
const chat = (body: unknown, ip = '1.1.1.1') => app.request('/api/chat', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
});

describe('GET /api/accounts/:id', () => {
  it('returns the balance and recent activity for a user account', async () => {
    const res = await app.request(`/api/accounts?id=${ME}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      balance: string; owner: string;
      summary: { stopped: string; declinedCount: number };
      transfers: { direction: string; status: string; declineExplanation: string | null }[];
    };
    expect(body).toMatchObject({ owner: 'riley', balance: '$3,750.51' });
    expect(body.transfers.length).toBeGreaterThan(0);
    expect(body.transfers[0]).toMatchObject({ direction: 'received' });
    expect(body.transfers.some((t) => t.status === 'REJECTED')).toBe(true);
    const stopped = body.transfers.find((t) => t.status === 'REJECTED');
    expect(stopped?.declineExplanation).toMatch(/60-second|5 transfers/i);
    expect(body.summary.stopped).toMatch(/^\$/);
    expect(body.summary.declinedCount).toBeGreaterThan(0);
    expect((await app.request(`/api/accounts/${ME}`)).status).toBe(200);
  });

  it('says the ledger is waking when the upstream returns 502', async () => {
    const asleepLive = Object.assign(new FixtureLedger(), writer, {
      getAccount: () => Promise.reject(new LedgerError(502, 'bad gateway')),
    });
    const asleep = createApp({
      ledger: new CompositeLedger(asleepLive, practice, async () => false),
      practice,
      provider: () => new ScriptedProvider([{ answer: 'Hello!' }]),
    });
    const res = await asleep.request(`/api/accounts?id=${ME}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'The ledger is waking up. Try again in a moment.' });
  });

  it('hides unknown and system accounts', async () => {
    expect((await app.request('/api/accounts/not-a-uuid')).status).toBe(404);
    expect((await app.request('/api/accounts/00000000-0000-7000-8000-000000000001')).status).toBe(404);
  });
});

describe('POST /api/chat', () => {
  it('answers for a valid account', async () => {
    const res = await chat({ accountId: ME, messages: [{ role: 'user', text: 'hi' }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ answer: 'Hello!', provider: 'scripted' });
  });

  it('rejects malformed bodies and unknown or system accounts', async () => {
    expect((await chat({ accountId: 'nope', messages: [] })).status).toBe(400);
    expect((await chat({ accountId: ME, messages: [{ role: 'assistant', text: 'x' }] })).status).toBe(400);
    expect((await chat({ accountId: '0199c0de-0000-7000-8000-0000000000ff', messages: [{ role: 'user', text: 'hi' }] })).status).toBe(404);
    expect((await chat({ accountId: '00000000-0000-7000-8000-000000000001', messages: [{ role: 'user', text: 'hi' }] })).status).toBe(404);
  });

  it('answers from the ledger when the model is out of quota', async () => {
    const limited = createApp({
      ledger: new CompositeLedger(Object.assign(new FixtureLedger(), writer), practice, async () => false),
      practice,
      provider: () => ({
        name: 'scripted',
        model: 'fake',
        run: () => Promise.reject(Object.assign(new Error('quota'), { status: 429 })),
      }),
    });
    const res = await limited.request('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ accountId: ME, messages: [{ role: 'user', text: "What's my balance?" }] }),
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '8.8.8.8' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ answer: 'Your balance is $3,750.51.', provider: 'ledger' });
  });

  it('rate-limits a single client', async () => {
    const statuses = [];
    for (let i = 0; i < 22; i++) statuses.push((await chat({ accountId: ME, messages: [{ role: 'user', text: 'hi' }] }, '9.9.9.9')).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
