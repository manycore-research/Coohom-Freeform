import json
from pathlib import Path
import tempfile
import unittest

from prepare_marketplace import expected_files, check, RUNTIME_FILES
from third_party import notice_files


class MarketplaceTest(unittest.TestCase):
    def test_checked_in_plugin_matches_canonical_sources(self):
        check(Path(__file__).resolve().parents[1])

    def test_project_license_is_carried_by_the_installable_plugin(self):
        repo = Path(__file__).resolve().parents[1]
        self.assertEqual(expected_files(repo)['LICENSE'], (repo / 'LICENSE').read_bytes().replace(b'\r\n', b'\n'))

    def test_root_changelog_is_carried_with_a_local_plugin_link(self):
        repo = Path(__file__).resolve().parents[1]
        files = expected_files(repo)
        self.assertEqual(files['CHANGELOG.md'], (repo / 'CHANGELOG.md').read_bytes().replace(b'\r\n', b'\n'))
        self.assertIn(b'](CHANGELOG.md)', files['README.md'])
        self.assertNotIn(b'](../CHANGELOG.md)', files['README.md'])

    def test_installable_plugin_carries_canonical_third_party_notices(self):
        repo = Path(__file__).resolve().parents[1]
        files = expected_files(repo)
        for name, content in notice_files(repo).items():
            self.assertEqual(files[name], content)

    def test_generated_config_is_portable_and_has_both_services(self):
        repo = Path(__file__).resolve().parents[1]
        files = expected_files(repo)
        config = json.loads(files['.mcp.json'])['mcpServers']
        self.assertEqual(set(config), {'freeform-modeling-mcp', 'lux3d-mcp-server'})
        self.assertNotIn('LUX3D_MCP_EXECUTOR_URL', config['lux3d-mcp-server']['env_vars'])
        for server in config.values():
            self.assertEqual(server['command'], './scripts/bootstrap')
            self.assertEqual(server['cwd'], '.')
            self.assertEqual(server['startup_timeout_sec'], 1200)
        for name in RUNTIME_FILES:
            self.assertEqual(files['scripts/mcp/' + name], (repo / 'bundler' / name).read_bytes().replace(b'\r\n', b'\n'))

    def test_check_rejects_missing_generated_launcher(self):
        repo = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temporary:
            from unittest.mock import patch
            expected = expected_files(repo)
            with patch('prepare_marketplace.expected_files', return_value=expected):
                with self.assertRaisesRegex(ValueError, 'stale'):
                    check(Path(temporary))

    def test_policy_matches_existing_zip_node_version(self):
        import sys
        repo = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(repo / 'bundler'))
        import build
        rows = (repo / 'bundler/marketplace/node-runtime.tsv').read_text().splitlines()
        self.assertEqual(rows[0].split('\t'), ['version', build.NODE_VERSION])
        self.assertEqual({row.split('\t')[0] for row in rows[1:]}, {'win32-x64', 'darwin-arm64'})


if __name__ == '__main__':
    unittest.main()
