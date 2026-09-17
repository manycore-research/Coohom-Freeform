# Lux3D image-to-3D generation and Freeform import

Installation or upgrade resolves `@manycore/coohom-lux3d-mcp@latest`. `runtime/mcp/lux3d-install.json` records the actual installation; ordinary startup uses that local version. Use the currently loaded MCP's public README, type declarations and input/output schemas rather than pinning calls to a version in this skill. Generation results and workspace results are separate types; creation and query also return `executor_required`. Lux3D submits image-to-3D requests through a signed-in Coohom executor. Freeform handles structures, import, placement and continued editing. Do not reuse old Aholo SDK parameters or substitute its service.

## Services and sign-in

- Require Lux3D `prepare_workspace`, `create_lux3d_model_task` and `get_lux3d_model_task`, plus Freeform `import_generated_asset` and `poll_import_status`. Prepare and check the workspace with `prepare_workspace({})`; do not call Freeform help on Lux3D.
- On first use, prepare before opening or reusing the full returned `executorUrl`, preserving its `codexThreadId` matching `threadId`. Continue generation only after `connected`; reuse the page for continued edits in the same task. See [Workspace preparation and task URLs](browser-session.md#workspace-preparation-and-task-urls). The user signs in through Coohom. Do not request Aholo API keys, cookies or Authorization headers, or read old Aholo credential files.
- Lux3D stdio uses a shared local Broker, normally `ws://127.0.0.1:18766`. The first MCP process starts it and later processes reuse it; each reads the current Codex `threadId`. Respect the actual port configured through `LUX3D_MCP_BRIDGE_PORT`. This connection is independent of Freeform's usual port 8765; check both.
- Bind through the returned task URL with matching page/MCP `threadId`. Do not pair by sole candidate, browser focus or another task's executor connection.
- Recover explicit `executor_required` as described below. Diagnose `EXECUTOR_UNAVAILABLE`, `PAGE_CONFLICT`, `THREAD_BUSY` or protocol errors from actual output and logs; they do not confirm that a request was never forwarded. Preserve scenes and avoid repeatedly opening executors or restarting instances.
- Initialization, tool discovery and a task URL do not prove executor connection. Use the credit-free `prepare_workspace` to confirm `connected`, then verify sign-in. Do not create paid generation tasks to test connectivity.
- No API key does not mean no sign-in or free usage. Calls may consume the signed-in account's credits. Follow existing creative authorization without adding generations because the integration changed.
- `startup_timeout_sec=120` is the MCP startup timeout, not a generation deadline. No generation-mode, region or export-format selectors are publicly exposed. Do not pass old `G1-Turbo`, `region`, `wait` or `outputFormat` parameters or promise selectable modes.

## Image sources and creation

For floor plans, first complete [Render each space before modeling a floor plan](../SKILL.md#render-each-space-before-modeling-a-floor-plan): generate and show images for all spaces using an available image-generation capability, then prepare individual furniture references from the corresponding images. Lux3D generates models, not rendered images. Explain missing image-generation capability; do not bypass this prerequisite by working without images or building structures while waiting.

Record the asset name, intended dimensions and orientation, silhouette, color blocks and materials. The service accepts one image, not direct text-to-model input, a list of images or a local file-path parameter.

- Use `imageUrl` for a real public HTTPS image. For local PNG/JPEG/WEBP, read the actual bytes, encode as Base64 and submit through `imageBase64` with the matching `mimeType`. Do not pass a disk path as a URL or invent an uploaded image address.
- `imageBase64` accepts raw Base64 or a data URL, up to 28,000,000 characters. Never print the encoded content in messages or diagnostics. Where orchestration supports it, pass file bytes to the MCP in code without routing large binary content through the conversation transcript. If reliable transfer is unavailable, explain the input limitation rather than fabricating data.
- A whole room photo or rendered space is not an individual furniture reference; do not submit a floor plan as one furniture asset. Locate the target, then crop, complete or generate its reference according to the user's goal and confirmed input strategy. Preserve the furniture's relevant features and do not combine different furniture into one asset.
- Without a suitable image, establish a user-confirmed source or approach for missing images. Missing input, image-generation tools or valid sign-in is not a failed generation task and does not permit silently switching to Aholo.

| Tool | Public input | Normal response branches |
|---|---|---|
| `prepare_workspace` | `{}`, no arguments | `{threadId, status: "connected" ∣ "executor_required", executorUrl}` |
| `create_lux3d_model_task` | Exactly one of `imageUrl?: string` or `imageBase64?: string`; `mimeType?: "image/png" ∣ "image/jpeg" ∣ "image/webp"` | `{taskId: string, status: "submitted"}` or `{threadId, status: "executor_required", executorUrl}` |
| `get_lux3d_model_task` | `{taskId: string}`, length 1–128 | `{taskId, status, generationProgress, archivingProgress, generatedModelUrl, obsBrandGoodId, error?: string}` or `{threadId, status: "executor_required", executorUrl}` |

Queries report `generationProgress` and `archivingProgress` separately. `archiving` is unfinished. Model URLs and brand-good IDs may be `null` before `succeeded`; do not import early.

Prefer actual `structuredContent` and branch on `status`. Workspace text may contain JSON followed by connection instructions and a `resource_link`; do not parse all text as pure JSON. `executor_required` is a normal workspace result, not `isError`, and has no generation `taskId`. Errors use `isError: true` and JSON `{code,message}`. Do not invent `localPath`, `prompt`, legacy integer task IDs or extra parameters.

Record a submission only when creation returns `submitted` with a valid `taskId`. Then another asset can be submitted if a slot is available, without waiting for generation or import. Creation is not idempotent. Only explicit `executor_required` proves this attempt was not submitted and permits the recovery below. Other timeouts, errors or uncertain results, including `submitted` without an ID, retain an unresolved submission and pause new work. Explain recovery choices without repeating creation. Never query old Aholo IDs through Lux3D. Existing imported scenes remain editable; explain unfinished legacy tasks separately and do not automatically recreate them after migration.

## Workspace connection recovery

Preparation, creation and query may return `executor_required`. It is a connection state, not generation failure or cancellation, and must not overwrite the last known generation state. When creation/query explicitly returns this branch, that request has not been forwarded to the executor.

| Call | Record and recover |
|---|---|
| `prepare_workspace` | Record `threadId` and `executorUrl`; open or reuse that URL, then prepare again to confirm `connected` |
| Creation | Undo this attempt's slot reservation, keep the asset pending and pause all new batch submissions. Do not invent a `taskId` or mark this attempt unresolved. After connection, check existing tasks and other unresolved submissions, then reserve a slot again and submit the original image parameters |
| Query | Preserve the original `taskId`, last generation state and occupied slot. Pause generation polling and submissions. After connection, query the original ID without recreating the asset |

Use this recovery only for a complete response confirmed to belong to the current Codex task. Missing or conflicting URL `codexThreadId` / returned `threadId`, or `isError`, requires preserving records and diagnosis. URLs from existing tasks must match current preparation; never borrow another task's URL. Unchanged resumption uses existing creative authorization. If connection still fails or the resumed call again returns `executor_required`, preserve records, collect evidence and let the user decide. Do not loop through page opening or submission.

This branch proves only that the current call was not forwarded; it does not resolve earlier uncertain submissions. Keep new submissions paused until those are verified. Preparation, queries and `executor_required` responses do not create generation tasks. Independent, ready Freeform edits may continue.

## Asset list and bounded concurrency

Orchestrate the existing single-asset tools in the current Codex task. Do not invent batch parameters or a persistent background queue. Generate only assets the design needs; do not add candidates to fill concurrency. Backend account concurrency and queue limits are unknown, so do not promise a fixed speedup.

1. List distinct assets and instances. Explicitly identical furniture shares one generation task; after import and verification, duplicate it through public Freeform tools and record each name and placement. Different designs require separate generation; category alone does not justify reuse. Queue only assets with a ready individual reference and established generation intent. Missing references need not block other ready assets.
2. Default to at most **3 unfinished tasks** for the current design; the user may lower this limit. `submitted`, `queued`, `generating` and `archiving` all occupy slots. Older tasks without confirmed terminal state, query errors and unknown states retain slots. Count each `taskId` once, not just active creation calls. If the limit is lowered below the current count, retain existing tasks and wait until the count falls below it before submitting more.
3. Execute creation calls one at a time. Reserve a slot before calling, then associate `submitted` and its valid ID immediately before continuing until slots or ready assets run out. In-flight and uncertain results retain reservations. Explicit `executor_required` releases only that attempt's reservation and pauses/resumes under the recovery contract. A new turn, asset name or checklist does not clear old tasks.
4. While the executor is ready, check due unfinished tasks after each tool operation. Normally leave at least 5 seconds between queries for each task. Record the polling round before replenishing freed slots. If no query is due, do independent scene work or wait briefly instead of busy-waiting. Catch up after long tool calls without claiming exact fixed-interval polling.
5. Release a submitted task's slot only after a query confirms `succeeded` or `failed`. Undo an explicitly unforwarded creation reservation under step 3; a query's `executor_required` never releases a slot. Queue successful assets for import and use authorized fallback for confirmed failures while other assets proceed. Missing or incompatible model output is a separate issue; it neither changes a confirmed terminal state nor permits regeneration as a failure fallback.
6. Build independent structures while models generate. Import ready assets one at a time as their structural support and placement become available, without waiting for the full batch or an earlier unfinished asset. Generation slots are independent of import progress. Read-only generation queries may continue during import, but all Freeform writes are serialized: finish the current import and verify the scene before another scene write.

For six distinct assets, obtain A, B and C task IDs first. If B succeeds first, record its output and submit D, leaving A, C and D unfinished. Import B when the scene is ready while those continue generating. Do not poll only A or submit all six at once.

## Queries and task records

Record workspace `threadId`, `executorUrl`, connection state and browser/tab separately. For each asset, track its user-facing name, reference source, generation intent, instances, service and installed version, workspace, string `taskId`, last generation state, successful model reference, import UUID, actual object names and replacement relationships. Connection state must not overwrite generation state. Distinguish pending, unresolved submission, known generation task, pending import and verified object; these are orchestration records, not new MCP parameters or returned statuses. Do not save cookies, authorization headers or full Base64. Signed model URLs are for execution, not public documentation or user messages.

| Query state | Action |
|---|---|
| `queued` / `generating` / `archiving` | Keep the slot; poll under the shared schedule and do independent structure work |
| `succeeded` | Verify real `generatedModelUrl` and `obsBrandGoodId`; import only when both are present |
| `failed` | Record the returned `error` string and use the authorized Freeform fallback for this asset |
| `executor_required` | Retain ID, last generation state and slot; pause polling/submission and resume the same query after connection |
| Missing, unknown or tool error | Retain the slot and last known state; record and diagnose without inferring completion |

Across turns, restore records, reuse IDs and check current state. Unfinished carryover tasks still occupy slots; do not resubmit. If an old task's existence or completion is uncertain, verify records before generating again. If the user changes furniture already being generated, retain its task and clarify whether a new asset is needed. Position, size or material edits to imported objects use scene tools only.

During actual validation, record design start, each submission, latest query, first observed terminal state, import start/end and final check times. Use them to explain task overlap, generation waiting, import time and overall time. First observed success is not the exact server completion time. Report concise counts for generating, pending import and completed assets; never expose full Base64 or signed URLs.

This orchestration depends on the current Codex task. Polling and automatic import are not guaranteed after it stops. On user cancellation, stop new submissions and later imports, retaining submitted IDs and unresolved attempts. No public generation-cancellation tool exists; do not claim backend cancellation or release slots. Query old tasks before resuming. Preserve UUIDs for imports already started at cancellation and inspect the scene first on return.

## Import and verification

1. Independently verify the Freeform target and connection; executor connectivity is not scene readiness.
2. Only on `succeeded` with both a real, reachable HTTPS `generatedModelUrl` and a nonempty `obsBrandGoodId`, call `import_generated_asset({name, model_url: generatedModelUrl, brandgoodid: obsBrandGoodId, location, dimensions, rotation?})`. Use the public lowercase `brandgoodid`; a GLB alone is insufficient and field names must not be changed.
3. Import only a confirmed supported GLB/GLTF output. `obj`, `unknown`, missing format or missing URL does not establish compatibility. Check the file and public conversion capabilities; explain the limitation if no reliable path exists. Do not rename extensions, pass legacy export parameters or treat a format problem as generation failure.
4. Use verified millimeter coordinates and dimension contracts. Omit `preview_image_url` and inspect previews separately so a preview failure cannot prevent recording the import UUID.
5. Save the actual Freeform import UUID and call `poll_import_status({import_uuid})`. It differs from Lux3D `taskId`. Imports, duplication, movement and material changes share a serialized scene-write sequence. Complete and verify one import before the next write; other Lux3D tasks need not finish first.
6. Reread the scene, associate task/UUID/actual names, and check placement, proportions, orientation, support and visual features. Generation success does not prove arrival in the correct scene.
7. Keep old objects until replacement assets have imported correctly and passed checks, then perform the authorized replacement cleanup.

Freeform import state lives in MCP process memory and may be lost on restart. On timeout, query failure or missing UUID, inspect the scene and earlier records before risking duplicate import or deletion.

## Failure fallback and delivery

Only a query-confirmed generation `failed` permits substituting Freeform geometry or a searched library asset. Release that generation slot, preserve successful outputs and ongoing tasks, and continue the batch. Reuse existing authorization without asking per asset; unresolved key appearance alternatives still require the user's choice. Check fallback objects spatially and visually too.

Recover explicit `executor_required` under [Workspace connection recovery](#workspace-connection-recovery); it is not an unresolved submission. Creation timeout, error or unclear output retains an unresolved submission and reserved slot and pauses all new batch submissions. Creating again is not recovery. For other executor disconnections, explicit rate limits or account errors, retain all IDs, pause submissions and explain the actual error and options. Do not automatically change parameters, accounts or services. After confirmed recovery, query known tasks and resolve uncertain submissions before creating more.

If generation succeeds but import fails, preserve model output and UUID and inspect the scene rather than regenerating. If write outcome or target connection is uncertain, pause further scene writes; independent working generation queries may continue. Resume from records after scene recovery without duplicate import.

`executor_required`, signed-out state, executor disconnection, uncertain creation, running tasks, client cancellation, incompatible formats, download/conversion errors and scene import failure are not confirmed generation failure. Distinguish input, executor, generation, import and scene stages, preserve successes and explain evidence and recovery choices. Do not blindly submit, switch accounts or call old services.

Show the actual final scene and explain verified items, fallback assets, approximations and limitations. Credits, model URL lifetime and generation quality depend on the service. The user chooses whether to save; do not claim automatic saving.
