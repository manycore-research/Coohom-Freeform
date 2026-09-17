# Freeform modeling contract

This reference is based on the registered tools and public parameters in `freeform-modeling-mcp` **1.0.31**, with compatibility notes for 1.0.27. Sources are the package's `src/server.ts`, `src/prompt.ts`, `src/tools/basic-tools.ts`, `assets-tool.ts`, `material-tools.ts`, `screenshot-tools.ts`, `import-tools.ts` and `tools-info.ts`. Call only parameters publicly exposed in the current session. Source code existing in a package does not make a capability public.

## First call and the known help failure

Call `get_tools_info({})` on first use. Version 1.0.31 exposes `import_generated_asset` and `poll_import_status`; the optional `brandgoodid` input on import must receive Lux3D's `obsBrandGoodId`. Version 1.0.27 lacks both import tools and cannot import generated AI assets. Its documentation builder comments out `toolsInfo.tripo3d` but still runs `toolsInfo.tripo3d.forEach`, so it may return:

```text
Error getting tools info: Cannot read properties of undefined (reading 'forEach')
```

Only when both version 1.0.27 and that exact error match may this reference's existing geometry, asset-library and material contracts substitute for the failed help response, followed by `get_scene_info({})`. This does not grant later-version import capabilities. The help tool generates documentation and does not initialize other modeling tools. This exception does not prove scene connectivity: independently verify target page, UI connection, unique bridge connection and scene response before continuing.

Do not apply the exception to another error or an unverified version. Preserve the error and check connections or version information. Do not patch npm cache packages or call hidden methods to bypass it.

## Results and object identity

Tools send commands to the Freeform page over WebSocket. Many results are passed through as text without a stable, shared JSON structure. Read actual content to distinguish errors from results; do not rely only on outer `isError`. A disconnected response may be ordinary text.

Do not assume `objects`, `objectId`, `success` or other fixed fields. Use actual returned object names and types for queries and edits, confirming through a full scene query when needed. Requested creation names may change.

`group` covers library models and basic geometry; faces use `face`, auxiliary curves use `auxiliary_curve`. Custom furniture may span several groups. Maintain a mapping from semantic furniture names to every actual component name; current public tools do not establish a general assembly-parent API.

## Coordinates and dimensions

- Lengths use **mm** in a Z-up right-handed system: XY is horizontal, Z is height. Camera changes do not change world axes.
- `location` is the object center `[x,y,z]`; `rotation` uses degrees about XYZ following the right-hand rule.
- Public descriptions of `create_object` / `modify_object` / generated-import `dimensions` and asset `originalDimensions` / `targetDimensions` say `[width,height,depth]`, while package guidance also describes model dimensions as `(x,y,z)`. Neither the second nor third entry can be assumed to be world-vertical height without verification.
- Confirm the axis-to-size relationship using actual object bounds, geometry coordinates or page observations. Use real returned fields, not local type extensions or assertions for undeclared properties. If uncertain, collect evidence rather than repeatedly swapping array entries.
- Ground placement may use `z=h/2` only after confirming the object is upright, its center matches its bounding-box center and its actual vertical height is `h`. For tilted, offset or supported objects, determine the bottom from transformed bounds. Tabletop objects and pendant lights do not all belong on the floor.
- Preserve the original dimension order from asset search and pass it unchanged as `originalDimensions`; estimates cannot replace it. Check target proportions and orientation after placement.

## Common public tool inputs

This table lists inputs relevant to the plugin. Read current declarations before using other optional parameters or geometry command formats.

