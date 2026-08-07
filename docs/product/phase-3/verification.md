# Phase 3 Verification

## Result

**PASS.** The final macOS arm64 development candidate completed the Phase 3
source, package, cloud/private/local model, workflow, durable task-management,
long-task interruption, recovery, accessibility, visual, startup, isolation,
and secret gates. It is an unsigned development artifact with only an adhoc
linker signature. Signing, notarization, and distribution readiness are not
claimed.

## Environment

- Final acceptance date: 2026-08-07.
- Source: `codex/phase-0-3` at exact product-source commit
  `d19acc112e213088ac8c6bdd84727e797a857de7`.
- Host: Apple Silicon macOS 26.3.1 (a), Asia/Shanghai.
- Runtime: Bun 1.3.14 and Electron 42.3.3.
- Final authoritative root: `/tmp/agent-phase3-final2.7ZKOAw`.
- Build inputs: `OPENCODE_CHANNEL=dev` and the pinned
  `packages/core/test/plugin/fixtures/models-dev.json` model snapshot.
- The final root adopted the checkpointed state from the fresh Task 8 candidate
  and then ran upgrade continuity plus final cloud, private, local, save,
  relaunch, and interruption acceptance. Startup samples used separate fresh
  Electron/XDG roots. The development bundle identifier is
  `dev.agent.desktop`.

`source-state.txt`, `artifact-hashes.txt`, `package-equivalence.txt`, and the
files under `gate-logs/` retain the exact source, package, and gate evidence.
The extracted final package differs from the preceding Task 8 package only in
one compiled expression in model-profile persistence. Renderer, preload,
resources, and the packaged sidecar are byte-identical; the renderer tree hash
is `196f6f88ed1d574a56f45c4339f77836dc700ee4155ad0ad7ce2db47e468a3b4`
for both candidates.

## Automated Gates

| Gate                       | Exact result                                                         |
| -------------------------- | -------------------------------------------------------------------- |
| Frozen install             | Bun 1.3.14; 2,419 installs across 2,710 packages; exit 0, no changes |
| App scripted unit          | 860 passed, 0 failed, 2,207 assertions across 125 files              |
| App browser                | 39 passed, 0 failed, 96 assertions across 14 files                   |
| App scripted total         | 899 passed, 0 failed, 2,303 assertions                               |
| Focused Task 8 browser E2E | 11 passed, 0 failed across 4 specs                                   |
| App typecheck              | Passed                                                               |
| App E2E typecheck          | Passed                                                               |
| Desktop                    | 150 passed, 0 failed, 464 assertions across 32 files; typecheck pass |
| UI                         | 9 passed, 0 failed, 19 assertions across 2 files; typecheck pass     |
| Root lint                  | 4,872 warnings, 0 errors; 3,189 files and 130 rules                  |
| Protected diff             | No Core, OpenCode, Server, or Protocol changes from `v1.18.10`       |
| Tracked diff check         | `git diff --check` passed                                            |

The focused E2E command ran
`home-task-terminology.spec.ts`, `new-session-presentation.spec.ts`,
`session-timeline-accessibility.spec.ts`, and `presentation-mode.spec.ts` with
one worker. Playwright reports tests/specs rather than an assertion total for
this command. `gate-logs/app-accessibility-e2e.log` retains all 11 test names.

`gate-logs/frozen-install.log` retains the prescribed root
`bun install --frozen-lockfile` command, Bun version, stdout/stderr, exit code,
before/after status, and unchanged lockfile SHA-256
`e3c51b315182eb68ca7865351675a05d55d86c2a792462adb510999cc47d6185`.
Only the user-owned untracked `.superpowers/` directory appeared before and
after; the install changed neither it nor tracked files.

The final exact build used the pinned repository fixture and passed. An initial
package invocation attempted to fetch Electron again and was stopped after it
made no progress; the successful invocation used the already verified local
Electron 42.3.3 distribution archive. Retained non-blocking warnings cover
Node's `module.register()` deprecation, upstream `eval`, Vite import/chunk and
static-script notices, a missing package description, absent optional
other-platform dependencies, and the absent optional Desktop `native`
directory. Electron Builder found no valid signing identity. The mounted final
bundle reports `Signature=adhoc`, no Team ID, and no sealed resources in
`package-signature.txt`; strict code-sign and Gatekeeper assessment fail as
expected for this explicitly unsigned development artifact.

