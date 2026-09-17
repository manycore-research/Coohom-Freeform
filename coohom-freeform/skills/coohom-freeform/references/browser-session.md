# Browser sign-in, executor and scene connections

This plugin uses two independent MCPs: Lux3D generates models from images; Freeform handles geometry, model import and scene editing. Inspect pages through public browser tools. Do not guess internal page objects or call hidden APIs.

## Workspace preparation and task URLs

Use the currently loaded Lux3D MCP's public tool declarations. Prepare the workspace before the first use in a Codex task, even if that turn only edits existing objects. Once prepared, reuse the workspace for continued edits rather than initializing it every turn.

1. Confirm that Lux3D exposes `prepare_workspace` and call `prepare_workspace({})` in its actual namespace, without a task ID, site or other arguments. It is read-only, idempotent and consumes no generation credits. It returns `{threadId, status: "connected" | "executor_required", executorUrl}`. The MCP reads `threadId` from the current Codex task context; the prompt must not generate or supply it. If the tool is missing, explain the loading or compatibility gap instead of bypassing preparation with a fixed URL.
2. Record the real `threadId`, full `executorUrl`, connection state and browser/tab. The MCP has already attached the matching `codexThreadId` to the URL. Use it unchanged; do not assemble, remove or modify task parameters. A workspace `threadId` is neither a generation `taskId` nor an import UUID.
3. On `executor_required`, open the returned URL using the browser priority below, or reuse the matching page for this task. Ask the user to sign in and confirm if needed. After connection, call `prepare_workspace({})` again; only `connected` confirms the binding. Page load alone is insufficient. Do not repeatedly open executor pages or poll at high frequency.
4. On `connected`, locate and display the already bound page instead of opening a competing executor. This confirms only the Lux3D executor connection. Check web sign-in and the independent Freeform canvas and scene connection separately.
5. Reuse the executor and canvas for continued edits in this Codex task. Check only Freeform when moving, rotating, resizing, changing materials or deleting existing objects; later Lux3D disconnection or sign-in expiry must not block those edits. Before new generation submissions or queries, check `prepare_workspace({})` again. After an idle MCP restart, prepare again with the same `threadId` to reconnect the original page. If task identity is uncertain, preserve records and canvas without borrowing another task's URL.

The MCP currently uses `https://prod-test-seoul.coohom.com/pub/tool/bim/ai-home/mcp-executor` as the temporary base for task URLs. It is not a direct plugin launch URL. Other environments use the public MCP environment variable `LUX3D_MCP_EXECUTOR_URL`, restricted to HTTPS on `coohom.com` or its subdomains; it is not a tool argument. If the requested environment differs from the returned URL, explain the mismatch and confirm configuration changes rather than rewriting the URL.

Respect a user-selected browser or page and verify the target task. Otherwise, prefer the visible Codex in-app browser. Browsers do not share sign-in state: a signed-in Chrome session does not prove in-app sign-in. Preserve existing scenes; do not refresh or overwrite a canvas to prepare the workspace or switch entry points.

## Browser selection and fallback

1. **Prefer the Codex in-app browser.** Check its currently exposed capabilities and reuse a verified tab or open the required URL visibly. When CUA is available, use its public `iab` entry, such as `cua.createBrowserTab("iab", url, { visible: true })`, following current tool documentation. Unspecified automatic browser selection is not a substitute for this priority. `open_in_codex` can display a page, but display success does not replace observation, interaction or connection checks.
2. **Fall back locally only after confirming an in-app limitation.** Evidence may be a missing required public capability, an actual unsupported/tool-failure response, or page/log evidence that the in-app environment prevents a required operation. Record the evidence, briefly explain why, then open or reuse the local browser through public capabilities. This fallback needs no additional confirmation. Local sign-in, convenience or an earlier Chrome-control error is not a reason to skip the in-app browser.
3. **Separate browser limits from page, sign-in and MCP problems.** Being signed out, waiting for sign-in, an ordinary 404, an unpaired executor or MCP disconnection does not itself prove the in-app browser is unavailable. Read actual errors and connection state first. Apply step 2 only when evidence identifies an in-app limitation. For unknown causes or other recovery choices, explain the evidence and let the user decide; do not repeatedly switch browsers by trial and error.
4. **Preserve the scene and tasks.** Do not refresh or close a canvas, discard unsaved work or regenerate assets to satisfy browser priority or fallback. If switching requires scene migration or causes a target-connection conflict, explain the impact and let the user decide. After switching, recheck sign-in, executor binding, the unique Freeform target and actual scene.

## Sign-in and page inspection

Follow SKILL.md's page-action notification rule: link to the complete `executorUrl` returned by `prepare_workspace`, including `codexThreadId`, for Lux3D; use the verified original canvas URL for an existing Freeform scene. Identify whether the link opens the generation executor or scene canvas. Do not substitute a fixed base URL for a task link or present the executor as the scene entry.

