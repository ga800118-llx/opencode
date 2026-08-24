# Startup Model And Session Recovery Design

## Goal

Fix two packaged desktop startup defects without changing model profiles, task data, or unrelated UI:

- a saved private model and default selection can exist while the first screen still asks the user to configure a model;
- a restored historical task can fall into the fatal renderer page during a local Sidecar restart and only recover after pressing Restart.

## Evidence

The persisted profile store, runtime manifest, and generated `opencode.json` already contain the same default model before the Sidecar starts. The missing default is therefore a readiness race, not lost data.

Packaged renderer logs record `Stale read from <Show>` immediately after a model change restarts the Sidecar. The recovery notice nests non-keyed `Show` accessors and can read the outer accessor after that branch has been disposed.

## Chosen Approach

### Model Readiness

Keep the current desktop-owned profile and runtime configuration flow. Extend the Sidecar readiness probe with the selected runtime model. When a default model exists, a structurally valid but empty provider catalog is not ready; readiness requires that exact provider and model to appear in `/provider`.

The latest selected model is updated whenever runtime configuration is written, so both cold start and model-triggered Sidecar restart validate the current selection. When no default model exists, the existing structural readiness behavior remains unchanged and the application can open the model setup UI.

### Renderer Recovery Notice

Render Sidecar and model setup notice state through keyed `Show` branches. Their callback values become plain immutable values instead of branch-scoped accessors. A transition from restarting to ready can then remove the notices without leaving nested computations that read a disposed parent accessor.

The task route, tab persistence, task history, and restart action remain unchanged.

## Alternatives Rejected

- Re-selecting or rewriting the default model on every startup would hide the race and mutate valid persisted state.
- Clearing historical tabs would discard valid user state and would not fix the renderer exception.
- Rebuilding the routing or frontend state system would have a much larger blast radius than the logged failure requires.

## Error Handling

- If the selected model never appears, existing Sidecar supervision retries and reports its normal initialization failure instead of exposing a false-ready UI.
- Missing or unreadable credentials are not rewritten. The configured provider/model must still be materialized by the runtime; normal model diagnostics remain responsible for credential errors.
- A desktop installation with no selected model keeps the existing setup-required workflow.

## Testing

- Extend Sidecar readiness tests to prove that an empty catalog is rejected when an expected model exists and accepted when no expected model exists.
- Verify provider/model matching, including model IDs that contain `/`.
- Run the existing Sidecar supervisor and recovery notice tests.
- Run `bun typecheck` and the desktop/app production builds from their package directories.
- Start the latest source desktop application for manual cold-start and model-restart verification. Do not package in this pass.

## Out Of Scope

- Changing profile storage, credential encryption, model discovery, or default-selection UI.
- Deleting or migrating historical tasks or tabs.
- Changing conversation execution, elapsed-time display, file links, permissions, skills, or server management.
- Producing Mac or Windows installers before manual verification passes.
