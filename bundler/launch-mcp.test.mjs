import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const here = path.dirname(fileURLToPath(import.meta.url));
async function fixture(t, { bin = 'different-entry.cjs', version = '9.4.0', cli = "process.stdout.write(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),offline:process.env.npm_config_offline}));" } = {}) {
  // macOS temporary paths may be aliases; launch this fixture through its real path.
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'coohom public 中文 '));
  t.after(() => fs.rm(root, {recursive:true,force:true}));
  const runtime = path.join(root, 'runtime/mcp');
  const installation = path.join(runtime, 'freeform/install-fixture');
  const pkg = path.join(installation, 'node_modules/freeform-modeling-mcp');
  await fs.mkdir(pkg,{recursive:true});
  for (const name of ['launch-mcp.mjs','runtime-contract.mjs']) await fs.copyFile(path.join(here,name),path.join(runtime,name));
  const npm = path.join(root, 'runtime/node/npm/bin');
  await fs.mkdir(npm,{recursive:true});
  await fs.writeFile(path.join(npm,'npm-cli.js'),'');
  await fs.writeFile(path.join(npm,'npx-cli.js'),"process.stdout.write(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),offline:process.env.npm_config_offline}));");
  await fs.writeFile(path.join(pkg,'package.json'),JSON.stringify({name:'freeform-modeling-mcp',version,bin}));
  if (bin && !bin.startsWith('..')) await fs.writeFile(path.join(pkg,bin),cli);
  const record = {packageSpec:'freeform-modeling-mcp@latest',version,directory:'freeform/install-fixture'};
  const pointer = path.join(runtime,'freeform-install.json');
  await fs.writeFile(pointer,JSON.stringify(record));
  return {root,runtime,installation,pointer,record};
}
function run(f,args=[],input='') {
  return new Promise((resolve,reject)=>{
    const env = {...process.env};
    for (const k of Object.keys(env)) if (['path','node_options','node_path'].includes(k.toLowerCase())) delete env[k];
    env.PATH='';
    const child=spawn(process.execPath,[path.join(f.runtime,'launch-mcp.mjs'),...args],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const stdout=[],stderr=[];
    child.stdout.on('data',c=>stdout.push(c));child.stderr.on('data',c=>stderr.push(c));
    const timeout=setTimeout(()=>child.kill(),10000);
    child.once('error',reject);child.once('close',code=>{clearTimeout(timeout);resolve({code,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr).toString()});});
    child.stdin.end(input);
  });
}
for (const args of [[],['start','--stdio'],['status'],['port','--url']]) test(`public bin preserves command ${args}`,async t=>{
  const f=await fixture(t);const out=await run(f,args);
  assert.equal(out.code,0,out.stderr);
  assert.deepEqual(JSON.parse(out.stdout),{args:args.length?args:['start','--stdio'],cwd:f.installation,offline:'true'});
  assert.equal(out.stderr,'');
});
test('changed wrapper can invoke bundled npx with no global Node and no network',async t=>{
  const f=await fixture(t,{cli:`const {spawnSync}=require('node:child_process');
const result=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['tsx','any-public-path','--stdio'],{stdio:'inherit',shell:process.platform==='win32'});process.exit(result.status??1);`});
  const out=await run(f);assert.equal(out.code,0,out.stderr);
  assert.deepEqual(JSON.parse(out.stdout).args,['tsx','any-public-path','--stdio']);
  assert.equal(JSON.parse(out.stdout).offline,'true');
});
test('stdio bytes and child exit status survive',async t=>{
  const f=await fixture(t,{cli:'process.stdin.pipe(process.stdout);'});const bytes=Buffer.from([0,10,13,128,255]);
  assert.deepEqual((await run(f,[],bytes)).stdout,bytes);
  const failed=await fixture(t,{cli:'process.exit(23);'});assert.equal((await run(failed)).code,23);
});
test('missing, escaping and mismatched bin/records fail before execution',async t=>{
  for (const options of [{bin:null},{bin:'../escape.cjs'},{version:'invalid'}]) {
    const f=await fixture(t,options);assert.equal((await run(f)).code,1);
  }
  const f=await fixture(t);
  await fs.writeFile(f.pointer,JSON.stringify({...f.record,version:'1.0.0'}));
  assert.equal((await run(f)).code,1);
});
test('failed upgrade prevents silent launch of the retained previous pair',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.runtime,'mcp-install-state.json'),'{"status":"failed"}');
  const out=await run(f);assert.equal(out.code,1);assert.match(out.stderr,/explicitly retry/);assert.equal(out.stdout.length,0);
});
test('invalid command and private package errors are not echoed',async t=>{
  const f=await fixture(t,{cli:"throw new Error('private-secret');"});
  for (const args of [[],['--api-key','secret']]) {const out=await run(f,args);assert.equal(out.code,1);assert.doesNotMatch(out.stderr,/private-secret|--api-key/);}
});


test('launcher executes through a directory alias without bypassing its main entry', async t => {
  const f = await fixture(t);
  const alias = path.join(f.root, 'runtime-alias');
  await fs.symlink(f.runtime, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const out = await run({ ...f, runtime: alias });
  assert.equal(out.code, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout).args, ['start', '--stdio']);
});