| Purpose | Tool and input |
|---|---|
| Query scene | `get_scene_info({})` |
| Query named objects | `get_objects_info({names, type})`; `type` is `face`, `group` or `auxiliary_curve` |
| Current selection | `get_selection({type})`; same types |
| Create geometry | `create_object({type, name?, location?, rotation?, dimensions?})`; common types are `CUBE`, `SPHERE`, `CYLINDER`, `PLANE`, `CONE`, `TORUS`, subject to actual successful page results |
| Modify object | `modify_object({name, location?, rotation?, dimensions?, visible?})`; dimensions are absolute sizes, not an undeclared `scale` |
| Copy group | `copy_object({name, newName, location?, rotation?, dimensions?})`; groups only |
| Delete | `delete_objects({names, type})`; actual existing names and correct type only |
| List materials | `get_material_names({})` |
| Group material | `set_group_material({modelName, materialName})` |
| Face material | `set_face_material({faceName, materialName})` |
| Batch asset search | `batch_search_kjl_assets({descriptions})`; use specific Chinese search keywords as required by this tool |
| Asset preview | `batch_get_kjl_asset_snapshot({modelIds})`; IDs come from search results |
| Place asset | `place_kjl_asset({modelId, name, originalDimensions, location, targetDimensions, rotation?})` |
| Replace with library asset | `replace_kjl_asset({targetName, newModelId, newName, originalDimensions, targetDimensions?})` |
| Import generated asset | In 1.0.31: `import_generated_asset({name, model_url, brandgoodid?, location, dimensions, rotation?})`; pass Lux3D `generatedModelUrl` as `model_url` and `obsBrandGoodId` as `brandgoodid`, omit optional `preview_image_url`; see [AI generation and import](ai-generation.md) |
| Query import | In 1.0.31: `poll_import_status({import_uuid})`; use the actual import UUID |
| Scene screenshot | `get_scene_screenshot({view_angle})`; `auto` or `front/back/left/right/top/bottom` |
| Object screenshot | `get_objects_screenshot({groupNames, view_angle})`; groups only, using the six orthogonal directions above |

Use only material names actually returned by `get_material_names`. This version's public material tools list or set names; they expose no material previews, arbitrary RGB/HEX, texture scale/direction, roughness or emission controls, and no lighting tool. Do not invent a material name from a requested color or add undeclared parameters. Verify appearance in the page instead of relying on names. Explain unavailable approximations and ask the user to choose an alternative when color or another visual property is central.

Asset search accepts only an array of Chinese descriptions, with no image input or independent size, color or material filters. Translate the intended search concepts into Chinese for the tool while keeping explanations in the user's language. Express desired features in descriptions, then evaluate real results and previews. Lack of image-search input does not prevent viewing candidate images.

Search for real model IDs and original dimensions before placement or replacement. Follow SKILL.md's preview/comparison rule for important assets. `replace_kjl_asset` preserves position and rotation and aligns model centers, but may change floor contact; recheck afterward. Do not use one component name as the replacement target for an entire composite piece of furniture.

Scene screenshots support only those directions; `auto` is an overall elevated oblique view. No camera position, look-at target or FOV input is exposed. Object screenshots support only six orthogonal views. For other viewpoints, use public, available browser/page interactions. Otherwise explain viewpoint differences and unverified areas; do not guess internal camera objects or send undeclared parameters.

Single-search and Tripo3D generation tools present in source are not registered and must not be called. Version 1.0.31 exposes generated-asset import separately with `brandgoodid`; Lux3D generates the model under [ai-generation.md](ai-generation.md). Version 1.0.27 lacks that import capability.

## Reference-based materials and the two-replacement limit

For image-based modeling, use the reference image both for initial selection and the final material comparison. If the user borrows only selected visual features, stay within that scope. Choose close materials initially; do not rely on later replacement to compensate for arbitrary choices.

For the floor-plan workflow, "reference image" means the corresponding space's rendered design image. Use it for material and appearance selection and acceptance, while the original floor plan governs structure, dimensions and relationships. Complete [images for all spaces](../SKILL.md#render-each-space-before-modeling-a-floor-plan) before modeling. Do not infer unspecified materials from a floor plan.

