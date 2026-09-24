import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [sourceRoot, cacheRoot, npmCliPath, ...argv] = process.argv.slice(2);
let runner;
try {
  if (![sourceRoot, cacheRoot, npmCliPath].every(value => typeof value === 'string' && path.isAbsolute(value))) throw new Error('Use scripts/manage or scripts/manage.cmd.');
  let moduleRoot = path.join(sourceRoot, 'scripts/mcp');
  // Plugin replacement may remove the original scripts. Load the complete manager
  // from a private independent directory before invoking any official mutation.
  if (!['status', 'doctor'].includes(argv[0] ?? 'status') && !(argv[0] === 'cleanup' && !argv.includes('--apply'))) {
    runner = await fs.mkdtemp(path.join(os.tmpdir(), 'coohom-manager-'));
    await fs.cp(moduleRoot, runner, { recursive: true }); moduleRoot = runner;
  }
  const manager = await import(pathToFileURL(path.join(moduleRoot, 'management.mjs')).href);
  const options = manager.parseManagementArguments(argv);
  const result = await manager.runManagement({ sourceRoot, cacheRoot, npmCliPath, options,
    writeLine: message => process.stderr.write(`[coohom-freeform] ${message}\n`) });
  process.stdout.write((options.json ? JSON.stringify(result, null, 2) : manager.formatManagementResult(result)) + '\n');
} catch (error) {
  if (argv.includes('--json')) process.stdout.write(JSON.stringify({ status: 'failed', reason: error.message }) + '\n');
  else process.stderr.write(`[coohom-freeform] ${error.message}\n`);
  process.exitCode = 1;
} finally {
  if (runner && path.dirname(runner) === os.tmpdir() && path.basename(runner).startsWith('coohom-manager-')) await fs.rm(runner, { recursive: true, force: true });
}
