import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app.js';
import { JavaWorkflows, RoutedSpendLogStore } from '../src/server/java-workflows.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter, type Transfer } from '../src/server/ledger.js';
import { CompositeLedger, PracticeLedger, PRACTICE_ANTHONY } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import type { PaymentRequest } from '../src/server/payment-requests.js';

const requester='11111111-1111-4111-8111-111111111111';
const payer='22222222-2222-4222-8222-222222222222';
const outsider='33333333-3333-4333-8333-333333333333';
const id='44444444-4444-4444-8444-444444444444';
const transferId='55555555-5555-4555-8555-555555555555';
const pending: PaymentRequest={id, requesterAccountId:requester,payerAccountId:payer,amountMinor:1250,currency:'USD',memo:'Groceries',
  status:'PENDING',transferId:null,settledVia:null,declinedAttempts:0,createdAt:'2026-01-01T00:00:00Z',resolvedAt:null};
const transfer: Transfer={id:transferId,kind:'TRANSFER',sourceAccountId:payer,destinationAccountId:requester,amountMinor:1250,
  currency:'USD',memo:'Groceries',status:'COMPLETED',rejectionReason:null,createdAt:'2026-01-01T00:00:00Z'};
function setup(enforceWalletAuth=false) {
  const java=new JavaWorkflows('http://unused.test','test-key');
  const practice=new PracticeLedger();
  const live={
    getAccount:async (id:string)=>({id,ownerId:id===requester?'Requester':'Payer',currency:'USD',type:'USER',balanceMinor:5000,createdAt:'2026-01-01T00:00:00Z'}),
    getTransfer:async ()=>transfer,
    transfer:vi.fn(),
  } as unknown as LedgerReader & LedgerWriter & LedgerAuditor;
  const ledger=new CompositeLedger(live,practice,async()=>true);
  const app=createApp({ledger,practice,spendLogs:new InMemorySpendLogStore(),javaWorkflows:java,enforceWalletAuth});
  const post=(path:string,body:unknown,key='retry-key')=>app.request('/api'+path,{method:'POST',
    headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
  return {java,app,post,live};
}
describe('live Java workflows',()=>{
  it('delegates the complete split with the caller idempotency key',async()=>{
    const {java,post}=setup();
    const split=vi.spyOn(java,'split').mockResolvedValue({requests:[pending]});
    const body={requesterAccountId:requester,payers:[{accountId:payer,amountMinor:1250}],memo:'Groceries'};
    const response=await post('/requests',body);
    expect(response.status).toBe(201);
    expect(split).toHaveBeenCalledWith(body,'retry-key');
    expect((await response.json()).requests[0].amount).toBe('$12.50');
  });
  it('uses Java atomic settlement instead of a separate TypeScript transfer',async()=>{
    const {java,post,live}=setup();
    vi.spyOn(java,'get').mockResolvedValue(pending);
    const pay=vi.spyOn(java,'pay').mockResolvedValue({request:{...pending,status:'PAID',transferId},transfer});
    const result=await post(`/requests/${id}/pay`,{accountId:payer});
    expect(result.status).toBe(200);
    expect(pay).toHaveBeenCalledWith(id,payer,'retry-key');
    expect(live.transfer).not.toHaveBeenCalled();
  });
  it('does not forward a request action from a different actor',async()=>{
    const {java,post}=setup();
    vi.spyOn(java,'get').mockResolvedValue(pending);
    const pay=vi.spyOn(java,'pay');
    expect((await post(`/requests/${id}/pay`,{accountId:outsider})).status).toBe(403);
    expect(pay).not.toHaveBeenCalled();
  });
  it('does not return an empty live request list when Java is unavailable',async()=>{
    const {java,app}=setup();
    vi.spyOn(java,'list').mockRejectedValue(new LedgerError(503,'Unavailable'));
    expect((await app.request(`/api/requests?accountId=${requester}`)).status).toBe(503);
  });
  it('requires wallet authorization before forwarding a CSV',async()=>{
    const {java,post}=setup(true);
    const imported=vi.spyOn(java,'importSpends');
    expect((await post(`/accounts/${requester}/spends/import`,{csv:'date,amount\n2026-01-01,1.00\n'})).status).toBe(401);
    expect(imported).not.toHaveBeenCalled();
  });
  it('refuses chain proofs for a nonparticipant',async()=>{
    const {java,app}=setup();
    const receipt=vi.spyOn(java,'receipt');
    expect((await app.request(`/api/transfers/${transferId}/receipt?accountId=${outsider}`)).status).toBe(403);
    expect(receipt).not.toHaveBeenCalled();
  });
  it('forwards CSV imports and preserves their inserted/duplicate counts',async()=>{
    const {java,post}=setup();
    const imported=vi.spyOn(java,'importSpends').mockResolvedValue({imported:2,duplicates:1,rows:3});
    const csv='date,amount\n2026-01-01,1.00\n';
    const result=await post(`/accounts/${requester}/spends/import`,{csv,timeZone:'America/New_York'});
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({imported:2,duplicates:1,rows:3});
    expect(imported).toHaveBeenCalledWith(requester,csv,'America/New_York');
  });
  it('preserves Java validation errors instead of turning a bad CSV into a server error',async()=>{
    const {java,post}=setup();
    vi.spyOn(java,'importSpends').mockRejectedValue(new LedgerError(400,'CSV needs date and amount headers'));
    const response=await post(`/accounts/${requester}/spends/import`,{csv:'wrong,headers\n1,2\n'});
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({error:'CSV needs date and amount headers'});
  });
  it('reports a transport outage as unavailable and never acknowledges a lost write',async()=>{
    const failed=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new TypeError('fetch failed'));
    try {
      const java=new JavaWorkflows('http://unused.test','test-key');
      await expect(java.request('GET','/v1/requests')).rejects.toMatchObject({status:503});
    } finally { failed.mockRestore(); }
  });
  it('practice wallets continue to log without Java and live failures never become memory writes',async()=>{
    const memory=new InMemorySpendLogStore();
    const java=new JavaWorkflows('http://unused.test','test-key');
    const remote=vi.spyOn(java,'request').mockRejectedValue(new LedgerError(503,'Unavailable'));
    const store=new RoutedSpendLogStore(memory,java,id=>id===PRACTICE_ANTHONY);
    await store.record(PRACTICE_ANTHONY,{amountMinor:100,category:'other'});
    expect(remote).not.toHaveBeenCalled();
    await expect(store.record(requester,{amountMinor:100,category:'other'},new Date(),'expense-retry')).rejects.toThrow('Unavailable');
    expect(remote).toHaveBeenCalledWith('POST',`/v1/accounts/${requester}/spends`,{amountMinor:100,category:'other'},'expense-retry');
    expect(await memory.list(requester)).toEqual([]);
  });
});

it('treats an old Java deployment missing workflow routes as unavailable', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    detail: 'No static resource v1/accounts/private-account/spends.',
  }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
  try {
    await expect(new JavaWorkflows('https://ledger.example', 'test-key').request('GET', '/v1/accounts/test/spends'))
      .rejects.toMatchObject({ status: 503, message: 'Your wallet connection is unavailable. Try again shortly.' });
  } finally { fetchMock.mockRestore(); }
});

it('refuses an incompatible workflow version before provisioning', async () => {
  const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ workflows: 1 }), { status: 200 }));
  try { await expect(new JavaWorkflows('https://ledger.example', 'test-key').assertReady()).rejects.toMatchObject({ status: 503 }); }
  finally { mock.mockRestore(); }
});
