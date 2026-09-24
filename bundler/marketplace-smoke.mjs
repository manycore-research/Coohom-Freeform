// Real Codex/local-marketplace acceptance. Never uses the current user's Codex home.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { assertDiscoveredTools, isFreeformLogFile, mcpServerNames, unusedLoopbackPort } from './smoke-contract.mjs';

assert.equal(process.platform, 'win32', 'Run this Windows acceptance script on Windows x64.');
const [cliArgument, outputArgument, ...options] = process.argv.slice(2);
const seedIndex = options.indexOf('--cached-node');
const cachedNode = seedIndex < 0 ? undefined : options[seedIndex + 1];
if (seedIndex >= 0) { assert.ok(cachedNode && !cachedNode.startsWith('--'), '--cached-node requires an existing Node directory.'); options.splice(seedIndex, 2); }
assert.ok(options.every(option => ['--keep-on-failure', '--management'].includes(option)), 'Supported options: --keep-on-failure, --management.');
assert.ok(cliArgument && outputArgument, 'Usage: node bundler/marketplace-smoke.mjs <codex.exe> <report.json>');
const cli = path.resolve(cliArgument);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A separate user profile isolates bridge records, but cannot isolate TCP ports.
// Refuse before downloads when the upstream CLI's default bridge is already active.
const bridgeProbe = net.createServer();
await new Promise((resolve, reject) => {
  bridgeProbe.once('error', error => reject(new Error(
    `Cannot run isolated acceptance: 127.0.0.1:8765 is unavailable (${error.code}). Close the old Coohom tasks or use a clean host; existing services were not stopped.`,
  )));
  bridgeProbe.listen(8765, '127.0.0.1', resolve);
});
await new Promise(resolve => bridgeProbe.close(resolve));
const temporaryParent = path.join(repo, 'tmp');
await fs.mkdir(temporaryParent, { recursive: true });
const root = await fs.mkdtemp(path.join(temporaryParent, 'marketplace-smoke-'));
const profile = path.join(root, 'isolated-user');
const codexHome = path.join(root, 'isolated-codex');
const cache = path.join(root, 'runtime cache 中文');
for (const directory of [profile, codexHome, path.join(root, 'temp')]) await fs.mkdir(directory, { recursive: true });
await fs.writeFile(path.join(codexHome, 'config.toml'), '');
const luxPort = await unusedLoopbackPort();
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (['path', 'node_options', 'node_path', 'codex_home', 'userprofile', 'localappdata', 'appdata', 'coohom_freeform_cache', 'lux3d_mcp_bridge_port', 'lux3d_mcp_executor_url', 'tmp', 'temp'].includes(key.toLowerCase())) delete env[key];
}
Object.assign(env, { PATH: '', CODEX_HOME: codexHome, USERPROFILE: profile,
  RUST_LOG: 'warn,codex_rmcp_client=debug,rmcp=info',
  LOCALAPPDATA: path.join(profile, 'AppData/Local'), APPDATA: path.join(profile, 'AppData/Roaming'),
  COOHOM_FREEFORM_CACHE: cache, LUX3D_MCP_BRIDGE_PORT: String(luxPort), TMP: path.join(root, 'temp'), TEMP: path.join(root, 'temp') });
const manifest = JSON.parse(await fs.readFile(path.join(repo, 'plugins/coohom-freeform/.codex-plugin/plugin.json'), 'utf8'));
const report = { pluginVersion: manifest.version, platform: process.platform, arch: process.arch,
  isolatedCodexHome: true, emptyPath: true, localMarketplace: true, gitHubTransportTested: false,
  userPluginChanged: false, generationOrSceneToolsCalled: false, runs: [] };
const acceptanceStarted = Date.now();

