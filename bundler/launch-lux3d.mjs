import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
class LaunchError extends Error {}

function inside(parent, candidate) {
  const child = relative(parent, candidate);
  return child !== '' && child !== '..' && !child.startsWith('../') && !child.startsWith('..\\') && !isAbsolute(child);
}

async function main() {
  if (process.argv.length > 2) throw new LaunchError('Lux3D MCP must start without arguments. Sign-in is provided by the Coohom executor page.');
  let installation;
  try { installation = JSON.parse(await readFile(join(runtimeDirectory, 'lux3d-install.json'), 'utf8')); }
  catch { throw new LaunchError('The Lux3D installation record is missing or damaged. Run the plugin installation or upgrade again.'); }
  if (typeof installation.directory !== 'string' || !/^lux3d\/install-[A-Za-z0-9_-]+$/.test(installation.directory)
    || typeof installation.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(installation.version)) {
    throw new LaunchError('The Lux3D installation record is invalid. Reinstall the plugin.');
  }
  const packageDirectory = join(runtimeDirectory, installation.directory, 'node_modules', '@manycore', 'coohom-lux3d-mcp');
  let manifest;
  try { manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8')); }
  catch { throw new LaunchError('The installed Lux3D MCP is missing or damaged. Reinstall the plugin.'); }
  if (manifest.name !== '@manycore/coohom-lux3d-mcp' || manifest.version !== installation.version) {
    throw new LaunchError('The Lux3D MCP version differs from its installation record. Reinstall the plugin.');
  }
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['lux3d-mcp-server'];
  if (typeof bin !== 'string' || !bin) throw new LaunchError('Lux3D MCP does not declare a CLI entry. Reinstall the plugin.');
  const declaredEntry = resolve(packageDirectory, bin);
  if (!inside(packageDirectory, declaredEntry)) throw new LaunchError('The Lux3D MCP CLI entry is outside its package directory. Reinstall the plugin.');
  // Match ESM's real path so the published CLI main-module guard runs through junctions.
  const entry = await realpath(declaredEntry);
  if (!inside(await realpath(packageDirectory), entry)) throw new LaunchError('The Lux3D MCP CLI entry is outside its package directory. Reinstall the plugin.');
  for (const name of Object.keys(process.env)) {
    if (['aholo_api_key', 'aholo_region', 'coohom_aholo_config'].includes(name.toLowerCase())) delete process.env[name];
  }
  process.argv = [process.execPath, entry];
  process.chdir(runtimeDirectory);
  // Launch only the recorded local package; no npm, network or update at startup.
  await import(pathToFileURL(entry).href);
}

main().catch((error) => {
  const message = error instanceof LaunchError ? error.message
    : 'Lux3D MCP could not start. Check installed dependencies. Internal errors that may contain credentials have not been printed.';
  process.stderr.write(`[coohom-lux3d] ${message}\n`, () => process.exit(1));
});
