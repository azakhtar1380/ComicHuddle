import {mkdir,writeFile} from 'node:fs/promises';
import './compile.mjs';
await mkdir('certificates',{recursive:true});
const response=await fetch('https://truststore.pki.rds.amazonaws.com/us-east-2/us-east-2-bundle.pem',{redirect:'error',signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Cannot retrieve the AWS RDS trust bundle');
const ca=await response.text();if(!ca.includes('-----BEGIN CERTIFICATE-----')||ca.length>1000000)throw Error('Invalid AWS RDS trust bundle');
await writeFile('certificates/rds.pem',ca);
if(process.env.VERCEL_ENV==='production'&&process.env.MIGRATE_ON_BUILD==='true'){
 const {database,migrate}=await import('../server/database.mjs');
 const pool=await database({...process.env,DB_SSL_CA_PATH:new URL('../certificates/rds.pem',import.meta.url).pathname});
 try{await migrate(pool);console.log('ComicHuddle versioned PostgreSQL migrations completed');}finally{await pool.end()}
}else console.log('Database migrations skipped outside an explicitly configured production build');
