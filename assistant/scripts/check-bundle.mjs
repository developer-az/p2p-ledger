// Bundle size budget check. Reads the JS chunks emitted by `vite build` and
// fails when the largest chunk or the whole JS payload exceeds its raw budget.
// No dependencies on purpose: works with plain node, no install step.

import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MAX_CHUNK_BYTES = 300 * 1024;
const MAX_TOTAL_BYTES = 700 * 1024;
const ASSETS_DIR = path.resolve(fileURLToPath(new URL('../dist/assets', import.meta.url)));

const kB = (bytes) => (bytes / 1024).toFixed(1);

let names;
try {
  names = await readdir(ASSETS_DIR);
} catch {
  console.error(`BLOCKED: no build output at ${ASSETS_DIR}`);
  console.error('Run `npx vite build` in assistant/ before `npm run check:bundle`.');
  process.exit(1);
}

const jsFiles = names.filter((name) => name.endsWith('.js')).sort();
if (jsFiles.length === 0) {
  console.error(`BLOCKED: no .js files in ${ASSETS_DIR}`);
  console.error('Run `npx vite build` in assistant/ before `npm run check:bundle`.');
  process.exit(1);
}

const rows = [];
for (const name of jsFiles) {
  const { size } = await stat(path.join(ASSETS_DIR, name));
  rows.push({ name, size });
}
rows.sort((a, b) => b.size - a.size);

const total = rows.reduce((sum, row) => sum + row.size, 0);
const largest = rows[0];

const nameWidth = Math.max('file'.length, ...rows.map((row) => row.name.length));
console.log(`${'file'.padEnd(nameWidth)}  kB`);
console.log(`${'-'.repeat(nameWidth)}  ${'-'.repeat(8)}`);
for (const row of rows) {
  console.log(`${row.name.padEnd(nameWidth)}  ${kB(row.size).padStart(8)}`);
}
console.log(`${'-'.repeat(nameWidth)}  ${'-'.repeat(8)}`);
console.log(`${'total'.padEnd(nameWidth)}  ${kB(total).padStart(8)}`);

const failures = [];
if (largest.size > MAX_CHUNK_BYTES) {
  failures.push(
    `largest chunk ${largest.name} is ${kB(largest.size)} kB, budget ${kB(MAX_CHUNK_BYTES)} kB`,
  );
}
if (total > MAX_TOTAL_BYTES) {
  failures.push(`total JS is ${kB(total)} kB, budget ${kB(MAX_TOTAL_BYTES)} kB`);
}

if (failures.length) {
  for (const failure of failures) console.error(`BLOCKED: ${failure}`);
  process.exit(1);
}

console.log(
  `PASS: largest ${kB(largest.size)} kB / ${kB(MAX_CHUNK_BYTES)} kB, total ${kB(total)} kB / ${kB(MAX_TOTAL_BYTES)} kB.`,
);
