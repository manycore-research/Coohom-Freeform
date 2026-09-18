import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { discoverCodex, installBundle, main } from './install.mjs';

const currentPlatform = ['win32', 'darwin'].includes(process.platform) ? process.platform : 'darwin';
const pluginName = 'coohom-freeform';
const bundledMarket = 'coohom-freeform-local';

// These external CLI result fields were verified with Codex CLI 0.153.4.
// Internal fixture state is separate from the JSON emitted by the simulated CLI.
const fixtureProgram = String.raw`
import fs from 'node:fs';
import { cp } from 'node:fs/promises';
import path from 'node:path';
const statePath = process.env.COOHOM_TEST_STATE;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const args = process.argv.slice(2);
const action = args.slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ');
state.calls.push(args);
state.events.push(action);
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
save();
const actionCount = state.calls.filter(call => call.slice(0, call[1] === 'marketplace' ? 3 : 2).join(' ') === action).length;
if (state.fail === action && state.failCount !== 0 && (state.failNth === undefined || actionCount === state.failNth)) {
  if (typeof state.failCount === 'number') state.failCount -= 1;
  save();
  process.stderr.write('DO_NOT_LEAK_TOKEN=fixture-secret');
  process.exit(17);
}
if (state.invalidJson === action) {
  process.stdout.write('DO_NOT_LEAK_TOKEN=fixture-secret');
  process.exit(0);
}
const emit = value => console.log(JSON.stringify(value));
const registeredRoot = name => state.marketplaces[name] ?? state.implicitMarketplaces[name];
const pluginMcp = () => state.plugins.filter(item => item.installed && item.enabled && registeredRoot(item.marketplaceName)).flatMap(item => {
  const configPath = path.join(item.source.path, '.mcp.json');
  if (!fs.existsSync(configPath)) return [];
  const servers = JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers;
  return Object.entries(servers).map(([name, server]) => ({ name, enabled: true, transport: { type: 'stdio', ...server } }));
});
if (action === 'mcp list') {
  let entries = [...state.globalMcp, ...(state.mcpListGlobalOnly ? [] : pluginMcp())];
  if (state.addCompleted && state.corrupt === 'mcp-missing') entries = entries.filter(item => item.name !== 'lux3d-mcp-server');
  if (state.addCompleted && state.corrupt === 'mcp-command') entries = entries.map(item => item.name === 'freeform-modeling-mcp' ? { ...item, transport: { ...item.transport, command: 'wrong-node' } } : item);
  emit(state.unknownMcpShape ? { unexpected: [] } : entries);
} else if (action === 'plugin list') {
  let installed = structuredClone(state.plugins.filter(item => registeredRoot(item.marketplaceName))).map(item => {
    const market = registeredRoot(item.marketplaceName);
    const catalog = JSON.parse(fs.readFileSync(path.join(market, '.agents/plugins/marketplace.json'), 'utf8'));
    const sourcePath = path.resolve(market, catalog.plugins.find(plugin => plugin.name === item.name).source.path);
    return { ...item, source: { source: 'local', path: sourcePath }, marketplaceSource: { sourceType: 'local', source: market } };
  });
  if (state.addCompleted) {
    if (state.corrupt === 'list-version') installed = installed.map(item => ({ ...item, version: '0.0.1' }));
    if (state.corrupt === 'list-source') installed = installed.map(item => ({ ...item, source: { source: 'local', path: state.cacheRoot } }));
    if (state.corrupt === 'list-disabled') installed = installed.map(item => ({ ...item, enabled: false }));
    if (state.corrupt === 'list-uninstalled') installed = installed.map(item => ({ ...item, installed: false }));
  }
  emit({ installed: state.unknownPluginShape ? [{ unknown: true }] : installed, available: [] });
} else if (action === 'plugin marketplace list') {
  emit({ marketplaces: Object.entries(state.marketplaces).map(([name, root]) => ({ name, root })) });
} else if (action === 'plugin marketplace add') {
  const root = path.resolve(args[3]);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
  if (state.marketplaces[catalog.name] && state.marketplaces[catalog.name] !== root) {
    process.stderr.write('marketplace already registered at a different root; remove before adding');
    process.exit(1);
  }
  const alreadyAdded = state.marketplaces[catalog.name] === root;
  state.marketplaces[catalog.name] = root;
  save();
  emit({ marketplaceName: catalog.name, installedRoot: root, alreadyAdded });
} else if (action === 'plugin marketplace remove') {
  const marketplaceName = args[3];
  delete state.marketplaces[marketplaceName];
  save();
  emit({ marketplaceName, installedRoot: null });
} else if (action === 'plugin remove') {
  const pluginId = args[2];
  const existing = state.plugins.find(item => item.pluginId === pluginId);
  if (!existing) process.exit(23);
  if (!state.removeNoop) {
    state.plugins = state.plugins.filter(item => item.pluginId !== pluginId);
    const cacheDirectory = path.resolve(state.cacheRoot, existing.marketplaceName, existing.name, existing.version);
    const cacheRelative = path.relative(path.resolve(state.cacheRoot), cacheDirectory);
    if (!cacheRelative || cacheRelative.startsWith('..') || path.isAbsolute(cacheRelative)) throw new Error('unsafe fixture cache path');
    if (fs.existsSync(cacheDirectory)) fs.rmSync(cacheDirectory, { recursive: true, force: true });
  }
  save();
  emit({ pluginId, name: existing.name, marketplaceName: existing.marketplaceName });
} else if (action === 'plugin add') {
  const pluginId = args[2];
  const separator = pluginId.lastIndexOf('@');
  const name = pluginId.slice(0, separator);
  const marketplaceName = pluginId.slice(separator + 1);
  const market = registeredRoot(marketplaceName);
  if (!market) process.exit(23);
  const catalog = JSON.parse(fs.readFileSync(path.join(market, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
  const sourcePath = path.resolve(market, catalog.plugins.find(item => item.name === name).source.path);
  const manifest = JSON.parse(fs.readFileSync(path.join(sourcePath, '.codex-plugin', 'plugin.json'), 'utf8'));
  const installedPath = path.join(state.cacheRoot, marketplaceName, name, manifest.version);
  state.fixtureStep = 'before cache copy'; save();
  if (state.corrupt !== 'cache-missing') await cp(sourcePath, installedPath, { recursive: true, force: true });
  state.fixtureStep = 'after cache copy'; save();
  if (state.corrupt === 'cache-version') {
    fs.writeFileSync(path.join(installedPath, '.codex-plugin', 'plugin.json'), JSON.stringify({ ...manifest, version: '0.0.1' }));
  }
  if (state.corrupt === 'cache-content') fs.writeFileSync(path.join(installedPath, 'runtime/mcp/launch-mcp.mjs'), '// wrong cached launcher');
  if (state.corrupt === 'cache-mcp') {
    const config = JSON.parse(fs.readFileSync(path.join(installedPath, '.mcp.json'), 'utf8'));
    config.mcpServers['freeform-modeling-mcp'].command = 'wrong-cached-node';
    fs.writeFileSync(path.join(installedPath, '.mcp.json'), JSON.stringify(config));
  }
  state.plugins = state.plugins.filter(item => item.pluginId !== pluginId);
  state.plugins.push({ pluginId, name, marketplaceName, version: manifest.version, installed: true, enabled: true,
    source: { source: 'local', path: sourcePath }, marketplaceSource: { sourceType: 'local', source: market },
    installPolicy: 'AVAILABLE', authPolicy: 'ON_INSTALL' });
  state.addCompleted = true;
  save();
  emit({ pluginId, name, marketplaceName, version: state.corrupt === 'add-version' ? '0.0.1' : manifest.version,
    installedPath: state.corrupt === 'add-path' ? path.join(state.cacheRoot, 'wrong-cache') : installedPath,
    authPolicy: 'ON_INSTALL' });
} else process.exit(23);
`;

