import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Welcome } from '../src/web/app/Welcome.js';
import { PracticeLedger } from '../src/server/practice-ledger.js';
import type { BootstrapResponse } from '../src/web/api.js';

function render() {
  const boot: BootstrapResponse = { live: false, practice: new PracticeLedger().bootstrap(), identity: {
    persistent: true, googleAvailable: false, signupAvailable: true, signinAvailable: true, passwordResetAvailable: false,
  } };
  return renderToStaticMarkup(createElement(Welcome, { boot, bootError: null, onStart: () => {} }));
}

describe('landing page', () => {
  it('renders without motion providers or a window', () => {
    expect(() => render()).not.toThrow();
  });

  it('has five numbered sections in order', () => {
    const html = render();
    const positions = ['01', '02', '03', '04', '05'].map((n) => html.indexOf(`>${n}<`));
    for (const p of positions) expect(p).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('shows the five pipeline stages and labels unbuilt ones as planned', () => {
    const html = render();
    for (const stage of ['Import', 'Reconcile', 'Resolve', 'Detect', 'Forecast']) expect(html).toContain(stage);
    expect(html).toContain('Planned · M3');
    expect(html).toContain('Planned · M4');
    expect(html).toContain('Planned · M6');
  });

  it('labels the figure strip as sample data', () => {
    expect(render()).toContain('Sample data');
  });

  it('links to sign in, the sample household and the source', () => {
    const html = render();
    expect(html).toContain('href="/signin"');
    expect(html).toContain('Explore the sample household');
    expect(html).toContain('https://github.com/developer-az/p2p-ledger');
  });

  it('has no mascot, streaks, sky, marquee or tilt markup', () => {
    const html = render();
    expect(html).not.toMatch(/mascot|streak|sky-|cloud|w-tape|tilt|confetti/i);
  });

  it('uses no banned words', () => {
    expect(render()).not.toMatch(/spearheaded|innovative|dynamic|passionate|leveraged|synergized/i);
  });
});
