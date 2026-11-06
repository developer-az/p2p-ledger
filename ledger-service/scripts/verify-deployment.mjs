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

export async function waitForRenderDeploy({ apiKey, serviceId, deployId, attempts = 60, intervalMs = 10000, fetchImpl = fetch, sleep = delay, log = console.log }) {
  if (!apiKey?.trim() || !/^srv-[a-z0-9]+$/.test(serviceId ?? '') || !/^dep-[a-z0-9]+$/.test(deployId ?? '')) throw new Error('Valid Render credentials, service ID and deploy ID are required.');
  for (let attempt=1; attempt<=attempts; attempt++) {
    const response=await fetchImpl(`https://api.render.com/v1/services/${serviceId}/deploys/${deployId}`, { headers:{Authorization:'Bearer '+apiKey.trim()}, signal:AbortSignal.timeout(10000), redirect:'error' });
    if (!response.ok) throw new Error('Cannot verify Render deploy status: '+response.status);
    const {status}=await response.json();
    if (status==='live') { log('Verified: requested Render deploy is live.'); return; }
    if (['build_failed','update_failed','pre_deploy_failed','canceled','deactivated'].includes(status)) throw new Error('Requested Render deploy failed or was superseded.');
    if (attempt<attempts) { log(`Waiting for requested Render deploy (${attempt}/${attempts}).`); await sleep(intervalMs); }
  }
  throw new Error('Requested Render deploy did not become live before the deadline.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async()=>{ if(process.env.RENDER_DEPLOY_ID) await waitForRenderDeploy({apiKey:process.env.RENDER_API_KEY,serviceId:process.env.RENDER_SERVICE_ID,deployId:process.env.RENDER_DEPLOY_ID}); await verifyDeployment({ url: process.env.LEDGER_URL, key: process.env.LEDGER_API_KEY }); })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