async function writeFiles(files) {
  for (const [filename, content] of files) {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, content);
  }
}

async function snapshot(directory) {
  const result = {};
  async function visit(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else result[path.relative(directory, filename)] = (await fs.readFile(filename)).toString('base64');
    }
  }
  await visit(directory);
  return result;
}

async function fixture(t, overrides = {}) {
  const temporaryParent = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(temporaryParent, 'coohom-install-upgrade-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), temporaryParent);
    assert.ok(path.basename(directory).startsWith('coohom-install-upgrade-test-'));
    assert.equal(await fs.realpath(directory), directory);
    await fs.rm(directory, { recursive: true, force: true });
  });
  const bundleRoot = path.join(directory, '中文 安装包');
  const sourcePlugin = path.join(bundleRoot, 'marketplace', 'plugins', pluginName);
  const catalogPath = path.join(bundleRoot, 'marketplace', '.agents', 'plugins', 'marketplace.json');
  const nodeRelative = currentPlatform === 'win32' ? 'runtime/node/node.exe' : 'runtime/node/bin/node';
  const version = overrides.version ?? '0.2.0';
  const files = new Map([
    [path.join(bundleRoot, 'bundle.json'), JSON.stringify({ platform: currentPlatform, arch: process.arch, version, marketplaceName: bundledMarket, pluginName, ...overrides })],
    [catalogPath, JSON.stringify({ name: bundledMarket, plugins: [{ name: pluginName, source: { source: 'local', path: `./plugins/${pluginName}` } }] })],
    [path.join(sourcePlugin, '.codex-plugin/plugin.json'), JSON.stringify({ name: pluginName, version, description: '隔离安装测试' })],
    [path.join(sourcePlugin, nodeRelative), 'fixture runtime'],
    [path.join(sourcePlugin, 'runtime/mcp/launch-mcp.mjs'), '// fixture launch'],
    [path.join(sourcePlugin, 'runtime/mcp/launch-lux3d.mjs'), '// fixture lux3d launch'],
    [path.join(sourcePlugin, 'runtime/node/npm/bin/npm-cli.js'), '// fixture npm'],
    [path.join(sourcePlugin, 'runtime/mcp/update-lux3d.mjs'), '// fixture lux3d updater'],
    [path.join(sourcePlugin, 'runtime/mcp/update-freeform.mjs'), '// fixture freeform updater'],
    [path.join(sourcePlugin, 'runtime/mcp/freeform-policy.json'), JSON.stringify({ packageSpec: 'freeform-modeling-mcp@1.0.34' })],
    [path.join(sourcePlugin, 'runtime/mcp/lux3d-policy.json'), JSON.stringify({ packageSpec: '@manycore/coohom-lux3d-mcp@latest' })],
    [path.join(sourcePlugin, 'skills/coohom-freeform/SKILL.md'), '# fixture skill'],
  ]);
  await writeFiles(files);
  const fakeCodex = path.join(directory, '假 Codex CLI.mjs');
  await fs.writeFile(fakeCodex, fixtureProgram);
  const statePath = path.join(directory, 'fixture-state.json');
  const codexDirectory = path.join(directory, '隔离 Codex 配置');
  const initialState = { globalMcp: [], plugins: [], marketplaces: {}, implicitMarketplaces: {}, calls: [], events: [], cacheRoot: path.join(codexDirectory, 'plugins/cache') };
  await fs.writeFile(statePath, JSON.stringify(initialState));
  const readState = async () => JSON.parse(await fs.readFile(statePath, 'utf8'));
  const setState = async values => fs.writeFile(statePath, JSON.stringify({ ...await readState(), ...values }));
  const event = async name => { const state = await readState(); state.events.push(name); await setState(state); };
  const destination = path.join(directory, '稳定 用户目录');
  const output = [];
  const confirmations = [];
  const updates = { freeform: [], lux3d: [] };
  const options = { bundleRoot, platform: currentPlatform, arch: process.arch,
    argv: ['--destination', destination], cli: { command: process.execPath, prefixArgs: [fakeCodex] },
    env: { ...process.env, CODEX_HOME: codexDirectory, COOHOM_TEST_STATE: statePath,
      COOHOM_AHOLO_CONFIG: path.join(directory, '用户配置', 'aholo.json'),
      AHOLO_API_KEY: 'fixture-private-key', AHOLO_REGION: 'com' },
    writeLine: line => { output.push(line); if (process.env.COOHOM_INSTALL_TEST_DEBUG === '1') { t.diagnostic(line); const state = JSON.parse(readFileSync(statePath, 'utf8')); t.diagnostic(JSON.stringify({ fixtureStep: state.fixtureStep, events: state.events })); } },
    confirmUpgrade: async request => { confirmations.push(request); await event('confirm upgrade'); return true; },
  };
  for (const [name, method, resolvedVersion, packageSpec] of [
    ['freeform', 'updateFreeform', '1.0.34', 'freeform-modeling-mcp@1.0.34'],
    ['lux3d', 'updateLux3d', '0.1.0-alpha.2', '@manycore/coohom-lux3d-mcp@latest'],
  ]) {
    options[method] = async request => {
      updates[name].push(request);
      await event(`${name} update`);
      assert.equal(await fs.readFile(path.join(request.pluginRoot, 'runtime/node/npm/bin/npm-cli.js'), 'utf8'), '// fixture npm');
      const result = { version: resolvedVersion, packageSpec, directory: `${name}/install-fixture`,
        ...(name === 'freeform' ? { tsxVersion: '4.23.13' } : {}) };
      await fs.mkdir(path.join(request.pluginRoot, 'runtime/mcp', result.directory), { recursive: true });
      await fs.writeFile(path.join(request.pluginRoot, `runtime/mcp/${name}-install.json`), JSON.stringify(result));
      const packageName = name === 'freeform' ? 'freeform-modeling-mcp' : '@manycore/coohom-lux3d-mcp';
      const packageDirectory = path.join(request.pluginRoot, 'runtime/mcp', result.directory, 'node_modules', ...packageName.split('/'));
      await fs.mkdir(packageDirectory, { recursive: true });
      await fs.writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({ name: packageName, version: resolvedVersion }));
      return result;
    };
  }
  const assertSourceUntouched = async () => {
    for (const [filename, content] of files) assert.equal(await fs.readFile(filename, 'utf8'), content);
    await assert.rejects(fs.access(path.join(sourcePlugin, '.mcp.json')), { code: 'ENOENT' });
  };
  const seed = async ({ marketplace = bundledMarket, enabled = true, oldVersion = '0.1.0', servers = 'both', implicit = false } = {}) => {
    const oldMarketplace = path.join(directory, `历史 ${marketplace} ${oldVersion}`, 'marketplace');
    const oldSource = path.join(oldMarketplace, 'plugins', pluginName);
    await fs.cp(sourcePlugin, oldSource, { recursive: true });
    const mcpServers = {};
    if (servers === 'both' || servers === 'freeform') mcpServers['freeform-modeling-mcp'] = {
      command: path.join(oldSource, nodeRelative), args: [path.join(oldSource, 'runtime/mcp/launch-mcp.mjs'), 'start', '--stdio'] };
    if (servers === 'both' || servers === 'lux3d') mcpServers['lux3d-mcp-server'] = {
      command: path.join(oldSource, nodeRelative), args: [path.join(oldSource, 'runtime/mcp/launch-lux3d.mjs')], startup_timeout_sec: 120 };
    await writeFiles(new Map([
      [path.join(oldMarketplace, '.agents/plugins/marketplace.json'), JSON.stringify({ name: marketplace, plugins: [{ name: pluginName, source: { source: 'local', path: './plugins/coohom-freeform' } }] })],
      [path.join(oldSource, '.codex-plugin/plugin.json'), JSON.stringify({ name: pluginName, version: oldVersion, mcpServers: './.mcp.json' })],
      [path.join(oldSource, '.mcp.json'), JSON.stringify({ mcpServers })],
      [path.join(oldSource, 'runtime/mcp/freeform-install.json'), '  {"version":"previous-freeform"}\n'],
      [path.join(oldSource, 'runtime/mcp/lux3d-install.json'), '  {"version":"previous-lux3d"}\n'],
    ]));
    const pluginId = `${pluginName}@${marketplace}`;
    const entry = { pluginId, name: pluginName, marketplaceName: marketplace, version: oldVersion,
      installed: true, enabled, source: { source: 'local', path: oldSource },
      marketplaceSource: { sourceType: 'local', source: oldMarketplace }, installPolicy: 'AVAILABLE', authPolicy: 'ON_INSTALL' };
    const state = await readState();
    state.plugins.push(entry);
    (implicit ? state.implicitMarketplaces : state.marketplaces)[marketplace] = oldMarketplace;
    await setState(state);
    const before = await snapshot(oldSource);
    return { entry, oldSource, oldMarketplace, before,
      assertUnchanged: async () => assert.deepEqual(await snapshot(oldSource), before) };
  };
  return { options, directory, destination, sourcePlugin, catalogPath, nodeRelative, codexDirectory, output,
    confirmations, updates, readState, setState, event, seed, assertSourceUntouched };
}

