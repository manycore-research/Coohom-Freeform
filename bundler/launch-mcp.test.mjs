import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcherSource = join(dirname(fileURLToPath(import.meta.url)), 'launch-mcp.mjs');
const publicWrapper = `throw new Error('npx wrapper must not execute');
const path = require('path');
const cliPath = path.resolve(__dirname, './src/cli.ts');
const args = process.argv.slice(2);
const result = spawnSync('npx', ['tsx', cliPath, ...args], { stdio: 'inherit' });`;
const describeInvocation = `
if (!globalThis.fixtureLoaderReady) throw new Error('tsx public loader was not loaded');
process.stdout.write(JSON.stringify({
  args: process.argv.slice(2), pid: process.pid,
  execPath: process.execPath, cwd: process.cwd()
}));`;

async function fixture(t, { cli = describeInvocation, version = '1.0.34', tsxVersion = '4.23.13',
  recordedVersion = version, recordedTsxVersion = tsxVersion, realTsx, wrapper = publicWrapper } = {}) {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, 'coohom-freeform-launch-test-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), parent);
    assert.ok(basename(root).startsWith('coohom-freeform-launch-test-'));
    assert.equal(await realpath(root), root);
    await rm(root, { recursive: true, force: true });
  });
  const runtime = join(root, '插件 runtime', 'mcp');
  const installation = join(runtime, 'freeform', 'install-fixture');
  const freeform = join(installation, 'node_modules', 'freeform-modeling-mcp');
  const tsx = join(installation, 'node_modules', 'tsx');
  await mkdir(join(freeform, 'src'), { recursive: true });
  await copyFile(launcherSource, join(runtime, 'launch-mcp.mjs'));
  const pointer = join(runtime, 'freeform-install.json');
  await writeFile(pointer, JSON.stringify({ packageSpec: 'freeform-modeling-mcp@1.0.34',
    version: recordedVersion, tsxVersion: recordedTsxVersion, directory: 'freeform/install-fixture',
    installedAt: new Date().toISOString() }));
  await writeFile(join(freeform, 'package.json'), JSON.stringify({
    name: 'freeform-modeling-mcp', version, type: 'module', bin: { 'freeform-modeling-mcp': 'index.cjs' },
  }));
  await writeFile(join(freeform, 'index.cjs'), wrapper);
  await writeFile(join(freeform, 'src', 'cli.ts'), cli);
  if (realTsx) {
    await symlink(realTsx, tsx, process.platform === 'win32' ? 'junction' : 'dir');
  } else {
    await mkdir(join(tsx, 'dist'), { recursive: true });
    await writeFile(join(tsx, 'package.json'), JSON.stringify({
      name: 'tsx', version: tsxVersion, type: 'module', bin: './dist/cli.mjs',
      exports: { '.': './dist/loader.mjs', './package.json': './package.json' },
    }));
    await writeFile(join(tsx, 'dist', 'cli.mjs'), "throw new Error('tsx spawning CLI must not run');\n");
    await writeFile(join(tsx, 'dist', 'loader.mjs'), `
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
globalThis.fixtureLoaderReady = true;
registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('/cli.ts')) {
    return { format: 'module', source: readFileSync(new URL(url), 'utf8'), shortCircuit: true };
  }
  return nextLoad(url, context);
} });`);
  }
  return { root, runtime, installation, freeform, tsx, pointer, launcher: join(runtime, 'launch-mcp.mjs') };
}

function run(t, fixture, args = [], input = '') {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (['path', 'node_options', 'node_path'].includes(name.toLowerCase())) delete env[name];
  }
  env.PATH = '';
  const child = spawn(process.execPath, [fixture.launcher, ...args], {
    cwd: fixture.root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', chunk => stdout.push(chunk));
  child.stderr.on('data', chunk => stderr.push(chunk));
  const timer = setTimeout(() => child.kill(), 15_000);
  t.after(() => { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const done = new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8'), pid: child.pid });
    });
  });
  if (input !== null) child.stdin.end(input);
  return { child, done };
}

for (const [args, expected] of [
  [[], ['start', '--stdio']], [['start', '--stdio'], ['start', '--stdio']],
  [['status'], ['status']], [['port', '--url'], ['port', '--url']],
]) {
  test(`public command ${args.join(' ') || '(default)'} runs in the same process without PATH or npm`, async (t) => {
    const files = await fixture(t);
    const pointer = await readFile(files.pointer);
    const result = await run(t, files, args).done;
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout.toString()), {
      args: expected, pid: result.pid, execPath: process.execPath, cwd: files.runtime,
    });
    assert.deepEqual(await readFile(files.pointer), pointer);
  });
}

