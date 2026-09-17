import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { prepareRuntime, RUNTIME_FILES } from './marketplace/marketplace.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coohom-marketplace-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceRoot = path.join(directory, 'plugin 中文 with spaces');
  const cacheRoot = path.join(directory, 'cache 中文 with spaces');
  await fs.mkdir(path.join(sourceRoot, '.codex-plugin'), { recursive: true });
  await fs.mkdir(path.join(sourceRoot, 'scripts/mcp'), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'coohom-freeform', version: '0.1.6+codex.20260917000000' }));
  await fs.copyFile(path.join(here, 'marketplace/marketplace.mjs'), path.join(sourceRoot, 'scripts/marketplace.mjs'));
  for (const name of RUNTIME_FILES) await fs.writeFile(path.join(sourceRoot, 'scripts/mcp', name), '{}');
  const attempts = path.join(directory, 'attempts.txt');
  const fail = path.join(directory, 'fail');
  for (const [service, symbol] of [['freeform', 'installFreeform'], ['lux3d', 'installLux3d']]) {
    await fs.writeFile(path.join(sourceRoot, 'scripts/mcp', `update-${service}.mjs`), `
import * as fs from 'node:fs/promises';
import path from 'node:path';
export async function ${symbol}(options) {
  await fs.appendFile(${JSON.stringify(attempts)}, '${service}\\n');
  await new Promise(resolve => setTimeout(resolve, 250));
  if (await fs.access(${JSON.stringify(fail)}).then(() => true, () => false)) throw new Error('fixture download failure');
  await fs.writeFile(path.join(options.pluginRoot, 'runtime/mcp/${service}-install.json'), JSON.stringify({version:'1.0.0', node:options.nodeExecutable, npm:options.npmCliPath}));
}
`);
  }
  return { directory, sourceRoot, cacheRoot, attempts, fail, npmCliPath: path.join(directory, 'npm-cli.js') };
}

test('concurrent cold starts install once and warm starts preserve the runtime without downloading', async t => {
  const f = await fixture(t);
  const options = { ...f, service: 'freeform' };
  const paths = await Promise.all([prepareRuntime(options), prepareRuntime(options), prepareRuntime(options)]);
  assert.equal(new Set(paths).size, 1);
  assert.equal(await fs.readFile(f.attempts, 'utf8'), 'freeform\n');
  await fs.writeFile(f.fail, 'would fail if npm ran again');
  assert.equal(await prepareRuntime(options), paths[0]);
  const record = JSON.parse(await fs.readFile(path.join(paths[0], 'runtime/mcp/freeform-install.json'), 'utf8'));
  assert.equal(record.node, process.execPath);
  assert.equal(record.npm, f.npmCliPath);
  assert.equal(await fs.readFile(f.attempts, 'utf8'), 'freeform\n');
  assert.deepEqual((await fs.readdir(path.dirname(paths[0]))).sort(), ['freeform']);
});

test('failed preparation publishes no runtime and a later retry succeeds', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.fail, 'fail');
  await assert.rejects(prepareRuntime({ ...f, service: 'lux3d' }), /fixture download failure/);
  const [revision] = await fs.readdir(path.join(f.cacheRoot, 'plugins'));
  assert.deepEqual(await fs.readdir(path.join(f.cacheRoot, 'plugins', revision)), []);
  await fs.unlink(f.fail);
  const destination = await prepareRuntime({ ...f, service: 'lux3d' });
  assert.equal(JSON.parse(await fs.readFile(path.join(destination, '.ready.json'), 'utf8')).service, 'lux3d');
  assert.equal(await fs.readFile(f.attempts, 'utf8'), 'lux3d\nlux3d\n');
});

test('services and changed runtime sources use independent immutable installations', async t => {
  const f = await fixture(t);
  const first = await prepareRuntime({ ...f, service: 'freeform' });
  const lux = await prepareRuntime({ ...f, service: 'lux3d' });
  assert.notEqual(first, lux);
  await fs.writeFile(path.join(f.sourceRoot, 'scripts/mcp/freeform-policy.json'), '{"changed":true}');
  const next = await prepareRuntime({ ...f, service: 'freeform' });
  assert.notEqual(first, next);
  await fs.access(path.join(first, '.ready.json'));
  assert.equal(await fs.readFile(f.attempts, 'utf8'), 'freeform\nlux3d\nfreeform\n');
});

test('unsupported service is rejected before creating any cache', async t => {
  const f = await fixture(t);
  await assert.rejects(prepareRuntime({ ...f, service: '../other' }), /Expected freeform or lux3d/);
  await assert.rejects(fs.access(f.cacheRoot), { code: 'ENOENT' });
});

