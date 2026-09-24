import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { runManagement, parseManagementArguments, readManagementStatus } from './management.mjs';
import { doctorPair, checkRuntimePorts } from './management-doctor.mjs';
import { createHost, readMarketplaceConfig } from './management-host.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import { atomicJson, optionalJson, acquireManagementLock, registerLease } from './runtime-state.mjs';
import { cleanupResources, rememberPair, rememberResource, stateDirectory } from './management-resources.mjs';
import { RUNTIME_FILES, prepareRuntime } from './marketplace/marketplace.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const idle = async () => ({ available: true, pids: [] });
const cliCode = `import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
for await (const line of createInterface({input:process.stdin})) {
  const m=JSON.parse(line);
  if(process.env.COOHOM_TEST_REQUESTS) appendFileSync(process.env.COOHOM_TEST_REQUESTS,m.method+'\\n');
  if(!m.id) continue;
  if(process.env.COOHOM_TEST_MODE==='timeout') continue;
  if(process.env.COOHOM_TEST_MODE==='exit') process.exit(4);
  const result=m.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}}}:
    {tools:process.env.COOHOM_TEST_MODE==='empty'?[]:[{name:'fixture_scene',inputSchema:{type:'object'}}]};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
}`;

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coohom-management-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cacheRoot = path.join(root, 'cache with spaces');
  const sourceRoot = path.join(root, 'source'); const candidateRoot = path.join(root, 'candidate');
  for (const [directory, version] of [[sourceRoot, '1.0.0'], [candidateRoot, '2.0.0']]) {
    await fs.mkdir(path.join(directory, '.codex-plugin'), { recursive: true });
    await fs.mkdir(path.join(directory, 'scripts/mcp'), { recursive: true });
    await atomicJson(path.join(directory, '.codex-plugin/plugin.json'), { name: 'coohom-freeform', version });
    for (const name of RUNTIME_FILES) await fs.copyFile(path.join(here, name), path.join(directory, 'scripts/mcp', name));
  }
  await fs.mkdir(stateDirectory(cacheRoot), { recursive: true });
  const f = { root, cacheRoot, sourceRoot, candidateRoot, calls: [], inspect: idle,
    checkPair: (current, options) => doctorPair(current, { ...options, checkPorts: async () => {} }),
    env: { ...process.env, COOHOM_TEST_REQUESTS: path.join(root, 'requests.txt') },
    prepareRuntimeNode: async () => ({ nodeExecutable: process.execPath, npmCliPath: path.join(root, 'npm-cli.js') }) };
  await fs.writeFile(path.join(root, 'npm-cli.js'), '');
  f.installers = Object.fromEntries(['freeform', 'lux3d'].map(service => [service, async ({ pluginRoot, version }) => {
    f.calls.push('install:' + service);
    if (f.fail === service) throw new Error('Fixture download failure');
    const name = service === 'freeform' ? 'freeform-modeling-mcp' : '@manycore/coohom-lux3d-mcp';
    const resolved = version === 'latest' ? '2.0.0' : version;
    const directory = `${service}/install-fixture`;
    const packageRoot = path.join(pluginRoot, 'runtime/mcp', directory, 'node_modules', name);
    await fs.mkdir(packageRoot, { recursive: true });
    await atomicJson(path.join(packageRoot, 'package.json'), { name, version: resolved, bin: 'cli.mjs' });
    await fs.writeFile(path.join(packageRoot, 'cli.mjs'), cliCode);
    return { packageSpec: `${name}@${version}`, version: resolved, directory };
  }]));
  let installedVersion = '1.0.0'; let installedSource = sourceRoot;
  f.host = {
    preflight: async () => {},
    inspect: async () => ({ plugin: { pluginId: 'coohom-freeform@coohom', version: installedVersion }, market: { name: 'coohom', root: sourceRoot }, sourceRoot: installedSource }),
    candidate: async () => ({ sourceRoot: candidateRoot, marketRoot: root, local: true }),
    activate: async (_previous, _candidate, version) => { f.calls.push('activate'); if (f.fail === 'activate') throw new Error('Fixture activation failure'); installedVersion = version; installedSource = candidateRoot; },
    verify: async () => { f.calls.push('verify'); },
    restore: async previous => { f.calls.push('restore'); installedVersion = previous.plugin.version; installedSource = previous.sourceRoot; return { sourceRoot: installedSource }; },
    uninstall: async () => { f.calls.push('uninstall'); },
  };
  f.run = options => runManagement({ ...f, options });
  f.seed = async () => {
    const pluginRoot = path.join(cacheRoot, 'plugins', 'a'.repeat(24), 'pair');
    await fs.mkdir(path.join(pluginRoot, 'runtime/mcp'), { recursive: true });
    await fs.cp(path.join(sourceRoot, 'scripts/mcp'), path.join(pluginRoot, 'runtime/mcp'), { recursive: true });
    const pair = { format: 1, id: 'old', validation: 'installed' };
    for (const service of ['freeform', 'lux3d']) pair[service] = { ...await f.installers[service]({ pluginRoot, version: '1.0.0' }), npmCliPath: path.join(root, 'npm-cli.js') };
    await atomicJson(path.join(pluginRoot, 'runtime/mcp/mcp-pair.json'), pair);
    f.current = { pluginRoot, pair, sourceRoot, pluginVersion: '1.0.0', nodeExecutable: process.execPath, npmCliPath: path.join(root, 'npm-cli.js') };
    await atomicJson(path.join(stateDirectory(cacheRoot), 'current.json'), f.current);
    await rememberPair(cacheRoot, pluginRoot, pair); f.calls.length = 0;
  };
  return f;
}