test('an installation outside the pinned version is rejected before execution', async (t) => {
  const files = await fixture(t, { version: '1.0.35-rc.1', cli: "throw new Error('must-not-run');" });
  const result = await run(t, files).done;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /installation record is invalid/);
  assert.doesNotMatch(result.stderr, /must-not-run/);
});

test('stdio preserves binary bytes without launcher output', async (t) => {
  const files = await fixture(t, { cli: 'process.stdin.pipe(process.stdout);\n' });
  const input = Buffer.from([0, 1, 10, 13, 34, 123, 125, 128, 255]);
  const result = await run(t, files, [], input).done;
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.stdout, input);
  assert.equal(result.stderr, '');
});

test('upstream CLI failure retains its exit code and diagnostics', async (t) => {
  const files = await fixture(t, { cli: "process.stderr.write('fixture failure\\n'); process.exit(23);\n" });
  const result = await run(t, files).done;
  assert.equal(result.code, 23);
  assert.equal(result.stdout.length, 0);
  assert.equal(result.stderr, 'fixture failure\n');
});

test('rejected commands do not execute the upstream CLI', async (t) => {
  const files = await fixture(t);
  for (const args of [['start'], ['port'], ['--help'], ['status', '--stdio'], ['start', '--stdio', '--dev']]) {
    const result = await run(t, files, args).done;
    assert.equal(result.code, 1);
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr, /Allowed commands:/);
  }
});

test('dependency versions must match the recorded installation', async (t) => {
  for (const options of [{ version: '1.0.35-rc.1', recordedVersion: '1.0.34' }, { recordedTsxVersion: '4.23.12' }]) {
    const files = await fixture(t, options);
    const result = await run(t, files).done;
    assert.equal(result.code, 1);
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr, /version does not match the installation record/);
  }
  const files = await fixture(t);
  await rm(join(files.tsx, 'package.json'));
  const result = await run(t, files).done;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Cannot read installed tsx\/package.json/);
});

test('missing or escaping installation records fail without attempting installation', async (t) => {
  const files = await fixture(t);
  await rm(files.pointer);
  const missing = await run(t, files).done;
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /run the plugin installer or updater/);
  await writeFile(files.pointer, JSON.stringify({ packageSpec: 'freeform-modeling-mcp@1.0.34',
    version: '1.0.34', tsxVersion: '4.23.13', directory: '../outside' }));
  const escaped = await run(t, files).done;
  assert.equal(escaped.code, 1);
  assert.match(escaped.stderr, /installation record is invalid/);
});

test('a changed upstream wrapper or escaping delegated CLI is rejected', async (t) => {
  const changed = await fixture(t, { wrapper: "throw new Error('must not execute');" });
  const changedResult = await run(t, changed).done;
  assert.equal(changedResult.code, 1);
  assert.match(changedResult.stderr, /public CLI wrapper changed/);
  const escaped = await fixture(t, { wrapper: publicWrapper.replace('./src/cli.ts', '../escape.ts') });
  const escapedResult = await run(t, escaped).done;
  assert.equal(escapedResult.code, 1);
  assert.match(escapedResult.stderr, /entry is outside its package/);
});

test('terminating the launcher terminates the actual MCP process', async (t) => {
  const files = await fixture(t, { cli: "process.stdout.write(String(process.pid) + '\\n'); setInterval(() => {}, 1000);\n" });
  const { child, done } = run(t, files, [], null);
  const ready = await new Promise((resolvePromise, reject) => {
    child.stdout.once('data', chunk => resolvePromise(chunk.toString().trim()));
    child.once('error', reject);
    child.once('close', () => reject(new Error('fixture closed before ready')));
  });
  assert.equal(Number(ready), child.pid);
  child.kill('SIGTERM');
  const result = await done;
  assert.equal(result.signal, 'SIGTERM');
  assert.throws(() => process.kill(child.pid, 0));
});

test('real installed tsx transpiles TypeScript with no global PATH', {
  skip: !process.env.COOHOM_TEST_TSX_ROOT,
}, async (t) => {
  const realTsx = process.env.COOHOM_TEST_TSX_ROOT;
  const manifest = JSON.parse(await readFile(join(realTsx, 'package.json'), 'utf8'));
  const files = await fixture(t, { realTsx, tsxVersion: manifest.version,
    cli: 'enum Result { Ready = "ready" }; const value: Result = Result.Ready; process.stdout.write(value);\n' });
  const result = await run(t, files, ['status']).done;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.toString(), 'ready');
  assert.equal(result.stderr, '');
});
