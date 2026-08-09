# Unified Skill Management Design

## Goal

Make the Skills settings page describe the same Skill installations that GUaI
Code presents to the model. Global Skills must remain visible when settings are
opened from Home. Skills discovered through shared compatibility directories
may be enabled or disabled in GUaI Code, but GUaI Code must not delete their
files.

## Decisions

- `SkillV2` remains the authoritative registry for V2 execution and management.
- The configuration Skill plugin registers the compatibility directories that
  the legacy runtime already discovers: `.agents/skills` and, unless disabled,
  `.claude/skills`, both globally and between the active directory and project
  root.
- Shared compatibility directories have an explicit source origin. They are
  not treated as plugin-owned or GUaI-owned configuration directories.
- If the same directory is also declared in configuration, its shared origin
  remains authoritative for deletion safety.
- Opening Skills settings without a project uses the server's global config
  directory as the location context. The config service already treats that
  location as global-only, so project sources are not mixed into the list.
- The management and execution paths wait until the built-in and configuration
  Skill registrations are ready before reading the registry.

## Discovery And Precedence

Sources are registered in the existing runtime order:

1. Built-in Skill sources.
2. Global `.claude/skills`, when Claude-compatible discovery is enabled.
3. Global `.agents/skills`.
4. Project `.claude/skills` and `.agents/skills` found while walking toward the
   project root.
5. Global and project `.opencode/skill` and `.opencode/skills` directories.
6. Paths and URLs declared by configuration.
7. Skill sources contributed by plugins.

The existing last-enabled-installation-wins rule continues to determine which
duplicate name is active. Management retains every installation.

The existing environment controls continue to apply:

- `OPENCODE_DISABLE_EXTERNAL_SKILLS` disables both compatibility families.
- `OPENCODE_DISABLE_CLAUDE_CODE` and
  `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` disable only `.claude` Skill discovery.

## Management Model

The public Skill schemas gain:

- an `external` source origin for shared compatibility directories;
- an `external` management source type for display and filtering;
- a `shared` deletion-block reason.

Shared entries use the normal global or project enable state file. Disabling a
shared Skill therefore affects GUaI Code only and never edits `SKILL.md` or its
directory.

Deletion projection and deletion execution both reject a shared source with a
typed protected-source result. This remains true if a user also declares the
same directory in GUaI configuration.

## Desktop Behavior

When a project or session is active, Skills settings use that directory and
show global plus project installations.

When settings are opened from Home, the dialog uses the server path response's
global config directory. The header count and filters then describe global
installations instead of displaying a synthetic zero or asking the user to
open a project.

Shared entries show a shared-source label, their exact path, global or project
scope, status, and enable switch. They do not show a delete action, and the
explanatory copy says the source is shared with other agent applications.

## Error Handling

- Missing compatibility directories simply contribute no installations.
- Discovery failures retain the existing empty-source behavior and do not
  prevent other Skill sources from loading.
- A missing global config path keeps the existing location-required fallback;
  once server path synchronization completes, the query starts reactively.
- Attempting deletion through the API returns the existing forbidden response
  with reason `shared` and does not touch the filesystem.

## Verification

- Configuration plugin tests cover global and project `.agents` and `.claude`
  sources and their ordering.
- Core tests prove shared source projection, GUaI-only disable persistence,
  duplicate precedence, and deletion protection.
- Protocol/client generation includes the new enum members.
- App tests cover source and protected-reason labels plus Home's global context.
- Real desktop verification confirms `agent-browser` appears from Home, has no
  delete action, can be disabled and re-enabled, and remains on disk.