function mutations(state) {
  return state.calls.filter(args => (args[0] === 'plugin' && args[1] !== 'list' && !(args[1] === 'marketplace' && args[2] === 'list')) || (args[0] === 'mcp' && args[1] !== 'list'));
}

async function noLock(f) { await assert.rejects(fs.access(path.join(f.codexDirectory, 'coohom-freeform-install.lock')), { code: 'ENOENT' }); }

function before(events, first, second) {
  assert.ok(events.includes(first), `missing event: ${first}`);
  assert.ok(events.includes(second), `missing event: ${second}`);
  assert.ok(events.indexOf(first) < events.indexOf(second), `${first} must precede ${second}`);
}

test('--check is completely read-only with old installed plugins and an existing cross-version lock', async t => {
  const f = await fixture(t);
  const previous = await f.seed({ marketplace: 'personal', enabled: false });
  await fs.mkdir(f.codexDirectory, { recursive: true });
  const lock = path.join(f.codexDirectory, 'coohom-freeform-install.lock');
  await fs.writeFile(lock, 'other installer owns this lock');
  const configBefore = await snapshot(f.codexDirectory);
  const result = await installBundle({ ...f.options, argv: [...f.options.argv, '--check'] });
  assert.equal(result.checked, true);
  assert.equal(f.confirmations.length, 0);
  assert.equal(f.updates.freeform.length + f.updates.lux3d.length, 0);
  assert.deepEqual(mutations(await f.readState()), []);
  assert.deepEqual(await snapshot(f.codexDirectory), configBefore);
  await assert.rejects(fs.access(f.destination), { code: 'ENOENT' });
  await previous.assertUnchanged();
  await f.assertSourceUntouched();
});

