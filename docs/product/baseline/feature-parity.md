# Feature-Parity Baseline

Phase 1-3 may simplify presentation but must not remove these capabilities.

## Phase 1 Foundation Status

| Boundary | Status | Evidence |
| --- | --- | --- |
| Composer execution | Preserved | Create, prompt, command, shell, and interrupt route through the product task adapter |
| OpenCode API compatibility | Locked | Typed `CompatibleApi` fixtures and native/SDK event fixtures pass |
| Timeline inputs | Preserved | Lifecycle, text, reasoning, tool, shell, command, permission, question, file, error, and server events normalize safely |
| Desktop lifecycle | Improved | Sanitized state, bounded restart, manual restart, graceful stop, and renderer-scoped subscriptions pass |
| Product isolation | Improved | Development app data, protocol, package identity, and future credential namespace no longer target OpenCode release identities |
| Advanced capabilities | Preserved | `PRODUCT_FEATURES` asserts the complete Phase 0 capability set without claiming unfinished product features |
| Upstream runtime | Unchanged | Core, OpenCode, Server, and Protocol have no diff from `v1.18.10` |

Phase 1 changes ownership boundaries and recovery behavior, not feature
availability. The existing settings, provider, agent, MCP, permission, terminal,
review, and file workflows remain available for Phase 2-3 presentation work.

## Phase 2 Model Center Status

| Boundary | Status | Evidence |
| --- | --- | --- |
| Cloud providers | Preserved | Existing OpenCode provider management remains available and a packaged Big Pickle task completed |
| Visual provider profiles | Implemented | Private OpenAI-compatible, Ollama, LM Studio, and custom-local setup paths are available under Models settings |
| Credential storage | Implemented on macOS | `safeStorage` ciphertext is backed by the login Keychain; renderer reads never return secret values |
| Private runtime credentials | Improved | A main-process loopback proxy injects credentials upstream, so sidecar config and Chromium persistence receive only a random proxy token |
| Local discovery | Implemented | Bounded Ollama and LM Studio detection reports availability and discovered models; manual model entry remains available |
| Capability testing | Implemented | Basic chat, streaming, and tool behavior classify agent-capable, partial, chat-only, and incompatible models |
| Default selection | Implemented | Tested profiles can become the default and survive packaged-app restart |
| Windows credentials | Deferred | Interfaces are platform-neutral, but the Windows credential backend is not claimed in Phase 2 |

| Capability | Upstream owner | Phase 0 evidence | Phase 3 requirement |
| --- | --- | --- | --- |
| Built-in cloud providers | Provider catalog, runtime, and App settings | Catalog exposes 75+ providers in the running App | Preserve under Models settings |
| Custom providers and base URL | `dialog-custom-provider.tsx`, provider config/runtime | Form supports ID, name, URL, key/env reference, headers, and model IDs | Guided profile flow must retain all advanced fields |
| Local models | OpenAI-compatible custom provider | Ollama/LM Studio endpoints and model IDs can be entered manually | Add dedicated Ollama and LM Studio profiles and detection |
| Model selection and variants | Models context and prompt input | Composer model picker loads and changes active selection | Keep a compact composer selector |
| Sessions and history | Server session APIs and App stores | Home exposes create, search, open, archive, and resume paths | Present sessions as tasks in the sidebar |
| Streaming messages and tools | SDK event stream and Session UI | Timeline components cover assistant and tool parts | Normalize into a Codex-style activity timeline |
| Permissions | Permission runtime, API, and session dock | Once/always/deny and auto-accept controls exist | Keep explicit approval cards and policy settings |
| File tree and content | File contexts, tabs, side panel | Project files can be browsed and previewed | Keep in a context drawer |
| Diff review | Session review panel and file UI | Unified/split diffs, changed-file filtering, and line comments exist | Add task-level review without removing upstream diff |
| Integrated terminal | Terminal context/component and PTY routes | Multi-tab PTY accepts input and restores state | Keep separate from agent shell execution |
| Agents | Agent runtime, selector, config | Built-in and custom agents are selectable; `@agent` invokes subagents | Simple default with complete Advanced access |
| MCP | MCP runtime and selector | Status, tools, resources, prompts, OAuth, and enable/disable exist | Preserve and add visual management in Advanced settings |
| Skills and commands | Skill discovery/tool and command palette | Configured skills and commands remain callable | Preserve in Advanced mode and composer commands |
| Attachments | Prompt input attachment modules | Files and images attach to prompts | Preserve with duplicate prevention |
| Tabs and multiple tasks | Layout and tab contexts | Multiple sessions/new-session tabs remain open | Map clearly to task navigation |
| Localization | App and Desktop i18n modules | English and Simplified Chinese catalogs load | Add product copy to both catalogs |
| Diagnostics and recovery | Desktop logging, status, sidecar lifecycle | Logs, server health, revert, and restore paths exist | Add actionable product error mapping |
| Multiple servers | Server context and settings | Local sidecar, HTTP, and WSL connections are implemented; SSH is only a reserved type with no host or settings implementation | Keep implemented remote support in Advanced mode; do not claim SSH until it is built and tested |

## Provider Baseline

The custom provider path continues to use `@ai-sdk/openai-compatible`. Phase 2
adds provider-specific Ollama/LM Studio onboarding, automatic local discovery,
manual model fallback, behavioral capability tests, encrypted macOS credentials,
and visual default selection. Private credentials cross into model requests only
through the product-owned main-process proxy. The visual flow is available on
the V1 sidecar protocol, which remains the desktop default in this release.

## Advanced Feature Baseline

| Feature | Runtime capability | Current visual coverage |
| --- | --- | --- |
| Agents | Build, Plan, General, Explore, custom prompt/model/tools/permissions | Select and invoke; no visual CRUD |
| MCP | Local command, remote URL, headers, OAuth, tools/resources/prompts | Inspect status and enable/disable; no add/edit form |
| Skills | Local standard directories, custom paths, remote discovery | Callable by the agent; no dedicated manager |
| Permissions | Tool/path `ask`, `allow`, `deny`, per-agent rules | Session decisions and auto-accept; no full rule editor |
| Terminal | Native PTY, WebSocket, multi-tab terminal | Complete |
| Diff/Review | Git changes, snapshots, unified/split diff, line comments | Complete for local code review |
| Revert/Restore | Message-scoped file rollback and restoration | Complete |
