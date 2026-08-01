# Codex-Style Task Workspace Design

**Date:** 2026-08-01
**Status:** Approved for implementation
**Scope:** Phase 3 only

## Summary

Phase 3 turns the existing OpenCode desktop experience into a task-first Agent
Desktop workflow without replacing or forking the OpenCode runtime. The product
will default to a calm Simple presentation, expose Advanced presentation with
one settings control, call sessions "tasks" in product-facing English and
Simplified Chinese copy, guide users to a working model before their first task,
and surface recoverable local-agent-server failures.

Simple and Advanced are presentations over the same projects, sessions, tabs,
models, permissions, tools, terminals, diffs, and persistence. Switching modes
never converts, deletes, disables, or forks runtime data.

## Goals

1. Make the first successful task obvious: choose or confirm a model, open a
   project, enter a request, and follow progress in one workspace.
2. Match the approachable interaction style of Codex while retaining OpenCode's
   complete advanced capability set.
3. Let users switch between Simple and Advanced immediately and reversibly.
4. Present sessions consistently as tasks in the sidebar, home, new-task, tab,
   and empty-state surfaces.
5. Turn model and sidecar failures into visible actions instead of dead ends.
6. Keep the implementation portable to Windows by placing OS-specific behavior
   behind the existing Desktop product host.

## Non-Goals

- Reimplementing the OpenCode agent loop, provider runtime, session API, event
  stream, permission engine, terminal, diff engine, or workspace model.
- Removing MCP, agents, commands, skills, multiple servers, worktrees, review,
  terminals, tabs, or provider configuration.
- Claiming Windows credential support before a Windows credential backend is
  implemented and tested.
- Reproducing Codex branding, copyrighted artwork, or exact visual assets.
- Adding a marketing page, account system, cloud sync, updater changes, or
  telemetry in Phase 3.

## Product Principles

### Task-first, project-grounded

The primary object shown to a user is a task. Every task remains an OpenCode
session and retains its existing ID, directory, messages, children, status,
permissions, and tab identity. "Task" is product vocabulary, not a new storage
entity.

### One runtime, two presentations

`simple` and `advanced` are a persisted UI preference. They do not select a
different agent, provider, config file, API, or execution path. Simple reduces
initial visual density and uses guided defaults. Advanced exposes the existing
technical controls and terminology. Any control hidden from the initial Simple
surface remains reachable through the command palette, existing context menus,
or the one-click Advanced switch.

### Recoverable by default

A missing model opens Models settings. A failed sidecar offers restart and
diagnostic export. An empty project explains the next command. Errors must not
replace the entire workspace when a local recovery action is available.

### Product-owned adaptation

All Phase 3 behavior stays in `packages/app` product/workflow modules,
`packages/app` views and settings, and narrow `packages/desktop` host wiring.
The protected OpenCode runtime remains unchanged.

## Approaches Considered

### A. Replace the current desktop UI

This provides maximum visual freedom but duplicates mature session, diff,
terminal, permission, attachment, and tab behavior. It creates a permanent
merge burden and a high chance of losing advanced features. Rejected.

### B. Product workflow layer over existing views

This retains runtime and view primitives, adds a small presentation-mode
contract, changes product vocabulary, and composes onboarding and recovery
states around existing flows. It gives the closest useful Codex-style workflow
with the lowest compatibility risk. Selected.

### C. Rebrand only

Changing logos and labels would be inexpensive but would not solve first-run
model setup, visual density, task orientation, or recovery. Rejected as
insufficient.

## Information Architecture

### Global shell

- The project rail remains the stable leftmost navigation.
- The expanded project panel is the primary task list.
- The existing top tab strip remains the multi-task working set.
- Settings and Help remain anchored at the bottom of the rail.
- Product-facing title copy uses Agent Desktop.

### Home

- The home screen retains project management and server support.
- The session region is labeled Tasks and keeps search, open, archive, resume,
  and grouping behavior.
- The strongest action is New task.
- Empty states distinguish no project, no task, and no search result.
- When no usable model is selected, a compact setup action opens Models
  settings instead of introducing a blocking wizard.

### New task

