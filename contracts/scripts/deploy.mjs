import fs from 'node:fs';
import path from 'node:path';
import { ContractFactory, JsonRpcProvider, getAddress, sha256 } from 'ethers';
import { compile, root } from './compile.mjs';

// Use an authenticated remote signer / hardware-backed gateway; no deployer keys in this repository.
const required = (name) => { if (!process.env[name]) throw new Error(`Set ${name}`); return process.env[name]; };
const provider = new JsonRpcProvider(required('CHAIN_SIGNER_RPC_URL'));
const expectedChain = BigInt(required('CHAIN_ID'));
if ((await provider.getNetwork()).chainId !== expectedChain) throw new Error('Wrong chain');
const signer = await provider.getSigner(getAddress(required('CHAIN_DEPLOYER_ADDRESS')));
const admin = getAddress(required('CHAIN_ADMIN_ADDRESS'));
const relayer = getAddress(required('CHAIN_RELAYER_ADDRESS'));
const pauser = getAddress(required('CHAIN_PAUSER_ADDRESS'));
const delay = BigInt(required('CHAIN_ADMIN_DELAY_SECONDS'));
if (delay < 86400n && expectedChain !== 31337n) throw new Error('Production admin delay must be at least one day');
const artifact = compile();
const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(admin, relayer, pauser, delay);
await contract.waitForDeployment();
const receipt = await contract.deploymentTransaction().wait();
const address = await contract.getAddress();
const code = await provider.getCode(address);
const manifest = {
  chainId: expectedChain.toString(), address, admin, relayer, pauser, adminDelaySeconds: delay.toString(),
  deploymentTransaction: receipt.hash, deploymentBlock: receipt.blockNumber,
  runtimeSha256: sha256(code), compiler: artifact.compiler, settings: artifact.settings,
};
fs.mkdirSync(path.join(root, 'deployments'), { recursive: true });
fs.writeFileSync(path.join(root, `deployments/${expectedChain}-${address}.json`), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(manifest, null, 2));
provider.destroy();
