# Coohom Freeform for Codex

Create real 3D scenes from images, descriptions and follow-up requests. Codex uses Freeform for structures and Lux3D image-to-3D generation for new or rebuilt furniture. Recoverable technical failures automatically use similar Freeform library assets, then simple geometry, so scene work can continue. The floor-plan workflow also supports furniture without image references as described below. Small layout, size and material changes reuse existing objects. View the result, keep refining it and choose when to save.

For floor plans, Codex prefers to generate and show a rendered design image for every space when the current session supports image generation. If that capability is unavailable or generation fails, modeling automatically continues from the floor plan and your requirements, retaining usable references. Furniture without suitable images can use Freeform library assets or simple geometry, with approximations explained. The floor plan governs structure and dimensions; available references guide appearance. An explicit request to approve images before modeling is still respected. The plugin itself provides modeling and image-to-3D tools, not an image-generation service.

Lux3D works through your signed-in Coohom page. Install the plugin from the GitHub marketplace. Platform ZIP installers can be built from source; publication remains subject to installer acceptance and runtime redistribution checks.

## Interior lighting

After all interior modeling for a turn is complete, Codex enters Render, waits for a visible first frame and a ready synchronization channel, then checks lighting across every room. This also applies to local furniture or material edits. Functional light updates preserve existing lights and manual adjustments; satisfactory lighting is left unchanged. Parameter readback and rendered visual acceptance are reported separately.

Lighting requires the installed Freeform MCP to expose public lighting read/write tools. Installation still resolves latest; a plugin update alone does not guarantee those tools. Entering Render may save the model internally. Codex does not additionally save or publish unless requested, and the startup save does not prove later lighting changes were persisted.

## Version and release status

Read the version from the [plugin manifest](.codex-plugin/plugin.json) for the source checkout or installation you are using, and see [CHANGELOG.md](CHANGELOG.md) for changes. The full version includes a `+codex.<UTC timestamp>` suffix to identify the build. A source version alone does not establish that matching release artifacts have been published.

Complete sign-in, generation and import acceptance remains pending. Freeform and Lux3D resolve `freeform-modeling-mcp@latest` and `@manycore/coohom-lux3d-mcp@latest` at installation time. The launcher starts the public CLI declared by each package. Installation records and lockfiles preserve the actual versions used.

For an explicitly selected pair on a fresh ZIP install, run `Install.cmd --install-mcp-versions <freeform-exact> <lux3d-exact>` (macOS: `./Install.command`). Supply both exact versions, including any prerelease suffix. The default remains latest. This option does not bypass an interrupted or failed installation: use the reported retry flow. Do not combine initial selection with `--retry-mcp` or the recovery-only `--mcp-versions` option.

## Marketplace maintenance