## Packaged Workflows

### Model Setup

The original Task 8 package opened in Simple mode with no migration or imported
profile. Through Settings > Models, acceptance visually configured authenticated
private profile **Phase 3 Final Private** at `127.0.0.1:59739`, entered API-key
and sensitive-header fixture canaries, marked the header sensitive, discovered
its deterministic models, passed chat/streaming/tool capability checks, saved
the profile, and selected `coder` as default. Product credential storage
encrypted the sensitive values; renderer-visible state retained only non-secret
metadata.

The final exact package then exercised all three required model paths:

| Path                      | Model                  | Packaged result                                                                         |
| ------------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| Private OpenAI-compatible | `coder`                | Authenticated request included both required secret classes upstream and returned `OK`  |
| Local Ollama-compatible   | `qwen2.5-coder:7b`     | Detected two models, passed streaming/tools, saved, and completed a real task with `OK` |
| Built-in cloud            | DeepSeek V4 Flash Free | Completed a real task with exact response `PHASE3_FINAL2_CLOUD_OK`                      |

After testing the local profile, acceptance reopened it and saved again without
changing metadata. This path exposed a late regression in the preceding
candidate: a matching capability report was reduced to boolean `true` before
sanitization, so Save failed. Commit
`d19acc112e213088ac8c6bdd84727e797a857de7` preserves the report object instead.
Two focused regression tests failed before the fix and passed after it; the
final packaged dialog closed successfully, retained **Agent capable**, and
retained the report after a complete app relaunch.

### Mode And State Continuity

Before switching modes, acceptance opened Review with one changed file,
Context > Open File with `README.md`, two Terminal tabs, the model selector,
the Build/Plan agent selector, and Settings > General permission controls. The
Simple-to-Advanced switch preserved the active task, three durable task tabs,
nonempty draft `PRESERVE_DRAFT_ACROSS_MODE`, selected `coder`, review/context,
and terminal state.

After archive/search/resume, a complete process termination and relaunch of the
Task 8 package preserved Advanced mode, `coder`, active task
`ses_02ad72d04ffePT7DFLAZ3VRctv`, two durable tabs, and the `OK` history. A
separate complete termination and relaunch of the final exact package preserved
all five inherited/new active tabs, the cloud prompt and exact response, the
local **Agent capable** report, and the private capability report. The later
visual-matrix steps intentionally changed mode and locale after the original
continuity proof.

### Task Management

The original timestamped, redacted Agent Browser transcript proves three real
durable submissions, UI archive, Home search, opening/resuming a search result,
and complete process relaunch. The final requalification added one private, one
local, one cloud, and one interrupted local task. The final checkpointed
`task-management-db.txt` records:

| Session ID                       | Created UTC         | State    | Messages | Evidence path           |
| -------------------------------- | ------------------- | -------- | -------: | ----------------------- |
| `ses_02ad94856ffebLRCsyvFvkMmte` | 2026-08-06 03:38:32 | archived |        2 | Original Task 8         |
| `ses_02ad72d04ffePT7DFLAZ3VRctv` | 2026-08-06 03:40:50 | active   |        2 | Original Task 8         |
| `ses_02ad6d254ffeJi2nyXBBOGfUjA` | 2026-08-06 03:41:13 | active   |        2 | Original Task 8         |
| `ses_0256ca9adffeR0J8Q6CsGPsOvQ` | 2026-08-07 04:55:16 | active   |        2 | Final private           |
| `ses_025659136ffeQIjeWarRf4a3wy` | 2026-08-07 05:03:01 | active   |        2 | Final local             |
| `ses_02563b61cffeHWXmS1IR6WxFGj` | 2026-08-07 05:05:03 | active   |        2 | Final cloud             |
| `ses_0254b9612ffeb0I8nbAuABVs3b` | 2026-08-07 05:31:24 | active   |        2 | Final interrupted local |

