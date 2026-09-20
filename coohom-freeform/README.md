# Coohom Freeform for Codex

Create real 3D scenes from images, descriptions and follow-up requests. Codex uses Freeform for structures and Lux3D image-to-3D generation for new or rebuilt furniture. Confirmed generation failures can fall back to Freeform for the affected asset; the floor-plan workflow also supports furniture without image references as described below. Small layout, size and material changes reuse existing objects. View the result, keep refining it and choose when to save.

For floor plans, Codex prefers to generate and show a rendered design image for every space when the current session supports image generation. If that capability is unavailable or generation fails, modeling automatically continues from the floor plan and your requirements, retaining usable references. Furniture without suitable images can use Freeform library assets or simple geometry, with approximations explained. The floor plan governs structure and dimensions; available references guide appearance. An explicit request to approve images before modeling is still respected. The plugin itself provides modeling and image-to-3D tools, not an image-generation service.

Lux3D works through your signed-in Coohom page. Install the plugin from the GitHub marketplace. Platform ZIP installers can be built from source; publication remains subject to installer acceptance and runtime redistribution checks.

## Version and release status

Read the version from the [plugin manifest](.codex-plugin/plugin.json) for the source checkout or installation you are using, and see [CHANGELOG.md](../CHANGELOG.md) for changes. The full version includes a `+codex.<UTC timestamp>` suffix to identify the build. A source version alone does not establish that matching release artifacts have been published.

Complete sign-in, generation and import acceptance remains pending. Freeform and Lux3D resolve `freeform-modeling-mcp@latest` and `@manycore/coohom-lux3d-mcp@latest` at installation time. The launcher starts the public CLI declared by each package. Installation records and lockfiles preserve the actual versions used.

## Install from the marketplace (recommended)

Requires Codex with plugin support, Git, Windows x64 or macOS ARM64, and network access to GitHub, nodejs.org, public npm and Coohom. Node/npm are prepared automatically. macOS runtime acceptance remains pending.

Follow the repository's [installation guide](https://github.com/manycore-research/Coohom-Freeform/blob/master/INSTALL.md), or run:

```sh
codex plugin marketplace add manycore-research/Coohom-Freeform
codex plugin add coohom-freeform@coohom
```

Before installing, check `codex plugin marketplace list --json` and `codex plugin list --json`. If another Coohom version or marketplace source is present, save your scene and resolve the replacement with the user. Keep one enabled Coohom Freeform installation; preserve unrelated plugins and shared MCP services.

After installation, run `codex plugin list --json` to verify the source, version and enabled state. Restart Codex, open a new task and enter `$coohom-freeform`. First startup may take several minutes. Wait for both MCPs to become ready before using them; plugin registration alone does not verify runtime startup.

Use actual filesystem paths rather than directory aliases or symlinks. Keep Windows extraction and cache paths short so the generated PowerShell script path remains below the Windows legacy path limit.

## Install from a lightweight release archive

