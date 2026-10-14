import {database} from '../server/database.mjs';
import {createVercelHandler} from '../server/vercel-handler.mjs';
let poolPromise;
const getPool=()=>poolPromise||(poolPromise=database({...process.env,DB_SSL_CA_PATH:new URL('../certificates/rds.pem',import.meta.url).pathname}).catch(error=>{poolPromise=undefined;throw error}));
const handler=createVercelHandler({getPool,runSync:async()=>{
 const {run}=await import('../dist/sync-new-releases.js');
 process.env.DB_SSL_CA_PATH=new URL('../certificates/rds.pem',import.meta.url).pathname;
 return run({maxRecords:25,timeBudgetMs:45000});
}});
export default {fetch:handler};
