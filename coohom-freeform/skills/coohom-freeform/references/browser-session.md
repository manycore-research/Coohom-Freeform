# Browser sign-in, executor and scene connections

Read [runtime-capabilities.md](runtime-capabilities.md). Current public declarations govern tool names, fields, task binding and recovery. This document defines scene preservation and browser policy, not a frozen transport protocol.

## Workspace preparation and task URLs

Before first use find and call the declared read-only workspace preparation capability with its actual required inputs. The host/MCP owns task identity: never invent or borrow it, including undocumented metadata. If a required context is unavailable, explain the integration gap.

Record the real workspace identity, complete returned URL, connection state and tab separately from generation/import IDs. Use that URL unchanged. For documented connection-required results, open/reuse the exact task page, let the user sign in when needed and confirm binding with the declared preparation/status capability. Page load, connection and sign-in are separate checks.

If already connected, locate the bound page without creating a competing executor. Reuse it and the original canvas. When editing existing objects, require only the capabilities needed from `freeform-modeling-mcp`; generation disconnection must not block those edits. Recheck generation readiness before submission/query. After restart preserve scene and task identities and follow public reconnection semantics.

If the returned task URL points to a different environment than the user requested, explain the mismatch and ask how to proceed.

## Browser selection and fallback

1. **Prefer the Codex in-app browser.** Check its currently exposed capabilities and reuse a verified tab or open the required URL visibly. When CUA is available, use its public `iab` entry, such as `cua.createBrowserTab("iab", url, { visible: true })`, following current tool documentation. Unspecified automatic browser selection is not a substitute for this priority. `open_in_codex` can display a page, but display success does not replace observation, interaction or connection checks.
2. **Fall back locally only after confirming an in-app limitation.** Evidence may be a missing required public capability, an actual unsupported/tool-failure response, or page/log evidence that the in-app environment prevents a required operation. Record the evidence, briefly explain why, then open or reuse the local browser through public capabilities. This fallback needs no additional confirmation. Local sign-in, convenience or a limitation of another browser-control tool does not establish an in-app limitation.
3. **Separate browser limits from page, sign-in and MCP problems.** Being signed out, waiting for sign-in, an ordinary 404, an unpaired executor or MCP disconnection does not itself prove the in-app browser is unavailable. Read actual errors and connection state first. Apply step 2 only when evidence identifies an in-app limitation. For unknown causes or other recovery choices, explain the evidence and let the user decide; do not repeatedly switch browsers by trial and error.
4. **Preserve the scene and tasks.** Do not refresh or close a canvas, discard unsaved work or regenerate assets to satisfy browser priority or fallback. If switching requires scene migration or causes a target-connection conflict, explain the impact and let the user decide. After switching, recheck sign-in, executor binding, the unique Freeform target and actual scene.

## Sign-in and page inspection

Follow SKILL.md's page-action notification rule. For generation, link to the complete task URL returned by the workspace preparation capability of `@manycore/coohom-lux3d-mcp`. For an existing Freeform scene, link to its verified original page. Identify whether it contains the generation connection panel, an actual embedded canvas, or a standalone canvas. Do not substitute a fixed base URL for a task link or claim a connection panel is a modeled scene.

1. Prepare the workspace before first use, then inspect the corresponding page: the returned executor for generation, or the original canvas for existing-scene edits. If a required page is signed out, include its link when asking the user to sign in and confirm. Explain that sign-in and required connections will be rechecked afterward. Recheck after confirmation; a fixed wait is not proof of sign-in.
2. The user signs in through Coohom. Do not request API keys, cookies or Authorization headers, copy cookies from another browser, or write credentials into plugin files.
3. Use the current accessibility tree or screenshots to verify connections and canvas. Do not locate MCP controls using old screenshot coordinates or assume both ports connect automatically.
4. Preserve exact sign-in errors, 404s or unsupported-browser responses. Apply the fallback criteria above; otherwise explain known limitations and recovery choices. Do not guess sign-in URLs or clear sign-in state.
5. After confirming the in-app browser cannot work, first attempt the local browser through public capabilities. Only if that also cannot open or perform the required action should the user be asked to open the relevant page, perform the missing action and provide current state. Supply the full returned `executorUrl` for the executor or the original canvas for existing-scene edits. Sign-in is always performed by the user. Distinguish browser-control authentication errors from Coohom sign-in and MCP permission failures using evidence from the affected tool. For these errors, read [Browser-control authentication errors](troubleshooting.md#browser-control-authentication-errors) before choosing recovery. User-assisted operation is not proof that automatic browser acceptance passed.

## Executor connection and recovery

Inspect actual public status/configuration instead of assuming fixed ports, broker internals or error codes. Match page/MCP workspace identity according to documented semantics. Focus, sole candidate, reachable port or an unrelated executor is insufficient.

Follow [Workspace connection recovery](ai-generation.md#workspace-connection-recovery) for documented connection-required branches. Generic disconnection may occur after submission; preserve uncertain records. Never test connectivity with paid generation, repeatedly open pages, switch accounts/ports or close unrelated executors.

If recovery fails collect sanitized tool output, actual URL, connection status, configuration and logs, then explain evidence and let the user decide. Preserve original generation IDs. Tool discovery proves service startup, not browser readiness.

## Freeform target and connection

An executor may embed the Freeform canvas. A visible, connected embedded canvas can be the target without another tab. A generation-only panel is not the modeled scene. Preserve the original canvas.

Before writing, inspect current public scene-query and target/connection capabilities. Use public CLI status only if currently documented; do not launch another MCP through npx. Require a unique intended target, visible canvas and valid matching scene query. Multiple possible targets need a user choice/disconnection of conflicting bindings, without closing pages or discarding scenes. Explain inability to establish uniqueness.

Help is not a connection probe. Empty scenes can be valid; error text is not scene data. Distinguish MCP-to-bridge and page-to-bridge readiness using current documented output. After a restart check both ends. For an unresponsive or unregistered embedded canvas, read [Embedded canvas diagnostics](troubleshooting.md#embedded-canvas-diagnostics). Locate the failing stage using logs and public status before choosing recovery.

Use verified public recovery capabilities. Explain a chosen restart's impact; do not promise the host restarts only one service. Do not refresh scenes without authorization. Recheck target/scene after recovery. Missing import IDs require checking objects before risking duplicates.

## Interruption and delivery

After switching, closure or disconnection verify connections and scene again. Timeout does not establish nonexecution. Generation success does not prove import success; import status does not replace visual inspection.

Leave the actual canvas visible. Report verified results, approximations and limitations. Stay within the user's requested scope. Let the user choose to save; do not automatically save, publish or exit.
