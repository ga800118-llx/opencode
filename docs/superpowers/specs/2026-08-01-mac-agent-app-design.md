# Mac Agent App Phase 0-3 Design

**Status:** Written design awaiting final user review

**Date:** 2026-08-01

## 1. Product Definition

This project builds a simple, Codex-style desktop coding agent on top of OpenCode. The first development target is macOS. The product keeps OpenCode's agent capabilities while making model setup and the primary coding workflow easier for users who do not want to edit configuration files.

The implementation uses a thin fork: OpenCode Core, Server, SDK, provider support, tools, agents, permissions, MCP, skills, LSP, sessions, diff, and terminal capabilities remain available. Product-specific behavior is introduced through a bounded adapter layer and incremental desktop UI changes rather than a rewrite of the agent runtime.

The target for the current goal is completion through Phase 3. A signed Mac beta, Windows distribution, public release hardening, and final branding are outside this goal.

## 2. Confirmed Requirements

1. Support standard cloud model providers already supported by OpenCode.
2. Support enterprise and private OpenAI-compatible endpoints, including gateways and self-hosted inference servers.
3. Support local model servers, initially Ollama and LM Studio, plus a custom local OpenAI-compatible URL.
4. Provide visual model configuration, connection testing, model discovery, and default-model selection.
5. Make the default experience simple and close to Codex's task-oriented workflow.
6. Preserve advanced OpenCode functionality instead of deleting it; expose it through an Advanced mode.
7. Keep OpenCode Core changes minimal and auditable so upstream releases can be integrated.
8. Develop on macOS now while maintaining desktop-host interfaces that can later receive Windows implementations.
9. Keep user terminal processes separate from agent tool execution and permission decisions.
10. Store secrets outside renderer-accessible configuration and redact them from diagnostics.

## 3. Scope

### 3.1 Included

- Phase 0: pin, build, audit, and baseline a stable OpenCode release.
- Phase 1: establish the thin-fork boundary, product adapter, process lifecycle, and compatibility tests.
- Phase 2: implement the visual model center for cloud, private, and local models.
- Phase 3: implement the Codex-style desktop workflow and retain access to advanced OpenCode capabilities.
- Development builds and automated test artifacts required to verify Phases 0-3.

### 3.2 Deferred

- Phase 4 signed and notarized Mac beta distribution.
- Windows packaging, native Windows shell behavior, and optional WSL integration.
- Public commercial release operations, telemetry policy, support operations, and release SLAs.
- Final product name, logo, icon, visual identity, marketing pages, and store materials.
- Cloud-hosted task execution, account billing, team collaboration, and proprietary model hosting.

Development builds use an isolated non-release application identity and data directory so they do not modify an existing OpenCode installation. A migration to the final identity will be designed before Phase 4.

## 4. Chosen Approach

Three approaches were considered:

1. Rebuild a desktop client around a new agent runtime. This offers maximum control but duplicates mature provider, tool, session, and permission work.
2. Heavily fork and reshape OpenCode across Core and Desktop. This moves quickly initially but makes upstream synchronization expensive and risks regressions.
3. Thin-fork OpenCode and add a product adapter plus incremental UI changes. This preserves capabilities, reduces runtime risk, and keeps the product differentiable at the model-setup and workflow layers.

Approach 3 is selected.

## 5. Architecture

```text
Desktop UI
  -> Electron Desktop Host
    -> Product Adapter
      -> OpenCode SDK / generated API client
        -> Local OpenCode Server / Agent Core
          -> Shell, Git, LSP, MCP, Skills, and provider integrations

Desktop Host
  -> Credential Service
  -> Configuration Service
  -> Process and Terminal Service
  -> Desktop Platform Service
```

### 5.1 OpenCode Core and Server

OpenCode remains the authoritative agent runtime. It owns sessions, message streaming, tool execution, permission requests, provider invocation, and existing extension systems. Core changes are allowed only when the required behavior cannot be implemented through a documented public boundary. Every Core patch must have a focused compatibility test and a short rationale.

### 5.2 Product Adapter

The adapter is the stable boundary between product UI and OpenCode. It normalizes server startup, SDK calls, event streams, provider configuration, errors, and feature availability. The UI must not import undocumented Core internals directly.

The adapter exposes product-level operations such as:

- open a project and list its tasks;
- create, resume, stop, and retry a task;
- subscribe to normalized timeline events;
- approve or deny a tool request;
- read and apply diff actions;
- list, validate, and select model profiles;
- report which advanced OpenCode features are available.

### 5.3 Electron Desktop Host

The host owns privileged operating-system access. Renderer code communicates through typed, allow-listed IPC methods. The host starts and monitors the local OpenCode server, allocates its port, shuts it down cleanly, and provides crash recovery.

