import { describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from '../src/server/integrity-postgres.js';

describe('databaseUrlFromEnv', () => {
  it('strips jdbc: prefix', () => {
    expect(databaseUrlFromEnv({
      LEDGER_DATABASE_URL: 'jdbc:postgresql://host:5432/ledger?sslmode=require',
    })).toBe('postgresql://host:5432/ledger?sslmode=require');
  });

  it('passes through postgres URLs', () => {
    expect(databaseUrlFromEnv({
      DATABASE_URL: 'postgresql://user:pass@host/db',
    })).toBe('postgresql://user:pass@host/db');
  });
});
