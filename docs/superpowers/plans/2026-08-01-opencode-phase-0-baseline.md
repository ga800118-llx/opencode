# OpenCode Phase 0 Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import OpenCode v1.18.10 with traceable upstream history, reproduce its macOS development build, and document an authoritative baseline for Phase 1 planning.

**Architecture:** Keep the existing product-design commits and merge the pinned upstream release as an unrelated-history parent. Treat the imported source as the unmodified baseline; Phase 0 adds documentation only under `docs/product/baseline/` and does not change OpenCode packages.

**Tech Stack:** Git, Bun 1.3.14, TypeScript, SolidJS, Electron 42, electron-vite, electron-builder, Bun test, Playwright.

---

## File Map

- Create `docs/product/baseline/upstream.md`: pinned version, commit, repository policy, runtime, and build commands.
- Create `docs/product/baseline/source-map.md`: ownership boundaries for Desktop, App, SDK, Server, Core, protocol, and extension systems.
- Create `docs/product/baseline/feature-parity.md`: Phase 0 capability inventory that future UI work must preserve.
- Create `docs/product/baseline/licenses.md`: upstream and third-party license findings relevant to a thin fork.
- Create `docs/product/baseline/verification.md`: machine details, commands, results, known upstream failures, and build artifacts.
- Create `docs/product/baseline/change-map.md`: required Phase 1-3 changes mapped to packages without modifying Core prematurely.
- Preserve `docs/superpowers/specs/2026-08-01-mac-agent-app-design.md`: approved product and technical design.

### Task 1: Import the pinned upstream release

**Files:**
- Preserve: `docs/superpowers/specs/2026-08-01-mac-agent-app-design.md`
- Import: OpenCode repository tree at tag `v1.18.10`

- [x] **Step 1: Verify the product branch and local design commits**

Run:

```bash
git branch --show-current
git log --oneline -3
git status --short
```

Expected: branch is `codex/phase-0-3`; commits `407232f` and `c24d5ba` are present; only `.superpowers/` may be untracked.

- [x] **Step 2: Register the authoritative upstream remote**

Run:

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
git remote get-url upstream
```

Expected: `https://github.com/anomalyco/opencode.git`.

- [x] **Step 3: Fetch and verify the immutable release tag and its history**

Run:

```bash
git fetch upstream dev --tags
test "$(git rev-parse --is-shallow-repository)" = "false"
git rev-parse 'v1.18.10^{}'
git cat-file -e 'v1.18.10^'
```

Expected: the repository is not shallow, the release parent is available, and the tag resolves to `7902e04c3a67f7c69726bc955efb46e29214c797`.

- [x] **Step 4: Merge upstream history without rewriting product commits**

Run:

```bash
git merge --allow-unrelated-histories --no-edit v1.18.10
```

Expected: a merge commit with both the approved design history and the OpenCode release commit as parents; no conflict under `docs/superpowers/`.

- [x] **Step 5: Verify source provenance**

Run:

```bash
git rev-list --parents -n 1 HEAD
git merge-base --is-ancestor 7902e04c3a67f7c69726bc955efb46e29214c797 HEAD
test -f packages/desktop/package.json
test -f packages/app/package.json
test -f packages/opencode/package.json
git status --short
```

Expected: the first command shows two parents; every later command exits 0; `.superpowers/` remains the only permitted untracked path.

- [x] **Step 6: Establish safe local branch and remote behavior**

Run:

```bash
git remote set-url --push upstream DISABLED
git branch -f main HEAD
test "$(git rev-parse main)" = "$(git rev-parse HEAD)"
test "$(git remote get-url --push upstream)" = "DISABLED"
```

Expected: local `main` identifies the imported product baseline and the upstream repository cannot be an accidental push target. A product `origin` is intentionally omitted until a product-hosting repository exists. The `codex/phase-0-3` branch name follows the host environment's required `codex/` prefix and is an explicit exception to the imported upstream branch-naming guidance.

### Task 2: Install and verify the pinned runtime

