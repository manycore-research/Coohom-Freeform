# Browser and canvas diagnostics

Read the relevant section when a browser-control authentication error occurs or an embedded canvas is unresponsive or does not register. Follow [browser-session.md](browser-session.md) for browser selection, sign-in, scene preservation and recovery decisions. These diagnostics do not authorize refreshing a scene, switching accounts or resubmitting generation.

## Browser-control authentication errors

When Chrome control returns `unsupported Codex auth method: apikey`, treat it as a limitation of that browser-control tool. The response does not establish a Coohom sign-in or MCP permission failure, or a limitation of the Codex in-app browser. Check the in-app browser's own capabilities and evidence before applying the fallback rules. Preserve the actual error in sanitized diagnostics.

## Embedded canvas diagnostics

When an embedded canvas is unresponsive or does not register, use available logs and public status capabilities to distinguish command dispatch, acknowledgment and actual scene registration. An acknowledgment alone does not prove that the target scene is ready. Identify the failing stage before attributing the issue to browser networking or page deployment. Preserve the task and scene while collecting evidence; explain unresolved causes and recovery choices to the user.
