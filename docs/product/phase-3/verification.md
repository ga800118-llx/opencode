# Phase 3 Verification

## Result

**PASS.** The macOS arm64 development candidate completed the Task 8 static,
packaged-workflow, durable task-management, visual, recovery, accessibility,
startup, isolation, and secret gates. This is an unsigned/adhoc development
artifact. Signing, notarization, distribution readiness, and distribution
license/notice review remain deferred.

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

| Gate                  | Result                                                               |
| --------------------- | -------------------------------------------------------------------- |
| Frozen install        | Bun 1.3.14; 2,419 installs across 2,710 packages; exit 0, no changes |
| App discovery run     | 860 passed, 0 failed, 2,207 assertions across 125 files              |
| App scripted unit run | 860 passed, 0 failed, 2,207 assertions across 125 files              |
| App browser run       | 39 passed, 0 failed, 96 assertions across 14 files                   |
| App scripted total    | 899 passed, 0 failed, 2,303 assertions                               |
| App typecheck         | `bun run typecheck` passed                                           |
| App E2E typecheck     | `bun run typecheck:e2e` passed                                       |
| Desktop               | 149 passed, 0 failed, 462 assertions; typecheck passed               |
| UI focused            | 8 passed, 0 failed, 16 assertions; typecheck passed                  |
| Root lint             | 4,872 warnings and 0 errors                                          |
| Protected diff        | No changes from `v1.18.10` in Core, OpenCode, Server, or Protocol    |

`gate-logs/frozen-install.log` retains the prescribed root command, Bun version,
stdout/stderr, exit code, before/after Git status, and unchanged lockfile hash
`e3c51b315182eb68ca7865351675a05d55d86c2a792462adb510999cc47d6185`.
The only status entries before and after were the user-owned `.superpowers/`
files; the install changed neither them nor tracked files.

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
review/context state, and terminal state. A complete process termination and
fresh launch of the same package preserved Advanced mode, selected `coder`
model, active task `ses_02b35ef8cffeqnMQkYM3m0ljhJ`, two task tabs, and task
history. The restored terminal recreated its process-local PTY after one
sanitized `PTY session not found` warning without blocking initialization.

### Task Management

Acceptance submitted real composer requests for two additional durable tasks;
each has two persisted messages. The final SQLite dump in
`task-management-db.txt` proves three total sessions, two active sessions, one
archived session, and two Task 8-created durable sessions. History search found
the `New session` task, which was opened and archived as
`ses_02b372ea7ffeY7SNKwuyUsODjP` at `2026-08-06 01:58:16 UTC`. The other new
task, `ses_02b35ef8cffeqnMQkYM3m0ljhJ`, was opened and remained active after a
complete process relaunch with Advanced mode and `coder` selected.

`gate-logs/task-management-acceptance.log` retains timestamped agent-browser
commands, snapshots, results, relaunch checks, DB output, matrix summary, and
final listener/process cleanup. `task-management-db.txt` records session IDs,
titles, creation/archive timestamps, message counts, summary counts, and the
database SHA-256
`a3a57d691e8344293dd5907b935eeaca9e40e6c5b7248ecb998c708cdd10cff5`.

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

The final exact-candidate matrix retains all 12 English/Simplified Chinese x
Simple/Advanced x 1440x900/1024x768/720x800 screenshots under `visuals/`.
Agent-browser captured Settings > General, where the selected Interface mode
and Language values visibly distinguish every state. Screenshots have the exact
pixel dimensions named in their filenames, including a true 720x800 renderer
surface with no black area below it.

`visuals/visual-matrix-manifest.json` records the package hashes, CDP capture
method, exact locale/mode state, screenshot dimensions and SHA-256, body/root
geometry, dialog and control bounds, overflow, overlap, renderer-fill, and
blank-state checks. All 12 entries report renderer fill, no document overflow,
dialog/mode/language controls inside the viewport, no primary-control overlap,
and nonblank content.

