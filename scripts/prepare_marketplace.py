"""Generate the GitHub-installable plugin from the canonical plugin and bundler sources."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
from third_party import notice_files

RUNTIME_FILES = ('launch-mcp.mjs', 'launch-lux3d.mjs', 'update-freeform.mjs',
                 'update-lux3d.mjs', 'runtime-contract.mjs', 'manage-mcp.mjs', 'freeform-policy.json', 'lux3d-policy.json')
MARKETPLACE = 'coohom'
PLUGIN = 'coohom-freeform'


def source_bytes(path: Path) -> bytes:
    data = path.read_bytes()
    if path.suffix in {'.md', '.json', '.yaml', '.yml', '.mjs', '.ps1', '.cmd', '.tsv'} or path.name in {'bootstrap', 'LICENSE'}:
        return data.replace(b'\r\n', b'\n')
    return data


def expected_files(repo: Path) -> dict[str, bytes]:
    source = repo / PLUGIN
    files = {p.relative_to(source).as_posix(): source_bytes(p) for p in source.rglob('*') if p.is_file()}
    files['CHANGELOG.md'] = source_bytes(repo / 'CHANGELOG.md')
    files.update(notice_files(repo))
    files['README.md'] = files['README.md'].replace(b'](../CHANGELOG.md)', b'](CHANGELOG.md)')
    manifest = json.loads(files['.codex-plugin/plugin.json'])
    manifest['mcpServers'] = './.mcp.json'
    files['.codex-plugin/plugin.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    servers = {
        'freeform-modeling-mcp': {'command': './scripts/bootstrap', 'args': ['freeform'], 'cwd': '.',
                                 'env_vars': ['COOHOM_FREEFORM_CACHE'], 'startup_timeout_sec': 1200},
        'lux3d-mcp-server': {'command': './scripts/bootstrap', 'args': ['lux3d'], 'cwd': '.',
                            'env_vars': ['COOHOM_FREEFORM_CACHE', 'LUX3D_MCP_BRIDGE_PORT'],
                            'startup_timeout_sec': 1200},
    }
    files['.mcp.json'] = (json.dumps({'mcpServers': servers}, indent=2) + '\n').encode()
    for path in (repo / 'bundler/marketplace').iterdir():
        if path.is_file():
            files['scripts/' + path.name] = source_bytes(path)
    for name in RUNTIME_FILES:
        files['scripts/mcp/' + name] = source_bytes(repo / 'bundler' / name)
    return files


def check(repo: Path) -> None:
    root = repo / 'plugins' / PLUGIN
    expected = expected_files(repo)
    actual = {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob('*') if p.is_file()}
    if expected != actual:
        changed = sorted(name for name in expected.keys() | actual.keys() if expected.get(name) != actual.get(name))
        raise ValueError(f'Generated marketplace plugin is stale: {changed}; run prepare_marketplace.py --scaffold <official helper>.')
    catalog = json.loads((repo / '.agents/plugins/marketplace.json').read_text(encoding='utf-8'))
    if catalog['name'] != MARKETPLACE or len(catalog['plugins']) != 1:
        raise ValueError('Unexpected generated marketplace identity.')
    entry = catalog['plugins'][0]
    if entry['name'] != PLUGIN or entry['source'] != {'source': 'local', 'path': f'./plugins/{PLUGIN}'}:
        raise ValueError('Marketplace source does not point to the generated plugin.')
    if entry.get('policy') != {'installation': 'AVAILABLE', 'authentication': 'ON_INSTALL'} or entry.get('category') != 'Productivity':
        raise ValueError('Unexpected marketplace policy.')


def generate(repo: Path, scaffold: Path) -> None:
    if not scaffold.is_file():
        raise ValueError('Official plugin-creator scaffold is missing; supply --scaffold.')
    root = repo / 'plugins' / PLUGIN
    subprocess.run([sys.executable, '-X', 'utf8', str(scaffold), PLUGIN, '--path', str(repo / 'plugins'),
                    '--marketplace-path', str(repo / '.agents/plugins/marketplace.json'),
                    '--marketplace-name', MARKETPLACE, '--with-marketplace', '--force'], check=True)
    expected = expected_files(repo)
    # This directory is generated, never used for user configuration or runtime caches.
    for path in root.rglob('*'):
        if path.is_file() and path.relative_to(root).as_posix() not in expected:
            path.unlink()
    for name, data in expected.items():
        destination = root / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    (root / 'scripts/bootstrap').chmod(0o755)
    check(repo)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scaffold', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    if args.check:
        check(repo)
        print('Generated marketplace matches its sources.')
    elif args.scaffold:
        generate(repo, args.scaffold)
        print('Generated coohom-freeform@coohom; no plugin was installed.')
    else:
        parser.error('Supply --scaffold or --check.')
