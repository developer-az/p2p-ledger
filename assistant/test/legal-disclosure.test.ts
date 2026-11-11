import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Legal } from '../src/web/app/Legal.js';

const root = new URL('..', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const emailPattern = /[\w.+-]+@[\w-]+\.[\w.-]+/;

const privacy = renderToStaticMarkup(createElement(Legal, { page: 'privacy' }));
const terms = renderToStaticMarkup(createElement(Legal, { page: 'terms' }));

describe('legal pages', () => {
  it('names the operator, the update date and the template warning', () => {
    for (const html of [privacy, terms]) {
      expect(html).toContain('Last updated: November 11, 2026');
      expect(html).toContain('Anthony Zhou');
      expect(html).toContain('United States');
      expect(html).toContain('This is a template written for a solo-operated project and is not legal advice.');
    }
  });

  it('uses the repository for contact and publishes no email address', () => {
    for (const html of [privacy, terms]) {
      expect(html).toContain('https://github.com/developer-az/p2p-ledger/issues');
      expect(html).toContain('https://github.com/developer-az/p2p-ledger/security/advisories/new');
      expect(html).not.toContain('mailto:');
      expect(html).not.toMatch(emailPattern);
    }
    for (const source of [read('src/web/app/Legal.tsx')]) {
      expect(source).not.toContain('mailto:');
      expect(source).not.toMatch(emailPattern);
    }
  });

  it('states the cookie, storage and processor facts on the privacy page', () => {
    for (const text of [
      '__Host-settle_session',
      'settle_google_flow',
      'no cookie banner',
      'no analytics',
      'AES-256-GCM',
      'per-user data key',
      'Vercel',
      'Render',
      'Supabase',
      'Resend',
      'Google Gemini',
      'OpenRouter',
      'Have I Been Pwned',
      'first five characters',
      '7 days',
      'append-only',
      '18',
    ]) {
      expect(privacy).toContain(text);
    }
  });

  it('states the account, advice and bank limits on the terms page', () => {
    for (const text of ['Not financial advice', 'Settle is not a bank', 'at least 18', 'United States', 'Settings']) {
      expect(terms).toContain(text);
    }
  });

  it('avoids banned words', () => {
    for (const html of [privacy, terms]) {
      expect(html).not.toMatch(/spearheaded|innovative|dynamic|passionate|leveraged|synergized/i);
    }
  });
});

describe('security.txt', () => {
  const text = read('public/.well-known/security.txt');
  const fields = new Map(text.split(/\r?\n/).filter(Boolean).map((line) => {
    const at = line.indexOf(':');
    return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
  }));

  it('has the RFC 9116 fields, with no email address', () => {
    expect(fields.get('Contact')).toBe('https://github.com/developer-az/p2p-ledger/security/advisories/new');
    expect(fields.get('Expires')).toBe('2027-11-11T00:00:00.000Z');
    expect(fields.get('Preferred-Languages')).toBe('en');
    expect(fields.get('Canonical')).toBe('https://ledger.anthony-zhou.com/.well-known/security.txt');
    expect(text).not.toContain('mailto:');
    expect(text).not.toMatch(emailPattern);
  });

  it('is not sent to the SPA fallback by vercel.json', () => {
    const vercel = JSON.parse(read('vercel.json')) as {
      rewrites: { source: string; destination: string }[];
    };
    const spa = vercel.rewrites.find((rewrite) => rewrite.destination === '/index.html');
    expect(spa).toBeDefined();
    const matches = new RegExp(`^${spa!.source}$`);
    expect(matches.test('/privacy')).toBe(true);
    expect(matches.test('/.well-known/security.txt')).toBe(false);
  });
});

describe('SECURITY.md disclosure policy', () => {
  const policy = read('../SECURITY.md');

  it('names the supported branch and private report channel', () => {
    expect(policy).toContain('`main`');
    expect(policy).toContain('https://github.com/developer-az/p2p-ledger/security/advisories/new');
    expect(policy).not.toContain('mailto:');
    expect(policy).not.toMatch(emailPattern);
    expect(policy).toContain('within 7 days');
  });

  it('includes safe harbor and out-of-scope rules', () => {
    expect(policy).toMatch(/safe harbor/i);
    expect(policy).toMatch(/out of scope/i);
    expect(policy).toMatch(/social engineering/i);
    expect(policy).toMatch(/denial-of-service/i);
  });
});

