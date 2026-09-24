import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstallation, readPublicCli, launchPublicCli } from './runtime-contract.mjs';
const runtime = path.dirname(fileURLToPath(import.meta.url));
async function main() {
  if (process.argv.length > 2) throw new Error('Lux3D MCP must start without arguments.');
  const installation = await readInstallation(runtime, 'lux3d');
  const installationDirectory = path.resolve(runtime, installation.directory);
  const { binPath } = await readPublicCli(installationDirectory, '@manycore/coohom-lux3d-mcp', installation.version, 'lux3d-mcp-server');
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'lux3d_mcp_executor_url') delete env[key];
  }
  env.LUX3D_MCP_EXECUTOR_URL = 'https://www.coohom.com/pub/tool/bim/ai-home/mcp-executor';
  await launchPublicCli({ installationDirectory, cliPath: binPath, env });
}
main().catch(() => {
  process.stderr.write('[coohom-lux3d] MCP startup failed. Check the installation state and public CLI. Internal errors were not printed to protect credentials.\n');
  process.exitCode = 1;
});