test('fresh installation uses versioned absolute paths with Chinese characters and spaces and verifies both MCPs', async t => {
  const f = await fixture(t);
  const result = await installBundle(f.options);
  assert.equal(result.lux3dVersion, '0.1.0-alpha.2');
  assert.equal(result.freeformVersion, '1.0.34');
  assert.equal(result.installationBase, f.destination);
  assert.ok(path.relative(f.destination, result.destination) && !path.relative(f.destination, result.destination).startsWith('..'));
  const targetPlugin = result.targetPlugin ?? path.join(result.destination, 'marketplace/plugins/coohom-freeform');
  assert.equal(f.updates.freeform[0].pluginRoot, targetPlugin);
  assert.equal(f.updates.lux3d[0].pluginRoot, targetPlugin);
  assert.equal(f.confirmations.length, 0);
  const config = JSON.parse(await fs.readFile(path.join(targetPlugin, '.mcp.json'), 'utf8'));
  assert.deepEqual(config.mcpServers['freeform-modeling-mcp'], {
    command: path.join(targetPlugin, f.nodeRelative), args: [path.join(targetPlugin, 'runtime/mcp/launch-mcp.mjs'), 'start', '--stdio'] });
  assert.deepEqual(config.mcpServers['lux3d-mcp-server'], {
    command: path.join(targetPlugin, f.nodeRelative), args: [path.join(targetPlugin, 'runtime/mcp/launch-lux3d.mjs')], startup_timeout_sec: 120 });
  const state = await f.readState();
  before(state.events, 'freeform update', 'plugin marketplace add');
  before(state.events, 'lux3d update', 'plugin add');
  assert.ok(state.calls.some(args => args.join(' ') === 'mcp list --json'));
  assert.doesNotMatch(f.output.join('\n') + JSON.stringify(config), /fixture-private-key/);
  await assert.rejects(fs.access(f.options.env.COOHOM_AHOLO_CONFIG), { code: 'ENOENT' });
  await noLock(f);
  await f.assertSourceUntouched();
});