| Locale | Mode     | Viewport | Retained screenshot                   | SHA-256                                                            |
| ------ | -------- | -------- | ------------------------------------- | ------------------------------------------------------------------ |
| EN     | Simple   | 1440x900 | `visuals/en-simple-1440x900.png`      | `2bf21141aa83ad65bdbfa9e4aca950dce8d09715eda8ee5f7584ca0ce40a9ab5` |
| EN     | Simple   | 1024x768 | `visuals/en-simple-1024x768.png`      | `857a59c74a5fd82a679a26f0d012e7aa9507e8e3b36632fc29214571e3f5b87b` |
| EN     | Simple   | 720x800  | `visuals/en-simple-720x800.png`       | `7c8b73d18d2936b654e57f71482d83be2302f025cac26339deb5a5d181af5835` |
| EN     | Advanced | 1440x900 | `visuals/en-advanced-1440x900.png`    | `7276734eeee81a1f4b7d3706cf447d7fe7b44a8a603a9f5f33c183dd14d0fb72` |
| EN     | Advanced | 1024x768 | `visuals/en-advanced-1024x768.png`    | `300e559462d514bd106fcc4692e5a481ebdb9529bb967362118d86af0148121f` |
| EN     | Advanced | 720x800  | `visuals/en-advanced-720x800.png`     | `8582fb451c56797f5dda38d5ff931dd670b86ea01930c5ebfcde22d019fb6ef1` |
| zh-CN  | Simple   | 1440x900 | `visuals/zh-CN-simple-1440x900.png`   | `3148efda5cd242d0403e7fa1315135daf1ac3fa4231725cbf3e64cc6f47efced` |
| zh-CN  | Simple   | 1024x768 | `visuals/zh-CN-simple-1024x768.png`   | `701d17faf6dedbc1d0590f57cbb9cd828c4833ef434e1b5398a0a7d2b5f16a56` |
| zh-CN  | Simple   | 720x800  | `visuals/zh-CN-simple-720x800.png`    | `be71eff29e7007eb2a8d7c329cc485cf33721025c5847918368d9f9edb677594` |
| zh-CN  | Advanced | 1440x900 | `visuals/zh-CN-advanced-1440x900.png` | `6c3f920fa718341eb6a606749575f3624257672d1c2b02cb7b16fcb0ebf44d37` |
| zh-CN  | Advanced | 1024x768 | `visuals/zh-CN-advanced-1024x768.png` | `2c55f103db863fcc186594d67886413bf5c574d1fd6259419e24e88c660f139f` |
| zh-CN  | Advanced | 720x800  | `visuals/zh-CN-advanced-720x800.png`  | `9c90cf25a8a82c997495e1c7c9ed2a9565f733912e0c3161c95676c1023e5729` |

The documentation captures are the visibly distinct exact-candidate English
1440x900 Settings > General Simple and Advanced states:

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

`gate-logs/security-scan.log` retains the reproducible binary-safe fixed-string
method, hashes for both fixture canary classes without printing their values,
per-scope commands, locations, file counts, match counts, results, and package
hashes. Its 24 scope/class observations cover both canary classes across the
complete acceptance root, user data, XDG config/data/cache/state, Chromium
caches/databases, logs/network data, extracted diagnostics ZIP, source app
bundle, raw ZIP, raw DMG, extracted ZIP, byte-identical package copy, and
read-only mounted DMG. Every observation has zero matches; the DMG was detached
and `secret-scan.txt` is synchronized at `PLAINTEXT_MATCH_FILES=0` and
`DMG_PLAINTEXT_MATCH_FILES=0`.

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
| `task-workspace-simple.png`       |          1440x900 | `2bf21141aa83ad65bdbfa9e4aca950dce8d09715eda8ee5f7584ca0ce40a9ab5` |
| `task-workspace-advanced.png`     |          1440x900 | `7276734eeee81a1f4b7d3706cf447d7fe7b44a8a603a9f5f33c183dd14d0fb72` |

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
