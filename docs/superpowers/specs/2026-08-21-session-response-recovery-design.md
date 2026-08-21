# Session Response Recovery Design

## Problem

After a private model profile is repaired, discovery and capability tests succeed and the backend completes new prompts, but the desktop timeline remains blank. The durable database contains the assistant response. The renderer logs a rejected message query with `limit=0` immediately after execution completes.

Two defects combine to produce this behavior:

1. V2 capability detection recognizes `/api/event` as the current event stream but not the actual typed `/event` route. Because `/global/event` is also present, the renderer selects the legacy global stream and does not project current V2 response events directly.
2. The execution-completion repair sync reuses a cached message count of zero as the next API page limit. The V2 message API requires a positive limit, so the repair request fails.

## Design

Use two independent recovery layers:

- Treat either `/event` or `/api/event` as a current V2 event-stream capability. Prefer the current stream whenever either route is available; retain `/global/event` only as compatibility fallback.
- Normalize every latest-message fetch to a positive page size. When a cached or requested limit is zero, use the standard initial message page size instead of sending an invalid query.

The first layer restores live response rendering. The second layer guarantees that completion-time repair can recover a response after a dropped or restarted event stream.

## Scope

Change only application-side protocol capability detection and session message synchronization. Do not modify provider calls, credential storage, runtime restart behavior, model profile data, durable session data, or tab persistence.

## Error Handling

Existing event reconnect and sync error handling remains in place. The fallback message request becomes valid by construction, so no new user-facing error state is required.

## Verification

- Protocol tests cover a V2 OpenAPI document exposing `/event` with `/global/event` and assert that the current stream is selected.
- Session tests reproduce an initially empty cached page followed by execution completion and assert that the repair fetch uses the normal positive page size and projects the assistant response.
- Existing application unit tests and package type checking pass.
- In the live Electron app, a new prompt displays the private-model response without restarting or reopening the task, and no new `limit=0` schema rejection appears.
