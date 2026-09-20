"""Behavior checks for immutable, validated release downloads; never run installers."""

import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import unquote, urlsplit
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import release
from release import archive_release, publish_current
from third_party import notice_files
from test_third_party import license_fixture


TARGETS = {
    "windows-x64": ("win32", "x64", "Install.cmd", "node.exe"),
    "macos-arm64": ("darwin", "arm64", "Install.command", "bin/node"),
}
OLD_VERSION = "0.1.9+codex.20260913090000"
NEW_VERSION = "0.1.10+codex.20260913100000"
PLUGIN_PREFIX = "marketplace/plugins/coohom-freeform/"


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def plugin_files(version, body="A room modeling skill.\n"):
    return {
        ".codex-plugin/plugin.json": json_bytes({"name": "coohom-freeform", "version": version}),
        "skills/coohom-freeform/SKILL.md": body.encode("utf-8"),
        "README.md": "# Coohom\n\n安装与使用说明。\n".encode("utf-8"),
    }


class ReleaseArchiveTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="coohom-release-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        changelog = self.repo / "CHANGELOG.md"
        changelog.write_text("# Release history\n", encoding="utf-8")
        (self.root / "CHANGELOG.md").write_bytes(changelog.read_bytes())
        self.runtime = license_fixture(self.repo, self.root / 'installed')
        for name, content in notice_files(self.repo).items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)

    @property
    def releases(self):
        return self.repo / "dist" / "releases"

    def write_inputs(self, directory, version, *, mac_version=None, body=None):
        directory.mkdir(parents=True, exist_ok=True)
        for target, (platform, arch, entrypoint, node_path) in TARGETS.items():
            target_version = mac_version if target == "macos-arm64" and mac_version else version
            root = f"coohom-freeform-{target}/"
            files = {
                f"{PLUGIN_PREFIX}{name}": data
                for name, data in plugin_files(target_version, body or "A room modeling skill.\n").items()
            }
            files.update({
                "CHANGELOG.md": (self.repo / "CHANGELOG.md").read_bytes(),
                f"{PLUGIN_PREFIX}CHANGELOG.md": (self.repo / "CHANGELOG.md").read_bytes(),
                "bundle.json": json_bytes({
                    "version": target_version, "platform": platform, "arch": arch,
                    "pluginName": "coohom-freeform", "marketplaceName": "coohom-freeform-local",
                }),
                "install.mjs": b"// fixture installer; deliberately never executed\n",
                entrypoint: b"fixture entrypoint\n",
                f"{PLUGIN_PREFIX}runtime/node/{node_path}": b"fixture-node-runtime",
                f"{PLUGIN_PREFIX}runtime/node/npm/bin/npm-cli.js": b"// fixture npm\n",
            })
            for name, content in notice_files(self.repo).items():
                files[name] = content
                files[PLUGIN_PREFIX + name] = content
            archive = directory / f"coohom-freeform-{target}.zip"
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as bundle:
                for name, data in sorted(files.items()):
                    info = zipfile.ZipInfo(root + name, date_time=(2026, 9, 13, 0, 0, 0))
                    info.create_system = 3
                    info.external_attr = 0o100755 << 16
                    bundle.writestr(info, data)
            self.update_checksums(archive, platform, arch, target_version)
        return directory

    def update_checksums(self, archive, platform=None, arch=None, version=None):
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        archive.with_suffix(".zip.sha256").write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
        record_path = archive.with_suffix(".build.json")
        record = json.loads(record_path.read_text(encoding="utf-8")) if record_path.exists() else {
            "platform": platform, "arch": arch, "pluginVersion": version,
        }
        record.update({"sha256": digest, "sizeBytes": archive.stat().st_size})
        record_path.write_bytes(json_bytes(record))

    def archive(self, inputs, notes="新增版本归档与下载入口。", **kwargs):
        return archive_release(self.repo, inputs, notes, **kwargs)

    def snapshot(self, directory):
        return {
            path.relative_to(directory).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in directory.rglob("*") if path.is_file()
        }

    def assert_no_release(self, version):
        self.assertFalse((self.releases / version).exists())
        index = self.releases / "index.json"
        if index.exists():
            self.assertNotIn(version, index.read_text(encoding="utf-8"))

    def test_successive_versions_keep_old_downloads_and_latest_is_semantic(self):
        first = self.archive(self.write_inputs(self.root / "first", OLD_VERSION), "旧版本说明。")
        self.assertEqual(first.resolve(), (self.releases / OLD_VERSION).resolve())
        previous = self.snapshot(first)
        second = self.archive(self.write_inputs(self.root / "second", NEW_VERSION), "新版本说明。")
        self.assertEqual(second.resolve(), (self.releases / NEW_VERSION).resolve())
        self.assertEqual(previous, self.snapshot(first), "Publishing must preserve earlier downloads")
        for release in (first, second):
            archives = list(release.glob("*.zip"))
            self.assertEqual(len(archives), 2)
            self.assertTrue((release / "release.json").is_file())
            self.assertTrue((release / "CHANGELOG.md").is_file())
            for archive in archives:
                self.assertIn(release.name, archive.name)
                checksum = archive.with_suffix(".zip.sha256").read_text(encoding="utf-8").strip().split()
                self.assertEqual(checksum[0], hashlib.sha256(archive.read_bytes()).hexdigest())
                self.assertEqual(checksum[1].lstrip("*"), archive.name)
                self.assertTrue(archive.with_suffix(".build.json").is_file())
        index = json.loads((self.releases / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(index["latest"], NEW_VERSION)
        self.assertEqual({entry["version"] for entry in index["releases"]}, {OLD_VERSION, NEW_VERSION})

    def test_download_links_resolve_to_real_archived_files(self):
        self.archive(self.write_inputs(self.root / "first", OLD_VERSION))
        self.archive(self.write_inputs(self.root / "second", NEW_VERSION))
        readme = self.releases / "README.md"
        links = re.findall(r"\[[^\]]+\]\(([^)]+)\)", readme.read_text(encoding="utf-8"))
        downloads = []
        for href in links:
            parsed = urlsplit(href.strip("<>"))
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            destination = (readme.parent / unquote(parsed.path)).resolve()
            self.assertTrue(destination.is_file(), f"Broken release link: {href}")
            if destination.suffix == ".zip":
                downloads.append(destination)
        self.assertEqual(len(set(downloads)), 4, "Both platforms of both versions must be selectable")

    def test_checksum_mismatch_cannot_publish(self):
        inputs = self.write_inputs(self.root / "inputs", OLD_VERSION)
        checksum = inputs / "coohom-freeform-windows-x64.zip.sha256"
        checksum.write_text("0" * 64 + "  coohom-freeform-windows-x64.zip\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.archive(inputs)
        self.assert_no_release(OLD_VERSION)

    def test_cross_platform_version_mismatch_cannot_publish(self):
        inputs = self.write_inputs(self.root / "inputs", OLD_VERSION, mac_version=NEW_VERSION)
        with self.assertRaises(ValueError):
            self.archive(inputs)
        self.assert_no_release(OLD_VERSION)
        self.assert_no_release(NEW_VERSION)

    def test_bundle_and_manifest_version_mismatch_cannot_publish(self):
        inputs = self.write_inputs(self.root / "inputs", OLD_VERSION)
        archive = inputs / "coohom-freeform-windows-x64.zip"
        with zipfile.ZipFile(archive) as bundle:
            members = [(item, bundle.read(item)) for item in bundle.infolist()]
        with zipfile.ZipFile(archive, "w") as bundle:
            for item, data in members:
                if item.filename.endswith("/bundle.json"):
                    metadata = json.loads(data)
                    metadata["version"] = NEW_VERSION
                    data = json_bytes(metadata)
                bundle.writestr(item, data)
        self.update_checksums(archive)
        with self.assertRaises(ValueError):
            self.archive(inputs)
        self.assert_no_release(OLD_VERSION)
        self.assert_no_release(NEW_VERSION)

    def test_crc_corruption_cannot_publish_even_with_matching_external_hash(self):
        inputs = self.write_inputs(self.root / "inputs", OLD_VERSION)
        archive = inputs / "coohom-freeform-windows-x64.zip"
        original = archive.read_bytes()
        self.assertIn(b"fixture-node-runtime", original)
        archive.write_bytes(original.replace(b"fixture-node-runtime", b"broken!-node-runtime", 1))
        self.update_checksums(archive)
        with self.assertRaises((ValueError, zipfile.BadZipFile)):
            self.archive(inputs)
        self.assert_no_release(OLD_VERSION)

    def test_repeating_identical_release_is_idempotent(self):
        inputs = self.write_inputs(self.root / "inputs", OLD_VERSION)
        output = self.archive(inputs)
        before = self.snapshot(self.releases)
        self.assertEqual(self.archive(inputs), output)
        self.assertEqual(self.snapshot(self.releases), before)

    def test_existing_version_rejects_changed_package_or_notes_without_overwrite(self):
        inputs = self.write_inputs(self.root / "inputs", OLD_VERSION)
        self.archive(inputs)
        before = self.snapshot(self.releases)
        with self.assertRaises(ValueError):
            self.archive(inputs, "同版本修改后的发布说明。")
        self.assertEqual(self.snapshot(self.releases), before)
        changed = self.write_inputs(self.root / "changed", OLD_VERSION, body="Different skill behavior.\n")
        with self.assertRaises(ValueError):
            self.archive(changed)
        self.assertEqual(self.snapshot(self.releases), before)

    def prepare_publication(self):
        """Start with a shipped old release and a complete next-version source tree."""
        inputs = self.write_inputs(self.repo / "dist", OLD_VERSION)
        for target in TARGETS:
            archive = inputs / f"coohom-freeform-{target}.zip"
            with zipfile.ZipFile(archive, "a") as bundle:
                bundle.writestr(
                    f"coohom-freeform-{target}/{PLUGIN_PREFIX}skills/coohom-freeform/obsolete.md",
                    b"Retired instructions that must disappear from the next release.\n",
                )
            self.update_checksums(archive)
        self.archive(inputs, "旧版本说明。")
        source = self.repo / "coohom-freeform"
        for relative, data in plugin_files(NEW_VERSION, "Updated skill behavior.\n").items():
            path = source / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        (self.repo / "CHANGELOG.md").write_text(
            f"# 更新日志\n\n## {NEW_VERSION} — 2026-09-13\n\n- 更新技能并移除旧指令。\n",
            encoding="utf-8",
        )
        with (source / "README.md").open("a", encoding="utf-8") as stream:
            stream.write("\n[Changelog](../CHANGELOG.md)\n")
        return source

    def latest_hashes(self):
        return {
            path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (self.repo / "dist").glob("coohom-freeform-*") if path.is_file()
        }

    def test_repack_removes_deleted_source_files_and_keeps_runtime(self):
        source = self.prepare_publication()
        historical = self.snapshot(self.releases / OLD_VERSION)
        published = publish_current(self.repo, repack=True, freeform_runtime=self.runtime)
        self.assertEqual(published.name, NEW_VERSION)
        record = json.loads((published / 'release.json').read_bytes())
        self.assertEqual(record['provenance']['jszipLicenseReview']['jszip'][0]['licenseConcluded'], 'MIT')
        self.assertEqual(self.snapshot(self.releases / OLD_VERSION), historical)
        for target, (_, _, _, node_path) in TARGETS.items():
            archive = self.repo / "dist" / f"coohom-freeform-{target}.zip"
            root = f"coohom-freeform-{target}/"
            with zipfile.ZipFile(archive) as bundle:
                for name, content in notice_files(self.repo).items():
                    self.assertEqual(bundle.read(root + name), content)
                    self.assertEqual(bundle.read(root + PLUGIN_PREFIX + name), content)
                self.assertNotIn(root + PLUGIN_PREFIX + "skills/coohom-freeform/obsolete.md", bundle.namelist())
                self.assertEqual(
                    bundle.read(root + PLUGIN_PREFIX + "runtime/node/" + node_path),
                    b"fixture-node-runtime",
                )
                for relative in ("README.md", "CHANGELOG.md"):
                    canonical = self.repo / relative if relative == "CHANGELOG.md" else source / relative
                    expected = canonical.read_bytes().replace(b'](../CHANGELOG.md)', b'](CHANGELOG.md)')
                    self.assertEqual(bundle.read(root + relative), expected)
                self.assertEqual(bundle.read(root + PLUGIN_PREFIX + "CHANGELOG.md"), (self.repo / "CHANGELOG.md").read_bytes())
                self.assertEqual(
                    bundle.read(root + PLUGIN_PREFIX + "skills/coohom-freeform/SKILL.md"),
                    (source / "skills/coohom-freeform/SKILL.md").read_bytes(),
                )

    def test_repack_records_platform_specific_validation_scope(self):
        self.prepare_publication()
        publish_current(self.repo, repack=True, freeform_runtime=self.runtime)

        windows = json.loads((self.repo / "dist" / "coohom-freeform-windows-x64.build.json").read_text())
        macos = json.loads((self.repo / "dist" / "coohom-freeform-macos-arm64.build.json").read_text())

        self.assertNotIn("macOS executable permissions", windows["validation"]["scope"])
        self.assertIn("macOS executable permissions", macos["validation"]["scope"])

    def test_repack_labels_previous_release_checks_as_history(self):
        self.prepare_publication()
        old_record_path = self.repo / "dist" / "coohom-freeform-windows-x64.build.json"
        old_record = json.loads(old_record_path.read_text())
        old_record["validation"] = {
            "pluginVersion": OLD_VERSION,
            "archiveSha256": old_record["sha256"],
            "scope": "ZIP integrity, SHA256/build metadata, complete installer structure, exact static plugin source file set and contents, bundle-root changelog and macOS executable permissions. No platform installer execution or full unchanged-runtime comparison.",
        }
        old_record_path.write_bytes(json_bytes(old_record))
        publish_current(self.repo, repack=True, freeform_runtime=self.runtime)
        current = json.loads((self.repo / "dist" / "coohom-freeform-windows-x64.build.json").read_text())
        historical = current["validationHistory"][-1]

        self.assertEqual(historical["pluginVersion"], OLD_VERSION)
        self.assertEqual(historical["archiveSha256"], old_record["sha256"])
        self.assertNotEqual(historical["archiveSha256"], current["sha256"])
        self.assertIn("previous release artifact", historical["historicalValidationNote"])
        self.assertNotIn("macOS executable permissions", historical["validation"]["scope"])

    def test_second_platform_failure_preserves_latest_pair_and_retry_can_publish(self):
        self.prepare_publication()
        previous = self.latest_hashes()
        history = self.snapshot(self.releases)
        repack_one = release.repack_artifact
        calls = []

        def fail_second(repo, target, template_info, output_dir):
            calls.append(target)
            if len(calls) == 2:
                raise ValueError("Simulated second-platform candidate failure")
            return repack_one(repo, target, template_info, output_dir)

        with patch.object(release, "repack_artifact", side_effect=fail_second):
            with self.assertRaisesRegex(ValueError, "second-platform"):
                publish_current(self.repo, repack=True, freeform_runtime=self.runtime)
        self.assertEqual(len(calls), 2, "First candidate must finish before the injected failure")
        self.assertEqual(self.latest_hashes(), previous)
        self.assertEqual(self.snapshot(self.releases), history)
        self.assert_no_release(NEW_VERSION)
        published = publish_current(self.repo, repack=True, freeform_runtime=self.runtime)
        self.assertEqual(published.name, NEW_VERSION)
        self.assertNotEqual(self.latest_hashes(), previous)
        for target in TARGETS:
            with zipfile.ZipFile(self.repo / "dist" / f"coohom-freeform-{target}.zip") as bundle:
                manifest = json.loads(bundle.read(
                    f"coohom-freeform-{target}/{PLUGIN_PREFIX}.codex-plugin/plugin.json"
                ))
                self.assertEqual(manifest["version"], NEW_VERSION)

    def test_repack_of_already_archived_version_reuses_identical_packages(self):
        self.prepare_publication()
        published = publish_current(self.repo, repack=True, freeform_runtime=self.runtime)
        previous = self.latest_hashes()
        history = self.snapshot(self.releases)
        with patch.object(release, "repack_artifact", side_effect=AssertionError("Archived bytes should be reused")):
            repeated = publish_current(self.repo, repack=True, freeform_runtime=self.runtime)
        self.assertEqual(repeated, published)
        # Revalidation may refresh latest build evidence; download bytes stay immutable.
        for name, digest in previous.items():
            if not name.endswith(".build.json"):
                self.assertEqual(self.latest_hashes()[name], digest)
        self.assertEqual(self.snapshot(self.releases), history)

    def test_source_mismatch_cannot_publish(self):
        inputs = self.write_inputs(self.root / "inputs", OLD_VERSION)
        source = self.root / "source"
        for relative, data in plugin_files(OLD_VERSION, "Unpackaged source update.\n").items():
            path = source / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        with self.assertRaises(ValueError):
            self.archive(inputs, source_dir=source)
        self.assert_no_release(OLD_VERSION)

    def test_license_failure_preserves_latest_artifacts_and_history(self):
        self.prepare_publication()
        previous = self.latest_hashes()
        history = self.snapshot(self.releases)
        (self.runtime / 'node_modules/jszip/LICENSE.markdown').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'license text changed'):
            publish_current(self.repo, repack=True, freeform_runtime=self.runtime)
        self.assertEqual(previous, self.latest_hashes())
        self.assertEqual(history, self.snapshot(self.releases))
        self.assert_no_release(NEW_VERSION)

    def test_publish_without_actual_dependencies_is_rejected(self):
        self.prepare_publication()
        with self.assertRaisesRegex(ValueError, 'requires --freeform-runtime'):
            publish_current(self.repo, repack=True)

    def test_unverified_historical_archive_cannot_be_relabelled_as_verified(self):
        self.prepare_publication()
        inputs = self.write_inputs(self.root / 'unverified', NEW_VERSION)
        self.archive(inputs, release.notes_for_version(self.repo, NEW_VERSION))
        history = self.snapshot(self.releases)
        with self.assertRaisesRegex(ValueError, 'Archived release lacks JSZip verification'):
            publish_current(self.repo, repack=True, freeform_runtime=self.runtime)
        self.assertEqual(history, self.snapshot(self.releases))

    def test_prepare_writes_root_changelog_and_preserves_history(self):
        source = self.repo / "coohom-freeform"
        for relative, data in plugin_files(OLD_VERSION).items():
            path = source / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        previous = f"# Changelog\n\n## {OLD_VERSION}\n\n- Previous release.\n"
        (self.repo / "CHANGELOG.md").write_text(previous, encoding="utf-8")
        self.write_inputs(self.repo / "dist", OLD_VERSION)
        helper = self.root / "cachebuster.py"
        helper.write_text(
            "import json, pathlib, sys\n"
            "p = pathlib.Path(sys.argv[1]) / '.codex-plugin/plugin.json'\n"
            "data = json.loads(p.read_text())\n"
            f"data['version'] = {NEW_VERSION!r}\n"
            "p.write_text(json.dumps(data))\n", encoding="utf-8")
        self.assertEqual(release.prepare_release(self.repo, ["Moved release history."], helper), NEW_VERSION)
        changelog = (self.repo / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertIn(f"## {NEW_VERSION}", changelog)
        self.assertIn("- Moved release history.", changelog)
        self.assertTrue(changelog.endswith(previous.split("\n\n", 1)[1]))
        self.assertFalse((source / "CHANGELOG.md").exists())

    def test_matching_source_allows_semantically_identical_manifest(self):
        inputs = self.write_inputs(self.root / "inputs", OLD_VERSION)
        source = self.root / "source"
        for relative, data in plugin_files(OLD_VERSION).items():
            path = source / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        manifest = source / ".codex-plugin" / "plugin.json"
        manifest.write_text(json.dumps({"version": OLD_VERSION, "name": "coohom-freeform"}), encoding="utf-8")
        release = self.archive(inputs, source_dir=source)
        self.assertTrue((release / "release.json").is_file())


if __name__ == "__main__":
    unittest.main()
