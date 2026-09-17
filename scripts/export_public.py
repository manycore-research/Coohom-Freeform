"""Export an explicit source allowlist without Git history or local artifacts."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile


def source_files(repo: Path) -> list[Path]:
    config = json.loads((repo / 'public-source.json').read_text(encoding='utf-8'))
    selected: set[Path] = set()
    excluded = set(config.get('exclude', []))
    forbidden_parts = {'.git', 'node_modules', '__pycache__', '.npm-cache', '.npmrc'}
    for entry in config['include']:
        source = repo / entry
        if not source.exists():
            raise ValueError(f'Missing public source: {entry}')
        candidates = source.rglob('*') if source.is_dir() else [source]
        for path in candidates:
            relative = path.relative_to(repo)
            if any(part in forbidden_parts for part in relative.parts):
                continue
            if relative.as_posix() in excluded or path.name.startswith('.env'):
                continue
            if path.is_symlink() or not path.resolve().is_relative_to(repo.resolve()):
                raise ValueError(f'Public source cannot follow links: {relative}')
            if path.is_file():
                selected.add(path)
    return sorted(selected)


def export(repo: Path, output: Path) -> int:
    files = source_files(repo)
    if output.resolve() in {path.resolve() for path in files}:
        raise ValueError('Output must not be part of the public source allowlist')
    for path in files:
        if path.suffix in {'.md', '.json', '.py', '.ts', '.js', '.mjs', '.yaml', '.yml'}:
            text = path.read_text(encoding='utf-8-sig')
            if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', text):
                raise ValueError(f'Private key in public source: {path.relative_to(repo)}')
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            relative = path.relative_to(repo).as_posix()
            info = zipfile.ZipInfo.from_file(path, relative)
            info.create_system = 3
            mode = 0o100755 if relative in {'bundler/marketplace/bootstrap', 'plugins/coohom-freeform/scripts/bootstrap'} else 0o100644
            info.external_attr = mode << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
    with output.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    output.with_suffix(output.suffix + '.sha256').write_text(f'{digest}  {output.name}\n', encoding='ascii')
    return len(files)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    print(f'Exported {export(root, args.output)} public source files to {args.output}')
