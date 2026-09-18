import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installFreeform } from './update-freeform.mjs';

const packageName = 'freeform-modeling-mcp';
const packageSpec = `${packageName}@1.0.34`;
const fixturePrefix = 'coohom-freeform-update-test-';
const fakeNpm = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const options = JSON.parse(process.env.COOHOM_TEST_NPM_OPTIONS);
const args = process.argv.slice(2);
const filteredNames = ['aholo_api_key', 'aholo_region', 'coohom_aholo_config', 'node_options', 'node_path'];
fs.appendFileSync(process.env.COOHOM_TEST_NPM_TRACE, JSON.stringify({
  args, cwd: process.cwd(), execPath: process.execPath, path: process.env.PATH || process.env.Path || '',
  forwardedLegacyNames: Object.keys(process.env).filter(name => filteredNames.includes(name.toLowerCase())),
}) + '\n');
if (options.mode === 'download-failure') {
  fs.writeFileSync('partial-download', 'partial');
  process.stderr.write('npm error code E503\nprivate-registry-url-and-token\n');
  process.exit(1);
}
const versions = { 'freeform-modeling-mcp': options.version || '1.0.34', tsx: options.tsxVersion || '4.23.13' };
const dependencies = {};
const packages = { '': { dependencies } };
for (const [name, version] of Object.entries(versions)) {
  const directory = path.join(process.cwd(), 'node_modules', name);
  fs.mkdirSync(path.join(directory, 'src'), { recursive: true });
  const manifest = { name, version, type: 'module', bin: { [name]: 'index.cjs' } };
  if (name === 'freeform-modeling-mcp') {
    let wrapper = "const path = require('path');\nconst cliPath = path.resolve(__dirname, './src/cli.ts');\nconst args = process.argv.slice(2);\nconst result = spawnSync('npx', ['tsx', cliPath, ...args], { stdio: 'inherit' });";
    if (options.mode === 'missing-bin') delete manifest.bin;
    if (options.mode === 'escaping-bin') manifest.bin[name] = '../escape.js';
    if (options.mode === 'changed-wrapper') wrapper = '// incompatible new wrapper';
    fs.writeFileSync(path.join(directory, 'index.cjs'), wrapper);
    fs.writeFileSync(path.join(directory, 'src', 'cli.ts'), '// fixture CLI');
  } else {
    manifest.exports = { '.': './loader.mjs' };
    fs.writeFileSync(path.join(directory, 'index.cjs'), '// fixture tsx CLI');
    fs.writeFileSync(path.join(directory, 'loader.mjs'), '// fixture public export');
  }
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest));
  dependencies[name] = version;
  packages['node_modules/' + name] = { version };
}
if (options.mode === 'mismatched-freeform-lock') packages['node_modules/freeform-modeling-mcp'].version = '1.0.28';
if (options.mode === 'mismatched-tsx-lock') packages['node_modules/tsx'].version = '4.23.12';
if (options.mode === 'mismatched-root-lock') dependencies['freeform-modeling-mcp'] = '^1.0.34';
fs.writeFileSync('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages }));
fs.writeFileSync('package.json', JSON.stringify({ name: 'fixture', private: true, dependencies }));
`;

async function fixture(t) {
  const temporaryParent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(temporaryParent, fixturePrefix));
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
  await writeFile(path.join(runtime, 'freeform-policy.json'), JSON.stringify({
    packageSpec, tsxVersion: '4.23.13', registry: 'https://registry.npmjs.org/',
  }));
  const trace = path.join(root, 'npm-invocations.jsonl');
  const lines = [];
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (['path', 'node_options', 'node_path', 'aholo_api_key', 'aholo_region', 'coohom_aholo_config'].includes(name.toLowerCase())) delete env[name];
  }
  Object.assign(env, { PATH: '', AHOLO_API_KEY: 'private-old-key', AHOLO_REGION: 'obsolete-region',
    COOHOM_AHOLO_CONFIG: path.join(root, 'old-config.json'), NODE_OPTIONS: '--require=must-not-be-loaded',
    NODE_PATH: path.join(root, 'must-not-be-searched'), COOHOM_TEST_NPM_TRACE: trace });
  return { root, runtime, node, lines, pointer: path.join(runtime, 'freeform-install.json'),
    install: (options = {}) => installFreeform({ pluginRoot,
      env: { ...env, COOHOM_TEST_NPM_OPTIONS: JSON.stringify(options) }, writeLine: line => lines.push(line) }),
    observations: async () => (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) };
}

async function missing(file) { await assert.rejects(access(file), { code: 'ENOENT' }); }
async function cleaned(files) {
  await missing(path.join(files.runtime, '.freeform-update.lock'));
  assert.deepEqual((await readdir(files.runtime)).filter(name => name.startsWith('.freeform-install-')), []);
  for (const observation of await files.observations()) {
    const cache = observation.args.find(argument => argument.startsWith('--cache='));
    assert.ok(cache);
    await missing(cache.slice('--cache='.length));
  }
}

test('installation requests pinned Freeform with bundled Node and records exact versions', async (t) => {
  const files = await fixture(t);
  const installed = await files.install();
  assert.equal(installed.packageSpec, packageSpec);
  assert.equal(installed.version, '1.0.34');
  assert.equal(installed.tsxVersion, '4.23.13');
  assert.match(installed.directory, /^freeform\/install-[^/]+$/);
  assert.deepEqual(JSON.parse(await readFile(files.pointer, 'utf8')), installed);
  const [observation] = await files.observations();
  assert.equal(observation.execPath, files.node);
  assert.equal(observation.cwd, path.join(files.runtime, installed.directory));
  assert.equal(observation.path, '');
  assert.deepEqual(observation.forwardedLegacyNames, []);
  assert.deepEqual(observation.args.slice(0, 4), ['install', packageSpec, 'tsx@4.23.13', '--save-exact']);
  for (const flag of ['--fetch-retries=2', '--fetch-retry-mintimeout=1000', '--fetch-retry-maxtimeout=5000', '--ignore-scripts', '--engine-strict', '--prefer-online', '--registry=https://registry.npmjs.org/']) {
    assert.ok(observation.args.includes(flag));
  }
  assert.ok(!observation.args.some(argument => argument.includes('qunhe')));
  await cleaned(files);
});

test('reinstallation requests the same pinned version and retains the previous installation', async (t) => {
  const files = await fixture(t);
  const previous = await files.install();
  const oldManifest = path.join(files.runtime, previous.directory, 'node_modules', packageName, 'package.json');
  const oldBytes = await readFile(oldManifest);
  const current = await files.install({ version: '1.0.34' });
  assert.notEqual(current.directory, previous.directory);
  assert.equal(current.version, '1.0.34');
  assert.deepEqual(JSON.parse(await readFile(files.pointer, 'utf8')), current);
  assert.deepEqual(await readFile(oldManifest), oldBytes);
  const observations = await files.observations();
  assert.equal(observations.length, 2);
  assert.ok(observations.every(item => item.args[1] === packageSpec));
  await cleaned(files);
});

for (const [options, expected] of [
  [{ version: '1.0.35-rc.1' }, /version does not match the installation record/],
  [{ mode: 'download-failure' }, /download failed \(E503\)/],
  [{ mode: 'missing-bin' }, /does not declare its CLI entry/],
  [{ mode: 'escaping-bin' }, /entry is outside its package/],
  [{ mode: 'changed-wrapper' }, /public CLI wrapper changed/],
  [{ mode: 'mismatched-freeform-lock' }, /version does not match the lockfile/],
  [{ mode: 'mismatched-tsx-lock' }, /version does not match the lockfile/],
  [{ mode: 'mismatched-root-lock' }, /version does not match the lockfile/],
  [{ tsxVersion: '4.23.12' }, /version does not match the installation record/],
]) {
  test(`${options.mode || 'incorrect tsx version'} retains the old pointer and cleans failed installation`, async (t) => {
    const files = await fixture(t);
    const previous = await files.install();
    await writeFile(files.pointer, `\n ${JSON.stringify(previous)}\n\n`);
    const oldPointer = await readFile(files.pointer);
    const previousDirectories = await readdir(path.join(files.runtime, 'freeform'));
    await assert.rejects(files.install(options), error => {
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /private-registry-url-and-token|private-old-key/);
      return true;
    });
    assert.deepEqual(await readFile(files.pointer), oldPointer);
    assert.deepEqual(await readdir(path.join(files.runtime, 'freeform')), previousDirectories);
    await cleaned(files);
  });
}

test('existing update lock rejects a concurrent installation without removing another installer lock', async (t) => {
  const files = await fixture(t);
  await files.install();
  const oldPointer = await readFile(files.pointer);
  const lock = path.join(files.runtime, '.freeform-update.lock');
  await writeFile(lock, 'owned-by-another-installer');
  await assert.rejects(files.install(), /A Freeform MCP installation is running/);
  assert.equal(await readFile(lock, 'utf8'), 'owned-by-another-installer');
  assert.deepEqual(await readFile(files.pointer), oldPointer);
  assert.equal((await files.observations()).length, 1);
});