test('argument parsing defaults to full upgrade and keeps deletion explicit', () => {
  assert.equal(parseManagementArguments(['upgrade']).scope, 'all');
  assert.equal(parseManagementArguments(['cleanup']).apply, false);
  assert.equal(parseManagementArguments(['cleanup', '--apply']).apply, true);
  assert.throws(() => parseManagementArguments(['status', '--apply']));
  assert.throws(() => parseManagementArguments(['upgrade', '--scope', 'unknown']));
});

test('legacy pair migration on startup preserves exact dependencies without npm', async t => {
  const f = await fixture(t); await f.seed();
  await fs.unlink(path.join(stateDirectory(f.cacheRoot), 'current.json'));
  await atomicJson(path.join(stateDirectory(f.cacheRoot), 'mcp-install-state.json'), { status: 'ready', pairId: f.current.pair.id });
  const result = await prepareRuntime({ ...f, service: 'freeform' });
  assert.equal(result, f.current.pluginRoot);
  assert.equal((await optionalJson(path.join(stateDirectory(f.cacheRoot), 'current.json'))).pair.id, 'old');
  assert.deepEqual(f.calls, []);
});

test('unified retry also handles the existing dependency installation failure record', async t => {
  const f = await fixture(t); await f.seed();
  await atomicJson(path.join(stateDirectory(f.cacheRoot), 'mcp-install-state.json'), {
    status: 'failed', attempts: 1, requested: { freeform: 'latest', lux3d: 'latest' }, service: 'freeform', reason: 'Fixture failure' });
  const result = await f.run({ action: 'retry' });
  assert.equal(result.status, 'installed'); assert.equal(result.current.pair.freeform.version, '2.0.0');
  assert.ok(!f.calls.includes('activate'));
});

test('status with missing cache performs no writes and no installs', async t => {
  const f = await fixture(t); const cacheRoot = path.join(f.root, 'absent');
  const status = await readManagementStatus({ ...f, cacheRoot });
  assert.equal(status.validation, 'missing');
  await assert.rejects(fs.access(cacheRoot), { code: 'ENOENT' });
  assert.deepEqual(f.calls, []);
});

test('a legacy ready record is installed, not initialized, and status does not migrate it', async t => {
  const f = await fixture(t); await f.seed();
  await fs.unlink(path.join(stateDirectory(f.cacheRoot), 'current.json'));
  const status = await f.run({ action: 'status' });
  assert.equal(status.validation, 'installed'); assert.equal(status.current.legacy, true);
  await assert.rejects(fs.access(path.join(stateDirectory(f.cacheRoot), 'current.json')), { code: 'ENOENT' });
});

