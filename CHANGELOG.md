# Changelog

## Public branch 0.1.1

- Sync plugin source 0.1.22 while retaining public documentation edits.
- Use public npm latest for both MCPs and the production executor at www.coohom.com.
- Internal release notes below describe development history, not the public branch dependency policy.

## 0.1.22+codex.20260924093339 — 2026-09-24

- Pin default Freeform MCP installation to 1.0.39-rc.1 and retain the selected version on retry.
- Require per-room interior lighting assessment, rendered verification and named final render images before completion.

## 0.1.21+codex.20260924030429 — 2026-09-24

- Require explicit doubleFace for rectangle lights, defaulting omitted values to false and verifying readback.

## 0.1.20+codex.20260923123815 — 2026-09-23

- Route task-specific executor pages to prod-test-seoul.coohom.com through the public Lux3D configuration in ZIP and marketplace installations.

## 0.1.19+codex.20260923114106 — 2026-09-23

- Allow an explicitly selected exact MCP pair on a fresh ZIP installation without bypassing failure recovery.

## 0.1.18+codex.20260923113354 — 2026-09-23

- Check whole-scene interior lighting after modeling completes and Render shows a ready first frame.
- Preserve existing lights and manual adjustments through full-list updates, with separate readback and visual verification.
- Clarify Render-required internal saving, continuous edits and evidence-based lighting recovery.

## 0.1.17+codex.20260923102121 — 2026-09-23

- Recognize marketplace-owned MCP bootstrap commands using their verified cache identity, working directory and declarations while retaining shared-service conflict checks.

## 0.1.16+codex.20260923101323 — 2026-09-23

- Keep installer plugin status queries local so remote catalog outages do not block installation, verification or recovery.

## 0.1.15+codex.20260923095109 — 2026-09-23

- Automatically recover from Lux3D technical generation and import failures with similar Freeform library assets, then simple geometry; retain user decisions for sign-in and insufficient Credits.
- Bound generation waiting to five minutes per asset and connection recovery to one attempt within 60 seconds; preserve unresolved tasks and prevent late output from duplicating or replacing fallback objects.
- Reconcile scene writes before substitution, bound model search and candidate replacement, and verify actual placement while reporting only consequential approximations.
- Add read-only installation status, isolated MCP startup diagnostics, explicit upgrade recovery and an integrated plugin-plus-MCP upgrade command.
- Clean recognized superseded resources after successful upgrades, retain only current dependencies, and provide preview-first cleanup plus separate external-cache removal after uninstall.
- Prepare Lux3D references automatically; use suitable original-image crops when image generation is unavailable or fails, without asking users to choose preprocessing methods.

## 0.1.14+codex.20260920070746 — 2026-09-20

- Select the MIT license for JSZip 3.10.2 and include its complete notices in marketplace and platform distributions.
- Verify actual JSZip dependencies during release and retain license evidence without blocking user installation or startup.

## 0.1.13+codex.20260920063613 — 2026-09-20

- Use the task URL provided by Lux3D MCP.

## Unreleased — local testing

- Merge native Credits recovery choices and free-allowance eligibility rules while preserving runtime MCP capability discovery.

- Discover current MCP tools and schemas at runtime; remove version-specific field and asset-ID mappings from the Skill and references.
- Install both MCPs as one atomic pair, with explicit retry followed by user-selected alternative versions; never automatically fall back.
- Launch public package bin entries without parsing wrappers or pinning tsx. Reuse MCP dependencies across prose-only plugin updates.
- Distinguish installation, tool discovery, semantic matching and actual design verification. Installer packages have not been rebuilt for this change.

## Unreleased — local validation

- Align skill contracts with Freeform 1.0.35-rc.1 and Lux3D 0.2.1: use generic model import without the removed `brandgoodid` input and document verified direct placement separately.
- Document KDS signature lookup and script execution, embedded-canvas readiness, and installation-specific startup timeouts.
- This development update changes local plugin instructions only; distribution installers remain pending user validation.

## 0.1.12+codex.20260918082933 — 2026-09-18

- Require the native Codex request_user_input dialog for Lux3D insufficient-Credits recovery.

## 0.1.11+codex.20260918080525 — 2026-09-18

- Show Lux3D insufficient-Credits recovery in the native Codex option dialog

## 0.1.11+codex.20260918062133 — 2026-09-18

- Merge codex-plugin Credits recovery and bundled Freeform CLI support; resolve both MCPs from public npm latest.
- Preserve floor-plan modeling when image generation is unavailable and retain available references.

## 0.1.10+codex.20260918050204 — 2026-09-18

- Support the latest bundled Freeform MCP CLI and Lux3D MCP 0.2.1.
- Add explicit Lux3D Credits recovery with pay, Freeform fallback, and stop choices.

## 0.1.7+codex.20260917080305 — 2026-09-17

- Translate plugin instructions, examples, documentation and installation diagnostics into English.
- Keep ZIP and GitHub marketplace distributions aligned and verify English release content.

## 0.1.6+codex.20260917071139 — 2026-09-17

- Add a GitHub marketplace installation path that downloads and verifies Node on first startup, without requiring preinstalled Node/npm.
- Use separate MCP caches, preparation locks and failure cleanup; reuse installed dependencies on later startups while retaining both platform ZIP installers.

## 0.1.5+codex.20260917031654

Initial public-release candidate.

- Image-guided scene creation and continuous furniture, layout and material editing.
- Windows x64 and macOS ARM64 installers with bundled Node/npm.
- Public npm integration with freeform-modeling-mcp and @manycore/coohom-lux3d-mcp.
- External Lux3D npm dependency, clean plugin source export, contributor documentation and release checklist.

The executor temporarily uses the approved test environment. Production URL replacement, licensing confirmation and full platform/online acceptance remain pending. Package checks do not imply those checks passed.

## 0.1.1+codex.20260918030312 — 2026-09-18

- Automatically continue floor-plan modeling when image generation is unavailable, fails or leaves spaces unfinished, while retaining usable references.
- Allow Freeform library assets or simple geometry for floor-plan furniture without suitable images, with approximations disclosed and generation-task safeguards preserved.

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
