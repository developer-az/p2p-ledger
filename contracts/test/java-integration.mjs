import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { localChainServer } from './local-chain.mjs';
import { ContractFactory, JsonRpcProvider, sha256, toUtf8Bytes } from 'ethers';
import { compile } from '../scripts/compile.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));
async function unusedPort() {
  const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address(); await new Promise(r => server.close(r)); return port;
}
function docker(...args) { return execFileSync('docker', args, { encoding: 'utf8', timeout: 60000 }).trim(); }

test('Java request settlement produces a verifiable on-chain receipt and survives a JVM restart', { timeout: 240000 }, async () => {
  const jar = new URL('../../ledger-service/target/ledger-service-0.1.0.jar', import.meta.url);
  assert.ok(fs.existsSync(jar), 'Build ledger-service with mvnw package before this integration test');
  // Windows' Oracle javapath launcher is a shim: killing it can leave the actual JVM behind.
  const settings=spawnSync('java',['-XshowSettings:properties','-version'],{encoding:'utf8',windowsHide:true});
  const javaHome=/^\s*java.home = (.+)\r?$/m.exec(settings.stderr)?.[1]?.trim();
  assert.ok(javaHome,'Could not resolve the actual Java home');
  const javaExecutable=path.join(javaHome,'bin',process.platform==='win32'?'java.exe':'java');
  const chain = await localChainServer();
  let database, app, provider;
  let logs = '';
  try {
    const chainAddress = await chain.listen();
    const rpcUrl = `http://127.0.0.1:${chainAddress.port}`;
    provider = new JsonRpcProvider(rpcUrl);
    const [admin, relayer, pauser] = await Promise.all([0, 1, 2].map(i => provider.getSigner(i)));
    const artifact = compile();
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode, admin)
      .deploy(await admin.getAddress(), await relayer.getAddress(), await pauser.getAddress(), 86400);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    const apiKey = randomBytes(32).toString('hex');
    const dbPassword = randomBytes(24).toString('hex');
    database = docker('run', '--rm', '-d', '--label', 'p2p-ledger.test=chain-integration', '-p', '127.0.0.1::5432', '-e', 'POSTGRES_USER=ledger',
      '-e', `POSTGRES_PASSWORD=${dbPassword}`, '-e', 'POSTGRES_DB=ledger', 'postgres:17-alpine');
    const dbPort = JSON.parse(docker('inspect', database))[0].NetworkSettings.Ports['5432/tcp'][0].HostPort;
    const port = await unusedPort();
    const env = { ...process.env,
      PORT: String(port), DATABASE_URL: `jdbc:postgresql://127.0.0.1:${dbPort}/ledger`,
      DATABASE_USERNAME: 'ledger', DATABASE_PASSWORD: dbPassword, EVENTS_SINK: 'log',
      LEDGER_API_KEY: apiKey, CHAIN_ENABLED: 'true', CHAIN_ID: '31337', CHAIN_NAMESPACE: 'integration',
      CHAIN_RPC_URL: rpcUrl, CHAIN_SIGNER_RPC_URL: rpcUrl, CHAIN_CONTRACT_ADDRESS: address,
      CHAIN_RUNTIME_SHA256: sha256(await provider.getCode(address)), CHAIN_RELAYER_ADDRESS: await relayer.getAddress(),
      CHAIN_FINALITY_TAG: 'latest', CHAIN_POLL_INTERVAL_MS: '250',
    };
    async function start() {
      logs = '';
      app = spawn(javaExecutable, ['-jar', fs.realpathSync(jar)], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      app.stdout.on('data', b => { logs = (logs + b).slice(-10000); });
      app.stderr.on('data', b => { logs = (logs + b).slice(-10000); });
      for (let i = 0; i < 180; i++) {
        if (app.exitCode !== null) throw new Error(`Java exited: ${logs}`);
        try { if ((await fetch(`http://127.0.0.1:${port}/actuator/health`)).ok) return; } catch { }
        await wait(500);
      }
      throw new Error(`Java startup timeout: ${logs}`);
    }
    async function stop() {
      if (!app || app.exitCode !== null || app.signalCode !== null) { app=null; return; }
      const exited = new Promise(resolve => app.once('exit', resolve)); app.kill(); await exited; app=null;
    }
    const url = `http://127.0.0.1:${port}`;
    async function request(method, path, body, key = randomUUID()) {
      const res = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', 'X-Ledger-Key': apiKey, 'Idempotency-Key': key },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const value = await res.json();
      assert.ok(res.ok, `${method} ${path}: ${JSON.stringify(value)}; ${logs}`); return value;
    }
    await start();
    assert.equal((await fetch(url + '/v1/requests?accountId=' + randomUUID())).status, 401);
    const requester = await request('POST', '/v1/accounts', { ownerId: 'integration-requester', currency: 'USD' });
    const payer = await request('POST', '/v1/accounts', { ownerId: 'integration-payer', currency: 'USD' });
    const csv='date,amount,category,note,transactionId\n2026-01-01,12.50,groceries,Weekly groceries,IMPORT-1\n';
    assert.equal((await request('POST', `/v1/accounts/${payer.id}/spends/import`, {csv})).imported,1);
    assert.equal((await request('POST', `/v1/accounts/${payer.id}/spends/import`, {csv})).duplicates,1);
    await request('POST', `/v1/accounts/${payer.id}/deposits`, { amountMinor: 10000 });
    const split = { requesterAccountId: requester.id, payers: [{ accountId: payer.id, amountMinor: 1250 }], memo: 'Weekly groceries' };
    const batch = await request('POST', '/v1/requests', split, 'one-split');
    assert.equal((await request('POST', '/v1/requests', split, 'one-split')).requests[0].id, batch.requests[0].id);
    const payment = await request('POST', `/v1/requests/${batch.requests[0].id}/pay`, { accountId: payer.id }, 'one-payment');
    assert.equal(payment.request.status, 'PAID');
    let proof;
    for (let i = 0; i < 80; i++) {
      proof = await request('GET', `/v1/transfers/${payment.transfer.id}/receipt`);
      if (proof.status === 'FINALIZED') break;
      if (proof.status === 'FAILED') throw new Error(`Relay failed: ${proof.lastError}; ${logs}`);
      if (proof.lastError) throw new Error(`Unexpected relay error: ${proof.lastError}; ${logs}`);
      await wait(500);
    }
    assert.equal(proof.status, 'FINALIZED', JSON.stringify(proof) + '\nJava logs:\n' + logs);
    assert.equal(sha256(toUtf8Bytes(proof.preimage)), proof.commitment);
    assert.equal((await contract.receipts(proof.transferKey)).commitment, proof.commitment);
    assert.match(proof.transactionHash, /^0x[0-9a-f]{64}$/i);
    await stop(); await start();
    const replay = await request('POST', `/v1/requests/${batch.requests[0].id}/pay`, { accountId: payer.id }, 'one-payment');
    assert.equal(replay.transfer.id, payment.transfer.id);
    assert.equal((await request('GET', `/v1/accounts/${payer.id}`)).balanceMinor, 8750);
    assert.equal((await request('GET', `/v1/accounts/${requester.id}`)).balanceMinor, 1250);
    assert.equal((await request('GET', `/v1/accounts/${payer.id}/spends`)).length,1);
    assert.equal((await request('GET', `/v1/transfers/${payment.transfer.id}/receipt`)).commitment, proof.commitment);
    assert.equal((await contract.queryFilter(contract.filters.TransferAnchored(proof.transferKey))).length, 1);
    await stop();
  } finally {
    if (app && app.exitCode === null && app.signalCode === null) {
      const exited = new Promise(r => app.once('exit', r)); app.kill(); await exited;
    }
    if (database) docker('stop', database);
    provider?.destroy();
    await chain.close();
  }
});
