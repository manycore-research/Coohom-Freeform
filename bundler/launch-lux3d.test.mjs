import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const inspect = `process.stdout.write(JSON.stringify({
  pid: process.pid, args: process.argv.slice(2), cwd: process.cwd(),
  hasKey: Boolean(process.env.AHOLO_API_KEY), hasRegion: Boolean(process.env.AHOLO_REGION),
  hasConfig: Boolean(process.env.COOHOM_AHOLO_CONFIG), port: process.env.LUX3D_MCP_BRIDGE_PORT,
  executorUrl: process.env.LUX3D_MCP_EXECUTOR_URL
}));`;

async function fixture(t, { cli = inspect, version = '0.1.0-alpha.1', bin = 'src/index.js', realSdk } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'Coohom Lux3D 启动 '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = join(root, '插件 runtime', 'mcp');
  const packageDirectory = join(runtime, 'lux3d', 'install-fixture', 'node_modules', '@manycore', 'coohom-lux3d-mcp');
  await mkdir(dirname(packageDirectory), { recursive: true });
  await copyFile(join(sourceDirectory, 'launch-lux3d.mjs'), join(runtime, 'launch-lux3d.mjs'));
  await writeFile(join(runtime, 'lux3d-install.json'), JSON.stringify({directory: 'lux3d/install-fixture', version: realSdk ? JSON.parse(await readFile(join(realSdk, 'package.json'), 'utf8')).version : version}));
  if (realSdk) {
    await symlink(realSdk, packageDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  } else {
    await mkdir(join(packageDirectory, 'src'), { recursive: true });
    await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({
      name: '@manycore/coohom-lux3d-mcp', version, type: 'module', bin: { 'lux3d-mcp-server': bin },
    }));
    await writeFile(join(packageDirectory, 'src', 'index.js'), cli);
  }
  return { root, runtime, launcher: join(runtime, 'launch-lux3d.mjs') };
}

function run(t, fixture, { args = [], env: overrides = {}, input = '' } = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (['path', 'node_options', 'node_path', 'aholo_api_key', 'aholo_region', 'coohom_aholo_config', 'lux3d_mcp_bridge_port', 'lux3d_mcp_executor_url'].includes(name.toLowerCase())) delete env[name];
  }
  Object.assign(env, { PATH: '' }, overrides);
  const child = spawn(process.execPath, [fixture.launcher, ...args], {
    env, cwd: fixture.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', chunk => stdout.push(chunk));
  child.stderr.on('data', chunk => stderr.push(chunk));
  const timer = setTimeout(() => child.kill(), 15_000);
  t.after(() => { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8'), pid: child.pid });
    });
  });
  if (input !== null) child.stdin.end(input);
  return { child, done };
}

test('public CLI runs in the same process without credentials or system PATH', async (t) => {
  const files = await fixture(t);
  const result = await run(t, files).done;
  assert.equal(result.code, 0, result.stderr);
  const actual = JSON.parse(result.stdout.toString());
  actual.cwd = await realpath(actual.cwd);
  assert.deepEqual(actual, {
    pid: result.pid, args: [], cwd: await realpath(files.runtime), hasKey: false, hasRegion: false, hasConfig: false,
    executorUrl: 'https://www.coohom.com/pub/tool/bim/ai-home/mcp-executor',
  });
  assert.equal(result.stderr, '');
});

test('legacy Aholo environment is not forwarded and the public bridge port remains configurable', async (t) => {
  const files = await fixture(t);
  const result = await run(t, files, { env: {
    AHOLO_API_KEY: 'old-secret', AHOLO_REGION: 'invalid-old-region',
    COOHOM_AHOLO_CONFIG: join(files.root, 'does-not-exist.json'), LUX3D_MCP_BRIDGE_PORT: '18766',
    LUX3D_MCP_EXECUTOR_URL: 'https://test.coohom.com/custom-executor',
  } }).done;
  assert.equal(result.code, 0, result.stderr);
  const actual = JSON.parse(result.stdout.toString());
  actual.cwd = await realpath(actual.cwd);
  assert.deepEqual(actual, {
    pid: result.pid, args: [], cwd: await realpath(files.runtime), hasKey: false, hasRegion: false, hasConfig: false, port: '18766',
    executorUrl: 'https://test.coohom.com/custom-executor',
  });
  assert.doesNotMatch(result.stdout.toString() + result.stderr, /old-secret|invalid-old-region/);
});

test('entrypoint main-module guard executes with its published argv path', async (t) => {
  const files = await fixture(t, { cli: `import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) process.stdout.write('started');` });
  const result = await run(t, files).done;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.toString(), 'started');
});

