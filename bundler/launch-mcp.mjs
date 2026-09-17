import { readFile, realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function requirePackageFile(directory, entry) {
  if (!inside(directory, entry) || !inside(await realpath(directory), await realpath(entry)) || !(await stat(entry)).isFile()) {
    throw new Error('Freeform CLI or loader entry is outside its package or is not a file.');
  }
  return entry;
}

function readArguments(args) {
  if (args.length === 0) return ['start', '--stdio'];
  if (args.length === 2 && args[0] === 'start' && args[1] === '--stdio') return args;
  if (args.length === 1 && args[0] === 'status') return args;
  if (args.length === 2 && args[0] === 'port' && args[1] === '--url') return args;
  throw new Error('Allowed commands: start --stdio (default), status, port --url.');
}

async function readPackage(installationDirectory, name, expectedVersion) {
  const directory = path.join(installationDirectory, 'node_modules', name);
  const manifestPath = path.join(directory, 'package.json');
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch { throw new Error(`Cannot read installed ${name}/package.json.`); }
  if (manifest.name !== name || !VERSION.test(manifest.version)
    || (expectedVersion !== undefined && manifest.version !== expectedVersion)) {
    throw new Error(`Installed ${name} version does not match the installation record.`);
  }
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[name];
  if (typeof bin !== 'string' || !bin) throw new Error(`Installed ${name} does not declare its CLI entry.`);
  const binPath = await requirePackageFile(directory, path.resolve(directory, bin));
  return { directory, manifestPath, binPath, version: manifest.version };
}

// Installation and startup validate the same public CLI contract. A future
// upstream wrapper change is rejected before the installed pointer is replaced.
export async function validateFreeformRuntime(installationDirectory, { version, tsxVersion } = {}) {
  const freeform = await readPackage(installationDirectory, 'freeform-modeling-mcp', version);
  const tsx = await readPackage(installationDirectory, 'tsx', tsxVersion);
  const wrapper = await readFile(freeform.binPath, 'utf8');
  const delegatedPath = wrapper.match(/^\s*const\s+cliPath\s*=\s*path\.resolve\(\s*__dirname\s*,\s*(['"])([^'"]+)\1\s*\)\s*;/m);
  if (!delegatedPath
    || !/^\s*const\s+args\s*=\s*process\.argv\.slice\(2\)\s*;/m.test(wrapper)
    || !/\bspawnSync\(\s*(['"])npx\1\s*,\s*\[\s*(['"])tsx\2\s*,\s*cliPath\s*,\s*\.\.\.args\s*\]/.test(wrapper)) {
    throw new Error('Freeform public CLI wrapper changed; update the plugin adapter before installing this version.');
  }
  const cliPath = await requirePackageFile(freeform.directory, path.resolve(path.dirname(freeform.binPath), delegatedPath[2]));
  const requireTsx = createRequire(tsx.manifestPath);
  const loaderPath = await requirePackageFile(await realpath(tsx.directory), requireTsx.resolve('tsx'));
  return { freeform, tsx, cliPath, loaderPath };
}

async function main() {
  const args = readArguments(process.argv.slice(2));
  let installation;
  try { installation = JSON.parse(await readFile(path.join(runtimeDirectory, 'freeform-install.json'), 'utf8')); }
  catch { throw new Error('Freeform is not installed; run the plugin installer or updater first.'); }
  if (installation.packageSpec !== 'freeform-modeling-mcp@latest'
    || !VERSION.test(installation.version) || !VERSION.test(installation.tsxVersion)
    || typeof installation.directory !== 'string' || !/^freeform\/install-[A-Za-z0-9]+$/.test(installation.directory)) {
    throw new Error('Freeform installation record is invalid; run the plugin installer or updater again.');
  }
  const installationDirectory = path.resolve(runtimeDirectory, installation.directory);
  if (!inside(await realpath(runtimeDirectory), await realpath(installationDirectory))) {
    throw new Error('Freeform installation directory is outside the plugin runtime.');
  }
  const { cliPath, loaderPath } = await validateFreeformRuntime(installationDirectory, installation);
  // Register tsx's public root export, equivalent to node --import tsx. Execute
  // the public bin's delegated CLI in this process without npx or network access.
  process.chdir(runtimeDirectory);
  process.argv = [process.execPath, cliPath, ...args];
  await import(pathToFileURL(loaderPath).href);
  await import(pathToFileURL(cliPath).href);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`[coohom-freeform] ${error.message}\n`, () => process.exit(1));
  });
}