test('full upgrade checks both servers before activation and automatically removes old resources', async t => {
  const f = await fixture(t); await f.seed();
  const result = await f.run({ action: 'upgrade', scope: 'all', source: f.candidateRoot });
  assert.equal(result.status, 'succeeded'); assert.equal(result.check.validation, 'initialized');
  assert.deepEqual(f.calls, ['install:freeform', 'install:lux3d', 'activate']);
  await assert.rejects(fs.access(f.current.pluginRoot), { code: 'ENOENT' });
  await fs.access(result.current.pluginRoot);
  const methods = (await fs.readFile(f.env.COOHOM_TEST_REQUESTS, 'utf8')).trim().split('\n');
  assert.equal(methods.filter(m => m === 'initialize').length, 2);
  assert.ok(methods.every(m => ['initialize', 'notifications/initialized', 'tools/list'].includes(m)));
  assert.equal(result.restartRequired, true);
});

for (const failedStage of ['freeform', 'lux3d', 'activate']) {
  test(`failure at ${failedStage} preserves current installation until explicit resume`, async t => {
    const f = await fixture(t); await f.seed(); f.fail = failedStage;
    await assert.rejects(f.run({ action: 'upgrade', scope: 'all' }), /Choose retry, resume-current, or stop/);
    assert.ok(!f.calls.includes('restore')); await fs.access(f.current.pluginRoot);
    await assert.rejects(f.run({ action: 'upgrade', scope: 'all' }), /needs a choice/);
    assert.equal((await optionalJson(path.join(stateDirectory(f.cacheRoot), 'current.json'))).pair.id, 'old');
    const result = await f.run({ action: 'resume-current' });
    assert.equal(result.status, 'resumed'); assert.ok(f.calls.includes('restore'));
  });
}

test('explicit retry preserves the request and installs only after the user decision', async t => {
  const f = await fixture(t); await f.seed(); f.fail = 'freeform';
  await assert.rejects(f.run({ action: 'upgrade', scope: 'all', source: f.candidateRoot }));
  f.fail = undefined;
  const result = await f.run({ action: 'retry' }); assert.equal(result.status, 'succeeded');
  assert.equal((await optionalJson(path.join(stateDirectory(f.cacheRoot), 'operation.json'))).attempts, 2);
});

test('plugin-only upgrade reuses exact dependencies without npm', async t => {
  const f = await fixture(t); await f.seed();
  const result = await f.run({ action: 'upgrade', scope: 'plugin' });
  assert.equal(result.current.pair.freeform.version, '1.0.0'); assert.equal(result.current.pair.lux3d.version, '1.0.0');
  assert.deepEqual(f.calls, ['activate']);
});

test('MCP-only upgrade leaves plugin registration unchanged', async t => {
  const f = await fixture(t); await f.seed();
  const result = await f.run({ action: 'upgrade', scope: 'mcp' });
  assert.equal(result.current.pluginVersion, '1.0.0'); assert.ok(!f.calls.includes('activate'));
  assert.ok(f.calls.includes('verify'));
});

test('busy resources stop upgrade before downloading or changing registration', async t => {
  const f = await fixture(t); await f.seed(); f.inspect = async () => ({ available: true, pids: [123] });
  await assert.rejects(f.run({ action: 'upgrade' }), /in use/); assert.deepEqual(f.calls, []);
});

test('cleanup preview is read-only and current resources are protected', async t => {
  const f = await fixture(t); await f.seed();
  const unused = path.join(f.cacheRoot, 'operations', 'unused'); await fs.mkdir(unused, { recursive: true });
  await fs.writeFile(path.join(unused, 'payload'), '1234'); await rememberResource(f.cacheRoot, unused, 'transaction');
  const preview = await f.run({ action: 'cleanup' });
  assert.equal(preview.candidates[0].bytes, 4); await fs.access(unused);
  const applied = await f.run({ action: 'cleanup', apply: true });
  assert.ok(applied.deleted.includes(unused)); await fs.access(f.current.pluginRoot);
});

test('cleanup rechecks process ownership and defers resources that become busy', async t => {
  const f = await fixture(t); const unused = path.join(f.cacheRoot, 'operations', 'unused');
  await fs.mkdir(unused, { recursive: true }); await rememberResource(f.cacheRoot, unused, 'transaction');
  let scans = 0;
  const result = await cleanupResources(f.cacheRoot, { apply: true, inspect: async () => ({ available: true, pids: ++scans === 1 ? [] : [123] }) });
  assert.equal(result.complete, false); assert.deepEqual(result.deleted, []); await fs.access(unused);
});

