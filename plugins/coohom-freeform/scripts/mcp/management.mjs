import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicJson, optionalJson, acquireManagementLock, recoverInterruptedLock, pendingOperation, runtimeFingerprint, within, ownedPath } from './runtime-state.mjs';
import { manageMcp } from './manage-mcp.mjs';
import { validateRecord } from './runtime-contract.mjs';
import { createHost, prepareNode } from './management-host.mjs';
import { doctorPair } from './management-doctor.mjs';
import { stateDirectory, rememberResource, rememberPair, adoptLegacyResources, requireIdle, cleanupResources, inspectProcesses } from './management-resources.mjs';

const execute = promisify(execFile);
const services = ['freeform', 'lux3d'];
export function parseManagementArguments(argv) {
  const [action = 'status', ...rest] = argv;
  if (!['status', 'doctor', 'upgrade', 'retry', 'resume-current', 'cleanup', 'uninstall'].includes(action)) throw new Error('Expected status, doctor, upgrade, retry, resume-current, cleanup or uninstall.');
  const result = { action, scope: 'all', json: false, apply: false, purgeCache: false };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--json') result.json = true;
    else if (rest[i] === '--apply' && action === 'cleanup') result.apply = true;
    else if (rest[i] === '--purge-cache' && ['cleanup', 'uninstall'].includes(action)) result.purgeCache = true;
    else if (rest[i] === '--scope' && action === 'upgrade' && ['all', 'plugin', 'mcp'].includes(rest[i + 1])) result.scope = rest[++i];
    else if (rest[i] === '--source' && action === 'upgrade' && rest[i + 1] && !rest[i + 1].startsWith('--')) result.source = path.resolve(rest[++i]);
    else if (rest[i] === '--versions' && action === 'retry' && rest[i + 1] && rest[i + 2]) {
      result.versions = { freeform: rest[++i], lux3d: rest[++i] };
    }
    else throw new Error(`Unsupported management argument: ${rest[i]}`);
  }
  return result;
}

async function manifestOf(root) {
  const manifest = await optionalJson(path.join(root, '.codex-plugin/plugin.json'));
  if (manifest?.name !== 'coohom-freeform' || typeof manifest.version !== 'string') throw new Error('Invalid Coohom plugin manifest.');
  return manifest;
}
function nodeRootOf(executable) { return process.platform === 'win32' ? path.dirname(executable) : path.dirname(path.dirname(executable)); }

