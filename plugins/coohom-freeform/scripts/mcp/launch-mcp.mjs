import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readInstallation, readPublicCli, launchPublicCli } from './runtime-contract.mjs';
const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
export async function validateFreeformRuntime(installationDirectory, { version } = {}) {
  const freeform = await readPublicCli(installationDirectory, 'freeform-modeling-mcp', version);
  return { freeform, cliPath: freeform.binPath };
}
async function main() {
  const args = process.argv.slice(2);
  if (!args.length) args.push('start', '--stdio');
  if (!(args.length === 2 && args[0] === 'start' && args[1] === '--stdio')
    && !(args.length === 1 && args[0] === 'status')
    && !(args.length === 2 && args[0] === 'port' && args[1] === '--url')) throw new Error('Allowed commands: start --stdio (default), status, port --url.');
  const installation = await readInstallation(runtimeDirectory, 'freeform');
  const installationDirectory = path.resolve(runtimeDirectory, installation.directory);
  const { cliPath } = await validateFreeformRuntime(installationDirectory, installation);
  await launchPublicCli({ installationDirectory, cliPath, args,
    npmCliPath: installation.npmCliPath ?? path.resolve(runtimeDirectory, '../node/npm/bin/npm-cli.js') });
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => { process.stderr.write(`[coohom-freeform] ${error.message}\n`); process.exitCode = 1; });
}
