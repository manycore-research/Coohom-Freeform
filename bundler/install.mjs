import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFreeform } from './update-freeform.mjs';
import { installLux3d } from './update-lux3d.mjs';

const PLUGIN_NAME = 'coohom-freeform';
const MARKETPLACE_NAME = 'coohom-freeform-local';
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const NODE_PATHS = { win32: 'runtime/node/node.exe', darwin: 'runtime/node/bin/node' };
const LAUNCH_PATH = 'runtime/mcp/launch-mcp.mjs';
const LUX3D_LAUNCH_PATH = 'runtime/mcp/launch-lux3d.mjs';
const LUX3D_SERVER_NAME = 'lux3d-mcp-server';

export function parseArguments(argv) {
  const options = { check: false, yes: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') options.check = true;
    else if (argument === '--yes') options.yes = true;
    else if (argument === '--destination') {
      const destination = argv[++index];
      if (!destination || destination.startsWith('--')) throw new Error('--destination requires a directory path.');
      options.destination = path.resolve(destination);
    } else throw new Error(`Unsupported installation argument: ${argument}`);
  }
  return options;
}

async function isFile(candidate) {
  try { return (await fs.stat(candidate)).isFile(); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

async function readJson(filename, label) {
  try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch { throw new Error(`${label} is missing or is not valid JSON.`); }
}

export async function discoverCodex({ env = process.env, platform = process.platform } = {}) {
  if (env.COOHOM_CODEX_CLI) {
    const command = path.resolve(env.COOHOM_CODEX_CLI);
    if (!(await isFile(command)) || (platform === 'win32' && !command.toLowerCase().endsWith('.exe'))) {
      throw new Error('COOHOM_CODEX_CLI does not point to a usable Codex executable. On Windows, specify codex.exe.');
    }
    return { command, prefixArgs: [] };
  }
  const executable = platform === 'win32' ? 'codex.exe' : 'codex';
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  for (const directory of pathValue.split(platform === 'win32' ? ';' : ':')) {
    if (!directory) continue;
    const command = path.join(directory.replace(/^"|"$/g, ''), executable);
    if (await isFile(command)) return { command, prefixArgs: [] };
  }
  if (platform === 'win32' && env.LOCALAPPDATA) {
    const binDirectory = path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    let entries = [];
    try { entries = await fs.readdir(binDirectory, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const candidates = [];
    for (const entry of entries.filter((item) => item.isDirectory())) {
      const command = path.join(binDirectory, entry.name, 'codex.exe');
      if (await isFile(command)) candidates.push({ command, modified: (await fs.stat(command)).mtimeMs });
    }
    candidates.sort((left, right) => right.modified - left.modified);
    if (candidates.length) return { command: candidates[0].command, prefixArgs: [] };
  }
  if (platform === 'darwin') {
    const command = '/Applications/Codex.app/Contents/Resources/codex';
    if (await isFile(command)) return { command, prefixArgs: [] };
  }
  throw new Error('Codex CLI was not found. Install Codex first, or set COOHOM_CODEX_CLI to the full path of its executable.');
}

export function runCodexJson(cli, args, { env = process.env, cwd, label } = {}) {
  const result = spawnSync(cli.command, [...(cli.prefixArgs ?? []), ...args], {
    cwd, env, encoding: 'utf8', shell: false, windowsHide: true,
    timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  });
  // MCP list output can contain environment values. Never echo CLI output on failure.
  if (result.error) throw new Error(`${label} could not run (${result.error.code ?? 'startup failed'}). CLI configuration has not been printed.`);
  if (result.status !== 0) throw new Error(`${label} failed (exit code ${result.status ?? 'unknown'}). Check this operation in Codex. CLI configuration has not been printed.`);
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`${label} did not return valid JSON. Installation stopped. CLI configuration has not been printed.`); }
}

function validatePluginList(result) {
  if (!result || !Array.isArray(result.installed) || !Array.isArray(result.available)) {
    throw new Error('Unrecognized Codex plugin list format. Update Codex and try again.');
  }
  const entries = [...result.installed, ...result.available];
  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string' || typeof entry.marketplaceName !== 'string'
      || typeof entry.installed !== 'boolean' || typeof entry.enabled !== 'boolean') {
      throw new Error('Unrecognized Codex plugin entry format. Update Codex and try again.');
    }
  }
  return entries;
}

