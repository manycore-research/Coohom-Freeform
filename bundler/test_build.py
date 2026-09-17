"""Verify ZIP contents survive filesystem path limits without leaking host paths."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import build
from build import archive_bundle, bundled_node


class ArchiveBundleTest(unittest.TestCase):
    def test_all_files_survive_long_source_paths(self):
        temporary = Path(tempfile.mkdtemp(prefix="coohom-archive-test-"))
        filesystem_temporary = Path("\\\\?\\" + str(temporary)) if os.name == "nt" else temporary
        # The cleanup target is the exact directory created by this test.
        self.assertEqual(temporary.parent.resolve(), Path(tempfile.gettempdir()).resolve())
        self.addCleanup(shutil.rmtree, filesystem_temporary)
        root = temporary / "coohom-freeform-windows-x64"
        filesystem_root = filesystem_temporary / root.name
        filesystem_root.mkdir()

        boundary_directory = "b" * (260 - len(str(root)) - len("/asset.bin") - 1)
        long_directory = "/".join(["nested-" + "x" * 48] * 5)
        files = {
            "short.txt": b"ordinary file\n",
            f"{boundary_directory}/asset.bin": bytes(range(256)),
            f"{long_directory}/model-dependency.js": b"export const asset = 'complete';\n",
        }
        self.assertEqual(len(str(root / boundary_directory / "asset.bin")), 260)
        self.assertGreater(len(str(root / long_directory / "model-dependency.js")), 300)
        for relative, contents in files.items():
            source = filesystem_root / relative
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_bytes(contents)

        output = temporary / "bundle.zip"
        digest = archive_bundle(root, output)
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(set(archive.namelist()), {f"{root.name}/{name}" for name in files})
            for relative, contents in files.items():
                self.assertEqual(archive.read(f"{root.name}/{relative}"), contents)
            self.assertIsNone(archive.testzip())
            self.assertTrue(all("\\" not in name and ":" not in name for name in archive.namelist()))
        self.assertEqual(digest, hashlib.sha256(output.read_bytes()).hexdigest())


    def test_distribution_excludes_installed_mcps_but_keeps_installers_and_npm(self):
        with tempfile.TemporaryDirectory(prefix="coohom-distribution-test-") as temporary:
            root = Path(temporary) / "coohom-freeform-windows-x64"
            root.mkdir()
            plugin = "marketplace/plugins/coohom-freeform/"
            keep = {
                plugin + "runtime/node/npm/bin/npm-cli.js": b"npm entry",
                plugin + "runtime/node/npm/node_modules/dependency/index.js": b"npm dependency",
                plugin + "runtime/mcp/package-lock.json": b"base lock",
                plugin + "skills/coohom-freeform/references/freeform-install.json": b"unrelated reference",
                "docs/lux3d-install.json": b"unrelated documentation",
                "install.mjs": b"installer",
            }
            keep.update({plugin + "runtime/mcp/" + name: name.encode() for name in build.MCP_RUNTIME_FILES})
            keep.update({name: name.encode() for name in build.INSTALL_HELPERS})
            exclude = {}
            for name in ("freeform", "lux3d"):
                for prefix in ("", plugin):
                    exclude.update({
                        prefix + f"runtime/mcp/{name}/install-old/package-lock.json": b"old installed dependencies",
                        prefix + f"runtime/mcp/{name}/install-new/node_modules/package/index.js": b"private installed runtime",
                        prefix + f"runtime/mcp/{name}-install.json": b"current user installation state",
                        prefix + f"runtime/mcp/.{name}-install-pending.json": b"interrupted installation",
                        prefix + f"runtime/mcp/.{name}-update.lock": b"active user updater",
                    })
            for relative, content in {**keep, **exclude}.items():
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
            output = Path(temporary) / "bundle.zip"
            archive_bundle(root, output)
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(set(archive.namelist()), {f"{root.name}/{name}" for name in keep})
                for relative, content in keep.items():
                    self.assertEqual(archive.read(f"{root.name}/{relative}"), content)
                self.assertIsNone(archive.testzip())


class BundledNodeTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="coohom-node-runtime-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.downloads = self.root / "downloads"
        self.downloads.mkdir()
        self.addCleanup(patch.stopall)
        patch("build.HERE", self.root).start()
        self.download = patch("build.download", side_effect=self.cached_download).start()

    def cached_download(self, url, target):
        self.assertTrue(url.startswith(f"https://nodejs.org/dist/v{build.NODE_VERSION}/"))
        self.assertTrue(target.is_file(), "tests must never download runtime archives")

    def make_archive(self, target, extras=(), omit_cli=False):
        node_os, arch, extension, _ = build.PLATFORMS[target]
        base = f"node-v{build.NODE_VERSION}-{node_os}-{arch}"
        filename = f"{base}.{extension}"
        npm_prefix = "node_modules/npm/" if extension == "zip" else "lib/node_modules/npm/"
        binary = "node.exe" if extension == "zip" else "bin/node"
        npm_files = {
            "package.json": b'{"name":"npm","version":"10.9.4"}\n',
            "bin/npm-cli.js": b"require('../lib/cli.js')(process);\n",
            "lib/cli.js": b"module.exports = process => process;\n",
            "node_modules/dependency/index.js": b"module.exports = {};\n",
            "LICENSE": b"npm license\n",
        }
        if omit_cli:
            npm_files.pop("bin/npm-cli.js")
        entries = [(binary, b"node binary", "file"), ("LICENSE", b"node license", "file"),
                   ("include/node/header.h", b"not needed", "file")]
        entries += [(npm_prefix + name, contents, "file") for name, contents in npm_files.items()]
        entries += [(npm_prefix + name, contents, kind) for name, contents, kind in extras]
        archive = self.downloads / filename
        if extension == "zip":
            with zipfile.ZipFile(archive, "w") as stream:
                for name, contents, kind in entries:
                    member = zipfile.ZipInfo(f"{base}/{name}")
                    # ZipInfo normalizes backslashes on Windows; retain the raw
                    # archive name so malformed input exercises our validation.
                    member.filename = f"{base}/{name}"
                    member.create_system = 3
                    member.external_attr = ((stat.S_IFLNK | 0o777) if kind != "file"
                                            else (stat.S_IFREG | 0o755)) << 16
                    stream.writestr(member, contents)
        else:
            with tarfile.open(archive, "w:gz") as stream:
                for name, contents, kind in entries:
                    member = tarfile.TarInfo(f"{base}/{name}")
                    member.mode = 0o755
                    if kind == "file":
                        member.size = len(contents)
                        stream.addfile(member, io.BytesIO(contents))
                    else:
                        member.type = tarfile.SYMTYPE if kind == "symlink" else tarfile.LNKTYPE
                        member.linkname = contents.decode()
                        stream.addfile(member)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        (self.downloads / f"node-v{build.NODE_VERSION}-SHASUMS256.txt").write_text(
            f"{digest}  {filename}\n", encoding="utf-8")
        return binary, npm_files, digest, filename

    def test_extracts_complete_npm_with_node_license_and_provenance_on_both_platforms(self):
        for target in ("win32-x64", "darwin-arm64"):
            with self.subTest(target=target):
                binary, npm_files, digest, filename = self.make_archive(target)
                runtime = self.root / target
                bundled_node(runtime, target)
                node_root = runtime / "node"
                self.assertEqual((node_root / binary).read_bytes(), b"node binary")
                self.assertEqual((node_root / "LICENSE").read_bytes(), b"node license")
                for relative, contents in npm_files.items():
                    self.assertEqual((node_root / "npm" / relative).read_bytes(), contents)
                self.assertFalse((node_root / "include").exists())
                self.assertEqual(json.loads((node_root / "provenance.json").read_text()), {
                    "version": build.NODE_VERSION,
                    "url": f"https://nodejs.org/dist/v{build.NODE_VERSION}/{filename}",
                    "sha256": digest,
                })
                if os.name != "nt" and target == "darwin-arm64":
                    self.assertTrue((node_root / binary).stat().st_mode & 0o111)

    def test_skips_symlinks_and_hardlinks_on_both_platforms(self):
        for target in ("win32-x64", "darwin-arm64"):
            with self.subTest(target=target):
                self.make_archive(target, extras=[
                    ("linked-cli.js", b"bin/npm-cli.js", "symlink"),
                    ("linked-package.json", b"package.json", "hardlink"),
                ])
                runtime = self.root / target
                bundled_node(runtime, target)
                self.assertFalse((runtime / "node/npm/linked-cli.js").exists())
                self.assertFalse((runtime / "node/npm/linked-package.json").exists())
                self.assertTrue((runtime / "node/npm/bin/npm-cli.js").is_file())

    def test_rejects_archive_path_traversal_and_windows_paths_on_both_platforms(self):
        for target in ("win32-x64", "darwin-arm64"):
            for index, relative in enumerate(("../../escaped.txt", "../escaped.txt", "/absolute.txt",
                                               "C:/escaped.txt", "folder\\escaped.txt", "./escaped.txt")):
                with self.subTest(target=target, relative=relative):
                    self.make_archive(target, extras=[(relative, b"must not write", "file")])
                    runtime = self.root / f"{target}-{index}"
                    with self.assertRaisesRegex(RuntimeError, "Unsafe Node archive member path"):
                        bundled_node(runtime, target)
                    self.assertFalse((runtime / "node/escaped.txt").exists())
                    self.assertFalse((runtime / "escaped.txt").exists())
                    self.assertFalse((runtime / "node/provenance.json").exists())

    def test_requires_the_npm_cli_on_both_platforms(self):
        for target in ("win32-x64", "darwin-arm64"):
            with self.subTest(target=target):
                self.make_archive(target, omit_cli=True)
                with self.assertRaisesRegex(RuntimeError, "missing runtime file: npm/bin/npm-cli.js"):
                    bundled_node(self.root / target, target)

    def test_checksum_mismatch_prevents_any_runtime_extraction(self):
        self.make_archive("win32-x64")
        (self.downloads / f"node-v{build.NODE_VERSION}-SHASUMS256.txt").write_text(
            f"{'0' * 64}  node-v{build.NODE_VERSION}-win-x64.zip\n", encoding="utf-8")
        runtime = self.root / "runtime"
        with self.assertRaisesRegex(RuntimeError, "Official Node checksum mismatch"):
            bundled_node(runtime, "win32-x64")
        self.assertFalse(runtime.exists())


if __name__ == "__main__":
    unittest.main()
