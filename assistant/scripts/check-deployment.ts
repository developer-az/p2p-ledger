/** Read-only capability check. Never needs a password or prints credentials. */
const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) throw new Error('Usage: npm run check:deployment -- https://YOUR_PREVIEW_HOST');
const response = await fetch(base + '/api/bootstrap', { signal: AbortSignal.timeout(30_000), redirect: 'manual' });
if (response.status >= 300 && response.status < 400) throw new Error('Deployment access is protected or redirected. Authenticate through Vercel before checking the app.');
if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The deployment returned a page instead of the API. Check Vercel deployment protection and API routing.');
if (!response.ok) throw new Error(`Bootstrap returned ${response.status}`);
const data = await response.json() as { identity?: { signupAvailable?: boolean; signinAvailable?: boolean; passwordResetAvailable?: boolean } };
const identity = data.identity;
for (const [label, enabled] of [['Signup', identity?.signupAvailable], ['Sign in', identity?.signinAvailable], ['Reset email', identity?.passwordResetAvailable]] as const)
  console.log(`${label}: ${enabled === true ? 'AVAILABLE' : 'UNAVAILABLE / not advertised'}`);
if (!identity?.signupAvailable || !identity?.passwordResetAvailable) {
  console.log('Preview setup requires an isolated database, compatible Java backend and service key, plus Resend sender configuration. See docs/DEVELOPMENT.md.');
  process.exitCode = 1;
}
export {};
