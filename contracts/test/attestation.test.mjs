import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { localChain } from './local-chain.mjs';
import { BrowserProvider, ContractFactory, id, ZeroAddress, ZeroHash, sha256, toUtf8Bytes } from 'ethers';
import { compile } from '../scripts/compile.mjs';

const artifact = compile();
let transport, provider, admin, relayer, pauser, outsider, contract, connection;
before(async () => {
  connection = await localChain();
  transport = connection.provider;
  provider = new BrowserProvider(transport);
  [admin, relayer, pauser, outsider] = await Promise.all([0, 1, 2, 3].map(i => provider.getSigner(i)));
  contract = await new ContractFactory(artifact.abi, artifact.bytecode, admin)
    .deploy(await admin.getAddress(), await relayer.getAddress(), await pauser.getAddress(), 86400);
  await contract.waitForDeployment();
});
after(async () => { provider?.destroy(); await connection?.close(); });

async function customError(promise, expected) {
  await assert.rejects(promise, error => {
    assert.equal(error.revert?.name, expected, error.message);
    return true;
  });
}

test('ABI selectors match the Java integration', () => {
  const java = fs.readFileSync(new URL('../../ledger-service/src/main/java/io/github/developeraz/ledger/chain/EthereumRpc.java', import.meta.url), 'utf8');
  assert.ok(java.includes(`ANCHOR_SELECTOR = "${artifact.selectors.anchor}"`));
  assert.ok(java.includes(`RECEIPTS_SELECTOR = "${artifact.selectors.receipts}"`));
  assert.ok(java.includes(`ANCHORED_TOPIC = "${id('TransferAnchored(bytes32,bytes32)')}"`));
});

test('records a receipt and an independently verifiable SHA-256 commitment', async () => {
  const key = id('completed-transfer');
  const preimage = 'private ledger data\nrandom salt';
  const commitment = sha256(toUtf8Bytes(preimage));
  const receipt = await (await contract.connect(relayer).anchor(key, commitment)).wait();
  const stored = await contract.receipts(key);
  assert.equal(stored.commitment, commitment);
  assert.equal(stored.blockNumber, BigInt(receipt.blockNumber));
  const event = contract.interface.parseLog(receipt.logs[0]);
  assert.equal(event.name, 'TransferAnchored');
  assert.equal(event.args.transferKey, key);
  assert.equal(event.args.commitment, commitment);
});

test('identical retry cannot rewrite the block or emit a second receipt', async () => {
  const key = id('retry'); const commitment = id('payload');
  await (await contract.connect(relayer).anchor(key, commitment)).wait();
  const before = await contract.receipts(key);
  const replay = await (await contract.connect(relayer).anchor(key, commitment)).wait();
  assert.equal(replay.logs.length, 0);
  assert.deepEqual([...(await contract.receipts(key))], [...before]);
});

test('conflicting retry fails, including when sent by an authorized relayer', async () => {
  const key = id('conflict');
  await (await contract.connect(relayer).anchor(key, id('original'))).wait();
  await customError(contract.connect(relayer).anchor.staticCall(key, id('modified')), 'ConflictingReceipt');
  assert.equal((await contract.receipts(key)).commitment, id('original'));
});

test('outsiders and the administrator cannot anchor without the relayer role', async () => {
  for (const signer of [outsider, admin]) {
    await customError(contract.connect(signer).anchor.staticCall(id('unauthorized'), id('payload')), 'AccessControlUnauthorizedAccount');
  }
});

test('rejects zero keys and commitments', async () => {
  await customError(contract.connect(relayer).anchor.staticCall(ZeroHash, id('payload')), 'InvalidReceipt');
  await customError(contract.connect(relayer).anchor.staticCall(id('key'), ZeroHash), 'InvalidReceipt');
});

test('pause stops writes and the incident responder cannot unpause', async () => {
  await (await contract.connect(pauser).pause()).wait();
  await customError(contract.connect(relayer).anchor.staticCall(id('paused'), id('payload')), 'EnforcedPause');
  await customError(contract.connect(pauser).unpause.staticCall(), 'AccessControlUnauthorizedAccount');
  assert.equal((await contract.receipts(id('retry'))).commitment, id('payload'));
  await (await contract.unpause()).wait();
});

test('role revocation immediately stops the former relayer', async () => {
  const role = await contract.RELAYER_ROLE();
  await (await contract.revokeRole(role, await relayer.getAddress())).wait();
  await customError(contract.connect(relayer).anchor.staticCall(id('revoked'), id('payload')), 'AccessControlUnauthorizedAccount');
  await (await contract.grantRole(role, await relayer.getAddress())).wait();
});

test('arbitrary keys retain immutable commitments across retries', async () => {
  // A bounded property sweep against a real EVM; no handcrafted key special cases.
  for (let i = 0; i < 24; i++) {
    const key = id(`property-key-${i}`); const value = id(`property-value-${i}`);
    await (await contract.connect(relayer).anchor(key, value)).wait();
    await contract.connect(relayer).anchor.staticCall(key, value);
    await customError(contract.connect(relayer).anchor.staticCall(key, id(`wrong-${i}`)), 'ConflictingReceipt');
    assert.equal((await contract.receipts(key)).commitment, value);
  }
});

test('constructor rejects a zero relayer or pauser', async () => {
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, admin);
  await assert.rejects(factory.deploy(await admin.getAddress(), ZeroAddress, await pauser.getAddress(), 86400));
  await assert.rejects(factory.deploy(await admin.getAddress(), await relayer.getAddress(), ZeroAddress, 86400));
});

test('contract refuses native currency transfers', async () => {
  await assert.rejects(outsider.sendTransaction({ to: await contract.getAddress(), value: 1n }));
});

test('admin transfer requires both the delay and acceptance by the proposed admin', async () => {
  const successor = await outsider.getAddress();
  await (await contract.beginDefaultAdminTransfer(successor)).wait();
  await customError(contract.connect(outsider).acceptDefaultAdminTransfer.staticCall(), 'AccessControlEnforcedDefaultAdminDelay');
  await transport.request({ method: 'evm_increaseTime', params: [86401] });
  await transport.request({ method: 'evm_mine', params: [] });
  await (await contract.connect(outsider).acceptDefaultAdminTransfer()).wait();
  assert.equal(await contract.defaultAdmin(), successor);
  assert.equal(await contract.hasRole(ZeroHash, await admin.getAddress()), false);
});