Logical totals are exactly **7 total, 6 active, 1 archived**, with two messages
per session. After all workflow processes stopped,
`PRAGMA wal_checkpoint(TRUNCATE)` returned `0|0|0` and
`PRAGMA integrity_check` returned `ok`. The final main database is 344,064
bytes with SHA-256
`574addd8eec3c0dfa4d4e1a0d1a4efff4e4e24a47a9006da3fdd0a26cc89eba6`.
The WAL is zero bytes; the retained 32,768-byte SHM index has SHA-256
`8d3c8acb024f9a36d577a02f1b9923cb7cf3e35f200fbbb2a017b4c6d7c7affc`
and no pending database pages.

### Technical Surfaces And Permissions

Review, Context/Open File, multi-tab Terminal, model and agent selectors, and
General permission controls were all exercised through the packaged UI. Simple
keeps core task actions compact; Advanced exposes the existing detailed
controls. This acceptance preserves agent, MCP, and skill runtime/selector
surfaces but does not claim dedicated visual CRUD for them.

### Long-Running Task Interruption

The final package selected local `qwen2.5-coder:7b` and submitted
`PHASE3_FINAL2_LONG_RUNNING_CANCELLATION` to a deterministic continuous SSE
fixture. The timeline rendered 22 incremental chunks while the composer showed
**Stop**. Activating Stop restored the idle composer, preserved the partial
response, and marked the turn **Interrupted** after 11 seconds. The fixture
recorded `request_aborted`; `cancellation-ui.txt`, `cancellation.png`, and
`gate-logs/cancellation-fixture.log` retain the redacted evidence.

## Recovery And Export

Final-candidate crash acceptance terminated the live sidecar utility while the
exact package remained open. `gate-logs/final-recovery.log` records exit code
15, an unexpected-exit transition, and a second supervised spawn 253 ms later.
The listener PID changed from `29754` to `30035` on the same loopback port, the
replacement listener was ready, no recovery banner remained, and graceful app
quit later stopped the replacement with code 0.

The preceding Task 8 fault acceptance additionally made its already-loaded
`app.asar` unavailable after launch and terminated the generated sidecar
utility. It records start attempts 1, 2, 3, and 4, followed by bounded
exhaustion and the sanitized failure banner. The failure surface passed axe
with 39 passes, 0 violations, and 1 incomplete color-contrast check. This
failure/export evidence remains applicable because the final package changes
only the capability-report preservation expression; sidecar, renderer, preload,
resources, recovery sources, and diagnostic-export sources are unchanged.

The visible **Export diagnostics** action produced
`diagnostics/opencode-debug-20260806T040116.zip` with SHA-256
`ddff91f4562716ce125dd7daae52a4286f7eadad64017ed0b7d1988b9c2200d0`.
After restoring exact `app.asar` and CLI hashes, the visible **Restart service**
action returned to ready; the failure banner disappeared and both active task
tabs remained available.

## Startup Performance

The retained method measures from `app starting` to `loading task finished`
(sidecar healthy), `server ready` (renderer requested initialization), and the
onboarding check (application initialized). Every sample launched the exact
DMG-mounted package with a fresh isolated user-data/XDG root containing only
the migration and onboarding completion sentinels used by the Phase 0
comparison method.

| Sample                   | App start    | Sidecar healthy | Renderer ready | Initialized |
| ------------------------ | ------------ | --------------: | -------------: | ----------: |
| 1                        | 13:23:45.983 |         1.374 s |        2.018 s |     2.151 s |
| 2                        | 13:23:49.031 |         1.060 s |        1.506 s |     1.610 s |
| 3                        | 13:23:51.734 |         1.045 s |        1.514 s |     1.613 s |
| **Median**               |              |     **1.060 s** |    **1.514 s** | **1.613 s** |
| **Phase 0 20% boundary** |              |     **1.192 s** |    **1.585 s** | **1.676 s** |

All three medians pass. Raw logs are `gate-logs/perf-1.console.log` through
`perf-3.console.log`; `performance-summary.txt` retains timestamps,
calculations, boundaries, and the result.

## Visual Matrix

All 12 Task 8 screenshots are retained under
`renderer-equivalent-evidence/visuals/` in the final evidence root for English
and Simplified Chinese, Simple and Advanced, and 1440x900, 1024x768, and
720x800. They are attributed to the final candidate only at the renderer level:
all 1,581 renderer files, preload files, and resource files are byte-identical.
Settings > General visibly shows the selected mode and language.

