# Install from GitHub

The marketplace supports Windows x64 and macOS ARM64. Node/npm are downloaded automatically on first MCP startup. Codex and Git must already be available, and the machine must be able to access GitHub, nodejs.org and public npm. Windows uses its built-in PowerShell and tar.exe. The Windows launcher uses native script resolution.

## Install

The public repository is [manycore-research/Coohom-Freeform](https://github.com/manycore-research/Coohom-Freeform). The commands below use its default branch. Executor access depends on the configured environment and your account permissions; see [release status](releasing.md) for version, distribution and validation details. For installation through a Codex prompt, follow [INSTALL.md](../INSTALL.md).

```sh
codex plugin marketplace add manycore-research/Coohom-Freeform
codex plugin add coohom-freeform@coohom
```

Restart Codex and open a new task. First startup can take several minutes while Node and both MCP dependencies are prepared. Each MCP installation has a 300-second limit. Failed installation waits for an explicit user choice rather than retrying or falling back automatically. Later startups reuse the recorded local versions and do not run npm. Startup diagnostics go to the MCP server's stderr log; generation does not start during installation. Plugin registration alone does not mean both MCPs are ready; wait for both to load before use. Coohom sign-in, credits and browser requirements are the same as for ZIP installations.

## Existing installation

Before adding this plugin, run `codex plugin list`. Keep only one enabled Coohom Freeform installation. If migrating, save your scenes and stop Coohom tasks, then use `codex plugin remove <plugin>@<marketplace>` with the exact old selector listed by Codex. ZIP installations normally use `coohom-freeform@coohom-freeform-local`; earlier installations may use `personal`. Do not remove unrelated shared MCP services. Standalone MCP conflicts must be resolved by their owner before enabling this plugin.

## Cache and recovery

- Windows: `%LOCALAPPDATA%\Coohom\Freeform\marketplace`
- macOS: `~/Library/Caches/Coohom/Freeform/marketplace`
- Optional override: set `COOHOM_FREEFORM_CACHE` in the environment that starts Codex. Restart Codex after changing it. The plugin explicitly forwards this variable to both MCPs.

`node/` holds official Node distributions and their pinned archive SHA256 markers. `plugins/` holds immutable dependency installations separated by runtime source fingerprint, Node runtime, operating system and architecture; prose-only plugin version changes reuse the pair. A complete new installation is published atomically; failure does not mark a partial directory ready. Both MCPs share one pair preparation lock and activate together. Windows Node locks release automatically when the owner exits; shell/MCP preparation locks left by a forced termination require manual recovery.

After failure, inspect status and choose retry or stop. Only after that retry fails should another explicit pair be considered. Do not clear failure state to bypass this decision. A stale lock requires checking its owner/process before removing that exact lock. Uninstalling the plugin does not remove this external cache.

Run maintenance from the plugin **source** directory reported by Codex (not its disposable installation cache). Use `scripts/manage.cmd` on Windows and `scripts/manage` on macOS:

```sh
scripts/manage status --json
scripts/manage doctor
scripts/manage upgrade
# For a local archive source, supply the new extracted marketplace root:
scripts/manage upgrade --source /absolute/path/to/new-marketplace
scripts/manage upgrade --scope plugin
scripts/manage upgrade --scope mcp
# Only after the corresponding user choice:
scripts/manage retry
scripts/manage resume-current
# Only after an explicit dependency retry also fails:
scripts/manage retry --versions <freeform-exact> <lux3d-exact>
scripts/manage cleanup
scripts/manage cleanup --apply
scripts/manage uninstall
# Separate external-cache deletion decision after uninstall:
scripts/manage cleanup --purge-cache
scripts/manage cleanup --purge-cache --apply
```

`status` is read-only, including when Node is missing. It distinguishes installed dependencies from a timestamped startup check; neither establishes the connection of the current Codex task. `doctor` checks initialization and tool discovery without calling modeling or generation tools. Close tasks using either MCP before checking or upgrading. Existing services are never stopped by these commands.

`upgrade` updates the plugin and both MCPs by default. `--scope plugin` retains the exact installed dependencies without npm; `--scope mcp` leaves plugin registration unchanged. A normal dependency upgrade uses public npm latest for both Freeform and Lux3D. Git installations refresh their configured marketplace; local installations require `--source` when changing plugin files. Git recovery reinstalls the recorded exact revision and reports the restored source; it may pin the marketplace to that revision.

An upgrade prepares and checks a candidate before activation. A failure records its stage and waits for retry, resuming a verifiable old installation, or stopping. It does not automatically retry, restore, or choose another version. Successful upgrades automatically remove recognized unused old dependencies, Node distributions and recovery snapshots, retaining the current installation only. Active or unverifiable resources are deferred. A cleanup failure is reported separately from upgrade success.

Git candidates are staged independently before Codex refreshes the live marketplace. The refreshed revision must equal the checked candidate. Source identity comes from Codex's effective marketplace configuration; a local Git working directory remains a local source. Legacy records migrate without reinstalling MCPs; changed runtime files require an explicit upgrade instead of silently resolving newer packages at startup. An explicit retry can recover a management lock only after its owner is confirmed stopped and related resources are idle. Node download failures also block ordinary startup until an explicit retry.

`cleanup` previews paths and sizes; `--apply` explicitly deletes them after rechecking ownership and use. Uninstall uses Codex's official plugin command and retains external caches unless the user separately requests their removal. An executing Node runtime remains protected; deferred resources are reported rather than force-deleted. User scenes, source checkouts, downloaded release archives, other plugins and shared MCPs are outside cleanup scope.

The previous `scripts/bootstrap freeform status|install|retry|versions` commands remain supported (`bootstrap.cmd` on Windows). Their dependency-only recovery path still requires explicit retry before alternative exact versions. `bootstrap freeform status` now delegates to read-only management status. Do not use the legacy path to bypass a failed full upgrade; use the recorded management operation's recovery options.

Installation, MCP initialization, task-required contract matching and real scene acceptance are separate validation levels. A retained historical pair is not automatically compatible. Stop active work before a chosen restart; do not switch dependencies mid-generation or during scene writes.

## Maintainers

`coohom-freeform/` and `bundler/` are the canonical sources. Regenerate `plugins/coohom-freeform/` and the catalog using the official plugin-creator helper:

```sh
python scripts/prepare_marketplace.py --scaffold <plugin-creator>/scripts/create_basic_plugin.py
python scripts/prepare_marketplace.py --check
```

The marketplace invokes `./scripts/bootstrap` with `cwd: "."`. Codex resolves the plugin-relative working directory; on Windows its executable resolver selects `bootstrap.cmd`, which calls system PowerShell. On macOS the executable `bootstrap` uses `/bin/sh`. No undocumented platform-selection field or plugin-install hook is used. Preserve LF endings and executable Git mode on the tracked extensionless bootstrap and manage scripts.

Windows acceptance uses an isolated Codex profile, an empty `PATH`, cold dependency preparation and warm cache reuse. It discovers tools without calling generation or scene-editing tools. Record each candidate separately.

Each platform downloads the Node archive listed in `bundler/marketplace/node-runtime.tsv` and checks its pinned SHA256 before extraction/execution. The shared JS stage calls the same MCP installers as the ZIP path using explicit Node/npm locations, without registering another plugin or modifying Codex configuration. MCP stdio remains separate from preparation diagnostics.
