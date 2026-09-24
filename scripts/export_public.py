"""Export an explicit source allowlist without Git history or local artifacts."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile
from third_party import notice_files, verify_jszip, write_report


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
            mode = 0o100755 if relative in {'bundler/marketplace/bootstrap', 'plugins/coohom-freeform/scripts/bootstrap', 'bundler/marketplace/manage', 'plugins/coohom-freeform/scripts/manage'} else 0o100644
            info.external_attr = mode << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
    with output.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    output.with_suffix(output.suffix + '.sha256').write_text(f'{digest}  {output.name}\n', encoding='ascii')
    return len(files)


def export_release(repo: Path, output: Path, freeform_runtime: Path) -> int:
    from prepare_marketplace import check
    check(repo)
    report = verify_jszip(repo, freeform_runtime)
    count = export(repo, output)
    with output.open('rb') as stream:
        report['sourceArchiveSha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
    write_report(output.with_suffix(output.suffix + '.licenses.json'), report)
    return count


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--freeform-runtime', type=Path, help='Verify actual JSZip dependencies before a release export.')
    mode.add_argument('--source-only', action='store_true', help='CI/development source snapshot, without release dependency verification.')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    try:
        if args.source_only:
            notice_files(root)
            count = export(root, args.output)
            args.output.with_suffix(args.output.suffix + '.licenses.json').unlink(missing_ok=True)
            print('Source-only snapshot; installed dependency licenses were not verified.')
        else:
            count = export_release(root, args.output, args.freeform_runtime)
        print(f'Exported {count} public source files to {args.output}')
    except (ValueError, OSError) as error:
        parser.exit(1, f'{error}\n')
