# Windows Chat Recovery Design

## Goal

Make a clean Windows installation reliably recover chat history after local-server restarts, avoid downloading required file-search tooling at runtime, and make a stalled provider turn diagnosable from exported logs.

## Chosen Approach

Use three narrow fixes instead of changing the model center or rebuilding session state management:

1. Normalize every session-message page size to the server contract of `1..200` before either the V2 or legacy client sends a request. A forced refresh of an empty session therefore requests one message instead of sending the cached count of zero.
2. Package the official pinned Windows x64 ripgrep binary with internal Beta artifacts and prepend its resource directory to `PATH` before the sidecar starts. The runtime keeps its existing system-binary and cache fallbacks for development and non-Windows distributions.
3. Add structured lifecycle logs around V2 prompt admission and provider turns. Logs identify admission, provider-turn start, first event, completion, and failure without recording prompts, credentials, response text, or request headers.

The application will not add a fixed total execution timeout. Existing activity classification continues to distinguish active tools from slow or unverified work, so a legitimate long-running task is not interrupted.

## Alternatives Considered

### Add a fixed provider timeout

This would end indefinite requests, but it would also repeat the earlier failure mode where slow private models are stopped despite still working. It is not suitable as the default behavior.

### Route model tests through the complete agent runtime

This would make model tests more representative, but it requires temporary sessions, tool materialization, event collection, and cleanup. That is a larger model-center feature and is outside this Windows recovery fix.

### Rebuild renderer session state

The logs show a concrete invalid page-size request, not a general state-system failure. Replacing session state would carry disproportionate regression risk.

## Components

### Session History Refresh

`createServerSession` normalizes the requested page size at the network boundary. Empty cached sessions may still retain a local count of zero because that count accurately describes the UI state; only the outbound query is clamped. The delayed stale refresh absorbs refresh failures because it is background work and must not create an unhandled renderer rejection.

### Bundled Ripgrep

The Windows internal-package script downloads the same ripgrep version expected by core, verifies a pinned byte size and SHA-256 checksum, extracts `rg.exe` and its MIT license into staging, and passes that staging directory to electron-builder. Installer and portable-ZIP validation both require the binary and license.

At packaged Windows startup, a small product helper verifies `resources/ripgrep/rg.exe`, prepends the directory to `PATH`, and logs that the bundled binary is enabled. Development and unsupported platforms remain unchanged.

### Provider Lifecycle Diagnostics

Prompt admission logs the session and message identifiers after durable admission succeeds. The provider runner logs provider/model identifiers, tool count, elapsed time to first event, total elapsed time, event count, and success or failure. It does not log user content or model output.

## Error Handling

- Invalid local page sizes are normalized rather than allowed to reach HTTP schema validation.
- Missing packaged ripgrep fails the Windows packaging validation; runtime startup still falls back to existing behavior if a manually assembled package omits it.
- Provider diagnostics observe the stream without changing retry, interruption, tool execution, or completion semantics.
- No timeout is introduced for active model or tool work.

## Testing

- App unit tests cover zero and oversized forced-refresh page limits.
- Timeline tests retain background refresh behavior without unhandled rejection.
- Desktop tests cover the packaged ripgrep environment and electron-builder resource mapping.
- Windows internal-package tests cover pinned archive metadata, required installer resources, portable-ZIP entries, and license delivery.
- Core runner tests verify lifecycle diagnostics do not alter stream output or failure behavior where practical; package typechecks and focused test suites must pass.
- The final Windows artifact must be inspected for `resources/ripgrep/rg.exe` before delivery.

## Scope Guard

Do not change model discovery, model selection, credential storage, model-center UI, conversation presentation, permission modes, skills, project management, macOS packaging, or total task timeout behavior.
