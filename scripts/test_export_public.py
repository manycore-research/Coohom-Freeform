import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch

from export_public import export, export_release
from test_third_party import license_fixture
from third_party import notice_files, sha256


class PublicExportTest(unittest.TestCase):
    def test_public_export_includes_root_release_history(self):
        repo = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'source.zip'
            export(repo, output)
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(archive.read('CHANGELOG.md'), (repo / 'CHANGELOG.md').read_bytes())
                self.assertNotIn('coohom-freeform/CHANGELOG.md', archive.namelist())
                for name, content in notice_files(repo).items():
                    self.assertEqual(archive.read(name).replace(b'\r\n', b'\n'), content)

    def test_release_export_verifies_before_writing_and_binds_report_to_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / 'repo'
            runtime = license_fixture(repo, root / 'installed')
            (repo / 'public-source.json').write_text(json.dumps({'include': ['THIRD_PARTY.md', 'licenses']}))
            output = root / 'source.zip'
            with patch('prepare_marketplace.check') as check:
                export_release(repo, output, runtime)
            check.assert_called_once_with(repo)
            report_path = output.with_suffix('.zip.licenses.json')
            report = json.loads(report_path.read_bytes())
            self.assertEqual(report['sourceArchiveSha256'], sha256(output.read_bytes()))
            self.assertEqual(report['jszip'][0]['licenseConcluded'], 'MIT')
            before = output.read_bytes(), report_path.read_bytes()
            (runtime / 'node_modules/jszip/LICENSE.markdown').write_text('changed')
            with patch('prepare_marketplace.check'):
                with self.assertRaisesRegex(ValueError, 'license text changed'):
                    export_release(repo, output, runtime)
            self.assertEqual((output.read_bytes(), report_path.read_bytes()), before)

    def test_exports_source_without_history_old_packages_or_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            (repo / 'src').mkdir()
            (repo / 'src/main.py').write_bytes(b'print("hello")\n')
            (repo / 'src/.env').write_text('SECRET=fixture', encoding='utf-8')
            (repo / '.git').mkdir()
            (repo / '.git/config').write_text('private history', encoding='utf-8')
            (repo / 'old.zip').write_bytes(b'old internal package')
            (repo / 'public-source.json').write_text(json.dumps({'include': ['src']}), encoding='utf-8')
            output = repo / 'dist/source.zip'
            self.assertEqual(export(repo, output), 1)
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(archive.namelist(), ['src/main.py'])
                self.assertEqual(archive.read('src/main.py'), b'print("hello")\n')
            self.assertTrue(output.with_suffix('.zip.sha256').is_file())

    def test_missing_declared_source_is_an_error(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            (repo / 'public-source.json').write_text(json.dumps({'include': ['missing']}), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Missing public source'):
                export(repo, repo / 'source.zip')

    def test_marketplace_shell_entry_remains_executable_in_source_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            entry = repo / 'plugins/coohom-freeform/scripts/bootstrap'
            entry.parent.mkdir(parents=True)
            entry.write_bytes(b'#!/bin/sh\nexit 0\n')
            manager = entry.with_name('manage')
            manager.write_bytes(b'#!/bin/sh\nexit 0\n')
            (repo / 'public-source.json').write_text(json.dumps({'include': ['plugins']}), encoding='utf-8')
            output = repo / 'source.zip'
            export(repo, output)
            with zipfile.ZipFile(output) as archive:
                info = archive.getinfo(entry.relative_to(repo).as_posix())
                self.assertEqual(info.create_system, 3)
                self.assertEqual((info.external_attr >> 16) & 0o777, 0o755)
                self.assertEqual(archive.read(info), b'#!/bin/sh\nexit 0\n')
                self.assertEqual((archive.getinfo(manager.relative_to(repo).as_posix()).external_attr >> 16) & 0o777, 0o755)


if __name__ == '__main__':
    unittest.main()
