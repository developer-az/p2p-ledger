import { it, expect } from 'vitest';
import { releaseConfigurationIssues } from '../src/server/release-config.js';
const complete = { LEDGER_URL:'https://ledger.example', APP_URL:'https://app.example', LEDGER_DATABASE_URL:'postgresql://test.example/test', LEDGER_API_KEY:'x'.repeat(32), RESEND_API_KEY:'test-placeholder', MAIL_FROM:'Settle <test@example.com>' };
it('accepts complete configuration without claiming inbox delivery', () => { expect(releaseConfigurationIssues(complete)).toEqual([]); });
it('rejects empty values even when their names exist', () => { expect(releaseConfigurationIssues({...complete, LEDGER_URL:'  '})).toContain('LEDGER_URL is missing or empty'); });
it('rejects missing database and email configuration', () => { const issues=releaseConfigurationIssues({LEDGER_URL:complete.LEDGER_URL}); expect(issues).toContain('DATABASE_URL or LEDGER_DATABASE_URL is required'); expect(issues).toContain('RESEND_API_KEY is missing or empty'); });
it('rejects insecure URLs and short service keys without printing values', () => { const issues=releaseConfigurationIssues({...complete, LEDGER_URL:'http://user:secret@ledger.example', LEDGER_API_KEY:'private'}); expect(issues).toHaveLength(2); expect(issues.join(' ')).not.toContain('secret'); expect(issues.join(' ')).not.toContain('private'); });