**Files:**
- Read: `package.json`
- Read: `bun.lock`

- [ ] **Step 1: Confirm the repository runtime requirement**

Run:

```bash
bun_required=$(node -p "require('./package.json').packageManager")
test "$bun_required" = "bun@1.3.14"
printf '%s\n' "$bun_required"
```

Expected: `bun@1.3.14`.

- [ ] **Step 2: Install Bun 1.3.14 for the current user**

Run:

```bash
curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"
```

Expected: installation completes under `$HOME/.bun` without modifying repository files.

- [ ] **Step 3: Activate and verify Bun**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun --version
```

Expected: `1.3.14`.

- [ ] **Step 4: Capture the host toolchain**

Run:

```bash
uname -m
sw_vers
node --version
git --version
xcode-select -p
```

Expected: Apple Silicon (`arm64`), a valid macOS version, and an installed Xcode command-line developer path.

### Task 3: Install the upstream dependency graph unchanged

**Files:**
- Read: `package.json`
- Read: `bun.lock`
- Verify unchanged: `bun.lock`

- [ ] **Step 1: Install locked dependencies**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun install --frozen-lockfile
```

Expected: install and the `packages/core` node-pty postinstall complete successfully.

- [ ] **Step 2: Verify dependency installation did not modify tracked source**

Run:

```bash
git diff --exit-code -- package.json bun.lock
git status --short
```

Expected: no tracked package or lockfile changes; ignored dependency/build directories may exist.

### Task 4: Run the upstream quality baseline

**Files:**
- Read: `.github/workflows/typecheck.yml`
- Read: `.github/workflows/test.yml`
- Read: `packages/desktop/package.json`
- Read: `packages/app/package.json`
- Read: `packages/core/package.json`
- Read: `packages/opencode/package.json`

- [ ] **Step 1: Run repository lint**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run lint
```

Expected: exit 0. If the pinned upstream release fails unchanged, preserve the full output and classify it as an upstream baseline failure rather than changing source in Phase 0.

- [ ] **Step 2: Run package type checks**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run --cwd packages/core typecheck
bun run --cwd packages/opencode typecheck
bun run --cwd packages/app typecheck
bun run --cwd packages/desktop typecheck
```

Expected: each command exits 0. Record each result separately so one failure does not conceal later package status.

- [ ] **Step 3: Run focused desktop tests**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
(cd packages/desktop && bun test src)
```

Expected: desktop main, preload, and renderer tests pass.

- [ ] **Step 4: Run application unit tests**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run --cwd packages/app test:unit
```

Expected: app unit tests pass under the configured happy-dom preload.

- [ ] **Step 5: Run Core and OpenCode tests**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run --cwd packages/core test
bun run --cwd packages/opencode test
```

Expected: both suites pass or every unchanged upstream failure is recorded with its failing test and error message.

### Task 5: Build the unmodified desktop application

**Files:**
- Read: `packages/desktop/electron.vite.config.ts`
- Read: `packages/desktop/electron-builder.config.ts`
- Generated and ignored: `packages/opencode/dist/`
- Generated and ignored: `packages/desktop/out/`
- Generated and ignored: `packages/desktop/dist/`

- [ ] **Step 1: Build Electron main, preload, renderer, and server assets**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
OPENCODE_CHANNEL=dev bun run --cwd packages/desktop build
```

Expected: `packages/desktop/out/main/index.js`, `packages/desktop/out/preload/index.js`, and renderer assets exist.

