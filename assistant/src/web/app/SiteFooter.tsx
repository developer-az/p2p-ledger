import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/footer.css';
import type { BootstrapResponse } from '../api.js';
import { BrandMark } from './BrandMark.js';
import type { Session } from './session.js';

/**
 * The two footers Settle shows.
 *
 * `full` sits under the landing page and the legal pages: the mark, the link
 * groups and the fine print, in the same paper-and-hairline language as the
 * landing page. `compact` is the slim bar under a signed-in wallet, which keeps
 * the dock clear on small screens.
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
        <div className="site-footer-row">
          <div className="site-footer-brand">
            <a className="site-footer-logo" href="/" aria-label="Settle home">
              <BrandMark size={16} />
              <span>Settle</span>
            </a>
            <p className="site-footer-pitch">Transaction intelligence you run yourself.</p>
            {boot ? (
              <p className={`site-footer-status${boot.live ? ' is-live' : ''}`}>
                <span className="site-footer-dot" aria-hidden="true" />
                {boot.live ? 'Ledger online' : 'Ledger waking up'}
              </p>
            ) : null}
          </div>
          <Column
            title="Product"
            links={[
              { label: 'Overview', href: `${root}#overview` },
              { label: 'Pipeline', href: `${root}#pipeline` },
              { label: 'Sample data', href: `${root}#figures` },
              { label: 'Security', href: `${root}#security` },
              { label: 'Run it', href: `${root}#run` },
              { label: 'Create account', href: '/signup' },
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
        <div className="site-footer-fine">
          <p>{'©'} 2026 Settle. All rights reserved.</p>
          <p>Settle is not a bank. Balances are records you enter.</p>
        </div>
      </div>
    </footer>
  );
}
