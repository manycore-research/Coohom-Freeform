import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPublicCli } from './runtime-contract.mjs';

const PACKAGE = '@manycore/coohom-lux3d-mcp';
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function runNpm(node, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, args, { cwd, env, shell: false, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] });
    let errorCode = '';
    child.stdout.resume();
    child.stderr.on('data', (chunk) => {
      // Keep only npm's diagnostic code; registry output may contain private URLs.
      const match = chunk.toString().match(/npm (?:error|ERR!) code ([A-Z][A-Z0-9_]+)/);
      if (match) errorCode = match[1];
    });
    const timer = setTimeout(() => child.kill(), 300_000);
    child.once('error', (error) => { clearTimeout(timer); reject(new Error(`npm could not start (${error.code ?? 'unknown error'}).`)); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Lux3D download failed (${errorCode || (signal ? 'timeout or process terminated' : `exit code ${code}`)}). Check public npm access and the package Node.js compatibility. The previous installation was preserved.`));
    });
  });
}

export async function installLux3d({ pluginRoot, nodeExecutable, npmCliPath, env = process.env, writeLine = console.log, version = 'latest' } = {}) {
  if (version !== 'latest' && !VERSION.test(version)) throw new Error('Expected latest or an exact MCP version.');
  const packageSpec = `${PACKAGE}@${version}`;
  const plugin = path.resolve(pluginRoot);
  const runtime = path.join(plugin, 'runtime', 'mcp');
  const policy = JSON.parse(await fs.readFile(path.join(runtime, 'lux3d-policy.json'), 'utf8'));
  if (!new RegExp(`^${PACKAGE}@latest$`).test(policy.packageSpec)
    || policy.registry !== 'https://registry.npmjs.org/') {
    throw new Error('Invalid Lux3D installation policy.');
  }
  const node = nodeExecutable ?? path.join(plugin, 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node');
  const npmCli = npmCliPath ?? path.join(plugin, 'runtime', 'node', 'npm', 'bin', 'npm-cli.js');
  await fs.access(node);
  await fs.access(npmCli);
  let lock;
  try { lock = await fs.open(path.join(runtime, '.lux3d-update.lock'), 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('A Lux3D installation is running or an earlier installation was interrupted. Check installation processes and the lock file before updating.');
    throw error;
  }
  let cache;
  let stage;
  let pointerTemporary;
  let published = false;
  try {
    const versions = path.join(runtime, 'lux3d');
    await fs.mkdir(versions, { recursive: true });
    stage = await fs.mkdtemp(path.join(versions, 'install-'));
    cache = await fs.mkdtemp(path.join(os.tmpdir(), 'coohom-lux3d-npm-'));
    await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({
      name: 'coohom-lux3d-runtime', version: '1.0.0', private: true,
    }, null, 2) + '\n');
    const childEnv = { ...env };
    for (const key of Object.keys(childEnv)) {
      if (['aholo_api_key', 'aholo_region', 'coohom_aholo_config', 'node_options', 'node_path'].includes(key.toLowerCase())) delete childEnv[key];
    }
    writeLine(`Installing ${packageSpec}. Access to public npm is required.`);
    await runNpm(node, [npmCli, 'install', packageSpec, '--save-exact', '--omit=dev',
      '--ignore-scripts', '--no-audit', '--no-fund', '--engine-strict', '--prefer-online',
      '--fetch-retries=0', '--fetch-retry-mintimeout=1000', '--fetch-retry-maxtimeout=5000', '--fetch-timeout=60000', '--registry=https://registry.npmjs.org/',
      `--@manycore:registry=${policy.registry}`, `--cache=${cache}`], { cwd: stage, env: childEnv });
    const { manifest } = await readPublicCli(stage, PACKAGE, undefined, 'lux3d-mcp-server');
    if (version !== 'latest' && manifest.version !== version) throw new Error('Installed MCP does not match the requested exact version.');
    const packageLock = JSON.parse(await fs.readFile(path.join(stage, 'package-lock.json'), 'utf8'));
    if (packageLock.packages?.[`node_modules/${PACKAGE}`]?.version !== manifest.version
      || packageLock.packages?.['']?.dependencies?.[PACKAGE] !== manifest.version) {
      throw new Error('The installed Lux3D version does not match the lockfile. The previous installation was preserved.');
    }
    const installation = { packageSpec, version: manifest.version,
      directory: path.relative(runtime, stage).split(path.sep).join('/'),
      installedAt: new Date().toISOString() };
    pointerTemporary = path.join(runtime, `.lux3d-install-${path.basename(stage)}.json`);
    await fs.writeFile(pointerTemporary, JSON.stringify(installation, null, 2) + '\n');
    await fs.rename(pointerTemporary, path.join(runtime, 'lux3d-install.json'));
    published = true;
    writeLine(`Lux3D installed: ${installation.version}. Ordinary startup will use this local version.`);
    return installation;
  } finally {
    // These are exact directories created above, under known staging/cache roots.
    if (pointerTemporary) await fs.rm(pointerTemporary, { force: true });
    if (!published && stage && inside(path.join(runtime, 'lux3d'), stage)) await fs.rm(stage, { recursive: true, force: true });
    if (cache && path.dirname(cache) === os.tmpdir()) await fs.rm(cache, { recursive: true, force: true });
    await lock.close();
    await fs.rm(path.join(runtime, '.lux3d-update.lock'), { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stderr.write('Use manage-mcp.mjs <plugin-root> install|retry|versions to update both MCPs together.\n');
  process.exitCode = 1;
}
