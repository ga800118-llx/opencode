# Skill Management Design

**Date:** 2026-08-08
**Status:** Approved for implementation
**Scope:** GUaI Code desktop settings and the V2 Skill runtime

## Summary

GUaI Code can discover and execute Skills, but the desktop application has no
place to inspect or manage them. Users cannot see which Skill installation is
currently effective, where it came from, or whether another installation with
the same name is being shadowed. Disabling and deleting a Skill also require
manual filesystem or configuration work.

This change adds a complete Skill management page to desktop settings. It lists
every discovered installation, shows its description and source, allows an
installation to be enabled or disabled at the scope where it was registered,
and permits safe deletion of user-owned local Skills. Creating or installing a
new Skill remains a conversation-driven workflow and is intentionally absent
from this interface.

## Goals

1. Show every Skill installation discovered by the active V2 location.
2. Show the name, description, source type, scope, path or URL, and effective
   state of each installation.
3. Allow an individual installation to be enabled or disabled.
4. Persist project-source state for that project and global-source state
   globally.
5. Make duplicate names understandable by distinguishing the effective and
   shadowed installations.
6. Allow safe, confirmed deletion of user-owned local Skills.
7. Protect built-in, remote, plugin-owned, ambiguous, and unsafe filesystem
   sources from deletion.
8. Ensure runtime Skill discovery and execution immediately respect management
   changes.

## Non-Goals

- Creating, editing, installing, importing, or updating Skills.
- Editing Skill markdown content in the settings dialog.
- Replacing per-Agent Skill permission rules.
- Adding a restore interface for deleted Skills.
- Expanding V2 Skill discovery to locations it does not currently load.
- Managing Skills on a server without a currently selected location.

## Approaches Considered

### A. Independent Skill management state

Store enabled and disabled installation identities separately from Agent tool
permissions. Resolve this state before the runtime deduplicates Skills by name.
This gives every installation one coherent switch state and keeps Agent policy
semantics unchanged. Selected.

### B. Reuse Agent permission rules

Writing `skill` allow and deny rules would require choosing an Agent and would
let the same installation appear enabled for one Agent and disabled for
another. It also cannot represent an individual duplicate installation because
permissions address Skill names. Rejected.

### C. Hide disabled Skills only in the desktop UI

This would not prevent the runtime or model from loading the Skill. Rejected
because it does not satisfy the meaning of disable.

## Runtime Model

### Installed entries and effective Skills

The Skill service will distinguish two views:

- The management view contains every successfully parsed Skill installation,
  including disabled and shadowed entries.
- The execution view filters disabled installations, then preserves the current
  source-order rule in which the last enabled installation with a given name is
  effective.

An enabled installation can therefore have an `active` or `shadowed` state. A
disabled installation has a `disabled` state. Disabling an active project
override can reveal an enabled global installation with the same name; the
management response recomputes both rows so the transition is visible.

### Stable installation identity

Each installation receives an opaque deterministic ID derived from its source
key, parsed Skill name, and canonical Skill file location. The API and UI use
this ID for mutations. Names alone are never mutation identifiers because
duplicate names are valid.

The management state file stores installation IDs in a versioned schema. An
entry that is no longer discovered is ignored. Reinstalling the same Skill at
the same canonical location restores its previous enabled state; moving it to a
new location creates a new installation identity.

### Scope and source metadata

Skill sources will retain enough registration metadata to classify an entry:

| Source                                       | Scope           | Display     | Delete            |
| -------------------------------------------- | --------------- | ----------- | ----------------- |
| Built-in embedded Skill                      | Global          | Built-in    | No                |
| Directory from global config directories     | Global          | Global      | When safely owned |
| Directory from project config directories    | Project         | Project     | When safely owned |
| Path declared by a global config document    | Global          | Custom path | When safely owned |
| Path declared by a project config document   | Project         | Custom path | When safely owned |
| URL declared by global or project config     | Declaring scope | Remote      | No                |
| Source registered without ownership metadata | Inferred scope  | Plugin      | No                |

The configuration Skill plugin supplies authoritative scope and ownership
metadata. For third-party plugin sources that omit metadata, the manager may
infer a display scope from the path, but it must keep deletion disabled.

### Persistence

Management state is machine-local operational state, not repository
configuration. It will be stored beneath `Global.state`:

