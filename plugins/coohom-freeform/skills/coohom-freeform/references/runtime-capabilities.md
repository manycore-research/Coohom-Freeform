# Runtime capability discovery and MCP maintenance

## Source of truth

The plugin owns workflow and user decisions. Each currently loaded MCP owns its tool names, argument schema, output schema and semantic descriptions. Derive interface contracts from those current public declarations.

1. Discover the actual tools of both installed MCPs through the host's tool discovery. Read full descriptions and `inputSchema`, and `outputSchema` when provided. With a public MCP client, use standard `tools/list` and follow pagination. Never pretend a tools/list operation is itself a registered tool. Use the tool namespace actually exposed in this task.
2. Identify capabilities by purpose: workspace preparation, image generation, task query, balance/payment, scene query, asset import/placement, materials and modeling. Resolve only capabilities needed by the current operation; a missing optional screenshot or scripting capability must not block unrelated edits. Choose a currently declared tool that provides the required capability.
3. Before a call, derive required fields, allowed optional fields, enums, units, resource identity and side effects from those declarations. Public package README/type declarations and public help tools may clarify semantics. Package source, hidden page state and observed undocumented fields do not establish a public contract. Never add a cast or local type to manufacture missing capability. Ask before relying on an undeclared observation.
4. Keep a compact per-task capability record: actual service/version when known, selected tool, required inputs and their sources, output branch semantics, coordinate conventions, and selected handoff route. Refresh after MCP restart/upgrade or tool-list change. Preserve generation IDs and scene records across refresh. If the host still exposes the old tools, explain that a new task or MCP reload is needed; do not call a new schema through an old binding.
5. Prefer `structuredContent` when present. Validate it against declared output branches when available; also inspect `isError`, text and resource links. Text is not necessarily pure JSON. Absence of outputSchema is permitted by MCP: use documented semantics plus actual returned data. Unknown or conflicting semantics require evidence and user decision, not field guessing.

## Asset handoff

Before paid generation, check that at least one route declared by `freeform-modeling-mcp` can consume the kinds of output declared by `@manycore/coohom-lux3d-mcp`. This is a preflight, not proof of future generation/import success.

After a completed generation, record the real task identity, terminal result, model URL/format, asset identifiers, dimensions and previews **only when actually provided**. Match each target-required input to a real, semantically compatible source. Similar names are not sufficient; differing names are acceptable only when the public descriptions establish the same meaning. Preserve opaque IDs without lossy numeric conversion.

- Use a direct asset placement/replacement route when all its required identity, geometry and placement data are available with matching declared semantics.
- Otherwise use a publicly declared generic model-URL import route if it accepts the actual format and all its required inputs are available. Desired placement size may be estimated from the design and disclosed; original model dimensions must come from authoritative output/metadata, not those estimates.
- If several valid routes have equivalent effect, prefer the one retaining asset identity; if they produce materially different user results, explain choices and let the user decide.
- If neither route is possible, state the exact missing requirement and preserve the generated output. Do not fabricate dimensions, add undeclared parameters, regenerate, or change versions automatically.

For asynchronous imports, use the actual returned job identity and its declared status tool. Synchronous placement does not create an imaginary import job. Verify the resulting scene independently.

## Installation and recovery

Installation and explicit updates request both MCPs at `latest`. Ordinary startup uses the installed pair; changing plugin prose does not update dependencies. A running task keeps its processes and records until the user chooses an appropriate restart. Do not upgrade MCPs mid-generation or during scene writes.

Both services must install successfully before the pair is activated. Retaining old files is not authorization to fall back. Report separately: **installed**, **initialized/discovered**, **task-required contracts matched**, **actual task verified**. An installation or tools/list pass never proves end-to-end compatibility.

- First installation failure: report requested versions (or latest if resolution failed), failed service/stage and sanitized reason. Ask **retry or stop**. Do not retry automatically.
- Only after that explicit retry also fails: ask whether to try **another explicit pair of versions or stop**. Show both exact candidate versions and known validation evidence before consent. A historical pair is not proof of current compatibility. Never change only one dependency silently.
- If the user selects another pair, install that exact pair and recheck initialization, task-required contracts and actual behavior. Further failures require another user choice.
- Installation succeeded but initialization, schema semantics or asset handoff failed: report it as a distinct compatibility/readiness issue. Do not convert it to an installation failure to unlock automatic fallback.

Use the installed source paths from Codex's plugin metadata, not paths copied from examples. ZIP/local runtime: run the bundled Node with `runtime/mcp/manage-mcp.mjs <plugin-root> status`, then `install`, `retry`, or `versions <freeform-exact> <lux3d-exact>` only as authorized. The command installs a pair independently of the plugin version. For ZIP installer recovery, rerun the original installer with `--retry-mcp`, or after the next explicit decision with `--mcp-versions <freeform-exact> <lux3d-exact>`; `--yes` does not approve retries or alternative versions.

Marketplace: use `scripts/bootstrap freeform status|install|retry|versions [freeform-exact lux3d-exact]` (Windows: `scripts/bootstrap.cmd`). This targets the shared pair for both services, not just `freeform-modeling-mcp`. Preserve the reported cache root. Inspect status before acting; the bootstrap can require Node preparation if the Node runtime is missing. Never delete the recovery state to bypass the decision flow. Interrupted locks require process/state diagnosis before removing a confirmed stale lock.

These rules reduce coupling; they cannot repair inconsistent upstream semantics, unavailable required data or unsupported host/runtime capabilities. State those limits precisely without claiming permanent compatibility with every future MCP.