| Locale | Mode     | Viewport | Retained screenshot                   | SHA-256                                                            |
| ------ | -------- | -------- | ------------------------------------- | ------------------------------------------------------------------ |
| EN     | Simple   | 1440x900 | `visuals/en-simple-1440x900.png`      | `e67725bc11df5a0551504ee9591d8e881ec3b1d9cf0b421294e61c94249b9929` |
| EN     | Simple   | 1024x768 | `visuals/en-simple-1024x768.png`      | `bb209f0dfd0116f6d130f046b91add45a03cec961caa4a471c6f646532e9be38` |
| EN     | Simple   | 720x800  | `visuals/en-simple-720x800.png`       | `74063a08ec827683482b443a85c680885d3537f9507999329222cc135370834a` |
| EN     | Advanced | 1440x900 | `visuals/en-advanced-1440x900.png`    | `2372eb6a2d1d2939cb114e061873fb572d5ba8a39a04b58fa9d8aa5986f5ea39` |
| EN     | Advanced | 1024x768 | `visuals/en-advanced-1024x768.png`    | `85cb76889248bc04ea401ea2101985b041104c35b12985f3648f514b0063c5b3` |
| EN     | Advanced | 720x800  | `visuals/en-advanced-720x800.png`     | `5037943c1c94e9773a65e862d77089f41b36cf54e85f8647767fbb9973c7677e` |
| zh-CN  | Simple   | 1440x900 | `visuals/zh-CN-simple-1440x900.png`   | `c06693e55d80f07093502761f6f4b671f009a4a02a742b4a5c6ed550539b79cb` |
| zh-CN  | Simple   | 1024x768 | `visuals/zh-CN-simple-1024x768.png`   | `67726dd53e9c46eb9896b5a467d0970d840962d1d1559994af8f91278a9e4bda` |
| zh-CN  | Simple   | 720x800  | `visuals/zh-CN-simple-720x800.png`    | `4096ce357db5b673021d13a4e5d27c8af8e228c0f9ac7b05487538f56c4c3391` |
| zh-CN  | Advanced | 1440x900 | `visuals/zh-CN-advanced-1440x900.png` | `0460949c9913b4ded6b1653497c78bddf5008c92b737a371f7e82d1b488d12ad` |
| zh-CN  | Advanced | 1024x768 | `visuals/zh-CN-advanced-1024x768.png` | `0efc6df8dc0cd807a466173b5561947aa8c81890705692325f1cdd3380f305d5` |
| zh-CN  | Advanced | 720x800  | `visuals/zh-CN-advanced-720x800.png`  | `34e59c0d71152897e99b168e62212eaadbdff6bd453129c35f727842e507b1dc` |

`renderer-equivalent-evidence/visuals/visual-matrix-manifest.json` records the
original candidate hashes, screenshot hashes/dimensions, exact locale/mode,
body/root dimensions, renderer fill, overflow, dialog/control bounds, overlap,
frame settling, and nonblank checks. `renderer-evidence-provenance.txt` records
the byte-equivalence proof to the final package. All 12 pass. At 720x800, the
body and root are exactly 720x800; the dark area around the settings dialog is
the dimmed in-app workspace, not capture outside the visible renderer or a
blank document region.

The documentation artifacts are visibly identified byte-equivalent English
1440x900 General settings states:

![Simple task workspace](artifacts/task-workspace-simple.png)

![Advanced task workspace](artifacts/task-workspace-advanced.png)

## Accessibility

| Axe surface            |  Passes | Violations | Incomplete | Inapplicable |
| ---------------------- | ------: | ---------: | ---------: | -----------: |
| Home, Simple           |      39 |          0 |          1 |           50 |
| New Task, Simple       |      35 |          0 |          1 |           54 |
| Active Task, Simple    |      35 |          0 |          1 |           54 |
| General, Simple        |      38 |          0 |          2 |           51 |
| Home, Advanced         |      39 |          0 |          1 |           50 |
| New Task, Advanced     |      35 |          0 |          1 |           54 |
| Active Task, Advanced  |      35 |          0 |          1 |           54 |
| General, Advanced      |      38 |          0 |          2 |           51 |
| Models settings        |      36 |          0 |          2 |           53 |
| Sidecar failure banner |      39 |          0 |          1 |           50 |
| **Total**              | **369** |      **0** |     **13** |      **521** |

