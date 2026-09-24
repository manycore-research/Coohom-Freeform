"""Run an actual release ZIP installer in an isolated Codex profile."""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import time
import zipfile


@contextmanager
def isolated_directory(parent):
    root = Path(tempfile.mkdtemp(prefix='cf-', dir=parent)).resolve()
    assert root.is_relative_to(parent) and root.name.startswith('cf-')
    try:
        yield root
    finally:
        # Dependency trees can exceed MAX_PATH even with a short test root.
        cleanup_path = '\\\\?\\' + str(root) if os.name == 'nt' else str(root)
        shutil.rmtree(cleanup_path)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('archive', type=Path)
parser.add_argument('--codex', type=Path)
parser.add_argument('--report', type=Path, required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[1]
cli = args.codex
if cli is None and os.name != 'nt':
    executable = shutil.which('codex')
    cli = Path(executable) if executable else None
if cli is None:
    npm_root = Path((repo / 'tmp/npm-root.txt').read_text(encoding='utf-8').strip())
    cli = next(p for p in (npm_root / '@openai').rglob('codex.exe') if p.is_file())
cli = cli.resolve()
started = time.monotonic()
temporary_parent = Path(os.environ.get('RUNNER_TEMP', tempfile.gettempdir())).resolve()
with isolated_directory(temporary_parent) as temporary:
    root = Path(temporary).resolve()
    assert root.is_relative_to(temporary_parent)
    source = root / 'extracted'
    with zipfile.ZipFile(args.archive) as archive:
        archive.extractall(source)
        if os.name != 'nt':
            for member in archive.infolist():
                mode = member.external_attr >> 16
                if mode:
                    (source / member.filename).chmod(mode & 0o777)
    bundle = next(p for p in source.iterdir() if p.is_dir())
    metadata = json.loads((bundle / 'bundle.json').read_text(encoding='utf-8'))
    profile = root / 'codex-home'
    profile.mkdir()
    env = os.environ.copy()
    env.update(CODEX_HOME=str(profile), COOHOM_CODEX_CLI=str(cli))
    destination = root / 'installed'
    entry = ['cmd.exe', '/d', '/c', 'Install.cmd'] if os.name == 'nt' else ['./Install.command']
    logs = []
    for options in [['--check'], []]:
        command = [*entry, '--destination', str(destination), *options]
        result = subprocess.run(command, cwd=bundle, env=env, input='\n', text=True,
                                encoding='utf-8', errors='replace', capture_output=True, timeout=900)
        logs.append(result.stdout + result.stderr)
        if result.returncode:
            raise RuntimeError('Installer failed: ' + logs[-1][-4000:])
        if options:
            assert not destination.exists(), '--check wrote the installation destination'
    assert 'Installation complete:' in logs[-1]
    result = subprocess.run([str(cli), 'plugin', 'list', '--json'], env=env,
                            capture_output=True, text=True, encoding='utf-8', check=True)
    assert metadata['version'] in result.stdout
    target = next(destination.glob('*/marketplace/plugins/coohom-freeform'))
    actual = json.loads((target / '.codex-plugin/plugin.json').read_text(encoding='utf-8'))
    assert actual['version'] == metadata['version']
    pair = json.loads((target / 'runtime/mcp/mcp-pair.json').read_text(encoding='utf-8'))
    report = dict(passed=True, pluginVersion=metadata['version'], platform=metadata['platform'],
                  arch=metadata['arch'], actualEntrypoint=entry[-1], readOnlyCheckPassed=True,
                  installationAndRegistrationPassed=True, isolatedProfile=True, userPluginChanged=False,
                  resolvedVersions={s: pair[s]['version'] for s in ['freeform', 'lux3d']},
                  elapsedSeconds=round(time.monotonic() - started, 2),
                  scope='Actual extracted ZIP entrypoint, dependency install and official Codex registration/cache verification; no scene tools.')
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))