test('Windows system bootstrap forwards Unicode MCP traffic with an empty PATH and no system Node', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  for (const name of ['bootstrap.cmd', 'bootstrap.ps1', 'node-runtime.tsv']) {
    await fs.copyFile(path.join(here, 'marketplace', name), path.join(f.sourceRoot, 'scripts', name));
  }
  const policy = (await fs.readFile(path.join(here, 'marketplace/node-runtime.tsv'), 'utf8')).split('\n');
  const version = policy.find(line => line.startsWith('version\t')).split('\t')[1];
  const sha = policy.find(line => line.startsWith('win32-x64\t')).split('\t')[2];
  const nodeRoot = path.join(f.cacheRoot, 'node', `node-v${version}-win-x64`);
  await fs.mkdir(path.join(nodeRoot, 'node_modules/npm/bin'), { recursive: true });
  await fs.copyFile(process.execPath, path.join(nodeRoot, 'node.exe'));
  await fs.writeFile(path.join(nodeRoot, 'node_modules/npm/bin/npm-cli.js'), '');
  await fs.writeFile(path.join(nodeRoot, '.coohom-sha256'), sha);
  await fs.writeFile(path.join(f.sourceRoot, 'scripts/marketplace.mjs'), `
import readline from 'node:readline';
for await (const line of readline.createInterface({input:process.stdin})) {
 const m=JSON.parse(line); process.stdout.write(JSON.stringify({id:m.id, result:{text:'中文回复', service:process.argv[2]}})+'\\n');
}
`);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (['path', 'processor_architecture', 'processor_architew6432'].includes(key.toLowerCase())) delete env[key];
  }
  Object.assign(env, { PATH: '', COOHOM_FREEFORM_CACHE: f.cacheRoot });
  const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(f.sourceRoot, 'scripts/bootstrap.ps1'), 'lux3d',
  ], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  child.stdin.end('{"id":7,"method":"probe","text":"中文输入"}\n');
  const timer = setTimeout(() => child.kill(), 20_000);
  const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  clearTimeout(timer);
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), { id: 7, result: { text: '中文回复', service: 'lux3d' } });
  assert.equal(stderr, '');
});

for (const failure of ['download', 'checksum']) {
  test(`Windows ${failure} failure removes partial Node files and permits a fresh attempt`, { skip: process.platform !== 'win32' }, async t => {
    const f = await fixture(t);
    for (const name of ['bootstrap.ps1', 'node-runtime.tsv']) {
      await fs.copyFile(path.join(here, 'marketplace', name), path.join(f.sourceRoot, 'scripts', name));
    }
    const wrapper = path.join(f.directory, 'download-fixture.ps1');
    await fs.writeFile(wrapper, `\uFEFF
$ErrorActionPreference = 'Stop'
function Invoke-WebRequest {
  param($Uri, $OutFile, $TimeoutSec, [switch]$UseBasicParsing)
  [Console]::Error.WriteLine('fixture-download-attempt')
  [System.IO.File]::WriteAllText($OutFile, 'incomplete or corrupt archive')
  ${failure === 'download' ? "throw 'fixture network failure'" : ''}
}

& (Join-Path $PSScriptRoot 'plugin 中文 with spaces/scripts/bootstrap.ps1') freeform
exit $LASTEXITCODE
`, 'utf8');
    for (let attempt = 0; attempt < 2; attempt++) {
      const env = { ...process.env, COOHOM_FREEFORM_CACHE: f.cacheRoot };
      for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
      const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper,
      ], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
      assert.equal(code, 1, stderr);
      assert.equal(stdout, '');
      assert.match(stderr, /fixture-download-attempt/);
      assert.match(stderr, failure === 'download' ? /fixture network failure/ : /SHA256 mismatch/);
      const entries = await fs.readdir(path.join(f.cacheRoot, 'node'));
      assert.equal(entries.length, 1);
      assert.match(entries[0], /^win-x64-.*\.lock$/);
    }
  });
}

