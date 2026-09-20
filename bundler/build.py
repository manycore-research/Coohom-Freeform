"""Build platform installers with Node/npm; install current MCPs on the target host."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'scripts'))
from third_party import notice_files

SOURCE = HERE.parent / "coohom-freeform"
NODE_VERSION = "22.23.2"
MARKETPLACE = "coohom-freeform-local"
MCP_RUNTIME_FILES = ("runtime-contract.mjs", "manage-mcp.mjs", "launch-mcp.mjs", "launch-lux3d.mjs",
                     "update-freeform.mjs", "freeform-policy.json",
                     "update-lux3d.mjs", "lux3d-policy.json")
INSTALL_HELPERS = ("runtime-contract.mjs", "manage-mcp.mjs", "update-freeform.mjs", "update-lux3d.mjs", "launch-mcp.mjs")
PLATFORMS = {
    "win32-x64": ("win", "x64", "zip", "windows-x64"),
    "darwin-arm64": ("darwin", "arm64", "tar.gz", "macos-arm64"),
    "darwin-x64": ("darwin", "x64", "tar.gz", "macos-x64"),
}


def run(args: list[str], cwd: Path | None = None) -> None:
    result = subprocess.run(args, cwd=cwd, text=True, encoding="utf-8", errors="replace",
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {args[0]}\n{result.stdout[-6000:]}")


def download(url: str, target: Path) -> None:
    if target.exists():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=60) as response:
        with target.with_suffix(target.suffix + ".partial").open("wb") as output:
            shutil.copyfileobj(response, output)
    target.with_suffix(target.suffix + ".partial").replace(target)


def runtime_destination(root: Path, relative: str) -> Path:
    """Resolve an archive file beneath the runtime without normalizing traversal."""
    parts = relative.split("/")
    if any(part in ("", ".", "..") for part in parts) or any(char in relative for char in "\\:\0"):
        raise RuntimeError("Unsafe Node archive member path")
    destination = root.joinpath(*parts)
    if not destination.resolve().is_relative_to(root.resolve()):
        raise RuntimeError("Node archive member escapes runtime directory")
    return destination


def bundled_node(runtime: Path, target: str) -> None:
    node_os, arch, extension, _ = PLATFORMS[target]
    base = f"node-v{NODE_VERSION}-{node_os}-{arch}"
    filename = f"{base}.{extension}"
    downloads = HERE / "downloads"
    sums = downloads / f"node-v{NODE_VERSION}-SHASUMS256.txt"
    download(f"https://nodejs.org/dist/v{NODE_VERSION}/SHASUMS256.txt", sums)
    expected = dict(line.split(maxsplit=1)[::-1] for line in sums.read_text().splitlines())
    archive = downloads / filename
    download(f"https://nodejs.org/dist/v{NODE_VERSION}/{filename}", archive)
    with archive.open("rb") as archive_bytes:
        actual = hashlib.file_digest(archive_bytes, "sha256").hexdigest()
    if expected.get(filename) != actual:
        raise RuntimeError(f"Official Node checksum mismatch: {filename}")
    files = ["node.exe", "LICENSE"] if target.startswith("win32") else ["bin/node", "LICENSE"]
    node_root = runtime / "node"
    npm_prefix = f"{base}/" + ("node_modules/npm/" if extension == "zip" else "lib/node_modules/npm/")
    selected = {f"{base}/{relative}": relative for relative in files}

    def destination(name: str) -> Path | None:
        relative = selected.get(name)
        if relative is None and name.startswith(npm_prefix):
            relative = "npm/" + name[len(npm_prefix):]
        return runtime_destination(node_root, relative) if relative is not None else None

    if extension == "zip":
        with zipfile.ZipFile(archive) as source:
            for member in source.infolist():
                # Windows ZIP entries may omit Unix file types. Never extract
                # symlinks, directories, or special files as runtime content.
                mode = stat.S_IFMT(member.external_attr >> 16)
                if member.is_dir() or mode not in (0, stat.S_IFREG):
                    continue
                # Validate the raw name before ZipInfo normalizes separators.
                dest = destination(member.orig_filename)
                if dest is not None:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with source.open(member) as data, dest.open("wb") as output:
                        shutil.copyfileobj(data, output)
    else:
        with tarfile.open(archive, "r:gz") as source:
            for member in source:
                if not member.isfile():
                    continue
                dest = destination(member.name)
                if dest is not None:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with source.extractfile(member) as data, dest.open("wb") as output:
                        shutil.copyfileobj(data, output)
                    dest.chmod(member.mode & 0o777)
    for relative in [*files, "npm/bin/npm-cli.js", "npm/package.json"]:
        if not (node_root / relative).is_file():
            raise RuntimeError(f"Official Node archive is missing runtime file: {relative}")
    (runtime / "node" / "provenance.json").write_text(json.dumps({
        "version": NODE_VERSION,
        "url": f"https://nodejs.org/dist/v{NODE_VERSION}/{filename}",
        "sha256": actual,
    }, indent=2) + "\n", encoding="utf-8")


def write_entrypoints(root: Path, target: str) -> None:
    if target.startswith("win32"):
        (root / "Install.cmd").write_text(
            '@echo off\r\nsetlocal\r\n"%SystemRoot%\\System32\\chcp.com" 65001 >nul\r\n'
            '"%~dp0marketplace\\plugins\\coohom-freeform\\runtime\\node\\node.exe" "%~dp0install.mjs" %*\r\n'
            'set "COOHOM_INSTALL_EXIT=%ERRORLEVEL%"\r\n'
            'echo.\r\necho Press any key to close...\r\npause >nul\r\nexit /b %COOHOM_INSTALL_EXIT%\r\n', encoding="ascii", newline="")
    else:
        script = root / "Install.command"
        script.write_text('#!/bin/sh\n'
            'COOHOM_BUNDLE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1\n'
            '"$COOHOM_BUNDLE_DIR/marketplace/plugins/coohom-freeform/runtime/node/bin/node" "$COOHOM_BUNDLE_DIR/install.mjs" "$@"\n'
            'COOHOM_INSTALL_EXIT=$?\n'
            'printf "\\nPress Enter to close..."\nread -r COOHOM_CLOSE\nexit "$COOHOM_INSTALL_EXIT"\n', encoding="utf-8", newline="\n")
        script.chmod(0o755)


def archive_bundle(root: Path, output: Path) -> str:
    filesystem_root = root
    if os.name == "nt":
        # Windows may silently report long regular files as nonexistent. Use
        # extended paths for traversal/stat/read, but keep ZIP names relative.
        absolute = str(root.resolve())
        if not absolute.startswith("\\\\?\\"):
            absolute = "\\\\?\\UNC\\" + absolute[2:] if absolute.startswith("\\\\") else "\\\\?\\" + absolute
        filesystem_root = Path(absolute)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(filesystem_root.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(filesystem_root).as_posix()
            # A distribution carries installers, never a developer/user's
            # installed MCP versions, state pointers, or interrupted updates.
            mcp_relative = ("/" + relative).partition("/runtime/mcp/")[2]
            mcp_entry = mcp_relative.split("/", 1)[0]
            if mcp_entry in {"freeform", "lux3d", "freeform-install.json", "lux3d-install.json"} \
                    or mcp_entry.startswith((".freeform-", ".lux3d-")):
                continue
            # Some package releases contain generated example scenes.
            # Neither these outputs nor local logs are runtime dependencies.
            if any(f"/node_modules/freeform-modeling-mcp/{directory}/" in f"/{relative}"
                   for directory in ["logs", "output"]):
                continue
            info = zipfile.ZipInfo(f"{root.name}/{relative}")
            info.create_system = 3
            executable = path.suffix == ".command" or relative.endswith("/bin/node") or relative.endswith("/bin/esbuild")
            info.external_attr = (0o100755 if executable else 0o100644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("ZIP integrity verification failed")
    with output.open("rb") as data:
        return hashlib.file_digest(data, "sha256").hexdigest()


def build(target: str, node: str, npm_cli: str, scaffold: str, offline: bool = False) -> Path:
    platform, arch = target.split("-")
    stage_parent = HERE / "staging"
    stage_parent.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix=f"{target}-", dir=stage_parent))
    root = work / f"coohom-freeform-{PLATFORMS[target][3]}"
    root.mkdir()
    market = root / "marketplace"
    print(f"[{target}] Preparing plugin and marketplace", flush=True)
    run([sys.executable, "-X", "utf8", scaffold, "coohom-freeform", "--path", str(market / "plugins"),
         "--marketplace-path", str(market / ".agents/plugins/marketplace.json"),
         "--marketplace-name", MARKETPLACE, "--with-marketplace"])
    plugin = market / "plugins/coohom-freeform"
    shutil.copytree(SOURCE, plugin, dirs_exist_ok=True)
    shutil.copy2(HERE.parent / "CHANGELOG.md", plugin / "CHANGELOG.md")
    for relative, contents in notice_files(HERE.parent).items():
        for destination in (root / relative, plugin / relative):
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(contents)
    readme = (plugin / "README.md").read_bytes().replace(b'](../CHANGELOG.md)', b'](CHANGELOG.md)')
    (plugin / "README.md").write_bytes(readme)
    # The installer creates the actual MCP configuration after choosing a stable path.
    manifest = json.loads((plugin / ".codex-plugin/plugin.json").read_text(encoding="utf-8"))
    manifest.pop("mcpServers", None)
    (plugin / ".codex-plugin/plugin.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    runtime = plugin / "runtime"
    print(f"[{target}] Downloading/checking official Node runtime", flush=True)
    bundled_node(runtime, target)
    mcp = runtime / "mcp"
    mcp.mkdir()
    for filename in ["package.json", "package-lock.json"]:
        shutil.copy2(HERE / "lock" / filename, mcp / filename)
    for filename in MCP_RUNTIME_FILES:
        shutil.copy2(HERE / filename, mcp / filename)
    base_package = json.loads((mcp / "package.json").read_text(encoding="utf-8"))
    if any(base_package.get(field) for field in ("dependencies", "optionalDependencies")):
        print(f"[{target}] Installing locked base dependencies (scripts disabled)", flush=True)
        run([node, npm_cli, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund",
             f"--os={platform}", f"--cpu={arch}", "--registry=https://registry.npmjs.org",
             "--@manycore:registry=https://registry.npmjs.org/",
             f"--cache={HERE / 'npm-cache'}", *(["--offline"] if offline else [])], cwd=mcp)
    shutil.copy2(HERE / "install.mjs", root / "install.mjs")
    for filename in INSTALL_HELPERS:
        shutil.copy2(HERE / filename, root / filename)
    (root / "bundle.json").write_text(json.dumps({
        "platform": platform, "arch": arch, "version": manifest["version"],
        "marketplaceName": MARKETPLACE, "pluginName": "coohom-freeform",
    }, indent=2) + "\n", encoding="utf-8")
    write_entrypoints(root, target)
    shutil.copy2(plugin / "README.md", root / "README.md")
    shutil.copy2(HERE.parent / "CHANGELOG.md", root / "CHANGELOG.md")
    shutil.copy2(SOURCE / "LICENSE", root / "LICENSE")
    dist = HERE.parent / "dist"
    dist.mkdir(exist_ok=True)
    output = dist / f"{root.name}.zip"
    print(f"[{target}] Writing and verifying archive", flush=True)
    digest = archive_bundle(root, output)
    (output.with_suffix(".zip.sha256")).write_text(f"{digest}  {output.name}\n", encoding="ascii")
    (dist / f"{root.name}.build.json").write_text(json.dumps({
        "stagingRoot": str(root), "archive": str(output), "sha256": digest,
        "sizeBytes": output.stat().st_size, "platform": platform, "arch": arch,
        "nodeVersion": NODE_VERSION, "pluginVersion": manifest["version"],
    }, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"archive": str(output), "bytes": output.stat().st_size, "sha256": digest}), flush=True)
    return root


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--targets", nargs="+", choices=PLATFORMS, required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--npm-cli", required=True)
    parser.add_argument("--scaffold", required=True)
    parser.add_argument("--offline", action="store_true", help="Use the npm cache for base build dependencies; installing/updating MCPs still requires network")
    args = parser.parse_args()
    for target in args.targets:
        build(target, args.node, args.npm_cli, args.scaffold, args.offline)


if __name__ == "__main__":
    main()
