import './app.css';
import type { BootstrapResponse } from '../api.js';
import { Mascot } from './Mascot.js';
import type { Session } from './session.js';

/**
 * The two footers Settle shows.
 *
 * `full` is the evening-ink band under the landing page and the legal pages:
 * brand, product links, resources, legal, and the status of the live ledger.
 * `compact` is the slim bar under a signed-in wallet, which keeps the dock
 * clear on small screens.
 */

type FooterLink = { label: string; href: string; external?: boolean };

export type FooterVariant = 'full' | 'compact';

/**
 * Landing sections live at "/", so a legal page needs the leading slash to
 * reach them. On the landing page a bare "#how" keeps the scroll on-page.
 */
function anchorPrefix(): string {
  if (typeof window === 'undefined') return '/';
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '' ? '' : '/';
}

const REPO = 'https://github.com/developer-az/p2p-ledger';

function Column({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div className="site-footer-col">
      <h2 className="site-footer-heading">{title}</h2>
      <ul className="site-footer-links">
        {links.map((link) => (
          <li key={link.label}>
            <a
              href={link.href}
              {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter({ boot, session, variant }: {
  boot: BootstrapResponse | null;
  session: Session | null;
  variant: FooterVariant;
}) {
  const note = session?.demo
    ? 'Sample household. This is not your account.'
    : session?.user
      ? `Signed in as ${session.user.email}`
      : 'Create an account to keep a wallet of your own.';
  const accountAccess = Boolean(session?.user && boot?.identity?.googleAvailable);

  if (variant === 'compact') {
    return (
      <footer className="site-footer site-footer-compact">
        <span className="site-footer-note">{note}</span>
        <nav className="site-footer-compact-nav" aria-label="Settle">
          {accountAccess ? <a href="/account-access">Account access</a> : null}
          <a href="/ops">Console</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </footer>
    );
  }

  const root = anchorPrefix();

  return (
    <footer className="site-footer site-footer-full">
      <div className="site-footer-inner">
        <div className="site-footer-grid">
          <div className="site-footer-brand">
            <a className="site-footer-logo" href="/" aria-label="Settle home">
              <Mascot size={36} track={false} idle={false} mood="happy" />
              <span>settle</span>
            </a>
            <p className="site-footer-pitch">Know your money. Keep the habit.</p>
            {boot ? (
              <p className={`site-footer-pill${boot.live ? ' is-live' : ''}`}>
                <span className="site-footer-dot" aria-hidden="true" />
                {boot.live ? 'Ledger online' : 'Ledger waking up'}
              </p>
            ) : null}
          </div>
          <Column
            title="Product"
            links={[
              { label: 'How it works', href: `${root}#how` },
              { label: 'Ask', href: `${root}#ask` },
              { label: 'Security', href: `${root}#trust` },
              { label: 'Create account', href: `${root}#account` },
            ]}
          />
          <Column
            title="Resources"
            links={[
              { label: 'Developer console', href: '/ops' },
              { label: 'Source on GitHub', href: REPO, external: true },
              { label: 'Service status', href: '/api/health' },
            ]}
          />
          <Column
            title="Legal"
            links={[
              { label: 'Privacy', href: '/privacy' },
              { label: 'Terms', href: '/terms' },
              { label: 'Account access', href: '/account-access' },
            ]}
          />
        </div>
        <div className="site-footer-bottom">
          <p>{'©'} 2026 Settle. All rights reserved.</p>
          <p>Settle is not a bank. Balances are records you enter.</p>
        </div>
      </div>
    </footer>
  );
}
