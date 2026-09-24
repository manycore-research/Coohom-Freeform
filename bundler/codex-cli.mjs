import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
async function isFile(filename) { try { return (await fs.stat(filename)).isFile(); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false; throw error; } }
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
