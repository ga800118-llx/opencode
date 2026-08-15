# Guai Code Runtime Isolation and Recovery Design

## Status

Approved for implementation on 2026-08-15. This design addresses the release-blocking differences between the locally opened Mac build and the distributed Mac and Windows packages.

## Problem

Guai Code currently stores product-owned model profiles in its Electron `userData` directory, but the embedded OpenCode server still reads configuration, database, cache, and logs from the user's shared OpenCode directories. As a result:

- development runs, package tests, old OpenCode installs, and Guai Code packages can alter the same provider configuration and database;
- stale `agent-profile-*` providers and test-only providers remain visible after the corresponding model profile is gone;
- the model center default, OpenCode config default, renderer recent model, and existing session model can disagree;
- saving model credentials restarts the embedded server, and the renderer can miss terminal session events while reconnecting;
- multiple materially different binaries have been distributed with the same visible version;
- abandoned test helpers can remain alive and distort Mac performance observations.

The current machine demonstrates each state failure: one valid profile exists in the product store, three providers exist in shared OpenCode config, the renderer remembers an orphan provider, and a completed backend response was only visible after reopening the app.

## Goals

1. Give each Guai Code channel an isolated OpenCode configuration, database, cache, state, and log root.
2. Make the product model profile repository authoritative for private and local providers.
3. Preserve saved model profiles and encrypted credentials across the upgrade.
4. Recover automatically when a selected model no longer exists.
5. Reconcile session state after an embedded-server reconnect so completed and failed requests cannot remain spinning.
6. Produce one identifiable Mac and Windows build from the same source revision.
7. Prevent package verification helpers from surviving their owning test command.

## Non-Goals

- Importing arbitrary providers from a user's standalone OpenCode installation.
- Automatically deleting shared OpenCode files or old Guai Code data.
- Migrating all historical tasks from the shared OpenCode database in this release.
- Adding cloud account setup, automatic updates, or production code signing.
- Running hour-long soak tests as part of this change.

## Considered Approaches

### Clear the affected machines

Deleting stale config would make current test machines look clean, but the next development run or package test could recreate the collision. It also would not fix reconnect races or version ambiguity. Rejected.

### Continue sharing OpenCode data and reconcile orphan providers

Startup reconciliation could disable stale providers while preserving the shared database. This leaves Guai Code coupled to standalone OpenCode and allows either product to change the other's runtime state. Rejected.

### Isolate runtime roots and derive private providers from product profiles

Each channel receives private runtime roots under its Electron `userData` directory. The product profile store remains the source of truth, and the embedded server receives a generated provider overlay. This removes cross-product mutation and makes startup deterministic. Selected.

## Architecture

### Runtime Root Isolation

Before the embedded server imports any OpenCode runtime module, the desktop main process supplies explicit runtime paths derived from `app.getPath("userData")`:

```text
<userData>/runtime/config
<userData>/runtime/data
<userData>/runtime/cache
<userData>/runtime/state
```

