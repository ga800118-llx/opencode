# Phase 3 Verification

## Result

**PASS.** The macOS arm64 development candidate completed the Task 8 static,
packaged-workflow, recovery, accessibility, startup, isolation, and secret
gates. This is an unsigned/adhoc development artifact. Signing, notarization,
distribution readiness, and distribution license/notice review remain deferred.

## Environment

- Acceptance date: 2026-08-06.
- Source: `codex/phase-0-3` at product-fix commit `a193e624b`.
- Host: Apple Silicon macOS 26.3.1 (a), Asia/Shanghai.
- Runtime: Bun 1.3.14 and Electron 42.3.3.
- Final acceptance root: `/tmp/agent-phase3-final.MFXvKB`.
- Candidate inputs: `OPENCODE_CHANNEL=dev` and the pinned
  `packages/core/test/plugin/fixtures/models-dev.json` snapshot.
- Electron user data and all XDG config/data/cache/state paths were under the
  fresh root. `HOME` and `CFFIXED_USER_HOME` remained the real macOS home only
  for `safeStorage`/login-Keychain behavior and the Downloads diagnostics
  export. A fresh migration-complete sentinel prevented importing any existing
  development profile.

## Automated Gates

| Gate                  | Result                                                            |
| --------------------- | ----------------------------------------------------------------- |
| Frozen install        | 2,419 installs across 2,710 packages; no changes                  |
| App discovery run     | 860 passed, 0 failed, 2,207 assertions across 125 files           |
| App scripted unit run | 860 passed, 0 failed, 2,207 assertions across 125 files           |
| App browser run       | 39 passed, 0 failed, 96 assertions across 14 files                |
| App scripted total    | 899 passed, 0 failed, 2,303 assertions                            |
| App typecheck         | `bun run typecheck` passed                                        |
| App E2E typecheck     | `bun run typecheck:e2e` passed                                    |
| Desktop               | 149 passed, 0 failed, 462 assertions; typecheck passed            |
| UI focused            | 8 passed, 0 failed, 16 assertions; typecheck passed               |
| Root lint             | 4,872 warnings and 0 errors                                       |
| Protected diff        | No changes from `v1.18.10` in Core, OpenCode, Server, or Protocol |

The UI log first records a mistyped, nonmatching test path, followed by the
corrected focused command and its passing total above. This was a command typo,
not a product failure. The lint total is the exact final line in
`gate-logs/lint.log`; warnings are warning-only repository debt and the gate has
zero errors.

Build/package warnings were non-blocking: Node's `module.register()`
deprecation, bundled upstream `eval` notices, Vite static/dynamic import and
chunk notices, a missing package description, missing optional dependencies for
other platforms/architectures, and the absent optional Desktop `native`
directory. Electron Builder explicitly skipped macOS application signing; the
packaged launcher has only an adhoc linker signature, no Team ID or sealed
resources.

## Packaged Workflows

### Model Setup

The exact package configured **Phase 3 Private** at `127.0.0.1:59739` through
Settings > Models. The authenticated OpenAI-compatible fixture used encrypted
fixture credentials, exposed deterministic models, passed streaming and tool
checks, and selected `coder`. An Ollama-compatible fixture was also available
at `127.0.0.1:11434` and its deterministic models were discovered. Real
composer submissions reached the configured fixture, streamed, and returned
`OK`.

### Mode And State Continuity

A clean profile opened in Simple mode. Switching to Advanced preserved the
active task, multiple task tabs, a non-empty draft, selected `coder` model,
review/context state, and terminal state. A complete process relaunch preserved
the presentation mode, selected model, active task, and task history. The
restored terminal recreated its process-local PTY after one sanitized
`PTY session not found` warning without blocking initialization.

### Task Management

Acceptance created and opened multiple tasks, searched history, archived a
task, and resumed the remaining task. The composer, task tabs, Home history,
draft, selected agent/model, and active task stayed coherent through mode
changes and relaunch.

### Technical Surfaces And Permissions

Review, Context/Open File, multi-tab terminal, model/agent selectors, and
Settings > General permission controls remained reachable. The same underlying
capabilities remain available in both modes; Simple uses compact task controls
and collapsed shell/edit detail, while Advanced uses full action density and
allows those details to expand. This acceptance does not claim visual CRUD for
agents, MCP servers, or skills.

## Recovery And Export

Fault injection used a byte-identical app copy under the acceptance root. After
launch, `app.asar` was temporarily made unavailable and the active utility
process was terminated. New starts exhausted the bounded four attempts and
ended in the sanitized product failure banner. Axe reported 35 passes, zero
violations, and one incomplete color-contrast check on that state.

After `app.asar` was restored, its hash matched the exact candidate. The visible
**Restart service** action returned the app to ready, the existing task remained
available, and **Export diagnostics** produced
`diagnostics/opencode-debug-20260805T103109.zip`. The restored package copy also
retained the exact `opencode-cli` hash.

## Startup Performance

The main-log method measures from `app starting` to `loading task finished`
(sidecar healthy), `server ready` (renderer requested initialization), and the
onboarding check (application initialized).

