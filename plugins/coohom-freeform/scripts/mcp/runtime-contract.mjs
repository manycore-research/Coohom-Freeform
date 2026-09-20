import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
export const PACKAGES = { freeform: 'freeform-modeling-mcp', lux3d: '@manycore/coohom-lux3d-mcp' };
export function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export async function readOptionalJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
export function validateRecord(service, record) {
  if (!Object.hasOwn(PACKAGES, service) || !record || !VERSION.test(record.version)
    || ![`${PACKAGES[service]}@latest`, `${PACKAGES[service]}@${record.version}`].includes(record.packageSpec)
    || typeof record.directory !== 'string' || !new RegExp(`^${service}/install-[A-Za-z0-9]+$`).test(record.directory)) {
    throw new Error(`Invalid ${service} installation record.`);
  }
  return record;
}
export async function readInstallation(runtime, service) {
  const state = await readOptionalJson(path.join(runtime, 'mcp-install-state.json'));
  if (state && state.status !== 'ready') throw new Error('MCP installation is incomplete. Inspect mcp-install-state.json and explicitly retry; no previous combination was selected.');
  const pair = await readOptionalJson(path.join(runtime, 'mcp-pair.json'));
  if (pair && pair.format !== 1) throw new Error('Unsupported MCP pair record.');
  const record = validateRecord(service, pair ? pair[service] : await readOptionalJson(path.join(runtime, `${service}-install.json`)));
  if (!inside(await fs.realpath(runtime), await fs.realpath(path.resolve(runtime, record.directory)))) throw new Error('MCP installation is outside its runtime.');
  return record;
}
// Use npm's public bin. Do not infer startup from wrapper source or private files.
export async function readPublicCli(installationDirectory, name, expectedVersion, binName = name) {
  const directory = path.join(installationDirectory, 'node_modules', name);
  const manifestPath = path.join(directory, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.name !== name || !VERSION.test(manifest.version)
    || (expectedVersion !== undefined && manifest.version !== expectedVersion)) throw new Error(`Installed ${name} version does not match its record.`);
  const entries = typeof manifest.bin === 'object' && manifest.bin ? Object.values(manifest.bin) : [];
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName] ?? (entries.length === 1 ? entries[0] : undefined);
  if (typeof bin !== 'string' || !bin) throw new Error(`${name} does not declare an unambiguous public CLI.`);
  const binPath = path.resolve(directory, bin);
  if (!inside(directory, binPath) || !inside(await fs.realpath(directory), await fs.realpath(binPath)) || !(await fs.stat(binPath)).isFile()) throw new Error(`${name} CLI is outside its package or is not a file.`);
  return { directory, manifest, manifestPath, binPath: await fs.realpath(binPath), version: manifest.version };
}
export async function launchPublicCli({ installationDirectory, cliPath, args = [], npmCliPath, env = process.env }) {
  const childEnv = { ...env };
  for (const key of Object.keys(childEnv)) {
    if (['node_options', 'node_path', 'aholo_api_key', 'aholo_region', 'coohom_aholo_config', 'npm_config_offline', 'npm_config_yes'].includes(key.toLowerCase())) delete childEnv[key];
  }
  const shims = await fs.mkdtemp(path.join(installationDirectory, '.cli-'));
  try {
    if (npmCliPath) {
      await fs.access(npmCliPath);
      childEnv.COOHOM_RUNTIME_NODE = process.execPath;
      childEnv.COOHOM_RUNTIME_NPM = npmCliPath;
      childEnv.COOHOM_RUNTIME_NPX = path.join(path.dirname(npmCliPath), 'npx-cli.js');
      for (const command of ['npm', 'npx']) {
        const variable = `COOHOM_RUNTIME_${command.toUpperCase()}`;
        await fs.writeFile(path.join(shims, `${command}.cmd`), `@echo off\r\n"%COOHOM_RUNTIME_NODE%" "%${variable}%" %*\r\n`, 'utf8');
        await fs.writeFile(path.join(shims, command), `#!/bin/sh\nexec "$COOHOM_RUNTIME_NODE" "$${variable}" "$@"\n`, { mode: 0o755 });
      }
    }
    const pathKey = Object.keys(childEnv).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
    childEnv[pathKey] = [shims, path.dirname(process.execPath), path.join(installationDirectory, 'node_modules/.bin'), childEnv[pathKey] ?? ''].join(path.delimiter);
    childEnv.npm_config_offline = 'true';
    childEnv.npm_config_yes = 'false';
    const child = spawn(process.execPath, [cliPath, ...args], { cwd: installationDirectory, env: childEnv, stdio: ['inherit', 'inherit', 'ignore'], windowsHide: true, detached: process.platform !== 'win32' });
    const stop = (signal) => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
        killer.on('error', () => child.kill(signal));
      } else {
        try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    };
    const interrupt = () => stop('SIGINT');
    const terminate = () => stop('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    try {
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => { process.exitCode = code ?? 1; if (process.exitCode) process.stderr.write('MCP public CLI exited unsuccessfully; inspect its local logs.\n'); resolve(); });
      });
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
  } finally { await fs.rm(shims, { recursive: true, force: true }); }
}
