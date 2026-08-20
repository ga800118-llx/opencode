# System Model Curation Design

## Goal

Guai Code exposes exactly five system models that work without user configuration. These models are intended for temporary use. User-managed private and local model sources remain unlimited.

## System Model Policy

The bundled system model allowlist is:

1. `opencode/nemotron-3.5-lightning-free`
2. `opencode/deepseek-v4-flash-free`
3. `opencode/laguna-s-2.1-free`
4. `opencode/hy3-free`
5. `opencode/nemotron-3-ultra-free`

Only these system models may enter the desktop runtime catalog. The allowlist is fixed in product code so updates to the bundled public model snapshot cannot silently add more system models.

## Private Model Boundary

Providers created through the visual model center use product-managed `agent-profile-*` identities. Every model in those profiles remains available. The system allowlist must not truncate, reorder, hide, or reject user-managed private or local models.

Cloud providers explicitly connected by a user are user configuration rather than system defaults and are not subject to the five-model system allowlist.

## Runtime Behavior

The runtime catalog combines the five allowed system models with all models from user-configured providers. Filtering happens before the catalog is returned to the UI so model settings, model selection, default resolution, and execution share the same model set.

If an existing default points to a removed system model, Guai Code selects the first available allowed system model. If an existing default belongs to a user-configured provider, it remains unchanged.

## Upgrade Behavior

Existing system models outside the allowlist disappear after upgrade. Existing private model profiles, credentials, discovered models, visibility preferences, and private default selections remain unchanged.

## Verification

Tests must prove that:

- a clean desktop runtime exposes exactly the five allowed system models;
- a private profile containing more than five models exposes all of them;
- a removed system default falls back to an allowed system model;
- a private default remains selected;
- V1 and V2 model APIs expose the same curated catalog;
- the packaged Mac application opens the model settings page without loading the full public model snapshot.
