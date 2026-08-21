# Model Credential Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover cleanly from model credentials saved by an incompatible desktop credential backend without restoring macOS password prompts.

**Architecture:** Validate ciphertext only for the app-local credential backend, then make profile presentation reflect whether the stored secret is actually usable. Preserve the stale credential reference as a renderer-safe recovery signal so the editor can request one-time re-entry; replacement values continue through the existing draft discovery and save paths.

**Tech Stack:** TypeScript, Electron, SolidJS, Bun test

---

### Task 1: Detect unusable local credentials

**Files:**
- Modify: `packages/desktop/src/main/model-center/credentials.ts`
- Test: `packages/desktop/src/main/model-center/credentials.test.ts`
- Test: `packages/desktop/src/main/model-center/local-credential-storage.test.ts`

- [ ] Add failing tests proving `has()` is false for foreign ciphertext and ciphertext encrypted with another local key.
- [ ] Run the focused credential tests and confirm the new assertions fail.
- [ ] Make `has()` validate decryptability only when the selected backend is `local-encrypted-file`, reusing the existing read/cache path without exposing plaintext.
- [ ] Run the focused credential tests and confirm they pass.

### Task 2: Present stale profile credentials honestly

**Files:**
- Modify: `packages/desktop/src/main/model-center/credential-proxy.ts`
- Test: `packages/desktop/src/main/model-center/credential-proxy.test.ts`

- [ ] Add a failing test for a profile whose metadata says it has an API key while the credential service reports no usable entry.
- [ ] Run the focused proxy test and confirm it fails.
- [ ] Clear presented API-key and sensitive-header availability when the credential reference is unavailable, preserve the reference, and avoid creating a credential-proxy runtime for that profile.
- [ ] Run the focused proxy test and confirm it passes.

### Task 3: Explain one-time credential recovery in the editor

**Files:**
- Modify: `packages/app/src/components/settings-v2/model-center-controller.ts`
- Modify: `packages/app/src/components/settings-v2/dialog-model-profile.tsx`
- Modify: `packages/app/src/i18n/model-center-copy.ts`
- Test: `packages/app/src/components/settings-v2/model-center-controller.test.ts`

- [ ] Add a failing controller test for the unavailable-credential recovery signal and for clearing it after a replacement key is entered.
- [ ] Run the focused controller test and confirm it fails.
- [ ] Add the recovery state and localized helper copy without adding a new secret-bearing protocol field.
- [ ] Run the focused controller test and confirm it passes.

### Task 4: Verify the model-center workflow

**Files:**
- Test: `packages/desktop/src/main/model-center/service.test.ts`
- Test: `packages/desktop/src/main/model-center/e2e-secrets.test.ts`

- [ ] Run all desktop model-center tests from `packages/desktop`.
- [ ] Run app model-center tests from `packages/app`.
- [ ] Run `bun typecheck` from both package directories.
- [ ] Launch the desktop development build and verify that the stale profile requests credential re-entry, a newly entered key is used by discovery, and no macOS password prompt appears.
