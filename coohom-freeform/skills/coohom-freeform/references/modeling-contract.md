# Freeform modeling contract

## Runtime contract and import routes

Read [runtime-capabilities.md](runtime-capabilities.md). Choose tools by their current public descriptions and schemas, including names, required fields, allowed enums and semantics. Only require capabilities needed by the current operation.

For generated/library assets follow [Asset handoff](runtime-capabilities.md#asset-handoff). Direct placement requires all declared identity and original metadata. Generic URL import is available only if it accepts the actual model format and placement data. Preserve opaque IDs without lossy conversion. Replacement requires an authorized target and actual component mapping.

## Readiness and object identity

Discover public help and scene-query capabilities. Help does not prove a connected canvas. Verify a visible page, unique intended connection and a valid matching scene response before writing.

Inspect actual structured/text results including documented errors returned as ordinary text. Do not assume common fields such as objects, objectId or success. Use meaningful, unique names and record the actual returned names, object identities and types; the service may change requested names. Map each user-facing furniture name to all its actual components, and preserve their relationships during movement or rotation. Do not assume custom furniture is grouped automatically or infer object types from how a model was created.

## Fixtures and functional lights

Fixture geometry, decorative strips and create_object(type=LIGHT) are not substitutes for functional scene illumination. Model fixtures within the requested scope, record their actual emitting locations and follow [lighting.md](lighting.md) only after this turn's entire interior modeling is complete and Render is ready. Moving a fixture does not establish that its functional light follows automatically; verify known associations. Current lighting declarations govern parameters and full-list writes.

## Coordinates and dimensions

Read units, axes, handedness, origin, angle units and dimension ordering from current declarations. Verify actual bounds before calculating support height or proportions. Resolve conflicting descriptions using read-only bounds/geometry evidence; do not repeatedly swap axes without evidence. Camera direction does not change world coordinates.

Original asset dimensions must come from real metadata in its declared order. Desired design size is a separate quantity. Never substitute estimates for required original metadata. Calculate support contact from transformed bounds; half-height placement is valid only for a verified upright, centered object. Supported and hanging objects need not touch the floor.

## Materials, assets and views

Search before placing a fallback library asset, using currently declared discovery/search tools and actual results. Read current query language, filters and preview input types. For visually important assets, inspect real previews and compare multiple available candidates by silhouette, proportions, colors and materials; a category match or the first result alone is insufficient. Check generated assets using available previews and the imported scene. Follow [Freeform asset fallback](#freeform-asset-fallback) for bounded automatic selection. Library IDs and original dimensions must come from real search results.

Obtain materials through the currently declared material discovery capability. Identify major colors and coverage for the relevant object or area, and inspect visible texture direction and scale. Apply the reference-based comparison rules below when relevant images are available.

Use only declared material controls. A material-name setter does not imply arbitrary color, scale, roughness or emission controls; its limits also do not establish those of a separate public scripting API. Read signatures before promising controls. Names/categories do not prove a visual match.

Read available screenshot directions/camera controls from current declarations. Use public browser observations where appropriate. Use only declared camera controls. Verify apparent visual problems against the actual scene before changing geometry; screenshot or viewing artifacts do not justify geometry changes. Recheck support after replacement even if the declared operation preserves transforms.

## Reference-based materials and the two-replacement limit

For image-based modeling, use the reference image both for initial selection and the final material comparison. If the user borrows only selected visual features, stay within that scope. Choose close materials initially; do not rely on later replacement to compensate for arbitrary choices.

For [Floor-plan modeling](../SKILL.md#floor-plan-modeling), use the corresponding space's available rendered or user-provided reference for material and appearance selection and acceptance; the floor plan governs structure, dimensions and relationships. In the automatic no-image path, use explicit appearance requirements and disclose approximations. Do not infer unspecified materials from a floor plan, require missing rendered images or claim a visual match without a reference. Apply the image-comparison rules below only to actual relevant visual references; still verify the scene against the plan and user requirements.

1. **Select materials.** Record material type, main color and brightness, texture pattern, scale/direction, observable sheen and coverage per object or material region. Select close candidates from actual material discovery results and judge the page appearance. Matching categories or names do not prove visual similarity. Use only public parameters; do not invent color, texture, roughness or lighting controls.
2. **Compare again after modeling.** Inspect the actual canvas and needed local views against relevant reference areas. Record differences in material type, color, texture or coverage that materially change the intended appearance, then automatically enter replacement. First distinguish lighting, viewpoint and rendering effects from materials. If the view is unusable or the cause unknown, collect evidence and explain limitations instead of blindly replacing or claiming success.
3. **Count per target.** Each object or material region permits at most **2 automatic replacements**, excluding initial selection. Preserve the originally defined target scope: applying one replacement material to multiple faces of one region counts once; splitting targets cannot increase the allowance. Count an attempt before applying a new candidate. Failed or uncertain application still uses that attempt. Failure recovery and visual improvements share the limit. Record target, reference features, tried materials, count and comparison results; do not reset across turns or context restoration.
4. **Recheck each replacement.** Within the remaining allowance, choose a different, evidence-based closer candidate and modify mismatched targets serially while preserving other objects and matched areas. After every replacement, read the actual output and compare color, texture, sheen and coverage against the reference. Stop when satisfactory rather than using all attempts. If outcome is unknown, verify application before another call. Stop early and explain if suitable candidates or required capabilities/connections are unavailable.
5. **Let the user decide at the limit.** After two replacements on a target, stop if a clear mismatch remains or the user is dissatisfied. Preserve and show the current result and available comparison views. Explain tried materials, remaining differences and tool limits, then ask the user to accept, select a material or authorize another approach. Without a new explicit choice, do not attempt a third replacement, automatically restore an old material or regenerate a model to bypass the limit. Other targets may continue within their own authorized allowance.

## Automatic replacement after material failure

The workflow permits automatically finding and applying similar materials after a confirmed Coohom material application failure, during initial modeling or later edits. Multiple similar candidates do not require repeated approval. For image-based work, the preceding two-replacement count and stop rules still apply; this section adds no allowance.

1. Record the failed target group/face, material name and original response, then check connection and target. A confirmed application failure, such as `Material not found` or a page showing material load/application failure, permits replacement without identifying the failed material's internal cause. Disconnection, missing objects/faces and timeouts do not prove an unsuitable material. Read scene and page to check whether it applied; if still unknown, collect evidence under the recovery rules.
2. Refresh the declared material discovery capability and select actual results using only currently declared filters. Do not invent search tools, arguments or material names. Combine available names, reference evidence and page results to prefer similar type, color, texture and style; do not choose the first entry or any arbitrary same-category material.
3. Exclude candidates already confirmed to fail for this target in this turn. Apply similar candidates serially with the currently declared group/face material operation. Change only the original target's material and preserve other objects and successful materials. Try a given candidate on a given target at most once per turn. Continue after a confirmed candidate failure only within the applicable allowance; refreshing the list does not reset the image-based limit or permit cycling through failed names.
4. Check actual output, target page and available object information after each application, including coverage and appearance. Stop and record the final material when application succeeds and the replacement goal is met. If the tool succeeds but no valid view is available, report visual verification as incomplete; a screenshot problem is not a reason to replace again.
5. Stop if similar candidates are exhausted, no suitable candidate exists, connection/object faults affect all candidates, or only a materially different result is possible. Preserve the result, explain failures and limits and let the user choose next steps. Briefly disclose the actual substitute and remaining visual differences at delivery.

## Freeform asset fallback

Use this sequence for [eligible technical failures](ai-generation.md#automatic-technical-fallback), user-selected Freeform recovery and the floor-plan no-image path. Confirm Freeform readiness and reconcile any prior scene write first. A generation task may remain unresolved while a substitute is built, but an unresolved import or placement must not race a new scene write.

1. Carry forward the asset's function, desired size, position, orientation, silhouette, main colors and materials. Preserve explicit layout, function and key dimensions; ordinary visual approximation is allowed without another approval. Keep a record of fallback progress and actual objects so another turn resumes instead of starting over.
2. Search the real library with currently supported filters, for at most **two search rounds per asset fallback**. Use the first round for the original requirements; the second may relax only nonessential style/color preferences, never explicit requirements. Inspect available previews and compare actual candidates, prioritizing function and spatial fit before silhouette and finish. Do not choose an arbitrary first result. Unavailable search or previews do not authorize invented assets or a claim of visual matching; if no candidate can be established as suitable, proceed to simple geometry.
3. Place the best suitable candidate and verify it. On failure, first check connection, target, real job status and scene execution under the shared recovery rules. Only a confirmed candidate-specific failure permits **one different candidate** from the search results, then simple geometry. A shared Freeform fault or an unresolved write stops candidate switching. Search refresh, reconnect and a new turn do not reset these allowances for the same fallback.
4. If no suitable candidate works, compose a simple object with publicly declared Freeform geometry capabilities, preserving function, main dimensions, placement, silhouette and color blocks as far as supported. Use minimal geometry with valid topology, map all components and keep writes serial. Do not ask about routine detail loss. If geometry creation fails, apply the shared single safe-write retry rule; do not loop through new constructions. Pause the affected asset if it cannot be completed safely.
5. Query and inspect the actual object/components after each write. Verify dimensions, support/contact, orientation, obvious intersections and visual appearance against the original requirements. Only a verified result completes scene delivery; neither a successful call nor a placeholder name is acceptance. Preserve unrelated objects and usable prior results.

If explicit design constraints cannot be met, pause this asset, continue independent safe work and summarize the necessary design decision. At delivery disclose only consequential approximations or limitations, without dumping recovered Lux3D failures. Do not claim exact reference matching, cancellation of background generation, or successful Lux3D generation for a substitute. The generation record's disabled-auto-import marker prevents late output from replacing this work.

## Detailed geometry

For public scripting, first retrieve current guidance, supported interfaces, exact method signatures and dependency types through declared documentation/search capabilities. Do not use private objects or undeclared fields via casts.

Follow documented group/transaction/edit-path patterns, restoring edit context and committing or aborting when supported. Timeout does not prove rollback; query the scene before recovery. Scripts share serialized scene writes and the AI-first furniture policy.

For face/curve/extrusion/sweep operations, read current topology constraints. Verify closed coplanar faces, continuous paths and orientation. Topology changes can split faces or consume profiles: requery identities. Prepare auxiliary profiles away from existing geometry and clean only confirmed unnecessary elements created by this operation.

## Result checks and recovery

Query actual results and inspect the page after additions, replacements, deletion or topology changes. A name or success message does not establish final size, material or bounds. Perform the main Skill's spatial/visual checks. Do not claim strict collision detection unless a declared capability actually performed it.

After timeout read the scene first; retry only after confirming nonexecution and resolving its cause. For missing objects reread scene and selection. For unexplained failures collect evidence and explain choices instead of repeatedly changing parameters. Follow [browser-session.md](browser-session.md). Leave the actual scene visible. Render's required internal save is allowed; do not additionally save or publish unless requested.
