# Session Response Recovery Design

## Problem

After a private model profile is repaired, discovery and capability tests succeed and the backend completes new prompts, but the desktop timeline can remain blank until the task is reopened. The durable database contains the assistant response. The renderer logs a rejected message query with `limit=0` immediately after execution completes.

Two synchronization defects produce this behavior:

1. The execution-completion repair reuses a cached message count of zero as the next API page limit. The V2 message API requires a positive limit, so the repair request fails.
2. A terminal execution event can arrive while the initial page, a forced refresh, or a history page is still loading. A coalesced repair can then finish without issuing a trailing latest-page request.

The current V2 event client uses `/api/event`. The separate typed `/event` route is not a compatible substitute, so capability detection must continue to select the legacy global stream when `/api/event` is absent and `/global/event` is available.

## Design

Keep normal message synchronization unchanged and make completion repair explicit:

- Wait for an active session synchronization before starting completion repair.
- If a direct history message load is active, record a pending repair and run it when that load finishes.
- Cancel queued or waiting repairs when the session generation is evicted or deleted.
- Fetch at least the standard initial page size during V2 completion repair, even when the cached page contains zero messages.
- Preserve caller-supplied limits on normal synchronization, including the existing V1 behavior.

This recovery path does not depend on receiving every streamed response event. Once a terminal execution event arrives, the latest durable messages are fetched and projected into the timeline.

## Scope

Change only application-side session message synchronization and event-route regression coverage. Do not modify provider calls, credential storage, runtime restart behavior, model profile data, durable session data, or tab persistence.

## Error Handling

Completion repair remains best effort and uses existing sync error handling. Repeated terminal events and concurrent loads coalesce into one trailing repair per session.

## Verification

- Protocol tests confirm `/api/event` selects the current stream and `/event` alone does not redirect the current client.
- Session tests cover an empty initial page, completion during initial loading, completion during history loading, deletion during a pending repair, and unchanged V1 zero-limit behavior.
- Existing application unit tests and package type checking pass.
- In the live Electron app, a new prompt displays the private-model response without restarting or reopening the task, and no new `limit=0` schema rejection appears.