test('incorrect package version, missing bin and bin escaping package are rejected', async (t) => {
  for (const options of [{ version: 'wrong-secret-version' }, { bin: null }, { bin: '../escape.js' }]) {
    const files = await fixture(t, options);
    const result = await run(t, files).done;
    assert.equal(result.code, 1);
    assert.equal(result.stdout.length, 0);
    assert.doesNotMatch(result.stderr, /wrong-secret-version/);
  }
});

test('command-line credentials are rejected before executing the package', async (t) => {
  const files = await fixture(t, { cli: "throw new Error('must not execute');" });
  const result = await run(t, files, { args: ['--api-key', 'secret'] }).done;
  assert.equal(result.code, 1);
  assert.equal(result.stdout.length, 0);
  assert.doesNotMatch(result.stderr, /secret|must not execute/);
});

test('stdout bytes and explicit exit status survive without launcher noise', async (t) => {
  const echo = await fixture(t, { cli: 'process.stdin.pipe(process.stdout);' });
  const bytes = Buffer.from([0, 10, 13, 34, 128, 255]);
  const result = await run(t, echo, { input: bytes }).done;
  assert.equal(result.code, 0);
  assert.deepEqual(result.stdout, bytes);
  assert.equal(result.stderr, '');
  const failed = await fixture(t, { cli: 'process.exit(23);' });
  assert.equal((await run(t, failed).done).code, 23);
});

test('caught import errors are not echoed with sensitive contents', async (t) => {
  const files = await fixture(t, { cli: "throw new Error('private-secret');" });
  const result = await run(t, files).done;
  assert.equal(result.code, 1);
  assert.equal(result.stdout.length, 0);
  assert.doesNotMatch(result.stderr, /private-secret/);
});

test('terminating launcher also terminates its actual MCP PID', async (t) => {
  const files = await fixture(t, { cli: "process.stdout.write(String(process.pid)); setInterval(() => {}, 1000);" });
  const { child, done } = run(t, files, { input: null });
  const pid = await new Promise((resolve, reject) => {
    child.stdout.once('data', chunk => resolve(Number(chunk.toString())));
    child.once('error', reject);
    child.once('close', () => reject(new Error('fixture closed before ready')));
  });
  assert.equal(pid, child.pid);
  child.kill('SIGTERM');
  assert.equal((await done).signal, 'SIGTERM');
  assert.throws(() => process.kill(pid, 0));
});

test('real public Lux3D initializes and exposes the plugin workspace contract without authorization', {
  skip: !process.env.COOHOM_TEST_LUX3D_ROOT,
}, async (t) => {
  const files = await fixture(t, { realSdk: process.env.COOHOM_TEST_LUX3D_ROOT });
  const { child, done } = run(t, files, { input: null, env: { LUX3D_MCP_BRIDGE_PORT: '18766' } });
  let buffer = '';
  const listed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', async (code, signal) => {
      const output = await done;
      reject(new Error(`Lux3D closed before tools/list: ${JSON.stringify({ code, signal,
        stdoutBytes: output.stdout.length, stderr: output.stderr })}`));
    });
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message.error) throw new Error('MCP initialization or tool listing failed');
          if (message.id === 1) {
            assert.ok(message.result?.serverInfo);
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
          }
          if (message.id === 2) resolve(message.result.tools);
        } catch (error) { reject(error); }
      }
    });
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'coohom-offline-test', version: '1.0.0' },
  } })}\n`);
  const names = (await listed).map(tool => tool.name);
  for (const name of ['prepare_workspace', 'create_lux3d_model_task', 'get_lux3d_model_task']) assert.ok(names.includes(name));
  child.stdin.end();
  assert.equal((await done).code, 0);
});


test('new installed versions start locally without npm or update policy', async (t) => {
  const files = await fixture(t, { version: '0.1.0-alpha.2' });
  assert.equal((await run(t, files).done).code, 0);
});

test('missing, escaping and mismatched installation records fail before package execution', async (t) => {
  for (const record of [null, {directory: '../escape', version: '0.1.0-alpha.1'},
    {directory: 'lux3d/install-fixture', version: '0.1.0-alpha.2'}]) {
    const files = await fixture(t, { cli: "throw new Error('must-not-run');" });
    const pointer = join(files.runtime, 'lux3d-install.json');
    if (record) await writeFile(pointer, JSON.stringify(record));
    else await rm(pointer);
    const result = await run(t, files).done;
    assert.equal(result.code, 1);
    assert.equal(result.stdout.length, 0);
    assert.doesNotMatch(result.stderr, /must-not-run/);
  }
});
