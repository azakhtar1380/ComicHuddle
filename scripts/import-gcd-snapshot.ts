/** Offline GCD SQLite -> verified JSONL -> native TLS PostgreSQL.
 * Database credentials come only from server environment, never CLI flags.
 * The receipt directory is kept for resumable retries; snapshots are not put
 * in the repository or deployed into web function bundles.
 */
import { parseArgs } from 'node:util';
import { mkdir, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getPool } from '../db/postgres';
import { importGcdSnapshot } from '../lib/gcd-snapshot-import';

const { values } = parseArgs({ options: { input: { type: 'string' }, 'snapshot-at': { type: 'string' },
  workdir: { type: 'string' }, 'cover-origin': { type: 'string', default: 'https://files1.comics.org' }, help: { type: 'boolean' } } });
if (values.help || !values.input || !values['snapshot-at'] || !values.workdir) {
  console.log('Usage: npm run db:import:gcd -- --input /path/gcd.sqlite --snapshot-at ACTUAL_GCD_TIMESTAMP --workdir /path/import-receipts');
  if (!values.help) process.exitCode = 1;
} else {
  const input = resolve(values.input), folder = resolve(values.workdir);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const file = join(folder, 'issues.jsonl'), report = join(folder, 'conversion.json');
  let exists = false;
  try { await readFile(report, 'utf8'); exists = true; } catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; }
  if (!exists) {
    const conversion = spawnSync(process.env.COMICHUDDLE_PYTHON || 'python3', [
      'scripts/gcd_sqlite_to_jsonl.py', '--input', input, '--output', file, '--report', report,
      '--snapshot-at', values['snapshot-at'], '--include-cover-references', '--cover-origin', values['cover-origin']!], { stdio: 'inherit' });
    if (conversion.status !== 0) throw Error('GCD SQLite conversion failed; no PostgreSQL import started.');
  } else {
    // Reusing a directory must never silently import a different archive/date.
    const receipt = JSON.parse(await readFile(report, 'utf8'));
    if (Date.parse(receipt.snapshotAt) !== Date.parse(values['snapshot-at'])) throw Error('The saved conversion belongs to another snapshot timestamp.');
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(input)) digest.update(chunk);
    if (digest.digest('hex') !== receipt.inputSha256) throw Error('The archive differs from the saved conversion receipt.');
  }
  const pool = getPool();
  try {
    console.log('AWS RDS snapshot import: ' + JSON.stringify(await importGcdSnapshot(pool, file, report,
      { onProgress: value => console.log('Committed snapshot batch: ' + JSON.stringify(value)) })));
  } catch {
    console.error('Snapshot validation or PostgreSQL reconciliation failed. Retain this input/receipt directory to resume.');
    process.exitCode = 1;
  } finally { await pool.end(); }
}
