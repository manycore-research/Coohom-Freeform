# Install from GitHub

The marketplace supports Windows x64 and macOS ARM64. Node/npm are downloaded automatically on first MCP startup. Codex and Git must already be available, and the machine must be able to access GitHub, nodejs.org and public npm. Windows uses its built-in PowerShell and tar.exe. The Windows launcher uses native script resolution; macOS end-to-end verification must be recorded separately.

## Install

The public repository is [manycore-research/Coohom-Freeform](https://github.com/manycore-research/Coohom-Freeform). The commands below use its default branch. Executor access depends on the configured environment and your account permissions; see [release status](releasing.md) for version, distribution and validation details. For installation through a Codex prompt, follow [INSTALL.md](../INSTALL.md).

```sh
codex plugin marketplace add manycore-research/Coohom-Freeform
codex plugin add coohom-freeform@coohom
```

Restart Codex and open a new task. First startup can take several minutes while Node and both MCP dependencies are prepared. Each MCP installation has a 300-second limit. Failed installation waits for an explicit user choice rather than retrying or falling back automatically. Later startups reuse the recorded local versions and do not run npm. Startup diagnostics go to the MCP server's stderr log; generation does not start during installation. Plugin registration alone does not mean both MCPs are ready; wait for both to load before use. Generation requires Coohom sign-in, service permissions and available credits.

## Other downloads

The [Releases page](https://github.com/manycore-research/Coohom-Freeform/releases) also provides lightweight tar.gz packages. Choose the most recent build, verify SHA256SUMS, extract all files and follow the included INSTALL.md. Keep the extracted folder as the local marketplace source. These packages contain no Install.cmd or Install.command; platform ZIP installers are not published.

## Existing installation

Before adding this plugin, run `codex plugin list`. Keep only one enabled Coohom Freeform installation. If migrating, save your scenes and stop Coohom tasks, then use `codex plugin remove <plugin>@<marketplace>` with the exact old selector listed by Codex. ZIP installations normally use `coohom-freeform@coohom-freeform-local`; earlier installations may use `personal`. Do not remove unrelated shared MCP services. Standalone MCP conflicts must be resolved by their owner before enabling this plugin.

## Cache and recovery

- Windows: `%LOCALAPPDATA%\Coohom\Freeform\marketplace`
- macOS: `~/Library/Caches/Coohom/Freeform/marketplace`
- Optional override: set `COOHOM_FREEFORM_CACHE` in the environment that starts Codex. Restart Codex after changing it. The plugin explicitly forwards this variable to both MCPs.

Use actual filesystem paths rather than directory aliases or symlinks. On Windows, keep extraction and cache paths short; a 266-character startup-script path was rejected by Windows PowerShell during validation.

`node/` holds official Node distributions and their pinned archive SHA256 markers. `plugins/` holds immutable dependency installations separated by runtime source fingerprint, Node runtime, operating system and architecture; prose-only plugin version changes reuse the pair. A complete new installation is published atomically; failure does not mark a partial directory ready. Both MCPs share one pair preparation lock and activate together. Windows Node locks release automatically when the owner exits; shell/MCP preparation locks left by a forced termination require manual recovery.

After failure, inspect status and choose retry or stop. Only after that retry fails should another explicit pair be considered. Do not clear failure state to bypass this decision. A stale lock requires checking its owner/process before removing that exact lock. Uninstalling the plugin does not remove this external cache.

Run these from the installed plugin source, using `scripts/bootstrap.cmd` on Windows:

```sh
scripts/bootstrap freeform status
scripts/bootstrap freeform install
# Only after the user chooses retry:
scripts/bootstrap freeform retry
# Only after retry fails and the user chooses both exact versions:
scripts/bootstrap freeform versions <freeform-exact> <lux3d-exact>
```

These commands manage both MCPs as a pair. Installation/explicit upgrade defaults to both public npm latest versions. Ordinary startup never checks for newer packages. The launcher starts each package's declared public CLI and provides bundled Node/npm/npx. Upstream dependencies come from the package's own manifest and lockfile.

Installation, MCP initialization, task-required contract matching and real scene acceptance are separate validation levels. A retained historical pair is not automatically compatible. Stop active work before a chosen restart; do not switch dependencies mid-generation or during scene writes.

## Maintainers

`coohom-freeform/` and `bundler/` are the canonical sources. Regenerate `plugins/coohom-freeform/` and the catalog using the official plugin-creator helper:

```sh
python scripts/prepare_marketplace.py --scaffold <plugin-creator>/scripts/create_basic_plugin.py
python scripts/prepare_marketplace.py --check
```

The marketplace invokes `./scripts/bootstrap` with `cwd: "."`. Codex resolves the plugin-relative working directory; on Windows its executable resolver selects `bootstrap.cmd`, which calls system PowerShell. On macOS the executable `bootstrap` uses `/bin/sh`. No undocumented platform-selection field or plugin-install hook is used. Preserve LF endings and the executable Git mode on both tracked extensionless bootstrap scripts.

Windows acceptance uses an isolated Codex profile, an empty `PATH`, cold dependency preparation and warm cache reuse. It discovers tools without calling generation or scene-editing tools. Record each candidate separately; macOS runtime acceptance remains pending.

Each platform downloads the Node archive listed in `bundler/marketplace/node-runtime.tsv` and checks its pinned SHA256 before extraction/execution. The shared JS stage calls the same MCP installers as the ZIP path using explicit Node/npm locations, without registering another plugin or modifying Codex configuration. MCP stdio remains separate from preparation diagnostics.
