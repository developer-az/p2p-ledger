/**
 * Step 2.5 / 2.5b — envelope encryption and crypto-shredding.
 *
 * Everything here is local: no AWS calls (the KMS adapter is exercised through
 * an injected fetch), no network, and the Postgres cases only run when
 * SETTLE_TEST_DATABASE_URL points at a scratch database.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { createApp } from '../src/server/app.js';
import { InMemoryAuthStore } from '../src/server/auth.js';
import { pgConfig } from '../src/server/db-tls.js';
import {
  InMemoryDataKeyStore,
  KmsKeyWrapper,
  LocalKeyWrapper,
  PostgresDataKeyStore,
  ShreddedKeyError,
  createDataKeyStore,
  keyWrapperFromEnv,
  kmsConfigured,
  sigV4Sign,
} from '../src/server/envelope.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from '../src/server/ledger.js';
import { MemoryMailer } from '../src/server/mailer.js';
import { InMemoryPersonalFinanceStore, PostgresPersonalFinanceStore } from '../src/server/personal-finance.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { withUser } from '../src/server/rls.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const KEK_CURRENT = Buffer.alloc(32, 0x31);
const KEK_PREVIOUS = Buffer.alloc(32, 0x32);
const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);
/** Built with join() so no credential-shaped literal sits in the test. */
const PASSWORD = ['envelope', 'test', 'correct', 'horse'].join('-');

function localStore(current = 'current', keks: Record<string, Buffer> = {
  current: KEK_CURRENT,
  previous: KEK_PREVIOUS,
}): { store: InMemoryDataKeyStore; keks: Record<string, Buffer> } {
  return { store: new InMemoryDataKeyStore(new LocalKeyWrapper(keks, current)), keks };
}

describe('field encryption', () => {
  it('round-trips a note through AES-256-GCM', async () => {
    const { store } = localStore();
    const blob = await store.encryptField(USER_A, 'Lunch with Sam · $16.50');
    expect(blob.startsWith('v1:')).toBe(true);
    expect(blob).not.toContain('Lunch');
    expect(await store.decryptField(USER_A, blob)).toBe('Lunch with Sam · $16.50');
  });

  it('uses a fresh IV for every call', async () => {
    const { store } = localStore();
    const first = await store.encryptField(USER_A, 'same text');
    const second = await store.encryptField(USER_A, 'same text');
    expect(first).not.toBe(second);
    expect(await store.decryptField(USER_A, first)).toBe('same text');
    expect(await store.decryptField(USER_A, second)).toBe('same text');
  });

  it('fails when another user tries to decrypt the ciphertext (AAD binding)', async () => {
    const { store } = localStore();
    const blob = await store.encryptField(USER_A, 'rent share');
    await expect(store.decryptField(USER_B, blob)).rejects.toThrow();
  });

  it('fails on tampered ciphertext', async () => {
    const { store } = localStore();
    const blob = await store.encryptField(USER_A, 'coffee');
    const bytes = Buffer.from(blob.slice('v1:'.length), 'base64');
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    const tampered = 'v1:' + bytes.toString('base64');
    await expect(store.decryptField(USER_A, tampered)).rejects.toThrow();
  });

  it('reads plaintext legacy rows without creating a data key', async () => {
    const { store } = localStore();
    expect(await store.decryptField(USER_A, 'plain note from before 2.5')).toBe('plain note from before 2.5');
    expect(await store.storedKekId(USER_A)).toBeNull();
  });

  it('creates the data key once and reuses it', async () => {
    const { store } = localStore();
    const first = await store.encryptField(USER_A, 'first');
    const second = await store.encryptField(USER_A, 'second');
    expect(await store.storedKekId(USER_A)).toBe('current');
    expect(await store.decryptField(USER_A, first)).toBe('first');
    expect(await store.decryptField(USER_A, second)).toBe('second');
  });
});

