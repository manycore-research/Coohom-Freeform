import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installLux3d } from './update-lux3d.mjs';

const packageName = '@manycore/coohom-lux3d-mcp';
const packageSpec = `${packageName}@latest`;
const fixturePrefix = 'coohom-lux3d-update-test-';
const fakeNpm = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const options = JSON.parse(process.env.COOHOM_TEST_NPM_OPTIONS);
const args = process.argv.slice(2);
const filteredNames = ['aholo_api_key', 'aholo_region', 'coohom_aholo_config', 'node_options', 'node_path'];
fs.appendFileSync(process.env.COOHOM_TEST_NPM_TRACE, JSON.stringify({
  args, cwd: process.cwd(), execPath: process.execPath,
  path: process.env.PATH || process.env.Path || '',
  forwardedLegacyNames: Object.keys(process.env).filter(name => filteredNames.includes(name.toLowerCase())),
}) + '\n');
if (options.mode === 'download-failure') {
  fs.writeFileSync('partial-download', 'partial');
  process.stderr.write('npm error code E503\nprivate-registry-url-and-token\n');
  process.exit(1);
}
const name = '@manycore/coohom-lux3d-mcp';
const version = options.version || '0.1.0-alpha.2';
const directory = path.join(process.cwd(), 'node_modules', '@manycore', 'coohom-lux3d-mcp');
fs.mkdirSync(path.join(directory, 'src'), { recursive: true });
const manifest = { name, version, bin: { 'lux3d-mcp-server': 'src/index.js' } };
if (options.mode === 'missing-bin') delete manifest.bin;
if (options.mode === 'escaping-bin') manifest.bin = { 'lux3d-mcp-server': '../escape.js' };
fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest));
fs.writeFileSync(path.join(directory, 'src', 'index.js'), '// fixture CLI');
if (options.mode === 'escaping-bin') fs.writeFileSync(path.join(directory, '..', 'escape.js'), '// outside package');
const lockVersion = options.mode === 'mismatched-package-version' ? '0.1.0-alpha.1' : version;
const rootVersion = options.mode === 'mismatched-root-version' ? '^' + version : version;
fs.writeFileSync('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {
  '': { dependencies: { [name]: rootVersion } },
  ['node_modules/' + name]: { version: lockVersion },
} }));
fs.writeFileSync('package.json', JSON.stringify({ name: 'fixture', private: true, dependencies: { [name]: version } }));
`;

async function fixture(t) {
  const temporaryParent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(temporaryParent, fixturePrefix));
  // Only remove the exact mkdtemp directory, after checking its canonical parent.
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), temporaryParent);
    assert.ok(path.basename(root).startsWith(fixturePrefix));
    assert.equal(await realpath(root), root);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const pluginRoot = path.join(root, '鎻掍欢 with spaces');
  const runtime = path.join(pluginRoot, 'runtime', 'mcp');
  const nodeRoot = path.join(pluginRoot, 'runtime', 'node');
  const node = path.join(nodeRoot, process.platform === 'win32' ? 'node.exe' : 'bin/node');
  const npmCli = path.join(nodeRoot, 'npm', 'bin', 'npm-cli.js');
  await mkdir(runtime, { recursive: true });
  await mkdir(path.dirname(node), { recursive: true });
  await mkdir(path.dirname(npmCli), { recursive: true });
  await copyFile(process.execPath, node);
  await writeFile(npmCli, fakeNpm);
  await writeFile(path.join(runtime, 'lux3d-policy.json'), JSON.stringify({
    packageSpec, registry: 'https://registry.npmjs.org/',
  }));
  const trace = path.join(root, 'npm-invocations.jsonl');
  const lines = [];
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (['path', 'node_options', 'node_path', 'aholo_api_key', 'aholo_region', 'coohom_aholo_config'].includes(name.toLowerCase())) delete env[name];
  }
  Object.assign(env, {
    PATH: '', AHOLO_API_KEY: 'private-old-key', AHOLO_REGION: 'obsolete-region',
    COOHOM_AHOLO_CONFIG: path.join(root, 'old-config.json'),
    NODE_OPTIONS: '--require=must-not-be-loaded', NODE_PATH: path.join(root, 'must-not-be-searched'),
    COOHOM_TEST_NPM_TRACE: trace,
  });
  return {
    root, pluginRoot, runtime, node, npmCli, lines,
    pointer: path.join(runtime, 'lux3d-install.json'),
    install: (options = {}) => installLux3d({ pluginRoot,
      env: { ...env, COOHOM_TEST_NPM_OPTIONS: JSON.stringify(options) }, writeLine: line => lines.push(line),
    }),
    observations: async () => (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line)),
  };
}

async function missing(file) {
  await assert.rejects(access(file), { code: 'ENOENT' });
}

async function cleaned(files) {
  await missing(path.join(files.runtime, '.lux3d-update.lock'));
  assert.deepEqual((await readdir(files.runtime)).filter(name => name.startsWith('.lux3d-install-')), []);
  for (const observation of await files.observations()) {
    const cache = observation.args.find(argument => argument.startsWith('--cache='));
    assert.ok(cache, 'npm receives a temporary cache directory');
    await missing(cache.slice('--cache='.length));
  }
}

test('each installation resolves latest and records an exact installed version using the bundled runtime', async (t) => {
  const files = await fixture(t);
  const installed = await files.install({ version: '0.1.0-alpha.2' });
  assert.equal(installed.packageSpec, packageSpec);
  assert.equal(installed.version, '0.1.0-alpha.2');
  assert.match(installed.directory, /^lux3d\/install-[^/]+$/);
  assert.ok(Number.isFinite(Date.parse(installed.installedAt)));
  assert.deepEqual(JSON.parse(await readFile(files.pointer, 'utf8')), installed);
  const [observation] = await files.observations();
  assert.equal(observation.execPath, files.node);
  assert.equal(observation.cwd, path.join(files.runtime, installed.directory));
  assert.equal(observation.path, '');
  assert.deepEqual(observation.forwardedLegacyNames, []);
  assert.deepEqual(observation.args.slice(0, 3), ['install', packageSpec, '--save-exact']);
  for (const flag of ['--fetch-retries=2', '--fetch-retry-mintimeout=1000', '--fetch-retry-maxtimeout=5000', '--ignore-scripts', '--engine-strict', '--prefer-online', '--@manycore:registry=https://registry.npmjs.org/']) {
    assert.ok(observation.args.includes(flag), `expected npm flag ${flag}`);
  }
  const lock = JSON.parse(await readFile(path.join(files.runtime, installed.directory, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[''].dependencies[packageName], installed.version);
  assert.ok(files.lines.some(line => line.includes('0.1.0-alpha.2')));
  await cleaned(files);
});

test('a second update fetches latest again, switches the pointer and retains the previous installation', async (t) => {
  const files = await fixture(t);
  const previous = await files.install({ version: '0.1.0-alpha.2' });
  const previousManifest = path.join(files.runtime, previous.directory, 'node_modules', '@manycore', 'coohom-lux3d-mcp', 'package.json');
  const oldBytes = await readFile(previousManifest);
  const current = await files.install({ version: '0.1.0-alpha.3' });
  assert.notEqual(previous.directory, current.directory);
  assert.equal(current.version, '0.1.0-alpha.3');
  assert.deepEqual(JSON.parse(await readFile(files.pointer, 'utf8')), current);
  assert.deepEqual(await readFile(previousManifest), oldBytes);
  const observations = await files.observations();
  assert.equal(observations.length, 2);
  assert.ok(observations.every(item => item.args[1] === packageSpec));
  assert.equal((await readdir(path.join(files.runtime, 'lux3d'))).length, 2);
  await cleaned(files);
});

for (const [mode, message] of [
  ['download-failure', /Lux3D download failed \(E503\)/],
  ['missing-bin', /no valid version or public CLI entry/],
  ['escaping-bin', /CLI entry is outside the package directory/],
  ['mismatched-package-version', /version does not match the lockfile/],
  ['mismatched-root-version', /version does not match the lockfile/],
]) {
  test(`${mode} preserves the old pointer byte-for-byte and removes incomplete installation state`, async (t) => {
    const files = await fixture(t);
    const previous = await files.install();
    // Preserve unusual whitespace too: a failed update must not rewrite the pointer.
    await writeFile(files.pointer, `\n ${JSON.stringify(previous)}\n\n`);
    const oldPointer = await readFile(files.pointer);
    const previousDirectories = await readdir(path.join(files.runtime, 'lux3d'));
    await assert.rejects(files.install({ mode, version: '0.1.0-alpha.3' }), (error) => {
      assert.match(error.message, message);
      assert.doesNotMatch(error.message, /private-registry-url-and-token|private-old-key/);
      return true;
    });
    assert.deepEqual(await readFile(files.pointer), oldPointer);
    assert.deepEqual(await readdir(path.join(files.runtime, 'lux3d')), previousDirectories);
    await cleaned(files);
  });
}

test('an existing update lock refuses installation without deleting the lock or changing the current pointer', async (t) => {
  const files = await fixture(t);
  await files.install();
  const oldPointer = await readFile(files.pointer);
  const lock = path.join(files.runtime, '.lux3d-update.lock');
  await writeFile(lock, 'owned-by-another-installer');
  await assert.rejects(files.install(), /A Lux3D installation is running/);
  assert.equal(await readFile(lock, 'utf8'), 'owned-by-another-installer');
  assert.deepEqual(await readFile(files.pointer), oldPointer);
  assert.equal((await files.observations()).length, 1);
});
