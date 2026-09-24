import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { discoverCodex } from './codex-cli.mjs';
import { optionalJson, within } from './runtime-state.mjs';

const execute = promisify(execFile);
const pluginName = 'coohom-freeform';
const samePath = (left, right) => typeof left === 'string' && typeof right === 'string' &&
  (process.platform === 'win32' ? path.toNamespacedPath(left).toLowerCase() === path.toNamespacedPath(right).toLowerCase() : path.resolve(left) === path.resolve(right));

// config/read and these marketplace keys are public Codex interfaces. Never log
// the complete effective configuration, which can contain credentials.
export async function readMarketplaceConfig(executable, env, name) {
  const child = spawn(executable.command, [...(executable.prefixArgs ?? []), 'app-server'], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  const closed = new Promise(resolve => child.once('close', resolve));
  try {
    return await new Promise((resolve, reject) => {
      const fail = () => reject(new Error('Codex effective marketplace configuration could not be read.'));
      const timer = setTimeout(fail, 15000);
      closed.then(() => { clearTimeout(timer); fail(); });
      child.once('error', fail); child.stdin.on('error', fail);
      lines.on('line', line => {
        let response;
        try { response = JSON.parse(line); } catch { return; }
        if (response.error) { clearTimeout(timer); fail(); return; }
        if (response.id === 1) {
          child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
          child.stdin.write(JSON.stringify({ id: 2, method: 'config/read', params: { cwd: process.cwd(), includeLayers: false } }) + '\n');
        } else if (response.id === 2) {
          clearTimeout(timer);
          const entry = response.result?.config?.marketplaces?.[name];
          if (!entry || !['git', 'local'].includes(entry.source_type) || typeof entry.source !== 'string') return fail();
          resolve({ source: entry.source, source_type: entry.source_type, ref: entry.ref, sparse_paths: entry.sparse_paths });
        }
      });
      child.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'coohom-manager', version: '1.0.0' } } }) + '\n');
    });
  } finally {
    lines.close(); child.stdin.end(); child.kill(); await closed;
  }
}

