import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import net from 'node:net';
import { PACKAGES, readPublicCli, validateRecord } from './runtime-contract.mjs';

// Standard MCP discovery only. No tools/call and no private package entrypoints.
export async function probeMcp({ command, args = [], env = process.env, timeoutMs = 30000 }) {
  const child = spawn(command, args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  const closed = new Promise(resolve => child.once('close', resolve));
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let sequence = 0;
  const fail = message => { for (const item of pending.values()) item.reject(new Error(message)); pending.clear(); };
  child.on('error', () => fail('MCP process could not start.'));
  child.on('close', () => fail('MCP process exited before discovery completed.'));
  child.stdin.on('error', () => fail('MCP input closed during discovery.'));
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { fail('MCP returned invalid protocol output.'); return; }
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new Error('MCP rejected the discovery request.'));
    else item.resolve(message.result);
  });
  const deadline = setTimeout(() => fail('MCP initialization or tool discovery timed out.'), timeoutMs);
  const request = (method, params) => new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) return reject(new Error('MCP process already exited.'));
    const id = ++sequence; pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    const initialized = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'coohom-install-check', version: '1.0.0' } });
    if (typeof initialized?.protocolVersion !== 'string' || !initialized.capabilities?.tools) throw new Error('MCP initialization did not advertise tools.');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const names = new Set(); const cursors = new Set();
    let cursor;
    do {
      const page = await request('tools/list', cursor ? { cursor } : {});
      if (!Array.isArray(page?.tools)) throw new Error('MCP returned an invalid tool list.');
      for (const tool of page.tools) {
        if (typeof tool.name !== 'string' || !tool.name || names.has(tool.name) || tool.inputSchema?.type !== 'object') throw new Error('MCP tool declarations are invalid.');
        names.add(tool.name);
      }
      cursor = page.nextCursor;
      if (cursor !== undefined && (typeof cursor !== 'string' || cursors.has(cursor))) throw new Error('MCP returned invalid pagination.');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if (!names.size) throw new Error('MCP exposes no tools.');
    return { tools: names.size, initialized: true };
  } finally {
    clearTimeout(deadline); fail('MCP check ended.'); lines.close(); child.stdin.end();
    // Own only this probe process tree, never a pre-existing server.
    if (process.platform === 'win32' && child.pid && child.exitCode === null) {
      await new Promise(resolve => {
        const killer = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', () => { child.kill(); resolve(); }); killer.once('close', resolve);
      });
    } else if (child.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') child.kill(); }
    }
    let timer;
    const stopped = await Promise.race([closed.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 3000); })]);
    clearTimeout(timer);
    if (!stopped && child.pid) {
      if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
      else child.kill('SIGKILL');
      await closed;
    }
  }
}

export async function checkRuntimePorts(env = process.env) {
  // Same public Freeform bridge port used by marketplace-smoke.mjs.
  const ports = [8765];
  if (env.LUX3D_MCP_BRIDGE_PORT) {
    const port = Number(env.LUX3D_MCP_BRIDGE_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid configured Lux3D bridge port.');
    ports.push(port);
  }
  for (const port of new Set(ports)) {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', () => reject(new Error(`Bridge port ${port} is occupied or unavailable. Resolve its owner before checking startup.`)));
      server.listen(port, '127.0.0.1', resolve);
    });
    await new Promise(resolve => server.close(resolve));
  }
}

export async function doctorPair(current, { env = process.env, probe = probeMcp, timeoutMs, checkPorts = checkRuntimePorts } = {}) {
  if (!current?.pair || !current.nodeExecutable) throw new Error('Install the runtime before checking startup.');
  const runtime = path.join(current.pluginRoot, 'runtime/mcp');
  await fs.access(current.nodeExecutable);
  await checkPorts(env);
  const services = {};
  for (const service of ['freeform', 'lux3d']) {
    const record = validateRecord(service, current.pair[service]);
    await readPublicCli(path.resolve(runtime, record.directory), PACKAGES[service], record.version, service === 'lux3d' ? 'lux3d-mcp-server' : PACKAGES[service]);
    services[service] = await probe({ command: current.nodeExecutable,
      args: [path.join(runtime, service === 'freeform' ? 'launch-mcp.mjs' : 'launch-lux3d.mjs'), ...(service === 'freeform' ? ['start', '--stdio'] : [])],
      env, timeoutMs });
  }
  return { status: 'passed', validation: 'initialized', pairId: current.pair.id, pluginVersion: current.pluginVersion,
    versions: Object.fromEntries(['freeform', 'lux3d'].map(service => [service, current.pair[service].version])),
    checkedAt: new Date().toISOString(), services, currentTaskConnected: false };
}
