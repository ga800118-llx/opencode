# Packaged Runtime Stability Design

## Problem

The installed desktop build can expose models that were never configured in the product, perform an implicit npm install after the window appears, reuse stale renderer state, and synchronously access secure storage for every proxied request. These behaviors make a clean installation appear inconsistent and can block the macOS main process on slower machines.

## Approved Scope

方案 B keeps the current Electron/OpenCode architecture and hardens the packaged runtime:

1. The product model center is authoritative. Generated runtime configuration contains an exact `enabled_providers` allowlist, including an empty list when no private profile exists.
2. The desktop sidecar disables automatic config-directory dependency installation. Explicit plugin and skill installation remain separate user actions.
3. Secure-storage capability and decrypted credential envelopes are cached in memory and invalidated on writes and deletes. Plaintext credentials are never written to disk.
4. Legacy renderer state remains readable, but model selections are validated against the live provider list and fall back to the configured product default. Existing profiles, credentials, projects, and sessions are not deleted.
5. Sidecar liveness and product readiness are separate. Startup completes only after an authenticated provider request succeeds.
6. A packaged macOS app launched from `/Volumes` exits with a clear instruction to move the app into Applications.

## Compatibility

- Existing private profiles and encrypted credentials are retained.
- Existing sessions and projects are retained.
- CLI behavior remains unchanged unless the desktop-only environment flag is present.
- Windows receives the model, dependency-install, credential-cache, and readiness fixes. The mounted-volume guard is macOS-only.
- Developer ID signing and notarization are not part of this phase because no Apple Developer account is available.

## Verification

Use focused unit tests and a short clean-profile packaged smoke test. The smoke test must confirm the generated provider allowlist, absence of background runtime `node_modules`, and readiness ordering. Long soak testing remains manual.