for (const previousOptions of [
  { marketplace: bundledMarket, enabled: true }, { marketplace: 'personal', enabled: true },
  { marketplace: bundledMarket, enabled: false }, { marketplace: 'personal', enabled: false },
  { marketplace: 'personal', enabled: true, implicit: true },
]) {
  test(`confirmed upgrade removes ${previousOptions.marketplace} enabled=${previousOptions.enabled} implicit=${Boolean(previousOptions.implicit)} only after dependencies are ready`, async t => {
    const f = await fixture(t);
    const previous = await f.seed(previousOptions);
    const result = await installBundle(f.options);
    assert.equal(f.confirmations.length, 1);
    const confirmation = f.confirmations[0];
    assert.ok(confirmation.removePluginIds.includes(previous.entry.pluginId));
    assert.equal(confirmation.targetVersion, '0.2.0');
    assert.ok(confirmation.previousPlugins.some(entry => entry.pluginId === previous.entry.pluginId && entry.enabled === previousOptions.enabled));
    const state = await f.readState();
    before(state.events, 'freeform update', 'confirm upgrade');
    before(state.events, 'lux3d update', 'confirm upgrade');
    before(state.events, 'confirm upgrade', 'plugin remove');
    before(state.events, 'plugin remove', 'plugin add');
    assert.ok(state.calls.some(args => args.join(' ') === `plugin remove ${previous.entry.pluginId} --json`));
    assert.deepEqual(state.plugins.map(entry => [entry.pluginId, entry.version, entry.enabled]), [[`${pluginName}@${bundledMarket}`, '0.2.0', true]]);
    assert.notEqual(result.targetPlugin, previous.oldSource);
    await previous.assertUnchanged();
    await noLock(f);
  });
}

test('declined confirmation and noninteractive execution preserve old source and registration', async t => {
  for (const mode of ['decline', 'noninteractive']) {
    const f = await fixture(t);
    const previous = await f.seed({ marketplace: 'personal' });
    const beforeState = await f.readState();
    const options = { ...f.options, confirmUpgrade: mode === 'decline' ? async () => false : undefined };
    assert.equal(await main(options), 1);
    const after = await f.readState();
    assert.deepEqual(after.plugins, beforeState.plugins);
    assert.deepEqual(after.marketplaces, beforeState.marketplaces);
    assert.deepEqual(mutations(after), []);
    assert.doesNotMatch(f.output.join('\n'), /Installation complete/);
    if (mode === 'noninteractive') assert.match(f.output.join('\n'), /--yes|noninteractive|confirm/);
    await previous.assertUnchanged();
    await noLock(f);
  }
});

test('--yes authorizes removal of old plugins and does not invoke interactive confirmation', async t => {
  const f = await fixture(t);
  const previous = await f.seed();
  const result = await installBundle({ ...f.options, argv: [...f.options.argv, '--yes'],
    confirmUpgrade: async () => { throw new Error('must not prompt when --yes is present'); } });
  assert.equal(result.checked, false);
  assert.ok(mutations(await f.readState()).some(args => args[1] === 'remove'));
  await previous.assertUnchanged();
});

for (const dependency of ['Freeform', 'Lux3d']) {
  test(`${dependency} download failure leaves old source, pointers and CLI registration byte-for-byte intact`, async t => {
    const f = await fixture(t);
    const previous = await f.seed();
    const original = await f.readState();
    assert.equal(await main({ ...f.options, [`update${dependency}`]: async request => {
      assert.notEqual(request.pluginRoot, previous.oldSource);
      throw new Error(`${dependency} fixture download failure`);
    } }), 1);
    const state = await f.readState();
    assert.deepEqual(state.plugins, original.plugins);
    assert.deepEqual(state.marketplaces, original.marketplaces);
    assert.deepEqual(mutations(state), []);
    assert.equal(f.confirmations.length, 0);
    assert.doesNotMatch(f.output.join('\n'), /Installation complete/);
    await previous.assertUnchanged();
    await noLock(f);
  });
}

test('failed or ineffective official removal cannot report success or proceed to replacement', async t => {
  for (const state of [{ fail: 'plugin remove' }, { removeNoop: true }]) {
    const f = await fixture(t);
    const previous = await f.seed();
    await f.setState(state);
    assert.equal(await main(f.options), 1);
    assert.doesNotMatch(f.output.join('\n'), /Installation complete|DO_NOT_LEAK|fixture-secret/);
    assert.ok(!(await f.readState()).calls.some(args => args[0] === 'plugin' && args[1] === 'add'));
    await previous.assertUnchanged();
    await noLock(f);
  }
});