1. Prepare the workspace before first use, then inspect the corresponding page: the returned executor for generation, or the original canvas for existing-scene edits. If a required page is signed out, include its link when asking the user to sign in and confirm. Explain that sign-in and required connections will be rechecked afterward. Recheck after confirmation; a fixed wait is not proof of sign-in.
2. The user signs in through Coohom. Do not request an Aholo API key, cookies or Authorization headers, copy cookies from another browser, or write credentials into plugin files.
3. Use the current accessibility tree or screenshots to verify connections and canvas. Do not locate MCP controls using old screenshot coordinates, inherit legacy Freeform URL parameters, or assume both ports connect automatically.
4. Preserve exact sign-in errors, 404s or unsupported-browser responses. Apply the fallback criteria above; otherwise explain known limitations and recovery choices. Do not guess sign-in URLs or clear sign-in state.
5. After confirming the in-app browser cannot work, first attempt the local browser through public capabilities. Only if that also cannot open or perform the required action should the user be asked to open the relevant page, perform the missing action and provide current state. Supply the full returned `executorUrl` for the executor or the original canvas for existing-scene edits. Sign-in is always performed by the user. The Chrome-control error `unsupported Codex auth method: apikey` indicates a browser-tool limitation, not a Coohom account or MCP permission failure, and does not establish an in-app limitation. User-assisted operation is not proof that automatic browser acceptance passed.

## Lux3D executor connection

- Lux3D stdio shares a local Broker at `ws://127.0.0.1:18766` by default; use the actual port if `LUX3D_MCP_BRIDGE_PORT` is configured. The first MCP process starts the Broker and later processes reuse it. Each registers with its Codex-provided `threadId`, allowing task isolation on one port without extra installation parameters.
- Bind the current MCP through its returned task URL and verify `connected` with `prepare_workspace`, plus page and sign-in checks. Page and MCP bind only on an exact `threadId` match, never by sole candidate or browser focus. Each `threadId` permits one active executor; a second page returns `PAGE_CONFLICT`. Refresh preserves `codexThreadId` in the URL and can reconnect after the old connection closes.
- Explicit `executor_required` from preparation, creation or query requests an executor connection. Open or reuse the returned URL, then prepare again to confirm. Resume creation/query under [Workspace connection recovery](ai-generation.md#workspace-connection-recovery). This is not generation failure or an exception requiring URL extraction from error text.
- `EXECUTOR_UNAVAILABLE` is an error, potentially from disconnection after a check. It is not equivalent to `executor_required`, which explicitly means the request was not forwarded. Preserve uncertain creation records without regenerating. For `PAGE_CONFLICT`, `THREAD_BUSY`, protocol errors or persistent unready state, collect tool output, page URL, actual port, current UI and logs; explain evidence and choices for the user to decide.
- Bound tasks may share the Broker; do not close other executors for that reason. Do not close unrelated pages, discard their scenes, repeatedly refresh, create paid tasks to test a connection, or change ports without authorization. MCP or executor disconnection clears only that `threadId`'s requests; other bound tasks can continue.
- Initialization and tool discovery prove only service startup. A returned URL does not prove `connected`, and `connected` does not prove web sign-in or a valid Freeform scene. The 120-second startup timeout concerns MCP initialization, not generation failure.
- After recovery, query original generation task IDs. Record workspace `threadId` separately from generation `taskId`. A task URL does not resolve an older uncertain submission; preserve and verify records first.

## Freeform target and connection

Verify generation readiness and scene readiness independently. Prefer the existing Freeform canvas. If no canvas or confirmed scene entry is available, explain the missing scene page and have the user confirm the target. A generation-only executor is not the final model view.

1. Freeform normally uses bridge port 8765; follow its public CLI output and actual configuration. Reuse the service rather than launching a competing instance.
2. Locate the public CLI from the current MCP entry and configuration, then read `status` / `port`. Use bundled Node and launcher, or the same configured Freeform service for a personal installation. Do not launch a second copy through npx.
3. Before writes, verify the CLI's Koomaster client count: 0 means disconnected; 1 still requires page and scene verification; more than 1 requires asking the user to keep the intended connection and disconnect other scenes from MCP. Do not close their pages or discard unsaved work.
4. The current service has no public page-binding tool. If status or a unique target cannot be confirmed, explain the issue. A reachable port or one successful scene query alone does not prove uniqueness.
5. Call `get_tools_info` on first use, then `get_scene_info`. The response must be a valid scene matching the canvas; an empty scene is valid. Error text is not scene data.
6. Create, edit or import only after the canvas is visible, the Freeform target is unique and the current MCP can query it. Lux3D connection is not a substitute.

## Freeform disconnection and recovery

The page-to-bridge and MCP-instance-to-bridge connections are separate:

- `Not connected to WebSocketBridge` means this MCP instance lost the bridge, not necessarily that the page is disconnected.
- `No Koomaster clients connected` means the bridge has no Freeform page.
- A CLI-reported MCP client does not prove the current instance is connected; require its valid scene query. After a bridge PID change, check both ends without guessing why it restarted.
- Use only the verified version's public recovery capabilities. Do not assume automatic reconnect or hidden methods. If evidence shows instance disconnection, explain the impact and let the user decide whether to use Codex's MCP restart control. Do not promise that control affects only one service.
- After recovery, recheck page, unique target and scene. Do not refresh an existing scene without authorization. If an import UUID is missing, inspect actual objects before risking duplicate import.

## Interruption and delivery

After page closure, switching or disconnection, recheck connections and scene. A write timeout does not prove nonexecution; inspect objects and records before recovery. Lux3D success does not prove import success, and Freeform import status does not replace visual inspection.

Leave the actual scene canvas visible. Explain verified results, approximations and limitations, and tell the user they can continue editing or choose to save. Do not automatically save, publish, exit or create an AIHOM project. A generation-only connection page is not a delivered 3D scene.
