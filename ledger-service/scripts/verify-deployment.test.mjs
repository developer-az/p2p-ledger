import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyDeployment } from './verify-deployment.mjs';
const options = { url:'https://ledger.example', key:'test-'.padEnd(40,'x'), attempts:2, intervalMs:0, sleep:async()=>{}, log:()=>{} };
test('health alone is insufficient when the workflow route is missing', async()=> {
  await assert.rejects(verifyDeployment({...options, fetchImpl:async()=>new Response('{}',{status:404})}), /not verified/);
});
test('waits for a compatible workflow endpoint and sends the service key', async()=> {
  let calls=0;
  await verifyDeployment({...options, fetchImpl:async(url,init)=>{ assert.ok(url.endsWith('/v1/capabilities')); assert.equal(init.headers['X-Ledger-Key'], options.key); return new Response(JSON.stringify({workflows:++calls===2?2:1})); }});
  assert.equal(calls,2);
});
test('does not accept invalid credentials as a successful rollout', async()=> {
  await assert.rejects(verifyDeployment({...options, fetchImpl:async()=>new Response('{}',{status:401})}), /not verified/);
});
test('rejects missing configuration without making a request', async()=> {
  await assert.rejects(verifyDeployment({...options,key:'',fetchImpl:()=>{throw Error('must not run');}}),/Configure/);
});
test('does not accept an HTML proxy page', async()=> {
  await assert.rejects(verifyDeployment({...options,fetchImpl:async()=>new Response('<html>not the API</html>')}),/not verified/);
});
