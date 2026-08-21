# Private-Model-Only Desktop Runtime Design

**Date:** 2026-08-21

## Goal

Guai Code desktop must expose and run only models configured by the user. It must not bundle, inject, discover, or select OpenCode system models. A clean installation starts with no model, guides the user to model settings, and becomes usable as soon as the first valid private model source is saved.

This design supersedes the system-model allowlist and curation behavior described in `2026-08-20-system-model-curation-design.md`.

## Scope

- Remove the desktop runtime's built-in OpenCode provider and five curated system models.
- Keep user-created remote and local model profiles unchanged and unlimited.
- Define deterministic default-model behavior using only user-created profiles.
- Preserve a clear no-model state in the home, new-task, model selector, and submit flows.
- Update focused unit, integration, and desktop regression coverage.

The change does not migrate or repair model selections in historical tasks. Historical task data is not deleted, but resuming a task that references a removed system model is outside this release's acceptance criteria.

## Architecture

### Runtime configuration

`packages/desktop/src/main/model-center/runtime-config.ts` remains the only producer of the isolated OpenCode model configuration. It serializes profiles from the desktop model-profile repository and no longer imports or injects `system-models.ts`.

For a clean installation with no profiles, the generated configuration is:

```json
{
  "provider": {},
  "enabled_providers": [],
  "disabled_providers": []
}
```

The `model` property is omitted. The explicit empty `enabled_providers` array is required because the OpenCode provider layer interprets it as allowing no providers; omitting it would allow provider-catalog fallback.

For configured profiles, `provider` and `enabled_providers` contain exactly the presented user profiles. Runtime manifest counts include only those profiles and their models.

The dedicated system-model constants and tests are deleted because the product no longer has a system-model concept.

### Default-model selection

Default resolution uses this order:

1. Use the stored default when its profile and model still exist in both the source and presented profile.
2. Otherwise use the first model from the first presented user profile that has at least one model.
3. Otherwise omit the runtime `model` property.

This makes the first saved model immediately usable. Adding another profile does not replace a valid current default. Deleting the selected model or profile falls back to the first remaining user model. No capability-test result, tool-calling classification, or model-count limit participates in default selection.

### Application experience

Existing model-readiness infrastructure remains the source of truth:

- With no available model, home and new-task views show the existing setup-required notice and open Settings > Models from its action.
- The model selector shows its empty state and keeps the Manage Models action available.
- Submit remains blocked when no model is selected and shows a direct prompt telling the user to configure and select a model.
- Once model synchronization exposes a saved profile, ordinary model selection and task submission continue through the existing paths.

The model center lists every user-created model. It does not mix in provider-catalog or system-model entries.

## Data Flow

1. The user saves, edits, deletes, or selects a default in the desktop model center.
2. The profile repository persists the user-owned profile and default selection.
3. The runtime-config coordinator serializes only current presented profiles.
4. The desktop sidecar restarts or reloads against that isolated configuration.
5. Provider synchronization returns only enabled user-profile providers to the application.
6. Model readiness changes from `setup-required` to `ready` when a usable synchronized model exists.

## Error Handling

- An invalid stored default is repaired during configuration generation without exposing a removed provider.
- A profile with zero models may remain saved but cannot become the runtime default.
- If all models are removed, the generated configuration returns to the explicit no-provider state.
- Existing credential, atomic-write, rollback, and sidecar-reload error handling remains unchanged.
- Capability testing remains diagnostic only. A configured model may be selected and used even when tool calling is unsupported or untested.

## Testing

Focused coverage must verify:

- Empty repositories generate no provider and no default model.
- Only user profiles are serialized and enabled.
- More than five private models are preserved.
- A valid explicit private default is retained.
- Missing or deleted defaults fall back only to remaining private models.
- Manifest provider and model counts exclude former system models.
- Service reload and rollback tests expect private-only runtime state.
- Model-readiness and submit behavior clearly block an unconfigured new task.
- Packaged-runtime regression coverage confirms built-in provider IDs are absent.

Run package-scoped tests and type checks only, following repository rules. Long manual soak testing is reported for separate user-arranged validation rather than blocking implementation completion.

## Acceptance Criteria

- A clean Mac or Windows installation displays zero models until the user configures one.
- No OpenCode system/free model appears in Settings, the model selector, generated runtime configuration, or manifest counts.
- Saving the first profile with at least one model makes a private model available without restarting the desktop application manually.
- Any configured model can be selected or made default regardless of tool-calling capability.
- Private profiles and models remain unlimited by product policy.
- Creating and sending a new task works after a private model is available and is clearly blocked before then.