async function isInstalledPluginMcp(entry, plugins) {
  const transport = entry.transport;
  if (!transport || !Array.isArray(transport.args)) return false;
  for (const plugin of plugins) {
    if (plugin.name !== PLUGIN_NAME || !plugin.installed || plugin.source?.source !== 'local'
      || !path.isAbsolute(plugin.source.path ?? '')) continue;
    const source = path.resolve(plugin.source.path);
    // Only recognize a server launched from this plugin's source directory.
    // An npx/global server stays shared even when an old plugin references it.
    if (!path.isAbsolute(transport.command ?? '') || !isInside(source, transport.command)
      || !path.isAbsolute(transport.args[0] ?? '') || !isInside(source, transport.args[0])) continue;
    let config;
    try { config = JSON.parse(await fs.readFile(path.join(source, '.mcp.json'), 'utf8')); }
    catch { continue; }
    const owned = config.mcpServers?.[entry.name];
    if (owned?.command === transport.command && JSON.stringify(owned.args) === JSON.stringify(transport.args)) return true;
  }
  return false;
}

export async function checkConflicts(mcpEntries, pluginResult) {
  const plugins = validatePluginList(pluginResult);
  if (!Array.isArray(mcpEntries)) throw new Error('Unrecognized Codex MCP list format. Update Codex and try again.');
  const conflicts = [];
  for (const entry of mcpEntries) {
    if (!entry || typeof entry.name !== 'string' || typeof entry.enabled !== 'boolean') {
      throw new Error('Unrecognized Codex MCP entry format. Update Codex and try again.');
    }
    const transport = entry.transport;
    const commandParts = [entry.name, transport?.command, ...(Array.isArray(transport?.args) ? transport.args : [])];
    const relevant = commandParts.some((part) => typeof part === 'string'
      && /(?:^|[\\/])(?:(?:@qunhe|@manycore)[\\/])?(?:lux3d-mcp-server|coohom-lux3d-mcp|freeform-modeling-mcp)(?:@[^\\/]+)?(?:[\\/]|$)/.test(part))
      || /^(?:freeform(?:[-_]modeling[-_]mcp)?|lux3d-mcp-server)$/i.test(entry.name);
    if (entry.enabled && relevant && !(await isInstalledPluginMcp(entry, plugins))) conflicts.push(entry.name);
  }
  if (conflicts.length) {
    throw new Error(`Enabled standalone or shared MCP services detected: ${conflicts.join(', ')}. Save your scenes and pause tasks using these services, then disable the listed services under MCP servers in Codex settings and try again. --yes does not bypass this check. The installer does not change global MCP configuration.`);
  }
}

