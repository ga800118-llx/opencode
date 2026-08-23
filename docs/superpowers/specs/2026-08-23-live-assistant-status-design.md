# Live Assistant Status Design

## Goal

Show one ephemeral, animated status line at the bottom of the active assistant reply while the session is working.

## Behavior

- The active turn contains exactly one live status row after every visible assistant answer part.
- With no running tool, the row says `Processing...` (`处理中…` in Simplified Chinese).
- When one or more tools are pending or running, the row reports the most recently emitted active tool, for example `Calling tool: Read` (`正在调用工具：读取`).
- Tool completion returns the same row to `Processing...`; status changes replace text in place and never append history.
- The row disappears immediately when the session becomes idle. It does not leave a completed record.
- Retry and error presentation remain authoritative and do not show the live row.
- The existing elapsed-time process disclosure and its detailed tool/reasoning history are unchanged.

## Data And Ordering

Extend the existing timeline projection's transient activity row rather than adding a new server event or protocol type. While the latest turn is busy and has no terminal error, append one stable-key activity row after process groups and final-answer parts. Store only the latest active tool name on the row; pending and running tool states are already available in normalized message parts.

This ordering keeps the row at the bottom whether the model is thinking, streaming text, or running a tool. The stable row key prevents virtual-list churn when the tool name changes.

## Presentation

Reuse `TextShimmer` for the existing low-intensity 1.2-second sweep and its built-in reduced-motion behavior. A 160ms opacity entrance applies when the status label changes. The row keeps the existing 20px minimum height so label changes do not move surrounding content.

Add two UI translation keys in English, Simplified Chinese, and Traditional Chinese. Other locales inherit the English fallback through the existing dictionary merge.

## Testing

- Projection tests verify busy turns append one activity row after streamed answer text.
- Projection tests verify the most recent pending/running tool is selected.
- Projection tests verify idle, retry, and error turns have no activity row.
- Focused timeline tests, app typecheck, and the app production build must pass.
- Manual desktop verification must observe status ordering, live tool replacement, animation, and immediate removal on completion.

## Scope Guard

Do not change model requests, tool execution, session status calculation, timers, process disclosure contents, permissions, file actions, server APIs, generated clients, desktop startup, or packaging.