- The composer remains the primary first-viewport element.
- Current project/worktree and selected model remain visible near the composer.
- Simple uses the existing safe defaults and keeps advanced workspace controls
  visually secondary.
- Advanced exposes the complete existing project, worktree, agent, model,
  command, attachment, and option paths.
- Submission still promotes the draft through the existing session adapter.

### Task workspace

- Existing streaming timeline, approval cards, questions, attachments, tool
  parts, child sessions, follow-ups, and interruption behavior are preserved.
- Review, files, and terminal remain task-level technical surfaces.
- Simple keeps default-collapsed technical detail and presents a compact route
  to the context surfaces.
- Advanced honors all existing visibility settings and technical controls.
- Task titles, statuses, unread state, errors, and running indicators use the
  existing session sources of truth.

### Settings

- General settings begins with an Interface mode segmented/select control.
- The control has exactly `Simple` and `Advanced` options.
- Models remains a top-level settings destination.
- Advanced mode does not replace or duplicate the Models page.
- English and Simplified Chinese receive first-class product copy. Other
  catalogs fall back through the existing localization mechanism.

## Presentation Mode Contract

```ts
export type ProductPresentationMode = "simple" | "advanced"

export type ProductPresentation = {
  readonly mode: Accessor<ProductPresentationMode>
  readonly simple: Accessor<boolean>
  readonly advanced: Accessor<boolean>
  readonly setMode: (mode: ProductPresentationMode) => void
}
```

The preference is stored in `settings.v3.general.presentationMode` with
`simple` as the default. Unknown persisted values resolve to `simple`. No page
reload is required. A product-owned helper centralizes mode normalization so
views do not interpret raw persisted strings independently.

Mode behavior is intentionally narrow:

| Surface | Simple | Advanced |
| --- | --- | --- |
| Vocabulary | Task-focused | Task-focused |
| New task | Prompt-first, secondary workspace detail | Full existing controls |
| Timeline detail | Existing collapsed defaults | Existing user preferences |
| Technical navigation | Compact context actions | Existing complete controls |
| Settings | Essential rows plus mode switch | Complete existing rows |
| Runtime and persistence | Unchanged | Unchanged |

Mode switching must preserve open tabs, routes, draft text, selected model,
active project, terminal state, and session state.

## Model Readiness

The workflow layer reads model readiness from the existing model context and
Phase 2 Model Center; it does not probe providers on every render.

States:

1. `ready`: a selected provider/model is available; no prompt is shown.
2. `loading`: provider state is unresolved; keep layout stable and show no
   misleading error.
3. `setup-required`: no selectable model is available; show Configure models.
4. `desktop-unavailable`: visual profiles are unavailable on this host; retain
   the preserved OpenCode provider settings path.

The setup action opens the existing Models settings page. After a profile is
saved and selected, the home/new-task callout disappears reactively. The user
is never forced to create a second profile when a built-in provider already
works.

## Sidecar Recovery

The renderer consumes the sanitized Phase 1 `ProductSidecarStatus` through a
small product workflow controller. It subscribes once, unsubscribes on cleanup,
and never receives process output or credentials.

Visible states:

- `starting` or `restarting`: unobtrusive inline progress after a short grace
  period to avoid startup flicker.
- `failed` or unexpected `stopped`: persistent recovery banner with Restart and
  Export diagnostics actions.
- `ready`, `unmanaged`, or `unavailable`: no banner.

Restart uses `product.sidecar.restart()`. Diagnostics uses the existing
`platform.exportDebugLogs`. Buttons expose pending and failure states, prevent
duplicate restart calls, and retain the sanitized error category. Raw sidecar
messages and paths are never rendered.

## Component Boundaries

New product-owned modules:

- `packages/app/src/product/workflow/presentation.ts`
- `packages/app/src/product/workflow/model-readiness.ts`
- `packages/app/src/product/workflow/sidecar-status.ts`
- focused tests beside each module

Narrow integration points:

- `context/settings.tsx` persists and exposes presentation mode.
- `components/settings-v2/general.tsx` renders the mode control and gates only
  nonessential settings rows in Simple mode.