Credential, filesystem, terminal, update, and platform functions are represented by interfaces. Phase 0-3 implements macOS behavior; later Windows work supplies alternate implementations without changing product UI contracts.

### 5.4 Desktop UI

The existing OpenCode desktop application is the starting point. UI changes are incremental and verified against a capability matrix. The UI has Simple and Advanced modes, but both use the same runtime and stored sessions.

## 6. Model Configuration Design

### 6.1 Provider Profiles

A provider profile contains non-secret configuration only:

- stable profile ID and display name;
- provider kind: built-in cloud, OpenAI-compatible private, Ollama, LM Studio, or custom local;
- base URL and optional non-secret request settings;
- secret reference, never the secret value;
- discovered or manually configured models;
- selected default model;
- capability-test result and last-tested timestamp.

API keys and sensitive headers are stored through a credential-service interface backed by macOS Keychain. Renderer processes receive only masked values and secret-presence status.

### 6.2 Setup Flow

1. The user chooses a provider type.
2. The form shows only fields required for that provider.
3. The desktop host validates and stores credentials.
4. The adapter probes the endpoint and attempts model discovery.
5. The user selects a model or enters a model ID manually.
6. A capability test checks authentication, streaming, structured tool calls, and a small agent operation.
7. The profile is classified as agent-capable, partially compatible, or chat-only.
8. Successful configuration becomes selectable from the task composer.

Advanced settings include custom headers, proxy, TLS behavior, timeout, context limit, output limit, and model-specific options. Unsafe TLS relaxation is visibly marked and disabled by default.

### 6.3 Error Handling

Low-level errors are mapped to actionable categories: unreachable endpoint, authentication failure, incompatible API, missing model, streaming failure, tool-calling failure, timeout, TLS failure, and server crash. Diagnostics contain a request ID and redacted technical details. Raw secrets, authorization headers, prompts, and source code are excluded from default logs.

## 7. Desktop Experience Design

The product borrows task-oriented interaction patterns from Codex without copying OpenAI branding or reproducing the interface pixel for pixel.

### 7.1 Information Architecture

- Left sidebar: projects, task history, task status, search, and new-task action.
- Main timeline: user messages, assistant output, reasoning status, tool activity, command output, approvals, and errors.
- Composer: prompt, attachments, model selector, agent/mode selector, and send/stop control.
- Context drawer: file changes, diff review, terminal, logs, and task context.
- Settings: Models first, followed by Agents, MCP, Skills, Permissions, General, and Advanced diagnostics.

### 7.2 Primary Workflow

1. Open a local project.
2. Select or accept the default model.
3. Enter a task.
4. Follow streamed progress in one ordered timeline.
5. Approve sensitive commands or file operations according to the active permission policy.
6. Inspect changed files and diffs without leaving the task.
7. Continue, stop, retry, or resume the task after application restart.

### 7.3 Simple and Advanced Modes

Simple mode is the default. It shows the controls required for normal coding tasks and uses conservative permission defaults. Advanced mode exposes custom agents, MCP servers, skills, detailed permissions, provider options, raw diagnostics, and other OpenCode capabilities covered by the baseline matrix.

Advanced mode does not activate a different runtime and Simple mode does not delete or migrate advanced configuration. Switching modes changes presentation only.

### 7.4 Terminal and Agent Execution

The visible user terminal is a separate PTY session. Agent shell commands run through OpenCode's tool and permission pipeline. Environment variables, current directories, cancellation, and process ownership are explicit for each process type. Closing a terminal cannot silently terminate an unrelated agent task, and stopping an agent task cannot kill the user's terminal.

## 8. Phase Deliverables and Gates

### 8.1 Phase 0: Stable Baseline

Deliverables:

- pinned OpenCode stable tag and commit SHA;
- reproducible dependency installation, development launch, test, and desktop build commands;
- source and package ownership map;
- feature-parity matrix covering Core and Desktop capabilities;
- license and third-party notice review;
- baseline performance and smoke-test results;
- list of required product changes grouped by package boundary.

Gate: the unmodified pinned source builds and runs locally, its relevant tests pass or every existing failure is documented, and the implementation can be planned against exact source paths.

### 8.2 Phase 1: Thin-Fork Foundation

Deliverables:

- upstream synchronization and branch policy;
- product adapter and typed contracts;
- local server lifecycle management and health reporting;
- isolated development configuration and credential namespaces;
- desktop platform interfaces;
- OpenCode API/event compatibility tests;
- CI for lint, type checking, unit tests, contract tests, and desktop smoke tests.

Gate: the desktop application completes an unchanged OpenCode task through the adapter, handles server restart, and passes the baseline capability checks without direct UI-to-Core coupling.

### 8.3 Phase 2: Visual Model Center

