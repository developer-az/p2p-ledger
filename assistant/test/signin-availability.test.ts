import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SignIn } from '../src/web/app/SignIn.js';
import { PracticeLedger } from '../src/server/practice-ledger.js';
import type { BootstrapResponse } from '../src/web/api.js';

function render(mode: 'signin' | 'create', signupAvailable: boolean, googleAvailable = false) {
  const boot: BootstrapResponse = { live: false, practice: new PracticeLedger().bootstrap(), identity: {
    persistent: true, googleAvailable, signupAvailable, signinAvailable: true, passwordResetAvailable: false,
    unavailableReason: signupAvailable ? undefined : 'Account creation is unavailable.',
  } };
  return renderToStaticMarkup(createElement(SignIn, { mode, boot, bootError: null, onStart: () => {} }));
}

describe('sign-in page availability copy', () => {
  it('does not promise a saved account when signup is unavailable despite persistent storage', () => {
    const html = render('create', false);
    expect(html).toContain('Account creation is unavailable.');
    expect(html).not.toContain('Saved with the ledger');
    expect(html).not.toContain('Your account will be saved');
    expect(html).not.toContain('Sign in with this email next time');
  });

  it('uses prospective wording when signup is available, without claiming signup succeeded', () => {
    const html = render('create', true);
    expect(html).toContain('Your account will be saved.');
    expect(html).not.toContain('Saved with the ledger');
  });

  it('keeps the Google entry when enabled and hides it otherwise', () => {
    const html = render('create', true, true);
    expect(html).toContain('class="signin-form"');
    expect(html).toContain('href="/google-signin"');
    expect(html).toContain('Continue with Google');
    expect(html).toContain('or continue with email');
    expect(render('create', true, false)).not.toContain('Continue with Google');
  });
});

describe('sign-in page layout', () => {
  it('titles each mode and links to the other one', () => {
    const signin = render('signin', true);
    expect(signin).toContain('Sign in to Settle');
    expect(signin).toContain('href="/signup"');
    const create = render('create', true);
    expect(create).toContain('Create your account');
    expect(create).toContain('href="/signin"');
  });

  it('shows only true trust statements and labels unbuilt ones as planned', () => {
    const html = render('signin', true);
    expect(html).toContain('scrypt');
    expect(html).toContain('bank password');
    expect(html).toContain('Planned · M2');
    expect(html).not.toMatch(/end-to-end encrypt/i);
  });

  it('has no mascot, sky or animation markup', () => {
    const html = render('signin', true);
    expect(html).not.toMatch(/mascot|sky-|cloud/i);
    expect(html).toContain('href="/"');
  });
});
