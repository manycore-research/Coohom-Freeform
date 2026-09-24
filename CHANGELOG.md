# Changelog

## 0.1.1+codex.20260924100348 — 2026-09-24

### Added
- Installation status, isolated MCP diagnostics, plugin and MCP upgrades, explicit recovery, and cleanup of unused resources.
- Interior lighting review after modeling, with per-room checks, rendered verification, and preservation of existing lights and manual adjustments.
- Automatic reference preparation and bounded Freeform library or simple-geometry alternatives when generation or import cannot complete.

### Changed
- Limit generation waiting to five minutes per asset and technical reconnection to one attempt within 60 seconds; reconcile uncertain imports and avoid duplicate placement.
- Resolve both MCPs from public npm latest on installation or explicit upgrade, record exact installed versions, and reuse them on normal startup.
- Use the production Coohom executor and preserve the task-specific URL returned by Lux3D.
- Keep sign-in, Credits, ambiguous scene writes, and unmet design constraints under the user's control.

### Fixed
- Start the Freeform launcher correctly through directory aliases, including macOS temporary-directory aliases.
- Recognize marketplace-owned services without removing unrelated plugins or shared MCPs.
- Keep status checks local and read-only, and retain explicit recovery after failed dependency preparation.

## 0.1.0 — 2026-09-20

- Initial public release of the Codex marketplace plugin and lightweight installation archive.
- Image-guided scene creation, furniture generation and import, and continuous layout and material editing.
- Automatic Node/npm preparation, paired MCP installation, and recorded dependency versions.
- MIT-licensed source and included third-party notices.
