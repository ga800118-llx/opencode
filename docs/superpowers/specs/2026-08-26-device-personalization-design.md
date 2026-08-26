# Device Personalization Design

## Goal

Add one simple, device-local personalization setting that lets the user describe Guai Code's role, working style, and response style. The same text applies to normal conversations in every project on that installation.

## Product Scope

- Add a `Personalization` (`个性化`) tab to desktop settings.
- Show one large `Custom personality` (`自定义性格`) text area.
- Provide explicit `Save` (`保存`) and `Restore default` (`恢复默认`) actions.
- Keep the value local to this installation. It does not sync to another computer.
- Apply a saved value starting with the next user message, including messages in an already open session.
- Leave existing conversation history unchanged.
- Treat an empty value as disabled and preserve today's behavior exactly.

The first version does not provide presets, multiple personalities, per-project assignments, model parameters, agent permissions, or personality import/export.

## Safety Boundary

The saved text is an additive user preference. It must not replace or edit:

- provider-specific system prompts;
- built-in agent prompts;
- project instructions and references;
- skills or MCP instructions;
- tool permissions;
- model configuration;
- title, summary, compaction, or other internal agent prompts.

Only ordinary interactive prompts initiated from the desktop composer receive the personalization text. The existing optional per-message `system` field is the integration point because the request preparation pipeline appends it after the existing base and runtime instructions.

## Interface

The settings navigation label is `个性化`, not `智能体`. The page contains:

- Title: `自定义性格`
- Description: `设置 Guai Code 的角色、做事方式和回答风格，适用于本机所有项目。`
- A multiline text area with an example placeholder.
- A secondary `恢复默认` button.
- A primary `保存` button.

Editing the field does not affect requests until the user saves. Save is disabled when the draft matches the stored value. Restore default asks for confirmation when a saved or unsaved value would be discarded, clears the value, persists the empty state, and affects the next message.

## Storage And Data Flow

Store the string in the existing desktop settings persistence layer under a focused personalization setting. Normalize whitespace-only input to an empty string.

For each ordinary composer submission:

1. Read the saved personalization value.
2. If empty, preserve the existing request payload without a `system` field change.
3. If nonempty, place the value in the existing per-message `system` field.
4. Submit through the existing local or remote server compatibility layer.
5. The server appends that field after its existing system instructions for that provider turn.

This request-level transport means one desktop installation behaves consistently across local projects and compatible remote servers without writing personality files into projects or changing server configuration.

## Failure Behavior

- A failed save leaves the previous persisted value active and shows an error toast.
- Restore default does not invent or copy a replacement prompt; it stores the empty state.
- If a connected legacy server cannot accept the optional system field, the existing compatibility behavior remains authoritative and the UI must not mutate model or session selection as a fallback.

## Verification

- Unit-test persistence defaults, save, whitespace normalization, and restore behavior.
- Unit-test request composition for empty and nonempty personalization.
- Verify internal prompt paths do not receive the personalization.
- Type-check the app and desktop packages.
- Run the focused settings and prompt submission tests, followed by a desktop production build.