- [ ] **Step 2: Package an unsigned macOS directory build**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/desktop
CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac dir --publish never --config electron-builder.config.ts --config.mac.identity=null --config.mac.notarize=false
```

Expected: an unpacked arm64 application appears under `packages/desktop/dist/` without requiring Apple signing credentials.

- [ ] **Step 3: Verify the packaged application structure**

Run:

```bash
find packages/desktop/dist -maxdepth 3 -type d -name '*.app' -print
find packages/desktop/dist -path '*/Contents/Resources/app.asar' -print
```

Expected: both commands identify the development `.app` and its bundled `app.asar`.

- [ ] **Step 4: Launch and smoke-test the packaged app**

Run:

```bash
app_path=$(find packages/desktop/dist -maxdepth 3 -type d -name '*.app' -print -quit)
open "$app_path"
```

Expected: the app opens to the OpenCode desktop shell, initializes its local sidecar, and can open a directory. Capture startup failures through the existing desktop logs before changing source.

### Task 6: Document upstream pin and source ownership

**Files:**
- Create: `docs/product/baseline/upstream.md`
- Create: `docs/product/baseline/source-map.md`

- [ ] **Step 1: Write the upstream baseline record**

Create `docs/product/baseline/upstream.md` with:

```markdown
# Upstream Baseline

- Repository: https://github.com/anomalyco/opencode
- Release: `v1.18.10`
- Commit: `7902e04c3a67f7c69726bc955efb46e29214c797`
- Release date: 2026-07-30
- License: MIT
- Package manager: Bun 1.3.14
- Desktop: Electron 42.3.3, electron-vite 5, SolidJS 1.9.10
- Product branch: `codex/phase-0-3`
- Upstream remote: `upstream`

## Update Policy

One upstream release is pinned per product milestone. Upstream updates are merged only between phases after contract, parity, model-center, and desktop workflow checks. Product code must not track the moving `dev` branch.

## Reproduction Commands

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun install --frozen-lockfile
bun run --cwd packages/desktop typecheck
(cd packages/desktop && bun test src)
OPENCODE_CHANNEL=dev bun run --cwd packages/desktop build
```
```

- [ ] **Step 2: Write the package ownership map**

Create `docs/product/baseline/source-map.md` with:

```markdown
# Source Ownership Map

| Area | Authoritative paths | Product policy |
| --- | --- | --- |
| Electron host | `packages/desktop/src/main`, `packages/desktop/src/preload` | Extend through typed IPC and platform services. |
| Desktop renderer entry | `packages/desktop/src/renderer` | Keep thin; shared product UI belongs in App. |
| Shared desktop/web UI | `packages/app/src` | Primary location for model center and workflow changes. |
| UI primitives | `packages/ui/src` | Reuse before adding product-specific primitives. |
| Session UI | `packages/session-ui/src` | Preserve message and tool rendering contracts. |
| SDK | `packages/sdk/js/src`, `packages/client/src` | Use generated/public clients; do not hand-edit generated code. |
| Protocol and schema | `packages/protocol/src`, `packages/schema/src` | Change only for a required public contract. |
| Server | `packages/server/src` | Keep transport and API behavior upstream-compatible. |
| Agent runtime | `packages/core/src`, `packages/opencode/src` | Avoid product-specific changes; require focused tests for any patch. |
| Providers and models | `packages/core/src/provider`, `packages/opencode/src/provider` | Preserve provider catalog; adapt visual configuration above it. |
| MCP, skills, agents, permissions | `packages/core/src`, `packages/opencode/src` | Preserve and expose in Advanced mode. |
| Product documentation | `docs/product` | Owned by this fork. |
```

- [ ] **Step 3: Commit baseline identity documentation**

Run:

```bash
git add docs/product/baseline/upstream.md docs/product/baseline/source-map.md
git diff --cached --check
git commit -m "docs: record opencode upstream baseline"
```

Expected: commit succeeds with only the two baseline files.

### Task 7: Create the feature-parity and change maps

**Files:**
- Create: `docs/product/baseline/feature-parity.md`
- Create: `docs/product/baseline/change-map.md`
- Read: `packages/app/src/components`
- Read: `packages/app/src/context`
- Read: `packages/app/src/pages`
- Read: `packages/opencode/src`

- [ ] **Step 1: Inventory upstream capabilities from source and running app**

Inspect:

```bash
rg -n "provider|model|permission|mcp|agent|skill|terminal|diff|session|worktree|command" packages/app/src packages/opencode/src packages/core/src | less
```

For each capability, require both a source owner and a visible or API-level entry before marking it present.

