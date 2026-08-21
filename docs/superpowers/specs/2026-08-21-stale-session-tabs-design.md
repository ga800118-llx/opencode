# Stale Session Tab Reconciliation Design

## Goal

Remove persisted session tabs that refer to sessions which the connected server has definitively deleted, while preserving drafts and all tabs whose server is unavailable or returns a non-not-found error.

## Context

Session history and titlebar tab state use different persistence layers. Clearing or replacing the session database can therefore leave valid-looking session references in the window tab store and recently closed stack. The existing cleanup path only runs when the renderer receives an explicit session deletion or archive event.

## Chosen Approach

After persisted tab state and a server's initial synchronization are ready, reconcile unique session references from both the open tab list and recently closed stack. Resolve each session through that server's compatibility-aware session API with a forced read.

Classify results as:

- `present`: keep the reference and do not probe it again during the current app process.
- `missing`: remove the session through the existing `removeSessions` action so open tabs, recently closed entries, tab metadata, memory state, recent selection, and navigation remain consistent.
- `unavailable`: keep the reference and allow a later reconciliation attempt.

The reconciler deduplicates identical server/session references so duplicate recently closed entries do not create duplicate requests.

## Safety Rules

- Never infer deletion from an empty or partially loaded project session list.
- Never delete a tab because a server is disconnected, still bootstrapping, timed out, unauthorized, or returned an unexpected error.
- Never reconcile draft tabs as server sessions.
- Run only after the corresponding server synchronization reports ready.
- Use the existing typed and local session-not-found predicates; do not match arbitrary error text or generic HTTP failures.

## Code Boundaries

- `packages/app/src/context/session-tab-reconciliation.ts`: pure process-local reconciliation controller and result vocabulary.
- `packages/app/src/context/tabs.tsx`: gather persisted open/closed session references, probe through the matching server context, and route confirmed removals through `removeSessions`.
- `packages/app/src/context/tabs.test.ts`: unit coverage for deduplication, confirmed removal, retention, and retry behavior.

## Verification

- Focused tab reconciliation tests under the app package.
- Existing tab tests to protect close/reopen/navigation behavior.
- App package typecheck.
- Manual restart with an empty session database: stale titlebar and recently closed session references disappear after local server synchronization completes.

