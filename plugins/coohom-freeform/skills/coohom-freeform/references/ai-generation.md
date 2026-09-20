# Image-to-3D generation and scene import

Read [Runtime capability discovery](runtime-capabilities.md). This document defines orchestration policy, not fixed tool names or JSON fields. Resolve each operation and result state using the current public declarations of `@manycore/coohom-lux3d-mcp` and `freeform-modeling-mcp`. Keep actual input/output names and semantics in the task capability record.

## Services and sign-in

Use `@manycore/coohom-lux3d-mcp` for image-to-3D generation. Prepare its workspace through the currently declared workspace preparation capability and use the returned task URL. Verify the task binding and user sign-in before generation. Do not request API keys, cookies or authorization headers, or make generation requests merely to test readiness. Preparation, tool discovery, sign-in and Freeform scene readiness are different checks. Follow [browser-session.md](browser-session.md).

Generation may consume a free allowance or account Credits. The displayed balance may not include free allowances and must not gate creation; only the creation response determines eligibility.

Only require capabilities used by the current workflow. Generation needs preparation, image submission and status query plus a viable handoff to `freeform-modeling-mcp`; payment tools are relevant only if payment is chosen. Missing optional controls do not block unrelated work. Follow current format, size and mode declarations.

## Image sources and creation

For floor plans follow the main Skill's no-image exception. Otherwise establish a suitable individual furniture reference and user-authorized generation intent. Record intended size, orientation, silhouette, colors and materials.

Use actual image data through a declared URL or byte/base64 input. Honor current MIME, size and mutually-exclusive input constraints. Never fabricate uploaded URLs, pass a local path into a URL field, print encoded image data, or assume a new input mode exists. Prefer code-based data transfer when supported. Explain an unavailable transfer capability instead of inventing inputs.

A whole room or floor plan is not an individual furniture asset. Crop, complete or generate an appropriate individual reference under the chosen approach. Missing images or sign-in do not prove generation failure. Preserve already submitted and uncertain tasks.

Record a submission only when a declared response branch confirms acceptance with a usable task identity. Creation is not assumed idempotent. An error or timeout may follow successful submission: reserve that slot and pause further creation until evidence resolves the outcome. A response releases a reservation only when current public semantics explicitly establish non-submission. Do not infer that from an unfamiliar error label.

## Insufficient Credits recovery

On an explicitly documented insufficient-credit response, pause new submissions. Release only the failed call's reservation if the response establishes that no task was submitted. Preserve its original inputs and asset record.

Immediately call the Codex `request_user_input` tool with one question and wait for its result. When the tool is available, do not first send a normal assistant response or replace the dialog with prose, a numbered list or a chat question. Localize this contract to the conversation language:

- `header`: a short label such as `Lux3D` (12 characters or fewer after localization).
- `id`: `credits_recovery`.
- `question`: state that Lux3D Credits are insufficient and ask how to continue.
- `options`: exactly three mutually exclusive choices, with the recommended option first:
  1. **Pay (Recommended)** — open the Coohom Credits payment modal and retry AI generation once after the user confirms payment is complete.
  2. **Use Freeform** — continue this asset with Coohom Freeform, explaining that the result may be less accurate.
  3. **Stop** — stop this asset and its dependent operations, preserving existing work.

Wait for the choice. Only after Pay, use the declared payment-opening capability. A modal opening is not payment success: ask the user to finish payment and reply that it is complete. Do not poll balance or submit generation while waiting. After confirmation, query the declared balance capability once for display, then retry the original generation once with the exact original inputs and a slot reservation regardless of the reported balance. Free allowances may not appear in that balance; only the creation response determines eligibility. Positive balance is not proof that it covers the generation cost. Do not invent a cost field. A second insufficient-credit result returns to the three choices without reopening payment in a loop.

Freeform choice authorizes fallback only for that asset. Stop must not trigger payment, balance or generation calls. If the relevant payment/balance capability is missing, explain the limitation and let the user decide.

Only if `request_user_input` is absent from the available tool list or its call explicitly fails may you present the same three numbered choices as a prose fallback. Never infer that the tool is unavailable merely because a prose reply is easier.

## Workspace connection recovery

Interpret connection-required responses according to their public semantics, including normal results rather than only error envelopes. Preserve real workspace identity and full returned URL separately from generation identity.

For preparation, connect or reuse the returned page then confirm binding with the read-only preparation/status capability. For creation, undo only its reservation if explicitly proven not submitted; pause new submissions, restore connection, check unresolved prior submissions, then reserve again before resuming with the original input. For queries, preserve the original task ID, last generation state and slot, then query that same ID after recovery.

A connection-required query never terminates a generation task. A complete, correctly task-bound response is required; missing/conflicting identity or undocumented semantics require diagnosis. Do not borrow another task's executor or infer non-submission from a generic disconnect. If recovery still fails, preserve records, collect evidence and let the user choose. No repeated page-opening/submission loop. Independent ready Freeform work may continue.

## Asset list and bounded concurrency

1. List distinct assets and repeated instances. Explicitly identical designs share one generation task; duplicate after verified import. Category alone is not enough to share a model. Do not generate extra candidates to fill concurrency.
2. At most **3 unfinished tasks** by default; the user may lower the limit. Accepted, queued, generating, archiving, unknown and unresolved prior tasks occupy slots until a documented terminal state. Count each identity once. Lowering the limit does not cancel existing tasks.
3. Execute creation calls serially. Reserve before calling and record accepted IDs immediately. Uncertain submissions retain reservations across turns; a new name or checklist does not reset them.
4. Coordinate read-only queries, normally at least **5 seconds** between queries per task. Check due tasks after tool operations and before replenishing slots; do independent work or wait briefly instead of busy polling. Do not promise exact polling intervals or fixed speedups.
5. A terminal success frees a generation slot even when its output is not importable, but does not authorize regeneration. A query-confirmed failure authorizes per-asset Freeform fallback. Other assets can proceed independently.
6. Build independent structures while generation runs. Serialize imports and all other scene writes. Import ready assets when support/placement is ready, without waiting for the whole batch or an earlier unfinished asset.
7. Pause submissions on uncertain creation, executor disconnect, explicit rate limiting or credit failure. Do not cycle parameters or accounts. Preserve successful results and reconcile existing work before resuming.

Maintain per asset: reference/input provenance, exact task ID, latest confirmed generation state, unresolved reservation, actual query timing, output data, selected import route/job, actual scene objects and instance mapping. Keep workspace state separate.

## Import and verification

Before submission, preflight at least one declared output-to-import route. After terminal success, validate actual required output against current declarations and follow [Asset handoff](runtime-capabilities.md#asset-handoff). Derive output fields and identifier mappings from the current public declarations.

Preserve every actual returned ID without reinterpretation. Use authoritative original dimensions if a selected route requires them. Desired design size is a different quantity and may be an explicitly disclosed estimate. If a generic model-URL route avoids unavailable original metadata, use it only when publicly supported and semantically suitable. Explain any material tradeoff requiring user choice.

If import is asynchronous, record its real job ID and query it through the declared status capability. Otherwise inspect the synchronous result and scene. Do not invent a job ID or assume generic polling applies to all routes. Finish and verify each write before the next. On timeout or lost output, inspect scene and records before retry; never blindly regenerate or import twice.

Only generation failure permits the normal failure fallback. Download, format, conversion, connection, contract and placement problems are separate stages. Preserve model output while diagnosing. Show the real final scene, verified assets, approximations and limitations; saving remains the user's choice.
