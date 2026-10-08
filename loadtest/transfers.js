// k6 load test for the ledger API.
//
//   k6 run -e BASE_URL=http://localhost:8080 -e RATE=200 -e ACCOUNTS=200 loadtest/transfers.js
//
// ACCOUNTS controls contention: transfers pick two random accounts, so fewer accounts means
// more requests queue on the same row locks. ~10% of requests replay an earlier idempotency
// key to measure the replay path. Run the service with relaxed fraud limits (see README),
// otherwise the velocity rule declines most of the traffic.
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:8080';
const RATE = parseInt(__ENV.RATE || '200');
const DURATION = __ENV.DURATION || '60s';
const ACCOUNTS = parseInt(__ENV.ACCOUNTS || '200');
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const completed = new Counter('transfers_completed');
const rejected = new Counter('transfers_rejected');
const replayed = new Counter('transfers_replayed');

export const options = {
  scenarios: {
    transfers: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.max(50, RATE),
      maxVUs: RATE * 4,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:transfer}': ['p(99)<1000'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const ids = [];
  for (let i = 0; i < ACCOUNTS; i++) {
    const res = http.post(`${BASE}/v1/accounts`, JSON.stringify({ ownerId: `load-${i}`, currency: 'USD' }),
      { headers: JSON_HEADERS });
    const id = res.json('id');
    http.post(`${BASE}/v1/accounts/${id}/deposits`, JSON.stringify({ amountMinor: 100000000 }),
      { headers: { ...JSON_HEADERS, 'Idempotency-Key': `seed-${id}` } });
    ids.push(id);
  }
  return { ids, runId: Date.now() };
}

export default function (data) {
  const { ids, runId } = data;
  const from = ids[Math.floor(Math.random() * ids.length)];
  let to = from;
  while (to === from) {
    to = ids[Math.floor(Math.random() * ids.length)];
  }
  // Replays reuse the key and body of this VU's previous iteration.
  const replay = __ITER > 0 && Math.random() < 0.1;
  const iter = replay ? __ITER - 1 : __ITER;
  const key = `${runId}-${__VU}-${iter}`;
  const body = replay && globalThis.lastBody ? globalThis.lastBody
    : JSON.stringify({ sourceAccountId: from, destinationAccountId: to,
      amountMinor: 1 + Math.floor(Math.random() * 500), currency: 'USD' });

  const res = http.post(`${BASE}/v1/transfers`, body,
    { headers: { ...JSON_HEADERS, 'Idempotency-Key': key }, tags: { name: 'transfer' } });
  check(res, { 'accepted (201 or replay 200)': (r) => r.status === 201 || r.status === 200 });

  if (res.status === 200) replayed.add(1);
  else if (res.status === 201 && res.json('status') === 'COMPLETED') completed.add(1);
  else if (res.status === 201) rejected.add(1);
  if (!replay) globalThis.lastBody = body;
}