test('cleanup refuses redirected paths and never touches the target', async t => {
  const f = await fixture(t); const outside = path.join(f.root, 'user-scenes'); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'scene'), 'keep'); const redirected = path.join(f.cacheRoot, 'redirect');
  await fs.symlink(outside, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  await atomicJson(path.join(stateDirectory(f.cacheRoot), 'resources.json'), [{ path: redirected, kind: 'pair', owner: 'coohom-freeform' }]);
  const result = await cleanupResources(f.cacheRoot, { apply: true, inspect: idle });
  assert.equal(result.complete, false); assert.equal(await fs.readFile(path.join(outside, 'scene'), 'utf8'), 'keep');
});

test('live leases prevent dependency mutation and failed transactions retain recovery files', async t => {
  const f = await fixture(t); await f.seed(); const release = await registerLease(stateDirectory(f.cacheRoot), f.current.pluginRoot, 'freeform');
  await assert.rejects(f.run({ action: 'upgrade' }), /in use/); await release();
  f.fail = 'freeform'; await assert.rejects(f.run({ action: 'upgrade' }));
  const operation = await optionalJson(path.join(stateDirectory(f.cacheRoot), 'operation.json'));
  await f.run({ action: 'cleanup', apply: true }); await fs.access(operation.directory); await fs.access(f.current.pluginRoot);
});

test('shared management lock serializes cleanup and installation', async t => {
  const f = await fixture(t); const release = await acquireManagementLock(stateDirectory(f.cacheRoot));
  await assert.rejects(runManagement({ ...f, options: { action: 'cleanup', apply: true }, lockTimeoutMs: 10 }), /running/);
  await release();
});

test('uninstall uses official host operation and keeps cache until explicit cleanup', async t => {
  const f = await fixture(t); await f.seed();
  const result = await f.run({ action: 'uninstall' }); assert.equal(result.cacheRetained, true); assert.ok(f.calls.includes('uninstall'));
  await fs.access(f.current.pluginRoot);
  const preview = await f.run({ action: 'cleanup', purgeCache: true }); assert.ok(preview.candidates.length);
  await f.run({ action: 'cleanup', purgeCache: true, apply: true }); await assert.rejects(fs.access(f.current.pluginRoot), { code: 'ENOENT' });
});

for (const mode of ['timeout', 'empty', 'exit']) {
  test(`doctor reports ${mode} without treating it as an installation failure`, async t => {
    const f = await fixture(t); await f.seed();
    await assert.rejects(doctorPair(f.current, { env: { ...f.env, COOHOM_TEST_MODE: mode }, timeoutMs: 800, checkPorts: async () => {} }), /timed out|no tools|exited/);
    await fs.access(f.current.pluginRoot);
  });
}

test('Windows management status with no Node is read-only and accepts --json', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t); const cacheRoot = path.join(f.root, 'missing-node');
  const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = await new Promise(resolve => {
    const child = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'marketplace/manage.ps1'), 'status', '--json'], { env: { ...process.env, COOHOM_FREEFORM_CACHE: cacheRoot }, windowsHide: true });
    let stdout = '', stderr = ''; child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).nodeAvailable, false);
  await assert.rejects(fs.access(cacheRoot), { code: 'ENOENT' });
});

test('exact versions are available only after an explicit failed retry', async t => {
  const f = await fixture(t); await f.seed(); f.fail = 'freeform';
  await assert.rejects(f.run({ action: 'upgrade' }));
  await assert.rejects(f.run({ action: 'retry', versions: { freeform: '1.5.0', lux3d: '1.6.0' } }), /only after/);
  await assert.rejects(f.run({ action: 'retry' })); f.fail = undefined;
  const result = await f.run({ action: 'retry', versions: { freeform: '1.5.0', lux3d: '1.6.0' } });
  assert.equal(result.current.pair.freeform.version, '1.5.0'); assert.equal(result.current.pair.lux3d.version, '1.6.0');
});

