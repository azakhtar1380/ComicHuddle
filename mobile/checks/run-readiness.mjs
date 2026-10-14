import {spawnSync} from 'node:child_process';

for(const args of [['checks/image-layout.mjs'],['checks/native-journeys.mjs'],['node_modules/typescript/bin/tsc','--noEmit']]){
 const result=spawnSync(process.execPath,args,{stdio:'inherit'});
 if(result.error){console.error(result.error.message);process.exit(1)}
 if(result.status!==0)process.exit(result.status||1);
}
console.log('Native source checks passed. Signed builds, hardware behavior, store review and unresolved upstream build-tool advisories still require verification.');
