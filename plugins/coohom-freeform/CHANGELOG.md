# Changelog

## 0.1.0+codex.20260918013054 — 2026-09-18

- Lock the complete Freeform 1.0.34 dependency tree and install with npm ci within the existing 300-second limit.

## 0.1.0+codex.20260918010126 — 2026-09-18

0.1.0 source preview, updated for the production executor.

- Default Lux3D to `https://www.coohom.com/pub/tool/bim/ai-home/mcp-executor` through its public environment option in both marketplace and platform ZIP launchers.
- Preserve explicit non-empty executor environment overrides and the MCP's task-specific URL construction.
- Temporarily pin Freeform to `freeform-modeling-mcp@1.0.34`; its newer latest CLI entry needs separate adapter validation. Lux3D continues to use public npm latest.
- Verify the pinned Freeform version during installation and startup; retain prior installations if dependency preparation fails.
- Keep the release version at 0.1.0; refresh the build identifier and matching distribution files.
- Include automatic Node/npm setup, bounded download retries, source, tests, documentation and the MIT license.

The executor address is production. macOS runtime acceptance and complete sign-in,
generation and import acceptance remain pending. Platform ZIPs are retained internally;
the pre-release provides lightweight marketplace archives. See the release guide for scope.