function isInside(parent, candidate) {
  const relative = path.relative(path.toNamespacedPath(parent), path.toNamespacedPath(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function hashFile(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !path.isAbsolute(left) || !path.isAbsolute(right)) return false;
  const normalize = (value) => process.platform === 'win32'
    ? path.toNamespacedPath(path.resolve(value)).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}

function pluginId(entry) {
  if (entry.name !== PLUGIN_NAME || !/^[A-Za-z0-9_-]+$/.test(entry.marketplaceName)) {
    throw new Error('The existing plugin name or marketplace identifier is invalid. Upgrade stopped.');
  }
  const id = `${PLUGIN_NAME}@${entry.marketplaceName}`;
  if (entry.pluginId !== id || typeof entry.version !== 'string' || !entry.version) {
    throw new Error('The existing plugin has no verifiable pluginId or version. Update Codex and try again.');
  }
  return id;
}

function validateMarketplaces(result) {
  if (!result || !Array.isArray(result.marketplaces) || result.marketplaces.some((entry) =>
    typeof entry.name !== 'string' || typeof entry.root !== 'string' || !path.isAbsolute(entry.root))) {
    throw new Error('Unrecognized Codex marketplace list. Update Codex and try again.');
  }
  return result.marketplaces;
}

function previousPlugins(state) {
  const entries = validatePluginList(state.plugins).filter((entry) => entry.name === PLUGIN_NAME && entry.installed);
  return [...new Map(entries.map((entry) => [pluginId(entry), {
    ...entry, marketplaceRoot: state.marketplaces.find((marketplace) => marketplace.name === entry.marketplaceName)?.root,
  }])).values()];
}

async function validateUpgradeState(state, destination) {
  await checkConflicts(state.mcp, state.plugins);
  const previous = previousPlugins(state);
  for (const entry of previous) {
    if (entry.source?.source !== 'local' || !path.isAbsolute(entry.source.path ?? '')) {
      throw new Error(`${entry.pluginId} does not have a verifiable local source directory, so recovery cannot be prepared. Resolve the existing source in Codex and try again.`);
    }
    if (destination && (isInside(entry.source.path, destination) || isInside(destination, entry.source.path))) {
      throw new Error(`${entry.pluginId} has a source directory that overlaps the new installation. Choose a separate installation parent directory.`);
    }
    const manifest = await readJson(path.join(entry.source.path, '.codex-plugin/plugin.json'), `${entry.pluginId} original source manifest`);
    if (manifest.name !== PLUGIN_NAME || manifest.version !== entry.version) {
      throw new Error(`${entry.pluginId} has a source version that differs from installed version ${entry.version}. The original version cannot be restored. Check that source before trying again.`);
    }
  }
  if (validatePluginList(state.plugins).some((entry) => entry.marketplaceName === MARKETPLACE_NAME && entry.name !== PLUGIN_NAME)) {
    throw new Error('The target marketplace also contains other plugins. Configure a separate Coohom source in Codex first. The installer will not replace a shared marketplace.');
  }
  const previousMarketplace = state.marketplaces.find((entry) => entry.name === MARKETPLACE_NAME)?.root;
  if (previousMarketplace) {
    const catalog = await readJson(path.join(previousMarketplace, '.agents/plugins/marketplace.json'), 'existing marketplace catalog');
    if (catalog.name !== MARKETPLACE_NAME || !Array.isArray(catalog.plugins)
      || catalog.plugins.some((entry) => entry.name !== PLUGIN_NAME)) {
      throw new Error('The existing marketplace contains other plugins or cannot be verified. The installer will not replace a shared marketplace.');
    }
  }
  return { previous, previousMarketplace };
}

function upgradeFingerprint(state) {
  const previous = previousPlugins(state);
  const relevantMarkets = new Set([MARKETPLACE_NAME, ...previous.map((entry) => entry.marketplaceName)]);
  const normalize = (value) => {
    if (!value) return null;
    const resolved = path.toNamespacedPath(path.resolve(value));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return JSON.stringify({
    plugins: previous.map((entry) => ({ pluginId: entry.pluginId, version: entry.version,
      enabled: entry.enabled, sourceType: entry.source?.source, source: normalize(entry.source?.path),
    })).sort((left, right) => left.pluginId.localeCompare(right.pluginId)),
    marketplaces: [...relevantMarkets].sort().map((name) => ({ name,
      root: normalize(state.marketplaces.find((entry) => entry.name === name)?.root),
    })),
  });
}

function printPlan(previous, targetVersion, targetPlugin, writeLine) {
  writeLine(`Target plugin: ${PLUGIN_NAME} ${targetVersion}; installation directory: ${targetPlugin}`);
  for (const entry of previous) {
    writeLine(`Replace: ${entry.pluginId} ${entry.version} (${entry.enabled ? 'enabled' : 'disabled'}) -> ${targetVersion}; previous source: ${entry.source?.path ?? entry.marketplaceRoot ?? 'unknown source'}`);
  }
  if (previous.length) writeLine('The installer will prepare the new runtime, then ask you to confirm removal of the listed plugins before installing the new version. Save your scenes and stop modeling. Codex will remove the old plugin cache; personal source code, old installation sources, scenes and standalone/shared MCP services will be preserved.');
  else writeLine('The installer will prepare the runtime and install the Freeform and Lux3D MCPs.');
}

async function defaultConfirmUpgrade({ message }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Removal cannot be confirmed in a noninteractive session. Run in a terminal and enter Y, or explicitly pass --yes to approve removal of the listed plugins. Standalone/shared MCP conflicts still require manual resolution.');
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^(?:y|yes)$/i.test((await prompt.question(`${message} [y/N] `)).trim()); }
  finally { prompt.close(); }
}

function samePlugin(entry, expected) {
  return entry?.installed && entry.name === PLUGIN_NAME && entry.marketplaceName === expected.marketplaceName
    && entry.version === expected.version && entry.source?.source === 'local'
    && samePath(entry.source.path, expected.source?.path);
}

async function verifyInstallation({ invoke, added, targetPlugin, version, mcpConfig, codexHome, freeform, lux3d }) {
  const id = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
  if (added?.pluginId !== id || added.name !== PLUGIN_NAME || added.marketplaceName !== MARKETPLACE_NAME
    || added.version !== version || !path.isAbsolute(added.installedPath ?? '')) {
    throw new Error('The CLI installation result has an unexpected plugin identity, version or cache directory.');
  }
  const cache = added.installedPath;
  if (!isInside(path.join(codexHome, 'plugins', 'cache'), cache) || samePath(cache, targetPlugin)) {
    throw new Error('The CLI returned an installation cache outside the current Codex configuration directory.');
  }
  const installed = validatePluginList(invoke(['plugin', 'list', '--json'], 'Verify plugin version and source'));
  const expected = { marketplaceName: MARKETPLACE_NAME, version, source: { path: targetPlugin } };
  const matches = installed.filter((entry) => entry.name === PLUGIN_NAME && entry.installed);
  if (matches.length !== 1 || !samePlugin(matches[0], expected) || !matches[0].enabled) {
    throw new Error('Could not verify that only the new plugin is installed and enabled, or its version or absolute source path does not match.');
  }
  const criticalFiles = ['.codex-plugin/plugin.json', '.mcp.json', LAUNCH_PATH, LUX3D_LAUNCH_PATH,
    'runtime/mcp/update-freeform.mjs', 'runtime/mcp/update-lux3d.mjs',
    'runtime/mcp/freeform-policy.json', 'runtime/mcp/freeform-package-lock.json', 'runtime/mcp/lux3d-policy.json',
    'runtime/mcp/freeform-install.json', 'runtime/mcp/lux3d-install.json'];
  for (const relative of criticalFiles) {
    if ((await hashFile(path.join(targetPlugin, relative))) !== (await hashFile(path.join(cache, relative)))) {
      throw new Error(`Installation cache differs from the new source: ${relative}`);
    }
  }
  for (const root of [targetPlugin, cache]) {
    const config = await readJson(path.join(root, '.mcp.json'), 'MCP configuration');
    if (JSON.stringify(config) !== JSON.stringify(mcpConfig)) throw new Error('MCP startup paths or arguments do not point to the new installation directory.');
    const manifest = await readJson(path.join(root, '.codex-plugin/plugin.json'), 'plugin manifest');
    if (manifest.name !== PLUGIN_NAME || manifest.version !== version || manifest.mcpServers !== './.mcp.json') {
      throw new Error('The plugin manifest version or MCP configuration reference does not match.');
    }
    for (const [name, installation, packageName] of [
      ['freeform', freeform, 'freeform-modeling-mcp'], ['lux3d', lux3d, '@manycore/coohom-lux3d-mcp'],
    ]) {
      const runtime = path.join(root, 'runtime/mcp');
      const pointer = await readJson(path.join(runtime, `${name}-install.json`), `${name} installation record`);
      const installedDirectory = path.resolve(runtime, pointer.directory ?? '');
      if (pointer.version !== installation.version || pointer.packageSpec !== installation.packageSpec
        || typeof pointer.directory !== 'string' || !isInside(path.join(runtime, name), installedDirectory)) {
        throw new Error(`${name} installation record does not match the prepared dependency version.`);
      }
      const pkg = await readJson(path.join(installedDirectory, 'node_modules', ...packageName.split('/'), 'package.json'), `${name} package`);
      if (pkg.name !== packageName || pkg.version !== pointer.version) throw new Error(`${name} package version does not match its installation record.`);
    }
  }
  const actualMcp = invoke(['mcp', 'list', '--json'], 'Verify MCP startup configuration');
  if (!Array.isArray(actualMcp)) throw new Error('Could not verify the MCP list.');
  // Some CLI versions omit plugin-provided servers from `mcp list`.
  // The source and installed cache configs above are always checked exactly.
  for (const [name, expectedServer] of Object.entries(mcpConfig.mcpServers)) {
    const actual = actualMcp.filter((entry) => entry.name === name && entry.enabled);
    if (actual.some((entry) => entry.transport?.command !== expectedServer.command
      || JSON.stringify(entry.transport?.args) !== JSON.stringify(expectedServer.args))) {
      throw new Error(`MCP ${name} still has a startup configuration pointing to another source.`);
    }
  }
  return cache;
}

async function recoverPrevious({ invoke, previous, previousMarketplace, newMarketplaceAdded, newInstallAttempted, writeLine }) {
  const recovery = [];
  const attempt = (label, action) => {
    try { action(); recovery.push(`${label}: completed`); return true; }
    catch (error) { recovery.push(`${label}: failed (${error.message})`); return false; }
  };
  if (newInstallAttempted) attempt('Remove the unverified new plugin', () => invoke(['plugin', 'remove', `${PLUGIN_NAME}@${MARKETPLACE_NAME}`, '--json'], 'Remove the unverified new plugin'));
  if (newMarketplaceAdded) attempt('Remove the new marketplace registration', () => invoke(['plugin', 'marketplace', 'remove', MARKETPLACE_NAME, '--json'], 'Remove the new marketplace registration'));
  if (previousMarketplace) attempt('Restore the previous marketplace source', () => invoke(['plugin', 'marketplace', 'add', previousMarketplace, '--json'], 'Restore the previous marketplace source'));
  for (const old of previous) {
    if (!old.enabled) {
      recovery.push(`${old.pluginId} was previously disabled. Restore it in Codex plugin settings and keep it disabled; the CLI cannot automatically restore disabled state`);
      continue;
    }
    const present = (() => {
      try { return validatePluginList(invoke(['plugin', 'list', '--json'], 'Check previous plugin recovery status')).some((entry) => samePlugin(entry, old) && entry.enabled); }
      catch { return false; }
    })();
    if (!present) attempt(`Reinstall ${old.pluginId}`, () => invoke(['plugin', 'add', old.pluginId, '--json'], `Restore ${old.pluginId}`));
    try {
      const restored = validatePluginList(invoke(['plugin', 'list', '--json'], 'Verify previous plugin recovery'));
      recovery.push(restored.some((entry) => samePlugin(entry, old) && entry.enabled)
        ? `${old.pluginId} has been restored to its previous version and source` : `${old.pluginId} has not been verified as restored. Reinstall from its original source in Codex plugin settings`);
    } catch { recovery.push(`${old.pluginId} has not been verified as restored. Check its original source in Codex plugin settings`); }
  }
  for (const message of recovery) writeLine(`Recovery: ${message}`);
  writeLine('Previous source and installation directories were preserved. A complete rollback is not guaranteed. Check plugin status and restart Codex after recovery.');
  return recovery;
}

export async function installBundle({
  bundleRoot = SCRIPT_DIRECTORY, argv = [], env = process.env,
  platform = process.platform, arch = process.arch, cli,
  updateFreeform = installFreeform, updateLux3d = installLux3d,
  confirmUpgrade = defaultConfirmUpgrade, writeLine = (message) => console.log(message),
} = {}) {
  const options = parseArguments(argv);
  const root = path.resolve(bundleRoot);
  const bundle = await readJson(path.join(root, 'bundle.json'), 'bundle metadata');
  if (!['win32', 'darwin'].includes(bundle.platform) || !['x64', 'arm64'].includes(bundle.arch)
    || typeof bundle.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(bundle.version)
    || bundle.pluginName !== PLUGIN_NAME || bundle.marketplaceName !== MARKETPLACE_NAME) throw new Error('The bundle metadata does not match the Coohom plugin installation format.');
  if (bundle.platform !== platform || bundle.arch !== arch) throw new Error(`This bundle is for ${bundle.platform}/${bundle.arch}; the current system is ${platform}/${arch}. Use the bundle for your operating system and architecture.`);
  const sourceMarketplace = path.join(root, 'marketplace');
  const sourcePlugin = path.join(sourceMarketplace, 'plugins', PLUGIN_NAME);
  const catalog = await readJson(path.join(sourceMarketplace, '.agents/plugins/marketplace.json'), 'Marketplace catalog');
  const sourceManifest = await readJson(path.join(sourcePlugin, '.codex-plugin/plugin.json'), 'plugin manifest');
  if (catalog.name !== MARKETPLACE_NAME || !Array.isArray(catalog.plugins)
    || !catalog.plugins.some((entry) => entry.name === PLUGIN_NAME && entry.source?.source === 'local' && entry.source.path === `./plugins/${PLUGIN_NAME}`)
    || sourceManifest.name !== PLUGIN_NAME || sourceManifest.version !== bundle.version) throw new Error('The bundle marketplace, plugin identity or version does not match.');
  const nodeRelative = NODE_PATHS[platform];
  for (const relative of [nodeRelative, LAUNCH_PATH, LUX3D_LAUNCH_PATH,
    'runtime/node/npm/bin/npm-cli.js', 'runtime/mcp/update-lux3d.mjs', 'runtime/mcp/lux3d-policy.json',
    'runtime/mcp/update-freeform.mjs', 'runtime/mcp/freeform-policy.json', 'runtime/mcp/freeform-package-lock.json', 'skills/coohom-freeform/SKILL.md']) {
    if (!(await isFile(path.join(sourcePlugin, relative)))) throw new Error(`Required bundle file is missing: ${relative}`);
  }
  let installationBase = options.destination;
  if (!installationBase) {
    if (platform === 'win32' && !env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is missing. The user installation directory cannot be determined.');
    installationBase = platform === 'win32' ? path.join(env.LOCALAPPDATA, 'Coohom', 'CodexPlugin')
      : path.join(os.homedir(), 'Library/Application Support/Coohom/CodexPlugin');
  }
  installationBase = path.resolve(installationBase);
  const destination = path.join(installationBase, `${bundle.version}-${platform}-${arch}-${randomUUID()}`);
  const targetMarketplace = path.join(destination, 'marketplace');
  const targetPlugin = path.join(targetMarketplace, 'plugins', PLUGIN_NAME);
  if (isInside(root, installationBase) || isInside(installationBase, root)) throw new Error('The installation directory must not overlap the bundle source directory.');
  const codexHome = path.resolve(root, env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const codex = cli ?? await discoverCodex({ env, platform });
  const invoke = (args, label) => runCodexJson(codex, args, { env, cwd: root, label });
  const inspect = () => ({
    mcp: invoke(['mcp', 'list', '--json'], 'Read MCP list'),
    plugins: invoke(['plugin', 'list', '--json'], 'Read plugin list'),
    marketplaces: validateMarketplaces(invoke(['plugin', 'marketplace', 'list', '--json'], 'Read marketplace list')),
  });
  const initial = inspect();
  const initialPrevious = previousPlugins(initial);
  if (options.check) {
    printPlan(initialPrevious, bundle.version, targetPlugin, writeLine);
    await validateUpgradeState(initial, destination);
    writeLine(`Check passed: ${platform}/${arch}. No upgrade was approved, no dependencies were downloaded, and no installation files or Codex configuration were changed.`);
    return { checked: true, destination, installationBase, targetPlugin, previousPlugins: initialPrevious };
  }
  await validateUpgradeState(initial, destination);
  await fs.mkdir(codexHome, { recursive: true });
  const lockPath = path.join(codexHome, 'coohom-freeform-install.lock');
  let lock;
  try { lock = await fs.open(lockPath, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`A Coohom installation is already running for this Codex profile, or an earlier installation was interrupted. Check installation processes and the lock file before trying again: ${lockPath}`);
    throw error;
  }
  let stage = 'Prepare the new runtime';
  let previous = [];
  let previousMarketplace;
  let registryMutation = false;
  let destinationCreated = false;
  let newMarketplaceAdded = false;
  let newInstallAttempted = false;
  try {
    const current = inspect();
    ({ previous, previousMarketplace } = await validateUpgradeState(current, destination));
    const confirmedState = upgradeFingerprint(current);
    printPlan(previous, bundle.version, targetPlugin, writeLine);
    await fs.mkdir(installationBase, { recursive: true });
    await fs.mkdir(destination);
    destinationCreated = true;
    await fs.writeFile(path.join(destination, '.coohom-installation.json'), JSON.stringify({
      format: 1, pluginName: PLUGIN_NAME, version: bundle.version, createdAt: new Date().toISOString(), sourceBundle: root,
    }, null, 2) + '\n');
    const managed = ['freeform', 'lux3d'].flatMap((name) => [
      path.join(sourcePlugin, `runtime/mcp/${name}`), path.join(sourcePlugin, `runtime/mcp/${name}-install.json`),
    ]);
    await fs.cp(sourceMarketplace, targetMarketplace, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true,
      filter: (source) => !managed.some((directory) => isInside(directory, source)),
    });
    const freeform = await updateFreeform({ pluginRoot: targetPlugin, env, writeLine });
    const lux3d = await updateLux3d({ pluginRoot: targetPlugin, env, writeLine });
    const mcpConfig = { mcpServers: {
      'freeform-modeling-mcp': { command: path.join(targetPlugin, nodeRelative), args: [path.join(targetPlugin, LAUNCH_PATH), 'start', '--stdio'] },
      [LUX3D_SERVER_NAME]: { command: path.join(targetPlugin, nodeRelative), args: [path.join(targetPlugin, LUX3D_LAUNCH_PATH)], startup_timeout_sec: 120 },
    } };
    await fs.writeFile(path.join(targetPlugin, '.mcp.json'), JSON.stringify(mcpConfig, null, 2) + '\n');
    await fs.writeFile(path.join(targetPlugin, '.codex-plugin/plugin.json'), JSON.stringify({ ...sourceManifest, mcpServers: './.mcp.json' }, null, 2) + '\n');
    stage = 'Wait for confirmation to remove previous plugins';
    if (previous.length && !options.yes) {
      const accepted = await confirmUpgrade({ previousPlugins: previous, targetVersion: bundle.version, targetPlugin,
        removePluginIds: previous.map(pluginId), message: 'The new runtime is ready. Have you saved your scenes and stopped modeling? Remove the listed plugins and install the new version?' });
      if (accepted !== true) throw new Error('Upgrade canceled. Previous plugins and sources were not changed.');
    }
    if (previous.length && options.yes) writeLine('--yes explicitly approves removal of the listed plugins. Standalone/shared MCP services are outside this operation.');
    stage = 'Recheck the upgrade plan';
    const beforeRemoval = inspect();
    await validateUpgradeState(beforeRemoval, destination);
    if (upgradeFingerprint(beforeRemoval) !== confirmedState) {
      throw new Error('Existing plugins or marketplace sources changed during preparation or confirmation. Operation stopped. Run the installer again and confirm the updated upgrade plan.');
    }
    stage = 'Remove previous plugins';
    for (const old of previous) {
      registryMutation = true;
      invoke(['plugin', 'remove', pluginId(old), '--json'], `Remove ${old.pluginId}`);
      const afterRemove = validatePluginList(invoke(['plugin', 'list', '--json'], 'Verify previous plugin removal'));
      if (afterRemove.some((entry) => entry.name === PLUGIN_NAME && entry.marketplaceName === old.marketplaceName && entry.installed)) {
        throw new Error(`Removal of ${old.pluginId} has not been verified. Source replacement stopped.`);
      }
    }
    stage = 'Register the new marketplace';
    registryMutation = true;
    if (previousMarketplace) invoke(['plugin', 'marketplace', 'remove', MARKETPLACE_NAME, '--json'], 'Remove the previous marketplace registration');
    newMarketplaceAdded = true;
    invoke(['plugin', 'marketplace', 'add', targetMarketplace, '--json'], 'Register the new marketplace');
    stage = 'Install the new plugin';
    newInstallAttempted = true;
    const added = invoke(['plugin', 'add', `${PLUGIN_NAME}@${MARKETPLACE_NAME}`, '--json'], 'Install the new plugin');
    stage = 'Verify the new source, version and cache';
    const installedPath = await verifyInstallation({ invoke, added, targetPlugin, version: bundle.version, mcpConfig, codexHome, freeform, lux3d });
    writeLine(`Installation complete: ${PLUGIN_NAME} ${bundle.version}; Freeform MCP ${freeform.version}; Lux3D MCP ${lux3d.version}.`);
    writeLine(`Verified installed/enabled status, version, source and key cache files: ${installedPath}`);
    writeLine('Restart Codex and open a new task to use this version. The installer did not stop old MCP processes. Previous source code, installation sources and scenes were preserved.');
    return { checked: false, destination, installationBase, targetPlugin, installedPath,
      freeformVersion: freeform.version, lux3dVersion: lux3d.version, previousPlugins: previous };
  } catch (error) {
    writeLine(`Failed stage: ${stage}. ${error.message}`);
    if (registryMutation) await recoverPrevious({ invoke, previous, previousMarketplace, newMarketplaceAdded, newInstallAttempted, writeLine });
    else writeLine('Previous plugins and sources were not changed.');
    if (destinationCreated) writeLine(`The prepared directory was retained for inspection: ${destination}`);
    throw new Error(`${stage} failed. Follow the error details and recovery instructions above.`, { cause: error });
  } finally {
    await lock.close();
    await fs.rm(lockPath, { force: true });
  }
}

export async function main(options = {}) {
  const writeLine = options.writeLine ?? ((message) => console.log(message));
  try {
    await installBundle({ argv: process.argv.slice(2), ...options, writeLine });
    return 0;
  } catch (error) {
    writeLine(`Installation incomplete: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