|                   Sample | App start    | Sidecar healthy | Renderer ready | Initialized |
| -----------------------: | ------------ | --------------: | -------------: | ----------: |
|                        1 | 18:35:49.595 |         0.971 s |        1.324 s |     1.399 s |
|                        2 | 18:41:20.822 |         0.981 s |        1.325 s |     1.397 s |
|                        3 | 18:41:56.143 |         0.964 s |        1.318 s |     1.392 s |
|               **Median** |              |     **0.971 s** |    **1.324 s** | **1.397 s** |
| **Phase 0 20% boundary** |              |     **1.192 s** |    **1.585 s** | **1.676 s** |

All medians pass the Phase 0 boundaries.

## Visual Matrix

English and Simplified Chinese were inspected in Simple and Advanced at
1440x900, 1024x768, and 720x800: 12 locale/mode/viewport states. Body and root
client/scroll geometry matched at every size, with no document-level overflow,
blank task panel, clipped primary control, incoherent overlap, focus loss, or
mode-switch layout shift.

The first 720x800 Electron capture showed black below the resized window because
the capture included area outside the renderer's visible backing surface. The
final `visuals/720x800-visible-size.png` used `Emulation.setVisibleSize`; its
1,440x1,600 Retina pixels represent a true 720x800 visible area and are fully
filled while DOM and main bounds remain 720x800. This is capture geometry, not
document blanking. The final localized-start state shows the reactive Chinese
composer placeholder `随便问点什么...`; the earlier English placeholder was
captured before the locale-switch reload completed.

The documentation captures are exact 2x Retina images of the 1440x900 packaged
workspace:

![Simple task workspace](artifacts/task-workspace-simple.png)

![Advanced task workspace](artifacts/task-workspace-advanced.png)

## Accessibility

| Axe surface            |  Passes | Violations | Incomplete |
| ---------------------- | ------: | ---------: | ---------: |
| Home, Simple           |      39 |          0 |          1 |
| New Task, Simple       |      35 |          0 |          1 |
| Active Task, Simple    |      35 |          0 |          1 |
| General, Simple        |      38 |          0 |          2 |
| Home, Advanced         |      39 |          0 |          1 |
| New Task, Advanced     |      35 |          0 |          1 |
| Active Task, Advanced  |      35 |          0 |          1 |
| General, Advanced      |      38 |          0 |          2 |
| Models settings        |      36 |          0 |          2 |
| Sidecar failure banner |      35 |          0 |          1 |
| **Total**              | **365** |      **0** |     **13** |

All 10 result files report success and zero violations. The 13 incomplete
checks are axe uncertainty, not violations: `color-contrast` on layered/short
content and the existing `aria-hidden-focus` modal uncertainty on General and
Models settings.

## Security And Isolation

The complete scan covered the acceptance root and package output: fresh user
data, Chromium caches and databases, logs and every `network.netlog`, sidecar
XDG config/data/cache/state, diagnostics ZIP and extracted contents, source and
copied app bundles, extracted ZIP, raw ZIP/DMG, and mounted DMG. Both fixture
credential canaries returned `PLAINTEXT_MATCH_FILES=0`; the raw/mounted DMG
check independently returned `DMG_PLAINTEXT_MATCH_FILES=0`.

Profile metadata and IPC views remained renderer-safe. Credentials were stored
by the product credential service using macOS `safeStorage`; package and sidecar
state contained only non-secret metadata/proxy values. Only the development
product identity, fresh Electron user-data root, and fresh XDG `opencode`
namespace were used. Migration was explicitly skipped, and no OpenCode beta or
production release profile was written.

## Artifact Hashes

| Artifact                          |        Dimensions | SHA-256                                                            |
| --------------------------------- | ----------------: | ------------------------------------------------------------------ |
| `app.asar`                        | 159,930,317 bytes | `84cc46810a325512e27237bbcd4ffb43f3e750d90577142436109c55b4b7a708` |
| `agent-desktop-dev-mac-arm64.zip` |                 - | `c986c44e1a7d78d171b510870f6c0b6be15453d18950fec57dc9b94423c63633` |
| `agent-desktop-dev-mac-arm64.dmg` |                 - | `70392fb5e51caddd221ea425b27c04e49e5a132413c2a22ac21e601d998d72a7` |
| Packaged `opencode-cli`           | 144,371,024 bytes | `97d65671c27949869e4d3e9e90b596d9b9b81cd00ca7b3d602d409a06c83612e` |
| `task-workspace-simple.png`       |         2880x1800 | `96bea95dd08421779955bc04c53d66220ebfc50eb18c89a073d13cf972a65002` |
| `task-workspace-advanced.png`     |         2880x1800 | `f9fb0e6300fdaec211fdf2c83037921c4fa8c1ced97c6b64cf32926b32e9e069` |
| `720x800-visible-size.png`        |         1440x1600 | `02ba0bc9155ccf89df18104a6a4f172893b67e93616d9b76fd9a88c8f288f62e` |

## Deferred Risks

- Windows Credential Manager/backend and Windows packaging were not exercised
  and are not claimed.
- macOS signing and notarization were not performed.
- Distribution license/notice review and distribution readiness remain
  deferred.
- SSH remains a reserved server type, not an implemented or verified feature.
- Durable in-flight task execution recovery after a process crash remains
  deferred; this gate covers sidecar recovery and persisted UI/task continuity.
- Dedicated visual CRUD/managers for agents, MCP, and skills remain deferred.

## Gate Decision

**GO for Phase 3 development acceptance on unsigned/adhoc macOS arm64
artifacts.** This is not a Windows-support, SSH-support, signing, notarization,
or distribution-readiness decision.
