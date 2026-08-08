# Permission Modes Design

## Goal

Add a visible permission selector below the task composer so users can choose how much autonomy Guai Code has without editing configuration files or managing individual tool rules.

The product exposes exactly three modes: **Restricted**, **Standard**, and **Auto approve**. It does not expose a granular permission editor.

## Product Decision

Three fixed presets are the right product boundary.

A single auto-approve toggle is too narrow because it does not communicate the normal or cautious operating state. A granular rule editor would expose tool names, path patterns, and rule precedence that most users should not need to understand. The three-mode selector gives users a clear safety decision while the existing configuration format remains available for advanced rules.

## Mode Semantics

### Restricted

Restricted mode keeps project inspection useful but requires approval before operations that can materially change state or broaden access:

- project reads and searches follow the configured agent rules;
- file edits and writes require approval;
- shell commands require approval;
- access outside the project directory requires approval;
- configured hard denials remain denied and cannot be approved from the prompt.

Restricted mode does not automatically reject requests. It presents the existing permission dock so the user can allow once, allow the requested resource persistently, or deny.

### Standard

Standard mode preserves the current configured agent permission behavior. It is the default for every project that has no saved selection.

In the built-in configuration, routine work inside the project proceeds normally while sensitive reads and access outside the project continue to request approval. Custom configuration can make Standard more or less permissive; the selector does not rewrite the user's configuration.

### Auto Approve

Auto approve preserves configured hard denials but automatically answers `once` to every permission request that would otherwise be shown to the user. It does not save broad allow rules and does not silently change the project configuration.

Selecting Auto approve for the first time in a project opens a confirmation dialog. The dialog states that Guai Code does not provide a system sandbox and that approved commands run with the authority of the Guai Code process. Cancel leaves the previous mode unchanged. After confirmation, the project remembers the decision and does not repeatedly show the dialog unless local application data is cleared.

The visible label is **Auto approve**, not **Full system access**, because the application does not create an operating-system security boundary.

## Scope And Persistence

The selected mode has two related scopes:

- it applies immediately to the current task;
- it becomes the default for new tasks in the same project directory.

Existing tasks in that project keep their own selected mode. This prevents changing one active task from unexpectedly changing another task that may already be running. Child tasks and subagents inherit the parent task's effective mode.

The application persists project defaults by server scope and normalized project directory. A project with no stored value resolves to Standard. The application also persists whether the Auto approve warning has been accepted for that project.

## User Interface

The selector sits in the composer footer beside the existing model and variant controls. It uses a shield icon and the current mode label. The trigger remains compact, but the menu gives each option a short behavioral description:

- **Restricted**: Ask before edits, commands, and outside access.
- **Standard**: Use the project's configured permissions.
- **Auto approve**: Automatically approve permission requests.

The selected item has a check mark. Auto approve uses a warning-toned icon or text in the menu, without turning the entire composer into a warning surface. The control is available both before the first prompt and during an existing task.

Changing modes must not move focus permanently away from the composer. On mobile, the menu must fit the viewport and keep all labels on one line where practical or wrap descriptions without clipping.

## Architecture

### Shared Domain Type

Define one `PermissionMode` vocabulary with `restricted`, `standard`, and `auto`. Protocol and session schemas use the same vocabulary rather than translating unrelated booleans at each layer.

### Project Preference

Extend the existing persisted permission context with a directory-keyed mode map and a directory-keyed Auto approve confirmation map. Existing `autoAccept` persisted data migrates as follows:

- a directory with auto-accept enabled becomes Auto approve;
- all other directories default to Standard;
- legacy session-specific auto-accept values continue to be read during migration but are not treated as project defaults.

The permission context exposes the effective project default, current task mode, mode setter, and confirmation state. Existing command-palette and settings auto-accept entry points route through the same mode setter so there is one source of truth.

### Task Permission Policy

The selected mode is captured when a task is created and is stored with the task. Changing the selector for an existing task updates its stored mode through the session API before the UI reports success.

Permission evaluation applies mode policy after normal agent configuration while retaining hard denials:

- Restricted overlays `ask` for edit, shell, and external-directory actions;
- Standard adds no overlay;
- Auto approve adds no allow-all rule and relies on the existing permission auto-response path.

This separation is intentional. Restricted changes which operations require approval. Auto approve changes how approval requests are answered. Neither mode bypasses a configured `deny` rule.

### Permission Requests

When Auto approve is active, pending and newly received permission requests are answered with `once`, reusing the existing duplicate-response protection and session-lineage handling.

When leaving Auto approve, new requests stop receiving automatic responses immediately. Requests already accepted cannot be revoked. Pending requests remain visible in Restricted and Standard modes.

If changing a task's mode fails, the project default may still be saved for future tasks, but the current task continues to display its server-confirmed mode and the application shows an error toast. The selector must never claim that a running task changed policy when the server rejected the update.

## Configuration Interaction

Existing configuration files remain authoritative for custom rules and hard denials. The preset selector is not a configuration editor and does not write `opencode.json` or related files.

Saved **Allow always** permissions continue to apply in Standard and Auto approve. Restricted ignores saved allow rules for the actions it overlays with `ask`, ensuring that choosing Restricted has an observable and reliable effect without deleting the user's saved rules.

## Compatibility

The app must not show a mode as active unless the connected server can enforce it. The current bundled server and protocol gain task permission-mode support together. For an older server that lacks that capability, the app keeps the existing auto-accept command and permission dock but hides the three-mode selector.

Public protocol changes require regenerating the client from `packages/client`; generated sources are never edited manually.

## Testing

Add focused coverage proving that:

- projects without a saved preference use Standard;
- project defaults are isolated by server and normalized directory;
- existing directory auto-accept state migrates to Auto approve;
- new tasks capture the project default and child tasks inherit the parent mode;
- changing a running task persists its mode and leaves other existing tasks unchanged;
- Restricted asks for edit, shell, and external-directory operations while preserving hard denials;
- Restricted ignores saved allows for overlaid actions without deleting those saved rules;
- Standard preserves configured permission evaluation;
- Auto approve answers pending and new requests with `once` but never overrides `deny`;
- leaving Auto approve stops future automatic replies;
- the confirmation dialog is required once per project and cancel does not change mode;
- the composer selector renders before and during a task, restores composer focus, and exposes localized labels and descriptions;
- older servers do not display a selector they cannot enforce.

Run type checking from each affected package directory and run focused package tests. Verify the composer at desktop and mobile widths with the real application or its existing component stories.

## Out Of Scope

- a visual editor for individual actions, paths, or allow/deny rules;
- an operating-system sandbox, container, or virtual machine;
- overriding configured hard denials;
- automatically deleting saved permissions;
- changing all already-open tasks when a project default changes;
- enterprise policy administration or organization-wide enforcement.
