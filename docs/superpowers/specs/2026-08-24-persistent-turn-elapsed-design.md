# Persistent Turn Elapsed Design

## Goal

Restore the original persistent `Elapsed <duration>` disclosure at the top of every assistant turn while keeping the new live activity status as a separate row at the bottom of the active answer.

## Behavior

- Every turn that has an assistant reply, plus the currently active busy turn, has one process row immediately after the user message and any turn divider.
- The process row always uses the elapsed-time wording, including while the turn is active. It never changes to `Processing <duration>`.
- The elapsed time continues to update while the turn is active and freezes at the latest assistant completion time when the turn becomes idle.
- The process row remains visible after completion, including for text-only answers with no tool call.
- When reasoning, tool, or interruption items exist, the process row remains collapsible and reveals those items.
- When no process items exist, the row shows the elapsed label and divider without a chevron or empty expandable region.
- The live status row remains the last row of the active answer and disappears immediately when the turn becomes idle.
- A pending or running tool keeps `Calling tool: <name>` visible even when later text is streamed. The status changes to `Processing...` only after no tool remains pending or running, or changes directly to a newer active tool.

## Architecture

Use `AssistantProcess` as the sole owner of the top elapsed label and collapsible process history. Project it for every reply-bearing turn and the active busy turn instead of only when process items exist. Remove the temporary `Thinking` row because it duplicates the timer and disappears as soon as assistant content arrives.

Keep `AssistantActivity` independent and last. Its tool selection continues to inspect all current assistant parts and selects the most recently emitted part whose state is `pending` or `running`.

## Testing

- A completed text-only turn keeps an empty `AssistantProcess` before the answer.
- A busy turn with no assistant content uses `AssistantProcess`, followed by `AssistantActivity`.
- A streaming text answer keeps `AssistantProcess` before the answer and `AssistantActivity` after it.
- A running tool remains selected even if text follows it.
- A completed tool is no longer selected by the live activity row.
- Focused timeline tests, app typecheck, and app production build pass.

## Scope Guard

Do not change model requests, tool execution, server state, timeout behavior, permissions, file actions, provider configuration, generated clients, desktop startup, or packaging.
