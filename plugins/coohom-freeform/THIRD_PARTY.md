# Third-party components

This project uses the [MIT License](LICENSE), copyright (c) 2026 Coohom Freeform.
Third-party components retain their own licenses and copyright notices.

| Component | Source / policy | Distribution |
| --- | --- | --- |
| Node.js 22.23.2 | Official nodejs.org archives with SHA256 verification | Bundled in platform ZIPs; downloaded for marketplace installs; original LICENSE retained under runtime/node |
| npm | Included in the selected Node.js archive | Original package metadata and license files retained under runtime/node/npm |
| freeform-modeling-mcp | Public npm, latest channel | Downloaded during installation; declared dependencies and original notices retained |
| @manycore/coohom-lux3d-mcp | Public npm, latest channel | Downloaded during installation; independent upstream repository |
| JSZip 3.10.2 | Freeform MCP dependency; MIT selected from its dual license | MIT copyright and permission notice included below; installed upstream license preserved |
| Python | Python 3.11+ standard library | Build/maintenance tool; not bundled |
| Codex plugin-creator scripts | Official Codex skill installation | Build-time scaffold/cachebuster dependency; not copied into this repository |

## JSZip license selection

For JSZip 3.10.2, this project elects the **MIT** option from the upstream
`(MIT OR GPL-3.0-or-later)` license expression. See the complete
[MIT copyright and permission notice](licenses/jszip-3.10.2-MIT.txt) and
[version-specific selection and provenance](licenses/jszip.json).
The [upstream license](https://raw.githubusercontent.com/Stuk/jszip/v3.10.2/LICENSE.markdown)
explicitly permits this choice. Upstream package metadata, lockfile license
expressions and the original LICENSE.markdown are not rewritten or removed.

This selection does not replace other dependencies' license obligations or
establish that organizational approval has been obtained. Retain any required
internal approval separately from public source exports.

## Actual installations and release verification

Both MCPs resolve public npm latest when installed or explicitly updated.
Each installation preserves its own package-lock.json; runtime/mcp/mcp-pair.json
identifies the active combination and installation directories. The plugin does
not inject or pin tsx; it is installed only if an upstream package declares it.

Release maintainers verify JSZip against the actual Freeform installation and
retain the resulting report with the release. The check covers declared JSZip
package versions, lockfile provenance, the original license text and the selected
MIT notice. A missing JSZip entry requires upstream review because a package may
have removed or embedded the dependency. This check is not a complete license
audit of Node/npm, all MCP dependencies or code embedded inside bundles.

Verification runs only during release preparation/export/publication. It does not
block end-user installation or startup, and it does not certify dependencies
resolved by future latest installations. Review the remaining resolved dependency
graph and bundled Node/npm notices separately before distributing platform ZIPs.
