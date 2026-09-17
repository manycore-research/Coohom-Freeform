// Real Codex/local-marketplace acceptance. Never uses the current user's Codex home.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'win32', 'Run this Windows acceptance script on Windows x64.');
const [cliArgument, outputArgument, diagnosticOption] = process.argv.slice(2);
assert.ok(!diagnosticOption || diagnosticOption === '--keep-on-failure', 'Only --keep-on-failure is supported as a diagnostic option.');
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
const reserve = net.createServer();
await new Promise((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', resolve); });
const luxPort = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
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
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 620_000);
      pending.set(id, { resolve, reject, timer, method });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  try {
    await request('initialize', { clientInfo: { name: 'coohom-marketplace-acceptance', version: '1.0.0' } });
    child.stdin.write('{"method":"initialized"}\n');
    const result = await request('mcpServerStatus/list', { detail: 'toolsAndAuthOnly' });
    const servers = result.data.filter(server => server.pluginId === 'coohom-freeform@coohom').map(server => ({
      name: server.name, tools: Object.keys(server.tools ?? {}),
    }));
    report.runs.push({ label, elapsedMs: Date.now() - started, servers, diagnostics });
    for (const [name, tools] of [
      ['freeform-modeling-mcp', ['import_generated_asset', 'poll_import_status']],
      ['lux3d-mcp-server', ['prepare_workspace', 'create_lux3d_model_task', 'get_lux3d_model_task']],
    ]) {
      const server = servers.find(server => server.name === name);
      assert.ok(server, `${label}: missing ${name}`);
      for (const tool of tools) assert.ok(server.tools.includes(tool), `${label}: missing ${tool}`);
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
  await probe('cold');
  const versions = await fs.readdir(path.join(cache, 'plugins'));
  const records = {};
  for (const revision of versions) {
    for (const service of ['freeform', 'lux3d']) {
      const pointer = path.join(cache, 'plugins', revision, service, 'runtime/mcp', `${service}-install.json`);
      try { records[service] = JSON.parse(await fs.readFile(pointer, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  report.resolvedVersions = Object.fromEntries(Object.entries(records).map(([key, value]) => [key, value.version]));
  const before = JSON.stringify(records);
  await probe('warm');
  const after = {};
  for (const revision of versions) for (const service of ['freeform', 'lux3d']) {
    try { after[service] = JSON.parse(await fs.readFile(path.join(cache, 'plugins', revision, service, 'runtime/mcp', `${service}-install.json`), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  assert.equal(JSON.stringify(after), before);
  report.warmInstallationRecordsUnchanged = true;
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
    if (!/[\\/]freeform-modeling-mcp[\\/](?:src[\\/])?logs[\\/][^\\/]+\.log$/.test(filename)) continue;
    const content = (await fs.readFile(path.join(cache, filename), 'utf8')).slice(-16_000)
      .replace(/(?:sk-|ghp_|npm_)[A-Za-z0-9_-]{12,}/g, '[redacted]');
    report.freeformStartupLogs.push({ filename, content });
  }
  await fs.mkdir(path.dirname(path.resolve(outputArgument)), { recursive: true });
  if (!report.passed && diagnosticOption === '--keep-on-failure') report.retainedTemporaryRoot = root;
  await fs.writeFile(path.resolve(outputArgument), JSON.stringify(report, null, 2) + '\n');
  assert.equal(path.dirname(root), temporaryParent);
  if (!report.retainedTemporaryRoot) await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  console.log(JSON.stringify({ passed: report.passed, failure: report.failure, report: path.resolve(outputArgument) }));
}