These become `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, and `XDG_STATE_HOME` for the sidecar. `OPENCODE_DB` points to the channel-owned database inside the isolated data root. Development, beta, and production identities already have different `userData` namespaces, so the same path policy isolates all channels.

The process must not honor inherited XDG or `OPENCODE_DB` values for a packaged local sidecar. Explicit onboarding test roots remain supported. Remote servers are unaffected.

### Upgrade Boundary

The existing `agent.model-profiles` and encrypted `agent.credentials` files already live in product `userData`; they remain in place and are not re-encrypted or copied.

On the first isolated launch, Guai Code records a migration marker and writes a diagnostic manifest containing only paths, timestamps, and counts. Shared OpenCode config and database files are left untouched. Guai Code starts with a fresh isolated task database to avoid importing development and package-test sessions. Project source directories are never modified.

The app presents existing product model profiles immediately because the runtime provider overlay is regenerated from those profiles before the sidecar starts.

### Authoritative Model Overlay

A generated JSON configuration overlay is stored under the isolated runtime config root. It contains only:

- serialized providers for current product profiles;
- disabled provider state required by those profiles;
- the selected product default model when valid.

Every startup, save, removal, and default selection rewrites the complete overlay atomically. Rewriting the complete file removes orphan `agent-profile-*` entries by construction. Test fixtures must use an onboarding/test root and cannot write the real overlay.

Cloud providers continue to use normal isolated OpenCode configuration. Product profiles do not import or hide standalone OpenCode providers because standalone configuration is no longer loaded.

### Model Selection Recovery

Model selection follows this order:

1. the current session model, if it exists in the refreshed connected provider set;
2. the model-center default, if valid;
3. the first valid model from a connected provider;
4. no model, with an explicit setup state.

Renderer recent-model entries that reference missing providers are ignored and pruned. A stale existing session model must not override a valid product default for the next prompt. Selecting a default updates the profile repository and runtime overlay as one product operation; the UI does not maintain an independent authoritative default.

### Controlled Sidecar Restart

Credential changes currently require a sidecar restart. The restart is treated as a transaction:

1. mark the local runtime unavailable for new prompts;
2. atomically rewrite the provider overlay;
3. stop the previous sidecar and wait for exit;
4. start the replacement and wait for health readiness;
5. reconnect the event stream;
6. invalidate and refetch config, providers, agents, active sessions, and visible session content;
7. clear the unavailable state only after reconciliation completes.

Saving a profile without credential or runtime changes may use normal config refresh, but correctness does not depend on that optimization.

### Missed Event Recovery

Every `server.connected` event triggers active-session and visible-session reconciliation, even when those queries already contain data. Reconciliation compares persisted backend status and messages with renderer state. It must convert missed terminal events into the persisted completed or failed state and must not leave a session marked as running solely because the disconnect occurred first.

Request failures caused by an unavailable model, invalid URL, authentication failure, or reconnect failure always terminate the spinner and expose an actionable error.

### Build Identity

The repaired release uses version `0.1.0-alpha.3`. Mac and Windows packages are built from one clean source commit. Build metadata includes the source commit and build timestamp, and the About/settings diagnostics surface exposes the short commit so testers can identify the running binary.

Artifacts from different commits must not share the same delivery filename or visible version. The build pipeline rejects a package whose expected version does not match the desktop package version.

### Test Process Ownership

Package smoke scripts own every mock server and helper process they start. Cleanup runs through `finally`/exit traps on success, failure, timeout, and cancellation. Fast tests assert cleanup behavior. Long soak execution remains a manual tester responsibility.

## Error Handling

- Runtime directories are created before sidecar startup; creation failure blocks startup with a diagnostic error.
- Overlay writes use a temporary sibling file and atomic rename. A failed write preserves the previous valid overlay.
- Invalid stored defaults are omitted from the overlay and repaired to the first valid profile model.
- A failed sidecar restart leaves the runtime in a visible recovery state and never reports the model save as fully ready.
- Migration never deletes shared OpenCode files. Diagnostic output must not contain API keys, sensitive headers, or plaintext credentials.

## Testing

### Unit and integration tests

- runtime paths are channel-scoped and ignore inherited packaged XDG paths;
- onboarding test roots remain isolated;
- overlay generation removes orphan providers and chooses only valid defaults;
- profile save, removal, and default selection update the overlay atomically;
- stale recent/session model references fall back to the model-center default;
- reconnect always refetches active and visible session state;
- failed and completed persisted sessions terminate renderer running state;
- helper processes are cleaned on success, failure, and cancellation;
- package version and embedded build identity agree.

### Package smoke tests

- clean Mac package starts with no development/test providers;
- an existing product profile is available after upgrade without re-entering its key;
- adding a model, setting it as default, and prompting immediately works without reopening;
- a forced sidecar restart followed by a completed response does not leave a spinner;
- Windows x64 performs the same model lifecycle and restart checks;
- credential scans remain clean.

Long-duration performance verification is documented for a human tester and is not required for automated completion.

## Release Acceptance

- Mac and Windows identify themselves as `0.1.0-alpha.3` from the same source revision.
- No `Final Runtime Model`, development provider, or orphan profile appears on a clean or upgraded package.
- A configured valid default is immediately available after startup and after model edits.
- Closing and reopening is not required to reveal a completed answer.
- Normal idle Guai Code processes do not leave package-test helpers running.
- Shared standalone OpenCode config and databases remain unchanged.
