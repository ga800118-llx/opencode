# Guai Code Windows Internal Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and verify a Windows 11 x64 Guai Code Beta installer that includes a private MinGit runtime and requires no Bun, system Git, administrator access, or signing certificate for trusted internal testing.

**Architecture:** Add a pure bundled-Git environment resolver to the packaged Electron main process, then stage a pinned official MinGit distribution only during Windows internal builds. A Windows-only packaging script creates NSIS and portable ZIP artifacts, while a PowerShell smoke verifier installs, launches, restarts, verifies, and uninstalls the exact package on a GitHub-hosted Windows runner.

**Tech Stack:** TypeScript, Bun, Electron 42, electron-builder/NSIS, PowerShell 7, MinGit, GitHub Actions Windows 2025.

---

### Task 1: Add The Bundled Git Runtime Boundary

**Files:**
- Create: `packages/desktop/src/product/bundled-git.ts`
- Create: `packages/desktop/src/product/bundled-git.test.ts`
- Modify: `packages/desktop/src/main/index.ts`

- [x] **Step 1: Write failing bundled Git environment tests**

Test that Windows packaged input with an existing `resources/mingit/cmd/git.exe` returns a PATH beginning with the bundled command directory. Test that development, macOS, and missing executable inputs return `undefined`, and that an empty inherited PATH does not add a trailing separator.

- [x] **Step 2: Run the focused test and confirm it fails**

Run from `packages/desktop`:

```bash
bun test src/product/bundled-git.test.ts
```

Expected: failure because `createBundledGitEnvironment` does not exist.

- [x] **Step 3: Implement the pure resolver and main-process integration**

The resolver accepts platform, packaged state, resources path, inherited PATH, and an existence function. It returns `{ directory, path }` only for a valid packaged Windows MinGit tree. In `main/index.ts`, call it after logging initializes and before `preferAppEnv(...)`, assign the resulting PATH to `process.env.PATH`, and log only the bundled directory.

- [x] **Step 4: Run focused tests and Desktop type checking**

```bash
bun test src/product/bundled-git.test.ts src/main/server.test.ts
bun typecheck
```

Expected: all pass.

### Task 2: Make Windows Packaging Explicit And Testable

**Files:**
- Modify: `packages/desktop/package.json`
- Modify: `packages/desktop/electron-builder.config.ts`
- Modify: `packages/desktop/electron-builder.config.test.ts`
- Create: `packages/desktop/scripts/internal-package.ts`
- Modify: `packages/desktop/scripts/package-internal-mac.ts`
- Modify: `packages/desktop/scripts/package-internal-mac.test.ts`
- Create: `packages/desktop/scripts/package-internal-windows.ts`
- Create: `packages/desktop/scripts/package-internal-windows.test.ts`

- [x] **Step 1: Write failing Windows artifact and builder tests**

Assert version `0.1.0-alpha.2`, Windows x64 host enforcement, exact builder and delivery filenames, pinned MinGit URL/hash, checksum formatting, the environment-selected MinGit `extraResources` entry, and NSIS `oneClick: true`, `perMachine: false`, `allowElevation: false`, and `runAfterFinish: false`.

- [x] **Step 2: Run the focused tests and confirm expected failures**

```bash
bun test electron-builder.config.test.ts scripts/package-internal-mac.test.ts scripts/package-internal-windows.test.ts
```

Expected: Windows packaging exports/configuration are missing and version assertions fail.

- [x] **Step 3: Implement shared packaging utilities and Windows artifact planning**

Move reusable SHA-256 and manifest formatting into `scripts/internal-package.ts`. Keep the Mac script behavior unchanged. Add Windows constants for official MinGit `v2.55.0.windows.3`, asset `MinGit-2.55.0.3-64-bit.zip`, and SHA-256 `f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05`.

- [x] **Step 4: Implement the Windows packaging command**

The command must require `win32/x64`, clean only its own output, securely download and hash MinGit, extract it to ignored staging, set `GUAI_CODE_BUNDLED_GIT_DIR`, run prebuild/build/electron-builder `--win --x64 --publish never`, verify expected output, create the portable ZIP with PowerShell, copy both licenses and tester guide, and write `SHA256SUMS.txt`.

- [x] **Step 5: Update electron-builder and package metadata**

Set Desktop version `0.1.0-alpha.2`, add a product description and `package:win:internal`, include the staged MinGit directory only when `GUAI_CODE_BUNDLED_GIT_DIR` is set, and make the NSIS installer per-user without elevation or automatic post-install launch.

- [x] **Step 6: Run packaging tests and Desktop type checking**

