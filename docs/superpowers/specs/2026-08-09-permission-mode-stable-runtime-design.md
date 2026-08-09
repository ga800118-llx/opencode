# Permission Modes On The Stable Runtime Design

## Goal

Make the Restricted, Standard, and Auto approve permission selector available on the current stable Guai Code task runtime without switching the desktop app to the incomplete V2 model, project, and history workflow.

The result must preserve every previously delivered product feature. A permission-mode change is not complete if custom models, projects, task history, tool calls, presentation modes, run locations, or timeline presentation regress.

## Product Behavior

- The composer shows one compact permission selector before the first prompt and during an existing task.
- The selector offers Restricted, Standard, and Auto approve.
- The selected project default applies to new tasks in that project.
- An existing task keeps its own server-confirmed mode.
- Child tasks inherit their parent task's mode.
- Old tasks without a stored mode resolve to Standard.
- Auto approve keeps the existing first-use warning and one-shot permission responder.
- Restricted asks before edits, shell commands, and access outside the project while preserving configured hard denials.
- A connected server that cannot enforce permission modes shows a disabled permission control with an upgrade explanation instead of silently removing the control.

Internal protocol names such as V1 and V2 are not shown in product copy.

## Architecture

### Stable Session Contract

Extend the existing stable session record with an optional `permissionMode` field using the shared `Permission.Mode` vocabulary. The stable session create contract accepts the initial mode, and a dedicated session endpoint switches the mode for an existing task.

The endpoint lives on the stable session API rather than forcing the whole application onto the V2 API. Its presence in the server OpenAPI document is the capability signal used by the desktop app. Regenerate the legacy JavaScript SDK after changing this public stable API.

### Stable Permission Enforcement

The stable permission service receives the task mode with each permission assertion.

- Standard evaluates the existing configured and remembered rules unchanged.
- Auto approve uses Standard evaluation and lets the application answer resulting requests with `once`.
- Restricted first preserves any configured denial, then forces edit, shell, and external-directory actions to `ask` even if a remembered allow would normally approve them.

Pending requests retain the mode and configured rules used to create them. An `always` reply in Restricted mode must not silently approve another pending Restricted request.

### Session Inheritance

New root tasks store the project's selected default. Child tasks copy the parent task's mode when they are created. Existing child tasks keep their stored value.

Old session rows do not require a migration because a missing value means Standard.

### Desktop Compatibility Adapter

Keep the stable protocol selected for the bundled desktop server. Extend the compatibility adapter so stable session create, list, get, and switch operations carry `permissionMode` without changing model, project, prompt, or history routing.

Capability detection follows the active protocol:

- V2 checks the existing V2 permission-mode endpoint.
- The stable protocol checks the new stable permission-mode endpoint in the authenticated server document.
- Unsupported servers return a clear unsupported state rather than being mistaken for a supported server.

### Application State

The permission context continues to own project defaults and the Auto approve confirmation record. Server task state remains authoritative for existing tasks.

For a draft, the selector reads the project default. On task creation, that mode is sent with the create request. For an existing task, changing the selector saves the future project default, calls the stable switch endpoint, refreshes the task, and reports failure without claiming the task changed.

## Error Handling

- Capability probing failures resolve to unsupported and do not switch the application protocol.
- Unsupported remote servers show a disabled selector with an upgrade message.
- A failed mode switch leaves the existing task's displayed mode unchanged and shows an error toast.
- A failed task creation uses the existing creation error path.
- Permission denials remain denials in every mode.

## Integration Requirements

The packaged Mac application must verify all of the following in one build:

- a configured private model remains selected and can create a task;
- the permission selector appears on the stable bundled server;
- Restricted, Standard, and Auto approve persist and switch correctly;
- projects and existing task history remain visible;
- tool calls and permission prompts continue to work;
- Simple and Advanced presentation behavior remains intact;
- run-location presentation and collapsible assistant-process output remain intact.

Testing must include focused schema, server, permission, adapter, application-state, and capability tests; package type checks; a desktop production build; and a packaged-app smoke test using the existing local profile. A clean-profile smoke test is required before release packaging begins.

## Out Of Scope

- Migrating the whole desktop app to the V2 model, project, or history workflow.
- Apple signing, notarization, DMG distribution, or automatic updates.
- Windows packaging.
- A granular visual permission-rule editor.
- Pretending an older server can enforce Restricted mode when it cannot.
