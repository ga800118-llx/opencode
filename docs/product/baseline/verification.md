# Phase 0 Verification

## Baseline Identity

- OpenCode release: `v1.18.10`
- OpenCode commit: `7902e04c3a67f7c69726bc955efb46e29214c797`
- Import merge: `d1168e32db4dc75f63b0a872e8babe5ef9a11699`
- Host: Apple Silicon (`arm64`)
- macOS: 26.3.1 (a), build `25D771280a`
- Bun: 1.3.14
- Node.js: v26.0.0
- Git: 2.50.1 (Apple Git-155)
- Xcode developer path: `/Applications/Xcode.app/Contents/Developer`

## Commands and Results

| Area | Command | Result | Duration / counts |
| --- | --- | --- | --- |
| Dependencies | `bun install --frozen-lockfile` | PASS | 268.32s; 4,696 packages |
| Source integrity | `git diff --exit-code -- package.json bun.lock` | PASS | No changes |
| Lint | `bun run lint` | UPSTREAM FAIL | About 29s; 4,808 warnings, 1 error |
| Core typecheck | `bun run --cwd packages/core typecheck` | PASS | 9s |
| Runtime typecheck | `bun run --cwd packages/opencode typecheck` | PASS | 13s |
| App typecheck | `bun run --cwd packages/app typecheck` | PASS | 8s |
| Desktop typecheck | `bun run --cwd packages/desktop typecheck` | PASS | 9s |
| Desktop tests | `(cd packages/desktop && bun test src)` | PASS | 12s; 59 pass, 0 fail |
| App unit tests | `bun run --cwd packages/app test:unit` | UPSTREAM FAIL | 692 pass, 1 fail |
| Core tests | `bun run --cwd packages/core test` | PASS | 41s; 1,080 pass, 0 fail |
| Runtime tests | `bun run --cwd packages/opencode test` | PASS | 443s; 3,227 pass, 22 skip, 1 todo, 0 fail |
| Desktop build | `MODELS_DEV_API_JSON=... OPENCODE_CHANNEL=dev bun run --cwd packages/desktop build` | PASS | 76s |
| Desktop development launch | `MODELS_DEV_API_JSON=... OPENCODE_CHANNEL=dev bun run --cwd packages/desktop dev` | PASS | Renderer on port 5173; Electron and sidecar ready |
| Unsigned packaging | `electron-builder --mac dir ... identity=null notarize=false` | PASS | 8s |
| Sidecar health | Authenticated `GET /global/health` | PASS | HTTP 200, `healthy: true` |
| Git project | Authenticated `GET /project/current?directory=...` | PASS | HTTP 200, `vcs: git` |
| Final Desktop typecheck gate | Detached `/tmp` worktree, `bun run --cwd packages/desktop typecheck` | PASS | Exit 0 |
| Final Desktop test gate | Detached `/tmp` worktree, `(cd packages/desktop && bun test src)` | PASS | 1.72s; 59 pass, 0 fail |
| Final Desktop build gate | Detached `/tmp` worktree with pinned Models.dev input | PASS | Exit 0; Electron main, preload, and renderer built |

## Runtime Performance Baseline

Measurements use the unsigned packaged arm64 app, a persisted temporary empty Git
repository at `/tmp/opencode-phase0-smoke.dLpMsv`, and three independent app
process launches. The host remained Apple Silicon macOS 26.3.1 (a). OS caches and
the existing user-data directory were not cleared, so these are repeatable warm
host/process-start baselines rather than first-install or reboot-cold numbers.

Startup timestamps come from the existing main-process log:

- start: `app starting`;
- sidecar healthy: `loading task finished` after `health.wait`;
- renderer ready: first `server ready` response;
- application initialized: first-launch onboarding state resolved.

| Sample | Sidecar healthy | Renderer ready | Application initialized |
| ---: | ---: | ---: | ---: |
| 1 | 1.055s | 1.432s | 1.524s |
| 2 | 0.986s | 1.310s | 1.395s |
| 3 | 0.993s | 1.321s | 1.397s |
| **Median baseline** | **0.993s** | **1.321s** | **1.397s** |
| **20% regression boundary** | **1.192s** | **1.585s** | **1.676s** |

Task execution used the unmodified default `opencode/big-pickle` model and the
prompt `Reply with exactly BASELINE_OK.` in the empty temporary repository. No
project source was sent. Server message timestamps measure from user-message
creation to the first assistant text part and to assistant completion.

| Sample | First assistant text | Assistant complete |
| ---: | ---: | ---: |
| 1 | 3.325s | 3.479s |
| 2 | 2.673s | 2.809s |
| 3 | 2.497s | 2.614s |
| **Median baseline** | **2.673s** | **2.809s** |
| **20% regression boundary** | **3.208s** | **3.371s** |

