import { useState } from 'react';
import './app.css';
import { SiteFooter } from './SiteFooter.js';

export function Legal({ page }: { page: 'privacy' | 'terms' | 'google-signin' }) {
  const [accepted, setAccepted] = useState(false);
  return <div className="app"><main className="main" style={{ maxWidth: 760, padding: '48px 24px', lineHeight: 1.8 }}>
    <a href="/">Back to Settle</a>
    <h1>{page === 'privacy' ? 'Privacy notice' : page === 'terms' ? 'Terms of use' : 'Continue with Google'}</h1>
    {page === 'google-signin' ? <>
      <p>Google shares your name, email and account identifier with Settle to create or access your account. We do not request Gmail, Drive or contacts access.</p>
      <label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /> I am at least 18, reside in the United States, agree to the <a href="/terms">Terms</a> and have read the <a href="/privacy">Privacy notice</a>.</label>
      <p><button className="w-btn w-btn-ink" disabled={!accepted} onClick={() => { window.location.href = '/api/auth/google/start?accepted=1'; }}>Continue with Google</button></p>
    </> : <>
      <p>Effective November 7, 2026. Settle is operated by Anthony Zhou in Maryland, United States. Contact: <a href="mailto:Az040205@gmail.com">Az040205@gmail.com</a>.</p>
      {page === 'privacy' ? <>
        <h2>Information we process</h2>
        <p>We process your name, email, account identifiers, password hash when applicable, and the financial records and messages you choose to enter. Google sign-in adds a Google account identifier. Google tokens are used to validate sign-in and are not stored as account credentials.</p>
        <h2>Purpose and service providers</h2>
        <p>We use this information to provide your account, display your records, answer requests, prevent abuse and provide support. Hosting, database and email providers process information needed to run the service, including Vercel, Render, Supabase and Resend. Google processes its own sign-in flow under its privacy policy.</p>
        <p>If you use Ask, your prompt and relevant account context may be sent to the configured AI provider to generate a response. Avoid entering secrets or information you do not want processed this way. AI responses may be inaccurate. Settle does not sell your personal information or use Google account information for advertising.</p>
        <h2>Cookies and device storage</h2>
        <p>We use an essential session cookie to keep you signed in, a short-lived Google sign-in cookie, and browser storage for account display and preferences. Hosting services may process IP addresses and operational logs for security and service delivery.</p>
        <h2>Retention and your choices</h2>
        <p>Account information is retained while your account is active and as needed to operate the service. To request access, correction or deletion, email support from your account address. We verify ownership and review associated records before removal. Records needed for security, disputes or legal obligations may be retained; backup copies may persist until their normal rotation. Contact us for the status and scope of a request.</p>
        <p>You can disconnect Google in Account access after setting a Settle password. Disconnecting Google does not delete your Settle records. You can also manage Settle access through your Google Account.</p>
        <h2>Audience and changes</h2>
        <p>Settle is intended for U.S. residents aged 18 or older. Contact support if an underage person has created an account. Material changes to this notice will be reflected here with a revised effective date.</p>
      </> : <>
        <h2>Eligibility and accounts</h2>
        <p>You must be at least 18 and reside in the United States to use Settle. Provide accurate account information, protect your sign-in credentials and report unauthorized access to support.</p>
        <h2>What Settle provides</h2>
        <p>Settle provides budgeting tools, user-entered financial records and informational assistance. Displayed wallet and ledger entries do not establish a bank account or custody of your money. Settle does not provide investment, tax or legal advice. Verify calculations, AI responses and external information before making decisions.</p>
        <h2>Responsible use and availability</h2>
        <p>Do not access another person's records, interfere with service security, upload unlawful content or misrepresent transactions. The service may be interrupted or changed; maintain your own copies of important records. We may restrict access to address abuse or security concerns.</p>
        <h2>Your information and leaving</h2>
        <p>You retain rights in information you provide and permit its processing to deliver the service as described in the Privacy notice. You may stop using Settle or request account deletion through support. These terms do not exclude rights that applicable law makes nonwaivable.</p>
      </>}
    </>}
    <p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/account-access">Account access and data requests</a></p>
  </main>
  <SiteFooter variant="full" boot={null} session={null} />
</div>;
}