test('a failed readiness check leaves the prior installation and registration unchanged', async t => {
  const f = await fixture(t); await f.seed(); f.checkPair = async () => { throw new Error('Fixture startup timeout'); };
  await assert.rejects(f.run({ action: 'upgrade' }), /startup timeout/);
  assert.ok(!f.calls.includes('activate')); await fs.access(f.current.pluginRoot);
});

test('cleanup failure is reported separately from successful activation', async t => {
  const f = await fixture(t); await f.seed(); let scans = 0;
  f.inspect = async () => ({ available: ++scans === 1, pids: [] });
  const result = await f.run({ action: 'upgrade' });
  assert.equal(result.status, 'succeeded'); assert.equal(result.cleanup.complete, false); await fs.access(f.current.pluginRoot);
});

test('an interrupted upgrade blocks ordinary startup until an explicit decision', async t => {
  const f = await fixture(t); await f.seed();
  await atomicJson(path.join(stateDirectory(f.cacheRoot), 'operation.json'), { status: 'running', stage: 'activation', previous: f.current });
  const { prepareRuntime } = await import('./marketplace/marketplace.mjs');
  await assert.rejects(prepareRuntime({ ...f, service: 'freeform' }), /explicit choice/);
  assert.deepEqual(f.calls, []);
});

test('explicit retry recovers a verified dead lock and ordinary startup cannot clear it', async t => {
  const f = await fixture(t); await f.seed(); f.fail = 'freeform';
  await assert.rejects(f.run({ action: 'upgrade' })); f.fail = undefined;
  const child = spawn(process.execPath, ['-e', ''], { windowsHide: true });
  await new Promise(resolve => child.once('close', resolve));
  const lock = path.join(stateDirectory(f.cacheRoot), '.mcp-pair.lock');
  await atomicJson(lock, { pid: child.pid, token: 'interrupted-fixture' });
  await assert.rejects(acquireManagementLock(stateDirectory(f.cacheRoot), 10), /Interrupted/);
  await fs.access(lock);
  const result = await f.run({ action: 'retry' }); assert.equal(result.status, 'succeeded');
  await assert.rejects(fs.access(lock), { code: 'ENOENT' });
});

test('configured port conflicts fail before spawning a probe', async t => {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(checkRuntimePorts({ LUX3D_MCP_BRIDGE_PORT: String(server.address().port) }), /occupied|unavailable/);
});

test('macOS management status does not prepare a missing Node runtime', { skip: process.platform !== 'darwin' || process.arch !== 'arm64' }, async t => {
  const f = await fixture(t); const cacheRoot = path.join(f.root, 'missing-node');
  const { stdout } = await promisify(execFile)('/bin/sh', [path.join(here, 'marketplace/manage'), 'status', '--json'], { env: { ...process.env, COOHOM_FREEFORM_CACHE: cacheRoot } });
  assert.equal(JSON.parse(stdout).nodeAvailable, false); await assert.rejects(fs.access(cacheRoot), { code: 'ENOENT' });
});