From the plugin source reported by Codex, use `scripts/manage status` for read-only status, `scripts/manage doctor` for a startup check, and `scripts/manage upgrade` to update the plugin and both MCPs. On Windows use `scripts/manage.cmd`. Successful upgrades automatically clean recognized unused old resources and retain the current installation only. Failures wait for an explicit retry, old-version recovery or stop decision. `cleanup` previews deletion and `uninstall` retains external caches for a separate removal choice. See the [maintenance guide](https://github.com/manycore-research/Coohom-Freeform/blob/master/docs/marketplace.md#cache-and-recovery).

## Install or upgrade from a ZIP

1. Install Codex, download the latest package for your system and **extract all files**.
2. On Windows, run `Install.cmd`; on macOS, run `Install.command`. Keep the package contents together.
3. Review the displayed target version and installation location. Wait while the installer prepares both MCPs over the network. Existing installations are listed with their versions and sources.
4. For an upgrade, save your scene and stop active modeling after preparation finishes, then enter `Y` when prompted. The installer removes the listed old plugin and installs the new version. Pressing Enter or canceling does not remove it. First installation requires no removal confirmation. Check the final plugin and both MCP versions.
5. Restart Codex, confirm **Coohom Freeform** is enabled in the plugin list, and open a new task. An old task may retain old tools and cannot verify an upgrade.

You do not need to uninstall manually first. The same entry supports first installation, upgrades and same-version reinstallation. Existing installations are identified from the registrations reported by Codex. Removal is limited to the listed Coohom plugins; scenes, personal development sources and other plugins are preserved. The installer does not terminate active modeling processes, so stop tasks before upgrading and restart Codex afterward.

If standalone Freeform or Lux3D MCP services conflict, the installer lists them and pauses. Find the listed service under **MCP servers** in Codex settings. If no other task needs it, disable it and run the installer again. If it is shared and still needed, cancel and coordinate with its configuration owner. Do not delete the entire Codex configuration file.

ZIP packages include Node **22.23.2** and npm; no system Node/npm installation is required. Each installer run downloads `freeform-modeling-mcp@latest` and `@manycore/coohom-lux3d-mcp@latest`. Ordinary startup uses installed local dependencies without checking for updates. The ZIP installation gives Lux3D 120 seconds to initialize.

The policies are in `runtime/mcp/freeform-policy.json` and `runtime/mcp/lux3d-policy.json`. `mcp-pair.json` records the atomically activated pair and exact versions; `mcp-install-state.json` records update/recovery state. Each installation directory has a `package-lock.json` with exact dependencies. Dependencies can be explicitly updated without upgrading the plugin: use bundled Node with `runtime/mcp/manage-mcp.mjs <plugin-root> install`. Ordinary startup stays on the recorded pair.

### If installation stops

- **Download failure:** the installer first offers retry or stop. If the explicit retry fails, it offers another exact pair of versions or stop. It never automatically falls back. Noninteractive recovery uses `--retry-mcp`, then only after the next user choice `--mcp-versions <freeform-exact> <lux3d-exact>`. Both dependencies must succeed before activation; old files are preserved without selecting them.
- **Removal or registration failure:** follow the actual status and recovery instructions shown. Downloaded dependencies do not mean installation is complete.
- **Missing old source, version mismatch or source changed during preparation:** installation stops before removal. Verify the reported source, resolve the mismatch and retry.
- **New version or path verification failure:** installation is reported as incomplete. Keep the error details, rerun the latest package or contact the maintainer.
- **Another installation is running:** wait for it to finish. After an interrupted run, confirm no installation process remains before handling the reported lock file.

The installer uses official Codex commands to remove and register plugins. It does not automatically delete personal sources, shared MCP services or historical directories whose ownership is unclear. It reports retained paths. After verifying the new version, clean up only directories you can identify as no longer needed.

Installation and updates require public npm and Node.js download access. Codex, Coohom sign-in, generation and online assets require network access and the appropriate account permissions. Generation may use a free allowance or account Credits; the creation response determines availability, and the displayed Credits balance must not gate creation. No API key does not mean unlimited free usage. The installer does not read, request or write Aholo API keys.

Command-line users can append `--check` to inspect the installation plan and conflicts without writing files or configuration. Unattended upgrades require explicit `--yes` approval to remove the listed old Coohom plugins. This flag does not approve dependency retries, alternative versions, or bypass standalone/shared MCP conflicts.

## Executor and scene

The plugin targets the production executor at `https://www.coohom.com/pub/tool/bim/ai-home/mcp-executor` through Lux3D's public `LUX3D_MCP_EXECUTOR_URL` setting. Both ZIP and marketplace installations use this address. Sign in to this environment when prompted; Lux3D adds the current task identity to the returned URL.

On first use in a Codex task, the plugin calls Lux3D `prepare_workspace` and opens its task-specific `executorUrl`, including the matching `codexThreadId`. It does not open a fixed address without task parameters. On `executor_required`, connect that page and prepare again to confirm `connected`. Preparation consumes no generation credits. After an idle MCP restart, the same `threadId` reconnects the original page. Sign in to Coohom in the browser when requested; do not provide cookies or Authorization headers to the plugin. Calls follow the current MCP's public schemas.

Lux3D normally uses `ws://127.0.0.1:18766`; Freeform normally uses port 8765. These are independent connections. Lux3D tasks share a local Broker with isolation by `threadId`. The executor submits and queries generation; Freeform imports and edits models and displays the canvas. The plugin checks their real connections and the target scene separately.

Continued editing in the same task reuses the executor and canvas. Existing-object edits check only Freeform; generation and generation queries also check Lux3D. After an MCP restart, preparation rebinds the same task. `connected` proves only the Lux3D executor binding, not sign-in or a unique Freeform target.

Pages open visibly in the Codex in-app browser by default. If a missing public capability, actual tool failure or demonstrated in-app limitation prevents a required action, the plugin explains why and falls back to your local browser. If that also cannot perform the action, it asks for your help. An explicitly selected browser or page takes priority. Existing scenes are preserved across browser decisions.

Being signed out, an ordinary 404 or an unconnected MCP alone does not trigger browser fallback. Sign-in is performed by you; the plugin does not copy cookies between browsers. See [Browser sessions](skills/coohom-freeform/references/browser-session.md) for connection and recovery details.

## Image-to-3D generation and continued editing

Lux3D currently accepts image input only: a public HTTPS URL or actual local PNG/JPEG/WEBP bytes encoded as Base64. Individual furniture must be identified before using a room image; different furniture items are not submitted as one asset. References are sent to the generation service through the Coohom executor.

Codex prepares individual references automatically, reusing suitable images or isolating furniture from the original. If image generation is unavailable or fails, it uses a suitable original-image crop and continues modeling without asking you to choose the preprocessing method. It asks for clarification or a clearer reference only when essential visual information or design intent is missing, and respects explicit requests to approve references first. There is no direct text-to-model input or generation-mode, region or export-format selector.

Distinct furniture with ready references uses bounded concurrency: at most 3 unfinished tasks by default, including in-flight/uncertain submissions, submitted, queued, generating and archiving tasks. You can lower this limit. Explicitly identical furniture is generated once and duplicated after verification. Independent structure work can proceed while furniture is generating.

The plugin reads the currently loaded tools, input/output schemas and public semantic descriptions to orchestrate generation and import. Accepted task IDs, model URLs, resource identifiers and dimensions come from actual responses. It maps asset data only when the two MCP declarations establish matching meanings. If a direct route lacks required original metadata, a declared generic model import may be used; otherwise it preserves generated output and uses Freeform alternatives. It does not fabricate IDs or dimensions. Scene verification is still required. See [Runtime capabilities](skills/coohom-freeform/references/runtime-capabilities.md).

A response whose current public semantics explicitly establish non-submission permits one safe recovery with the original input. An unsubmitted asset releases only its current reservation; a query preserves its original task ID and generation state. Timeouts and uncertain submissions must not be repeated blindly.

Generation failures, technical service/connection problems and unusable import results automatically fall back for the affected furniture. Each asset has a **five-minute generation waiting budget from its first submission attempt**, preserved across reconnection and continued conversation. Technical connection recovery is tried once for at most 60 seconds within that budget. While waiting, Codex builds independent scene elements; remaining unsubmitted furniture can use Freeform when generation slots are full. Confirmed service-wide technical unavailability routes the remaining furniture through Freeform for that turn.

Fallback searches similar library assets in at most two rounds, then uses simple geometry when necessary. It preserves your layout, function and key dimensions, verifies actual placement and briefly describes consequential approximations at completion. Generated output and unresolved task records are retained; choosing a substitute does not cancel generation or imply a refund. Late results never automatically add another object or replace your scene. You can explicitly request a replacement later.

Sign-in and insufficient Credits still require your choice. If Freeform is also unavailable, a previous import/placement cannot be reconciled, or your explicit design requirements cannot be preserved, Codex pauses the affected furniture and asks only for the necessary action or decision. Tool traces may remain visible in Codex; a recovered error is not presented as successful generation. See [Generation and import](skills/coohom-freeform/references/ai-generation.md#automatic-technical-fallback).

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
- `.mcp.json`: MCP launch configuration generated by the installer.
- `runtime/node/` and `runtime/mcp/`: platform Node and recorded MCP dependencies for ZIP installations.
- `skills/coohom-freeform/SKILL.md`: request interpretation, creation, verification and continued editing.
- `skills/coohom-freeform/references/`: browser, Freeform and Lux3D contracts.