All 10 retained byte-equivalent renderer surface result files report success
and zero violations; `renderer-equivalent-evidence/axe/axe-summary.json`
contains their aggregate. The exact final package independently reran Models
settings in `axe-model-center.json` with the same 36 passes, 0 violations, 2
incomplete checks, and 53 inapplicable rules. The 13 aggregate incompletes are
axe uncertainty, not violations: layered/short-content `color-contrast`, plus
one existing modal `aria-hidden-focus` uncertainty on each General and Models
surface. Packaged checks also recorded exactly one level-one heading on Home and
Active Task, and a labeled Home combobox with `aria-controls`, correct expanded
state, a listbox, and two search options.

## Security And Isolation

The original comprehensive binary-safe scan retained 24 zero-match
scope/class observations across user data, XDG roots, Chromium state, network
logs, diagnostics, app copies, ZIP, DMG, and a read-only DMG mount. After every
final-candidate workflow, screenshot, log, performance sample, and retained
renderer-equivalent artifact was present, `secret-scan.txt` repeated both
fixture-canary classes across the complete final root, raw `app.asar`, raw ZIP,
raw DMG, and read-only mounted DMG.

All 10 final observations found zero plaintext match files. The DMG was
detached, the acceptance app and fixtures were stopped, and ports 11434, 19454,
19455, and 59739 had no remaining listener. Every packaged launch used the
development identity and explicit acceptance roots; no release-profile path was
configured or written by the acceptance commands.

## Artifact Hashes

| Artifact                          | Size / dimensions | SHA-256                                                            |
| --------------------------------- | ----------------- | ------------------------------------------------------------------ |
| `app.asar`                        | 159,931,482 bytes | `63210097f3e353ffe9067da954f1b3c760f393f8f29c1d10232538fe613edb5d` |
| `agent-desktop-dev-mac-arm64.zip` | 215,365,626 bytes | `6d8bf91a0cf5a6134a074cc1867e8f82d099dd19b6783880a93fa24e1bf67c6f` |
| `agent-desktop-dev-mac-arm64.dmg` | 216,302,394 bytes | `4875931d4e7e0f2449fab6262e8538143706665cfc2d02a42a49c87f6b6bdcab` |
| Packaged `opencode-cli`           | 144,371,024 bytes | `97d65671c27949869e4d3e9e90b596d9b9b81cd00ca7b3d602d409a06c83612e` |
| `task-workspace-simple.png`       | 1440x900          | `e67725bc11df5a0551504ee9591d8e881ec3b1d9cf0b421294e61c94249b9929` |
| `task-workspace-advanced.png`     | 1440x900          | `2372eb6a2d1d2939cb114e061873fb572d5ba8a39a04b58fa9d8aa5986f5ea39` |
| `cancellation.png`                | 2560x1588         | `5d9858e9d7523af8e06cd8daa54fbbbffd06c292bf77784d3766a2bed1890d18` |

`artifact-hashes.txt` is the authoritative final package record. The files
under the final evidence root's `artifacts/` directory match the build output;
`package-equivalence.txt` records the single compiled main-process difference
from the preceding package.

## Deferred Risks

- Windows Credential Manager/backend and Windows packaging were not exercised
  and are not claimed.
- SSH remains a reserved server type, not an implemented or verified feature.
- macOS signing and notarization were not performed; distribution license and
  notice review and distribution readiness remain deferred.
- Durable in-flight execution recovery after a process crash remains deferred;
  this gate covers persisted task/UI continuity and supervised sidecar recovery.
- Dedicated visual CRUD/managers for agents, MCP servers, and skills remain
  deferred. Delivered MCP coverage is the preserved status, toggle, resource,
  prompt, OAuth, and command surfaces.
- Axe color-contrast and modal aria-hidden-focus incompletes require manual
  review; they are not automated violations.

## Gate Decision

**GO for Phase 3 development acceptance on this exact unsigned/adhoc macOS
arm64 candidate.** This decision does not imply Windows support, SSH support,
signing, notarization, distribution licensing, or distribution readiness.
