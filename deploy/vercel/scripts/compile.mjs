import ts from 'typescript';
import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
async function compile(folder,out){await mkdir(out,{recursive:true});for(const item of await readdir(folder,{withFileTypes:true})){if(item.isDirectory())await compile(path.join(folder,item.name),path.join(out,item.name));else if(item.name.endsWith('.ts')){const source=await readFile(path.join(folder,item.name),'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},fileName:item.name}).outputText.replace(/(from\s+['"])(\.\.?\/[^'"]+)(['"])/g,(_,a,b,c)=>a+(path.extname(b)?b:b+'.js')+c);await writeFile(path.join(out,item.name.replace(/\.ts$/,'.js')),js)}}}
await compile('platform/src','dist/platform');await compile('jobs','dist');
