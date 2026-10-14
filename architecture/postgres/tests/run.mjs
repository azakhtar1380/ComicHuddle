// Reproducible actual SQL integration entry point. Isolated QA tool dependency only.
import {spawnSync} from 'node:child_process';
for(const file of ['environment.mjs','schema-integration.mjs','api-integration.mjs']){
  console.log('\nRUN architecture/postgres/tests/'+file);
  const result=spawnSync(process.execPath,['architecture/postgres/tests/'+file],{stdio:'inherit',env:process.env});
  if(result.error){console.error(result.error);process.exit(1);}if(result.status!==0)process.exit(result.status||1);
}
console.log('\nActual isolated PostgreSQL engine/SQL/role/reference HTTP integration passed.');
console.log('Native separate-backend concurrency and physical browser/device/OAuth/payment tests are not established by this run.');
