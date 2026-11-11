# Security policy

Settle is a solo-operated, open-source personal ledger project. I welcome reports about the
code in this repository and the hosted deployment.

## Supported versions

Only the `main` branch is supported. Fixes go to `main`; older commits, forks, and unmerged
branches are not maintained.

## Reporting a vulnerability

Do **not** open a public issue for a vulnerability. Report it privately through GitHub:

**https://github.com/developer-az/p2p-ledger/security/advisories/new**

That private advisory is the only security contact. General, non-security questions can go to
[GitHub Issues](https://github.com/developer-az/p2p-ledger/issues).

## What to include

- What the problem is and why it matters.
- The affected URL, endpoint, file, or component.
- Steps to reproduce it, with the smallest example you can give.
- The impact you believe it has.
- Any proof of concept, logs, or screenshots that help explain it.
- Your GitHub handle if you want credit.

Use a test account and test data. Do not include another person's personal or financial
information in a report. If you accidentally reach real data, stop, do not download or share
it, and say what happened in the advisory.

## Response targets

- Acknowledge a report within 7 days.
- Give an initial assessment or ask follow-up questions within 14 days.
- Share a fix or mitigation plan when I have one.

This is a solo project, so these are targets rather than a service-level guarantee. I will not
publish details of a report before a fix is available unless there is a clear need to warn
users.

## Safe harbor for good-faith research

I consider good-faith security research authorized when it follows this policy. I will not
pursue legal action over accidental access that you report promptly, do not use beyond
confirming the issue, do not store longer than needed, and do not share with others. This
statement does not bind third parties, does not authorize activity against services I do not
control, and does not waive any right that cannot be waived.

## Out of scope

- Social engineering, phishing, or attempts to trick the operator or users.
- Denial-of-service or stress testing, including volumetric traffic and resource exhaustion.
- Physical attacks or access to devices and accounts you do not own.
- Vulnerabilities in third-party services (Vercel, Render, Supabase, Resend, Google, OpenRouter,
  Have I Been Pwned). Report those to the provider.
- Reports that only show missing hardening headers, missing SPF/DMARC on unrelated domains, or
  automated scanner output without a demonstrated impact.
- Findings that require a compromised browser, a rooted device, or an already stolen password
  or session, unless the finding shows how the compromise escalates.