1. **Select materials.** Record material type, main color and brightness, texture pattern, scale/direction, observable sheen and coverage per object or material region. Select close candidates from actual `get_material_names` results and judge the page appearance. Matching categories or names do not prove visual similarity. Use only public parameters; do not invent color, texture, roughness or lighting controls.
2. **Compare again after modeling.** Inspect the actual canvas and needed local views against relevant reference areas. Record differences in material type, color, texture or coverage that materially change the intended appearance, then automatically enter replacement. First distinguish lighting, viewpoint and rendering effects from materials. If the view is unusable or the cause unknown, collect evidence and explain limitations instead of blindly replacing or claiming success.
3. **Count per target.** Each object or material region permits at most **2 automatic replacements**, excluding initial selection. Preserve the originally defined target scope: applying one replacement material to multiple faces of one region counts once; splitting targets cannot increase the allowance. Count an attempt before applying a new candidate. Failed or uncertain application still uses that attempt. Failure recovery and visual improvements share the limit. Record target, reference features, tried materials, count and comparison results; do not reset across turns or context restoration.
4. **Recheck each replacement.** Within the remaining allowance, choose a different, evidence-based closer candidate and modify mismatched targets serially while preserving other objects and matched areas. After every replacement, read the actual output and compare color, texture, sheen and coverage against the reference. Stop when satisfactory rather than using all attempts. If outcome is unknown, verify application before another call. Stop early and explain if suitable candidates or required capabilities/connections are unavailable.
5. **Let the user decide at the limit.** After two replacements on a target, stop if a clear mismatch remains or the user is dissatisfied. Preserve and show the current result and available comparison views. Explain tried materials, remaining differences and tool limits, then ask the user to accept, select a material or authorize another approach. Without a new explicit choice, do not attempt a third replacement, automatically restore an old material or regenerate a model to bypass the limit. Other targets may continue within their own authorized allowance.

## Automatic replacement after material failure

The workflow permits automatically finding and applying similar materials after a confirmed Coohom material application failure, during initial modeling or later edits. Multiple similar candidates do not require repeated approval. For image-based work, the preceding two-replacement count and stop rules still apply; this section adds no allowance.

1. Record the failed target group/face, material name and original response, then check connection and target. A confirmed application failure, such as `Material not found` or a page showing material load/application failure, permits replacement without identifying the failed material's internal cause. Disconnection, missing objects/faces and timeouts do not prove an unsuitable material. Read scene and page to check whether it applied; if still unknown, collect evidence under the recovery rules.
2. Call `get_material_names({})` again and select among actual names. In 1.0.31 this tool has no keyword input and no separate similarity-search API. Do not invent search tools, arguments or material names. Combine available names, reference evidence and page results to prefer similar type, color, texture and style; do not choose the first entry or any arbitrary same-category material.
3. Exclude candidates already confirmed to fail for this target in this turn. Apply similar candidates serially with `set_group_material({modelName, materialName})` or `set_face_material({faceName, materialName})`. Change only the original target's material and preserve other objects and successful materials. Try a given candidate on a given target at most once per turn. Continue after a confirmed candidate failure only within the applicable allowance; refreshing the list does not reset the image-based limit or permit cycling through failed names.
4. Check actual output, target page and available object information after each application, including coverage and appearance. Stop and record the final material when application succeeds and the replacement goal is met. If the tool succeeds but no valid view is available, report visual verification as incomplete; a screenshot problem is not a reason to replace again.
5. Stop if similar candidates are exhausted, no suitable candidate exists, connection/object faults affect all candidates, or only a materially different result is possible. Preserve the result, explain failures and limits and let the user choose next steps. Briefly disclose the actual substitute and remaining visual differences at delivery.

## Detailed geometry

For details beyond primitives, inspect current inputs before using `add_faces`, `get_face_path`, `find_face_by_points`, `pull_faces`, `create_auxiliary_curve` or `sweep`.

- Each face must be closed and coplanar. Intersections can split existing faces and invalidate their identities; relocate them afterward with `find_face_by_points`.
- Sweeps use a face as the cross-section and delete that face on completion; another sweep needs a new cross-section. Paths must be continuous and cross-section/path orientation must meet current tool guidance. Do not pass an entire group as the cross-section.
- Prepare cross-sections in empty space away from the main model to avoid accidental cuts. Remove only confirmed unnecessary auxiliary elements created for this operation.
- All Bezier control points must be coplanar. An arc's three defining points must not be collinear.

## Result checks and recovery

Query actual results after additions, replacements, deletion and topology changes. A returned object name or update notice does not contain guaranteed final dimensions, materials or bounds. Use real scene/object queries without assumed fields. Perform SKILL.md's spatial and visual checks with both object information and the actual page. No public standalone tool supports claiming that strict collision detection passed.

After a write timeout, query the scene first. Retry only after confirming it was not executed and the cause is resolved. For missing objects, reread scene and selection. Follow [browser-session.md](browser-session.md) for connection failures. Collect evidence and explain choices for unexplained errors rather than repeatedly changing parameters.

Screenshots can be inverted; compare with the real page without flipping the model to fix the image. Leave the Freeform page visible at delivery and do not automatically save or publish.