describe('crypto-shredding', () => {
  it('throws ShreddedKeyError after shred, even for a cached key', async () => {
    const { store } = localStore();
    const blob = await store.encryptField(USER_A, 'delete me');
    await store.shred(USER_A);
    await expect(store.decryptField(USER_A, blob)).rejects.toBeInstanceOf(ShreddedKeyError);
    await expect(store.encryptField(USER_A, 'after delete')).rejects.toBeInstanceOf(ShreddedKeyError);
  });

  it('leaves other users keys untouched', async () => {
    const { store } = localStore();
    const kept = await store.encryptField(USER_A, 'keep me');
    await store.encryptField(USER_B, 'shred me');
    await store.shred(USER_B);
    expect(await store.decryptField(USER_A, kept)).toBe('keep me');
  });
});

describe('blind indexes', () => {
  it('is equal for equal normalized values and different across users', async () => {
    const { store } = localStore();
    const a = await store.blindIndex(USER_A, '  Cafe  ');
    const b = await store.blindIndex(USER_A, 'cafe');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const otherUser = await store.blindIndex(USER_B, 'cafe');
    expect(otherUser).not.toBe(a);
    expect(await store.blindIndex(USER_A, 'tea')).not.toBe(a);
  });

  it('supports a non-tenant index for global de-duplication', async () => {
    const { store } = localStore();
    const first = await store.blindIndex(undefined, 'Merchant');
    const second = await store.blindIndex(undefined, 'merchant');
    expect(first).toBe(second);
    expect(first).not.toBe(await store.blindIndex(USER_A, 'merchant'));
  });
});

describe('KEK rotation', () => {
  it('re-wraps data keys under the new kek id and keeps old ciphertext decryptable', async () => {
    const keks: Record<string, Buffer> = {
      current: KEK_CURRENT,
      next: Buffer.alloc(32, 0x33),
    };
    const store = new InMemoryDataKeyStore(new LocalKeyWrapper(keks, 'current'));
    const blob = await store.encryptField(USER_A, 'rotate me');
    expect(await store.storedKekId(USER_A)).toBe('current');

    expect(await store.rotateKek('next')).toBe(1);
    expect(await store.storedKekId(USER_A)).toBe('next');

    // Once the old KEK is gone, only a re-wrapped key can open the row.
    delete keks.current;
    expect(await store.decryptField(USER_A, blob)).toBe('rotate me');
  });

  it('skips shredded rows', async () => {
    const { store } = localStore();
    await store.encryptField(USER_A, 'gone');
    await store.shred(USER_A);
    expect(await store.rotateKek('previous')).toBe(0);
  });
});