test('official Codex CLI verifies local upgrade and explicit original-source restoration in an isolated profile', { skip: !process.env.COOHOM_TEST_CODEX }, async t => {
  const f = await fixture(t); const env = { ...process.env, CODEX_HOME: path.join(f.root, 'codex-home') };
  await fs.mkdir(env.CODEX_HOME);
  const invoke = async args => JSON.parse((await promisify(execFile)(process.env.COOHOM_TEST_CODEX, [...args, '--json'], { env, windowsHide: true, timeout: 30000 })).stdout);
  const roots = [];
  for (const [name, version] of [['old', '1.0.0'], ['new', '2.0.0']]) {
    const root = path.join(f.root, name); const source = path.join(root, 'plugins/coohom-freeform'); roots.push(root);
    await fs.mkdir(path.join(root, '.agents/plugins'), { recursive: true }); await fs.mkdir(path.join(source, '.codex-plugin'), { recursive: true });
    await fs.mkdir(path.join(source, 'scripts'));
    await atomicJson(path.join(source, '.codex-plugin/plugin.json'), { name: 'coohom-freeform', version, description: 'Isolated installation management acceptance', mcpServers: './.mcp.json' });
    await atomicJson(path.join(source, '.mcp.json'), { mcpServers: {} });
    await fs.writeFile(path.join(source, 'scripts/bootstrap'), '#!/bin/sh\nexit 0\n');
    await fs.writeFile(path.join(source, 'scripts/marketplace.mjs'), '// isolated\n');
    await atomicJson(path.join(root, '.agents/plugins/marketplace.json'), { name: 'coohom-test', plugins: [{ name: 'coohom-freeform', source: { source: 'local', path: './plugins/coohom-freeform' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] });
  }
  await promisify(execFile)('git', ['init', roots[0]], { windowsHide: true });
  await promisify(execFile)('git', ['-C', roots[0], 'remote', 'add', 'origin', 'https://example.invalid/local-is-still-local.git'], { windowsHide: true });
  await invoke(['plugin', 'marketplace', 'add', roots[0]]); await invoke(['plugin', 'add', 'coohom-freeform@coohom-test']);
  const host = await createHost({ env, cli: { command: process.env.COOHOM_TEST_CODEX } });
  await host.preflight();
  let previous;
  try { previous = await host.inspect(); }
  catch (error) {
    t.diagnostic(JSON.stringify({ configured: await readMarketplaceConfig({ command: process.env.COOHOM_TEST_CODEX }, env, 'coohom-test'), markets: await invoke(['plugin', 'marketplace', 'list']) }));
    throw error;
  }
  assert.equal(previous.git, undefined);
  await assert.rejects(host.candidate(previous), /local installation requires/);
  const snapshot = path.join(f.root, 'previous-snapshot'); await fs.cp(previous.sourceRoot, snapshot, { recursive: true });
  const candidate = await host.candidate(previous, roots[1]);
  try { await host.activate(previous, candidate, '2.0.0'); }
  catch (error) { throw new Error(error.cause?.stderr ?? error.message); } // Synthetic isolated CLI fixture only.
  assert.equal((await host.inspect()).plugin.version, '2.0.0');
  await host.restore(previous, snapshot); assert.equal((await host.inspect()).plugin.version, '1.0.0');
  const originalBootstrap = path.join(previous.sourceRoot, 'scripts/bootstrap');
  await fs.writeFile(originalBootstrap, '#!/bin/sh\nexit 9\n');
  await assert.rejects(host.restore(previous, snapshot), /differs/);
  assert.equal((await host.inspect()).plugin.version, '1.0.0');
  await fs.copyFile(path.join(snapshot, 'scripts/bootstrap'), originalBootstrap);
  await host.uninstall(await host.inspect());
  await invoke(['plugin', 'marketplace', 'remove', 'coohom-test']);
  const git = args => promisify(execFile)('git', ['-C', roots[0], '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { windowsHide: true });
  await git(['add', '.']); await git(['commit', '-m', 'old fixture']);
  await git(['branch', '-M', 'fixture']);
  const remote = 'https://example.invalid/coohom-management-fixture.git';
  // A synthetic HTTPS source rewritten by Git into the local fixture. No network.
  env.GIT_CONFIG_COUNT = '1';
  env.GIT_CONFIG_KEY_0 = `url.${pathToFileURL(roots[0]).href}.insteadOf`;
  env.GIT_CONFIG_VALUE_0 = remote;
  await invoke(['plugin', 'marketplace', 'add', remote, '--ref', 'fixture']);
  await invoke(['plugin', 'add', 'coohom-freeform@coohom-test']);
  const gitPrevious = await host.inspect(); assert.equal(gitPrevious.git.url, remote);
  const manifestFile = path.join(roots[0], 'plugins/coohom-freeform/.codex-plugin/plugin.json');
  await atomicJson(manifestFile, { ...await optionalJson(manifestFile), version: '2.0.0' });
  await git(['add', '.']); await git(['commit', '-m', 'new fixture']);
  const transaction = path.join(f.root, 'transaction'); await fs.mkdir(transaction);
  const gitCandidate = await host.candidate(gitPrevious, undefined, transaction);
  assert.equal((await host.inspect()).plugin.version, '1.0.0', 'candidate staging must not refresh the installed plugin');
  await host.activate(gitPrevious, gitCandidate, '2.0.0');
  assert.equal((await host.inspect()).plugin.version, '2.0.0');
  await host.restore(gitPrevious); assert.equal((await host.inspect()).plugin.version, '1.0.0');
  await host.uninstall(await host.inspect());
});
