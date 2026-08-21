# V2 Session Automatic Title Design

## Problem

Desktop prompts now run through the V2 Session runner, but automatic title generation remains attached only to the legacy prompt loop. New tasks therefore keep their timestamp-based `New session` title in durable storage, so every tab and session list displays the same generic label.

## Behavior

- After the first successful V2 execution, schedule title generation without delaying the visible assistant response.
- Generate the title with the selected private model and the hidden `title` agent instructions.
- Give the auxiliary model call a short timeout and do not expose it as conversation content or a normal task execution.
- If model generation fails or produces no usable text, derive a concise title from the first user message and attached filenames.
- Update only root sessions whose current title still matches the generated default-title format.
- Re-read the session before writing so a manual rename always wins.
- Coalesce process-local title jobs so rapid prompt activity cannot start duplicate title requests for one session.

## Data Flow

1. The V2 runner completes a normal execution and publishes its existing success event.
2. It checks the durable session title and first user message, then starts one bounded background title job.
3. The job resolves the session's selected model, streams a tool-free title request, and cleans the first non-empty output line.
4. The job falls back to a normalized prefix of the first prompt when model output is unavailable.
5. It reloads the session and publishes the existing `SessionV1.Event.Updated` event with the new title only if the title is still default.
6. Existing projectors persist the update and existing desktop synchronization refreshes tabs, sidebars, and task lists.

## Failure Handling

Title generation is auxiliary. Provider errors, timeouts, malformed output, or missing title-agent configuration are logged and converted to the local fallback. They never fail, interrupt, or extend the main conversation execution. Closing the app before a background job finishes leaves the default title intact, allowing a later successful execution to retry.

## Verification

- A V2 runner test proves a default title is replaced from the first prompt after a successful turn.
- A fallback test proves empty model output still produces a useful title.
- A preservation test proves an existing or manually changed title is not overwritten and does not trigger an auxiliary request.
- Core type checking and the focused runner tests must pass.
- A real desktop task must update its tab title after the first answer while the conversation remains responsive.
