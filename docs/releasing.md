# Release status and maintenance

## 0.1.0 source preview

This is the first public source release. It contains the plugin, GitHub marketplace,
installer/build sources, tests and documentation under the MIT license. Earlier
internal candidate histories, packages and validation records are excluded.

The full plugin version adds a `+codex.<UTC timestamp>` build identifier to 0.1.0.
The public tag is `v0.1.0`. This preview does not publish platform ZIP assets.

## Service and validation limits

- Lux3D currently uses `https://prod-test-seoul.coohom.com/pub/tool/bim/ai-home/mcp-executor` as its temporary executor base. The MCP returns the task-specific URL; users should not construct one manually. This is a test service with no production availability guarantee.
- Generation needs Coohom sign-in, service permissions and available credits. The hosted editor, generation service, accounts and billing are outside this source release.
- Both MCPs resolve public npm `latest` on a fresh installation. Successful installations record exact versions and lockfiles; later starts reuse them. Dependency versions can differ between installations on different dates.
- Windows source/marketplace and local automated checks are verified separately from browser workflows. macOS runtime, sign-in, generation, archiving, import and visual scene acceptance remain pending.
- Platform ZIP releases remain deferred until installer acceptance and runtime redistribution notices are complete. Source availability does not establish those checks.

## GitLab development, GitHub export

The development repository remains in GitLab. GitHub contains a reviewed source
snapshot and its own public commit history; never mirror internal Git history.
Apply accepted GitHub contributions to the development repository before exporting.

1. Prepare a version in the development repository with `python scripts/release.py prepare --summary "User-visible change"`. This archives the current local artifacts and uses the official plugin-creator cachebuster. The first public version was explicitly reset to 0.1.0; later releases increment from that public version.
2. Update the changelog and regenerate the marketplace with `python scripts/prepare_marketplace.py --scaffold <plugin-creator>/scripts/create_basic_plugin.py`.
3. Run the checks in [development.md](development.md), validate both plugin manifests, and verify the exact candidate's installation paths. Keep unresolved platform/service limitations explicit.
4. Build and archive matching local platform packages using the development guide. `release.py publish` updates local artifacts only; it does not upload anything to GitHub.
5. Export with `python scripts/export_public.py --output dist/coohom-freeform-source.zip`. Review every selected file and check for credentials, local paths, internal documents and obsolete history. The allowlist is `public-source.json`.
6. Apply the reviewed export to a separate checkout of the GitHub repository. Preserve its `.git` directory and existing public history. Review additions, changes and removals; do not overwrite community changes without integrating them upstream. Preserve executable Git modes on `bundler/marketplace/bootstrap` and `plugins/coohom-freeform/scripts/bootstrap`.
7. Run checks again in that checkout, commit and push the selected source snapshot. Verify installation from the real GitHub URL and check the GitHub Actions results.
8. Tag the accepted public commit. Publish ZIPs and SHA256 files to GitHub Releases only when their own acceptance and redistribution review are complete. Never commit binaries, internal build records or test histories to the public source repository.

## Before a production release

- Have the MCP maintainer deploy the production executor and publish its default URL, then verify the public npm version's protocol.
- Complete Windows and macOS installation, cold/warm MCP startup, sign-in, generation, import and continuous-editing acceptance for the exact candidate.
- Complete third-party redistribution notices for the exact bundled runtime and resolved dependencies. Preserve project LICENSE files in every distribution.
- Publish verified platform ZIPs and SHA256 files with explicit validation scope.
