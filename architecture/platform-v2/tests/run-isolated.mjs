// Run a disposable test PostgreSQL process. This is not a Site preview server.
// PG_QA_NATIVE_ROOT and PG_MODULE point to scratch-only pinned npm tools.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, chmod, chown, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn, spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const native = process.env.PG_QA_NATIVE_ROOT;
assert.ok(native, 'Set PG_QA_NATIVE_ROOT to the scratch @embedded-postgres/linux-x64/native directory');
assert.ok(process.env.PG_MODULE, 'Set PG_MODULE to the scratch pg/lib/index.js');
const driver = await import(pathToFileURL(path.resolve(process.env.PG_MODULE)).href);
const Client = driver.Client || driver.default.Client;
const directory = await mkdtemp(path.join(os.tmpdir(), 'comichuddle-pg-qa-'));
const data = path.join(directory, 'data'), socket = path.join(directory, 'socket');
await mkdir(data, {mode: 0o700}); await mkdir(socket, {mode: 0o700}); await chmod(directory, 0o700);
const rootUser = process.getuid?.() === 0;
const environment = {...process.env, LD_LIBRARY_PATH: path.join(native, 'lib'),
  PG_QA_SOCKET: socket, PG_QA_PORT: '15436'};
const binary = (name, args) => rootUser
  ? {command: 'runuser', args: ['-u', 'nobody', '--', path.join(native, 'bin', name), ...args]}
  : {command: path.join(native, 'bin', name), args};
let server, serverLog = '', failed = false;
try {
  if (rootUser) for (const item of [directory, data, socket]) await chown(item, 65534, 65534);
  const initialization = binary('initdb', ['-D', data, '--auth-local=trust', '--auth-host=reject',
    '--username=qa_owner', '--encoding=UTF8', '--no-locale']);
  const initialized = spawnSync(initialization.command, initialization.args, {env: environment, encoding: 'utf8'});
  assert.equal(initialized.status, 0, initialized.stderr);
  const start = binary('postgres', ['-D', data, '-k', socket, '-p', '15436',
    '-c', 'listen_addresses=', '-c', 'max_connections=20']);
  server = spawn(start.command, start.args, {env: environment, stdio: ['ignore', 'pipe', 'pipe']});
  server.stdout.on('data', chunk => {serverLog += chunk;}); server.stderr.on('data', chunk => {serverLog += chunk;});
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const client = new Client({host: socket, port: 15436, user: 'qa_owner', database: 'postgres', connectionTimeoutMillis: 500});
    try {await client.connect(); ready = true; await client.end(); break;}
    catch {await client.end(); await new Promise(resolve => setTimeout(resolve, 250));}
  }
  assert.ok(ready, 'Disposable PostgreSQL startup failed: ' + serverLog);
  console.log('POSTGRES_TEST_SERVER native18.4 socket-only; no TCP listener; disposable nonservice process');
  const suites = process.argv.slice(2);
  if (!suites.length) suites.push(path.resolve('architecture/platform-v2/tests/integration.mjs'));
  let suiteNumber=0;
  for (const suite of suites) {
    const databaseName='qa_suite_'+suiteNumber++;
    const admin=new Client({host:socket,port:15436,user:'qa_owner',database:'postgres'});
    await admin.connect();await admin.query('CREATE DATABASE '+databaseName);await admin.end();
    const file = path.resolve('architecture/postgres/tests', suite);
    console.log('\nRUN ' + path.basename(file));
    const result = await new Promise(resolve => {
      const child = spawn(process.execPath, [file], {env: {...environment,PG_QA_DATABASE:databaseName}, stdio: 'inherit'});
      child.once('error', error => resolve({code: 1, error}));
      child.once('exit', code => resolve({code}));
    });
    if (result.code !== 0) failed = true;
  }
} catch (error) {console.error(error.stack); failed = true;}
finally {
  if (server) {
    const stop = binary('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    spawnSync(stop.command, stop.args, {env: environment, encoding: 'utf8', timeout: 10000});
    if (server.exitCode === null) server.kill('SIGTERM');
  }
  await writeFile(path.resolve('architecture/platform-v2/tests/postgres-server.log'), serverLog);
  await rm(directory, {recursive: true, force: true});
}
if (failed) process.exitCode = 1;
