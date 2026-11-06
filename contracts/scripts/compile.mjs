import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import { id } from 'ethers';

export const root = fileURLToPath(new URL('..', import.meta.url));

export function compile() {
  const input = {
    language: 'Solidity',
    sources: { 'LedgerAttestation.sol': { content: fs.readFileSync(path.join(root, 'src/LedgerAttestation.sol'), 'utf8') } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'shanghai',
      metadata: { bytecodeHash: 'none' },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), {
    import: (name) => {
      const target = path.resolve(root, 'node_modules', name);
      if (!target.startsWith(path.join(root, 'node_modules') + path.sep)) return { error: 'Invalid import' };
      try { return { contents: fs.readFileSync(target, 'utf8') }; } catch { return { error: `Missing import ${name}` }; }
    },
  }));
  for (const e of output.errors ?? []) if (e.severity === 'error') throw new Error(e.formattedMessage);
  const c = output.contracts['LedgerAttestation.sol'].LedgerAttestation;
  return {
    contractName: 'LedgerAttestation', compiler: solc.version(), settings: input.settings,
    abi: c.abi, bytecode: `0x${c.evm.bytecode.object}`, deployedBytecode: `0x${c.evm.deployedBytecode.object}`,
    selectors: { anchor: id('anchor(bytes32,bytes32)').slice(0, 10), receipts: id('receipts(bytes32)').slice(0, 10) },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts/LedgerAttestation.json'), JSON.stringify(compile(), null, 2) + '\n');
  console.log('Compiled LedgerAttestation with Solidity ' + solc.version());
}