async function management(args) {
  const started = Date.now();
  const script = path.join(repo, 'plugins/coohom-freeform/scripts/manage.ps1');
  const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args, '--json'],
    { cwd: root, env: { ...env, COOHOM_CODEX_CLI: cli }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => process.stderr.write(data));
  const timer = setTimeout(() => child.kill(), 1_200_000);
  const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  clearTimeout(timer);
  const result = JSON.parse(stdout);
  report.management ??= [];
  report.management.push({ action: args[0], elapsedMs: Date.now() - started, result });
  assert.equal(code, 0, result.reason);
  return result;
}

function invoke(args) {
  const result = spawnSync(cli, args, { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  if (result.status !== 0) throw new Error(`Codex ${args.slice(0, 3).join(' ')} failed (${result.status}): ${result.stderr.slice(-1500)}`);
  return JSON.parse(result.stdout);
}

async function probe(label) {
  console.log(`Starting ${label} MCP initialization with an empty PATH.`);
  const started = Date.now();
  const child = spawn(cli, ['app-server', '--stdio'], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const pending = new Map();
  const diagnostics = [];
  let sequence = 0;
  const closed = new Promise(resolve => child.once('close', resolve));
  const lines = createInterface({ input: child.stdout });
  const errors = createInterface({ input: child.stderr });
  errors.on('line', line => {
    const sanitized = line.replace(/\u001b\[[0-9;]*m/g, '').replace(/(?:sk-|ghp_|npm_)[A-Za-z0-9_-]{12,}/g, '[redacted]');
    diagnostics.push(sanitized.slice(-2000));
    if (/stderr|\[coohom-freeform\]|startup.*failed/i.test(line)) console.log(diagnostics.at(-1));
  });
  lines.on('line', line => {
    const message = JSON.parse(line);
    const item = pending.get(message.id);
    if (item) {
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(`${item.method}: ${message.error.message}`));
      else item.resolve(message.result);
    }
  });
  function request(method, params) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 1_220_000);
      pending.set(id, { resolve, reject, timer, method });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  try {
    await request('initialize', { clientInfo: { name: 'coohom-marketplace-acceptance', version: '1.0.0' } });
    child.stdin.write('{"method":"initialized"}\n');
    const result = await request('mcpServerStatus/list', { detail: 'toolsAndAuthOnly' });
    const servers = result.data.filter(server => server.pluginId === 'coohom-freeform@coohom').map(server => ({
      name: server.name, tools: Object.values(server.tools ?? {}),
    }));
    report.runs.push({ label, elapsedMs: Date.now() - started, servers, diagnostics });
    for (const name of mcpServerNames) {
      const server = servers.find(server => server.name === name);
      assert.ok(server, `${label}: missing ${name}`);
      assertDiscoveredTools(name, server.tools);
    }
    assert.equal(servers.length, 2);
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.stdin.end();
    let timer;
    await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, 8000); })]);
    clearTimeout(timer);
    if (child.exitCode === null) {
      spawnSync(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await closed;
    }
    lines.close();
    errors.close();
  }
}

