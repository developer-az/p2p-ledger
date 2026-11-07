# Google sign-in setup

Status (2026-11-07): deployed and enabled in Production. Owner confirmed successful Google signup. Privacy/terms and password-confirmed Google disconnection are live; account deletion/data requests are handled manually through support with ownership verification. The checklist below remains useful for future deployments.

1. Create/select an owner-controlled project at https://console.cloud.google.com/ and configure Google Auth Platform branding, audience and contact information.
2. Configure a Web application OAuth client. Authorized redirect URI must be exactly `https://ledger.anthony-zhou.com/api/auth/google/callback`. Use separate clients for development and production. Do not authorize arbitrary preview domains.
3. Store the client ID as `GOOGLE_CLIENT_ID` and client secret as `GOOGLE_CLIENT_SECRET` in Vercel Production only. Keep `APP_URL=https://ledger.anthony-zhou.com`. Do not put secrets in VITE variables or repository files.
4. Before enabling: publish accurate privacy and terms pages linked from the homepage and consent screen; supply the actual operator/contact, retention/deletion process, processors, security and user-rights information. Determine jurisdiction and age restrictions with the operator. Do not treat this implementation as a certification of legal compliance.
5. Complete disconnect/account deletion UX and define recovery behavior for Google-only accounts before public launch. The subject mapping cascades on identity deletion, but this is not a full ledger/account deletion workflow. Review retention obligations before deleting financial records.
6. Run real-provider tests: fresh signup, repeat login, denial/cancel, expired/replayed flow, wrong audience, unavailable ledger, same-email existing account, explicit linking and signout. Verify a failure between provisioning and subject linking can be recovered through password reset before retrying linking.
7. Set `GOOGLE_AUTH_ENABLED=true` only after these requirements are complete and deploy. Without this explicit flag and credentials the button/routes remain unavailable.

Implementation requests only `openid email profile`. It persists the Google subject-to-user mapping and normal account name/email, not Google access/refresh/ID tokens or profile pictures. Existing password accounts are never automatically linked by email; sign in with the existing credential, then choose Connect Google. Normal app cookies/sessions remain in use. OAuth flow cookies last ten minutes and use HttpOnly, Secure, SameSite=Lax. Callback uses a fixed HTTPS origin, signed state cookie, nonce, PKCE, verified JWT signatures/issuer/audience/expiry and single-use code throttling.

References: https://developers.google.com/identity/protocols/oauth2/policies and https://developers.google.com/identity/openid-connect/openid-connect . Google API keys used for Gemini are not OAuth client credentials.