Open [Releases](https://github.com/manycore-research/Coohom-Freeform/releases) and choose the most recent build's **coohom-freeform.tar.gz**. The versioned **coohom-freeform-0.1.0.tar.gz** contains the same files. Verify the download against that release's **SHA256SUMS**.

Extract every file, including hidden `.agents` and `.codex-plugin` directories, into a permanent folder. Follow the archive's **INSTALL.md**, which registers that folder as a local marketplace. Keep the folder after installation. GitHub's automatically generated Source code archives are full repository snapshots; the attached lightweight tar.gz files contain the package installation guide.

The lightweight package downloads Node/npm and both MCPs on first startup. It contains no `Install.cmd` or `Install.command`.

### Platform ZIP status

Windows and macOS platform ZIP installers have not been published. Maintainers can build them using the [development guide](https://github.com/manycore-research/Coohom-Freeform/blob/master/docs/development.md). Only a separately built platform ZIP contains `Install.cmd` or `Install.command`; those commands do not apply to the marketplace or lightweight tar.gz package.

## Installation recovery and dependencies

Both MCPs resolve public npm latest when explicitly installed or updated. A successful installation records their exact versions and lockfiles as one pair. Ordinary startup reuses that pair without checking for updates.

After a download failure, inspect the diagnostics and choose retry or stop. Consider another exact pair only after the explicit retry fails. Do not remove failure records or switch versions automatically. A port conflict requires identifying the existing service and resolving it with its owner before starting another instance.

See [marketplace troubleshooting](https://github.com/manycore-research/Coohom-Freeform/blob/master/docs/marketplace.md) for cache locations, recovery commands and migration details. Uninstalling the plugin does not remove its external runtime cache.

Coohom sign-in, generation and online assets require network access and the appropriate account permissions. Generation may use a free allowance or account Credits; the creation response determines availability, and the displayed Credits balance must not gate creation. No API key does not mean unlimited free usage. The installer does not read, request or write Aholo API keys.

## Executor and scene

On first use in a Codex task, the plugin calls Lux3D `prepare_workspace` and opens its task-specific `executorUrl`, including the matching `codexThreadId`. It does not open a fixed address without task parameters. On `executor_required`, connect that page and prepare again to confirm `connected`. Preparation consumes no generation credits. After an idle MCP restart, the same `threadId` reconnects the original page. Sign in to Coohom in the browser when requested; do not provide cookies or Authorization headers to the plugin. Calls follow the current MCP's public schemas.

Lux3D normally uses `ws://127.0.0.1:18766`; Freeform normally uses port 8765. These are independent connections. Lux3D tasks share a local Broker with isolation by `threadId`. The executor submits and queries generation; Freeform imports and edits models and displays the canvas. The plugin checks their real connections and the target scene separately.

Continued editing in the same task reuses the executor and canvas. Existing-object edits check only Freeform; generation and generation queries also check Lux3D. After an MCP restart, preparation rebinds the same task. `connected` proves only the Lux3D executor binding, not sign-in or a unique Freeform target.

Pages open visibly in the Codex in-app browser by default. If a missing public capability, actual tool failure or demonstrated in-app limitation prevents a required action, the plugin explains why and falls back to your local browser. If that also cannot perform the action, it asks for your help. An explicitly selected browser or page takes priority. Existing scenes are preserved across browser decisions.

Being signed out, an ordinary 404 or an unconnected MCP alone does not trigger browser fallback. Sign-in is performed by you; the plugin does not copy cookies between browsers. See [Browser sessions](skills/coohom-freeform/references/browser-session.md) for connection and recovery details.

## Image-to-3D generation and continued editing

Lux3D currently accepts image input only: a public HTTPS URL or actual local PNG/JPEG/WEBP bytes encoded as Base64. Individual furniture must be identified before using a room image; different furniture items are not submitted as one asset. References are sent to the generation service through the Coohom executor.

There is no direct text-to-model input or generation-mode, region or export-format selector. Without a suitable image, it first establishes a confirmed reference source or approach for missing images.

Distinct furniture with ready references uses bounded concurrency: at most 3 unfinished tasks by default, including in-flight/uncertain submissions, submitted, queued, generating and archiving tasks. You can lower this limit. Explicitly identical furniture is generated once and duplicated after verification. Independent structure work can proceed while furniture is generating.

The plugin reads the currently loaded tools, input/output schemas and public semantic descriptions to orchestrate generation and import. Accepted task IDs, model URLs, resource identifiers and dimensions come from actual responses. It maps asset data only when the two MCP declarations establish matching meanings. If a direct route lacks required original metadata, a declared generic model import may be used; otherwise the plugin reports the missing data. It does not fabricate IDs or dimensions. Scene verification is still required. See [Runtime capabilities](skills/coohom-freeform/references/runtime-capabilities.md).

A response whose current public semantics explicitly establish non-submission permits recovery: pause new submissions, restore the workspace and resume unchanged. An unsubmitted asset returns to pending and releases only its current reservation; a query preserves its original task ID and generation state. Timeouts and uncertain submissions must not be repeated blindly. Only confirmed generation failure permits Freeform fallback. Sign-in, connection, format and import issues are handled separately.

You can continue editing furniture, layout and materials while preserving unrelated objects. A replacement asset must be correctly imported before the old object is removed. Confirmed material application failures trigger a search for real similar alternatives and verification of the result. Existing imported assets remain editable.

For image-based modeling, material selection compares type, color, texture and sheen against the reference, then checks again after modeling. Clear mismatches trigger a closer replacement and another comparison. Each object or material region permits at most **2 automatic replacements**, excluding initial selection. Failed candidate replacements share that allowance. If differences remain or you are still dissatisfied, the plugin shows the current result and asks you to choose the next step. See [Reference-based materials](skills/coohom-freeform/references/modeling-contract.md#reference-based-materials-and-the-two-replacement-limit).

See [Generation and import](skills/coohom-freeform/references/ai-generation.md) for detailed contracts and recovery rules.

## Try it

> Use $coohom-freeform to build a space from this image. Keep the wood tones and the desk by the window, and show me the modeling process.

> Move that desk closer to the window, then adjust the chair and floor materials.

> Keep the current room and regenerate the sofa from this individual reference image.

The plugin distinguishes known facts, assumptions and unknowns, and checks structure, layout, proportions, visual features and affected objects against your goal. It asks you to decide when core interpretations differ, reuses existing authorization and keeps local edits within scope.

The final result is shown on the actual canvas, with verified results, approximations and limitations explained. Continue refining it through conversation or choose to save it yourself. The plugin stays within your requested scope and does not automatically save or publish.

## Verification scope

Static checks, installer tests, MCP initialization and tool discovery are recorded separately. They do not replace real sign-in, generation, import and visual acceptance.

Browser automation depends on the current Codex session. Browser-tool limitations and Coohom account permissions are distinct. Structural checks of a macOS package do not prove it has run successfully on a Mac.

## Package contents

- `.codex-plugin/plugin.json`: version, display information and starter prompts.
- `.mcp.json`: MCP launch configuration generated for the selected distribution.
- `scripts/`: marketplace bootstrap and dependency-management scripts; Node/npm and MCP dependencies live in the external runtime cache.
- `skills/coohom-freeform/SKILL.md`: request interpretation, creation, verification and continued editing.
- `skills/coohom-freeform/references/`: browser, Freeform and Lux3D contracts.
