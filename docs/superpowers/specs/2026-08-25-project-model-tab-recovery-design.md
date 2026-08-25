# Project Model And Tab Recovery Design

## Goal

Fix two packaged desktop defects without changing model profiles, task data, conversation behavior, or unrelated UI:

- a configured private model can appear in one project but not another, and the affected project can reverse between launches;
- restored task tabs can all show the Default Project avatar even when their sessions belong to another project.

## Evidence

The packaged runtime manifest contains one configured provider and eleven models. In the same application run, the `game` project shows model setup while `Default Project` is ready.

Network evidence shows two concurrent V2 catalog reads for the same `game` directory. One provider/model pair returns the configured catalog and the other returns an empty catalog while location plugins are still booting. The frontend can retain the empty response as authoritative. The result depends on startup order, which explains why projects reverse between launches.

Historical `game` sessions have the correct session directory but a stale project ID that resolves to Default Project. Home already resolves these sessions by directory first and shows the correct `G` avatar. The title bar resolves the stale project ID first and therefore shows `D`.

## Chosen Approach

### Catalog Readiness Barrier

Expose the existing location-scoped internal plugin boot fiber as a readiness service and use it in the V2 provider and model handlers. Catalog reads must wait for the complete boot batch, including catalog and integration materialization, before returning available providers or models. This makes the first successful response authoritative without adding an arbitrary frontend delay.

The barrier applies only to V2 catalog reads. It does not rewrite configuration, restart the Sidecar, preload every project, or change legacy protocol behavior. A truly unconfigured installation still returns an empty catalog after initialization finishes.

### Project Resolution

Resolve a session's project by its normalized directory or known sandbox before consulting its project ID. The project ID remains a fallback for sessions whose directory is no longer present in the opened project list.

This preserves valid historical sessions while preventing stale IDs from overriding current directory ownership. Existing avatar rendering and project colors remain unchanged.

## Alternatives Rejected

- Retrying empty catalogs in the frontend uses an arbitrary timeout and can still fail on a slower computer.
- Preloading every project at desktop startup increases startup work and scales poorly as projects accumulate.
- Clearing tabs or rewriting historical session project IDs mutates valid user data and does not address the catalog race.

## Error Handling

- If internal plugin initialization fails, the boot fiber failure reaches the catalog request through the existing server error path instead of returning a false empty success or waiting forever.
- If no private model is configured, initialization completes and the existing model setup notice remains available.
- If no project matches a session directory, project-ID and directory-name fallbacks continue to provide a usable tab label and avatar.

## Testing

- Add focused server tests proving provider/model reads wait for internal boot readiness and propagate boot failure.
- Use the real location service in a core integration test to prove readiness includes catalog materialization without manual reloads.
- Add a project-resolution test where a stale project ID points to Default Project while the session directory belongs to `game`; `game` must win.
- Run focused package tests and `bun typecheck` from each affected package.
- Open the latest local desktop build and verify both projects expose the same configured private models and each restored tab uses its own project avatar.

## Scope Boundaries

- Do not change profile storage, credentials, default-model selection, model discovery, or runtime configuration generation.
- Do not change task persistence, tab restoration, conversation execution, stream handling, elapsed-time display, permissions, skills, file links, or server management.
- Do not change visual styling or package an installer until the local verification passes.
