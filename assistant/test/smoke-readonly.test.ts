import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production smoke script', () => {
  it('never writes to the shared sample household', () => {
    const src = readFileSync(new URL('../scripts/smoke-api.ts', import.meta.url), 'utf8');
    for (const line of src.split('\n')) {
      if (/PRACTICE_|practice/i.test(line)) expect(line).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/);
    }
  });
});
