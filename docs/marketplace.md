# Install from GitHub

The marketplace supports Windows x64 and macOS ARM64. Node/npm are downloaded automatically on first MCP startup. Codex and Git must already be available, and the machine must be able to access GitHub, nodejs.org and public npm. Windows uses its built-in PowerShell and tar.exe. The Windows launcher uses native script resolution; macOS end-to-end verification must be recorded separately.

## Install

The public repository is [manycore-research/Coohom-Freeform](https://github.com/manycore-research/Coohom-Freeform). The commands below use its default branch. This is a source preview with test-environment limitations; see [release status](releasing.md). For installation through a Codex prompt, follow [INSTALL.md](../INSTALL.md).

```sh
codex plugin marketplace add manycore-research/Coohom-Freeform
codex plugin add coohom-freeform@coohom
```

Restart Codex and open a new task. First startup can take several minutes while Node and both MCP dependencies are prepared. npm retries transient download failures up to twice, with a 300-second installation limit per MCP. Later startups reuse the recorded local versions and do not run npm. Startup diagnostics go to the MCP server's stderr log; generation does not start during installation. Plugin registration alone does not mean both MCPs are ready; wait for both to load before use. Coohom sign-in, credits and browser requirements are the same as for ZIP installations.

## Existing installation

Before adding this plugin, run `codex plugin list`. Keep only one enabled Coohom Freeform installation. If migrating, save your scenes and stop Coohom tasks, then use `codex plugin remove <plugin>@<marketplace>` with the exact old selector listed by Codex. ZIP installations normally use `coohom-freeform@coohom-freeform-local`; earlier installations may use `personal`. Do not remove unrelated shared MCP services. Standalone MCP conflicts must be resolved by their owner before enabling this plugin.

## Cache and recovery

- Windows: `%LOCALAPPDATA%\Coohom\Freeform\marketplace`
- macOS: `~/Library/Caches/Coohom/Freeform/marketplace`
- Optional override: set `COOHOM_FREEFORM_CACHE` in the environment that starts Codex. Restart Codex after changing it. The plugin explicitly forwards this variable to both MCPs.

`node/` holds official Node distributions and their pinned archive SHA256 markers. `plugins/` holds immutable dependency installations separated by plugin version, runtime source fingerprint, operating system and architecture. A complete new installation is published atomically; failure does not mark a partial directory ready. Concurrent starts of the same MCP share a preparation lock. Windows Node locks release automatically when the owner exits; shell/MCP preparation locks left by a forced termination require manual recovery.

If a download fails, correct network access and retry startup. If logs report a stale lock or corrupted cache, stop all Coohom tasks and exit Codex first; confirm no Coohom preparation/MCP process is still using this cache, then remove only the affected plugin-owned cache directory and restart. Node is fetched again only when its cache is removed. Do not clear all Codex data, user scenes or other plugins. Uninstalling the plugin does not automatically delete this external cache.

The 0.1.0 release temporarily pins Freeform to `freeform-modeling-mcp@1.0.34` because the newer public CLI entry requires adapter changes. Lux3D retains `@manycore/coohom-lux3d-mcp@latest`. A new plugin/runtime revision prepares these dependencies again; a successful installation records exact versions and lockfiles. Transitive dependencies and Lux3D can still differ across first installations on different dates.

## Maintainers

`coohom-freeform/` and `bundler/` are the canonical sources. Regenerate `plugins/coohom-freeform/` and the catalog using the official plugin-creator helper:

```sh
python scripts/prepare_marketplace.py --scaffold <plugin-creator>/scripts/create_basic_plugin.py
python scripts/prepare_marketplace.py --check
```

The marketplace invokes `./scripts/bootstrap` with `cwd: "."`. Codex resolves the plugin-relative working directory; on Windows its executable resolver selects `bootstrap.cmd`, which calls system PowerShell. On macOS the executable `bootstrap` uses `/bin/sh`. No undocumented platform-selection field or plugin-install hook is used. Preserve LF endings and the executable Git mode on both tracked extensionless bootstrap scripts.

Windows acceptance uses an isolated Codex profile, an empty `PATH`, cold dependency preparation and warm cache reuse. It discovers tools without calling generation or scene-editing tools. Record each candidate separately; macOS runtime acceptance remains pending.

Each platform downloads the Node archive listed in `bundler/marketplace/node-runtime.tsv` and checks its pinned SHA256 before extraction/execution. The shared JS stage calls the same MCP installers as the ZIP path using explicit Node/npm locations, without registering another plugin or modifying Codex configuration. MCP stdio remains separate from preparation diagnostics.
