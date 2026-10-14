import { getPool } from '../db/postgres';
import { importGcdCoverSeed } from '../lib/gcd-cover-seed';
const pool = getPool();
try {
  console.log('Verified AWS RDS cover-reference result: ' + JSON.stringify(await importGcdCoverSeed(pool, process.cwd())));
} catch {
  console.error('Cover references failed validation or database reconciliation. No private photos were exposed.');
  process.exitCode = 1;
} finally { await pool.end(); }
