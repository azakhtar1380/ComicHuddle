// Isolated QA dependencies are installed outside the Site's runtime dependency tree.
// Run with PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js.
import {readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(projectRoot, 'package.json'));

export async function createPostgres() {
  if (process.env.PG_QA_SOCKET) {
    const driver = await import(pathToFileURL(path.resolve(process.env.PG_MODULE)).href);
    const Client = driver.Client || driver.default.Client;
    const client = new Client({host: process.env.PG_QA_SOCKET, port: Number(process.env.PG_QA_PORT || 15436),
      user: 'qa_owner', database: process.env.PG_QA_DATABASE || 'postgres', connectionTimeoutMillis: 3000,
      application_name: 'comichuddle-isolated-qa'});
    await client.connect();
    return {
      engineKind: 'native-postgresql',
      query: (sql, values) => client.query(sql, values),
      exec: sql => client.query(sql),
      async transaction(callback) {
        await client.query('BEGIN');
        try {const value = await callback(this); await client.query('COMMIT'); return value;}
        catch (error) {await client.query('ROLLBACK'); throw error;}
      },
      close: () => client.end(),
      openSecondary: () => createPostgres()
    };
  }
  const modulePath = process.env.PGLITE_MODULE;
  const {PGlite} = modulePath
    ? await import(pathToFileURL(path.resolve(modulePath)).href)
    : await import('@electric-sql/pglite');
  const db = new PGlite();
  db.engineKind = 'postgresql-wasm';
  return db;
}

// Execute the real TypeScript modules after the same transpilation used by the
// Site's existing integration checks. No service/query is replaced by a mock.
export function loadTypeScriptModule(relative, extras = {}) {
  const modules = new Map();
  const context = vm.createContext({console, Request, Response, Headers, URL,
    URLSearchParams, AbortController, TextEncoder, TextDecoder, crypto,
    Date, Error, TypeError, SyntaxError, Promise, Map, Set, JSON, Math, Number, BigInt,
    setTimeout, clearTimeout, ...extras});
  function load(file) {
    const stem = file.endsWith('.js') && !existsSync(file) ? file.slice(0, -3) : file;
    const resolved = ['','.ts','.tsx','.mts','.js','/index.ts'].map(suffix => stem + suffix)
      .find(candidate => existsSync(candidate));
    if (!resolved) throw Error('QA cannot resolve actual module: ' + file);
    if (resolved.endsWith('.css')) return {};
    if (modules.has(resolved)) return modules.get(resolved).exports;
    const module = {exports: {}};
    modules.set(resolved, module);
    const localRequire = name => name.startsWith('.')
      ? load(path.resolve(path.dirname(resolved), name))
      : require(name);
    const code = ts.transpileModule(readFileSync(resolved, 'utf8'), {
      compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}, fileName: resolved
    }).outputText;
    const wrapper = new vm.Script('(function(exports,require,module,__filename,__dirname){' + code + '\n})',
      {filename: resolved}).runInContext(context);
    wrapper(module.exports, localRequire, module, resolved, path.dirname(resolved));
    return module.exports;
  }
  return load(path.resolve(projectRoot, relative));
}

export const plain = value => JSON.parse(JSON.stringify(value));

export function createReporter(name) {
  let passed = 0;
  const failures = [];
  return {
    async test(label, callback) {
      try {await callback(); passed++; console.log('PASS: ' + label);}
      catch (error) {failures.push({name: label, message: error.message, code: error.code});
        console.error('FAIL: ' + label + ' — ' + error.message);}
    },
    finish(extra = {}) {
      const result = {suite: name, passed, failed: failures.length, failures, ...extra};
      console.log('\n' + name + ': ' + passed + ' passed, ' + failures.length + ' failed.');
      console.log('QA_RESULT ' + JSON.stringify(result));
      if (failures.length) process.exitCode = 1;
      return result;
    }
  };
}
