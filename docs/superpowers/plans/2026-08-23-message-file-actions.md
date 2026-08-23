# Message File Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every valid workspace file link in an assistant reply open internally, with desktop default-open, editor, reveal, and copy-path actions on Mac and Windows.

**Architecture:** Parse and resolve raw Markdown anchor targets with a pure workspace-contained utility, then delegate file-link events from the existing message timeline to a focused SolidJS controller. Reuse the existing file-tab and desktop platform APIs so no protocol, server, model, or generic Markdown changes are required.

**Tech Stack:** TypeScript, SolidJS, Kobalte/MenuV2, existing Guai Code file context, Electron platform bridge, Bun test runner.

---

### Task 1: Parse And Resolve Message File References

**Files:**
- Create: `packages/app/src/pages/session/timeline/message-file-reference.ts`
- Create: `packages/app/src/pages/session/timeline/message-file-reference.test.ts`

- [ ] Write failing tests for relative, POSIX absolute, Windows drive, UNC, `file://`, encoded Unicode, extensionless, and optional line references.
- [ ] Write failing tests rejecting `http`, `https`, `mailto`, fragments, unsupported schemes, sibling-prefix absolute paths, and `..` traversal outside the workspace.
- [ ] Implement `parseMessageFileReference(href)` returning the decoded path and optional line/column.
- [ ] Implement `resolveMessageFileReference(reference, directory)` returning workspace-relative and absolute paths while enforcing containment.
- [ ] Implement `messageFileReferenceFromTarget(target, directory)` using the raw `href` from a Markdown anchor rather than the browser-expanded URL.
- [ ] Run `bun test ./src/pages/session/timeline/message-file-reference.test.ts` from `packages/app` and expect all cases to pass.
- [ ] Commit with `feat(app): resolve message file references`.

### Task 2: Connect File Links To Existing File Tabs

**Files:**
- Create: `packages/app/src/pages/session/timeline/message-file-actions.tsx`
- Create: `packages/app/src/pages/session/timeline/message-file-actions.test.tsx`
- Modify: `packages/app/src/pages/session/timeline/message-timeline.tsx`

- [ ] Write a failing interaction test proving a local file link prevents browser navigation and invokes internal open while an HTTPS link remains untouched.
- [ ] Build `useMessageFileActions` around `useFile`, `useSessionLayout`, and `createOpenSessionFileTab`.
- [ ] Add delegated click, double-click, pointer-over, and context-menu handlers that ignore all non-file targets.
- [ ] Chain the existing timeline click handler before file-link handling so auto-scroll behavior remains unchanged.
- [ ] Open a normalized permanent file tab on single click and retain the existing file viewer's text/media/binary behavior for every extension.
- [ ] Set the resolved absolute path as the hover title without changing generic Markdown rendering.
- [ ] Run the two focused message-file test files from `packages/app` and expect them to pass.
- [ ] Commit with `feat(app): open reply file links in tabs`.

### Task 3: Add Desktop File Actions

**Files:**
- Modify: `packages/app/src/pages/session/timeline/message-file-actions.tsx`
- Modify: `packages/app/src/pages/session/timeline/message-file-actions.test.tsx`

- [ ] Add failing controller tests for default open, reveal, copy path, selected editor, remote-session restrictions, and false `revealPath` results.
- [ ] Add a controlled `MenuV2` anchored to the pointer with internal open, default open, open-in submenu, Finder/File Explorer reveal, and copy path.
- [ ] Load installed editor availability only after the first local file context menu opens by reusing `detectOpenAppOS` and `openAppsForOS`.
- [ ] Route double click to `platform.openPath(absolutePath)` only for local desktop sessions.
- [ ] Route editor choices to `platform.openPath(absolutePath, app.openWith)` and reveal to `platform.revealPath(absolutePath)`.
- [ ] Keep remote menus limited to internal open and copy path, and surface failures through the existing toast style.
- [ ] Run the focused message-file tests and expect them to pass.
- [ ] Commit with `feat(app): add reply file desktop actions`.

### Task 4: Verify Scope And Stability

**Files:**
- Verify only the files listed in Tasks 1-3 plus these design and plan documents.

- [ ] Run `bun test --conditions=solid --preload ./happydom.ts ./src/pages/session/timeline/message-file-reference.test.ts ./src/pages/session/timeline/message-file-actions.test.tsx` from `packages/app`.
- [ ] Run `bun typecheck` from `packages/app`.
- [ ] Run `bun run build` from `packages/app` and expect the Vite production build to complete.
- [ ] Run `git diff --check` and inspect `git diff --stat` plus `git status --short` for unrelated changes.
- [ ] Open the latest development app for manual Mac testing without packaging or modifying user data.
- [ ] Commit verification documentation with `docs(app): record message file actions` only if verification notes require an update.

### Task 5: Add Minimal File Reference Hover Feedback

**Files:**
- Modify: `packages/app/src/pages/session/timeline/message-file-actions.tsx`
- Modify: `packages/app/src/pages/session/timeline/message-file-actions.test.tsx`
- Modify: `packages/app/src/index.css`

- [ ] Extend the hover interaction test to require a marker only on a valid resolved file reference.
- [ ] Run the focused interaction test and verify it fails because the marker is absent.
- [ ] Mark resolved file-reference elements inside the existing delegated controller without changing click, double-click, or context-menu behavior.
- [ ] Add marker-scoped CSS for a pointer cursor, accent-hover color, underline, and a short color transition.
- [ ] Run the focused message-file tests and `bun typecheck` from `packages/app`.
- [ ] Verify the hover state in the running desktop app and confirm ordinary Markdown code remains unchanged.
- [ ] Commit with `fix(app): clarify file link hover state`.

### Task 6: Align The Context Menu With The Pointer

**Files:**
- Modify: `packages/app/src/pages/session/timeline/message-file-actions.tsx`
- Modify: `packages/app/src/pages/session/timeline/message-file-actions.test.tsx`

- [ ] Add a failing coordinate test for a pointer inside a containing block with non-zero left and top offsets.
- [ ] Add a pure coordinate conversion that subtracts the trigger containing block's viewport origin.
- [ ] Capture the hidden trigger element and apply the converted coordinates when opening the file context menu.
- [ ] Run the focused message-file tests and `bun typecheck` from `packages/app`.
- [ ] Dispatch a context-menu event at known viewport coordinates and verify the live menu opens within the configured gutter of that point.
- [ ] Commit with `fix(app): align file menu with pointer`.
