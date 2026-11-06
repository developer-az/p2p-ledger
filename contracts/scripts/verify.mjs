import fs from 'node:fs';
import { Contract, JsonRpcProvider, getAddress, sha256, toUtf8Bytes } from 'ethers';

const required=name=>{ if(!process.env[name]) throw new Error(`Set ${name} from the trusted deployment manifest`); return process.env[name]; };
if(!process.argv[2]) throw new Error('Usage: npm run verify -- receipt.json');
const proof=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const address=getAddress(required('CHAIN_CONTRACT_ADDRESS'));
const chainId=BigInt(required('CHAIN_ID'));
const namespace=required('CHAIN_NAMESPACE');
if(getAddress(proof.contractAddress)!==address || BigInt(proof.chainId)!==chainId) throw new Error('Receipt targets a different deployment');
if(sha256(toUtf8Bytes(proof.preimage))!==proof.commitment) throw new Error('Commitment does not match the downloaded preimage');
if(proof.preimage.split('\n')[0]!=='p2p-ledger/receipt/v1' || proof.preimage.split('\n')[1]!==proof.transferId) throw new Error('Invalid receipt format');
if(sha256(toUtf8Bytes(`p2p-ledger/key/v1\n${namespace}\n${proof.transferId}`))!==proof.transferKey) throw new Error('Transfer key mismatch');
const provider=new JsonRpcProvider(required('CHAIN_RPC_URL'));
try {
  if((await provider.getNetwork()).chainId!==chainId) throw new Error('RPC is on the wrong chain');
  const tag=chainId===31337n && process.env.CHAIN_FINALITY_TAG==='latest'?'latest':'finalized';
  if(sha256(await provider.getCode(address,tag))!==required('CHAIN_RUNTIME_SHA256').toLowerCase()) throw new Error('Runtime fingerprint mismatch');
  const contract=new Contract(address,['function receipts(bytes32) view returns (bytes32 commitment,uint64 blockNumber)'],provider);
  const receipt=await contract.receipts(proof.transferKey,{blockTag:tag});
  if(receipt.commitment!==proof.commitment) throw new Error('Receipt is not finalized on this contract');
  const transaction=await provider.getTransactionReceipt(proof.transactionHash);
  if(!transaction || transaction.status!==1 || BigInt(transaction.blockNumber)!==receipt.blockNumber || getAddress(transaction.to)!==address)
    throw new Error('Transaction does not match the canonical receipt');
  const block=await provider.getBlock(transaction.blockNumber);
  if(block.hash!==transaction.blockHash) throw new Error('Transaction was reorganized out');
  console.log(`Verified transfer ${proof.transferId} on chain ${chainId}, block ${receipt.blockNumber}.`);
} finally { provider.destroy(); }
