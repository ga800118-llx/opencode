# Private Model Catalog And Stream Recovery Design

## Goal

Keep every restored project aligned with the desktop-managed private model catalog, and make OpenAI-compatible streaming failures actionable without changing sessions, switching models, or restarting the runtime.

## Scope

This change is limited to two existing boundaries:

- The app provider-catalog selector that overlays desktop-managed `agent-profile-*` providers onto a directory catalog.
- The OpenAI-compatible chat protocol that decodes SSE events from private endpoints and compatible providers.

It does not change session restoration, prompt execution, tool execution, native OpenAI/Anthropic protocols, model limits, credentials, or packaging.

## Model Catalog Design

The global desktop catalog is authoritative for every connected `agent-profile-*` provider. When a directory catalog is ready, the selector will copy the current provider definition and default model from the global catalog even when the directory already lists that provider ID as connected. This repairs partially restored directory catalogs whose `connected` list is present but whose `all` map or `default` entry is absent or stale.

Non-desktop providers remain directory-owned. Their definitions, connection state, and defaults are not overwritten.

## Stream Design

The native OpenAI chat protocol remains unchanged. The OpenAI-compatible route gets a compatible event schema that accepts:

- Standard chunks with `choices`.
- Usage-only chunks emitted by compatible gateways.
- Provider metadata chunks containing `base_resp` but no `choices`.
- Explicit in-band `{ "error": ... }` events.

Harmless usage or metadata chunks update usage when available and otherwise emit no content. Explicit error events fail the current provider turn with the upstream message instead of the misleading `Invalid ... stream event` text. Truly malformed content, including a present but invalid `choices` value, continues to fail schema validation.

No automatic retry is added. A provider turn still performs one explicit stream request, preventing duplicate charges, duplicated tool calls, or repeated file changes. A later user turn creates a fresh request using the selected model as it does today.

## Error Handling

- A structured in-band provider error is surfaced as a provider stream error containing its message and sanitized error metadata.
- A non-error `base_resp` or usage-only event is tolerated.
- An unrecognized or malformed event remains an invalid provider-output failure.
- Existing HTTP status classification remains responsible for non-2xx responses.

## Tests

- Add catalog tests for a connected private provider with a missing provider definition, a stale definition, and a missing default.
- Assert that unrelated directory providers and their defaults remain unchanged.
- Add OpenAI-compatible stream tests for metadata-only, usage-only, explicit error, and malformed `choices` events.
- Run focused app and LLM tests plus package type checks.

## Acceptance Criteria

- Every ready project exposes the same desktop private provider models and default model immediately after restoration.
- A project cannot remain in "configure model" state solely because its local catalog is partial.
- Compatible metadata and usage events do not interrupt an otherwise valid response.
- In-band provider errors show the provider's message.
- Native OpenAI chat behavior and unrelated providers are unchanged.
