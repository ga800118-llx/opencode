# Default Model Selection Design

## Goal

Allow any model in a saved model source to become the application's default model, regardless of whether it has been tested or supports structured tool calls.

## Problem

The current model source editor enables **Make default** only when the selected model's latest capability report is `agent-capable`. This couples two separate decisions:

- which model should be selected automatically for a new task;
- whether that model can complete structured tool calls.

Chat-capable models such as `DeepSeek V4 Pro` can still be useful as the user's preferred default even when the compatibility probe reports limited or unstable tool support.

## Design

### Default Selection

The **Make default** action is available when all of these conditions are true:

- the model source has already been saved;
- a model in that source is selected;
- the form is not currently saving or deleting.

The selected model must still belong to the saved source. Capability reports do not participate in this validation.

This rule applies at every boundary. The renderer form, shared configuration builder, and desktop model-center service must not reintroduce an `agent-capable` requirement after another layer has accepted the selection.

Selecting the default updates the existing global OpenCode `model` configuration. New tasks use that model when no task-specific or agent-specific model selection takes precedence. Existing explicit task model selections are not overwritten.

Default selection does not refresh provider catalogs after the configuration write. The provider and model inventory has not changed, and the global configuration update already drives configuration synchronization. A failing provider refetch must not turn an already-persisted default-model change into a product error.

### Capability Information

Capability testing remains unchanged and continues to show whether the selected model supports chat, streaming, and structured tool calls. Untested, chat-only, partially compatible, and incompatible results do not block default selection.

The application does not show a confirmation dialog when setting a limited model as default. If a later task requires tools that the model cannot provide, the existing task error remains responsible for explaining the failure. The application does not silently replace the user's chosen model.

### Copy

The empty default-model description must no longer instruct the user to test a model first. It should explain that the user can choose the model used by new tasks.

## Validation And Error Handling

The configuration layer continues to reject a model ID that does not belong to the selected profile. The error should describe that ownership constraint instead of referring to agent capability testing.

## Testing

Add or update focused tests proving that:

- an untested model can produce the global default-model config patch;
- a model with a non-agent-capable test result can become the default;
- a model outside the profile is still rejected;
- the editor enables **Make default** for a selected model without a capability report;
- save and delete activity still disables the action;
- selecting a default completes after the global config update without an unrelated provider refresh;
- the desktop host accepts untested and non-agent-capable models as defaults;
- English and Chinese empty-state copy no longer requires capability testing.

## Out Of Scope

- changing the capability probe;
- retrying tool calls at runtime;
- automatically choosing a different model for agent tasks;
- separating chat and agent defaults into two settings.
