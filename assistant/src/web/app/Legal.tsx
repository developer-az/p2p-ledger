import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { SiteFooter } from './SiteFooter.js';

const REPO = 'https://github.com/developer-az/p2p-ledger';
const ISSUES = `${REPO}/issues`;
const ADVISORIES = `${REPO}/security/advisories/new`;

const updated = <p><strong>Last updated: November 11, 2026</strong></p>;

const templateNote = (
  <p className="notice" role="note">
    This is a template written for a solo-operated project and is not legal advice.
  </p>
);

const operator = (
  <p>
    Settle is operated by Anthony Zhou, an individual solo operator in the United States.
    Settle is a personal record-keeping app, not a bank.
  </p>
);

const contact = (
  <>
    <p>
      Use the GitHub repository for contact. General questions go to{' '}
      <a href={ISSUES} target="_blank" rel="noopener noreferrer">GitHub Issues</a>. Report a
      security problem privately through{' '}
      <a href={ADVISORIES} target="_blank" rel="noopener noreferrer">GitHub security advisories</a>.
      Do not open a public issue for a vulnerability.
    </p>
    <p>
      For an account or data request, do not post personal or financial details in a public
      issue. Open an issue that asks for a private follow-up, and we will arrange one.
    </p>
  </>
);

function Privacy() {
  return <>
    <h1>Privacy Policy</h1>
    {updated}
    {templateNote}
    {operator}

    <h2>What we store</h2>
    <ul>
      <li><strong>Account:</strong> your email address, display name, and a password hash made with scrypt. We never store your password itself. If you use Google sign-in, we also store the Google account identifier and the name and email address Google returns.</li>
      <li><strong>Sign-in and security:</strong> sessions store a hash of the session token, a browser and operating-system label, a coarse network prefix (such as /24 for IPv4), and timestamps. If you turn on two-factor sign-in, we store an encrypted authenticator secret and hashes of recovery codes. Passkeys are stored as public keys with a label you choose. The audit log records security events with the event type, time, device label, and network prefix.</li>
      <li><strong>Money records:</strong> ledger entries and transfers, spend and income logs (amount, category, date, and any note), and profile values such as cash on hand, credit owed, and weekly budget. The app encrypts note fields with AES-256-GCM under a per-user data key before saving them in its own database. The data key is wrapped by a key-encryption key, so the database does not hold an unwrapped key. Ledger entries and live spend records are stored by the ledger service.</li>
      <li><strong>Abuse prevention:</strong> short-lived rate-limit and sign-in attempt counters. The durable counter table is keyed by a hash of the bucket name, not by a raw address.</li>
    </ul>
    <p>
      We do not ask for bank passwords, bank logins, or full card numbers. The app asks you to
      enter records yourself; it does not connect to your bank.
    </p>

    <h2>Why we use it</h2>
    <p>
      We use this information to create and secure your account, show your records, calculate
      totals and weekly pace, answer questions in Ask, send password-reset email, prevent abuse,
      and respond to requests. We do not sell your personal information and do not use it for
      advertising.
    </p>

    <h2>Cookies and browser storage</h2>
    <p>
      Settle uses essential cookies only, so there is no cookie banner. The{' '}
      <code>__Host-settle_session</code> cookie keeps you signed in; it is httpOnly, secure,
      SameSite=Lax, expires after at most 7 days, and ends after 30 minutes idle. If you start
      Google sign-in, a signed <code>settle_google_flow</code> cookie holds that flow for up to
      10 minutes and is limited to the Google callback path. We use no analytics, advertising, or
      cross-site tracking cookies.
    </p>
    <p>
      The browser may also keep preferences and sample-household state in local or session
      storage. That storage stays in your browser and is not a cookie.
    </p>

    <h2>Service providers</h2>
    <ul>
      <li><strong>Vercel</strong> hosts the web app and API.</li>
      <li><strong>Render</strong> runs the ledger service.</li>
      <li><strong>Supabase</strong> hosts the Postgres database.</li>
      <li><strong>Resend</strong> delivers password-reset email.</li>
      <li><strong>Google</strong> handles sign-in if you choose it. Google shares your name, email address, and account identifier. We do not request Gmail, Drive, or contacts access.</li>
      <li><strong>Google Gemini</strong> and <strong>OpenRouter</strong> provide the model used by Ask. Depending on configuration, a request goes to one provider, or to the other as a fallback. The request includes your question, recent chat turns, an internal wallet id and owner labels, the date, and the records the assistant reads: balances, transfers and memos, spend and income entries and notes, and weekly budget and cash values. It does not include your email address or password. A provider may keep data under its own terms.</li>
      <li><strong>Have I Been Pwned (Pwned Passwords)</strong> checks whether a new password appears in a known breach. Only the first five characters of the password&rsquo;s SHA-1 hash are sent; the password and the rest of the hash stay on our server. If the service is unavailable, the check is skipped.</li>
      <li><strong>AWS KMS</strong>, if configured, wraps and unwraps the per-user data keys.</li>
    </ul>
    <p>
      Ask keeps a short-lived in-memory answer cache and daily model budgets. When the budget is
      spent or no model is configured, the answer comes from the ledger without a model call.
    </p>

    <h2>Retention and deletion</h2>
    <ul>
      <li>Sign-in sessions expire after at most 7 days and after 30 minutes idle. Password-reset links expire after 30 minutes and work once. Rate-limit counters are short-lived.</li>
      <li>Account information is kept while your account is active.</li>
      <li>You can delete your account in Settings &rarr; Data &amp; privacy. Settle removes your account, profile, income logs, app-side spend logs, sessions, two-factor data, recovery codes, passkeys, and audit events, and destroys your per-user data key. The app can no longer decrypt ciphertext left in its live tables.</li>
      <li>The ledger service keeps its append-only ledger entries and live spend records as financial history. Deleting the account does not rewrite that history.</li>
      <li>Backups are managed by the hosting providers and expire on their schedules. A backup may hold an older copy until then.</li>
    </ul>

    <h2>Your choices and rights</h2>
    <p>
      In Settings &rarr; Data &amp; privacy you can export your account as JSON or CSV, or delete
      your account. The JSON export includes your account details, profile, income logs, app-side
      spend logs, sessions, and audit events. The CSV export includes your income and spend rows.
      Neither export includes the ledger service&rsquo;s entries. You can correct profile fields in
      Settings. For another correction or access request, use the contact route above. Depending
      on where you live, you may have other rights; we will review requests we can verify.
    </p>

    <h2>Age and location</h2>
    <p>
      Settle is intended for people who are at least 18 and live in the United States. We do not
      knowingly collect information from children. If a child has created an account, ask for
      deletion through the contact route above.
    </p>

    <h2>Changes</h2>
    <p>
      We will post changes on this page and update the date above. If a change is material, we
      will also describe it in the app.
    </p>

    <h2>Contact</h2>
    {contact}
  </>;
}

