import { releaseConfigurationIssues } from '../src/server/release-config.js';
import { JavaWorkflows } from '../src/server/java-workflows.js';
const issues = releaseConfigurationIssues(process.env);
if (issues.length) { issues.forEach(issue => console.error('BLOCKED: ' + issue)); process.exitCode = 1; }
else {
  try {
    await new JavaWorkflows(process.env.LEDGER_URL!.trim(), process.env.LEDGER_API_KEY!.trim(), 30_000).assertReady();
    console.log('PASS: required configuration present; Java workflow version 2 is reachable with service credentials.');
    console.log('Still verify signup, login, expense persistence and actual reset-email delivery after deployment.');
  } catch { console.error('BLOCKED: Java workflow version 2 is unreachable, incompatible, or rejects the service credentials.'); process.exitCode = 1; }
}
