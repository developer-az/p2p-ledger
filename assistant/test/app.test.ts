import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import type { LedgerWriter } from '../src/server/ledger.js';
import { ScriptedProvider } from '../src/server/providers/scripted.js';
import { FixtureLedger, ME } from '../evals/fixture.js';

const writer: LedgerWriter = {
  openAccount: () => Promise.reject(new Error('read-only fixture')),
  deposit: () => Promise.reject(new Error('read-only fixture')),
  transfer: () => Promise.reject(new Error('read-only fixture')),
};
const app = createApp({
  ledger: Object.assign(new FixtureLedger(), writer),
  provider: () => new ScriptedProvider([{ answer: 'Hello!' }]),
});
const chat = (body: unknown, ip = '1.1.1.1') => app.request('/api/chat', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
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

  it('rate-limits a single client', async () => {
    const statuses = [];
    for (let i = 0; i < 22; i++) statuses.push((await chat({ accountId: ME, messages: [{ role: 'user', text: 'hi' }] }, '9.9.9.9')).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
