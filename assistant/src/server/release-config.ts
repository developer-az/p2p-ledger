/** Configuration validation only; reports names, never secret values. */
export function releaseConfigurationIssues(env: NodeJS.ProcessEnv): string[] {
  const issues: string[] = [];
  for (const name of ['LEDGER_URL', 'LEDGER_API_KEY', 'RESEND_API_KEY', 'MAIL_FROM', 'APP_URL'])
    if (!env[name]?.trim()) issues.push(`${name} is missing or empty`);
  if (!env.DATABASE_URL?.trim() && !env.LEDGER_DATABASE_URL?.trim()) issues.push('DATABASE_URL or LEDGER_DATABASE_URL is required');
  for (const name of ['LEDGER_URL', 'APP_URL']) {
    if (!env[name]?.trim()) continue;
    try { const url = new URL(env[name]!.trim()); if (url.protocol !== 'https:' || url.username || url.password) issues.push(`${name} must be an HTTPS URL without embedded credentials`); }
    catch { issues.push(`${name} is not a valid URL`); }
  }
  if (env.LEDGER_API_KEY?.trim() && env.LEDGER_API_KEY.trim().length < 32) issues.push('LEDGER_API_KEY must have at least 32 characters');
  return issues;
}
