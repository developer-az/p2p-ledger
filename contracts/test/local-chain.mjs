import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import config from '../hardhat.config.js';

export async function localChain() {
  const hre = await createHardhatRuntimeEnvironment(config);
  return hre.network.create('local');
}
export async function localChainServer() {
  const hre = await createHardhatRuntimeEnvironment(config);
  return hre.network.createServer('local', '127.0.0.1', 0);
}
