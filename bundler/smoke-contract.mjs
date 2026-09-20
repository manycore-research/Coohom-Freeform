import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import net from 'node:net';

// Discovery proves MCP initialization only, not task or cross-MCP semantics.
export const mcpServerNames = ['freeform-modeling-mcp', 'lux3d-mcp-server'];
export function assertDiscoveredTools(name, tools) {
  assert.ok(mcpServerNames.includes(name), `Unknown MCP server: ${name}`);
  assert.ok(Array.isArray(tools) && tools.length > 0, `${name} exposes no tools`);
  const names = new Set();
  for (const tool of tools) {
    assert.equal(typeof tool.name, 'string');
    assert.ok(tool.name.length > 0 && !names.has(tool.name), 'Tool names must be nonempty and unique');
    names.add(tool.name);
    assert.equal(tool.inputSchema?.type, 'object', `${tool.name} has no object inputSchema`);
    if (tool.outputSchema !== undefined) assert.equal(tool.outputSchema?.type, 'object');
  }
}

export function assertPluginVersion(version) {
  assert.equal(typeof version, 'string', 'Plugin version must be a string');
  assert.match(version, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\+codex\.\d{14}$/, 'Expected a release version with a Codex cachebuster');
}

export async function unusedLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function probeDisconnectedExecutor(request) {
  // A fresh synthetic thread cannot target a user's connected executor.
  const threadId = `coohom-smoke-${randomUUID()}`;
  const response = await request('tools/call', {
    name: 'get_lux3d_model_task', arguments: { taskId: 'coohom-no-executor-probe' }, _meta: { threadId },
  });
  assert.notEqual(response.isError, true, 'Disconnected executor must return a normal workspace result');
  const workspace = response.structuredContent;
  assert.ok(workspace, 'Missing structured workspace result');
  assert.equal(workspace.status, 'executor_required');
  assert.equal(workspace.threadId, threadId);
  assert.equal(new URL(workspace.executorUrl).searchParams.get('codexThreadId'), threadId);
  assert.equal(workspace.taskId, undefined, 'An executor-required response must not create a generation task');
}

export function isFreeformLogFile(filename) {
  // Scope sibling node_modules/logs to a Freeform install, excluding Lux3D logs.
  const normalized = filename.replaceAll('\\', '/');
  return /(?:^|\/)freeform\/install-[^/]+\/node_modules\/(?:freeform-modeling-mcp\/(?:src\/)?)?logs\/[^/]+\.log$/.test(normalized);
}
