import copy
import json
from pathlib import Path
import tempfile
import unittest

from third_party import notice_files, sha256, verify_jszip


def license_fixture(repo: Path, runtime: Path) -> Path:
    """Synthetic installed packages; no network or user plugin state is used."""
    files = notice_files(Path(__file__).resolve().parents[1])
    upstream = b'TEST_ONLY_SYNTHETIC_UPSTREAM_LICENSE\n' + files['licenses/jszip-3.10.2-MIT.txt']
    policy = json.loads(files['licenses/jszip.json'])
    policy['upstreamLicenseSha256'] = sha256(upstream)
    files['licenses/jszip.json'] = (json.dumps(policy, indent=2) + '\n').encode()
    for name, content in files.items():
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    freeform = {'name': 'freeform-modeling-mcp', 'version': '1.0.36',
                'dependencies': {'jszip': '^3.10.1'}}
    jszip = {'name': 'jszip', 'version': policy['version'], 'license': policy['licenseDeclared']}
    for package in (freeform, jszip):
        path = runtime / 'node_modules' / package['name']
        path.mkdir(parents=True, exist_ok=True)
        (path / 'package.json').write_text(json.dumps(package), encoding='utf-8')
    (runtime / 'node_modules/jszip/LICENSE.markdown').write_bytes(upstream)
    lock = {'lockfileVersion': 3, 'packages': {
        '': {'dependencies': {'freeform-modeling-mcp': freeform['version']}},
        'node_modules/freeform-modeling-mcp': {**freeform, 'integrity': 'TEST_ONLY_PACKAGE_INTEGRITY'},
        'node_modules/jszip': {**jszip, 'integrity': policy['packageIntegrity'], 'resolved': policy['packageUrl']},
    }}
    (runtime / 'package-lock.json').write_text(json.dumps(lock), encoding='utf-8')
    return runtime


class JsZipReleaseCheckTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='coohom-license-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.repo = self.root / 'repo'
        self.runtime = license_fixture(self.repo, self.root / 'installed')

    def change_lock(self, change):
        path = self.runtime / 'package-lock.json'
        lock = json.loads(path.read_bytes())
        change(lock['packages'])
        path.write_text(json.dumps(lock), encoding='utf-8')

    def test_reports_actual_versions_and_selection_without_mutating_runtime(self):
        before = {p: p.read_bytes() for p in self.runtime.rglob('*') if p.is_file()}
        report = verify_jszip(self.repo, self.runtime)
        self.assertEqual(report['freeform']['version'], '1.0.36')
        self.assertEqual(report['jszip'][0]['version'], '3.10.2')
        self.assertEqual(report['jszip'][0]['licenseConcluded'], 'MIT')
        self.assertEqual(report['lockfileSha256'], sha256((self.runtime / 'package-lock.json').read_bytes()))
        self.assertNotIn(str(self.runtime), json.dumps(report))
        self.assertEqual(before, {p: p.read_bytes() for p in self.runtime.rglob('*') if p.is_file()})

    def test_missing_runtime_cannot_be_a_release_verification(self):
        with self.assertRaisesRegex(ValueError, 'requires --freeform-runtime'):
            verify_jszip(self.repo, None)

    def test_nested_unreviewed_jszip_cannot_hide_behind_reviewed_root_package(self):
        nested = 'node_modules/other/node_modules/jszip'
        folder = self.runtime / nested
        folder.mkdir(parents=True)
        (folder / 'package.json').write_text(json.dumps({'name': 'jszip', 'version': '4.0.0'}))
        self.change_lock(lambda packages: packages.update({nested: {'version': '4.0.0'}}))
        with self.assertRaisesRegex(ValueError, 'Unreviewed'):
            verify_jszip(self.repo, self.runtime)

    def test_absent_lock_entry_requires_upstream_review(self):
        self.change_lock(lambda packages: packages.pop('node_modules/jszip'))
        with self.assertRaisesRegex(ValueError, 'removed or bundled'):
            verify_jszip(self.repo, self.runtime)

    def test_missing_or_changed_license_is_rejected(self):
        path = self.runtime / 'node_modules/jszip/LICENSE.markdown'
        path.write_bytes(path.read_bytes() + b'changed terms')
        with self.assertRaisesRegex(ValueError, 'license text changed'):
            verify_jszip(self.repo, self.runtime)
        path.unlink()
        with self.assertRaisesRegex(ValueError, 'Missing'):
            verify_jszip(self.repo, self.runtime)

    def test_gpl_only_declaration_is_rejected(self):
        self.change_lock(lambda packages: packages['node_modules/jszip'].update(license='GPL-3.0-or-later'))
        with self.assertRaisesRegex(ValueError, 'declaration changed'):
            verify_jszip(self.repo, self.runtime)

    def test_package_provenance_change_is_rejected(self):
        self.change_lock(lambda packages: packages['node_modules/jszip'].update(integrity='TEST_ONLY_OTHER_INTEGRITY'))
        with self.assertRaisesRegex(ValueError, 'provenance changed'):
            verify_jszip(self.repo, self.runtime)

    def test_freeform_manifest_and_lock_must_agree(self):
        self.change_lock(lambda packages: packages['node_modules/freeform-modeling-mcp'].update(version='2.0.0'))
        with self.assertRaisesRegex(ValueError, 'Freeform package'):
            verify_jszip(self.repo, self.runtime)

    def test_changed_shipped_notice_is_rejected(self):
        (self.repo / 'licenses/jszip-3.10.2-MIT.txt').write_text('incomplete notice')
        with self.assertRaisesRegex(ValueError, 'reviewed text'):
            verify_jszip(self.repo, self.runtime)

    def test_lockfile_cannot_read_packages_outside_the_installation(self):
        def add_escaping(packages):
            packages['../node_modules/jszip'] = copy.deepcopy(packages['node_modules/jszip'])
        self.change_lock(add_escaping)
        with self.assertRaisesRegex(ValueError, 'Invalid installed package path'):
            verify_jszip(self.repo, self.runtime)


if __name__ == '__main__':
    unittest.main()