- `skills/global.json` for global installations;
- `skills/projects/<project-key>.json` for project installations. Git-backed
  locations key state by resolved project ID and project root so worktrees and
  subdirectories share project state. Locations using the shared `global`
  project ID also include the opened directory, keeping unrelated non-Git
  directories isolated even when their resolved project root is the filesystem
  root.

Each file contains a schema version and a set of disabled installation IDs.
Writes use a temporary file followed by replacement so an interrupted write
cannot leave a partially written document. A missing file means all discovered
installations are enabled. Invalid state files produce a logged warning and the
same enabled-by-default behavior rather than preventing Skill discovery.

## API Design

The existing `GET /api/skill` execution response remains unchanged so model and
client consumers do not receive management-only data or Skill content changes.

The Skill protocol adds management endpoints scoped by the existing location
query:

- `GET /api/skill/management` returns all management entries.
- `PATCH /api/skill/management/:id` accepts `{ enabled: boolean }` and returns
  the recomputed management list.
- `DELETE /api/skill/management/:id` moves a deletable local Skill into the
  internal recovery area and returns the recomputed management list.

A management entry contains:

- opaque ID, name, optional description, and Skill file location;
- source type, source value, and project or global scope;
- `active`, `shadowed`, or `disabled` state;
- `enabled` and `deletable` booleans;
- a machine-readable reason when deletion is unavailable.

Management responses omit Skill instruction content. Mutations fail with typed
not-found, protected-source, unsafe-path, and filesystem errors that the server
maps to appropriate HTTP responses without exposing file contents.

## Deletion Safety

Deletion is available only when the runtime can prove ownership and containment
for a local directory source.

- A conventional `<skill>/SKILL.md` installation targets the `<skill>`
  directory.
- A root-level `<name>.md` installation targets only that markdown file.
- The target must be strictly contained by its declared source root; a source
  root itself is never a valid target.
- Canonical paths must remain contained after resolving links. Ambiguous or
  linked targets are not deletable.
- Built-in, URL, plugin-owned, and unknown sources are never deletable.

On supported macOS and Linux architectures, mutation preparation opens and
holds the source-root chain, source entry, and recovery parent by descriptor.
Moves and recovery finalization are descriptor-relative and use the platform's
atomic no-replace rename. The operation rechecks directory-entry identities
before each move and verifies the moved source, staging record, metadata, and
payload identities before state is committed. Runtimes without a successfully
probed no-replace capability report these entries as unsafe and do not offer
deletion.

POSIX does not provide a rename operation that also compares the source inode.
Therefore, a same-permission, non-cooperating process replacing the final source
entry between the last identity check and the rename syscall is outside the hard
security boundary. The implementation detects that race immediately after the
move and performs an uninterruptible no-replace rollback. If the original name
has concurrently become occupied, it never overwrites the new entry and retains
the moved payload in the recovery area while reporting deletion failure. This
model protects against symlink and ancestor redirection, directory replacement,
destination overwrite, and ordinary concurrent mutation without claiming that
the final POSIX syscall window can be eliminated.

The delete operation first moves the target beneath
`Global.state/skills/trash/` and records the original path, installation ID,
and deletion timestamp. The UI does not expose restore in this version, but the
operation remains recoverable from the state directory. If the move cannot be
completed, compensation restores the original Skill when its name remains free.
If an independent process occupies that name, the payload remains in recovery
and the API reports failure rather than overwriting either object.

Every deletion requires a confirmation dialog naming the Skill and showing the
target path. The dialog explains that the item will be removed from GUaI Code
and moved to the recovery area.

## Desktop Interaction Design

### Navigation and context

The V2 settings dialog adds a `Skills` tab in the server section. The page is
available only when the current route resolves to a location. When settings are
opened without a project location, the page shows a concise prompt to open a
project instead of silently presenting an incomplete global-only view.

There is no add or create button.

### Header and filtering

The sticky header contains the page title, the number of discovered
installations, and a search field when more than one installation is present.
Search matches name, description, source path, and URL. A compact status filter
supports All, Active, Disabled, and Shadowed without changing the list layout.

### Skill rows

Each row uses the existing dense settings-list treatment and contains:

- name and description;
- source and scope tags;
- a selectable path or URL line with full text in its accessible label;
- a status label for active, disabled, or shadowed;
- an enable switch;
- a delete icon action only when `deletable` is true.

