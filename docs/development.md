# Development

Use Python 3.11+ and Node.js 22+. Lux3D MCP is an external public npm dependency. This task does not change local MCP source or publish an MCP package.

```sh
python -B -m unittest discover -s scripts -p "test_*.py"
python -B -m unittest discover -s bundler -p "test_*.py"
python -B scripts/check_release_text.py
node --test bundler/manage-mcp.test.mjs bundler/install.test.mjs bundler/launch-mcp.test.mjs bundler/launch-lux3d.test.mjs bundler/update-freeform.test.mjs bundler/update-lux3d.test.mjs bundler/marketplace.test.mjs bundler/smoke-contract.test.mjs
```

## Build installers

The builder uses Codex's official `plugin-creator` skill to generate the installation marketplace. Obtain that skill from your Codex installation. Supply its script and your Node/npm CLI as explicit paths; no maintainer-specific directory is required.

```sh
python bundler/build.py --targets win32-x64 darwin-arm64 --node <node-executable> --npm-cli <npm-cli.js> --scaffold <plugin-creator>/scripts/create_basic_plugin.py
python scripts/release.py publish --freeform-runtime <freeform-install-directory>
```

The build downloads official Node.js 22.23.2 archives and verifies their SHA256 checksums. The installation packages carry Node and npm. At installation time they download `freeform-modeling-mcp@latest` and `@manycore/coohom-lux3d-mcp@latest` from public npm. Both packages install their declared dependencies; the plugin does not pin or inject tsx. Each installation records its actual versions and generated npm lockfile. Installation keeps the 300-second timeout per package and requires explicit retry after failure.

When changing dependency policies or CLI adapters, validate the actual resolved package entrypoints and tool schemas, regenerate the marketplace and rebuild both platform packages. Validate cold and warm startup before release. Ordinary startup reuses the recorded installation without resolving a newer dependency tree.

The ZIP marketplace is included in each platform package. The repository marketplace uses the generated `plugins/coohom-freeform/` plugin and prepares its own runtime on first startup. Follow [marketplace development instructions](marketplace.md) after canonical plugin or bootstrap changes; CI rejects stale generated files.

Maintain release history only in the repository-root [CHANGELOG.md](../CHANGELOG.md). Marketplace generation and platform packaging copy it into the installable plugin; do not edit those generated copies.

Maintain third-party notices in root `THIRD_PARTY.md` and `licenses/`; marketplace generation, full builds and repacks carry the same files. Run `python -B scripts/third_party.py --notices-only` for offline notice validation. See [release-only JSZip verification](releasing.md#jszip-release-only-verification) before publishing; it does not change runtime installation behavior.

Run `Install.cmd --check` or `Install.command --check` from an extracted package for a read-only installation plan. Actual installation affects the user's Codex configuration and is a separate verification step.

## Marketplace acceptance

On Windows x64, run `node bundler/marketplace-smoke.mjs <absolute-codex.exe> tmp/marketplace-acceptance.json` to register the repository marketplace in a temporary Codex home and check real MCP tool discovery with an empty `PATH`. This downloads Node and public MCP dependencies on cold startup, then verifies a second startup reuses the installation records. It does not call generation or scene tools. Close old Coohom tasks first: the script checks that the default freeform bridge port 8765 is available before downloading anything and never stops existing services. The script removes its isolated environment and retains the requested report; optional `--keep-on-failure` preserves the isolated directory for diagnosis and records its path in the report. Move the report to your validation records and remove temporary task output afterward. Test macOS and the final public GitHub URL separately.

## Dependencies and diagnostics

Smoke checks validate current MCP tool declarations structurally in `bundler/smoke-contract.mjs`; they do not gate installation on a fixed list of tool names. Schema discovery is not proof of semantic or task compatibility. The optional synthetic Lux3D disconnected-executor fixture remains a version-specific regression, not a production compatibility gate. Do not call it automatically against arbitrary new versions.

Plugin version checks accept release versions with a 14-digit Codex cachebuster instead of a fixed patch version. Freeform startup log collection covers both legacy package-local logs and bundled CLI logs under its installation's `node_modules/logs`; Lux3D logs are excluded.

npm uses a 60-second request timeout and a 300-second limit per MCP, without automatic retries. The pair manager persists failures; first the user chooses retry/stop, then another exact pair/stop if retry failed. ZIP and marketplace share this manager.

Both platform ZIPs and the repository marketplace use the shared [Lux3D launcher](../bundler/launch-lux3d.mjs) to start the installed MCP through its public CLI.

Policy files declare the package source; each successful installation records exact versions and npm lockfiles under its own runtime directory. Startup runs those installed files without downloading updates. Keep npm package names separate from the plugin-owned MCP server key `lux3d-mcp-server`; executable paths come from the public package manifest.

Do not place tokens, cookies, authorization headers, signed URLs or real user scenes in tests or reports. Use synthetic executor responses for automated tests; model generation may consume a free allowance or account Credits.
