import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaultMerchantCatalog, resolveMerchant } from '../src/server/enrichment/merchants.js';

/**
 * Merchant-resolution eval. Reads descriptors with a known answer, resolves
 * them with the shipped catalog and threshold, then reports how often a match
 * is correct (precision) and how many rows resolve at all (coverage).
 *
 * Run: npm run eval:merchants
 */

interface Case {
  descriptor: string;
  expected: string | null;
}

const file = fileURLToPath(new URL('../evals/merchants.jsonl', import.meta.url));
const rows: Case[] = readFileSync(file, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line, index) => {
    const parsed = JSON.parse(line) as Partial<Case>;
    if (typeof parsed.descriptor !== 'string' || (parsed.expected !== null && typeof parsed.expected !== 'string')) {
      throw new Error(`evals/merchants.jsonl:${index + 1}: expected {descriptor, expected}`);
    }
    return { descriptor: parsed.descriptor, expected: parsed.expected };
  });

const merchants = defaultMerchantCatalog();
let matched = 0;
let correct = 0;
let unresolved = 0;
let unresolvedCorrect = 0;
let exact = 0;
let similarity = 0;
const wrong: string[] = [];

for (const row of rows) {
  const result = resolveMerchant(row.descriptor, merchants);
  if (result.merchant === null) {
    unresolved += 1;
    if (row.expected === null) unresolvedCorrect += 1;
    else wrong.push(`${row.descriptor}: unresolved, wanted ${row.expected}`);
    continue;
  }
  matched += 1;
  if (result.method === 'exact_alias') exact += 1;
  else similarity += 1;
  if (result.merchant.id === row.expected) correct += 1;
  else wrong.push(`${row.descriptor}: got ${result.merchant.id} (${result.method}), wanted ${row.expected}`);
}

const precision = matched === 0 ? 1 : correct / matched;
const coverage = rows.length === 0 ? 0 : matched / rows.length;
const accuracy = rows.length === 0 ? 0 : (correct + unresolvedCorrect) / rows.length;

console.log(`merchant eval: ${rows.length} rows`);
console.log(`  coverage   ${(coverage * 100).toFixed(1)}%  (${matched}/${rows.length} resolved)`);
console.log(`  precision  ${(precision * 100).toFixed(1)}%  (${correct}/${matched} resolved rows correct)`);
console.log(`  accuracy   ${(accuracy * 100).toFixed(1)}%  (unresolved rows count when null is expected)`);
console.log(`  method     exact ${exact}, similarity ${similarity}, unresolved ${unresolved}`);
if (wrong.length > 0) {
  console.log('  mismatches:');
  for (const line of wrong) console.log(`    - ${line}`);
}

// A wrong merchant is worse than an unresolved row. Keep the shipped default
// honest: this fails loudly if a catalog edit drops precision or accuracy.
if (precision < 0.98 || accuracy < 0.95) process.exitCode = 1;
