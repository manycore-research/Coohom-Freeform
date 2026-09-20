"""Prepare plugin versions and retain verified, immutable local release bundles."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import quote
import zipfile
from third_party import notice_files, normalized, verify_jszip

TARGETS = {
    'windows-x64': ('win32', 'x64', 'Install.cmd', 'node.exe'),
    'macos-arm64': ('darwin', 'arm64', 'Install.command', 'bin/node'),
}
VERSION = re.compile(r'^(\d+)\.(\d+)\.(\d+)\+codex\.(\d{14})$')
PLUGIN = 'coohom-freeform'
HISTORICAL_VALIDATION_NOTE = (
    "This entry verifies a previous release artifact; archiveSha256 intentionally identifies "
    "that entry's pluginVersion rather than the current top-level package."
)
LEGACY_VALIDATION_SCOPE = (
    'ZIP integrity, SHA256/build metadata, complete installer structure, exact static plugin source '
    'file set and contents, bundle-root changelog and macOS executable permissions. '
    'No platform installer execution or full unchanged-runtime comparison.'
)


def validation_scope(target: str) -> str:
    checked = ('ZIP integrity, SHA256/build metadata, complete installer structure, '
               'exact static plugin source file set and contents, and bundle-root changelog')
    if target == 'macos-arm64':
        checked += ', plus macOS executable permissions'
    return f'{checked}. No platform installer execution or full unchanged-runtime comparison.'


def version_key(version: str) -> tuple:
    match = VERSION.fullmatch(version)
    if not match:
        raise ValueError(f'Invalid release version: {version}')
    major, minor, patch, timestamp = match.groups()
    datetime.strptime(timestamp, '%Y%m%d%H%M%S')
    return int(major), int(minor), int(patch), timestamp


def digest(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def inspect_artifacts(input_dir: Path, source_dir: Path | None = None) -> tuple[str, dict]:
    artifacts = {}
    for target, (platform, arch, entrypoint, node) in TARGETS.items():
        stem = f'{PLUGIN}-{target}'
        archive_path = input_dir / f'{stem}.zip'
        checksum_path = input_dir / f'{stem}.zip.sha256'
        metadata_path = input_dir / f'{stem}.build.json'
        if not all(p.is_file() for p in (archive_path, checksum_path, metadata_path)):
            raise ValueError(f'Missing complete artifact set for {target}: {input_dir}')
        metadata = load_json(metadata_path)
        actual_digest = digest(archive_path)
        checksum = checksum_path.read_text(encoding='ascii').split()
        if checksum != [actual_digest, archive_path.name]:
            raise ValueError(f'Checksum mismatch: {archive_path.name}')
        if metadata.get('sha256') != actual_digest or metadata.get('sizeBytes') != archive_path.stat().st_size:
            raise ValueError(f'Build record hash/size mismatch: {target}')
        if (metadata.get('platform'), metadata.get('arch')) != (platform, arch):
            raise ValueError(f'Build record platform mismatch: {target}')
        try:
            with zipfile.ZipFile(archive_path) as archive:
                names = archive.namelist()
                if len(names) != len(set(names)) or archive.testzip() is not None:
                    raise ValueError(f'Invalid ZIP contents: {target}')
                root = stem + '/'
                plugin_root = root + 'marketplace/plugins/' + PLUGIN + '/'
                manifest = json.loads(archive.read(plugin_root + '.codex-plugin/plugin.json'))
                bundle = json.loads(archive.read(root + 'bundle.json'))
                version = manifest.get('version', '')
                version_key(version)
                if manifest.get('name') != PLUGIN or bundle.get('pluginName') != PLUGIN:
                    raise ValueError(f'Plugin identity mismatch: {target}')
                if bundle.get('version') != version or metadata.get('pluginVersion', version) != version:
                    raise ValueError(f'Package version mismatch: {target}')
                if (bundle.get('platform'), bundle.get('arch')) != (platform, arch):
                    raise ValueError(f'Package platform mismatch: {target}')
                policy = plugin_root + 'runtime/mcp/freeform-policy.json'
                bundled_mcp = plugin_root + 'runtime/mcp/node_modules/freeform-modeling-mcp/package.json'
                dependency_mode = 'install-current' if policy in names else 'bundled' if bundled_mcp in names else 'unknown'
                required = [root + entrypoint, root + 'install.mjs', plugin_root + 'runtime/node/' + node]
                # Early immutable bundles contain the MCPs themselves and predate bundled npm.
                if dependency_mode != 'bundled':
                    required.append(plugin_root + 'runtime/node/npm/bin/npm-cli.js')
                for name in required:
                    if name not in names:
                        raise ValueError(f'Incomplete installer: missing {name}')
                source_count = 0
                if source_dir is not None:
                    expected_files = {p.relative_to(source_dir).as_posix(): p.read_bytes()
                                      for p in source_dir.rglob('*') if p.is_file()}
                    changelog = source_dir.parent / 'CHANGELOG.md'
                    expected_files['CHANGELOG.md'] = changelog.read_bytes()
                    notices = notice_files(source_dir.parent)
                    expected_files.update(notices)
                    if 'README.md' in expected_files:
                        expected_files['README.md'] = expected_files['README.md'].replace(b'](../CHANGELOG.md)', b'](CHANGELOG.md)')
                    expected_names = set(expected_files)
                    packed_names = {name[len(plugin_root):] for name in names if name.startswith(plugin_root)
                                    and not name.startswith(plugin_root + 'runtime/') and not name.endswith('/')}
                    if expected_names != packed_names:
                        raise ValueError(f'Package/source file set mismatch: {target}; extra={sorted(packed_names - expected_names)}, missing={sorted(expected_names - packed_names)}')
                    for relative, content in expected_files.items():
                        packed = archive.read(plugin_root + relative)
                        if relative == '.codex-plugin/plugin.json':
                            expected = json.loads(content)
                            expected.pop('mcpServers', None)
                            matches = json.loads(packed) == expected
                        else:
                            matches = packed == content
                        if not matches:
                            raise ValueError(f'Package/source mismatch: {target}/{relative}')
                        source_count += 1
                    if archive.read(root + 'CHANGELOG.md') != changelog.read_bytes():
                        raise ValueError(f'Bundle-root changelog mismatch: {target}')
                    for relative, content in notices.items():
                        if normalized(archive.read(root + relative)) != content:
                            raise ValueError(f'Bundle-root third-party notice mismatch: {target}/{relative}')
                permissions_checked = False
                if platform == 'darwin':
                    for name in (root + entrypoint, plugin_root + 'runtime/node/' + node):
                        if not (archive.getinfo(name).external_attr >> 16) & 0o111:
                            raise ValueError(f'Missing executable permission: {name}')
                    permissions_checked = True
        except (KeyError, zipfile.BadZipFile, json.JSONDecodeError) as error:
            raise ValueError(f'Invalid package {target}: {error}') from error
        artifacts[target] = {
            'path': archive_path, 'metadata': metadata, 'version': version,
            'sha256': actual_digest, 'sizeBytes': archive_path.stat().st_size,
            'dependencyMode': dependency_mode,
            'checks': {'zipIntegrityPassed': True, 'checksumPassed': True,
                       'manifestAndBundleVersionMatched': True, 'installerStructurePassed': True,
                       'sourceFilesMatched': source_count,
                       'macosExecutablePermissionsChecked': permissions_checked},
        }
    versions = {artifact['version'] for artifact in artifacts.values()}
    if len(versions) != 1:
        raise ValueError('Platform package versions differ; publish the complete matching set.')
    return versions.pop(), artifacts


@contextmanager
def release_lock(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    lock = directory / '.release.lock'
    try:
        stream = lock.open('x', encoding='utf-8')
    except FileExistsError as error:
        raise ValueError(f'Another release operation may be active. Inspect {lock} before removing a stale lock.') from error
    try:
        with stream:
            stream.write(datetime.now(timezone.utc).isoformat())
        yield
    finally:
        lock.unlink(missing_ok=True)


def rebuild_index(directory: Path) -> None:
    releases = [load_json(p) for p in directory.glob('*/release.json') if not p.parent.name.startswith('.')]
    releases.sort(key=lambda release: version_key(release['version']), reverse=True)
    index = {'schemaVersion': 1, 'latest': releases[0]['version'] if releases else None, 'releases': releases}
    lines = ['# Release downloads', '', 'Choose a version and platform below. Full versions match the bundled plugin; historical files are immutable.', '',
             '[Full changelog](../../CHANGELOG.md)', '',
             '| Release | Full version / build time (UTC) | Release notes | Windows x64 | macOS ARM64 |',
             '|---|---|---|---|---|']
    for release in releases:
        version = release['version']
        timestamp = version_key(version)[3]
        date = datetime.strptime(timestamp, '%Y%m%d%H%M%S').strftime('%Y-%m-%d %H:%M:%S')
        links = []
        for target in TARGETS:
            artifact = release['artifacts'][target]
            url = quote(version + '/' + artifact['archive'])
            checksum = quote(version + '/' + artifact['checksum'])
            links.append(f'[Download ZIP]({url}) · [SHA256]({checksum})')
        notes_url = quote(version + '/CHANGELOG.md')
        lines.append(f'| {version.split("+")[0]} | `{version}`<br>{date} | [Changes]({notes_url}) | {links[0]} | {links[1]} |')
    lines.extend(['', 'Each version retains its packages, SHA256 checksums, build records and release notes. See its build record for verification scope; archive checks do not imply a real installation test.', '',
                  'Historical ZIPs and plugin content are preserved unchanged. Packages using `@latest` / `@alpha` resolve current MCP dependencies at installation time; selecting an older plugin does not guarantee its original dependency versions.', ''])
    for filename, content in [('index.json', json.dumps(index, ensure_ascii=False, indent=2) + '\n'),
                              ('README.md', '\n'.join(lines))]:
        temporary = directory / ('.' + filename + '.tmp')
        temporary.write_text(content, encoding='utf-8')
        temporary.replace(directory / filename)


def archive_release(repo: Path, input_dir: Path, notes: str, source_dir: Path | None = None,
                    provenance: dict | None = None) -> Path:
    repo, input_dir = repo.resolve(), input_dir.resolve()
    notes = notes.strip()
    if not notes:
        raise ValueError('Release notes are required.')
    version, artifacts = inspect_artifacts(input_dir, source_dir)
    releases = repo / 'dist/releases'
    destination = releases / version
    with release_lock(releases):
        if destination.exists():
            existing = load_json(destination / 'release.json')
            if existing['notes'] != notes:
                raise ValueError(f'Release {version} already exists with different notes; immutable releases cannot be overwritten.')
            for target, artifact in artifacts.items():
                retained = existing['artifacts'][target]
                if artifact['sha256'] != retained['sha256'] or digest(destination / retained['archive']) != artifact['sha256']:
                    raise ValueError(f'Release {version} already exists with different package content: {target}')
            rebuild_index(releases)
            return destination
        with tempfile.TemporaryDirectory(prefix='.pending-', dir=releases) as temporary:
            work = Path(temporary).resolve()
            if not work.is_relative_to(releases.resolve()):
                raise ValueError('Temporary release directory escaped the release root.')
            record = {'schemaVersion': 1, 'version': version, 'releaseVersion': version.split('+')[0],
                      'archivedAt': datetime.now(timezone.utc).isoformat(), 'notes': notes,
                      'provenance': provenance or {}, 'artifacts': {}}
            for target, artifact in artifacts.items():
                stem = f'{PLUGIN}-{version}-{target}'
                archive_name = stem + '.zip'
                checksum_name = archive_name + '.sha256'
                build_name = stem + '.build.json'
                shutil.copyfile(artifact['path'], work / archive_name)
                if digest(work / archive_name) != artifact['sha256']:
                    raise ValueError(f'Archive changed while copying: {target}')
                (work / checksum_name).write_text(f'{artifact["sha256"]}  {archive_name}\n', encoding='ascii')
                metadata = dict(artifact['metadata'])
                metadata.pop('stagingRoot', None)
                metadata.pop('validationHistory', None)
                metadata.update(archive=archive_name, pluginVersion=version,
                                archiveVerification=artifact['checks'])
                write_json(work / build_name, metadata)
                record['artifacts'][target] = {
                    'archive': archive_name, 'checksum': checksum_name, 'buildRecord': build_name,
                    'sha256': artifact['sha256'], 'sizeBytes': artifact['sizeBytes'],
                    'dependencyMode': artifact['dependencyMode'],
                }
            (work / 'CHANGELOG.md').write_text(f'# {version}\n\n{notes}\n', encoding='utf-8')
            write_json(work / 'release.json', record)
            work.rename(destination)
        rebuild_index(releases)
    return destination


def notes_for_version(repo: Path, version: str) -> str:
    frozen = repo / 'dist/releases' / version / 'release.json'
    if frozen.is_file():
        return load_json(frozen)['notes']
    changelog = repo / 'CHANGELOG.md'
    if changelog.is_file():
        text = changelog.read_text(encoding='utf-8')
        pattern = r'^## ' + re.escape(version) + r'[^\n]*\n(.*?)(?=^## |\Z)'
        match = re.search(pattern, text, re.MULTILINE | re.DOTALL)
        if match and match.group(1).strip():
            return match.group(1).strip()
    raise ValueError(f'No release notes for {version}. Archive it with --notes before preparing another version.')


def prepare_release(repo: Path, summaries: list[str], helper: Path) -> str:
    summaries = [summary.strip() for summary in summaries if summary.strip()]
    if not summaries or any('\n' in summary or '\r' in summary for summary in summaries):
        raise ValueError('Provide one or more single-line --summary values.')
    if not helper.is_file():
        raise ValueError(f'Official cachebuster helper not found: {helper}; supply --helper.')
    source = repo / PLUGIN
    manifest_path = source / '.codex-plugin/plugin.json'
    original = manifest_path.read_bytes()
    manifest = load_json(manifest_path)
    previous = manifest['version']
    major, minor, patch, _ = version_key(previous)
    artifact_version, _ = inspect_artifacts(repo / 'dist')
    if artifact_version != previous:
        raise ValueError('A prepared version is not yet published; finish its matching packages before preparing another version.')
    archive_release(repo, repo / 'dist', notes_for_version(repo, previous))
    manifest['version'] = f'{major}.{minor}.{patch + 1}'
    try:
        write_json(manifest_path, manifest)
        result = subprocess.run([sys.executable, '-X', 'utf8', str(helper), str(source)],
                                capture_output=True, text=True, encoding='utf-8')
        if result.returncode:
            raise ValueError(result.stderr.strip() or result.stdout.strip())
        version = load_json(manifest_path)['version']
        if version_key(version)[:3] != (major, minor, patch + 1):
            raise ValueError('Cachebuster helper returned an unexpected release version.')
        changelog_path = repo / 'CHANGELOG.md'
        old = changelog_path.read_text(encoding='utf-8') if changelog_path.exists() else '# Changelog\n\n'
        first = re.search(r'^## ', old, re.MULTILINE)
        entry = f'## {version} — {datetime.now(timezone.utc).date().isoformat()}\n\n' + ''.join(f'- {summary}\n' for summary in summaries) + '\n'
        position = first.start() if first else len(old)
        changelog_path.write_text(old[:position] + entry + old[position:], encoding='utf-8')
    except BaseException:
        manifest_path.write_bytes(original)
        raise
    return version


def repack_artifact(repo: Path, target: str, template_info: dict, output_dir: Path) -> None:
    """Preserve the released runtime/installer and replace the complete static plugin source."""
    source = repo / PLUGIN
    manifest = load_json(source / '.codex-plugin/plugin.json')
    manifest.pop('mcpServers', None)
    version_key(manifest['version'])
    root = f'{PLUGIN}-{target}/'
    plugin_root = root + 'marketplace/plugins/' + PLUGIN + '/'
    replacements = {}
    for path in source.rglob('*'):
        if path.is_file():
            relative = path.relative_to(source).as_posix()
            if relative.startswith('runtime/'):
                raise ValueError('Runtime source changes require a full platform build, then publish without --repack.')
            replacements[plugin_root + relative] = path.read_bytes()
    replacements[plugin_root + '.codex-plugin/plugin.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    replacements[plugin_root + 'CHANGELOG.md'] = (repo / 'CHANGELOG.md').read_bytes()
    for relative, content in notice_files(repo).items():
        replacements[plugin_root + relative] = content
        replacements[root + relative] = content
    replacements[plugin_root + 'README.md'] = replacements[plugin_root + 'README.md'].replace(b'](../CHANGELOG.md)', b'](CHANGELOG.md)')
    for filename in ('README.md', 'CHANGELOG.md', 'LICENSE'):
        if filename == 'LICENSE' and not (source / filename).is_file():
            continue
        replacements[root + filename] = replacements[plugin_root + filename]
    output = output_dir / f'{PLUGIN}-{target}.zip'
    with zipfile.ZipFile(template_info['path']) as template:
        bundle = json.loads(template.read(root + 'bundle.json'))
        bundle['version'] = manifest['version']
        replacements[root + 'bundle.json'] = (json.dumps(bundle, indent=2) + '\n').encode()
        with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for info in template.infolist():
                is_static_plugin = info.filename.startswith(plugin_root) and not info.filename.startswith(plugin_root + 'runtime/')
                if is_static_plugin or info.filename in replacements:
                    continue
                with template.open(info) as original, archive.open(info, 'w') as copied:
                    shutil.copyfileobj(original, copied)
            for name, content in sorted(replacements.items()):
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, content)
    checksum = digest(output)
    output.with_suffix('.zip.sha256').write_text(f'{checksum}  {output.name}\n', encoding='ascii')
    metadata = dict(template_info['metadata'])
    old_validation = metadata.pop('validation', None)
    if old_validation:
        metadata.setdefault('validationHistory', []).append({
            'pluginVersion': template_info['version'], 'archiveSha256': template_info['sha256'],
            'validation': old_validation,
            'historicalValidationNote': HISTORICAL_VALIDATION_NOTE,
        })
    metadata.update(archive=str(output), sha256=checksum, sizeBytes=output.stat().st_size, pluginVersion=manifest['version'])
    write_json(output_dir / f'{PLUGIN}-{target}.build.json', metadata)


def materialize_release(repo: Path, snapshot: Path, output_dir: Path) -> None:
    record = load_json(snapshot / 'release.json')
    for target, artifact in record['artifacts'].items():
        archive = output_dir / f'{PLUGIN}-{target}.zip'
        shutil.copyfile(snapshot / artifact['archive'], archive)
        archive.with_suffix('.zip.sha256').write_text(f'{artifact["sha256"]}  {archive.name}\n', encoding='ascii')
        metadata = load_json(snapshot / artifact['buildRecord'])
        current_record = repo / 'dist' / f'{PLUGIN}-{target}.build.json'
        if current_record.is_file():
            local = load_json(current_record)
            for field in ('stagingRoot', 'validationHistory'):
                if field in local:
                    metadata[field] = local[field]
        metadata['archive'] = str(archive)
        write_json(output_dir / f'{PLUGIN}-{target}.build.json', metadata)


def record_validation(input_dir: Path, version: str, artifacts: dict) -> None:
    for target, artifact in artifacts.items():
        metadata_path = input_dir / f'{PLUGIN}-{target}.build.json'
        metadata = load_json(metadata_path)
        for historical in metadata.get('validationHistory', []):
            historical.setdefault('historicalValidationNote', HISTORICAL_VALIDATION_NOTE)
            historical_validation = historical.get('validation', {})
            if target == 'windows-x64' and historical_validation.get('scope') == LEGACY_VALIDATION_SCOPE:
                historical_validation['scope'] = validation_scope(target)
        metadata['validation'] = {
            'verifiedAt': datetime.now(timezone.utc).isoformat(), 'pluginVersion': version,
            'archiveSha256': artifact['sha256'], 'artifactChecks': artifact['checks'],
            'sourceAndArchiveConsistent': True, 'actualPlatformInstallTested': False,
            'actualLocalPluginUpdated': False, 'mcpInitializationTested': False,
            'modelingOrGenerationTested': False,
            'scope': validation_scope(target),
        }
        write_json(metadata_path, metadata)


def promote_latest(repo: Path, candidates: Path) -> None:
    # All candidates have already passed validation and have an immutable snapshot.
    # An interrupted copy can be resumed from that snapshot without rebuilding.
    for target in TARGETS:
        metadata_path = candidates / f'{PLUGIN}-{target}.build.json'
        metadata = load_json(metadata_path)
        metadata['archive'] = str(repo / 'dist' / f'{PLUGIN}-{target}.zip')
        write_json(metadata_path, metadata)
        for suffix in ('.zip', '.zip.sha256', '.build.json'):
            name = f'{PLUGIN}-{target}{suffix}'
            temporary = repo / 'dist' / ('.' + name + '.tmp')
            try:
                shutil.copyfile(candidates / name, temporary)
                temporary.replace(repo / 'dist' / name)
            finally:
                temporary.unlink(missing_ok=True)


def publish_current(repo: Path, repack: bool = False, freeform_runtime: Path | None = None) -> Path:
    license_review = verify_jszip(repo, freeform_runtime)
    source = repo / PLUGIN
    current = load_json(source / '.codex-plugin/plugin.json')['version']
    version_key(current)
    notes = notes_for_version(repo, current)
    frozen = repo / 'dist/releases' / current
    if frozen.is_dir() and not load_json(frozen / 'release.json').get('provenance', {}).get('jszipLicenseReview'):
        raise ValueError('Archived release lacks JSZip verification; preserve its history and prepare a new version.')
    if repack:
        with tempfile.TemporaryDirectory(prefix='.publish-', dir=repo / 'dist') as temporary:
            candidates = Path(temporary).resolve()
            if not candidates.is_relative_to((repo / 'dist').resolve()):
                raise ValueError('Candidate directory escaped the distribution root.')
            if frozen.is_dir():
                # Resume a completed archive or repair interrupted latest aliases.
                materialize_release(repo, frozen, candidates)
            else:
                previous, templates = inspect_artifacts(repo / 'dist')
                archive_release(repo, repo / 'dist', notes_for_version(repo, previous))
                for target in TARGETS:
                    repack_artifact(repo, target, templates[target], candidates)
            version, artifacts = inspect_artifacts(candidates, source)
            if version != current:
                raise ValueError('Candidate packages do not match the source version.')
            record_validation(candidates, version, artifacts)
            snapshot = archive_release(repo, candidates, notes, source,
                                       provenance={'jszipLicenseReview': license_review})
            promote_latest(repo, candidates)
            return snapshot
    version, artifacts = inspect_artifacts(repo / 'dist', source)
    if version != current:
        raise ValueError('Current source and built packages have different versions.')
    record_validation(repo / 'dist', version, artifacts)
    return archive_release(repo, repo / 'dist', notes, source,
                           provenance={'jszipLicenseReview': license_review})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    commands = parser.add_subparsers(dest='command', required=True)
    prepare = commands.add_parser('prepare', help='Preserve the previous release, increment patch, and write release notes.')
    prepare.add_argument('--summary', action='append', required=True)
    prepare.add_argument('--helper', type=Path, default=Path.home() / '.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py')
    publish = commands.add_parser('publish', help='Verify and archive the complete current release locally.')
    publish.add_argument('--repack', action='store_true', help='Refresh static plugin source and docs using the current ZIPs as runtime/installer templates.')
    publish.add_argument('--freeform-runtime', type=Path, required=True,
                         help='Installed Freeform directory containing package-lock.json and node_modules, for release-only JSZip verification.')
    archive = commands.add_parser('archive', help='Retain existing historical packages without changing their bytes.')
    archive.add_argument('--input', type=Path, required=True)
    archive.add_argument('--notes', type=Path, required=True)
    archive.add_argument('--provenance', type=Path)
    args = parser.parse_args()
    repo = args.repo.resolve()
    try:
        if args.command == 'prepare':
            print(prepare_release(repo, args.summary, args.helper.resolve()))
        elif args.command == 'publish':
            print(publish_current(repo, args.repack, args.freeform_runtime))
        else:
            provenance = load_json(args.provenance) if args.provenance else None
            print(archive_release(repo, args.input, args.notes.read_text(encoding='utf-8'), provenance=provenance))
    except (ValueError, OSError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
