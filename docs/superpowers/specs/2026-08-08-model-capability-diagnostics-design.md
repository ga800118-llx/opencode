# Model Capability Diagnostic Design

## Problem

The model source editor can complete the basic chat and streaming probes but still show:

> An unexpected product error occurred.

This is reproducible with `deepseek-v4-pro`. Its tool-calling probe returns HTTP 400. The HTTP layer safely reports `PROVIDER_REQUEST_FAILED`, which normalizes to `unknown` because a bare 400 response does not identify the failed capability. The probe already knows that the failure occurred during the tool-calling stage, but that context is currently discarded.

The UI then renders the diagnostic's raw English `message`, so even correctly classified failures are not localized.

## Scope

This change will:

1. Preserve specific transport and provider classifications such as authentication, missing model, TLS, timeout, and unreachable endpoint.
2. Reclassify only an otherwise `unknown` streaming-stage failure as `streaming`.
3. Reclassify only an otherwise `unknown` tool-stage failure as `tool-calling`.
4. Preserve safe status and request ID fields.
5. Render capability-test diagnostics through application i18n instead of raw English messages.
6. Keep the existing capability classification and checks unchanged.

This change will not alter credentials, provider configuration, model discovery, proxy behavior, or the protected runtime packages.

## Alternatives

### Map every HTTP 400 to tool calling

Rejected because HTTP 400 can occur during basic chat, streaming, or tool calling and does not identify the failed capability by itself.

### Only replace the generic English message

Rejected because it would still hide the known failing stage and provide weak guidance.

### Stage-aware fallback with localized presentation

Selected. The probe owns stage context, while the renderer owns language. This preserves current boundaries and produces an actionable result without exposing provider response bodies.

## Design

### Probe diagnostic fallback

The probe will create its normal safe diagnostic first. If that diagnostic is `unknown`, the caller can supply a fallback kind for the known probe stage. The fallback changes only `kind`, `message`, and `detail`; it keeps the safe `status` and `requestID`.

Specific normalized errors always win. For example, an authentication error during a tool probe remains `authentication`, not `tool-calling`.

### Capability test presentation

A small pure presentation function will map every `ProductErrorKind` to a `settings.modelCenter.test.*` translation key. The form state will retain the structured diagnostic instead of only its English message. The dialog will translate that presentation using the active language.

The result remains visible alongside the existing capability status and check summary:

- `部分兼容`
- `流式 OK / 工具 --`
- `该模型未能完成工具调用。请选择支持结构化工具调用的模型。`

### Data flow

1. The basic chat probe succeeds.
2. Streaming and tool probes run independently.
3. A failed stage produces a safe diagnostic.
4. An unknown stage error receives the known stage fallback classification.
5. The desktop service returns the capability report unchanged.
6. The form stores the structured diagnostic.
7. The dialog maps the diagnostic kind to localized copy.

## Error Handling

- No raw provider body is persisted or displayed.
- API keys and sensitive headers remain outside renderer-visible diagnostics.
- Request IDs and HTTP status remain available in the report for safe debugging.
- Authentication, missing model, TLS, timeout, and endpoint errors retain their existing specific classifications.
- Unknown basic-chat failures remain `unknown` because the endpoint may be broadly incompatible rather than failing one optional capability.

## Tests

### Desktop probe tests

- Tool probe HTTP 400 becomes `tool-calling` while preserving status 400 and request ID.
- Streaming-stage unknown failures become `streaming`.
- Specific authentication errors are not overwritten by a stage fallback.
- Existing capability classification tests continue to pass.

### App presentation and controller tests

- Every error kind maps to a stable capability-test translation key.
- The form retains the structured diagnostic returned by the operation.
- Changing or retesting clears stale diagnostic state as before.
- English, Simplified Chinese, and Traditional Chinese dictionaries remain in parity.

### Runtime verification

- Open the saved private model source.
- Select `deepseek-v4-pro` and test capabilities.
- Confirm the result is partial compatibility with a localized tool-calling explanation, not a generic product error.
