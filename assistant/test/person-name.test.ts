import { describe, expect, it } from 'vitest';
import { personName } from '../src/web/person-name.js';

describe('personName', () => {
  it('labels corridor peers with short tag', () => {
    expect(personName('landlord-a3f2b1')).toBe('Landlord ·a3f2b1');
    expect(personName('vendor-9c1d2e')).toBe('Vendor ·9c1d2e');
  });

  it('keeps simple owner ids readable', () => {
    expect(personName('sam-eb86ae')).toBe('Sam');
  });
});