Unavailable deletion is explained in the source/status copy rather than shown
as a permanently disabled trash button. Long names, descriptions, and paths
wrap or truncate within stable row tracks and never resize the action controls.

Empty states distinguish no installed Skills from no search or filter matches.
Loading keeps the header stable, and mutations disable only the affected row.

### Mutation behavior

Switches are pessimistic: the visible state changes only after the server
confirms persistence and returns the recomputed list. This prevents the UI from
showing a disabled Skill that the runtime still exposes. A failed operation
restores the usable control and displays a localized toast.

After a successful mutation, the query cache receives the returned list. The
next model turn and Skill tool invocation read the updated execution view.

## Error Handling

- Location loss while the dialog is open replaces the list with the location
  requirement state and prevents mutations.
- A mutation for an installation that disappeared returns not found and
  refreshes the management query.
- A protected or unsafe deletion never touches the filesystem.
- A failed state write leaves the previous enabled state intact.
- A failed recovery move leaves the original Skill intact.
- Unreadable or malformed Skill files continue to be omitted from discovery,
  matching current runtime behavior.
- Remote discovery failures do not create phantom management rows.

## Component Boundaries

- `schema/skill` owns source-management metadata and management response/error
  schemas.
- `core/skill` owns installed-entry loading, identity, state resolution,
  deduplication, persistence, mutation, and deletion safety.
- The configuration Skill plugin supplies authoritative origin, scope, and
  ownership metadata without changing configuration precedence.
- `protocol/groups/skill` and `server/handlers/skill` expose location-scoped
  management operations.
- `app/components/settings-v2/skills` owns querying, filtering, rows,
  confirmation, and mutation feedback.
- `dialog-settings-v2` only owns tab registration and current-location routing.

## Testing

### Core

- Lists built-in, project, global, custom-path, URL, and plugin-owned entries
  with correct metadata.
- Produces stable IDs and retains duplicate-name installations.
- Computes active and shadowed state with existing source precedence.
- Disabling and enabling an installation updates the execution view.
- Project state does not affect another project; global state is shared.
- Missing and malformed management state default to enabled.
- Deletion accepts safe Skill directories and root markdown files, writes
  recovery metadata, and rejects source roots, escaped paths, links, built-ins,
  URLs, and plugin-owned sources.

### Protocol and server

- Management list omits Skill content.
- Patch and delete route through the selected location.
- Typed errors map to stable HTTP responses.
- The existing Skill list contract remains unchanged.
- Generated clients expose all three management methods.

### Desktop

- The settings tab receives the active project directory.
- Loading, installed, no-Skill, and no-match states render correctly.
- Search covers name, description, path, and URL.
- Status filters and duplicate indicators are correct.
- Switches remain unchanged while pending and reflect the returned list.
- Protected entries have no delete action.
- Delete confirmation shows the exact name and target path.
- Mutation errors produce localized feedback and restore row controls.
- English, Simplified Chinese, and Traditional Chinese dictionaries remain in
  parity.

### Runtime and visual verification

- Disable an active project Skill and confirm it disappears from the execution
  list or reveals an enabled global duplicate.
- Re-enable it and confirm it becomes effective again.
- Delete a temporary local Skill and confirm it leaves the installed list and
  appears in the recovery directory.
- Confirm built-in and remote Skills cannot be deleted.
- Inspect the settings page at standard desktop and compact window sizes in
  light and dark themes, checking long paths, long descriptions, scrolling,
  focus order, and non-overlapping controls.

## Acceptance Criteria

1. The desktop settings dialog contains a complete `Skills` management tab for
   the active project location.
2. Every discovered installation shows its name, description, source, scope,
   location, status, and enabled state.
3. Duplicate names remain visible and identify the effective installation.
4. Disabling an installation prevents that installation from being presented
   to or loaded by the runtime.
5. Project and global management state persist independently across restarts.
6. Re-enabling an installation restores it without modifying Agent permission
   rules.
7. Safe user-owned local Skills can be deleted after confirmation and are moved
   to the recovery area.
8. Built-in, remote, plugin-owned, ambiguous, and unsafe targets cannot be
   deleted.
9. Creating a new Skill is not offered in the management UI.
10. Existing Skill list consumers and per-Agent Skill permissions continue to
    work.
11. Protocol generation, package type checks, focused tests, and desktop visual
    verification pass.
