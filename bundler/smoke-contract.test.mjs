import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  assertPluginVersion, assertDiscoveredTools, isFreeformLogFile,
  probeDisconnectedExecutor, mcpServerNames, unusedLoopbackPort,
} from './smoke-contract.mjs';

function disconnected(threadId) {
  const workspace = { threadId, status: 'executor_required',
    executorUrl: `https://www.coohom.com/pub/tool/bim/ai-home/mcp-executor?codexThreadId=${threadId}` };
  return { structuredContent: workspace, content: [
    { type: 'text', text: `${JSON.stringify(workspace)}\nOpen executorUrl, then retry.` },
    { type: 'resource_link', uri: workspace.executorUrl, name: 'Executor' },
  ] };
}

test('disconnected probe supplies request metadata, uses structured content and isolates each thread', async () => {
  const threads = new Set();
  for (let attempt = 0; attempt < 2; attempt++) {
    await probeDisconnectedExecutor(async (method, params) => {
      assert.equal(method, 'tools/call');
      assert.equal(params.name, 'get_lux3d_model_task');
      assert.deepEqual(params.arguments, { taskId: 'coohom-no-executor-probe' });
      assert.match(params._meta.threadId, /^coohom-smoke-[0-9a-f-]{36}$/);
      threads.add(params._meta.threadId);
      return disconnected(params._meta.threadId);
    });
  }
  assert.equal(threads.size, 2);
});

test('disconnected probe rejects legacy errors, incorrect task binding and submitted tasks', async () => {
  for (const mutate of [
    result => ({ ...result, isError: true }),
    result => ({ ...result, structuredContent: undefined }),
    result => ({ structuredContent: { ...result.structuredContent, status: 'connected' } }),
    result => ({ structuredContent: { ...result.structuredContent, threadId: 'another-task' } }),
    result => ({ structuredContent: { ...result.structuredContent, executorUrl: 'https://www.coohom.com/?codexThreadId=another-task' } }),
    result => ({ structuredContent: { ...result.structuredContent, taskId: 'unexpected-submission' } }),
  ]) {
    await assert.rejects(probeDisconnectedExecutor(async (_method, params) => mutate(disconnected(params._meta.threadId))));
  }
});

test('version validation accepts current and future releases without accepting invalid cachebusters', () => {
  for (const version of ['0.1.0+codex.20260918062133', '0.1.11+codex.20260918070946', '2.10.123+codex.20270101000000']) {
    assertPluginVersion(version);
  }
  for (const version of [null, 11, '0.1.11', '0.1.11+codex.123', '01.1.11+codex.20260918070946', '../0.1.11+codex.20260918070946']) {
    assert.throws(() => assertPluginVersion(version));
  }
});

test('log discovery includes bundled and legacy Freeform paths on both platforms', () => {
  for (const suffix of ['logs/startup.log', 'freeform-modeling-mcp/logs/startup.log', 'freeform-modeling-mcp/src/logs/startup.log']) {
    const filename = `plugins/revision/freeform/runtime/mcp/freeform/install-fixture/node_modules/${suffix}`;
    assert.equal(isFreeformLogFile(filename), true);
    assert.equal(isFreeformLogFile(filename.replaceAll('/', '\\')), true);
  }
  for (const filename of [
    'lux3d/install-fixture/node_modules/logs/startup.log',
    'freeform/install-fixture/node_modules/another-package/logs/startup.log',
    'freeform/install-fixture/node_modules/logs/startup.log.json',
    'freeform/install-fixture/node_modules/logs',
  ]) assert.equal(isFreeformLogFile(filename), false, filename);
});

test('discovery accepts changed tool names and fields but rejects malformed MCP declarations', () => {
  for (const server of mcpServerNames) assertDiscoveredTools(server, [{name:'future_capability',inputSchema:{type:'object',properties:{renamed:{type:'string'}}}}]);
  for (const tools of [[], [{name:'x'}], [{name:'x',inputSchema:{type:'string'}}], [{name:'x',inputSchema:{type:'object'}},{name:'x',inputSchema:{type:'object'}}]]) {
    assert.throws(() => assertDiscoveredTools(mcpServerNames[0],tools));
  }
});

test('loopback port selection avoids occupied ports and releases its reservation', async () => {
  const occupied = net.createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  const available = net.createServer();
  try {
    const port = await unusedLoopbackPort();
    assert.notEqual(port, occupied.address().port);
    await new Promise((resolve, reject) => {
      available.once('error', reject);
      available.listen(port, '127.0.0.1', resolve);
    });
  } finally {
    await new Promise(resolve => occupied.close(resolve));
    await new Promise(resolve => available.close(resolve));
  }
});

// Optional public-package integration, with synthetic workspace dependencies:
// no broker, browser, account, payment, generation or scene connection is used.
test('actual Lux3D MCP requires metadata and accepts the updated disconnected probe', {
  skip: !process.env.COOHOM_TEST_LUX3D_ROOT,
}, async t => {
  const root = path.resolve(process.env.COOHOM_TEST_LUX3D_ROOT);
  const require = createRequire(path.join(root, 'package.json'));
  const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
  const { InMemoryTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/inMemory.js')).href);
  const { createServer } = await import(pathToFileURL(path.join(root, 'src/server.js')).href);
  const forbidden = async () => { throw new Error('The disconnected probe must not forward executor operations'); };
  const server = createServer({ prepareWorkspace: async threadId => disconnected(threadId).structuredContent,
    createTask: forbidden, getTask: forbidden, openCreditsPayment: forbidden, getCredits: forbidden });
  const client = new Client({ name: 'coohom-contract-regression', version: '1.0.0' });
  t.after(async () => { await client.close(); await server.close(); });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  assertDiscoveredTools('lux3d-mcp-server', (await client.listTools()).tools.map(tool => tool.name));
  const missingMetadata = await client.callTool({ name: 'get_lux3d_model_task', arguments: { taskId: 'probe' } });
  assert.equal(missingMetadata.isError, true);
  assert.equal(JSON.parse(missingMetadata.content[0].text).code, 'INVALID_INPUT');
  await probeDisconnectedExecutor(async (method, params) => {
    assert.equal(method, 'tools/call');
    return client.callTool(params);
  });
});
