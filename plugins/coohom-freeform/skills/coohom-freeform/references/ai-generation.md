# Image-to-3D generation and scene import

Read [Runtime capability discovery](runtime-capabilities.md). This document defines orchestration policy, not fixed tool names or JSON fields. Resolve each operation and result state using the current public declarations of `@manycore/coohom-lux3d-mcp` and `freeform-modeling-mcp`. Keep actual input/output names and semantics in the task capability record.

## Services and sign-in

Use `@manycore/coohom-lux3d-mcp` for image-to-3D generation. Prepare its workspace through the currently declared workspace preparation capability and use the returned task URL. Verify the task binding and user sign-in before generation. Do not request API keys, cookies or authorization headers, or make generation requests merely to test readiness. Preparation, tool discovery, sign-in and Freeform scene readiness are different checks. Follow [browser-session.md](browser-session.md).

Generation may consume a free allowance or account Credits. The displayed balance may not include free allowances and must not gate creation; only the creation response determines eligibility.

Only require capabilities used by the current workflow. Generation needs preparation, image submission and status query plus a viable handoff to `freeform-modeling-mcp`; payment tools are relevant only if payment is chosen. When a required generation capability or handoff route is technically unavailable but Freeform is ready, use [Automatic technical fallback](#automatic-technical-fallback) without submitting a probe generation. Missing optional controls do not block unrelated work. Follow current format, size and mode declarations.

## Image sources and creation

For floor plans follow the main Skill's no-image exception. Otherwise establish a suitable individual furniture reference and user-authorized generation intent. Record intended size, orientation, silhouette, colors and materials.

Use actual image data through a declared URL or byte/base64 input. Honor current MIME, size and mutually-exclusive input constraints. Never fabricate uploaded URLs, pass a local path into a URL field, print encoded image data, or assume a new input mode exists. Prefer code-based data transfer when supported. Explain an unavailable transfer capability instead of inventing inputs.

A whole room or floor plan is not an individual furniture asset. Prepare a suitable individual reference automatically under the following policy; image preparation is an implementation decision, not a user-facing choice between generation and cropping.

- Inspect the available references first. Reuse a suitable individual image directly. For a room image, isolate the intended furniture while preserving its visible silhouette, proportions, colors and materials; inspect the resulting crop before submission.
- Use image generation or completion only when available and useful for preparing the reference. The plugin does not provide an image-generation service, and Lux3D image-to-3D is not one. If image generation is unavailable or fails, automatically use a suitable crop of the original image through available image-processing capabilities and continue Lux3D generation. Briefly explain the action without asking whether cropping is acceptable, presenting technical alternatives, or requiring the user to enable image generation or provide an API key.
- Do not submit an unsuitable crop merely to keep going: the intended object must be identifiable and sufficiently visible, without neighboring objects being mistaken for parts of it. Record obscured details as unknown. If no suitable reference can be prepared, explain the specific missing visual information and ask only for the reference or design decision needed to proceed, such as identifying the target object or providing a clearer view. Follow the main Skill's no-image exception for floor plans.
- Honor explicit user restrictions on image editing or requests to approve references before modeling. Ask about unresolved changes to the intended design, not internal preprocessing methods.

Missing image-generation capability, unsuitable references or sign-in do not prove Lux3D generation failure or authorize the normal Freeform failure fallback. Preserve already submitted and uncertain tasks.

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

For preparation, connect or reuse the returned page then confirm binding with the read-only preparation/status capability. Check sign-in first after a business error; expired sign-in follows the user sign-in flow, not technical fallback. For technical connection failure, allow one recovery attempt through public capabilities, with a maximum 60-second recovery budget and never beyond the asset's original generation deadline. If no safe public recovery is available, or recovery fails, use automatic technical fallback when Freeform is ready. Do not restart services, refresh a scene or change versions merely to recover automatically.

For creation, undo only its reservation if explicitly proven not submitted; pause new submissions, restore connection and reconcile unresolved submissions. Resume once with the original input only if non-submission and the fix are confirmed and the deadline has not expired. For queries, preserve the original task ID, last generation state and slot, then query that same ID after recovery. Reopening a page or querying status does not reset either budget.

A connection-required query never terminates a generation task. A complete, correctly task-bound response is required; missing/conflicting identity or undocumented semantics cannot establish submission or completion. Do not borrow another task's executor or infer non-submission from a generic disconnect. Preserve uncertain records and sanitized evidence without repeatedly reopening pages or submitting. If Freeform is also unavailable or the target is ambiguous, request only the necessary user action; independent ready Freeform work may continue.

## Asset list and bounded concurrency

1. List distinct assets and repeated instances. Explicitly identical designs share one generation task; duplicate after verified import. Category alone is not enough to share a model. Do not generate extra candidates to fill concurrency.
2. At most **3 unfinished tasks** by default; the user may lower the limit. Accepted, queued, generating, archiving, unknown and unresolved prior tasks occupy slots until a documented terminal state. Count each identity once. Lowering the limit does not cancel existing tasks.
3. Execute creation calls serially. Reserve and record the first submission attempt's wall-clock time before calling; record accepted IDs immediately. The generation deadline is **5 minutes from that first attempt**, including an attempt whose outcome is unknown. Uncertain submissions retain reservations and the original deadline across turns; a new name, reconnect, query or checklist does not reset them.
4. Coordinate read-only queries, normally at least **5 seconds** between queries per task. Check due tasks after tool operations and before replenishing slots; do independent work or wait briefly instead of busy polling. Do not promise exact polling intervals or fixed speedups.
5. A terminal success frees a generation slot even when its output is not importable, but does not authorize regeneration. A query-confirmed failure immediately starts per-asset Freeform fallback. Other assets can proceed independently. Falling back never releases an unresolved generation slot or fabricates a terminal state.
6. Build independent structures while generation runs. Serialize imports and all other scene writes. Import ready assets when support/placement is ready and no fallback has been selected for them, without waiting for the whole batch or an earlier unfinished asset. When all generation slots are occupied, furnish remaining unsubmitted assets through Freeform instead of blocking scene progress or exceeding the limit.
7. Pause submissions on uncertain creation, executor disconnect, explicit rate limiting or credit failure. Follow the appropriate technical or Credits recovery; do not cycle parameters or accounts. Preserve successful results and reconcile existing work before resuming. Once service-wide technical unavailability is established, route the remaining unsubmitted assets through Freeform for this turn. A single asset failure alone does not establish a service-wide outage.

Maintain per asset: reference/input provenance, exact task ID when known, latest confirmed generation state, unresolved reservation, first submission time/deadline, actual query timing, output data, selected import route/job, recovery attempts, fallback reason, search/candidate attempts, scene delivery state, actual scene objects and instance mapping. Keep workspace state separate. These are plugin orchestration records, not invented MCP response fields.

Track generation and scene delivery independently: an asset can have an unresolved Lux3D task and a verified Freeform substitute. Mark automatic import disabled **before starting fallback**, and retain that marker across turns, context restoration and runtime reloads. Late output is a retained resource only, even if fallback is still in progress or incomplete; never automatically import it or replace a substitute. Explicit user authorization is required to start a later replacement, after querying the current scene.

Restore records before new calls. If the first submission time is missing, recover it from real task history; do not invent a fresh five-minute window. If it cannot be recovered, stop waiting for generation and select fallback while retaining unknown state and its reservation. Do not start a background monitor solely to await late results or delay scene delivery to finish generation polling. Record late results when encountered; do not imply cancellation or a refund.

## Automatic technical fallback

Resolve sign-in, permission and insufficient-Credits responses before applying technical recovery or a deadline; these still require the documented user choice. Never reclassify them as technical failure to skip that choice. Explicit user restrictions on substitutions or prior approval also take precedence. Ordinary approximation under the requested design is already authorized by this workflow.

| Observed stage | Action |
|---|---|
| Confirmed terminal generation failure | Select Freeform fallback immediately for that asset. |
| Generation pending or submission unresolved at the five-minute deadline | Select fallback; preserve the true task state, identity and reservation. Do not submit again. |
| Required Lux3D capability absent, or technical service/executor unavailability | Apply the single bounded connection recovery when available, then fallback; a confirmed service-wide issue disables further generation submissions for this turn. |
| No declared import route, missing required metadata, download/format/conversion failure | Retain generated output. Try at most one alternative import route only with a complete public contract and confirmed safe execution state; otherwise fallback. If preflight already proves no route, skip generation. |
| Import or placement error, timeout or lost result | Reconcile actual scene and any real import job before another write; apply the rules below. |
| Freeform unavailable, ambiguous target, unresolved scene write, or explicit design constraints impossible to preserve | Preserve work, pause the affected asset and request the necessary action/decision; continue independent safe work. |

Check deadlines after tool operations and before further generation, recovery or import work. Do not deliberately wait past the deadline; a blocking tool cannot be assumed canceled at a precise wall-clock instant. Select fallback at the next control opportunity if the generation deadline expired before success was established. Once success is established within the budget, use the bounded import recovery rather than restarting a generation timer. User sign-in/Credits decisions are never overridden by an expired timer; after the chosen recovery, retain the original timestamp and apply technical fallback to still-unresolved work without a new waiting window.

Before replacing an import or placement, compare the scene with pre-write records and query any real asynchronous job. Reuse and adjust an existing usable object. An empty scene query alone does not prove a pending import cannot still create an object: establish terminal nonexecution, or a publicly supported confirmed cancellation, before writing a substitute. If execution remains uncertain, pause that asset instead of risking duplicates. Never infer cancellation from a timeout.

Retry a failed write at most once, and only when nonexecution, a specific cause and its safe fix are confirmed. Otherwise use fallback after reconciliation. Never repeat an accepted or uncertain generation for technical faults; the single connection-recovery resumption requires confirmed non-submission. Do not cycle parameters or alternate between import routes. Preserve usable generated output and original user objects. Remove only confirmed unnecessary remnants created by this operation; verify a replacement before removing an old user object under the existing replacement authorization.

For every eligible fallback follow [Freeform asset fallback](modeling-contract.md#freeform-asset-fallback): search similar assets first, then simple geometry. Keep technical diagnostics in task context, not ordinary progress messages. Describe the scene work being done and disclose material approximations at delivery; never label a substitute as successful Lux3D generation. Ask only when user action or a change to explicit design constraints is actually required.

## Import and verification

Before submission, preflight at least one declared output-to-import route. After terminal success, validate actual required output against current declarations and follow [Asset handoff](runtime-capabilities.md#asset-handoff). Derive output fields and identifier mappings from the current public declarations.

Preserve every actual returned ID without reinterpretation. Use authoritative original dimensions if a selected route requires them. Desired design size is a different quantity and may be an explicitly disclosed estimate. If a generic model-URL route avoids unavailable original metadata, use it only when publicly supported and semantically suitable. Explain any material tradeoff requiring user choice.

If import is asynchronous, record its real job ID and query it through the declared status capability. Otherwise inspect the synchronous result and scene. Do not invent a job ID or assume generic polling applies to all routes. Finish and verify each write before the next. On timeout or lost output, inspect scene and records before retry; never blindly regenerate or import twice.

Generation, download, format, conversion, connection, contract and placement problems remain distinct stages, but eligible technical failures all follow [Automatic technical fallback](#automatic-technical-fallback). Preserve model output and true task state while delivering the substitute. Mark scene delivery complete only after scene queries and spatial/visual checks verify the actual object, its support, size, orientation and relationships. Show the real final scene and meaningful approximations; saving remains the user's choice.
