# Model Credential Recovery Design

## Problem

Development builds on macOS now use the app-local encrypted credential vault so the app does not request a Keychain password. Credentials saved by an older build remain in the profile store, but their ciphertext cannot be decrypted by the new vault. The profile still reports `hasApiKey: true`, so the UI misleadingly presents the API key as saved and model discovery later appears to fail authentication.

## Decision

Treat unreadable app-local credentials as unavailable metadata rather than attempting to open the legacy macOS Keychain. This preserves the no-password behavior. The model profile remains intact, but its presented secret flags are cleared and the editor tells the user to re-enter credentials once.

When the user enters a replacement API key or sensitive header, discovery uses the replacement directly. Saving replaces the unreadable ciphertext with the current local-vault format. Subsequent launches read it normally.

## Boundaries

- The credential service validates app-local ciphertext when answering whether a credential exists.
- The credential proxy presents profiles with unavailable secret flags cleared while preserving the credential reference as the recovery signal.
- The model profile editor uses that signal to show a recovery message and does not claim the API key is already saved.
- Provider URL construction, authorization header construction, model limits, and private-model counts remain unchanged.

## Error Handling

Legacy, foreign, corrupt, or wrong-key app-local ciphertext is treated as unavailable. No secret content is logged or returned to the renderer. Re-entering and saving a valid replacement overwrites the stale entry.

## Verification

- Credential-service tests cover foreign ciphertext and wrong-key ciphertext.
- Credential-proxy tests cover profile presentation when stored credentials are unavailable.
- Form-controller and presentation tests cover the recovery state and replacement-key discovery.
- Desktop model-center tests and package type checks must pass.
