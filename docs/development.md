# Development

Use Python 3.11+ and Node.js 22+. Lux3D MCP is an external public npm dependency. This task does not change local MCP source or publish an MCP package.

```sh
python -B -m unittest discover -s scripts -p "test_*.py"
python -B -m unittest discover -s bundler -p "test_*.py"
python -B scripts/check_release_text.py
node --test bundler/install.test.mjs bundler/launch-mcp.test.mjs bundler/launch-lux3d.test.mjs bundler/update-freeform.test.mjs bundler/update-lux3d.test.mjs bundler/marketplace.test.mjs
```

## Build installers

The builder uses Codex's official `plugin-creator` skill to generate the installation marketplace. Obtain that skill from your Codex installation. Supply its script and your Node/npm CLI as explicit paths; no maintainer-specific directory is required.

```sh
python bundler/build.py --targets win32-x64 darwin-arm64 --node <node-executable> --npm-cli <npm-cli.js> --scaffold <plugin-creator>/scripts/create_basic_plugin.py
python scripts/release.py publish
```

The build downloads official Node.js 22.23.2 archives and verifies their SHA256 checksums. The installation packages carry Node and npm. At installation time they download `freeform-modeling-mcp@latest` and `@manycore/coohom-lux3d-mcp@latest` from public npm. The freeform launcher also installs the tsx version declared in `bundler/freeform-policy.json`.

The ZIP marketplace is included in each platform package. The repository marketplace uses the generated `plugins/coohom-freeform/` plugin and prepares its own runtime on first startup. Follow [marketplace development instructions](marketplace.md) after canonical plugin or bootstrap changes; CI rejects stale generated files.

Run `Install.cmd --check` or `Install.command --check` from an extracted package for a read-only installation plan. Actual installation affects the user's Codex configuration and is a separate verification step.

## Marketplace acceptance

On Windows x64, run `node bundler/marketplace-smoke.mjs <absolute-codex.exe> tmp/marketplace-acceptance.json` to register the repository marketplace in a temporary Codex home and check real MCP tool discovery with an empty `PATH`. This downloads Node and public MCP dependencies on cold startup, then verifies a second startup reuses the installation records. It does not call generation or scene tools. Close old Coohom tasks first: the script checks that the default freeform bridge port 8765 is available before downloading anything and never stops existing services. The script removes its isolated environment and retains the requested report; optional `--keep-on-failure` preserves the isolated directory for diagnosis and records its path in the report. Move the report to your validation records and remove temporary task output afterward. Test macOS and the final public GitHub URL separately.

## Dependencies and diagnostics

Policy files declare the package source; each successful installation records exact versions and npm lockfiles under its own runtime directory. Startup runs those installed files without downloading updates. Keep npm package names separate from the MCP server key `lux3d-mcp-server` and executable name, which remain stable.

Do not place tokens, cookies, authorization headers, signed URLs or real user scenes in tests or reports. Use synthetic executor responses for automated tests; model generation spends account credits.
