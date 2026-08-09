# Guai Code Internal Beta Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a reproducible, friend-testable Apple Silicon package for Guai Code Beta 0.1.0-alpha.1 without requiring an Apple Developer account.

**Architecture:** Preserve the already-tested stable runtime and product features, then introduce a Guai Code-owned Beta identity and an explicit internal packaging script. The script builds the embedded server and renderer from current sources, applies an ad-hoc macOS signature, creates versioned ZIP and DMG artifacts, verifies them, and writes checksums plus tester documentation. Automatic updates remain disabled until Guai Code owns a release endpoint.

**Tech Stack:** TypeScript, Bun, Electron 42, electron-vite, electron-builder, macOS `codesign`, `ditto`, `hdiutil`, Agent Browser.

---

### Task 1: Freeze The Tested Product Baseline

**Files:**
- Verify: current tracked and untracked workspace changes
- Commit: completed run-location, assistant-process folding, and stable permission-mode work

- [ ] **Step 1: Inspect all changed files and scan for credentials**

Run `git diff --check`, inspect `git status --short`, and scan the worktree for the previously used test key. Exclude `.superpowers/` scratch artifacts and build output.

- [ ] **Step 2: Run the current regression gates**

Run the App unit suite, focused OpenCode permission/session/HTTP suite, and package type checks from their package directories.

- [ ] **Step 3: Commit the tested baseline**

Stage only source, tests, generated SDK files, and product design/plan documents. Commit with a conventional commit message before changing release identity.

### Task 2: Add Guai Code-Owned Beta Identity

**Files:**
- Modify: `packages/desktop/src/product/identity.ts`
- Modify: `packages/desktop/src/product/identity.test.ts`
- Modify: `packages/desktop/src/product/presentation.test.ts`
- Modify: `packages/desktop/src/product/deep-link.test.ts`
- Modify: `packages/desktop/electron-builder.config.ts`
- Modify: `packages/desktop/electron-builder.config.test.ts`
- Modify: `packages/desktop/src/main/constants.ts`
- Modify: `packages/desktop/src/renderer/index.html`
- Modify: `packages/desktop/src/renderer/html.test.ts`
- Modify: `packages/desktop/src/renderer/i18n/en.ts`
- Modify: `packages/desktop/src/renderer/i18n/zh.ts`
- Modify: `packages/desktop/package.json`

- [ ] **Step 1: Write identity and packaging tests**

Assert `Guai Code Dev`, `Guai Code Beta`, and `Guai Code` names, Guai Code-owned bundle IDs, protocol schemes, artifact prefixes, and the absence of upstream publish configuration. Assert versioned artifact names and bundled MIT attribution.

- [ ] **Step 2: Replace release identity and isolate updates**

Use `com.guaicode.desktop*` bundle IDs, `guai-code*` schemes, and `guai-code-desktop*` artifact names. Remove upstream GitHub release targets. Gate the updater behind an explicit future build-time flag so this internal Beta never checks OpenCode repositories.

- [ ] **Step 3: Set the internal version and visible copy**

Set the Desktop package version to `0.1.0-alpha.1`, use Guai Code in the renderer title and update copy, and preserve lower-case `opencode` only where it is an internal compatibility identifier.

- [ ] **Step 4: Run Desktop tests and type checking**

Run `bun test` and `bun typecheck` from `packages/desktop`.

### Task 3: Build A Reproducible Internal Mac Package

**Files:**
- Create: `packages/desktop/scripts/package-internal-mac.ts`
- Create: `packages/desktop/scripts/package-internal-mac.test.ts`
- Modify: `packages/desktop/package.json`
- Create: `docs/product/internal-beta-testing.md`

- [ ] **Step 1: Test artifact planning**

Add pure tests for the versioned artifact directory and filenames, architecture guard, and checksum manifest formatting.

- [ ] **Step 2: Implement the packaging script**

Build with `OPENCODE_CHANNEL=beta`, use a local model catalog snapshot when available, build an unsigned directory target, ad-hoc sign the complete application, verify the signature, create a ZIP and DMG, verify both archives, and write SHA-256 checksums. Copy the tester guide and MIT license beside the artifacts.

- [ ] **Step 3: Add one explicit package command**

Expose `bun run package:mac:internal` so future internal packages cannot accidentally reuse stale output or skip the embedded server build.

- [ ] **Step 4: Run script tests and Desktop type checking**

Run the focused packaging test and `bun typecheck` from `packages/desktop`.

### Task 4: Generate And Qualify The Artifacts

**Files:**
- Output: `packages/desktop/dist/internal-beta/0.1.0-alpha.1/Guai-Code-Beta-0.1.0-alpha.1-mac-arm64.dmg`
- Output: `packages/desktop/dist/internal-beta/0.1.0-alpha.1/Guai-Code-Beta-0.1.0-alpha.1-mac-arm64.zip`
- Output: `packages/desktop/dist/internal-beta/0.1.0-alpha.1/SHA256SUMS.txt`
- Output: tester guide and license files in the same directory

- [ ] **Step 1: Run all affected test and type-check gates**

Run App, Desktop, OpenCode, SDK, Schema, Core, and Client checks from package directories.

- [ ] **Step 2: Generate a fresh internal package**

Run `bun run package:mac:internal` from `packages/desktop` and retain the complete build log.

- [ ] **Step 3: Verify package structure and security boundaries**

Verify the app bundle identity/version/architecture, strict ad-hoc signature, DMG checksum, ZIP contents, embedded MIT license, and absence of plaintext test keys.

### Task 5: Clean-Profile Packaged Smoke Test

**Files:**
- Verify: packaged `Guai Code Beta.app`
- Record: `docs/product/internal-beta-verification.md`

- [ ] **Step 1: Launch with isolated Desktop and XDG directories**

Run the packaged executable with a temporary `--user-data-dir` plus temporary XDG data/config/cache/state roots. Do not import the developer profile.

- [ ] **Step 2: Verify first-use and branding**

Use Agent Browser to confirm Guai Code Beta branding, an empty model/profile state, project creation access, and no unexpected update UI or upstream identity.

- [ ] **Step 3: Exercise deterministic model onboarding**

Use the repository's local mock OpenAI-compatible server to verify wrong credentials, successful discovery, save/default selection, first response, and restart persistence without spending an external API key.

- [ ] **Step 4: Verify current product workflows**

Confirm permission modes, one Restricted tool prompt, Simple/Advanced switching, local run location, projects/history, and assistant-process folding in the packaged app.

- [ ] **Step 5: Record exact evidence**

Write the source commit, artifact hashes, automated gate counts, package verification results, clean-profile behavior, known limitations, and friend installation instructions.

### Task 6: Finalize The Internal Alpha

**Files:**
- Modify: this plan (mark completed steps)
- Commit: Beta identity, packaging workflow, tester docs, and verification record
- Tag: `v0.1.0-alpha.1`

- [ ] **Step 1: Review the final diff**

Run `git diff --check`, confirm only intended source/docs are tracked, and verify generated packages remain ignored.

- [ ] **Step 2: Commit and tag the exact tested source**

Create a conventional commit for internal Beta delivery, then create annotated tag `v0.1.0-alpha.1` on the verified commit.

- [ ] **Step 3: Reconfirm artifact/source correspondence**

Record the tagged commit in the verification document and ensure the final checksum manifest still matches the delivered files.
