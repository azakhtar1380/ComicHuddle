// Export the public, attributed starter bibliography for the native prototype.
// No collector, message, order, service-access token or provider credential is included.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const target=process.argv[2];
if(!target||!path.isAbsolute(target))throw Error('Pass the absolute native project data directory.');
const root=process.cwd(),modules=new Map();
async function load(spec,parent=path.join(root,'scripts/export-app-data.mjs')){
 const file=path.resolve(path.dirname(parent),spec.endsWith('.ts')?spec:spec+'.ts');
 if(modules.has(file))return modules.get(file);
 if(!file.startsWith(path.join(root,'lib')+path.sep))throw Error('Only public library modules may be exported.');
 const js=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod=new vm.SourceTextModule(js,{identifier:file});modules.set(file,mod);await mod.link(s=>load(s,file));return mod;
}
const [catalogModule,saleModule]=await Promise.all([load('../lib/catalog'),load('../lib/reported-sales')]);
await catalogModule.evaluate();await saleModule.evaluate();
await mkdir(target,{recursive:true});
const snapshot={asOf:'2026-10-08',status:'Starter bibliography; historical individual sale results. No live valuation feed.',issues:Array.from(catalogModule.namespace.catalog),sales:Array.from(saleModule.namespace.reportedSales),credits:{metadata:'Selected records adapted from Grand Comics Database; individual dataCredit and dataLicense fields identify CC BY-SA 4.0 adaptations. Other records were independently entered from linked primary sources.',covers:'Only six vintage covers whose linked source pages identify US public-domain status. This is not worldwide image clearance.',prices:'Dated sale facts reported by CGC, with individual source URLs. These are not FMV.'}};
await writeFile(path.join(target,'catalog.json'),JSON.stringify(snapshot,null,2)+'\n');
console.log(`Exported ${snapshot.issues.length} issues and ${snapshot.sales.length} historical sale results; no private data.`);
