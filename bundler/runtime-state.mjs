import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export async function optionalJson(filename) {
  try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

export async function atomicJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
    await fs.rename(temporary, filename);
  } finally { await fs.rm(temporary, { force: true }); }
}

export function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; return true; }
}

// All pair mutations and resource leases serialize through the same lock.
// Interrupted locks are intentionally not broken automatically.
export async function acquireManagementLock(directory, timeoutMs = 660_000) {
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, '.mcp-pair.lock');
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  while (true) {
    let handle;
    try { handle = await fs.open(filename, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = await optionalJson(filename); } catch { /* Incomplete owner: wait, never remove. */ }
      if (owner?.pid && !alive(owner.pid)) throw new Error('Interrupted management operation left a lock. Inspect its owner before explicit recovery.');
      if (Date.now() >= deadline) throw new Error('Another MCP management operation is running.');
      await delay(100);
      continue;
    }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })); }
    catch (error) { await handle.close(); await fs.rm(filename, { force: true }); throw error; }
    return async () => {
      await handle.close();
      if ((await optionalJson(filename))?.token !== token) throw new Error('Management lock ownership changed.');
      await fs.unlink(filename);
    };
  }
}

// Only an explicit retry/resume calls this, after checking leases and processes.
// The guard serializes competing recovery requests; a live or unknown owner is
// never evicted, including PID reuse. Incomplete lock records require inspection.
export async function recoverInterruptedLock(directory) {
  const filename = path.join(directory, '.mcp-pair.lock');
  const owner = await optionalJson(filename);
  if (!owner || alive(owner.pid)) return;
  if (typeof owner.token !== 'string' || !owner.token) throw new Error('Interrupted lock ownership is incomplete; inspect it before recovery.');
  const guardName = path.join(directory, '.mcp-recovery.lock');
  const guard = await fs.open(guardName, 'wx');
  try {
    const latest = await optionalJson(filename);
    if (latest?.token === owner.token && latest.pid === owner.pid && !alive(latest.pid)) await fs.unlink(filename);
  } finally { await guard.close(); await fs.unlink(guardName); }
}

export function within(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Reject redirected ancestors, including junctions. Never delete an entire cache root.
export async function ownedPath(root, target) {
  root = path.resolve(root); target = path.resolve(target);
  if (!within(root, target)) throw new Error('Resource is outside the managed cache.');
  let cursor = root;
  for (const part of ['', ...path.relative(root, target).split(path.sep)]) {
    if (part) cursor = path.join(cursor, part);
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink()) throw new Error('Managed resource has a redirected path.');
  }
  if (!within(await fs.realpath(root), await fs.realpath(target))) throw new Error('Resource resolves outside the managed cache.');
  return target;
}

export async function registerLease(directory, resource, service) {
  const leases = path.join(directory, 'leases');
  await fs.mkdir(leases, { recursive: true });
  const filename = path.join(leases, `${randomUUID()}.json`);
  await atomicJson(filename, { pid: process.pid, resource: path.resolve(resource), service, startedAt: new Date().toISOString() });
  return () => fs.rm(filename, { force: true });
}

export async function readLeases(directory) {
  const leases = path.join(directory, 'leases');
  let names;
  try { names = await fs.readdir(leases); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const name of names.filter(name => name.endsWith('.json'))) {
    const record = await optionalJson(path.join(leases, name));
    if (!record) continue;
    if (alive(record.pid)) result.push(record);
  }
  return result;
}

export function pendingOperation(operation) {
  return operation && ['running', 'failed'].includes(operation.status);
}

export async function runtimeFingerprint(sourceRoot, nodeVersion = process.version) {
  const source = path.join(sourceRoot, 'scripts/mcp');
  const hash = createHash('sha256').update(nodeVersion).update(process.platform).update(process.arch);
  for (const name of (await fs.readdir(source)).filter(name => /\.(mjs|json)$/.test(name)).sort()) {
    hash.update(name).update(await fs.readFile(path.join(source, name)));
  }
  return hash.digest('hex').slice(0, 24);
}