export async function createHost({ env = process.env, cli } = {}) {
  const executable = cli ?? await discoverCodex({ env });
  const invoke = async (args, json = true) => {
    try {
      const { stdout } = await execute(executable.command, [...(executable.prefixArgs ?? []), ...args, ...(json ? ['--json'] : [])],
        { env, windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
      return json ? JSON.parse(stdout) : stdout;
    } catch (error) { throw new Error(`Codex ${args.slice(0, 3).join(' ')} failed (exit ${error.code ?? 'unknown'}). Inspect Codex diagnostics; no raw configuration was logged.`, { cause: error }); }
  };
  async function inspect() {
    const [plugins, markets] = await Promise.all([invoke(['plugin', 'list']), invoke(['plugin', 'marketplace', 'list'])]);
    if (!Array.isArray(plugins.installed) || !Array.isArray(markets.marketplaces)) throw new Error('Unsupported Codex plugin list format. Update Codex before proceeding.');
    const own = plugins.installed.filter(item => item.name === pluginName && item.installed);
    if (own.length !== 1) throw new Error('Exactly one installed Coohom plugin is required. Resolve duplicate or missing installations in Codex.');
    const plugin = own[0];
    if (!/^[A-Za-z0-9_-]+$/.test(plugin.marketplaceName) || plugin.pluginId !== `${pluginName}@${plugin.marketplaceName}` || !plugin.enabled || !path.isAbsolute(plugin.source?.path ?? '')) throw new Error('The installed Coohom source or enabled state could not be verified.');
    const market = markets.marketplaces.find(item => item.name === plugin.marketplaceName);
    if (!market || !path.isAbsolute(market.root ?? '')) throw new Error('The configured marketplace root could not be verified.');
    const catalog = await optionalJson(path.join(market.root, '.agents/plugins/marketplace.json'));
    const entry = catalog?.plugins?.find(item => item.name === pluginName);
    if (catalog?.name !== market.name || entry?.source?.source !== 'local' || !entry.source.path?.startsWith('./')) throw new Error('This manager requires a local plugin entry in the configured marketplace.');
    const sourceRoot = path.resolve(market.root, entry.source.path);
    if (!within(market.root, sourceRoot) || !samePath(sourceRoot, plugin.source.path)) throw new Error('Installed source does not match its marketplace entry.');
    const configured = await readMarketplaceConfig(executable, env, market.name);
    let git;
    if (configured.source_type === 'git') {
      const runGit = async args => (await execute('git', ['-C', market.root, ...args], { env, windowsHide: true, timeout: 15000 })).stdout.trim();
      if (samePath(await runGit(['rev-parse', '--show-toplevel']), market.root)) {
        const url = configured.source;
        const revision = await runGit(['rev-parse', 'HEAD']);
        // Remote URLs with embedded HTTP credentials must never enter state or logs.
        if (/^https?:\/\//.test(url) && (new URL(url).username || new URL(url).password || new URL(url).search)) throw new Error('Credential-bearing Git source is unsupported.');
        if (/^[a-f0-9]{40,64}$/.test(revision)) git = { url, revision, ref: configured.ref, sparsePaths: configured.sparse_paths };
      }
      if (!git) throw new Error('Configured Git marketplace revision could not be verified.');
    } else if (!samePath(configured.source, market.root)) throw new Error('Configured local marketplace does not match its resolved root.');
    return { plugin: { name: plugin.name, pluginId: plugin.pluginId, version: plugin.version, marketplaceName: plugin.marketplaceName },
      market: { name: market.name, root: market.root }, sourceRoot, git };
  }
  async function verify(expected) {
    const result = await inspect();
    if (result.plugin.version !== expected.version || result.plugin.pluginId !== expected.pluginId || !samePath(result.sourceRoot, expected.sourceRoot)) throw new Error('Codex installation did not match the requested source and version.');
    const manifest = await optionalJson(path.join(result.sourceRoot, '.codex-plugin/plugin.json'));
    if (manifest?.name !== pluginName || manifest.version !== expected.version) throw new Error('The plugin source manifest does not match the installed version.');
    return result;
  }
  async function verifyCache(added, sourceRoot, version) {
    if (added?.name !== pluginName || added.version !== version || !path.isAbsolute(added.installedPath ?? '')) throw new Error('Codex did not return a verifiable installed cache.');
    const contents = await fs.readdir(sourceRoot, { recursive: true, withFileTypes: true });
    if (contents.some(item => item.isSymbolicLink())) throw new Error('Plugin source contains redirected files and cannot be verified.');
    const files = contents.filter(item => item.isFile()).map(item => path.relative(sourceRoot, path.join(item.parentPath ?? item.path, item.name)));
    for (const relative of files) {
      const [source, cached] = await Promise.all([fs.readFile(path.join(sourceRoot, relative)), fs.readFile(path.join(added.installedPath, relative))]);
      if (!source.equals(cached)) throw new Error('The installed plugin cache differs from its source.');
    }
  }
  async function removePlugin(id) {
    const listed = await invoke(['plugin', 'list']);
    if (listed.installed?.some(item => item.pluginId === id && item.installed)) {
      await invoke(['plugin', 'remove', id]);
      const after = await invoke(['plugin', 'list']);
      if (!Array.isArray(after.installed) || after.installed.some(item => item.pluginId === id && item.installed)) throw new Error('The previous plugin was not removed.');
    }
  }
  async function replaceMarketplace(name, source, ref, sparsePaths = []) {
    const markets = await invoke(['plugin', 'marketplace', 'list']);
    const existing = markets.marketplaces?.find(item => item.name === name);
    if (existing) {
      const catalog = await optionalJson(path.join(existing.root, '.agents/plugins/marketplace.json'));
      if (catalog?.name !== name || !Array.isArray(catalog.plugins) || catalog.plugins.some(item => item.name !== pluginName)) throw new Error('A shared or unrecognized marketplace cannot be replaced.');
      await invoke(['plugin', 'marketplace', 'remove', name]);
    }
    await invoke(['plugin', 'marketplace', 'add', source, ...(ref ? ['--ref', ref] : []), ...(sparsePaths ?? []).flatMap(value => ['--sparse', value])]);
  }
  return {
    inspect, verify,
    async preflight() {
      await invoke(['plugin', 'add', '--help'], false);
      await invoke(['plugin', 'remove', '--help'], false);
      await invoke(['plugin', 'marketplace', 'upgrade', '--help'], false);
    },
    async candidate(previous, source, transaction) {
      if (source) {
        const root = path.resolve(source);
        const catalog = await optionalJson(path.join(root, '.agents/plugins/marketplace.json'));
        const entry = catalog?.plugins?.find(item => item.name === pluginName);
        if (catalog?.name !== previous.market.name || entry?.source?.source !== 'local' || !entry.source.path?.startsWith('./')) throw new Error('The supplied package must contain the same marketplace and plugin identity.');
        const sourceRoot = path.resolve(root, entry.source.path);
        if (!within(root, sourceRoot)) throw new Error('Candidate plugin escapes the supplied marketplace.');
        return { sourceRoot, marketRoot: root, local: true };
      }
      if (!previous.git) throw new Error('A local installation requires --source with the new extracted marketplace directory.');
      // Stage without refreshing the live marketplace: Codex refresh itself can
      // update installed plugins before their candidate MCPs have been checked.
      const root = path.join(transaction, 'candidate-marketplace');
      try {
        await execute('git', ['clone', '--no-checkout', '--', previous.git.url, root], { env, windowsHide: true, timeout: 180000 });
        if (previous.git.ref) await execute('git', ['-C', root, 'fetch', 'origin', previous.git.ref], { env, windowsHide: true, timeout: 180000 });
        await execute('git', ['-C', root, 'checkout', '--detach', previous.git.ref ? 'FETCH_HEAD' : 'origin/HEAD'], { env, windowsHide: true, timeout: 30000 });
        const revision = (await execute('git', ['-C', root, 'rev-parse', 'HEAD'], { env, windowsHide: true })).stdout.trim();
        const catalog = await optionalJson(path.join(root, '.agents/plugins/marketplace.json'));
        const entry = catalog?.plugins?.find(item => item.name === pluginName);
        if (catalog?.name !== previous.market.name || entry?.source?.source !== 'local' || !entry.source.path?.startsWith('./')) throw new Error();
        const sourceRoot = path.resolve(root, entry.source.path);
        if (!within(root, sourceRoot)) throw new Error();
        return { sourceRoot, marketRoot: root, revision, local: false };
      } catch { throw new Error('The configured Git candidate could not be staged. No live marketplace refresh was performed.'); }
    },
    async activate(previous, candidate, version) {
      if (!candidate.local && candidate.revision) {
        const refreshed = await invoke(['plugin', 'marketplace', 'upgrade', previous.market.name]);
        if (!Array.isArray(refreshed.errors) || refreshed.errors.length || !refreshed.selectedMarketplaces?.includes(previous.market.name) || !refreshed.upgradedRoots?.length) throw new Error('Official marketplace refresh did not complete.');
        const actual = await inspect();
        if (actual.git?.revision !== candidate.revision || actual.git?.url !== previous.git.url) throw new Error('The refreshed Git revision differs from the checked candidate. Choose retry or recovery.');
        await verifyCache({ name: pluginName, version, installedPath: actual.sourceRoot }, candidate.sourceRoot, version);
        candidate = { ...candidate, sourceRoot: actual.sourceRoot, marketRoot: actual.market.root };
      }
      if (candidate.local && !samePath(previous.market.root, candidate.marketRoot)) {
        const catalog = await optionalJson(path.join(previous.market.root, '.agents/plugins/marketplace.json'));
        if (catalog.plugins.some(item => item.name !== pluginName)) throw new Error('Cannot replace a marketplace shared with other plugins.');
        await removePlugin(previous.plugin.pluginId);
        await replaceMarketplace(previous.market.name, candidate.marketRoot);
      } else {
        await removePlugin(previous.plugin.pluginId);
      }
      const added = await invoke(['plugin', 'add', previous.plugin.pluginId]);
      await verifyCache(added, candidate.sourceRoot, version);
      return verify({ version, pluginId: previous.plugin.pluginId, sourceRoot: candidate.sourceRoot });
    },
    async restore(previous, snapshot) {
      let existing;
      try { existing = await inspect(); } catch { /* An interrupted install can leave no plugin. Restore only on explicit request. */ }
      const originalManifest = await optionalJson(path.join(previous.sourceRoot, '.codex-plugin/plugin.json'));
      if (existing?.plugin.version === previous.plugin.version && samePath(existing.sourceRoot, previous.sourceRoot) && originalManifest?.version === previous.plugin.version &&
        (!previous.git || existing.git?.revision === previous.git.revision)) {
        if (snapshot) await verifyCache({ name: pluginName, version: previous.plugin.version, installedPath: existing.sourceRoot }, snapshot, previous.plugin.version);
        return existing;
      }
      if (!previous.git && snapshot) await verifyCache({ name: pluginName, version: previous.plugin.version, installedPath: previous.sourceRoot }, snapshot, previous.plugin.version);
      // Restoration is only called by the explicit resume-current action.
      await removePlugin(previous.plugin.pluginId);
      if (previous.git) await replaceMarketplace(previous.market.name, previous.git.url, previous.git.revision, previous.git.sparsePaths);
      else {
        const manifest = await optionalJson(path.join(previous.sourceRoot, '.codex-plugin/plugin.json'));
        if (manifest?.version !== previous.plugin.version) throw new Error('The exact original plugin source is unavailable; restoring it is not offered.');
        await replaceMarketplace(previous.market.name, previous.market.root);
      }
      const added = await invoke(['plugin', 'add', previous.plugin.pluginId]);
      const restored = await inspect();
      if (previous.git && (restored.git?.url !== previous.git.url || restored.git?.revision !== previous.git.revision)) throw new Error('The original Git revision was not restored.');
      if (!previous.git && !samePath(restored.sourceRoot, previous.sourceRoot)) throw new Error('The original local source was not restored.');
      await verifyCache(added, restored.sourceRoot, previous.plugin.version);
      if (snapshot) await verifyCache(added, snapshot, previous.plugin.version);
      return verify({ version: previous.plugin.version, pluginId: previous.plugin.pluginId, sourceRoot: restored.sourceRoot });
    },
    async uninstall(previous) {
      await invoke(['plugin', 'remove', previous.plugin.pluginId]);
      const result = await invoke(['plugin', 'list']);
      if (!Array.isArray(result.installed) || result.installed.some(item => item.pluginId === previous.plugin.pluginId && item.installed)) throw new Error('Codex did not confirm plugin removal.');
    },
  };
}

export async function prepareNode(sourceRoot, env = process.env) {
  const windows = process.platform === 'win32';
  const command = windows ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe') : '/bin/sh';
  const script = path.join(sourceRoot, 'scripts', windows ? 'bootstrap.ps1' : 'bootstrap');
  const action = env.COOHOM_EXPLICIT_NODE_RETRY === '1' ? 'node-retry' : 'node-info';
  const args = windows ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, 'freeform', action] : [script, 'freeform', action];
  try {
    const { stdout } = await execute(command, args, { env, windowsHide: true, timeout: 240000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout);
    if (!path.isAbsolute(result.nodeExecutable ?? '') || !path.isAbsolute(result.npmCliPath ?? '')) throw new Error();
    return result;
  } catch { throw new Error('Node preparation failed. Check the runtime download and bootstrap diagnostics.'); }
}