function Terms() {
  return <>
    <h1>Terms of Use</h1>
    {updated}
    {templateNote}
    {operator}

    <h2>Using Settle</h2>
    <p>
      By using Settle, you agree to these terms. If you do not agree, do not use the service.
      You must be at least 18 and live in the United States. Provide accurate account
      information, keep your sign-in credentials secure, and tell us through the contact route
      if you believe someone else has access to your account.
    </p>

    <h2>What Settle does</h2>
    <p>
      Settle provides budgeting tools, user-entered financial records, a simulated ledger, and
      informational answers in Ask. Balances and ledger entries are records, not money held for
      you, and no real money moves through Settle. Settle is not a bank and does not provide
      custody, deposit insurance, payment rails, or a bank connection.
    </p>

    <h2>Not financial advice</h2>
    <p>
      Settle is for information and record-keeping. It does not provide financial, investment,
      tax, legal, or accounting advice. Model answers may be wrong or incomplete. Check important
      numbers and information before you rely on them, and make your own decisions.
    </p>

    <h2>Your content</h2>
    <p>
      You keep your rights in the records you enter. You give Settle permission to store,
      process, back up, and display that content as needed to run the service and as described in
      the Privacy Policy. Do not enter content you do not have the right to use, or content that
      is unlawful.
    </p>

    <h2>Acceptable use</h2>
    <p>
      Do not access another person&rsquo;s records, interfere with the service or its security,
      bypass rate limits, upload malware, or use Settle to break the law. Security research is
      welcome under the rules in the repository&rsquo;s SECURITY.md. We may suspend or remove
      access to address abuse, security risk, or legal requirements.
    </p>

    <h2>Availability and changes</h2>
    <p>
      Settle may be interrupted, changed, or discontinued. We do not promise uninterrupted
      availability or that every feature will stay the same. Keep your own copies of records
      that matter to you. You can export your data or delete your account at any time in
      Settings &rarr; Data &amp; privacy.
    </p>

    <h2>Disclaimers and liability</h2>
    <p>
      Settle is provided as is. To the extent the law allows, Anthony Zhou is not liable for
      indirect or consequential losses, or for decisions you make from information in the app.
      Nothing in these terms limits a right that the law does not allow to be limited.
    </p>

    <h2>Contact</h2>
    {contact}
  </>;
}

export function Legal({ page }: { page: 'privacy' | 'terms' }) {
  return <div className="app"><main className="main" style={{ maxWidth: 760, padding: '48px 24px', lineHeight: 1.8 }}>
    <a href="/">Back to Settle</a>
    {page === 'privacy' ? <Privacy /> : <Terms />}
    <p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/account-access">Account access and data requests</a> · <a href="/.well-known/security.txt">security.txt</a></p>
  </main>
  <SiteFooter variant="full" boot={null} session={null} />
</div>;
}
