# Collapsible Assistant Process Design

## Goal

Keep each assistant turn visually concise by collecting reasoning, tool calls, command output, and intermediate assistant content into one Codex-style process disclosure while leaving the final answer visible.

## Content Model

The final answer is the trailing run of non-empty text parts in an assistant turn. Every renderable assistant item before that run belongs to the process disclosure. This preserves the original chronological order without trying to classify or summarize individual tools.

If a completed turn has no process items, it renders exactly as it does today and does not show an empty disclosure. If a busy turn has process items but no final text yet, all current items stay inside the disclosure.

Existing reasoning visibility settings remain authoritative. Reasoning omitted by that setting is not reintroduced by the disclosure.

## Interaction

- One process disclosure is rendered per user turn.
- The disclosure is collapsed by default.
- While the turn is busy, its label is `Processing {{duration}}` (`处理中 {{duration}}` in Simplified Chinese).
- After completion, its label is `Took {{duration}}` (`耗时 {{duration}}` in Simplified Chinese).
- The duration starts at the user message creation time. Completed turns use the latest assistant completion timestamp; active turns update from the current time.
- Clicking the full header toggles the process content. The chevron points right when collapsed and down when expanded.
- Expansion state belongs to the turn and is retained in the existing per-session timeline cache.
- The expanded content uses the current reasoning and tool renderers unchanged.
- A divider separates the disclosure header from expanded content and the final answer.

## Failure And Edge Cases

- A turn with only a final text answer has no disclosure.
- A turn with process content and no final text still has a disclosure.
- Interrupted markers remain in chronological order inside process content when no completed final answer follows them.
- Empty or hidden parts do not create a disclosure.
- Expanding a virtualized timeline row triggers remeasurement so later rows do not overlap.

## Out Of Scope

- Translating or summarizing reasoning.
- Replacing tool calls with natural-language activity descriptions.
- Distinguishing commentary text from final-channel text when the protocol exposes both as ordinary text.
- Persisting disclosure state across application restarts.
- Changing provider or server message schemas.

## Verification

Focused row-construction tests prove process/final grouping and empty-process behavior. Package type checking and the current timeline test suite guard integration. Browser verification confirms the collapsed default, elapsed label, chevron toggle, expanded ordering, divider, and final-answer visibility.