test('macOS system bootstrap forwards MCP traffic without a Node directory on PATH', { skip: process.platform !== 'darwin' || process.arch !== 'arm64' }, async t => {
  const f = await fixture(t);
  for (const name of ['bootstrap', 'node-runtime.tsv']) {
    await fs.copyFile(path.join(here, 'marketplace', name), path.join(f.sourceRoot, 'scripts', name));
  }
  const script = path.join(f.sourceRoot, 'scripts/bootstrap');
  await fs.chmod(script, 0o755);
  const policy = (await fs.readFile(path.join(here, 'marketplace/node-runtime.tsv'), 'utf8')).split('\n');
  const version = policy.find(line => line.startsWith('version\t')).split('\t')[1];
  const sha = policy.find(line => line.startsWith('darwin-arm64\t')).split('\t')[2];
  const nodeRoot = path.join(f.cacheRoot, 'node', `node-v${version}-darwin-arm64`);
  await fs.mkdir(path.join(nodeRoot, 'bin'), { recursive: true });
  await fs.mkdir(path.join(nodeRoot, 'lib/node_modules/npm/bin'), { recursive: true });
  await fs.copyFile(process.execPath, path.join(nodeRoot, 'bin/node'));
  await fs.chmod(path.join(nodeRoot, 'bin/node'), 0o755);
  await fs.writeFile(path.join(nodeRoot, 'lib/node_modules/npm/bin/npm-cli.js'), '');
  await fs.writeFile(path.join(nodeRoot, '.coohom-sha256'), sha);
  await fs.writeFile(path.join(f.sourceRoot, 'scripts/marketplace.mjs'), `
import readline from 'node:readline';
for await (const line of readline.createInterface({input:process.stdin})) {
 const m=JSON.parse(line); process.stdout.write(JSON.stringify({id:m.id,result:{text:'中文回复',service:process.argv[2]}})+'\\n');
}
`);
  const child = spawn(script, ['freeform'], { env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', COOHOM_FREEFORM_CACHE: f.cacheRoot }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end('{"id":7,"text":"中文输入"}\n');
  const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), { id: 7, result: { text: '中文回复', service: 'freeform' } });
  assert.equal(stderr, '');
});

test('Windows cold bootstrap extracts verified Node into a long Unicode cache path', { skip: process.platform !== 'win32', timeout: 60_000 }, async t => {
  const f = await fixture(t);
  for (const name of ['bootstrap.ps1', 'node-runtime.tsv']) {
    await fs.copyFile(path.join(here, 'marketplace', name), path.join(f.sourceRoot, 'scripts', name));
  }
  await fs.writeFile(path.join(f.sourceRoot, 'scripts/marketplace.mjs'), "process.stdout.write('{\"cold\":true}\\n');");
  const policyPath = path.join(f.sourceRoot, 'scripts/node-runtime.tsv');
  const version = (await fs.readFile(policyPath, 'utf8')).split('\n')[0].split('\t')[1];
  const prefix = `node-v${version}-win-x64`;
  const longMember = `${prefix}/node_modules/npm/node_modules/@npmcli/metavuln-calculator/node_modules/pacote/lib/util/tar-create-options.js`;
  const cacheRoot = path.join(f.cacheRoot, 'nested-cache-directory-for-long-path-verification');
  assert.ok(path.join(cacheRoot, 'node', longMember).length > 260);
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const wrapper = path.join(f.directory, 'cold-fixture.ps1');
  await fs.writeFile(wrapper, `\uFEFF
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$script:fixtureArchive = Join-Path $PSScriptRoot 'fixture.zip'
$zip = [System.IO.Compression.ZipFile]::Open($fixtureArchive, 'Create')
try {
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, ${quote(process.execPath)}, '${prefix}/node.exe') | Out-Null
  $zip.CreateEntry('${prefix}/node_modules/npm/bin/npm-cli.js') | Out-Null
  $zip.CreateEntry('${longMember}') | Out-Null
} finally { $zip.Dispose() }
$sha = (Get-FileHash -LiteralPath $fixtureArchive -Algorithm SHA256).Hash.ToLowerInvariant()
$policyPath = ${quote(policyPath)}
$policy = [System.IO.File]::ReadAllText($policyPath)
$policy = [regex]::Replace($policy, '(?m)^(win32-x64[^\r\n]*\t)[a-f0-9]{64}', { param($m) $m.Groups[1].Value + $sha })
[System.IO.File]::WriteAllText($policyPath, $policy)
function Invoke-WebRequest {
  param($Uri, $OutFile, $TimeoutSec, [switch]$UseBasicParsing)
  [System.IO.File]::Copy(${quote(path.join(f.directory, 'fixture.zip'))}, $OutFile)
}
& ${quote(path.join(f.sourceRoot, 'scripts/bootstrap.ps1'))} freeform
exit $LASTEXITCODE
`, 'utf8');
  const env = { ...process.env, COOHOM_FREEFORM_CACHE: cacheRoot };
  for (const key of Object.keys(env)) if (['path', 'psmodulepath', 'processor_architecture'].includes(key.toLowerCase())) delete env[key];
  env.PATH = '';
  const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper,
  ], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), { cold: true });
  await fs.access(path.join(cacheRoot, 'node', longMember));
  assert.deepEqual((await fs.readdir(path.join(cacheRoot, 'node'))).sort(), [prefix, `win-x64-${version}.lock`].sort());
});
