# Interior lighting and rendered verification

## Entry and scope

Every interior creation or edit, including local furniture or material changes, ends with a whole-scene lighting check and necessary adjustments. Preserve unrelated architecture, furniture and materials. Maintenance, discussion and non-interior modeling do not trigger lighting. Follow the user's established day/night, color-temperature and fixture-on/off intent; competing design interpretations require their decision.

Finish all modeling, generation/import placement, materials and required corrections for this turn before entering this stage. Resolve uncertain scene writes first. Track eligible late generation results under the fallback policy, but do not import them automatically during lighting. Unresolved modeling blockers prevent final lighting delivery. You may record rooms and fixtures while modeling, but do not write lights early or enter Render after each object. For lighting-only requests, reuse the current Render session.

Read current lighting declarations under [runtime-capabilities.md](runtime-capabilities.md#lighting-capabilities) and use [browser-session.md](browser-session.md#model-and-render) for page switching. Before the first lighting write, require all three:

1. The intended scene's Render tab is selected, switching/loading overlays have ended and no blocking error is present.
2. The public lighting read reports rendering active and its synchronization channel ready, using documented semantics and the actual response envelope.
3. The actual page visibly shows a recognizable rendered first frame of this scene, not blank content, a placeholder, wireframe or an old scene. A dark but recognizable first frame is sufficient.

Neither a selected tab, a rendering status nor a successful tool call alone proves readiness. Observe states and images within a bounded wait; a fixed sleep or perfectly stationary pixels is not the criterion. Stop on a reported error. If no first frame arrives, retain page/status/error observations and elapsed time, explain the blocker and let the user choose recovery. Do not repeatedly toggle views, restart the page or write lights before readiness. Hand actual billing or new authorization prompts to the user with the page link.

## Read and plan

Refresh the full DIY light list, IDs, scene bounds and render status. An empty DIY list does not mean the template has no illumination. Overall scene bounds are not room heights or window coordinates: inspect each room's real geometry, openings, fixtures and rendered appearance. Record every identifiable room by its actual name or a distinct provisional label, with its boundaries, connections, openings, principal furniture and existing fixtures. Keep similar rooms separate and maintain a per-room status through lighting and delivery. Keep room/fixture associations in task context, not invented tool fields such as roomId or fixtureId.

Reuse existing matching lights first. For fixtures intended to be on, place a functional point, spot or rectangle light at the real emitting part; check shades, ceilings and walls for obstruction. Decorative fixture geometry and emissive-looking strips do not replace real functional sources. Do not mechanically add a light above every object.

Where appropriate, use inward-facing window area lights, local task lighting and restrained fill in deep areas. Ground-reflection fill needs plausible incident light and must remain weaker than the main source. Warm 2700–3500 K, daylight 5000–6500 K and relative brightness 1–3 are starting suggestions, not mandatory settings or photometric measurements. Do not turn a night scene into daylight or brighten all lights indiscriminately.

## Room-by-room workflow

After all modeling for this turn is complete and Render is ready, work through the recorded rooms one at a time. Derive each room's intended overall mood, light hierarchy, color temperature and task areas from the user's request, applicable references and current scene, using the lighting principles above. Before starting a room, briefly tell the user which room is being handled and what effect is being pursued.

Use the intended page's available camera/navigation controls to move to a recognizable interior view of that room. Adjust the view when walls, the roof or furniture hide the areas that need inspection. Observe the initial rendered appearance from enough representative viewpoints to understand windows, deep areas and important furniture or work surfaces. Keep a comparable viewpoint for before/after judgments. An exterior overview or an occluded view is not evidence of interior illumination.

Before the first light write for a room, form a complete initial plan for that room from its geometry, fixtures, openings, use areas and initial rendered views. Decide together which existing functional lights to retain or adjust and which additional functional lights the room needs, including their type, emitting position, direction, color and initial brightness. Apply this coherent initial plan in one complete-list `set_lights` write, preserving every unaffected light as described below. If the current lighting already satisfies the room's target, leave it unchanged. Use subsequent writes to correct specific differences observed in the rendered result, rather than using partial exploratory additions as the initial plan.

After each room's lighting has been read back and visually accepted, capture one image of its final interior Render view and show it to the user with the room name or provisional label and a short result. The image must visibly correspond to the current room and final lighting state. A reference image, model view, exterior view or earlier render does not fulfill this delivery. If a room cannot be inspected or its final render cannot be captured, report its actual status and continue with unaffected rooms without claiming acceptance.

After processing all rooms, inspect cross-room light spill and the overall relationship between rooms. If a final adjustment changes a previously accepted room, recheck it and show a new capture labeled as superseding that room's earlier image. Finish with a per-room completion summary, distinguishing light readback from rendered visual acceptance.

## Completion gate

Before ending an interior turn, reconcile the room inventory with the work actually performed. For each room in scope, record an interior Render view, its target and complete initial lighting assessment, any light write and readback, visual acceptance, and its named final render image. A room whose existing lighting already meets its target still needs interior visual verification and an image. Record a specific blocker for any unmet item, complete independent rooms, and report the remaining work accurately.

A whole-house first frame, active rendering status, an empty DIY light list, or a bright exterior overview establishes neither per-room lighting quality nor completion. Continue through the in-scope rooms without asking the user to select the next room. Do not give a completed-scene handoff while unexamined rooms remain or required modeling is unfinished; finish the work or identify the concrete blocker after completing unaffected work.

## Parameters and complete-list writes

Use current public schemas and help as the authority; these interpretation rules apply when those fields are declared:

- Coordinates are millimeters in a right-handed, Z-up frame. Use actual room heights and fixture emitting positions rather than typical fixed heights.
- Keep stable explicit IDs for new AI lights and reuse them for adjustments. IDs must be unique within the design; names are not IDs. Preserve existing point, spot, rectangle, iesSpot, direct and sun lights; use ordinary point/spot/rectangle for automatic additions and allow at most one sun.
- A rectangle's position is a corner. For center C and edge vectors U/V, use `position = C - U/2 - V/2`; vector lengths define dimensions, so do not normalize them. Check the emitting side in Render. Preserve the declared spelling `scateringAngle` and its 0–90 range when present; `disc: false` selects rectangular rather than circular fill.
- Every rectangle light in a `set_lights` payload MUST explicitly include a boolean `doubleFace`, even if the public schema marks it optional: the render service requires it and can reject the entire light request when it is omitted. Preserve an existing explicit `true` or `false`; when absent, use `doubleFace: false` for single-sided emission unless the user requests double-sided emission. Apply this rule to new lights and retained rectangle lights in complete-list updates.
- A spot needs position and direction. `hotSpot` and `fallSize` are radians, with the inner angle smaller than the outer. A downward direction in this frame is `{x:0,y:0,z:-1}`.
- A point needs position; radius is the emitter radius, not illumination range. Brightness is relative strength, not lumens or lux. Use colorTemperature together with useColorTemperature when declared.

Immediately before writing, refresh the necessary latest state and merge changes by ID. Preserve unaffected lights, user adjustments and all declared parameters. If important returned light parameters cannot be represented by the public write contract, stop before full replacement and explain the compatibility problem. Never silently drop them or manufacture a local type/cast. Coordinate observed manual-edit conflicts; without a declared transaction/version check, do not promise concurrent writes cannot be lost.

Validate unique IDs, at most one sun, types, required fields, finite values, units, nonzero rectangle edges and spot angle relationships. Serialize all scene writes. `set_lights({ lights })` replaces the entire DIY list, so send the complete merged target list even to adjust one light. An empty list clears DIY lights and restores template lighting: use it only for an explicit reset request, never as a connection test, fallback or cleanup.

Before sending, check that every rectangle light includes `doubleFace: false` or `doubleFace: true`; do not omit the field or send null. Read back after every write and compare IDs, count and key parameters, including each rectangle's `doubleFace`, recording host-normalized/generated values. On timeout, read first; do not repeat an unknown-outcome write. Satisfactory lighting requires no rewrite. Normal scene synchronization replays stored DIY lights; do not resubmit them just to refresh the image.

## Render feedback and acceptance

Keep Render open while adjusting. After write/readback, wait for actual visual feedback corresponding to the change before judging it. A synchronization request being accepted, including `appliedToRealtime: true` when documented, does not prove delivery to the renderer or a new displayed image. If image freshness cannot be established, report that limitation rather than treating an old image as feedback.

If rendering stops, disconnects or ceases to update, record configuration and status, stop tuning from stale images and follow evidence-based recovery. After recovery recheck readiness, current lights and actual images without unconditional resubmission.

Inspect representative interior views for every room: windows, deep corners and important furniture/work surfaces. Check darkness, blown highlights, emitting direction, obstruction, contact shadows and material detail. Use the page's available camera/navigation controls; a general scene-screenshot tool is not necessarily a Render capture or an arbitrary interior camera. Exterior overviews cannot alone verify room illumination. Keep viewpoint and exposure comparable within an adjustment; report any room you cannot inspect.

For a directly understood issue, correct position, direction, obstruction or local coverage before small brightness adjustments. If the cause is unknown, a write is uncertain or the user says a fix failed, retain readbacks and before/after views, explain the evidence and proposed options, and let the user decide instead of looping through guesses.

Leave the result visible in Render. Report parameter/readback verification separately from visual acceptance; no rendered evidence means no claim of completed architectural rendering. Allow only the internal save required by entering Render; do not additionally save or publish unless requested, and do not claim that the startup save persisted later lighting edits.

## Continued edits

For geometry/furniture/material changes use Model, finish all changes, then return to Render and repeat readiness plus whole-scene lighting checks. Lighting-only edits can reuse Render. Moving a fixture does not imply a bound light moved; check known associations. Delete or replace only lights whose relationship and requested scope are established. Re-read manual changes every turn, reconstruct missing associations from evidence and rediscover capabilities after MCP reloads. Preserve stable IDs instead of adding duplicates.
