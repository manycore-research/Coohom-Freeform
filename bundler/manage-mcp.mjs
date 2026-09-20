import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { installFreeform } from './update-freeform.mjs';
import { installLux3d } from './update-lux3d.mjs';
import { VERSION, readOptionalJson, validateRecord } from './runtime-contract.mjs';

async function atomicJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
    await fs.rename(temporary, filename);
  } finally { await fs.rm(temporary, { force: true }); }
}
async function acquireLock(filename, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const handle = await fs.open(filename, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      return async () => { await handle.close(); await fs.unlink(filename); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = await readOptionalJson(filename); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      if (owner?.pid) {
        try { process.kill(owner.pid, 0); }
        catch (error) {
          if (error.code === 'ESRCH') throw new Error(`Interrupted installation: inspect ${filename} before removing its stale lock and choosing retry.`);
          if (error.code !== 'EPERM') throw error;
        }
      }
      if (Date.now() >= deadline) throw new Error('Another MCP combination installation is running. No new attempt was made.');
      await delay(100);
    }
  }
}
export function recoveryMessage(state) {
  const selected = `Freeform ${state.requested.freeform}, Lux3D ${state.requested.lux3d}`;
  return `MCP installation failed at ${state.service} (${selected}): ${state.reason}. `
    + (state.attempts < 2 ? 'Ask the user to retry or stop.' : 'Retry also failed. Ask the user whether to try another explicit pair of versions or stop.')
    + ' No automatic fallback. Use manage-mcp.mjs <plugin-root> status, retry, or versions <freeform-version> <lux3d-version> after the corresponding user choice.';
}
export async function manageMcp({ pluginRoot, action = 'ensure', versions, stateRoot,
  nodeExecutable, npmCliPath, env = process.env, writeLine = console.log, lockTimeoutMs = 660_000,
  installers = { freeform: installFreeform, lux3d: installLux3d } } = {}) {
  if (!['status', 'ensure', 'install', 'retry', 'versions'].includes(action)) throw new Error('Expected status, install, retry, or versions.');
  const runtime = path.resolve(pluginRoot, 'runtime/mcp');
  const stateDirectory = path.resolve(stateRoot ?? runtime);
  const stateFile = path.join(stateDirectory, 'mcp-install-state.json');
  const pairFile = path.join(runtime, 'mcp-pair.json');
  if (action === 'status') return { state: await readOptionalJson(stateFile), pair: await readOptionalJson(pairFile) };
  await fs.mkdir(runtime, { recursive: true });
  await fs.mkdir(stateDirectory, { recursive: true });
  const unlock = await acquireLock(path.join(stateDirectory, '.mcp-pair.lock'), lockTimeoutMs);
  let stage;
  const moved = [];
  let activated = false;
  try {
    const previous = await readOptionalJson(stateFile);
    const pair = await readOptionalJson(pairFile);
    if (previous && previous.status !== 'ready' && ['ensure', 'install'].includes(action)) {
      throw new Error(previous.status === 'failed' ? recoveryMessage(previous) : 'The prior installation was interrupted. Inspect its state and explicitly retry.');
    }
    if (action === 'ensure' && pair) {
      if (pair.format !== 1) throw new Error('Unsupported MCP pair record.');
      for (const service of ['freeform', 'lux3d']) validateRecord(service, pair[service]);
      return pair;
    }
    if (action === 'retry' && (!previous || previous.status === 'ready')) throw new Error('There is no failed installation to retry.');
    if (action === 'versions' && (!previous || previous.status !== 'failed' || previous.attempts < 2)) throw new Error('Other version combinations are offered only after the user has retried and that retry failed.');
    if (action === 'versions' && (!versions || !VERSION.test(versions.freeform) || !VERSION.test(versions.lux3d))) throw new Error('Specify both exact MCP versions; ranges and tags are not allowed.');
    const requested = action === 'versions' ? { freeform: versions.freeform, lux3d: versions.lux3d }
      : action === 'retry' ? previous.requested : { freeform: 'latest', lux3d: 'latest' };
    const state = { status: 'installing', attempts: (action === 'retry' || action === 'versions' ? previous.attempts : 0) + 1,
      requested, service: 'preparation', startedAt: new Date().toISOString() };
    await atomicJson(stateFile, state);
    try {
      stage = await fs.mkdtemp(path.join(runtime, '.pair-'));
      const stagedRuntime = path.join(stage, 'runtime/mcp');
      await fs.mkdir(stagedRuntime, { recursive: true });
      for (const name of ['freeform-policy.json', 'lux3d-policy.json']) await fs.copyFile(path.join(runtime, name), path.join(stagedRuntime, name));
      const installed = {};
      for (const service of ['freeform', 'lux3d']) {
        state.service = service;
        await atomicJson(stateFile, state);
        installed[service] = validateRecord(service, await installers[service]({ pluginRoot: stage,
          nodeExecutable: nodeExecutable ?? path.resolve(pluginRoot, 'runtime/node', process.platform === 'win32' ? 'node.exe' : 'bin/node'),
          npmCliPath: npmCliPath ?? path.resolve(pluginRoot, 'runtime/node/npm/bin/npm-cli.js'),
          env, writeLine, version: requested[service] }));
        if (requested[service] !== 'latest' && installed[service].version !== requested[service]) throw new Error(`${service} did not install the requested exact version.`);
        state.resolved = { ...state.resolved, [service]: installed[service].version };
        await atomicJson(stateFile, state);
      }
      state.service = 'activation';
      await atomicJson(stateFile, state);
      for (const service of ['freeform', 'lux3d']) {
        const record = installed[service];
        await fs.mkdir(path.join(runtime, service), { recursive: true });
        // Reserve the final path, then replace this invocation's empty directory.
        const destination = await fs.mkdtemp(path.join(runtime, service, 'install-'));
        await fs.rmdir(destination);
        await fs.rename(path.join(stagedRuntime, record.directory), destination);
        moved.push(destination);
        record.directory = path.relative(runtime, destination).split(path.sep).join('/');
        if (npmCliPath) record.npmCliPath = path.resolve(npmCliPath);
      }
      const next = { format: 1, id: randomUUID(), installedAt: new Date().toISOString(), validation: 'installed', ...installed };
      await atomicJson(pairFile, next);
      activated = true;
      await atomicJson(stateFile, { ...state, status: 'ready', pairId: next.id, validation: 'installed' });
      writeLine(`Installed combination: Freeform ${next.freeform.version}; Lux3D ${next.lux3d.version}. MCP initialization and task compatibility still require verification.`);
      return next;
    } catch (error) {
      const failed = { ...state, status: 'failed', reason: error.message, activated };
      await atomicJson(stateFile, failed);
      throw new Error(recoveryMessage(failed), { cause: error });
    }
  } finally {
    if (!activated) for (const directory of moved) await fs.rm(directory, { recursive: true, force: true });
    if (stage) await fs.rm(stage, { recursive: true, force: true });
    await unlock();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [pluginRoot, action, freeform, lux3d, ...extra] = process.argv.slice(2);
  try {
    if (!pluginRoot || !action || extra.length || (action !== 'versions' && (freeform || lux3d))) throw new Error('Usage: node manage-mcp.mjs <plugin-root> status|install|retry|versions [freeform-version lux3d-version]');
    const result = await manageMcp({ pluginRoot, action, versions: { freeform, lux3d }, writeLine: (message) => process.stderr.write(`${message}\n`) });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
