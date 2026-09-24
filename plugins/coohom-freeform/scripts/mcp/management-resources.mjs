import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicJson, optionalJson, ownedPath, readLeases, within } from './runtime-state.mjs';
import { PACKAGES, readPublicCli, validateRecord } from './runtime-contract.mjs';

const execute = promisify(execFile);
export const stateDirectory = root => path.join(root, 'mcp-state');

export async function rememberResource(cacheRoot, target, kind) {
  target = await ownedPath(cacheRoot, target);
  const directory = stateDirectory(cacheRoot);
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'resources.json');
  const resources = await optionalJson(filename) ?? [];
  if (!resources.some(item => item.path === target)) {
    resources.push({ path: target, kind, owner: 'coohom-freeform', createdAt: new Date().toISOString() });
    await atomicJson(filename, resources);
  }
}

export async function rememberPair(cacheRoot, pluginRoot, pair) {
  await rememberResource(cacheRoot, pluginRoot, 'pair');
  for (const service of ['freeform', 'lux3d']) {
    await rememberResource(cacheRoot, path.resolve(pluginRoot, 'runtime/mcp', pair[service].directory), 'dependency');
  }
}

export async function adoptLegacyResources(cacheRoot, { write = true } = {}) {
  const discovered = [];
  const remember = async (target, kind) => {
    target = await ownedPath(cacheRoot, target);
    discovered.push({ path: target, kind, owner: 'coohom-freeform' });
    if (write) await rememberResource(cacheRoot, target, kind);
  };
  let entries = [];
  try { entries = await fs.readdir(path.join(cacheRoot, 'plugins'), { withFileTypes: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const entry of entries.filter(item => item.isDirectory() && /^[a-f0-9]{24}$/.test(item.name))) {
    const pluginRoot = path.join(cacheRoot, 'plugins', entry.name, 'pair');
    const runtime = path.join(pluginRoot, 'runtime/mcp');
    try {
      await ownedPath(cacheRoot, pluginRoot);
      const pair = await optionalJson(path.join(runtime, 'mcp-pair.json'));
      if (pair?.format !== 1) continue;
      for (const service of ['freeform', 'lux3d']) {
        const record = validateRecord(service, pair[service]);
        await readPublicCli(path.resolve(runtime, record.directory), PACKAGES[service], record.version, service === 'lux3d' ? 'lux3d-mcp-server' : PACKAGES[service]);
      }
      await remember(pluginRoot, 'pair');
      for (const service of ['freeform', 'lux3d']) await remember(path.resolve(runtime, pair[service].directory), 'dependency');
      for (const service of ['freeform', 'lux3d']) {
        for (const name of await fs.readdir(path.join(runtime, service))) {
          if (!/^install-[A-Za-z0-9]+$/.test(name)) continue;
          const target = path.join(runtime, service, name);
          try {
            await ownedPath(cacheRoot, target);
            await readPublicCli(target, PACKAGES[service], undefined, service === 'lux3d' ? 'lux3d-mcp-server' : PACKAGES[service]);
            await remember(target, 'dependency');
          } catch { /* Unrecognized old content remains untouched. */ }
        }
      }
    } catch { /* A directory name alone never establishes ownership. */ }
  }
  let nodes = [];
  try { nodes = await fs.readdir(path.join(cacheRoot, 'node'), { withFileTypes: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const node of nodes.filter(item => item.isDirectory() && /^node-v\d+\.\d+\.\d+-(win-x64|darwin-arm64)$/.test(item.name))) {
    const target = path.join(cacheRoot, 'node', node.name);
    try {
      await ownedPath(cacheRoot, target);
      const marker = (await fs.readFile(path.join(target, '.coohom-sha256'), 'utf8')).trim();
      if (!/^[a-f0-9]{64}$/.test(marker)) continue;
      const win = node.name.endsWith('win-x64');
      await fs.access(path.join(target, win ? 'node.exe' : 'bin/node'));
      const manifest = await optionalJson(path.join(target, win ? 'node_modules/npm/package.json' : 'lib/node_modules/npm/package.json'));
      if (manifest?.name === 'npm') await remember(target, 'node');
    } catch { /* Missing ownership evidence: keep for manual inspection. */ }
  }
  return discovered;
}

// Only matching PIDs leave this function; command lines may contain credentials.
export async function inspectProcesses(roots, { platform = process.platform, ignore = [process.pid, process.ppid] } = {}) {
  try {
    let rows;
    if (platform === 'win32') {
      const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress';
      const { stdout } = await execute(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
      rows = [].concat(JSON.parse(stdout)).map(row => ({ pid: Number(row.ProcessId), parent: Number(row.ParentProcessId), command: row.CommandLine ?? '' }));
    } else {
      const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,ppid=,command='], { timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
      rows = stdout.split('\n').map(line => { const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return match ? { pid: Number(match[1]), parent: Number(match[2]), command: match[3] } : undefined; }).filter(Boolean);
    }
    const normalize = value => value.replaceAll('\\', '/').toLowerCase();
    const targets = roots.filter(Boolean).map(normalize);
    const ignored = new Set(ignore);
    let ancestor = process.pid;
    const visited = new Set();
    while (ancestor && !visited.has(ancestor)) {
      visited.add(ancestor); ignored.add(ancestor);
      ancestor = rows.find(row => row.pid === ancestor)?.parent;
    }
    return { available: true, pids: rows.filter(row => !ignored.has(row.pid) &&
      (targets.some(root => normalize(row.command).includes(root)) || /freeform-modeling-mcp|coohom-lux3d-mcp|lux3d-mcp-server/.test(row.command)))
      .map(row => row.pid) };
  } catch { return { available: false, pids: [] }; }
}

export async function requireIdle(cacheRoot, roots = [], inspect = inspectProcesses) {
  const leases = await readLeases(stateDirectory(cacheRoot));
  const processes = await inspect([cacheRoot, ...roots]);
  if (!processes.available) throw new Error('Process ownership could not be checked. Close Coohom tasks and check process access before retrying.');
  if (leases.length || processes.pids.length) throw new Error('Coohom resources are in use or a related process has unknown ownership. Close the related tasks before continuing. No process was stopped.');
}

async function sizeOf(target) {
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return stat.size;
  let bytes = 0;
  for (const name of await fs.readdir(target)) bytes += await sizeOf(path.join(target, name));
  return bytes;
}

export function currentReferences(current) {
  if (!current) return [];
  const refs = [current.pluginRoot, current.nodeRoot, current.recoverySource];
  for (const service of ['freeform', 'lux3d']) {
    if (current.pair?.[service]) refs.push(path.resolve(current.pluginRoot, 'runtime/mcp', current.pair[service].directory));
  }
  return refs.filter(Boolean).map(item => path.resolve(item));
}

export async function cleanupResources(cacheRoot, { apply = false, all = false, inspect = inspectProcesses, extraKeep = [] } = {}) {
  const directory = stateDirectory(cacheRoot);
  const current = await optionalJson(path.join(directory, 'current.json'));
  const operation = await optionalJson(path.join(directory, 'operation.json'));
  const saved = await optionalJson(path.join(directory, 'resources.json')) ?? [];
  const registry = [...new Map([...await adoptLegacyResources(cacheRoot, { write: false }), ...saved].map(item => [item.path, item])).values()];
  if (all && current) throw new Error('Uninstall the plugin before removing its current runtime.');
  const protectedPaths = [...(all ? [] : currentReferences(current)), ...extraKeep];
  if (operation && ['running', 'failed'].includes(operation.status)) {
    protectedPaths.push(operation.directory, ...currentReferences(operation.previous), ...currentReferences(operation.candidateRuntime));
  }
  const result = { deleted: [], candidates: [], retained: [], bytes: 0, complete: true };
  const retained = [];
  const covered = [];
  for (const entry of registry) {
    if (entry.owner !== 'coohom-freeform' || !['pair', 'dependency', 'node', 'transaction'].includes(entry.kind)) {
      result.retained.push({ path: entry.path, reason: 'Unrecognized ownership' }); retained.push(entry); result.complete = false; continue;
    }
    try { await ownedPath(cacheRoot, entry.path); }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      result.retained.push({ path: entry.path, reason: 'Path ownership could not be verified' }); retained.push(entry); result.complete = false; continue;
    }
    if (protectedPaths.filter(Boolean).some(ref => path.resolve(ref) === entry.path || within(entry.path, ref))) {
      result.retained.push({ path: entry.path, reason: 'Current installation, recovery data or executing runtime' }); retained.push(entry); continue;
    }
    if (entry.path === process.execPath || within(entry.path, process.execPath)) {
      result.retained.push({ path: entry.path, reason: 'Executing Node runtime; deferred until it is no longer in use' }); retained.push(entry); result.complete = false; continue;
    }
    if (covered.some(parent => within(parent, entry.path))) { if (!apply) retained.push(entry); continue; }
    const leases = await readLeases(directory);
    const processes = await inspect([entry.path]);
    const leased = lease => !lease.resource || lease.resource === entry.path || within(entry.path, lease.resource) || within(lease.resource, entry.path);
    if (!processes.available || processes.pids.length || leases.some(leased)) {
      result.retained.push({ path: entry.path, reason: 'In use or process ownership unknown' }); retained.push(entry); result.complete = false; continue;
    }
    const bytes = await sizeOf(entry.path);
    result.candidates.push({ path: entry.path, bytes });
    if (apply) {
      // Recheck under the management lock immediately before recursive deletion.
      const fresh = await inspect([entry.path]);
      if (!fresh.available || fresh.pids.length || (await readLeases(directory)).some(leased)) {
        result.retained.push({ path: entry.path, reason: 'Became busy' }); retained.push(entry); result.complete = false; continue;
      }
      try {
        await ownedPath(cacheRoot, entry.path);
        await fs.rm(entry.path, { recursive: true });
        result.deleted.push(entry.path); result.bytes += bytes; covered.push(entry.path);
      } catch {
        result.retained.push({ path: entry.path, reason: 'Deletion did not complete' }); retained.push(entry); result.complete = false;
      }
    } else { retained.push(entry); covered.push(entry.path); result.bytes += bytes; }
  }
  if (apply) await atomicJson(path.join(directory, 'resources.json'), retained);
  return result;
}
