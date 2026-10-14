import {spawnSync} from 'node:child_process';

const checks=[
 ['--experimental-vm-modules','checks/network-smoke.mjs'],
 ['--experimental-vm-modules','checks/readiness-negative.mjs'],
 ['--experimental-vm-modules','checks/community-api.mjs'],
 ['--experimental-vm-modules','checks/metron-directory.mjs'],
 ['--experimental-vm-modules','checks/metron-sync.mjs'],
 ['--experimental-vm-modules','checks/gcd-sync.mjs'],
 ['--experimental-vm-modules','checks/gcd-bulk.mjs'],
 ['--experimental-vm-modules','checks/external-catalog-vault.mjs'],
 ['--experimental-vm-modules','checks/marketplace-smoke.mjs'],
 ['--experimental-vm-modules','checks/marketplace-pickup-trade.mjs'],
 ['--experimental-vm-modules','checks/trade-terms.mjs'],
 ['--experimental-vm-modules','checks/pickup-payment.mjs'],
 ['checks/workshop-discovery.mjs'],
 ['--experimental-vm-modules','checks/sketch-launch.mjs'],
 ['checks/scan-vision.mjs'],
 ['checks/scan-live.mjs'],
 ['checks/mobile-dock.mjs'],
 ['checks/directory-product-card.mjs'],
 ['checks/shared-directory-compact.mjs'],
 ['checks/mobile-two-column.mjs'],
 ['checks/directory-containment.mjs'],
 ['checks/hub-detail-lifecycle.mjs'],
 ['architecture/postgres/run-unit-tests.mjs'],
 ['--experimental-vm-modules','checks/payment-boundary.mjs'],
 ['checks/fmv-model.mjs'],
 ['checks/commerce-policy.mjs'],
 ['checks/stripe-sandbox.mjs'],
 ['--experimental-vm-modules','checks/commerce-api.mjs'],
 ['--experimental-vm-modules','checks/marketplace-legacy.mjs'],
 ['checks/readiness-client-race.mjs'],
 ['--experimental-vm-modules','checks/journey-integration.mjs'],
 ['checks/journey-client.mjs'],
 ['checks/navigation-community.mjs'],
 ['--experimental-vm-modules','checks/readiness-query-budget.mjs'],
 ['checks/app-privacy.mjs'],
 ['checks/dialog-focus.mjs'],
 ['node_modules/typescript/bin/tsc','--noEmit','--incremental','false'],
];
for(const args of checks){
 console.log('\nRunning '+args.join(' '));
 const result=spawnSync(process.execPath,args,{stdio:'inherit'});
 if(result.error){console.error(result.error.message);process.exit(1)}
 if(result.status!==0)process.exit(result.status||1);
}
console.log('\nRunning checks/metron-runner.py');
const pythonCheck=spawnSync('python',['checks/metron-runner.py'],{stdio:'inherit'});
if(pythonCheck.error){console.error(pythonCheck.error.message);process.exit(1)}
if(pythonCheck.status!==0)process.exit(pythonCheck.status||1);
console.log('\nRunning checks/gcd-runner.py');
const gcdRunner=spawnSync('python',['checks/gcd-runner.py'],{stdio:'inherit'});
if(gcdRunner.error){console.error(gcdRunner.error.message);process.exit(1)}
if(gcdRunner.status!==0)process.exit(gcdRunner.status||1);
console.log('\nRunning checks/gcd-sqlite-adapter.py');
const sqliteAdapter=spawnSync('python',['checks/gcd-sqlite-adapter.py'],{stdio:'inherit'});
if(sqliteAdapter.error){console.error(sqliteAdapter.error.message);process.exit(1)}
if(sqliteAdapter.status!==0)process.exit(sqliteAdapter.status||1);
console.log('\nRunning scripts/build-cover-index.py --check');
const coverIndex=spawnSync('python',['scripts/build-cover-index.py','--check'],{stdio:'inherit'});
if(coverIndex.error){console.error(coverIndex.error.message);process.exit(1)}
if(coverIndex.status!==0)process.exit(coverIndex.status||1);
if(process.env.PGLITE_MODULE||process.env.PG_QA_SOCKET){
 console.log('\nRunning actual isolated PostgreSQL integration');
 const postgres=spawnSync(process.execPath,['architecture/postgres/tests/run.mjs'],{stdio:'inherit',env:process.env});
 if(postgres.error){console.error(postgres.error.message);process.exit(1)}
 if(postgres.status!==0)process.exit(postgres.status||1);
}else console.log('\nPostgreSQL engine integration NOT RUN: provide isolated QA PGLITE_MODULE. Prepared native connection tests remain separate.');
console.log('\nAutomated web readiness checks passed. Physical browser/device and external service release gates remain separate.');
