import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function verifyDeployment({ url, key, attempts = 40, intervalMs = 15000, fetchImpl = fetch, sleep = delay, log = console.log }) {
  if (!url?.trim() || !key?.trim() || key.trim().length < 32) throw new Error('Configure LEDGER_URL and matching LEDGER_API_KEY (32+ characters) before deploying.');
  const base = new URL(url.trim());
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('LEDGER_URL must be an HTTPS service URL without embedded credentials.');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(base.href.replace(/\/$/, '') + '/v1/capabilities', {
        headers: { 'X-Ledger-Key': key.trim() }, signal: AbortSignal.timeout(10000), redirect: 'error',
      });
      if (response.ok && (await response.json()).workflows === 2) {
        log('Verified: deployed Java exposes authenticated workflow version 2.');
        return;
      }
    } catch { /* A starting service, missing route or malformed response is not ready. */ }
    if (attempt < attempts) { log(`Waiting for compatible authenticated Java service (${attempt}/${attempts}).`); await sleep(intervalMs); }
  }
  throw new Error('Render rollout was not verified. Check deployment logs, image version and matching service credentials.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyDeployment({ url: process.env.LEDGER_URL, key: process.env.LEDGER_API_KEY }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
