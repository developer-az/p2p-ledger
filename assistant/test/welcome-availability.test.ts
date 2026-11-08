import { it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LazyMotion, domAnimation } from 'motion/react';
import { Welcome } from '../src/web/app/Welcome.js';
import { PracticeLedger } from '../src/server/practice-ledger.js';
import type { BootstrapResponse } from '../src/web/api.js';

function render(signupAvailable: boolean, googleAvailable = false) {
  const boot: BootstrapResponse = { live: false, practice: new PracticeLedger().bootstrap(), identity: {
    persistent: true, googleAvailable, signupAvailable, signinAvailable: true, passwordResetAvailable: false,
    unavailableReason: signupAvailable ? undefined : 'Account creation is unavailable.',
  } };
  return renderToStaticMarkup(createElement(LazyMotion, { features: domAnimation },
    createElement(Welcome, { boot, bootError: null, onStart: () => {} })));
}
it('does not promise a saved account when signup is unavailable despite persistent storage', () => {
  const html = render(false);
  expect(html).toContain('Account creation is unavailable.');
  expect(html).not.toContain('Saved with the ledger');
  expect(html).not.toContain('Your account will be saved');
  expect(html).not.toContain('Sign in with this email next time');
});
it('uses prospective wording when signup is available, without claiming signup succeeded', () => {
  const html = render(true);
  expect(html).toContain('Your account will be saved.');
  expect(html).not.toContain('Saved with the ledger');
});

it('keeps Google entry in the redesigned account form when enabled', () => {
  const html = render(true, true);
  expect(html).toContain('class="sky-form"');
  expect(html).toContain('href="/google-signin"');
  expect(html).toContain('Continue with Google');
  expect(html).toContain('or continue with email');
  expect(render(true, false)).not.toContain('Continue with Google');
});