test('failed new registration restores the old plugin or reports concrete recovery failure', async t => {
  for (const [failCount, implicit] of [[1, false], [1, true], [undefined, true]]) {
    const f = await fixture(t);
    const previous = await f.seed({ marketplace: 'personal', implicit });
    await f.setState({ fail: 'plugin add', failCount });
    assert.equal(await main(f.options), 1);
    const state = await f.readState();
    if (failCount === 1) assert.ok(state.plugins.some(entry => entry.pluginId === previous.entry.pluginId && entry.version === previous.entry.version));
    else assert.match(f.output.join('\n'), /Recovery|previous plugin|Reinstall/);
    assert.doesNotMatch(f.output.join('\n'), /Installation complete|DO_NOT_LEAK|fixture-secret/);
    await previous.assertUnchanged();
    await noLock(f);
  }
});

for (const corrupt of ['add-version', 'add-path', 'list-version', 'list-source', 'list-disabled', 'list-uninstalled',
  'cache-missing', 'cache-version', 'cache-content', 'cache-mcp', 'mcp-command']) {
  test(`verification rejects ${corrupt} instead of reporting installation complete`, async t => {
    const f = await fixture(t);
    await f.setState({ corrupt });
    assert.equal(await main(f.options), 1);
    assert.equal((await f.readState()).addCompleted, true, 'the fake CLI must have completed installation before result verification fails');
    assert.doesNotMatch(f.output.join('\n'), /Installation complete/);
    await noLock(f);
  });
}

test('CLI versions that list only independent MCP entries still verify the installed plugin through its cache', async t => {
  const f = await fixture(t);
  await f.setState({ mcpListGlobalOnly: true });
  const result = await installBundle(f.options);
  assert.equal(result.checked, false);
  const state = await f.readState();
  const installed = state.plugins.find(entry => entry.pluginId === 'coohom-freeform@coohom-freeform-local');
  const cachedConfig = path.join(state.cacheRoot, installed.marketplaceName, installed.name, installed.version, '.mcp.json');
  assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(cachedConfig, 'utf8')).mcpServers).sort(), ['freeform-modeling-mcp', 'lux3d-mcp-server']);
});

test('independent shared MCP conflicts remain untouched even with --yes', async t => {
  for (const server of [
    { name: 'shared-freeform', enabled: true, transport: { command: 'npx', args: ['freeform-modeling-mcp@latest'], env: { TOKEN: 'PRIVATE_GLOBAL' } } },
    { name: 'shared-lux', enabled: true, transport: { command: 'npx', args: ['-y', '@manycore/coohom-lux3d-mcp@latest'], env: { TOKEN: 'PRIVATE_GLOBAL' } } },
    { name: 'legacy-lux', enabled: true, transport: { command: 'npx', args: ['-y', '@qunhe/lux3d-mcp-server@alpha'] } },
  ]) {
    const f = await fixture(t);
    const previous = await f.seed({ marketplace: 'personal', servers: server.name.includes('freeform') ? 'lux3d' : 'freeform' });
    await f.setState({ globalMcp: [server] });
    const globalConfig = path.join(f.codexDirectory, 'config.toml');
    await writeFiles(new Map([[globalConfig, 'user configuration with private value']]));
    assert.equal(await main({ ...f.options, argv: [...f.options.argv, '--yes'] }), 1);
    assert.deepEqual((await f.readState()).globalMcp, [server]);
    assert.deepEqual(mutations(await f.readState()), []);
    assert.equal(await fs.readFile(globalConfig, 'utf8'), 'user configuration with private value');
    assert.equal(f.updates.freeform.length + f.updates.lux3d.length, 0);
    assert.doesNotMatch(f.output.join('\n'), /PRIVATE_GLOBAL/);
    await assert.rejects(fs.access(f.destination), { code: 'ENOENT' });
    await previous.assertUnchanged();
  }
});

test('similar global paths or additional arguments do not inherit plugin ownership', async t => {
  for (const mismatch of ['command', 'launcher', 'extra-argument']) {
    const f = await fixture(t);
    const previous = await f.seed({ servers: 'lux3d' });
    const transport = { type: 'stdio', command: path.join(previous.oldSource, f.nodeRelative),
      args: [path.join(previous.oldSource, 'runtime/mcp/launch-mcp.mjs'), 'start', '--stdio'] };
    if (mismatch === 'command') transport.command += '-another';
    if (mismatch === 'launcher') transport.args[0] += '-another';
    if (mismatch === 'extra-argument') transport.args.push('--extra');
    const global = { name: 'freeform-modeling-mcp', enabled: true, transport };
    await f.setState({ globalMcp: [global] });
    assert.equal(await main(f.options), 1);
    assert.deepEqual(mutations(await f.readState()), []);
    assert.deepEqual((await f.readState()).globalMcp, [global]);
    await previous.assertUnchanged();
  }
});

test('cross-version installations with different destination directories share one Codex environment lock', async t => {
  const first = await fixture(t, { version: '0.2.0' });
  const second = await fixture(t, { version: '0.3.0' });
  second.options.env.CODEX_HOME = first.codexDirectory;
  let entered;
  let release;
  const ready = new Promise(resolve => { entered = resolve; });
  const paused = new Promise(resolve => { release = resolve; });
  const running = installBundle({ ...first.options, updateFreeform: async request => {
    entered(); await paused; return first.options.updateFreeform(request);
  } });
  try {
    await ready;
    await assert.rejects(installBundle(second.options), /installation is already running|lock file/);
    assert.equal(second.updates.freeform.length + second.updates.lux3d.length, 0);
    assert.deepEqual(mutations(await second.readState()), []);
    await fs.access(path.join(first.codexDirectory, 'coohom-freeform-install.lock'));
  } finally { release(); await running; }
  await noLock(first);
  await first.assertSourceUntouched();
  await second.assertSourceUntouched();
});