try {
  report.codexVersion = spawnSync(cli, ['--version'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  invoke(['plugin', 'marketplace', 'add', repo, '--json']);
  const installed = invoke(['plugin', 'add', 'coohom-freeform@coohom', '--json']);
  report.installedVersion = installed.version;
  assert.equal(installed.version, manifest.version);
  report.installedMcpConfig = JSON.parse(await fs.readFile(path.join(installed.installedPath, '.mcp.json'), 'utf8'));
  await assert.rejects(fs.access(cache), { code: 'ENOENT' });
  if (cachedNode) {
    const rows = (await fs.readFile(path.join(repo, 'bundler/marketplace/node-runtime.tsv'), 'utf8')).trim().split('\n').map(line => line.trim().split('\t'));
    const version = rows.find(row => row[0] === 'version')[1];
    const expected = rows.find(row => row[0] === 'win32-x64')[2];
    const source = path.resolve(cachedNode);
    assert.equal((await fs.readFile(path.join(source, '.coohom-sha256'), 'utf8')).trim(), expected);
    await fs.access(path.join(source, 'node_modules/npm/bin/npm-cli.js'));
    assert.equal(spawnSync(path.join(source, 'node.exe'), ['--version'], { encoding: 'utf8', windowsHide: true }).stdout.trim(), `v${version}`);
    const destination = path.join(cache, 'node', `node-v${version}-win-x64`);
    await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.cp(source, destination, { recursive: true });
    report.nodePreparation = { mode: 'copied-existing-runtime-with-matching-checksum-marker', version, coldDownloadTested: false };
  } else report.nodePreparation = { mode: 'official-download', coldDownloadTested: true };
  await probe('cold');
  const versions = await fs.readdir(path.join(cache, 'plugins'));
  async function readPairs() {
    const pairs = {};
    for (const revision of versions) {
      const pointer = path.join(cache, 'plugins', revision, 'pair/runtime/mcp/mcp-pair.json');
      try { pairs[revision] = JSON.parse(await fs.readFile(pointer, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    assert.equal(Object.keys(pairs).length, 1, 'Expected one active runtime pair');
    return pairs;
  }
  const pairs = await readPairs();
  const pair = Object.values(pairs)[0];
  assert.ok(pair.freeform?.version && pair.lux3d?.version, 'Both MCP versions must be recorded');
  report.resolvedVersions = { freeform: pair.freeform.version, lux3d: pair.lux3d.version };
  const before = JSON.stringify(pairs);
  await probe('warm');
  assert.equal(JSON.stringify(await readPairs()), before);
  report.warmInstallationRecordsUnchanged = true;
  if (options.includes('--management')) {
    assert.equal((await management(['status'])).validation, 'installed');
    assert.equal((await management(['doctor'])).status, 'passed');
    assert.equal((await management(['status'])).validation, 'initialized');
    const upgraded = await management(['upgrade', '--source', repo]);
    assert.equal(upgraded.status, 'succeeded'); assert.equal(upgraded.cleanup.complete, true);
    report.upgradedVersions = { plugin: upgraded.current.pluginVersion, freeform: upgraded.current.pair.freeform.version, lux3d: upgraded.current.pair.lux3d.version };
    const upgradedPair = JSON.stringify(upgraded.current.pair);
    await probe('upgraded');
    assert.equal(JSON.stringify((await management(['status'])).current.pair), upgradedPair);
    const cleaned = await management(['cleanup']); assert.equal(cleaned.candidates.length, 0);
    assert.equal((await management(['uninstall'])).status, 'uninstalled');
    const preview = await management(['cleanup', '--purge-cache']); assert.ok(preview.candidates.length);
    await management(['cleanup', '--purge-cache', '--apply']);
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  // This upstream MCP writes startup errors to files instead of stderr.
  report.freeformStartupLogs = [];
  const cachedFiles = await fs.readdir(cache, { recursive: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const filename of cachedFiles) {
    if (!isFreeformLogFile(filename)) continue;
    const content = (await fs.readFile(path.join(cache, filename), 'utf8')).slice(-16_000)
      .replace(/(?:sk-|ghp_|npm_)[A-Za-z0-9_-]{12,}/g, '[redacted]');
    report.freeformStartupLogs.push({ filename, content });
  }
  await fs.mkdir(path.dirname(path.resolve(outputArgument)), { recursive: true });
  report.elapsedMs = Date.now() - acceptanceStarted;
  if (!report.passed && options.includes('--keep-on-failure')) report.retainedTemporaryRoot = root;
  await fs.writeFile(path.resolve(outputArgument), JSON.stringify(report, null, 2) + '\n');
  assert.equal(path.dirname(root), temporaryParent);
  if (!report.retainedTemporaryRoot) await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  console.log(JSON.stringify({ passed: report.passed, failure: report.failure, report: path.resolve(outputArgument) }));
}
