# Third-party components

This project is licensed under the [MIT License](LICENSE), copyright (c) 2026 Coohom Freeform. Third-party components retain their own licenses and copyright notices.

| Component | Source / policy | Distribution |
| --- | --- | --- |
| Node.js 22.23.2 | Official nodejs.org archives with SHA256 verification | Bundled; original LICENSE retained under runtime/node |
| npm | Included in the selected Node.js archive | Bundled with its package metadata and license files |
| freeform-modeling-mcp | Public npm, latest channel | Downloaded by installer; original package metadata and notices retained |
| tsx | Version in bundler/freeform-policy.json | Downloaded with freeform; transitive dependencies recorded in installed lockfile |
| @manycore/coohom-lux3d-mcp | Public npm, latest channel; independent source repository | Downloaded by installer; not vendored into plugin source |
| Python | Python 3.11+ standard library | Build/maintenance tool; not bundled |
| Codex plugin-creator scripts | Official Codex skill installation | Build-time scaffold/cachebuster dependency; not copied into this repository |

The install records and lockfiles identify the exact resolved MCP versions. License and redistribution review must cover that resolved dependency graph, including the dependencies shipped inside Node/npm. Do not replace third-party notices with a blanket project license.
