import ts from "typescript";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const source=dirname(fileURLToPath(import.meta.url));
const outDir=await mkdtemp(resolve(tmpdir(),"comichuddle-analyzer-tests-"));
try {
  const program=ts.createProgram([resolve(source,"analyzer.test.ts")],{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
    strict:true,skipLibCheck:true,esModuleInterop:true,outDir,rootDir:source,
    types:["node"],noEmitOnError:true,
  });
  const diagnostics=ts.getPreEmitDiagnostics(program);
  if(diagnostics.length) {
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:f=>f,getNewLine:()=>"\n"}));
    process.exitCode=1;
  } else {
    program.emit();
    await writeFile(resolve(outDir,"package.json"),JSON.stringify({type:"module"}));
    const result=spawnSync(process.execPath,["--test",resolve(outDir,"analyzer.test.js")],{stdio:"inherit"});
    process.exitCode=result.status??1;
  }
} finally { await rm(outDir,{recursive:true,force:true}); }