- [ ] **Step 2: Write the parity matrix**

Create `docs/product/baseline/feature-parity.md` with rows for:

```markdown
# Feature-Parity Baseline

| Capability | Upstream owner | Phase 0 evidence | Phase 3 requirement |
| --- | --- | --- | --- |
| Built-in cloud providers | Provider catalog and App settings | Provider list loads from local server | Preserve in Models settings |
| Custom providers and base URL | Provider config and custom-provider dialog | Custom form serializes provider config | Replace with guided profile flow without losing advanced fields |
| Local models | OpenAI-compatible provider configuration | Local URL and model ID can be configured | Add Ollama and LM Studio detection |
| Model selection and variants | Models context and prompt input | Model picker updates active selection | Keep compact composer selector |
| Sessions and history | Server session APIs and App stores | Create, list, open, archive, and resume work | Present as tasks in the sidebar |
| Streaming messages and tools | SDK event stream and Session UI | Timeline renders assistant and tool parts | Normalize into Codex-style activity timeline |
| Permissions | Permission context and server API | User can approve or deny requests | Keep explicit approval cards and policy settings |
| File tree and file content | App file context and file tree | Project files can be browsed | Keep in context drawer |
| Diff review | Session/file UI | Changed files and diffs render | Add task-level review flow without removing upstream diff |
| Integrated terminal | Terminal context and terminal component | PTY opens and accepts input | Keep separate from agent shell execution |
| Agents | Agent selector and server configuration | Built-in/custom agents are selectable | Simple default, complete Advanced access |
| MCP | MCP context and settings | Servers and status are visible | Preserve in Advanced settings |
| Skills and commands | Runtime configuration and command palette | Configured items remain callable | Preserve in Advanced mode and composer commands |
| Attachments | Prompt input attachment modules | Files and images attach to prompts | Preserve with duplicate prevention |
| Tabs and multiple tasks | Layout and tab contexts | Multiple sessions remain open | Map clearly to task navigation |
| Localization | App i18n modules | English and Chinese catalogs load | Add product copy to both catalogs |
| Diagnostics and recovery | Desktop logging, status, sidecar lifecycle | Logs export and server health are available | Add actionable product error mapping |
```

- [ ] **Step 3: Write the Phase 1-3 package change map**

Create `docs/product/baseline/change-map.md` with:

```markdown
# Phase 1-3 Change Map

## Phase 1

- Add product adapter contracts beside existing App platform and SDK contexts.
- Add privileged credential and platform methods only through Desktop main/preload IPC.
- Extend sidecar status reporting without replacing the existing lifecycle.
- Add compatibility tests around consumed SDK and event contracts.

## Phase 2

- Extend existing provider settings and custom-provider form into guided provider profiles.
- Keep OpenCode's provider catalog and model contexts authoritative.
- Add desktop credential references and local-provider detection through typed IPC.
- Add model capability diagnostics without changing core provider invocation semantics.

## Phase 3

- Evolve existing project/session navigation, prompt input, Session UI, diff, and terminal components.
- Add Simple and Advanced presentation modes over the same configuration and runtime.
- Preserve all rows in the feature-parity baseline.
- Keep product text in existing English and Simplified Chinese catalogs.

## Core Patch Rule

No Phase 1-3 task edits `packages/core`, `packages/opencode`, `packages/server`, `packages/protocol`, or generated clients unless a tested adapter approach is proven insufficient and the patch has a compatibility test plus rationale.
```

- [ ] **Step 4: Commit parity and change maps**

Run:

```bash
git add docs/product/baseline/feature-parity.md docs/product/baseline/change-map.md
git diff --cached --check
git commit -m "docs: define parity and product change maps"
```

Expected: commit succeeds and no OpenCode package source is modified.

### Task 8: Record licensing and verification evidence

**Files:**
- Create: `docs/product/baseline/licenses.md`
- Create: `docs/product/baseline/verification.md`
- Read: `LICENSE`
- Read: `package.json`
- Read: package manifests referenced by the source map

