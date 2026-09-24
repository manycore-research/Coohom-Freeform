# Install Coohom Freeform for Codex

Use this guide when the user asks to install Coohom Freeform. Reading or reviewing this document alone is not a request to install it.

## Source and prerequisites

- Repository: https://github.com/manycore-research/Coohom-Freeform, using its default branch.
- Marketplace: `coohom`; plugin selector: `coohom-freeform@coohom`.
- Catalog: `.agents/plugins/marketplace.json`; plugin manifest: `plugins/coohom-freeform/.codex-plugin/plugin.json`.
- Supported systems: Windows x64 and macOS ARM64 (Apple Silicon).
- Requires Codex, Git, and network access to GitHub, nodejs.org and public npm. Node/npm are prepared automatically on first MCP startup.

Read the version from the plugin manifest in the source checkout being installed. Confirm that the catalog and plugin manifest exist on the default branch and match the source and selector above. If inaccessible, report the access failure; do not substitute another repository or guess a branch. Lux3D requires Coohom sign-in and service permissions. Open the complete task URL returned by `prepare_workspace`. See [release status](docs/releasing.md).

## Install

Installation requires network access and writes to the configuration and plugin cache in the current user's Codex directory.

If an official installation command is blocked by sandbox network restrictions or denied file access, use the permission approval mechanism provided by the current Codex environment to request the permissions needed for that specific command. Explain the purpose and write locations. After approval, rerun the command and verify the installation result.

Do not stop installation or immediately ask the user to run the command manually after the first sandbox permission failure. If the current environment does not support permission requests, approval fails, the user declines, or policy prohibits the action, stop retrying, preserve the original error, and provide the official command for the user to run in a standalone terminal.

Do not change file permissions, disable the sandbox, or bypass approval on your own.

1. Find the installed Codex CLI and check `codex plugin --help` and `git --version`. If `codex` is not on `PATH`, use the existing desktop application's CLI executable by its full path when available. If prerequisites are missing, explain what is needed before proceeding.
2. Inspect existing registrations with `codex plugin marketplace list --json` and `codex plugin list --json`. If `coohom` points to another source, ask the user how to handle it. If this plugin is already installed and enabled from this repository at the manifest's version, report that state instead of reinstalling. For another version or source, ask before replacing it. Keep only one enabled Coohom Freeform installation; ZIP installations normally use `coohom-freeform@coohom-freeform-local`, and older ones may use `personal`. Never remove unrelated plugins or shared MCP registrations.
3. Register the marketplace if it is not already registered from this repository, then install the plugin:

   ```sh
   codex plugin marketplace add manycore-research/Coohom-Freeform
   codex plugin add coohom-freeform@coohom
   ```

   Use Codex's official plugin commands. Do not replace installation with manual edits to Codex configuration or copies into its plugin cache.

4. Run `codex plugin list --json` again. Verify the source, installed/enabled state and version against the public plugin manifest. Report only what the output confirms.
5. Ask the user to restart Codex and open a new task, then enter `$coohom-freeform`. First startup may take several minutes while both MCPs prepare their dependencies. Plugin registration alone does not establish that the MCPs are ready; check their startup status in the new task before reporting runtime success.

Installation does not require model generation or changes to user scenes. Do not invoke generation or scene-editing tools as an installation test. If an existing process blocks MCP startup, identify its ownership and ask before stopping it. See [marketplace troubleshooting](docs/marketplace.md) for cache recovery and migration details.

## Maintenance

After installation, use the plugin source directory reported by Codex and follow [management commands](docs/marketplace.md#cache-and-recovery). `scripts/manage status` (`scripts/manage.cmd` on Windows) is read-only. `doctor` checks initialization and tool discovery, while `upgrade` updates the plugin and both MCPs and cleans recognized superseded files after success. Explain failures and wait for the user to choose recovery; registration or dependency installation alone is not runtime readiness.

## Release packages

Download the desired artifact from [v0.1.1](https://github.com/manycore-research/Coohom-Freeform/releases/tag/v0.1.1) and verify SHA256SUMS.

- `coohom-freeform.tar.gz`: extract hidden folders too, then follow the archive-specific INSTALL.md to register the extracted local marketplace.
- `coohom-freeform-windows-x64.zip`: extract every file and run Install.cmd.
- `coohom-freeform-macos-arm64.zip`: extract every file and run Install.command on Apple Silicon.

Platform installers support `--check` for a read-only plan. For upgrades, save scenes, close old modeling tasks and review the installer replacement prompt. All forms require internet access for the MCP packages and record their resolved versions.
