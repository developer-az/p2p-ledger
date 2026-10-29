import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { PracticeLedger, CompositeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { API_HEADERS, PAGE_CSP, PAGE_HEADERS } from '../src/server/security-headers.js';
import type { LedgerAuditor, LedgerReader, LedgerWriter } from '../src/server/ledger.js';

describe('security headers', () => {
  it('vercel.json sends exactly the page headers for the site', () => {
    const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
    const site = vercel.headers.find((h) => h.source === '/((?!api/).*)');
    expect(site).toBeDefined();
    expect(Object.fromEntries(site!.headers.map((h) => [h.key, h.value]))).toEqual(PAGE_HEADERS);
  });

  it('the page CSP allows only this origin plus Google Fonts and forbids framing', () => {
    expect(PAGE_CSP).toContain("script-src 'self'");
    expect(PAGE_CSP).not.toMatch(/script-src[^;]*unsafe/);
    expect(PAGE_CSP).toContain("frame-ancestors 'none'");
    expect(PAGE_CSP).toContain('https://fonts.gstatic.com');
  });

  it('every API response carries the API headers', async () => {
    const practice = new PracticeLedger();
    const live = new Proxy({}, { get: () => () => Promise.reject(new Error('down')) }) as LedgerReader & LedgerWriter & LedgerAuditor;
    const api = createApp({ ledger: new CompositeLedger(live, practice, async () => false), practice, spendLogs: new InMemorySpendLogStore() });
    for (const path of ['/api/health', '/api/does-not-exist']) {
      const res = await api.request(path);
      for (const [name, value] of Object.entries(API_HEADERS)) expect(res.headers.get(name), `${path} ${name}`).toBe(value);
    }
  });
});
