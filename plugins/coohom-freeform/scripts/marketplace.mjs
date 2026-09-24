import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SERVICES = {
  freeform: { launcher: 'launch-mcp.mjs', args: ['start', '--stdio'] },
  lux3d: { launcher: 'launch-lux3d.mjs', args: [] },
};
export const RUNTIME_FILES = ['runtime-state.mjs', 'codex-cli.mjs', 'management.mjs', 'management-host.mjs', 'management-doctor.mjs', 'management-resources.mjs', 'launch-mcp.mjs', 'launch-lux3d.mjs', 'update-freeform.mjs',
  'update-lux3d.mjs', 'runtime-contract.mjs', 'manage-mcp.mjs', 'freeform-policy.json', 'lux3d-policy.json'];
const log = (message) => process.stderr.write(`[coohom-freeform] ${message}\n`);

async function readJson(filename) {
  return JSON.parse(await fs.readFile(filename, 'utf8'));
}

export async function prepareRuntime({ sourceRoot, cacheRoot, service, nodeExecutable = process.execPath, npmCliPath,
  lockTimeoutMs = 660_000, action = 'ensure', versions, lease = false, inspect }) {
  if (!Object.hasOwn(SERVICES, service)) throw new Error('Expected freeform or lux3d.');
  const manifest = await readJson(path.join(sourceRoot, '.codex-plugin/plugin.json'));
  if (manifest.name !== 'coohom-freeform') throw new Error('Invalid Coohom plugin identity.');
  const source = path.join(sourceRoot, 'scripts/mcp');
  const state = await import(pathToFileURL(path.join(source, 'runtime-state.mjs')).href);
  const resources = await import(pathToFileURL(path.join(source, 'management-resources.mjs')).href);
  const manager = await import(pathToFileURL(path.join(source, 'manage-mcp.mjs')).href);
  const revision = await state.runtimeFingerprint(sourceRoot);
  const stateRoot = path.resolve(cacheRoot, 'mcp-state');
  const defaultDestination = path.resolve(cacheRoot, 'plugins', revision, 'pair');
  if (action === 'status') {
    const current = await state.optionalJson(path.join(stateRoot, 'current.json'));
    const destination = current?.fingerprint === revision ? current.pluginRoot : defaultDestination;
    return { pluginRoot: destination, ...await manager.manageMcp({ pluginRoot: destination, action, stateRoot }) };
  }
  if (['retry', 'versions'].includes(action)) {
    await resources.requireIdle(cacheRoot, [sourceRoot], inspect);
    await state.recoverInterruptedLock(stateRoot);
  }
  const unlock = await state.acquireManagementLock(stateRoot, lockTimeoutMs);
  try {
    if (state.pendingOperation(await state.optionalJson(path.join(stateRoot, 'operation.json')))) {
      throw new Error('Management needs an explicit choice: retry, resume-current, or stop. Startup did not select another version.');
    }
    let current = await state.optionalJson(path.join(stateRoot, 'current.json'));
    if (!current) {
      const { readManagementStatus } = await import(pathToFileURL(path.join(source, 'management.mjs')).href);
      const legacy = await readManagementStatus({ sourceRoot, cacheRoot, nodeExecutable, npmCliPath });
      current = legacy.current;
      if (!current && legacy.legacyCandidates.length) throw new Error('Multiple legacy dependency pairs require explicit inspection before migration.');
    }
    if (current?.fingerprint && current.fingerprint !== revision) throw new Error('Runtime files changed. Run an explicit management upgrade before starting; installed dependencies were not upgraded automatically.');
    const destination = current?.pluginRoot ?? defaultDestination;
    if (current) await state.ownedPath(cacheRoot, destination);
    const migrating = current && !current.fingerprint;
    if (migrating) await resources.requireIdle(cacheRoot, [sourceRoot], inspect);
    const options = { pluginRoot: destination, nodeExecutable, npmCliPath, action, versions,
      stateRoot, writeLine: log, lockTimeoutMs, lockHeld: true };
    const runtime = path.join(destination, 'runtime/mcp');
    await fs.mkdir(runtime, { recursive: true });
    // A warm managed installation already contains the candidate's verified launchers.
    if (!current || migrating) for (const name of RUNTIME_FILES) {
      await fs.writeFile(path.join(runtime, name), await fs.readFile(path.join(source, name)));
    }
    const pair = await manager.manageMcp(options);
    await resources.rememberPair(cacheRoot, destination, pair);
    const nodeRoot = process.platform === 'win32' ? path.dirname(nodeExecutable) : path.dirname(path.dirname(nodeExecutable));
    if (state.within(cacheRoot, nodeRoot)) await resources.rememberResource(cacheRoot, nodeRoot, 'node');
    await state.atomicJson(path.join(stateRoot, 'current.json'), { pluginRoot: destination, pair, sourceRoot,
      pluginVersion: manifest.version, nodeExecutable, nodeRoot, npmCliPath, fingerprint: revision });
    await fs.rm(path.join(stateRoot, 'uninstalled.json'), { force: true });
    if (lease) return { pluginRoot: destination, release: await state.registerLease(stateRoot, destination, service) };
    return destination;
  } finally { await unlock(); }
}

async function main() {
  const [service, cacheRoot, npmCliPath, action, freeform, lux3d, ...extra] = process.argv.slice(2);
  if (!service || !cacheRoot || !npmCliPath || extra.length) throw new Error('Start the MCP through scripts/bootstrap.');
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const prepared = await prepareRuntime({ sourceRoot, cacheRoot, service, npmCliPath, action: action ?? 'ensure', versions: { freeform, lux3d }, lease: !action });
  const root = action ? prepared : prepared.pluginRoot;
  if (action) { process.stdout.write(JSON.stringify(root, null, 2) + '\n'); return; }
  const config = SERVICES[service];
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (['node_options', 'node_path', 'aholo_api_key', 'aholo_region', 'coohom_aholo_config'].includes(key.toLowerCase())) delete env[key];
  }
  try {
  const child = spawn(process.execPath, [path.join(root, 'runtime/mcp', config.launcher), ...config.args], {
    cwd: root, env: { ...env, COOHOM_MCP_STATE_ROOT: path.resolve(cacheRoot, 'mcp-state') }, stdio: 'inherit', windowsHide: true,
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); resolve(); });
  });
  } finally { await prepared.release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    log(error.message);
    process.exitCode = 1;
  });
}