Deliverables:

- provider-profile storage and migration;
- visual create, edit, delete, test, and default-selection flows;
- macOS Keychain integration;
- cloud provider selection using preserved OpenCode support;
- OpenAI-compatible private endpoint support;
- Ollama and LM Studio detection plus custom local URL support;
- model discovery and manual model entry;
- capability test and actionable diagnostics;
- unit, contract, integration, and desktop end-to-end tests.

Gate: a new user can configure each of the three required model categories without editing JSON and can execute a real agent task with a compatible model.

### 8.4 Phase 3: Codex-Style Workflow

Deliverables:

- project and task navigation;
- task composer with model and execution controls;
- normalized streaming activity timeline;
- permission approval flow;
- file-change and diff review flow;
- separate integrated user terminal;
- task stop, retry, resume, and crash recovery;
- Simple and Advanced modes;
- preserved access to the feature-parity matrix;
- polished loading, empty, offline, incompatible-model, and server-crash states;
- English fallback and Simplified Chinese product copy where the product layer adds text.

Gate: the complete primary workflow runs in the desktop app, all Phase 0 capabilities remain available or are explicitly mapped to Advanced mode, and automated regression plus manual end-to-end acceptance passes.

## 9. Testing Strategy

### 9.1 Unit Tests

Cover provider-profile validation, configuration serialization, error mapping, event normalization, permission-state transitions, and platform-interface behavior.

### 9.2 Contract Tests

Record the OpenCode SDK/API shapes and streamed event variants consumed by the adapter. Tests fail when an upstream update removes or changes a required contract.

### 9.3 Integration Tests

Use deterministic mock OpenAI-compatible servers to exercise authentication, model listing, streaming, malformed responses, tool calls, timeouts, and connection failures. Test local-provider detection independently from installed Ollama or LM Studio.

### 9.4 Desktop End-to-End Tests

Cover opening a project, configuring a model, starting a task, approving a command, observing file changes, reviewing a diff, using the terminal, restarting the app, and resuming the task. Tests verify that secrets are unavailable to renderer logs and UI state.

### 9.5 Manual Acceptance

Run at least one compatible cloud model, one private OpenAI-compatible endpoint, and one local provider. Compare the feature-parity matrix against the pinned upstream desktop build. Exercise server crash recovery and long-running task cancellation.

## 10. Quality Constraints

- No product feature may require editing OpenCode Core unless the adapter boundary is demonstrably insufficient.
- No secret may be stored in renderer persistence or printed in logs.
- UI event rendering should begin within 200 ms of the adapter receiving an event under normal local load.
- Startup and task execution must not regress more than 20 percent from the pinned upstream baseline without a documented reason.
- The desktop app must recover persisted tasks after a normal restart.
- Accessibility names, keyboard navigation, focus states, and text overflow are required for all new controls.
- Each phase must end with a runnable application and passing gates; incomplete cross-phase work remains behind disabled development flags.

## 11. Upstream Maintenance

The project pins one upstream version per milestone. Upstream changes are reviewed and integrated between milestones, not continuously during active feature work. Each integration runs contract tests, the feature-parity suite, model-center tests, and the primary desktop workflow.

Core patches are maintained as a small, documented series. A patch that is generally useful should be proposed upstream. Product-specific changes remain in the adapter or desktop product layer.

## 12. Risks and Controls

- **Rapid upstream change:** pin exact commits and update only at planned checkpoints.
- **Feature loss during UI simplification:** maintain a parity matrix and Advanced mode regression tests.
- **Private-model incompatibility:** run capability tests instead of treating a successful HTTP connection as agent compatibility.
- **Credential exposure:** isolate privileged access in the desktop host and use Keychain references.
- **Desktop process instability:** add explicit ownership, health checks, cancellation, and recovery for server and PTY processes.
- **Future Windows rework:** keep OS functions behind interfaces while avoiding untested Windows-specific implementation in the current goal.
- **Brand and license confusion:** retain required notices and avoid using Codex or OpenCode names as the final product identity.

## 13. Implementation Decomposition

After this design is approved, implementation is split into four source-aware plans:

1. OpenCode baseline and repository integration plan.
2. Thin-fork adapter and desktop-host foundation plan.
3. Visual model-center plan.
4. Codex-style desktop workflow plan.

Each plan is written only after its dependency phase exposes the actual source paths and contracts. Plans contain exact files, tests, commands, expected results, and commit checkpoints.

## 14. Completion Definition

The goal is complete only when all Phase 0-3 gates are proven against the current worktree and a running desktop build. Documentation, mockups, or isolated component tests alone do not prove completion. Phase 3 evidence must include automated test results, the feature-parity audit, and a manual end-to-end run using cloud, private, and local model paths.
