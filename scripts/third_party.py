"""Distribute third-party notices and verify JSZip only at release time."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalized(data: bytes) -> bytes:
    return data.replace(b'\r\n', b'\n')


def notice_files(repo: Path) -> dict[str, bytes]:
    """Return the single maintained notice set, portable across Git line endings."""
    paths = [repo / 'THIRD_PARTY.md', repo / 'licenses/jszip.json',
             repo / 'licenses/jszip-3.10.2-MIT.txt']
    files = {}
    for path in paths:
        if not path.is_file() or not path.resolve().is_relative_to(repo.resolve()):
            raise ValueError(f'Missing or external third-party notice: {path.name}')
        files[path.relative_to(repo).as_posix()] = normalized(path.read_bytes())
    policy = json.loads(files['licenses/jszip.json'])
    if policy.get('name') != 'jszip' or policy.get('licenseConcluded') != 'MIT':
        raise ValueError('JSZip must have an explicit MIT license selection.')
    notice = files['licenses/jszip-3.10.2-MIT.txt']
    if sha256(notice) != policy.get('noticeSha256'):
        raise ValueError('JSZip MIT notice differs from the reviewed text.')
    return files


def installed_file(runtime: Path, relative: str) -> Path:
    parts = PurePosixPath(relative)
    if parts.is_absolute() or '..' in parts.parts or '\\' in relative or ':' in relative:
        raise ValueError(f'Invalid installed package path: {relative}')
    path = runtime.joinpath(*parts.parts)
    if not path.is_file() or not path.resolve().is_relative_to(runtime.resolve()):
        raise ValueError(f'Missing or external installed file: {relative}')
    return path


def verify_jszip(repo: Path, runtime: Path | None) -> dict:
    """Read a resolved Freeform installation; do not install or modify anything.

    This verifies declared JSZip packages, not all dependency licenses or hidden
    bundled code. Missing JSZip requires a new upstream review, not an empty pass.
    """
    files = notice_files(repo)
    if runtime is None:
        raise ValueError('Release verification requires --freeform-runtime <installed Freeform directory>.')
    policy = json.loads(files['licenses/jszip.json'])
    lock_bytes = installed_file(runtime, 'package-lock.json').read_bytes()
    lock = json.loads(lock_bytes)
    if lock.get('lockfileVersion') != 3 or not isinstance(lock.get('packages'), dict):
        raise ValueError('Expected an npm v3 lockfile from the actual installation.')
    packages = lock['packages']
    freeform_key = 'node_modules/freeform-modeling-mcp'
    freeform = json.loads(installed_file(runtime, freeform_key + '/package.json').read_bytes())
    locked_freeform = packages.get(freeform_key, {})
    if (freeform.get('name') != 'freeform-modeling-mcp' or not freeform.get('version')
            or locked_freeform.get('version') != freeform['version']
            or packages.get('', {}).get('dependencies', {}).get('freeform-modeling-mcp') != freeform['version']
            or not locked_freeform.get('integrity')):
        raise ValueError('Freeform package and resolved lockfile do not match.')
    entries = [(key, value) for key, value in packages.items()
               if key == 'node_modules/jszip' or key.endswith('/node_modules/jszip')]
    if not entries:
        raise ValueError('No declared JSZip found; review whether upstream removed or bundled it before release.')
    verified = []
    for key, entry in sorted(entries):
        manifest = json.loads(installed_file(runtime, key + '/package.json').read_bytes())
        if (manifest.get('name') != 'jszip' or manifest.get('version') != policy['version']
                or entry.get('version') != policy['version']):
            raise ValueError(f'Unreviewed or mismatched JSZip version: {key}; review its license before release.')
        if (manifest.get('license') != policy['licenseDeclared']
                or entry.get('license') != policy['licenseDeclared']):
            raise ValueError(f'JSZip license declaration changed: {key}')
        if entry.get('integrity') != policy['packageIntegrity'] or entry.get('resolved') != policy['packageUrl']:
            raise ValueError(f'JSZip locked package provenance changed: {key}')
        license_text = normalized(installed_file(runtime, key + '/LICENSE.markdown').read_bytes())
        if sha256(license_text) != policy['upstreamLicenseSha256']:
            raise ValueError(f'JSZip upstream license text changed: {key}')
        if files['licenses/jszip-3.10.2-MIT.txt'].strip() not in license_text:
            raise ValueError(f'Shipped MIT notice does not match the installed JSZip license: {key}')
        verified.append({'packagePath': key, 'version': manifest['version'],
                         'licenseDeclared': manifest['license'], 'licenseConcluded': 'MIT',
                         'packageIntegrity': entry['integrity'],
                         'upstreamLicenseSha256': sha256(license_text)})
    return {
        'schemaVersion': 1,
        'scope': 'Declared JSZip packages in the supplied Freeform installation; MIT selection and notices only.',
        'checkedAt': datetime.now(timezone.utc).isoformat(),
        'freeform': {'version': freeform['version'], 'packageIntegrity': locked_freeform['integrity']},
        'lockfileSha256': sha256(lock_bytes), 'policySha256': sha256(files['licenses/jszip.json']),
        'noticesSha256': {name: sha256(data) for name, data in files.items()},
        'jszip': verified,
        'limitations': ['Not an audit of all dependencies or embedded bundles.',
                        'Does not establish organizational approval or future latest installations.'],
    }


def write_report(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--freeform-runtime', type=Path)
    mode.add_argument('--notices-only', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    try:
        if args.notices_only:
            if args.report:
                parser.error('--report requires --freeform-runtime; notice checks are not dependency verification.')
            print(f'Third-party notice files verified: {len(notice_files(repo))}. No installed dependencies checked.')
        else:
            report = verify_jszip(repo, args.freeform_runtime)
            if args.report:
                write_report(args.report, report)
            print(json.dumps(report, indent=2))
    except (ValueError, OSError) as error:
        parser.exit(1, f'{error}\n')
