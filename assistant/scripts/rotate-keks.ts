/**
 * Re-wraps every per-user data key under a new KEK id.
 *
 * Ciphertext is untouched: only app_data_keys.wrapped / kek_id change. Local
 * KEKs need the previous key material to open existing rows:
 *
 *   DATA_KEK=<new base64 32 bytes> DATA_KEK_ID=<new id> \
 *   DATA_KEK_PREVIOUS=<old base64 32 bytes> \
 *   npm run keys:rotate -- <new id>
 *
 * With AWS KMS configured (KMS_KEY_ARN + credentials), pass the new key ARN or
 * alias; KMS decrypts the old ciphertext without the old key material.
 */
import { databaseUrlFromEnv } from '../src/server/integrity-postgres.js';
import {
  devDataKek,
  keyWrapperFromEnv,
  KmsKeyWrapper,
  kmsConfigured,
  LocalKeyWrapper,
  PostgresDataKeyStore,
  type KeyWrapper,
} from '../src/server/envelope.js';

function localKekFromEnv(env: NodeJS.ProcessEnv, name: string): Buffer {
  const raw = env[name]?.trim();
  if (!raw) {
    if (env.NODE_ENV === 'production') throw new Error(`${name} is required outside development`);
    return devDataKek();
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
  return key;
}

async function main(): Promise<void> {
  const env = process.env;
  const url = databaseUrlFromEnv(env);
  if (!url) throw new Error('DATABASE_URL or LEDGER_DATABASE_URL is required');

  const newKekId = (process.argv[2] ?? env.DATA_KEK_ID ?? '').trim();
  if (!newKekId) throw new Error('Usage: npm run keys:rotate -- <new-kek-id> (or set DATA_KEK_ID)');

  let wrapper: KeyWrapper;
  if (kmsConfigured(env)) {
    wrapper = keyWrapperFromEnv(env, newKekId);
  } else {
    const newKey = localKekFromEnv(env, 'DATA_KEK');
    const previousKey = localKekFromEnv(env, 'DATA_KEK_PREVIOUS');
    const probe = new PostgresDataKeyStore(url, new LocalKeyWrapper({}, newKekId));
    const oldIds = await probe.kekIds();
    const keks: Record<string, Buffer> = { [newKekId]: newKey };
    for (const id of oldIds) if (!(id in keks)) keks[id] = previousKey;
    wrapper = new LocalKeyWrapper(keks, newKekId);
  }

  const store = new PostgresDataKeyStore(url, wrapper);
  const rewrapped = await store.rotateKek(newKekId);
  const engine = wrapper instanceof KmsKeyWrapper ? 'AWS KMS' : 'local KEK';
  console.log(`keys:rotate: re-wrapped ${rewrapped} data key(s) under ${newKekId} (${engine})`);
}

main().catch((error: unknown) => {
  console.error('keys:rotate failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