- `pages/home/**`, `pages/new-session/**`, and `pages/layout/**` adopt task copy,
  readiness actions, and presentation state.
- a small reusable workflow notice component hosts model and sidecar actions.
- Desktop renderer passes the already-created Product Host; no new privileged
  IPC is required unless tests prove an existing method inaccessible.

No Phase 3 file may import Electron APIs into `packages/app`.

## Localization

New copy is added to the existing English and Simplified Chinese catalogs.
Wording favors direct commands:

| English | Simplified Chinese |
| --- | --- |
| Tasks | 任务 |
| New task | 新建任务 |
| Interface mode | 界面模式 |
| Simple | 简洁 |
| Advanced | 高级 |
| Configure models | 配置模型 |
| Restart agent service | 重启智能体服务 |
| Export diagnostics | 导出诊断信息 |

"Session" remains in developer types, API contracts, logs, and upstream-owned
technical copy where changing it would be misleading.

## Accessibility And Responsive Behavior

- All icon-only actions retain visible tooltips and accessible labels.
- Status notices use semantic status/alert roles without repeatedly stealing
  focus.
- Pending actions expose disabled/busy states.
- Segmented/select controls are keyboard operable through existing UI
  primitives.
- At 720x800 and 1024x768, notices wrap without horizontal overflow and do not
  cover the composer, task list, tabs, or title bar.
- Dynamic labels stay within existing stable control dimensions.

## Cross-Platform Design

SolidJS views, settings persistence, and workflow controllers are platform
neutral. macOS remains the Phase 3 packaged acceptance target. Windows later
uses the same renderer behavior and the existing `Platform` and Product Host
interfaces; only credential storage, WSL-specific sidecar behavior, packaging,
signing, and OS integration vary.

No macOS path, command, Keychain API, titlebar measurement, or filesystem
separator is introduced into App workflow modules.

## Testing Strategy

### Unit and contract

- presentation-mode normalization, default, persistence API, and no-reload
  switching;
- model-readiness classification;
- sidecar status mapping, grace behavior, restart serialization, diagnostic
  availability, and cleanup;
- English/Simplified Chinese key parity for new workflow copy;
- Simple/Advanced rendering assertions for settings and task surfaces.

### Integration

- create and resume tasks through the existing adapter in both modes;
- switch modes with open task tabs and draft text preserved;
- open Models settings from readiness actions;
- simulate failed sidecar, restart, and diagnostic export with sanitized output;
- verify archive, search, permissions, review, terminal, attachments, model
  selection, and advanced settings remain reachable.

### Packaged macOS acceptance

- clean first launch through model setup to a successful private or local task;
- restart and resume with selected model and presentation mode preserved;
- desktop accessibility scan with zero violations;
- screenshots at 1440x900, 1024x768, and 720x800;
- exact package secret scan and protected-runtime diff remain clean.

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Simple mode silently removes capability | Gate presentation only; maintain a one-click Advanced switch and parity tests |
| Task terminology breaks API assumptions | Change localized view copy only; keep Session types, IDs, routes, and storage unchanged |
| Onboarding appears despite a usable built-in model | Derive readiness from authoritative model selection and provider state |
| Sidecar banner flickers during normal launch | Apply a short grace period to transitional states |
| Product fork diverges from upstream layout | Use focused product helpers and existing components; avoid shell replacement |
| Windows port accumulates macOS assumptions | Keep OS behavior behind Platform/Product Host and test pure workflow modules |

## Phase Gate

Phase 3 is complete only when:

1. Simple is the default and Advanced is one action away;
2. switching modes preserves all runtime data and open work;
3. sessions are presented consistently as tasks across primary workflow copy;
4. a user can reach working model setup without editing configuration files;
5. sidecar failure offers tested restart and diagnostic actions;
6. all Phase 0 parity rows remain available and tested;
7. English and Simplified Chinese workflow copy is complete;
8. App/Desktop tests, type checks, lint, build, package, accessibility,
   responsive visual review, secret scan, and protected-runtime checks pass;
9. `git diff --exit-code v1.18.10...HEAD -- packages/core packages/opencode
   packages/server packages/protocol` remains empty.
