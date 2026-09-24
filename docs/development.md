# Development

Use Python 3.11+ and Node.js 22+. Lux3D MCP is an external public npm dependency. This task does not change local MCP source or publish an MCP package.

```sh
python -B -m unittest discover -s scripts -p "test_*.py"
python -B -m unittest discover -s bundler -p "test_*.py"
python -B scripts/check_release_text.py
node --test bundler/management.test.mjs bundler/manage-mcp.test.mjs bundler/install.test.mjs bundler/launch-mcp.test.mjs bundler/launch-lux3d.test.mjs bundler/update-freeform.test.mjs bundler/update-lux3d.test.mjs bundler/marketplace.test.mjs bundler/smoke-contract.test.mjs
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

### Technical fallback acceptance

The skill owns orchestration; no runtime state machine or fixed MCP error-code classifier is bundled. Marketplace/text checks prove distribution consistency, not agent behavior or a successful modeled scene. Review the following sequences against the skill, then verify with controlled public-tool responses and a disposable scene when end-to-end acceptance is requested. Preserve real tool declarations and separate actual observations from simulated inputs. Do not generate paid models just to inject failures.

| Scenario / supplied observations | Required behavior |
|---|---|
| Generation succeeds within five minutes; valid import output | Import once and verify; no fallback. |
| Query confirms terminal generation failure | Search Freeform immediately for that asset; other tasks continue. |
| At five minutes, generation remains pending or submission remains unknown | Select fallback, retain original identity/reservation and never resubmit. |
| Reconnect or resume a turn after the original deadline | Reuse original time and fallback progress; no fresh timer or extra search allowance. |
| Lux3D succeeds after fallback starts or completes | Retain output only; no extra import or automatic replacement. |
| Technical executor failure persists after one recovery | Stop recovery within 60 seconds or the earlier generation deadline; confirmed service outage routes remaining furniture through Freeform. |
| No valid handoff in preflight, or missing metadata/unsupported format after success | Skip unnecessary generation or retain existing output; at most one safe declared alternative route, then fallback. |
| Import times out, but scene query confirms the usable object exists | Reuse/adjust it; no duplicate or substitute. |
| Import times out and scene is empty, but the import job is still unresolved | Pause the asset; empty scene alone is not proof of nonexecution. |
| Import is confirmed failed/nonexecuted | At most one retry with a known safe fix, otherwise reconcile and substitute. |
| Two searches find no suitable library asset | Use public simple geometry while preserving explicit function/layout/dimensions. |
| Candidate-specific placement failures | Try at most one different candidate, then geometry; common Freeform faults never trigger candidate cycling. |
| Sign-in expired or Credits insufficient, including after the deadline | Keep user decision flow; do not silently substitute or recharge. |
| Freeform unavailable, ambiguous target or unmet explicit design constraint | Preserve work, pause affected asset and request only necessary input; no false completion. |
| Mixed successful, failed and unresolved furniture tasks | Keep unresolved slots, use Freeform when slots are full, serialize scene writes and maintain one verified object mapping per intended instance. |
| Final scene includes library/geometry substitutes | Report meaningful approximations without error dumps or claims of Lux3D success, cancellation or refund. |

Record static checks, scenario review and real end-to-end acceptance separately, including elapsed testing time. End-to-end acceptance requires actual scene queries and visual checks; a written walkthrough or synthetic tool response cannot establish it.

Smoke checks validate current MCP tool declarations structurally in `bundler/smoke-contract.mjs`; they do not gate installation on a fixed list of tool names. Schema discovery is not proof of semantic or task compatibility. The optional synthetic Lux3D disconnected-executor fixture remains a version-specific regression, not a production compatibility gate. Do not call it automatically against arbitrary new versions.

Plugin version checks accept release versions with a 14-digit Codex cachebuster instead of a fixed patch version. Freeform startup log collection covers both legacy package-local logs and bundled CLI logs under its installation's `node_modules/logs`; Lux3D logs are excluded.

npm uses a 60-second request timeout and a 300-second limit per MCP, without automatic retries. The pair manager persists failures; first the user chooses retry/stop, then another exact pair/stop if retry failed. ZIP and marketplace share this manager.

Both platform ZIPs and the repository marketplace use the shared [Lux3D launcher](../bundler/launch-lux3d.mjs) to start the installed MCP through its public CLI.

Policy files declare the package source; each successful installation records exact versions and npm lockfiles under its own runtime directory. Startup runs those installed files without downloading updates. Keep npm package names separate from the plugin-owned MCP server key `lux3d-mcp-server`; executable paths come from the public package manifest.

Do not place tokens, cookies, authorization headers, signed URLs or real user scenes in tests or reports. Use synthetic executor responses for automated tests; model generation may consume a free allowance or account Credits.

Management regressions use synthetic public MCP CLIs and disposable caches. Set `COOHOM_TEST_CODEX` to an existing Codex executable to also test official registration, local and Git source upgrades, explicit restoration and uninstall in a temporary Codex home. The Git fixture rewrites a synthetic URL to a local repository and does not access the network. The test never changes the actual user profile. Run the same suite on Windows x64 and macOS ARM64; platform-specific cases report skips elsewhere.

For real Windows management acceptance, append `--management` to the marketplace smoke command. After cold/warm discovery it exercises read-only status, standalone doctor, full upgrade, post-upgrade discovery, automatic cleanup, official uninstall and separately selected cache cleanup. Record elapsed time and both actual npm versions from the JSON report. Node preparation failures persist too: concurrent or subsequent ordinary launches do not retry downloads; only an explicit retry clears the failure under the preparation lock.

If the tester explicitly chooses to reuse an existing Node distribution after a download failure, `--cached-node <node-directory>` copies it into the isolated cache after checking its recorded archive checksum, executable version and npm entrypoint. The report labels this mode and does not claim a successful Node cold download. This is an acceptance-script option, not an installer fallback.
