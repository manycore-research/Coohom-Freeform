import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const SERVICES = {
  freeform: { updater: 'update-freeform.mjs', install: 'installFreeform', launcher: 'launch-mcp.mjs', args: ['start', '--stdio'] },
  lux3d: { updater: 'update-lux3d.mjs', install: 'installLux3d', launcher: 'launch-lux3d.mjs', args: [] },
};
export const RUNTIME_FILES = ['launch-mcp.mjs', 'launch-lux3d.mjs', 'update-freeform.mjs',
  'update-lux3d.mjs', 'freeform-policy.json', 'lux3d-policy.json'];
const log = (message) => process.stderr.write(`[coohom-freeform] ${message}\n`);

async function readJson(filename) {
  return JSON.parse(await fs.readFile(filename, 'utf8'));
}

async function acquireLock(directory, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const token = randomUUID();
  let reported = false;
  while (true) {
    try { await fs.mkdir(directory); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!reported) { log('Waiting for another startup to prepare this MCP.'); reported = true; }
      let owner;
      try { owner = await readJson(path.join(directory, 'owner.json')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); }
        catch (error) {
          if (error.code === 'ESRCH') throw new Error('Interrupted MCP preparation left a lock. Close Coohom tasks and follow the cache repair instructions.');
          if (error.code !== 'EPERM') throw error;
        }
      }
      if (Date.now() >= deadline) throw new Error('Timed out waiting for MCP preparation. Retry after the other startup finishes.');
      await delay(200);
      continue;
    }
    const pending = path.join(directory, `.owner-${token}.tmp`);
    try {
      await fs.writeFile(pending, JSON.stringify({ pid: process.pid, token }));
      await fs.rename(pending, path.join(directory, 'owner.json'));
    } catch (error) {
      await fs.rm(pending, { force: true });
      await fs.rmdir(directory);
      throw error;
    }
    return async () => {
      if ((await readJson(path.join(directory, 'owner.json'))).token !== token) throw new Error('MCP preparation lock ownership changed.');
      await fs.unlink(path.join(directory, 'owner.json'));
      await fs.rmdir(directory);
    };
  }
}

export async function prepareRuntime({ sourceRoot, cacheRoot, service, nodeExecutable = process.execPath, npmCliPath, lockTimeoutMs = 240_000 }) {
  if (!Object.hasOwn(SERVICES, service)) throw new Error('Expected freeform or lux3d.');
  const manifest = await readJson(path.join(sourceRoot, '.codex-plugin/plugin.json'));
  if (manifest.name !== 'coohom-freeform' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]+)?$/.test(manifest.version)) {
    throw new Error('Invalid Coohom plugin identity or version.');
  }
  const source = path.join(sourceRoot, 'scripts/mcp');
  const fingerprint = createHash('sha256').update(manifest.version).update(process.version).update(process.platform).update(process.arch);
  const contents = new Map();
  for (const name of RUNTIME_FILES) {
    const bytes = await fs.readFile(path.join(source, name));
    contents.set(name, bytes);
    fingerprint.update(name).update(bytes);
  }
  fingerprint.update(await fs.readFile(path.join(sourceRoot, 'scripts/marketplace.mjs')));
  const revision = fingerprint.digest('hex').slice(0, 24);
  const parent = path.resolve(cacheRoot, 'plugins', `${manifest.version}-${revision}`);
  const destination = path.join(parent, service);
  const ready = { version: manifest.version, revision, service, nodeVersion: process.version };
  const readyPath = path.join(destination, '.ready.json');
  async function isReady() {
    try {
      const actual = await readJson(readyPath);
      if (Object.entries(ready).some(([key, value]) => actual[key] !== value)) throw new Error('Coohom runtime cache metadata does not match this plugin. Follow the cache repair instructions.');
      return true;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  if (await isReady()) return destination;
  await fs.mkdir(parent, { recursive: true });
  const unlock = await acquireLock(path.join(parent, `${service}.lock`), lockTimeoutMs);
  let stage;
  try {
    if (await isReady()) return destination;
    try { await fs.access(destination); throw new Error('Incomplete Coohom runtime cache. Follow the cache repair instructions.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    stage = await fs.mkdtemp(path.join(parent, `.${service}-`));
    const runtime = path.join(stage, 'runtime/mcp');
    await fs.mkdir(runtime, { recursive: true });
    for (const [name, bytes] of contents) await fs.writeFile(path.join(runtime, name), bytes);
    const config = SERVICES[service];
    const updater = await import(pathToFileURL(path.join(source, config.updater)).href);
    await updater[config.install]({ pluginRoot: stage, nodeExecutable, npmCliPath, writeLine: log });
    await fs.writeFile(path.join(stage, '.ready.json'), JSON.stringify(ready));
    await fs.rename(stage, destination);
    stage = undefined;
    log(`${service} is ready. Subsequent startup uses this local installation.`);
    return destination;
  } finally {
    if (stage && path.dirname(stage) === parent && path.basename(stage).startsWith(`.${service}-`)) {
      await fs.rm(stage, { recursive: true, force: true });
    }
    await unlock();
  }
}

async function main() {
  const [service, cacheRoot, npmCliPath, ...extra] = process.argv.slice(2);
  if (!service || !cacheRoot || !npmCliPath || extra.length) throw new Error('Start the MCP through scripts/bootstrap.');
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const root = await prepareRuntime({ sourceRoot, cacheRoot, service, npmCliPath });
  const config = SERVICES[service];
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (['node_options', 'node_path', 'aholo_api_key', 'aholo_region', 'coohom_aholo_config'].includes(key.toLowerCase())) delete env[key];
  }
  const child = spawn(process.execPath, [path.join(root, 'runtime/mcp', config.launcher), ...config.args], {
    cwd: root, env, stdio: 'inherit', windowsHide: true,
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); resolve(); });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    log(error.message);
    process.exitCode = 1;
  });
}