test('wrong platform, missing required files and malformed CLI results fail before installation writes', async t => {
  for (const invalid of ['platform', 'npm', 'updater', 'policy', 'mcp-shape', 'plugin-shape', 'json']) {
    const f = await fixture(t, invalid === 'platform' ? { platform: currentPlatform === 'win32' ? 'darwin' : 'win32' } : {});
    const missing = { npm: 'runtime/node/npm/bin/npm-cli.js', updater: 'runtime/mcp/update-freeform.mjs', policy: 'runtime/mcp/lux3d-policy.json' }[invalid];
    if (missing) await fs.unlink(path.join(f.sourcePlugin, missing));
    if (invalid === 'mcp-shape') await f.setState({ unknownMcpShape: true });
    if (invalid === 'plugin-shape') await f.setState({ unknownPluginShape: true });
    if (invalid === 'json') await f.setState({ invalidJson: 'mcp list' });
    assert.equal(await main(f.options), 1);
    assert.deepEqual(mutations(await f.readState()), []);
    assert.equal(f.updates.freeform.length + f.updates.lux3d.length, 0);
    await assert.rejects(fs.access(f.destination), { code: 'ENOENT' });
    assert.doesNotMatch(f.output.join('\n'), /DO_NOT_LEAK|fixture-secret/);
  }
});

test('legacy Aholo credentials and unrelated global MCPs are not read or modified', async t => {
  const f = await fixture(t);
  const global = { name: 'user-aholo', enabled: true, transport: { type: 'stdio', command: 'npx', args: ['@manycore/aholo-sdk-mcp'], env: { AHOLO_API_KEY: 'another-private-key' } } };
  await f.setState({ globalMcp: [global] });
  await writeFiles(new Map([[f.options.env.COOHOM_AHOLO_CONFIG, 'intentionally invalid legacy JSON']]));
  await installBundle(f.options);
  assert.equal(await fs.readFile(f.options.env.COOHOM_AHOLO_CONFIG, 'utf8'), 'intentionally invalid legacy JSON');
  assert.deepEqual((await f.readState()).globalMcp, [global]);
  assert.doesNotMatch(f.output.join('\n'), /another-private-key|fixture-private-key/);
});

test('CLI discovery prefers explicit executable, then PATH, then installed Windows app', async t => {
  const f = await fixture(t);
  const localData = path.join(f.directory, '用户 AppData');
  const pathDirectory = path.join(f.directory, 'PATH CLI');
  const explicit = path.join(f.directory, '显式 CLI', 'codex.exe');
  const onPath = path.join(pathDirectory, 'codex.exe');
  const inApp = path.join(localData, 'OpenAI/Codex/bin/build-one/codex.exe');
  await writeFiles(new Map([explicit, onPath, inApp].map(filename => [filename, 'fixture executable'])));
  const env = { COOHOM_CODEX_CLI: explicit, PATH: pathDirectory, LOCALAPPDATA: localData };
  assert.equal((await discoverCodex({ env, platform: 'win32' })).command, explicit);
  delete env.COOHOM_CODEX_CLI;
  assert.equal((await discoverCodex({ env, platform: 'win32' })).command, onPath);
  env.PATH = '';
  assert.equal((await discoverCodex({ env, platform: 'win32' })).command, inApp);
});

test('invalid explicit CLI and removed credential options fail with actionable errors', async t => {
  const f = await fixture(t);
  await assert.rejects(discoverCodex({ platform: 'win32', env: { COOHOM_CODEX_CLI: path.join(f.directory, 'nonexistent.exe') } }), /COOHOM_CODEX_CLI/);
  assert.equal(await main({ ...f.options, argv: [...f.options.argv, '--configure-aholo'] }), 1);
  assert.deepEqual((await f.readState()).calls, []);
});