The model measurements include network and provider inference variance. They are
a manual same-model/same-prompt comparison baseline, not a deterministic CI
threshold. Phase 1 adds deterministic adapter timing tests and must report both
those results and this end-to-end comparison.

## Unchanged Upstream Failures

### Lint

`packages/session-ui/src/v2/components/prompt-input/index.tsx:161` contains the
class string `empty:before:content-['\200B']`. Oxlint treats the backslash-number
sequence as a deprecated octal escape. Phase 0 leaves the upstream source intact.

### App i18n Parity

`packages/app/src/i18n/parity.test.ts` reports five Arabic catalog keys missing:

- `dialog.provider.custom.label`
- `dialog.model.unpaid.viewMoreProviders`
- `session.header.reveal.finder`
- `session.header.reveal.fileExplorer`
- `session.header.reveal.containingFolder`

These failures were present on the pinned source before product changes.

## Build and Package Evidence

The direct Models.dev API timed out in this network. The successful build used
`MODELS_DEV_API_JSON` generated from Models.dev commit
`410468e9bbcbeb2f6336f8ca3b555a9964317a81`. The generated `_api.json` SHA-256 is
`0935bc2a6a6068e0355a94976211db2d9e7c0198ec3e22866dd996f61b2a8306`;
`upstream.md` contains the complete clone, checkout, install, build, and checksum
procedure.

Generated outputs:

- `packages/desktop/out/main/index.js`
- `packages/desktop/out/preload/index.js`
- `packages/desktop/out/renderer`
- `packages/desktop/dist/mac-arm64/OpenCode Dev.app`
- `packages/desktop/dist/mac-arm64/OpenCode Dev.app/Contents/Resources/app.asar`

The unpacked app is about 577 MB. Packaging intentionally skipped signing and
notarization. Electron-builder also reported missing package description, absent
optional non-arm64 dependencies, and no `packages/desktop/native` directory.
The `.app` does not include the root MIT `LICENSE` or complete third-party
notices; this is a recorded packaging gap that must be fixed before Phase 4
distribution. `third-party-licenses.md` records the frozen installation scan,
including four unresolved package-license declarations and the licenses requiring
explicit notice or compatibility handling.

## Runtime Smoke

The packaged app was launched with Electron CDP enabled and inspected with
agent-browser 0.33.1.

- Renderer loaded a nonblank Simplified Chinese desktop shell.
- Local sidecar initialized with generated Basic Auth credentials.
- Authenticated health returned HTTP 200.
- A temporary Git repository under `/tmp` opened in the desktop app.
- The project API returned its root commit ID, canonical worktree, and `vcs: git`.
- New Session displayed the project, workspace, and `main` branch.
- The composer, attachment control, model selector, project selector, workspace
  selector, branch status, tabs, and provider setup action rendered.

Home-screen accessibility audit: 0 violations, 1 incomplete contrast check, 20
passes. New-session audit: 1 moderate best-practice violation for no level-one
heading, 1 incomplete contrast check, 31 passes. These are upstream baseline
results, not product regressions.

The test app stalled while resolving the repository under `Documents` when macOS
was locked. OpenCode logs stopped at `Project.fromDirectory`, while the same build
completed the full flow under `/tmp`. The evidence establishes a locked-macOS
filesystem limitation but does not establish whether TCC, file-provider state, or
another host condition is the cause. Signing and permission behavior remain Phase
4 concerns, but signing is not claimed as the fix for this observation.

The post-documentation release gate initially encountered the same locked-path
behavior when Bun was launched in `Documents`. A detached worktree at
`/tmp/ai-agent-phase0-gate` was installed with the frozen lockfile and completed
the Desktop typecheck, 59-test suite, and full Electron build successfully. This
proves the gate against the repository commit without assigning an unproven root
cause to the host limitation.

Dev packaging also attempts a background install of `@opencode-ai/plugin@local`,
which is unavailable from the public registry, and logs a warning. It does not
prevent sidecar health, project initialization, or the desktop workflow.

## Known-Failure Guard

Phase 1 must repair the inherited lint escape and the five missing Arabic i18n
keys before App or Session UI feature work begins. Until that repair is committed,
quality runs are accepted only when their failure set exactly matches the two
documented upstream failures above; any additional lint error or failing test is a
product regression and blocks the phase. After the repair, lint and App unit tests
must both exit 0 in every Phase 1-3 gate.

## Phase 0 Gate

**PASS with recorded upstream defects.** Provenance, full upstream history,
dependency reproducibility, all four type checks, desktop/Core/runtime tests,
desktop build, unsigned packaging, sidecar health, Git project initialization,
source ownership, parity, runtime performance baselines, and the scoped
engineering license audit are complete. The current package is explicitly not
approved for distribution. The two failing quality checks are unchanged upstream
defects documented above and do not block Phase 1 adapter work.