- [ ] **Step 1: Verify upstream license files and package declarations**

Run:

```bash
sed -n '1,220p' LICENSE
rg -n '"license"' package.json packages/{desktop,app,core,server,protocol,opencode}/package.json
```

Expected: upstream and the inspected packages declare MIT licensing.

- [ ] **Step 2: Write the license record**

Create `docs/product/baseline/licenses.md` with:

```markdown
# License Baseline

OpenCode v1.18.10 is distributed under the MIT License. The fork must retain the upstream copyright and permission notice in source and distributed copies.

## Product Rules

1. Keep the upstream `LICENSE` file and required dependency notices.
2. Do not imply endorsement by OpenCode or OpenAI.
3. Do not use OpenCode or Codex as the final product name or logo.
4. Generate a complete production third-party notice inventory before Phase 4 distribution.
5. Review newly added dependencies for license compatibility in every phase.

Phase 0 license review is an engineering inventory, not a legal opinion.
```

- [ ] **Step 3: Write the verification report from observed command results**

Create `docs/product/baseline/verification.md`. Include:

- host architecture, macOS version, Bun version, and Xcode path;
- exact commit and release tag;
- one row for every command in Tasks 3-5 with exit status and duration;
- counts for passing and failing tests where the runner reports them;
- exact failing test names and first actionable error for any unchanged upstream failure;
- paths to generated Electron output and the unpacked `.app`;
- manual smoke result for launch, sidecar initialization, and opening a directory;
- final Phase 0 gate result as `PASS` only if every required item has evidence, otherwise `FAIL` with explicit unmet items.

Do not alter upstream source merely to turn a baseline failure green.

- [ ] **Step 4: Verify documentation completeness**

Run:

```bash
if rg -n 'TB[D]|TO[D]O|un''known|not'' run' docs/product/baseline; then exit 1; fi
for file in upstream source-map feature-parity change-map licenses verification; do test -s "docs/product/baseline/$file.md"; done
git diff --check
```

Expected: all six documents are non-empty, contain no placeholder status, and have no whitespace errors.

- [ ] **Step 5: Commit Phase 0 evidence**

Run:

```bash
git add docs/product/baseline/licenses.md docs/product/baseline/verification.md
git diff --cached --check
git commit -m "docs: record phase 0 verification evidence"
```

Expected: commit succeeds with observed evidence only.

### Task 9: Audit the Phase 0 gate

**Files:**
- Verify: `docs/product/baseline/*.md`
- Verify: `docs/superpowers/specs/2026-08-01-mac-agent-app-design.md`

- [ ] **Step 1: Confirm upstream source remains unmodified after the merge**

Run:

```bash
git diff --name-only v1.18.10...HEAD -- packages
```

Expected: no output. Phase 0 documentation may differ, but imported package source must match the pinned release.

- [ ] **Step 2: Confirm the documented release matches Git**

Run:

```bash
test "$(git rev-parse 'v1.18.10^{}')" = "7902e04c3a67f7c69726bc955efb46e29214c797"
rg -n "v1\.18\.10|7902e04c3a67f7c69726bc955efb46e29214c797" docs/product/baseline/upstream.md docs/product/baseline/verification.md
```

Expected: the assertion succeeds and both identifiers appear in baseline evidence.

- [ ] **Step 3: Re-run the narrow release gate**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run --cwd packages/desktop typecheck
(cd packages/desktop && bun test src)
OPENCODE_CHANNEL=dev bun run --cwd packages/desktop build
```

Expected: all commands exit 0, or `verification.md` explicitly proves an unchanged upstream failure and its impact on Phase 1.

- [ ] **Step 4: Confirm a clean tracked worktree**

Run:

```bash
git status --short
```

Expected: only `.superpowers/` may remain untracked.

- [ ] **Step 5: Mark Phase 0 complete in the project plan**

Update the active project plan only after the source provenance, documentation set, build, tests, package smoke, and parity audit all have current evidence. Then begin the separate Phase 1 implementation plan against the imported source.
