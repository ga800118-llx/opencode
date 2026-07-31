# Feature-Parity Baseline

Phase 1-3 may simplify presentation but must not remove these capabilities.

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

The custom provider path uses `@ai-sdk/openai-compatible`. It already supports
private OpenAI-compatible services and local endpoints such as
`http://localhost:11434/v1`. It does not currently provide provider-specific
Ollama/LM Studio onboarding, automatic discovery, or a connection-test workflow.
The visual custom-provider flow is available on the V1 sidecar protocol, which is
the desktop default in this release.

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
