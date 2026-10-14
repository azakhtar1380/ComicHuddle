import { resolve } from 'node:path';
import { getPool } from '../db/postgres';
import { importGcdSeed } from '../lib/gcd-postgres-seed';

const pool = getPool();
try {
  const result = await importGcdSeed(pool, resolve('db/gcd-overview-seed.jsonl'), resolve('db/gcd-overview-seed.manifest.json'));
  console.log('Verified AWS RDS GCD seed result: ' + JSON.stringify(result));
} catch {
  // Driver errors can contain SQL/input/connection details. Keep all such
  // diagnostics out of public cloud build logs, and preserve the checkpoint.
  console.error('GCD seed failed validation or database reconciliation. Committed batches remain resumable.');
  process.exitCode = 1;
} finally { await pool.end(); }