describe('SigV4 signer', () => {
  /*
   * AWS Signature Version 4 documentation, "Example: GET request that lists
   * users" (IAM ListUsers). The secret is AWS's published example key, assembled
   * with join() so a scanner does not read it as a real credential.
   */
  const EXAMPLE_SECRET = ['wJalrXUtnFEMI', '/K7MDENG', '+bPxRfiCYEXAMPLEKEY'].join('');
  const result = sigV4Sign({
    method: 'GET',
    url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    region: 'us-east-1',
    service: 'iam',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: EXAMPLE_SECRET,
    date: new Date('2015-08-30T12:36:00Z'),
  });

  it('produces the published canonical request hash', () => {
    expect(result.stringToSign).toBe([
      'AWS4-HMAC-SHA256',
      '20150830T123600Z',
      '20150830/us-east-1/iam/aws4_request',
      'f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59',
    ].join('\n'));
  });

  it('produces the published signature and Authorization header', () => {
    expect(result.signature).toBe('5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
    expect(result.headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, '
      + 'SignedHeaders=content-type;host;x-amz-date, '
      + 'Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
  });
});

describe('AWS KMS key wrapper', () => {
  function fakeKms(): { fetchImpl: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const payload = JSON.parse(String(init?.body ?? '{}')) as { Plaintext?: string; CiphertextBlob?: string };
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers['X-Amz-Target'] === 'TrentService.Encrypt') {
        const wrapped = Buffer.from('kms:' + (payload.Plaintext ?? ''), 'utf8').toString('base64');
        return new Response(JSON.stringify({ CiphertextBlob: wrapped }), { status: 200 });
      }
      const raw = Buffer.from(payload.CiphertextBlob ?? '', 'base64').toString('utf8');
      return new Response(JSON.stringify({ Plaintext: raw.slice('kms:'.length) }), { status: 200 });
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  it('wraps and unwraps through KMS Encrypt/Decrypt over signed fetch', async () => {
    const { fetchImpl, calls } = fakeKms();
    const keyArn = 'arn:aws:kms:us-east-1:111122223333:key/1234abcd';
    const wrapper = new KmsKeyWrapper({
      keyArn,
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: ['fake', 'secret', 'material'].join(''),
      },
      fetchImpl,
      now: () => new Date('2026-01-05T12:00:00Z'),
    });
    const dataKey = Buffer.alloc(32, 0x44);
    const { wrapped, kekId } = await wrapper.wrap(dataKey);
    expect(kekId).toBe(keyArn);
    expect(wrapped.length).toBeGreaterThan(0);
    expect(await wrapper.unwrap(wrapped, kekId)).toEqual(dataKey);

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.url).toBe('https://kms.us-east-1.amazonaws.com/');
      expect(String((call.init.headers as Record<string, string>).Authorization)).toMatch(/^AWS4-HMAC-SHA256 /);
    }
    expect((calls[0]!.init.headers as Record<string, string>)['X-Amz-Target']).toBe('TrentService.Encrypt');
    expect((calls[1]!.init.headers as Record<string, string>)['X-Amz-Target']).toBe('TrentService.Decrypt');
  });

  it('rotates the key id without re-encrypting the data', async () => {
    const { fetchImpl, calls } = fakeKms();
    const options = {
      keyArn: 'arn:aws:kms:us-east-1:111122223333:key/old',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: ['fake', 'secret', 'material'].join(''),
      },
      fetchImpl,
      now: () => new Date('2026-01-05T12:00:00Z'),
    };
    const wrapper = new KmsKeyWrapper(options);
    const dataKey = Buffer.alloc(32, 0x45);
    const { wrapped } = await wrapper.wrap(dataKey);
    const next = wrapper.withKek?.('arn:aws:kms:us-east-1:111122223333:key/new');
    expect(next).toBeInstanceOf(KmsKeyWrapper);
    const rewrapped = await next!.wrap(await wrapper.unwrap(wrapped, options.keyArn));
    expect(rewrapped.kekId).toBe('arn:aws:kms:us-east-1:111122223333:key/new');
    expect(await next!.unwrap(rewrapped.wrapped, rewrapped.kekId)).toEqual(dataKey);
    expect(calls.length).toBe(4);
  });
});

describe('practice stores encrypt notes', () => {
  it('spend-log notes round-trip and are unreadable after shred', async () => {
    const { store: dataKeys } = localStore();
    const spendLogs = new InMemorySpendLogStore(undefined, dataKeys);
    const event = await spendLogs.record(USER_A, {
      amountMinor: 450,
      category: 'dining',
      note: 'Coffee',
      occurredAt: new Date(T0).toISOString(),
    }, new Date(T0));
    expect(event.note).toBe('Coffee');
    expect((await spendLogs.list(USER_A))[0]?.note).toBe('Coffee');
    await dataKeys.shred(USER_A);
    await expect(spendLogs.list(USER_A)).rejects.toBeInstanceOf(ShreddedKeyError);
  });

  it('income notes round-trip through the practice store', async () => {
    const { store: dataKeys } = localStore();
    const finance = new InMemoryPersonalFinanceStore(dataKeys);
    const entry = await finance.recordIncome(USER_A, {
      amountMinor: 300_000,
      source: 'salary',
      note: 'Monthly pay',
      occurredAt: new Date(T0).toISOString(),
    }, new Date(T0));
    expect(entry.note).toBe('Monthly pay');
    expect((await finance.listIncome(USER_A))[0]?.note).toBe('Monthly pay');
    expect((await finance.listIncomePage(USER_A, null, 10))[0]?.note).toBe('Monthly pay');
  });

  it('reads seeded legacy plaintext notes as-is', async () => {
    const { store: dataKeys } = localStore();
    const legacy = new InMemorySpendLogStore([{
      id: 'legacy-1',
      accountId: USER_A,
      amountMinor: 500,
      currency: 'USD',
      category: 'dining',
      note: 'Legacy note',
      occurredAt: new Date(T0).toISOString(),
      source: 'manual',
      createdAt: new Date(T0).toISOString(),
    }], dataKeys);
    expect((await legacy.list(USER_A))[0]?.note).toBe('Legacy note');
    expect(await dataKeys.storedKekId(USER_A)).toBeNull();
  });
});

