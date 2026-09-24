# Release status and maintenance

## Version and distribution

**v0.1.1 is an official public release.** Installation packages are available from the [v0.1.1 release](https://github.com/manycore-research/Coohom-Freeform/releases/tag/v0.1.1).

This repository contains the plugin, GitHub marketplace, installer/build sources,
tests and documentation under the MIT license. Read the version from the
[plugin manifest](../coohom-freeform/.codex-plugin/plugin.json) for the source
checkout or installation being used. The full version includes a
`+codex.<UTC timestamp>` build identifier. Published tags and assets identify
released artifacts; a source checkout version alone does not establish publication.
Platform ZIP installers are not published.

## Service requirements

- Generation requires Coohom sign-in, service permissions and available credits. The hosted editor, generation service, accounts and billing are outside this source release.
- Installation uses public npm with `freeform-modeling-mcp@latest` and `@manycore/coohom-lux3d-mcp@latest`. Successful installations record exact versions and lockfiles; later starts reuse them.
- Use the complete task URL returned by Lux3D. Use actual filesystem paths and keep Windows extraction/cache paths short.

## GitLab development, GitHub export

The development repository remains in GitLab. GitHub contains a reviewed source
snapshot and its own public commit history; never mirror internal Git history.
Apply accepted GitHub contributions to the development repository before exporting.

1. Prepare a version in the development repository with `python scripts/release.py prepare --summary "User-visible change"`. This archives the current local artifacts and uses the official plugin-creator cachebuster.
2. Update the repository-root [CHANGELOG.md](../CHANGELOG.md) and regenerate the marketplace with `python scripts/prepare_marketplace.py --scaffold <plugin-creator>/scripts/create_basic_plugin.py`.
3. Run the checks in [development.md](development.md), validate both plugin manifests, and verify the exact candidate's installation paths. Keep unresolved platform/service limitations explicit.
4. Build matching local platform packages using the development guide. Verify JSZip using the exact candidate's installed Freeform directory, then archive with `python scripts/release.py publish --freeform-runtime <freeform-install-directory>` (add `--repack` for static-only package refreshes). This updates local artifacts only; it does not upload anything to GitHub.
5. Export with `python scripts/export_public.py --freeform-runtime <freeform-install-directory> --output dist/coohom-freeform-source.zip`. Retain the adjacent `.zip.licenses.json` report and SHA256 file with the release evidence. Review every selected file and check for credentials, local paths, internal documents and obsolete history. The allowlist is `public-source.json`.
6. Apply the reviewed export to a separate checkout of the GitHub repository. Preserve its `.git` directory and existing public history. Review additions, changes and removals; do not overwrite community changes without integrating them upstream. Preserve executable Git modes on `bundler/marketplace/bootstrap` and `plugins/coohom-freeform/scripts/bootstrap`.
7. Run checks again in that checkout, commit and push the selected source snapshot. Verify installation from the real GitHub URL and check the GitHub Actions results.
8. Tag the accepted public commit. Publish ZIPs and SHA256 files to GitHub Releases only when their own acceptance and redistribution review are complete. Never commit binaries, internal build records or test histories to the public source repository.

## Before a production release

### JSZip release-only verification

Maintain the explicit MIT selection in [THIRD_PARTY.md](../THIRD_PARTY.md),
the full copyright and permission text in [the MIT notice](../licenses/jszip-3.10.2-MIT.txt),
and the version, original license fingerprint and public npm provenance in
[licenses/jszip.json](../licenses/jszip.json). Do not change upstream license fields
or remove original downloaded license files to silence a scanner. Record required
organizational approval separately; automated checks do not establish approval.

Use the actual dependency directory from the release candidate's installation.
It contains `package-lock.json` and `node_modules`, not the plugin root.
For a paired installation, resolve `freeform.directory` from `runtime/mcp/mcp-pair.json`
relative to `runtime/mcp`.

```sh
python -B scripts/third_party.py --freeform-runtime <freeform-install-directory> --report <release-evidence>/jszip-license.json
```

The command reads local files only. It verifies every JSZip entry in that npm
lockfile, including nested entries, against installed manifests, public npm
provenance, the original license text and the shipped MIT notice. It records the
actual Freeform/JSZip versions and hashes without recording host paths. Missing
JSZip is not an automatic pass: review whether the upstream package removed or
embedded it. Review bundled dependencies and all other component licenses separately.

Both release export and `release.py publish` run this check before writing release
artifacts. Platform release records retain it in `provenance.jszipLicenseReview`;
source exports bind their adjacent report to the archive SHA256. The archive-only
command preserves historical bytes and does not retroactively certify old releases.

If a new JSZip version, package provenance or license text appears, review the
upstream version and update the selection, notice and checks together before
releasing. Use the scanner's version-scoped license-selection mechanism for the
reviewed component; never suppress all GPL matches globally.

Normal CI can run `python -B scripts/third_party.py --notices-only` and export with
`--source-only`. These validate a development snapshot, not installed dependency
licenses, and are not a substitute for the release commands above. No license gate
runs during user installation, updates or startup. Because both MCPs use
latest, a release report covers only the installation that was actually checked.

### Release maintenance checklist

- Verify the resolved Freeform public CLI contract and tool schemas for each installation candidate.
- Keep the production executor setting (`www.coohom.com`) aligned with the public MCP configuration contract; revalidate the returned task URL after MCP updates.
- Complete Windows and macOS installation, cold/warm MCP startup, sign-in, generation, import and continuous-editing acceptance for the exact candidate.
- Complete third-party redistribution notices for the exact bundled runtime and resolved dependencies. Preserve project LICENSE files in every distribution.
- Publish verified platform ZIPs and SHA256 files with explicit validation scope.
