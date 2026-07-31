# Source Ownership Map

| Area | Authoritative paths | Product policy |
| --- | --- | --- |
| Electron host | `packages/desktop/src/main`, `packages/desktop/src/preload` | Extend through typed IPC and platform services. |
| Desktop renderer entry | `packages/desktop/src/renderer` | Keep thin; shared product UI belongs in App. |
| Shared desktop/web UI | `packages/app/src` | Primary location for model center and workflow changes. |
| UI primitives | `packages/ui/src` | Reuse before adding product-specific primitives. |
| Session rendering | `packages/session-ui/src` | Preserve message and tool rendering contracts. |
| SDK | `packages/sdk/js/src`, `packages/client/src` | Use public/generated clients; do not hand-edit generated code. |
| Protocol and schema | `packages/protocol/src`, `packages/schema/src` | Change only for a required public contract. |
| Server transport | `packages/server/src`, `packages/opencode/src/server` | Keep API and transport behavior upstream-compatible. |
| Agent runtime | `packages/core/src`, `packages/opencode/src` | Avoid product-specific changes; require focused tests for any patch. |
| Providers and models | `packages/opencode/src/provider`, `packages/core/src/v1/config` | Preserve the provider catalog; adapt visual configuration above it. |
| MCP, skills, agents, permissions | `packages/opencode/src/mcp`, `packages/opencode/src/skill`, `packages/opencode/src/agent`, `packages/opencode/src/permission` | Preserve and expose in Advanced mode. |
| Product documentation | `docs/product` | Owned by this fork. |

## Desktop Feature Owners

| User-visible capability | Main implementation paths |
| --- | --- |
| Windows, menus, deep links, updater, notifications | `packages/desktop/src/main/index.ts`, `windows.ts`, `menu.ts`, `updater.ts` |
| Local sidecar lifecycle and health | `packages/desktop/src/main/server.ts`, `sidecar.ts`, `initialization.ts` |
| Native file/directory pickers and shell integration | `packages/desktop/src/main/ipc.ts`, `packages/desktop/src/preload/index.ts` |
| Project and recent-session home | `packages/app/src/pages/home` |
| New session, workspace, and Git branch selection | `packages/app/src/pages/new-session`, `packages/app/src/pages/session/composer` |
| Timeline, tools, files, terminal, and review | `packages/app/src/pages/session`, `packages/app/src/context/terminal.tsx` |
| Provider and model settings | `packages/app/src/components/settings-v2`, `packages/app/src/context/models.tsx` |
| Multi-server and remote server support | `packages/app/src/context/server.tsx`, `packages/app/src/components/settings-v2/servers.tsx` |
| Windows WSL support | `packages/desktop/src/main/wsl`, `packages/app/src/wsl` |

## Thin-Fork Boundary

Product-owned changes may include desktop identity and packaging, icons and
wordmarks, product copy, the home/new-session workflow, guided model profiles,
and Simple/Advanced presentation state. The primary product surfaces are:

- `packages/desktop/package.json` and `packages/desktop/electron-builder.config.ts`
- `packages/desktop/icons`, `packages/desktop/resources`, and desktop renderer copy
- `packages/ui/src/components/logo.tsx` and `packages/ui/src/v2/components/wordmark-v2.tsx`
- `packages/app/src/pages/home`, `packages/app/src/pages/new-session`
- `packages/app/src/components/settings-v2` and `packages/app/src/i18n`

Runtime session, provider, tool, agent, MCP, permission, and server modules remain
upstream-owned. `packages/app/src/context`, `packages/app/src/app.tsx`, and
`packages/desktop/src/renderer/index.tsx` are integration boundaries and should
receive small adapters rather than product logic.

## Structural Risks

- Legacy and V2 layout/component implementations coexist. Product work must target
  the active V2 path without removing legacy compatibility prematurely.
- The runtime is more capable than the current visual management UI for agents,
  MCP, skills, and permission rules.
- Existing MCP authentication support and some older translated copy are not fully
  aligned.