describe('account deletion shreds the data key', () => {
  it('destroys the key before the rows are removed', async () => {
    const auth = new InMemoryAuthStore();
    const dataKeys = new InMemoryDataKeyStore(new LocalKeyWrapper({ current: KEK_CURRENT }, 'current'));
    const practice = new PracticeLedger();
    const reject = () => Promise.reject(new LedgerError(503, 'live ledger is down'));
    const live = new Proxy({}, { get: () => reject }) as LedgerReader & LedgerWriter & LedgerAuditor;
    const api = createApp({
      ledger: new CompositeLedger(live, practice, async () => false),
      practice,
      spendLogs: new InMemorySpendLogStore(),
      personalFinance: new InMemoryPersonalFinanceStore(),
      auth,
      dataKeys,
      mailer: new MemoryMailer(),
      appUrl: 'https://settle.example',
      now: () => new Date(T0),
      mfaKey: Buffer.alloc(32, 0x2a),
      breachedPassword: async () => false,
    });

    const email = 'envelope-delete@example.com';
    const registered = await api.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, displayName: 'Sam Lee' }),
    });
    expect(registered.status).toBe(201);
    const cookie = (registered.headers.get('set-cookie') ?? '').split(';')[0]!;
    const user = await auth.findByEmail(email);
    expect(user).not.toBeNull();
    const blob = await dataKeys.encryptField(user!.id, 'delete me');
    const accountBlob = await dataKeys.encryptField(user!.accountId, 'delete me too');

    const stepUp = await api.request('/api/auth/step-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(stepUp.status).toBe(200);

    const deleted = await api.request('/api/account', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
    await expect(dataKeys.decryptField(user!.id, blob)).rejects.toBeInstanceOf(ShreddedKeyError);
    await expect(dataKeys.decryptField(user!.accountId, accountBlob)).rejects.toBeInstanceOf(ShreddedKeyError);
  });
});

describe('configuration', () => {
  it('selects KMS only when the key ARN and credentials are present', () => {
    expect(kmsConfigured({ KMS_KEY_ARN: 'arn:aws:kms:us-east-1:1:key/x' })).toBe(false);
    const env = {
      KMS_KEY_ARN: 'arn:aws:kms:us-east-1:1:key/x',
      AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
      AWS_SECRET_ACCESS_KEY: ['fake', 'material'].join(''),
      AWS_REGION: 'us-east-1',
    };
    expect(kmsConfigured(env)).toBe(true);
    expect(keyWrapperFromEnv(env)).toBeInstanceOf(KmsKeyWrapper);
  });

  it('uses the local KEK from DATA_KEK', async () => {
    const env: NodeJS.ProcessEnv = {
      DATA_KEK: KEK_CURRENT.toString('base64'),
      DATA_KEK_ID: 'env-kek',
    };
    const wrapper = keyWrapperFromEnv(env);
    expect(wrapper).toBeInstanceOf(LocalKeyWrapper);
    const store = createDataKeyStore(env);
    const blob = await store.encryptField(USER_A, 'env note');
    expect(await store.storedKekId(USER_A)).toBe('env-kek');
    expect(await store.decryptField(USER_A, blob)).toBe('env note');
  });

  it('refuses the encryption layer in production without DATA_KEK or KMS', async () => {
    const store = createDataKeyStore({ NODE_ENV: 'production' });
    await expect(store.encryptField(USER_A, 'nope')).rejects.toThrow(/DATA_KEK|KMS/);
  });

  it('rejects a DATA_KEK that is not 32 bytes', async () => {
    const store = createDataKeyStore({
      DATA_KEK: Buffer.alloc(16, 0x31).toString('base64'),
      DATA_KEK_ID: 'short',
    });
    await expect(store.encryptField(USER_A, 'nope')).rejects.toThrow(/32 bytes/);
  });
});

