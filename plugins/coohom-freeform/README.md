# Coohom Freeform for Codex

Create real 3D scenes from images, descriptions and follow-up requests. Codex uses Freeform for structures and Lux3D image-to-3D generation for new or rebuilt furniture. Confirmed generation failures can fall back to Freeform for the affected asset. Small layout, size and material changes reuse existing objects. View the result, keep refining it and choose when to save.

For floor plans, Codex first generates and shows a rendered design image for every space before modeling. The floor plan governs structure and dimensions; each space's image guides furniture, colors and materials. This requires image-generation capability in the current session. Modeling waits until all spaces have their images.

Lux3D works through your signed-in Coohom page. No Aholo API key is required. The 0.1.0 public preview is installed from the GitHub marketplace. Platform ZIP installers can be built from source, but are not published with this preview.

## Version and release status

See [CHANGELOG.md](CHANGELOG.md) for the version and changes. The full version includes a `+codex.<UTC timestamp>` suffix to identify the installed build. The public source export excludes earlier internal test releases.

The plugin defaults to the production executor at `https://www.coohom.com/pub/tool/bim/ai-home/mcp-executor` through the public `LUX3D_MCP_EXECUTOR_URL` option. An explicit non-empty environment override is preserved. Complete online acceptance remains pending; changing the endpoint does not verify sign-in, generation or import. Installation resolves both MCPs from public npm `latest`; installation records and lockfiles preserve the actual versions used.

## Install or upgrade from a ZIP

1. Install Codex, download the latest package for your system and **extract all files**.
2. On Windows, run `Install.cmd`; on macOS, run `Install.command`. Keep the package contents together.
3. Review the displayed target version and installation location. Wait while the installer prepares both MCPs over the network. Existing installations are listed with their versions and sources.
4. For an upgrade, save your scene and stop active modeling after preparation finishes, then enter `Y` when prompted. The installer removes the listed old plugin and installs the new version. Pressing Enter or canceling does not remove it. First installation requires no removal confirmation. Check the final plugin and both MCP versions.
5. Restart Codex, confirm **Coohom Freeform** is enabled in the plugin list, and open a new task. An old task may retain old tools and cannot verify an upgrade.

You do not need to uninstall manually first. The same entry supports first installation, upgrades and same-version reinstallation, including earlier installations from `personal`. Removal is limited to the listed Coohom plugins; scenes, personal development sources and other plugins are preserved. The installer does not terminate active modeling processes, so stop tasks before upgrading and restart Codex afterward.

If standalone Freeform or Lux3D MCP services conflict, the installer lists them and pauses. Find the listed service under **MCP servers** in Codex settings. If no other task needs it, disable it and run the installer again. If it is shared and still needed, cancel and coordinate with its configuration owner. Do not delete the entire Codex configuration file.

ZIP packages include Node **22.23.2** and npm; no system Node/npm installation is required. Each installer run downloads the current `freeform-modeling-mcp@latest` and `@manycore/coohom-lux3d-mcp@latest`. Ordinary startup uses installed local dependencies without checking for updates. The ZIP installation gives Lux3D 120 seconds to initialize.

The policies are in `runtime/mcp/freeform-policy.json` and `runtime/mcp/lux3d-policy.json`. The corresponding `freeform-install.json` and `lux3d-install.json` record actual versions. Each installation directory has a `package-lock.json` with exact dependencies. Reloading skills or running `plugin add` alone does not replace the ZIP installer's dependency-update step.

### If installation stops

- **Download failure:** the existing plugin is not removed before new dependencies are ready. Check network access and run the installer again.
- **Removal or registration failure:** follow the actual status and recovery instructions shown. Downloaded dependencies do not mean installation is complete.
- **Missing old source, version mismatch or source changed during preparation:** installation stops before removal. Verify the reported source, resolve the mismatch and retry.
- **New version or path verification failure:** installation is reported as incomplete. Keep the error details, rerun the latest package or contact the maintainer.
- **Another installation is running:** wait for it to finish. After an interrupted run, confirm no installation process remains before handling the reported lock file.

The installer uses official Codex commands to remove and register plugins. It does not automatically delete personal sources, shared MCP services or historical directories whose ownership is unclear. It reports retained paths. After verifying the new version, clean up only directories you can identify as no longer needed.

Installation and updates require public npm and Node.js download access. Codex, Coohom sign-in, generation and online assets require network access and the appropriate account permissions. No API key does not mean free credits. The installer does not read, request or write Aholo API keys.

Command-line users can append `--check` to inspect the installation plan and conflicts without writing files or configuration. Unattended upgrades require explicit `--yes` approval to remove the listed old Coohom plugins. This flag does not bypass standalone/shared MCP conflicts.

## Executor and scene

On first use in a Codex task, the plugin calls Lux3D `prepare_workspace` and opens its task-specific `executorUrl`, including the matching `codexThreadId`. It does not open a fixed address without task parameters. On `executor_required`, connect that page and prepare again to confirm `connected`. Preparation consumes no generation credits. After an idle MCP restart, the same `threadId` reconnects the original page. Sign in to Coohom in the browser when requested; do not provide cookies or Authorization headers to the plugin. Calls follow the current MCP's public schemas.