export async function readManagementStatus({ sourceRoot, cacheRoot, nodeExecutable = process.execPath, npmCliPath }) {
  const directory = stateDirectory(cacheRoot);
  const manifest = await manifestOf(sourceRoot);
  let current = await optionalJson(path.join(directory, 'current.json'));
  const operation = await optionalJson(path.join(directory, 'operation.json'));
  const check = await optionalJson(path.join(directory, 'check.json'));
  const legacy = await optionalJson(path.join(directory, 'mcp-install-state.json'));
  const uninstalled = await optionalJson(path.join(directory, 'uninstalled.json'));
  const legacyCandidates = [];
  if (!current && !uninstalled) {
    // Read-only compatibility: never pick between multiple historical pairs.
    let entries = [];
    try { entries = await fs.readdir(path.join(cacheRoot, 'plugins'), { withFileTypes: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const entry of entries.filter(item => item.isDirectory() && /^[a-f0-9]{24}$/.test(item.name))) {
      const pluginRoot = path.join(cacheRoot, 'plugins', entry.name, 'pair');
      const pair = await optionalJson(path.join(pluginRoot, 'runtime/mcp/mcp-pair.json'));
      if (!pair || pair.format !== 1) continue;
      for (const service of services) validateRecord(service, pair[service]);
      legacyCandidates.push({ pluginRoot, pair });
    }
    const matching = legacyCandidates.filter(item => item.pair.id === legacy?.pairId);
    const resolved = matching.length === 1 ? matching[0] : legacyCandidates.length === 1 ? legacyCandidates[0] : undefined;
    if (resolved) current = { ...resolved, pluginVersion: manifest.version, sourceRoot, nodeExecutable,
      nodeRoot: nodeRootOf(nodeExecutable), npmCliPath: npmCliPath ?? resolved.pair.freeform.npmCliPath, legacy: true };
  }
  const installed = current ? Object.fromEntries(services.map(service => [service, current.pair?.[service]?.version])) : undefined;
  const matchingCheck = check?.pairId === current?.pair?.id && check?.pluginVersion === current?.pluginVersion ? check : undefined;
  return { pluginVersion: manifest.version, current, operation, legacyInstallation: legacy,
    dependencies: installed, validation: matchingCheck?.status === 'passed' ? 'initialized' : current ? 'installed' : 'missing',
    check: matchingCheck, currentTaskConnected: false, legacyCandidates: legacyCandidates.map(item => item.pluginRoot) };
}

async function stageRuntime({ candidate, directory, cacheRoot, previous, scope, node, env, installers, onStage, versions }) {
  const pluginRoot = path.join(cacheRoot, 'plugins', `managed-${path.basename(directory)}`);
  await fs.mkdir(path.join(pluginRoot, 'runtime/mcp'), { recursive: true });
  await rememberResource(cacheRoot, pluginRoot, 'pair');
  const runtime = path.join(pluginRoot, 'runtime/mcp');
  await fs.cp(path.join(candidate.sourceRoot, 'scripts/mcp'), runtime, { recursive: true, dereference: false });
  let pair;
  if (scope === 'plugin') {
    if (!previous?.pair) throw new Error('Plugin-only upgrade requires an existing MCP installation.');
    pair = structuredClone(previous.pair);
    for (const service of services) {
      validateRecord(service, pair[service]);
      const from = path.resolve(previous.pluginRoot, 'runtime/mcp', pair[service].directory);
      await ownedPath(cacheRoot, from);
      await fs.cp(from, path.resolve(runtime, pair[service].directory), { recursive: true });
      pair[service].npmCliPath = node.npmCliPath;
    }
    pair.id = randomUUID();
    await atomicJson(path.join(runtime, 'mcp-pair.json'), pair);
  } else {
    pair = await manageMcp({ pluginRoot, nodeExecutable: node.nodeExecutable, npmCliPath: node.npmCliPath,
      env, installers, onStage, installVersions: versions, writeLine: () => {} });
  }
  await rememberPair(cacheRoot, pluginRoot, pair);
  const { stdout } = await execute(node.nodeExecutable, ['--version'], { env, windowsHide: true, timeout: 10000 });
  return { pluginRoot, pair, pluginVersion: (await manifestOf(candidate.sourceRoot)).version,
    sourceRoot: candidate.sourceRoot, nodeExecutable: node.nodeExecutable, nodeRoot: nodeRootOf(node.nodeExecutable), npmCliPath: node.npmCliPath,
    fingerprint: await runtimeFingerprint(candidate.sourceRoot, stdout.trim()) };
}

export async function runManagement({ sourceRoot, cacheRoot, nodeExecutable = process.execPath, npmCliPath,
  options = { action: 'status', scope: 'all' }, env = process.env, host, inspect = inspectProcesses,
  prepareRuntimeNode = prepareNode, checkPair = doctorPair, installers, writeLine = () => {}, lockTimeoutMs } = {}) {
  cacheRoot = path.resolve(cacheRoot); sourceRoot = path.resolve(sourceRoot);
  const read = () => readManagementStatus({ sourceRoot, cacheRoot, nodeExecutable, npmCliPath });
  if (options.action === 'status') return read();
  if (options.action === 'cleanup' && !options.apply) return cleanupResources(cacheRoot, { all: options.purgeCache, inspect });
  const directory = stateDirectory(cacheRoot);
  if (['retry', 'resume-current'].includes(options.action)) {
    await requireIdle(cacheRoot, [sourceRoot], inspect);
    await recoverInterruptedLock(directory);
  }
  const unlock = await acquireManagementLock(directory, lockTimeoutMs);
  const operationFile = path.join(directory, 'operation.json');
  const currentFile = path.join(directory, 'current.json');
  const checkFile = path.join(directory, 'check.json');
  try {
    let status = await read();
    await adoptLegacyResources(cacheRoot);
    if (status.current?.legacy) {
      await rememberPair(cacheRoot, status.current.pluginRoot, status.current.pair);
      await atomicJson(currentFile, status.current);
    }
    if (options.action === 'cleanup') return cleanupResources(cacheRoot, { apply: true, all: options.purgeCache, inspect });
    await requireIdle(cacheRoot, [sourceRoot], inspect);
    if (options.action === 'doctor') {
      try {
        const check = await checkPair(status.current, { env });
        await atomicJson(checkFile, check);
        return { ...check, message: 'Startup check passed. Current Codex task and browser connection have not been verified.' };
      } catch (error) {
        await atomicJson(checkFile, { status: 'failed', pairId: status.current?.pair?.id, pluginVersion: status.current?.pluginVersion,
          checkedAt: new Date().toISOString(), reason: error.message });
        throw error;
      }
    }
    if (options.action === 'retry' && !pendingOperation(status.operation) && status.legacyInstallation && status.legacyInstallation.status !== 'ready') {
      const fingerprint = await runtimeFingerprint(sourceRoot);
      const pluginRoot = status.current?.pluginRoot ?? path.join(cacheRoot, 'plugins', fingerprint, 'pair');
      await ownedPath(cacheRoot, pluginRoot);
      const pair = await manageMcp({ pluginRoot, stateRoot: directory, nodeExecutable, npmCliPath, env, installers,
        action: options.versions ? 'versions' : 'retry', versions: options.versions, lockHeld: true, writeLine });
      const current = { pluginRoot, pair, sourceRoot, pluginVersion: (await manifestOf(sourceRoot)).version,
        nodeExecutable, nodeRoot: nodeRootOf(nodeExecutable), npmCliPath, fingerprint };
      await rememberPair(cacheRoot, pluginRoot, pair); await atomicJson(currentFile, current);
      return { status: 'installed', current, currentTaskConnected: false, restartRequired: true };
    }
    if (options.action === 'retry' && env.COOHOM_NODE_PREPARED === '1' && !status.operation && !status.legacyInstallation) {
      return { status: 'node-prepared', message: 'Node preparation succeeded. Restart Codex and open a new task to continue first-time dependency installation.', restartRequired: true };
    }
    host ??= await createHost({ env });
    await host.preflight();
    if (options.action === 'uninstall') {
      const previous = await host.inspect();
      if (options.purgeCache !== true) {
        // The normal uninstall keeps dependencies. A separate explicit flag is required to remove them.
        await host.uninstall(previous);
        await fs.rm(currentFile, { force: true });
        await atomicJson(path.join(directory, 'uninstalled.json'), { at: new Date().toISOString(), pluginId: previous.plugin.pluginId });
        if (status.operation) await atomicJson(operationFile, { ...status.operation, status: 'uninstalled' });
        return { status: 'uninstalled', cacheRetained: true, next: 'Preview external cache removal with cleanup --purge-cache, then cleanup --purge-cache --apply.' };
      }
      // Require a separate preview/apply step for cache deletion, even during uninstall.
      return { status: 'confirmation-required', message: 'Run uninstall without --purge-cache first; then preview and explicitly apply cleanup --purge-cache.' };
    }
    if (options.action === 'resume-current') {
      const operation = status.operation;
      if (!pendingOperation(operation) || !operation.previous?.pair || !operation.previousHost || operation.recoveryAvailable === false || operation.previous.pluginVersion !== operation.previousHost.plugin.version) throw new Error('No verifiable previous installation is available to resume.');
      const restored = await host.restore(operation.previousHost, path.join(operation.directory, 'previous-plugin'));
      const current = { ...operation.previous, sourceRoot: restored.sourceRoot };
      const { stdout } = await execute(current.nodeExecutable, ['--version'], { windowsHide: true, timeout: 10000 });
      current.fingerprint = await runtimeFingerprint(current.sourceRoot, stdout.trim());
      const check = await checkPair(current, { env });
      await atomicJson(currentFile, current); await atomicJson(checkFile, check);
      await atomicJson(operationFile, { ...operation, status: 'resumed', stage: 'complete', completedAt: new Date().toISOString() });
      await atomicJson(path.join(directory, 'mcp-install-state.json'), { status: 'ready', pairId: current.pair.id, validation: 'installed' });
      return { status: 'resumed', current, check, restartRequired: true };
    }
    if (options.action === 'upgrade' && pendingOperation(status.operation)) throw new Error('The previous operation needs a choice: retry, resume-current, or stop.');
    if (options.action === 'upgrade' && status.legacyInstallation && status.legacyInstallation.status !== 'ready') throw new Error('Resolve the failed legacy MCP installation with its explicit retry/version workflow before upgrading.');
    if (options.action === 'retry' && !pendingOperation(status.operation)) throw new Error('There is no failed or interrupted upgrade to retry.');
    const retry = options.action === 'retry';
    const request = retry ? { ...status.operation.request } : { scope: options.scope ?? 'all', source: options.source };
    if (options.versions) {
      if (!retry || status.operation.attempts < 2 || !['freeform', 'lux3d'].includes(status.operation.stage)) throw new Error('Other exact MCP versions are offered only after the dependency installation retry also failed.');
      request.versions = options.versions;
    }
    const previousHost = retry ? status.operation.previousHost : await host.inspect();
    const previous = retry ? status.operation.previous : status.current;
    writeLine(`Upgrade scope: ${request.scope}; plugin ${previousHost.plugin.version}; Freeform ${previous?.pair?.freeform?.version ?? 'not installed'}; Lux3D ${previous?.pair?.lux3d?.version ?? 'not installed'}. Successful activation automatically removes unused managed versions.`);
    const recoveryAvailable = retry ? status.operation.recoveryAvailable : Boolean(previous?.pair && previous.pluginVersion === previousHost.plugin.version &&
      (!previous.fingerprint || previous.fingerprint === await runtimeFingerprint(previousHost.sourceRoot)));
    const transaction = path.join(cacheRoot, 'operations', randomUUID());
    await fs.mkdir(transaction, { recursive: true });
    await rememberResource(cacheRoot, transaction, 'transaction');
    let operation = { id: path.basename(transaction), directory: transaction, status: 'running', stage: 'preflight',
      request, previousHost, previous, recoveryAvailable, completedActions: [], attempts: retry ? status.operation.attempts + 1 : 1, startedAt: new Date().toISOString() };
    const stage = async value => {
      if (value !== operation.stage) operation.completedActions.push(operation.stage);
      operation.stage = value; operation.elapsedMs = Date.now() - Date.parse(operation.startedAt);
      await atomicJson(operationFile, operation); writeLine(`Stage: ${value} (${Math.round(operation.elapsedMs / 1000)}s)`);
    };
    await stage('preflight');
    try {
      // Keep a source snapshot until all activation checks pass. No files are copied into Codex's cache.
      await fs.cp(retry && status.operation.snapshotComplete ? path.join(status.operation.directory, 'previous-plugin') : previousHost.sourceRoot,
        path.join(transaction, 'previous-plugin'), { recursive: true });
      if ((await manifestOf(path.join(transaction, 'previous-plugin'))).version !== previousHost.plugin.version) throw new Error('The exact original plugin snapshot is unavailable. Inspect the installed source before recovery.');
      operation.snapshotComplete = true;
      await stage('candidate');
      const candidate = request.scope === 'mcp'
        ? { sourceRoot: previousHost.sourceRoot, marketRoot: previousHost.market.root, local: false }
        : await host.candidate(previousHost, request.source, transaction);
      operation.candidate = candidate;
      await stage('node');
      const node = await prepareRuntimeNode(candidate.sourceRoot, { ...env, COOHOM_FREEFORM_CACHE: cacheRoot, COOHOM_EXPLICIT_NODE_RETRY: retry ? '1' : '0' });
      if (within(cacheRoot, nodeRootOf(node.nodeExecutable))) await rememberResource(cacheRoot, nodeRootOf(node.nodeExecutable), 'node');
      const next = await stageRuntime({ candidate, directory: transaction, cacheRoot, previous, scope: request.scope, node, env, installers, onStage: stage, versions: request.versions });
      operation.candidateRuntime = next;
      await stage('checking');
      const check = await checkPair(next, { env });
      await stage('activation');
      if (request.scope !== 'mcp') {
        const activated = await host.activate(previousHost, candidate, next.pluginVersion);
        if (activated?.sourceRoot) next.sourceRoot = activated.sourceRoot;
      }
      else await host.verify({ version: next.pluginVersion, pluginId: previousHost.plugin.pluginId, sourceRoot: candidate.sourceRoot });
      await atomicJson(currentFile, next);
      await fs.rm(path.join(directory, 'uninstalled.json'), { force: true });
      await atomicJson(checkFile, check);
      await atomicJson(path.join(directory, 'mcp-install-state.json'), { status: 'ready', pairId: next.pair.id, validation: 'installed' });
      operation = { ...operation, status: 'succeeded', completedAt: new Date().toISOString() };
      await stage('cleanup');
      let cleanup;
      try { cleanup = await cleanupResources(cacheRoot, { apply: true, inspect }); }
      catch { cleanup = { complete: false, message: 'Upgrade succeeded; cleanup could not complete. Run cleanup to inspect remaining files.' }; }
      operation.cleanup = cleanup; await stage('complete');
      return { status: 'succeeded', previousVersions: previous && { plugin: previous.pluginVersion, ...Object.fromEntries(services.map(s => [s, previous.pair[s].version])) }, current: next, check, cleanup, restartRequired: true };
    } catch (error) {
      if (operation.status === 'succeeded') {
        return { status: 'succeeded', current: await optionalJson(currentFile), restartRequired: true,
          cleanup: { complete: false, message: 'Upgrade succeeded; cleanup or its report could not complete. Run cleanup to inspect remaining files.' } };
      }
      operation.status = 'failed'; operation.reason = error.message; operation.failedAt = new Date().toISOString();
      try { operation.actualHost = await host.inspect(); } catch { operation.actualHost = { available: false, reason: 'Official installation state could not be verified; explicit recovery is required.' }; }
      operation.choices = ['retry', ...(recoveryAvailable ? ['resume-current'] : []), 'stop'];
      await atomicJson(operationFile, operation);
      throw new Error(`Upgrade failed at ${operation.stage}: ${error.message} Choose retry, ${recoveryAvailable ? 'resume-current, ' : ''}or stop. No automatic recovery or cleanup was performed.`, { cause: error });
    }
  } finally { await unlock(); }
}

export function formatManagementResult(result) {
  if (result.validation && Object.hasOwn(result, 'legacyInstallation')) {
    return [`Plugin: ${result.pluginVersion ?? 'unknown'}`, `Dependencies: ${result.dependencies ? JSON.stringify(result.dependencies) : 'not installed'}`,
      `Validation: ${result.validation}`, `Current task connected: not verified`,
      result.operation ? `Last operation: ${result.operation.status} / ${result.operation.stage}${result.operation.reason ? ` / ${result.operation.reason}` : ''}` : '',
      result.check ? `Last startup check: ${result.check.status} at ${result.check.checkedAt}` : 'Startup check: not performed',
      result.legacyInstallation?.status === 'failed' ? 'Legacy installation failed; an explicit retry or version decision is required.' : ''].filter(Boolean).join('\n');
  }
  if (result.status === 'passed') return `Startup check passed at ${result.checkedAt}.\nMCP versions: ${JSON.stringify(result.versions)}\nCurrent task, browser and scene connection: not verified.`;
  if (['succeeded', 'resumed', 'installed'].includes(result.status)) {
    const current = result.current;
    return [`Operation: ${result.status}`, result.previousVersions ? `Before: ${JSON.stringify(result.previousVersions)}` : '',
      `Current: plugin ${current.pluginVersion}; Freeform ${current.pair.freeform.version}; Lux3D ${current.pair.lux3d.version}`,
      result.check ? `Startup check: ${result.check.status} at ${result.check.checkedAt}` : 'Dependencies installed; startup check not performed.',
      result.cleanup ? `Cleanup: ${result.cleanup.complete ? 'complete' : 'incomplete; run cleanup to inspect deferred resources'}; deleted ${result.cleanup.deleted?.length ?? 0} paths` : '',
      'Restart Codex and open a new task to verify actual tool discovery.'].filter(Boolean).join('\n');
  }
  if (result.status === 'uninstalled') return `Plugin uninstalled through Codex. External cache retained.\n${result.next}`;
  if (Array.isArray(result.candidates)) return [`Cleanup ${result.deleted.length ? 'result' : 'preview'}: ${result.bytes} bytes`,
    ...result.candidates.map(item => `Candidate: ${item.path} (${item.bytes} bytes)`),
    ...result.deleted.map(item => `Deleted: ${item}`),
    ...result.retained.map(item => `Retained: ${item.path} (${item.reason})`)].join('\n');
  return JSON.stringify(result, null, 2);
}