```bash
bun test electron-builder.config.test.ts scripts/package-internal-mac.test.ts scripts/package-internal-windows.test.ts
bun typecheck
```

Expected: all pass.

### Task 3: Add Installed-Package Verification And Tester Guidance

**Files:**
- Create: `packages/desktop/scripts/verify-internal-windows.ps1`
- Create: `docs/product/internal-beta-testing-windows.md`

- [x] **Step 1: Implement the PowerShell verifier**

Accept the delivery directory and version. Verify hash manifest entries, installer Authenticode state (`NotSigned` or `Valid` only), silent installation, executable metadata, embedded OpenCode and Git licenses, bundled `git.exe --version`, isolated first launch `server ready`, second launch `server ready`, empty model Profile state, silent uninstall, and evidence JSON output.

- [x] **Step 2: Write the tester guide**

Document Windows 11 x64 scope, SHA-256 verification with `Get-FileHash`, SmartScreen `More info` / `Run anyway`, single-installer behavior, no Bun/system Git requirement, model onboarding, expected workflows, feedback content, and uninstall steps.

- [x] **Step 3: Validate PowerShell syntax and documentation consistency**

Parse the script on PowerShell in the Windows workflow. Locally verify filenames/version references with `rg`, and ensure the guide never instructs users to install Bun or Git.

### Task 4: Add A Real Windows Build Workflow

**Files:**
- Create: `.github/workflows/windows-internal-beta.yml`

- [x] **Step 1: Add a manual Windows 2025 workflow**

Use `workflow_dispatch`, `windows-2025`, repository checkout, the local setup-bun action, source type checking/tests, `bun run package:win:internal`, the PowerShell installed-package verifier, credential-canary scan, and `actions/upload-artifact` for the delivery directory and smoke evidence. Do not request signing, model, Azure, or publishing secrets.

- [x] **Step 2: Validate workflow structure locally**

Parse YAML, inspect action pins, and ensure every run command uses Windows-compatible `pwsh` or `bash` syntax intentionally.

- [x] **Step 3: Commit implementation and workflow**

Stage only intended source, tests, workflow, and docs. Exclude `.superpowers/` and `dist/`. Commit with conventional messages before remote execution.

### Task 5: Generate And Verify The Windows Artifacts

**Files:**
- Output: `packages/desktop/dist/internal-beta/0.1.0-alpha.2/windows-x64/Guai-Code-Beta-0.1.0-alpha.2-win-x64.exe`
- Output: `packages/desktop/dist/internal-beta/0.1.0-alpha.2/windows-x64/Guai-Code-Beta-0.1.0-alpha.2-win-x64-portable.zip`
- Output: delivery checksums, licenses, tester guide, and Windows smoke evidence

- [x] **Step 1: Create or reuse an authenticated fork remote**

Use the authenticated GitHub account, preserve `upstream` as read-only, push the current branch to a private or public user-owned fork, and do not modify the upstream repository.

- [x] **Step 2: Dispatch and monitor the Windows workflow**

Trigger `windows-internal-beta.yml` on the pushed branch. Follow the run until every source, package, install, launch, restart, Git, and uninstall gate completes.

- [x] **Step 3: Diagnose failures from Windows evidence**

For any failure, inspect the exact job log/artifact, reproduce through focused tests where possible, commit a scoped fix, push, and dispatch a new run. Do not accept a build-only green state as package verification.

- [x] **Step 4: Download the successful artifacts**

Download the successful run's delivery artifact into the local versioned Windows directory. Re-run SHA-256 validation and scan installer/ZIP/evidence for credential canaries.

### Task 6: Final Regression And Release Record

**Files:**
- Create: `docs/product/internal-beta-verification-windows.md`
- Modify: this plan

- [x] **Step 1: Run all affected regression gates**

Run Desktop full tests/typecheck, App full unit tests/typecheck, focused OpenCode permission/session/HTTP tests/typecheck, and dependent package type checks from package directories.

- [x] **Step 2: Record exact Windows evidence**

Record source commit, GitHub run URL, runner image, installer and ZIP hashes/sizes, MinGit version/hash, NSIS install/start/restart/uninstall evidence, signature status, automated test counts, and SmartScreen limitation.

- [ ] **Step 3: Commit verification and tag the tested source**

Create a conventional documentation commit. Add annotated tag `v0.1.0-alpha.2` to the exact executable source commit and reconfirm the downloaded manifest.

- [ ] **Step 4: Completion audit**

Verify every design requirement against source, test output, Windows run evidence, local artifact hashes, Git history, and tag target before marking the goal complete.