describe.skipIf(!process.env.SETTLE_TEST_DATABASE_URL)('Postgres data key store', () => {
  const url = process.env.SETTLE_TEST_DATABASE_URL!;
  const user = randomUUID();

  async function cleanup(): Promise<void> {
    const client = new pg.Client(pgConfig(url));
    await client.connect();
    try {
      await client.query('delete from app_data_keys where user_id = $1', [user]);
      await withUser(client, user, async () => {
        await client.query('delete from income_logs where account_id = $1', [user]);
        await client.query('delete from money_profiles where account_id = $1', [user]);
      });
    } finally {
      await client.end();
    }
  }

  it('round-trips, rotates and shreds rows in app_data_keys', async () => {
    // rotateKek re-wraps every row in the table, so this test owns a private
    // schema; other files writing app_data_keys in parallel cannot interfere.
    const schema = `envelope_${randomUUID().replace(/-/g, '')}`;
    const admin = new pg.Client(pgConfig(url));
    await admin.connect();
    await admin.query(`create schema ${schema}`);
    const schemaUrl = `${url}${url.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
    const keks: Record<string, Buffer> = { old: KEK_CURRENT, next: KEK_PREVIOUS };
    const store = new PostgresDataKeyStore(schemaUrl, new LocalKeyWrapper(keks, 'old'));
    try {
      const blob = await store.encryptField(user, 'postgres note');
      expect(blob.startsWith('v1:')).toBe(true);
      expect(await store.storedKekId(user)).toBe('old');
      expect(await store.decryptField(user, blob)).toBe('postgres note');

      expect(await store.rotateKek('next')).toBe(1);
      expect(await store.storedKekId(user)).toBe('next');
      expect(await store.decryptField(user, blob)).toBe('postgres note');

      await store.shred(user);
      await expect(store.decryptField(user, blob)).rejects.toBeInstanceOf(ShreddedKeyError);
      await expect(store.encryptField(user, 'after shred')).rejects.toBeInstanceOf(ShreddedKeyError);
    } finally {
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    }
  }, 30_000);

  it('reads a legacy plaintext income note as-is', async () => {
    const { store: dataKeys } = localStore();
    const finance = new PostgresPersonalFinanceStore(url, dataKeys);
    try {
      await finance.getProfile(user, 'USD', new Date(T0));
      const client = new pg.Client(pgConfig(url));
      await client.connect();
      try {
        await withUser(client, user, async () => {
          await client.query(
            `insert into income_logs (id, account_id, amount_minor, currency, source, note, occurred_at, created_at)
             values ($1, $2, $3, 'USD', 'salary', $4, $5, $5)`,
            [randomUUID(), user, 123_400, 'legacy plaintext income', new Date(T0).toISOString()],
          );
        });
      } finally {
        await client.end();
      }
      const rows = await finance.listIncome(user);
      expect(rows.map((row) => row.note)).toContain('legacy plaintext income');
    } finally {
      await cleanup();
    }
  }, 30_000);
});