test('command entry point propagates a failing exit status', async t => {
  const f = await fixture(t, { platform: currentPlatform === 'win32' ? 'darwin' : 'win32' });
  const invocation = `import {main} from ${JSON.stringify(new URL('./install.mjs', import.meta.url).href)}; process.exitCode = await main(${JSON.stringify({ ...f.options, writeLine: undefined, confirmUpgrade: undefined })});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', invocation], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /This bundle is for/);
});

test('reinstalling the same bundle confirms removal and creates a new source before replacing the cached version', async t => {
  const f = await fixture(t);
  const first = await installBundle(f.options);
  const firstSource = first.targetPlugin;
  const sourceBefore = await snapshot(firstSource);
  await f.setState({ calls: [], events: [] });
  const second = await installBundle(f.options);
  assert.notEqual(second.targetPlugin, firstSource);
  assert.equal(f.confirmations.length, 1);
  assert.deepEqual(await snapshot(firstSource), sourceBefore);
  const state = await f.readState();
  before(state.events, 'plugin remove', 'plugin marketplace remove');
  before(state.events, 'plugin marketplace remove', 'plugin marketplace add');
  before(state.events, 'plugin marketplace add', 'plugin add');
  const cachedConfig = JSON.parse(await fs.readFile(path.join(second.installedPath, '.mcp.json'), 'utf8'));
  assert.equal(cachedConfig.mcpServers['freeform-modeling-mcp'].command, path.join(second.targetPlugin, f.nodeRelative));
  await noLock(f);
});

test('shared MCP or plugin state changes during confirmation stop removal after rechecking current CLI state', async t => {
  for (const change of ['shared-mcp', 'plugin-enabled']) {
    const f = await fixture(t);
    const previous = await f.seed({ marketplace: 'personal', implicit: true });
    const shared = { name: 'newly-enabled-freeform', enabled: true, transport: { command: 'npx', args: ['freeform-modeling-mcp@latest'] } };
    assert.equal(await main({ ...f.options, confirmUpgrade: async () => {
      const state = await f.readState();
      if (change === 'shared-mcp') state.globalMcp = [shared];
      else state.plugins = state.plugins.map(entry => ({ ...entry, enabled: false }));
      await f.setState(state);
      return true;
    } }), 1);
    const state = await f.readState();
    assert.deepEqual(mutations(state), []);
    assert.equal(state.plugins[0].pluginId, previous.entry.pluginId);
    if (change === 'shared-mcp') assert.deepEqual(state.globalMcp, [shared]);
    else assert.equal(state.plugins[0].enabled, false);
    assert.doesNotMatch(f.output.join('\n'), /Installation complete/);
    await previous.assertUnchanged();
    await noLock(f);
  }
});

test('old source version drift and shared marketplace catalogs fail during read-only upgrade checks', async t => {
  for (const invalid of ['source-version', 'other-plugin-in-marketplace']) {
    for (const check of [true, false]) {
      const f = await fixture(t);
      const previous = await f.seed();
      if (invalid === 'source-version') {
        const manifest = path.join(previous.oldSource, '.codex-plugin/plugin.json');
        const contents = JSON.parse(await fs.readFile(manifest, 'utf8'));
        await fs.writeFile(manifest, JSON.stringify({ ...contents, version: '0.1.1' }));
      } else {
        const catalogPath = path.join(previous.oldMarketplace, '.agents/plugins/marketplace.json');
        const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
        catalog.plugins.push({ name: 'other-user-plugin', source: { source: 'local', path: './plugins/other-user-plugin' } });
        await fs.writeFile(catalogPath, JSON.stringify(catalog));
      }
      const oldSource = await snapshot(previous.oldSource);
      const oldMarket = await snapshot(previous.oldMarketplace);
      assert.equal(await main({ ...f.options, argv: [...f.options.argv, ...(check ? ['--check'] : [])] }), 1);
      assert.deepEqual(mutations(await f.readState()), []);
      assert.equal(f.updates.freeform.length + f.updates.lux3d.length, 0);
      assert.deepEqual(await snapshot(previous.oldSource), oldSource);
      assert.deepEqual(await snapshot(previous.oldMarketplace), oldMarket);
      await assert.rejects(fs.access(f.destination), { code: 'ENOENT' });
    }
  }
});

test('marketplace replacement failures restore the old source registration and plugin version', async t => {
  for (const fail of ['plugin marketplace remove', 'plugin marketplace add']) {
    const f = await fixture(t);
    const previous = await f.seed();
    await f.setState({ fail, failCount: 1 });
    assert.equal(await main(f.options), 1);
    const state = await f.readState();
    assert.equal(state.marketplaces[bundledMarket], previous.oldMarketplace);
    assert.ok(state.plugins.some(entry => entry.pluginId === previous.entry.pluginId
      && entry.version === previous.entry.version && entry.enabled && entry.source.path === previous.oldSource));
    assert.doesNotMatch(f.output.join('\n'), /Installation complete|DO_NOT_LEAK|fixture-secret/);
    await previous.assertUnchanged();
    await noLock(f);
  }
});

test('failure removing a second old plugin restores the first enabled plugin and never re-enables a disabled plugin', async t => {
  for (const enabled of [true, false]) {
    const f = await fixture(t);
    const first = await f.seed({ marketplace: 'personal', implicit: true, enabled });
    const second = await f.seed();
    await f.setState({ fail: 'plugin remove', failNth: 2 });
    assert.equal(await main(f.options), 1);
    const state = await f.readState();
    assert.ok(state.plugins.some(entry => entry.pluginId === second.entry.pluginId && entry.version === second.entry.version));
    if (enabled) assert.ok(state.plugins.some(entry => entry.pluginId === first.entry.pluginId && entry.version === first.entry.version && entry.enabled));
    else {
      assert.ok(!state.calls.some(args => args[0] === 'plugin' && args[1] === 'add' && args[2] === first.entry.pluginId));
      assert.match(f.output.join('\n'), /previously disabled|keep it disabled/);
    }
    assert.doesNotMatch(f.output.join('\n'), /Installation complete|DO_NOT_LEAK|fixture-secret/);
    await first.assertUnchanged();
    await second.assertUnchanged();
    await noLock(f);
  }
});