Lux3D normally uses `ws://127.0.0.1:18766`; Freeform normally uses port 8765. These are independent connections. Lux3D tasks share a local Broker with isolation by `threadId`. The executor submits and queries generation; Freeform imports and edits models and displays the canvas. The plugin checks their real connections and the target scene separately.

Continued editing in the same task reuses the executor and canvas. Existing-object edits check only Freeform; generation and generation queries also check Lux3D. After an MCP restart, preparation rebinds the same task. `connected` proves only the Lux3D executor binding, not sign-in or a unique Freeform target. Other Coohom environments can use the public `LUX3D_MCP_EXECUTOR_URL` configuration; the plugin still uses the MCP's full returned task URL.

Pages open visibly in the Codex in-app browser by default. If a missing public capability, actual tool failure or demonstrated in-app limitation prevents a required action, the plugin explains why and falls back to your local browser. If that also cannot perform the action, it asks for your help. An explicitly selected browser or page takes priority. Existing scenes are preserved across browser decisions.

Being signed out, an ordinary 404 or an unconnected MCP alone does not trigger browser fallback. Sign-in is performed by you; the plugin does not copy cookies between browsers. See [Browser sessions](skills/coohom-freeform/references/browser-session.md) for connection and recovery details.

## Image-to-3D generation and continued editing

Lux3D currently accepts image input only: a public HTTPS URL or actual local PNG/JPEG/WEBP bytes encoded as Base64. Individual furniture must be identified before using a room image; different furniture items are not submitted as one asset. References are sent to the generation service through the Coohom executor.

There is no direct text-to-model input or generation-mode, region or export-format selector. The plugin does not reuse the old Aholo SDK contract. Without a suitable image, it first establishes a confirmed reference source or approach for missing images.

Distinct furniture with ready references uses bounded concurrency: at most 3 unfinished tasks by default, including in-flight/uncertain submissions, submitted, queued, generating and archiving tasks. You can lower this limit. Explicitly identical furniture is generated once and duplicated after verification. Independent structure work can proceed while furniture is generating.

After `submitted`, the plugin records the real string task ID and tracks it through read-only queries. Successful supported GLB/GLTF results require both the model URL and brand-good ID before serial import into Freeform. Each import is checked against real scene objects. Generation IDs and import UUIDs are recorded separately. This workflow runs in the current Codex task, not a persistent background scheduler, and does not promise a fixed speedup.

Explicit `executor_required` means that call was not forwarded: pause new submissions, restore the workspace and resume unchanged. An unsubmitted asset returns to pending and releases only its current reservation; a query preserves its original task ID and generation state. Timeouts and uncertain submissions must not be repeated blindly. Only confirmed generation failure permits Freeform fallback. Sign-in, connection, format and import issues are handled separately.

You can continue editing furniture, layout and materials while preserving unrelated objects. A replacement asset must be correctly imported before the old object is removed. Confirmed material application failures trigger a search for real similar alternatives and verification of the result. Existing imported assets remain editable; unfinished legacy Aholo tasks cannot be queried through the new MCP or automatically regenerated.

For image-based modeling, material selection compares type, color, texture and sheen against the reference, then checks again after modeling. Clear mismatches trigger a closer replacement and another comparison. Each object or material region permits at most **2 automatic replacements**, excluding initial selection. Failed candidate replacements share that allowance. If differences remain or you are still dissatisfied, the plugin shows the current result and asks you to choose the next step. See [Reference-based materials](skills/coohom-freeform/references/modeling-contract.md#reference-based-materials-and-the-two-replacement-limit).

See [Generation and import](skills/coohom-freeform/references/ai-generation.md) for detailed contracts and recovery rules.

## Try it

> Use $coohom-freeform to build a space from this image. Keep the wood tones and the desk by the window, and show me the modeling process.

> Move that desk closer to the window, then adjust the chair and floor materials.

> Keep the current room and regenerate the sofa from this individual reference image.

The plugin distinguishes known facts, assumptions and unknowns, and checks structure, layout, proportions, visual features and affected objects against your goal. It asks you to decide when core interpretations differ, reuses existing authorization and keeps local edits within scope.

The final result is shown on the actual canvas, with verified results, approximations and limitations explained. Continue refining it through conversation or choose to save it yourself. The plugin does not automatically save, publish or create an AIHOM project.

## Verification scope

Static checks, installer tests, MCP initialization and tool discovery are recorded separately. They do not replace real sign-in, generation, import and visual acceptance. Current Lux3D acceptance must use current evidence rather than earlier Aholo results.

Browser automation depends on the current Codex session. Browser-tool limitations and Coohom account permissions are distinct. Structural checks of a macOS package do not prove it has run successfully on a Mac.

## Package contents

- `.codex-plugin/plugin.json`: version, display information and starter prompts.
- `.mcp.json`: MCP launch configuration generated by the installer.
- `runtime/node/` and `runtime/mcp/`: platform Node and recorded MCP dependencies for ZIP installations.
- `skills/coohom-freeform/SKILL.md`: request interpretation, creation, verification and continued editing.
- `skills/coohom-freeform/references/`: browser, Freeform and Lux3D contracts.
