# Runtime State Consistency Design

## Goal

Fix the three runtime-state defects found during the 2026-08-22 Mac beta test:

- an existing task cannot switch to Auto approve on the bundled V2 server;
- elapsed time stops advancing during an in-progress tool turn;
- a newly configured default model may not appear until the default is selected again.

The fixes must preserve private-model-only behavior, the existing stable compatibility routes, task history, and packaged Mac and Windows support.

## Architecture

### Permission Mode Transport

Keep the vendored promise client for its existing application API surface. Its V2 session namespace predates `switchPermissionMode`, so the compatibility adapter will explicitly route that one V2 operation through the generated JavaScript SDK already created for the same server connection. The SDK exposes `v2.session.switchPermissionMode` and carries the existing authentication and fetch implementation.

The compatibility adapter must own this protocol difference. Application permission state must call a real typed `CompatibleSessionApi` method without asserting that an unavailable runtime method exists.

For an existing task, a failed switch restores the previous project default and never responds to pending permissions as if Auto approve had succeeded. The server-confirmed task mode remains authoritative until the forced task refresh returns the new mode.

### Running Turn Duration

While a turn is working, its duration is always `now - userMessage.time.created`. Completed intermediate assistant messages are ignored for the running duration because tool loops legitimately complete more than one assistant message before the turn becomes idle.

After the turn becomes idle, the duration freezes at the latest valid assistant completion timestamp. The calculation will live in the timeline model as a pure tested function.

### Model Runtime Refresh

Model mutations restart or reload the Sidecar and may overlap the automatic `server.connected` refresh. A normal refresh may continue to coalesce duplicate background requests, but a model mutation requires a fresh result that starts after any already-running refresh.

The runtime refresh controller will support a `fresh` request. When a refresh is active, all concurrent fresh requests share one trailing run. Model Center save, remove, and default selection use this mode. Other reconnect and status refreshes retain the current coalescing behavior.

## Error Handling

- A V2 permission switch failure is surfaced through the existing error toast and does not leave the project default changed.
- A failed permission switch does not auto-answer any pending permission request.
- A trailing model refresh runs even if the earlier overlapping refresh failed; the mutation caller receives the trailing result.
- Existing runtime refresh error reporting remains unchanged for ordinary callers.

## Testing

- Use the real vendored promise client and generated SDK in a compatibility test that asserts the V2 permission request reaches `/api/session/:id/permission-mode`.
- Extend permission-state tests for rollback and pending-request safety.
- Add pure duration tests covering intermediate assistant completion while the turn remains active.
- Extend runtime-refresh tests for one trailing run, concurrent fresh-call coalescing, and recovery after an earlier failed refresh.
- Run focused tests and `bun typecheck` from `packages/app`.
- Run focused server permission tests from `packages/opencode` and desktop model tests from `packages/desktop` when their touched contracts require it.

## Out Of Scope

- Replacing every use of the vendored promise client.
- Changing permission mode product copy or adding granular rules.
- Long-running model calls, 65-minute execution tests, release signing, notarization, or store publishing.
- Repackaging Mac or Windows installers in this repair pass.
