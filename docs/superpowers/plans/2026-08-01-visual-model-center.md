# Visual Model Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a desktop user configure preserved cloud providers, private OpenAI-compatible endpoints, Ollama, LM Studio, and custom local endpoints visually, keep secrets out of renderer persistence, test model capabilities, and select a working default model without editing JSON.

**Architecture:** Keep OpenCode Core and its provider runtime unchanged. Product-owned profile contracts and OpenCode configuration serialization live in the App package; privileged profile persistence, encrypted credentials, endpoint probing, local detection, and credential-to-sidecar environment injection live in the Electron main process behind typed IPC. The default Models settings page composes the new desktop model center with the existing OpenCode cloud-provider and model-visibility surfaces.

**Tech Stack:** Bun 1.3.14, TypeScript, SolidJS, Electron 42 `safeStorage` backed by macOS Keychain, `electron-store`, Node `fetch`, OpenCode public global-config/provider APIs, Bun test, Agent Browser, axe-core.

---

## Write Boundaries

Preferred Phase 2 writes:

- `packages/app/src/product/model-center/**`
- `packages/app/src/components/settings-v2/**`
- `packages/app/src/i18n/en.ts` and `packages/app/src/i18n/zh.ts`
- `packages/desktop/src/product/**`
- `packages/desktop/src/main/model-center/**`
- narrow Desktop main, preload, renderer, store-key, and sidecar-environment wiring
- `.github/workflows/product.yml`
- `docs/product/phase-2/**`

Forbidden without a written exception and a focused compatibility test:

- `packages/core/**`
- `packages/opencode/**`
- `packages/server/**`
- `packages/protocol/**`
- generated SDK clients

## Security Invariants

1. A renderer may send a newly typed secret to an allow-listed save or probe operation, but no read, list, test, diagnostic, event, or error response may return a raw secret.
2. Profile storage contains only non-secret fields, stable credential references, secret-presence flags, and sensitive-header names.
3. Credential storage contains only `safeStorage` ciphertext. On macOS, operations are enabled only after `safeStorage.isEncryptionAvailable()` confirms Keychain availability.
4. OpenCode global config contains `{env:VARIABLE_NAME}` references, never raw API keys or sensitive header values.
5. The main process decrypts credentials only while probing or constructing the environment for a supervised sidecar spawn. Secret values are never assigned to the parent process environment and never logged.
6. Deleting a profile deletes its encrypted credential envelope, disables its OpenCode provider ID, and removes it from the product model list.

## Phase Gate

Phase 2 is complete only when:

1. cloud-provider connection remains available through the preserved OpenCode flow;
2. private OpenAI-compatible, Ollama/LM Studio, and custom local profiles can be created, edited, tested, selected as default, and deleted visually;
3. model discovery has a manual-model fallback;
4. capability testing distinguishes agent-capable, partially compatible, chat-only, and incompatible models with actionable redacted diagnostics;
5. no plaintext secret appears in renderer state, renderer persistence, profile storage, logs, or OpenCode config;
6. a packaged macOS build executes a task through one cloud, one deterministic private OpenAI-compatible, and one local-provider path, with unavailable real services documented rather than simulated as successful;
7. lint, type checks, unit, contract, integration, Desktop, build, package, accessibility, and protected-runtime checks pass;
8. `git diff --exit-code v1.18.10...HEAD -- packages/core packages/opencode packages/server packages/protocol` remains empty.

### Task 1: Define Renderer-Safe Model-Center Contracts

**Files:**

- Create: `packages/app/src/product/model-center/contracts.ts`
- Create: `packages/app/src/product/model-center/contracts.test.ts`
- Create: `packages/app/src/product/model-center/config.ts`
- Create: `packages/app/src/product/model-center/config.test.ts`
- Create: `packages/app/src/product/model-center/index.ts`
- Modify: `packages/app/src/product/context.tsx`
- Modify: `packages/app/src/product/context.test.tsx`
- Modify: `packages/app/src/index.ts`
- Modify: `packages/app/package.json`

- [x] **Step 1: Write contract and validation tests**

Cover the exact provider kinds and classifications:

```ts
type ProductProviderKind = "openai-compatible" | "ollama" | "lm-studio" | "custom-local"
type ProductModelClassification = "agent-capable" | "partially-compatible" | "chat-only" | "incompatible"
```

Assert trimmed names, normalized HTTP(S) URLs, unique model IDs, positive timeout/context/output limits, safe header names, `allowInsecureTls === false`, and rejection of loopback-only kinds pointed at non-loopback hosts. Assert serialized values and thrown validation errors never contain `apiKey` or sensitive-header values.

- [x] **Step 2: Run the contract tests and confirm the red state**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/app
bun test --conditions=solid --preload ./happydom.ts ./src/product/model-center
```

Expected: FAIL because the model-center modules do not exist.

- [x] **Step 3: Implement the public contract**

Define immutable renderer-safe outputs and write-only secret inputs:

```ts
export type ProductProviderProfile = {
  readonly id: string
  readonly providerID: string
  readonly name: string
  readonly kind: ProductProviderKind
  readonly baseURL: string
  readonly credentialRef?: string
  readonly hasApiKey: boolean
  readonly headers: readonly ProductProviderHeader[]
  readonly models: readonly ProductProviderModel[]
  readonly defaultModelID?: string
  readonly settings: ProductProviderSettings
  readonly test?: ProductCapabilityReport
  readonly createdAt: number
  readonly updatedAt: number
}

export type ProductModelCenterAPI = {
  capabilities(): Promise<ProductModelCenterCapabilities>
  list(): Promise<readonly ProductProviderProfile[]>
  save(input: ProductProviderProfileInput): Promise<ProductProviderProfile>
  remove(profileID: string): Promise<void>
  discover(input: ProductProviderProbeInput): Promise<ProductModelDiscoveryResult>
  test(input: ProductProviderTestInput): Promise<ProductCapabilityReport>
  detectLocal(): Promise<readonly ProductLocalProviderCandidate[]>
  selectDefault(input: ProductDefaultModelInput): Promise<ProductProviderProfile>
  reloadCredentials(): Promise<void>
}
```

`ProductProviderProfileInput` may contain a write-only `credentials` envelope. No output type contains the corresponding values.

- [x] **Step 4: Serialize profiles into public OpenCode config patches**

Implement `profileProviderID`, `profileCredentialEnvironment`, `profileSensitiveHeaderEnvironment`, `serializeProviderProfile`, `enableProviderPatch`, `disableProviderPatch`, and `defaultModelPatch`. Use `@ai-sdk/openai-compatible`, normalize Ollama to `/v1`, preserve manually entered models, emit `tool_call` only after a successful tool test, and emit `{env:...}` tokens for every secret.

- [x] **Step 5: Extend the product runtime with an unavailable browser model center**

Every `ProductHost` exposes `modelCenter`; the browser implementation reports `available: false` and rejects mutating operations with a normalized unavailable-host error. Export the subpath `@opencode-ai/app/product/model-center` so Desktop main code imports only the focused module.

- [x] **Step 6: Verify and commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/app
bun test --conditions=solid --preload ./happydom.ts ./src/product
bun run typecheck
git add src/product src/index.ts package.json
git commit -m "feat: define visual model center contracts"
```

Expected: product tests and App type check pass.

### Task 2: Add Encrypted macOS Credential Storage

**Files:**

- Create: `packages/desktop/src/main/model-center/credentials.ts`
- Create: `packages/desktop/src/main/model-center/credentials.test.ts`
- Modify: `packages/desktop/src/product/host.ts`
- Modify: `packages/desktop/src/product/host.test.ts`
- Modify: `packages/desktop/src/main/store-keys.ts`

- [x] **Step 1: Write credential-service tests with injected `safeStorage` and store**

Test unavailable encryption, write/read/update/delete, missing entries, corrupt ciphertext, platform gating, and capability metadata. Record every value sent to the fake store and assert none equals or contains `sk-test-secret` or `Bearer secret-header`.

- [x] **Step 2: Run the focused test and confirm failure**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/desktop
bun test src/main/model-center/credentials.test.ts
```

Expected: FAIL because `credentials.ts` is absent.

- [x] **Step 3: Implement a platform-neutral service over Electron `safeStorage`**

Use this interface:

```ts
export type ProductCredentialService = {
  capabilities(): ProductCredentialCapabilities
  has(reference: string): boolean
  read(reference: string): ProductCredentialEnvelope | undefined
  write(reference: string, value: ProductCredentialEnvelope): void
  delete(reference: string): void
}
```

On `darwin`, call `safeStorage.isEncryptionAvailable()`, `encryptString`, and `decryptString`; persist only base64 ciphertext in the dedicated `agent.credentials` store. Keep Windows and Linux operations unavailable in this phase. Validate decrypted JSON before use and map failures to redacted credential errors.

- [x] **Step 4: Replace the Phase 1 capability stub**

`ProductCredentialCapabilities` must report `macos-keychain`, `available: true`, and read/write/delete operations only when macOS encryption is available. Preserve the future Windows backend name but do not claim operations that are not implemented.

- [x] **Step 5: Verify and commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/desktop
bun test src/main/model-center/credentials.test.ts src/product/host.test.ts
bun run typecheck
git add src/main/model-center/credentials.ts src/main/model-center/credentials.test.ts src/main/store-keys.ts src/product/host.ts src/product/host.test.ts
git commit -m "feat: encrypt model credentials with mac keychain"
```

### Task 3: Persist and Migrate Provider Profiles

**Files:**

- Create: `packages/desktop/src/main/model-center/profiles.ts`
- Create: `packages/desktop/src/main/model-center/profiles.test.ts`
- Modify: `packages/desktop/src/main/store-keys.ts`

- [x] **Step 1: Write repository tests**

Cover an empty store, create/update ordering, stable IDs and provider IDs, default selection, delete, malformed entries, and migration from schema version 0:

```ts
type StoredProfileStateV0 = {
  profiles: unknown[]
  defaultProfileID?: string
}

type StoredProfileStateV1 = {
  version: 1
  profiles: ProductProviderProfile[]
  default?: { profileID: string; modelID: string }
}
```

Assert raw profile-store JSON contains no credential values and no sensitive-header values.

- [x] **Step 2: Confirm the failing test**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/desktop
bun test src/main/model-center/profiles.test.ts
```

- [x] **Step 3: Implement repository validation and migration**

Use one `agent.model-profiles` store key named `state`. Drop invalid profiles individually, retain valid profiles, repair dangling defaults, sort by `updatedAt` descending, and write the migrated V1 state once. Generate IDs with injected `randomUUID` and times with injected `now` for deterministic tests.

- [x] **Step 4: Verify and commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/desktop
bun test src/main/model-center/profiles.test.ts
bun run typecheck
git add src/main/model-center/profiles.ts src/main/model-center/profiles.test.ts src/main/store-keys.ts
git commit -m "feat: persist model provider profiles"
```

### Task 4: Discover Models and Test Agent Capabilities

**Files:**

- Create: `packages/desktop/src/main/model-center/http.ts`
- Create: `packages/desktop/src/main/model-center/diagnostics.ts`
- Create: `packages/desktop/src/main/model-center/probe.ts`
- Create: `packages/desktop/src/main/model-center/probe.test.ts`
- Create: `packages/desktop/src/main/model-center/mock-openai-server.fixture.test.ts`
- Create: `packages/desktop/src/main/model-center/mock-openai-server.test.ts`

- [x] **Step 1: Build deterministic OpenAI-compatible and Ollama fixtures**

Use `Bun.serve` on `127.0.0.1` with routes for `/v1/models`, `/v1/chat/completions`, `/api/tags`, and configurable 401, 404, malformed JSON, delayed response, SSE, and tool-call responses. Fixture requests record headers but never print them.

- [x] **Step 2: Write failing discovery and classification tests**

Cover OpenAI model listing, Ollama tag listing, manual-model fallback, bearer auth, sensitive headers, timeout, unreachable endpoint, TLS-like transport failure, malformed API, missing model, non-streaming chat, streaming chat, tool-call success/failure, and these exact classifications:

```ts
const classification = basicChat
  ? streaming && toolCalling
    ? "agent-capable"
    : streaming || toolCalling
      ? "partially-compatible"
      : "chat-only"
  : "incompatible"
```

- [x] **Step 3: Implement bounded HTTP and diagnostic mapping**

Use `AbortSignal.timeout(settings.timeoutMs)`, an explicit redirect limit, JSON size limits, and header validation. Generate a request ID for each probe. Return only category, safe message, HTTP status, request ID, and redacted technical detail. Map unreachable, auth, incompatible API, missing model, streaming, tool calling, timeout, and TLS failures to the existing product error taxonomy.

- [x] **Step 4: Implement discovery and capability probes**

Discovery uses `/api/tags` for Ollama and `/models` under normalized OpenAI-compatible base URLs for other kinds. Capability testing sends a minimal non-sensitive chat request, verifies at least one SSE data event for streaming, then requests a deterministic `report_probe` tool call. Do not mark a profile agent-capable when tool calling is absent or malformed.

- [x] **Step 5: Verify and commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/desktop
bun test src/main/model-center/probe.test.ts src/main/model-center/mock-openai-server.test.ts
bun run typecheck
git add src/main/model-center/http.ts src/main/model-center/diagnostics.ts src/main/model-center/probe.ts src/main/model-center/probe.test.ts src/main/model-center/mock-openai-server.test.ts
git commit -m "feat: probe model endpoint capabilities"
```

### Task 5: Detect Local Ollama and LM Studio Services

**Files:**

- Create: `packages/desktop/src/main/model-center/local-detection.ts`
- Create: `packages/desktop/src/main/model-center/local-detection.test.ts`

- [x] **Step 1: Write deterministic detection tests**

Inject the discovery function and assert concurrent probes for exactly:

```ts
[
  { kind: "ollama", baseURL: "http://127.0.0.1:11434" },
  { kind: "lm-studio", baseURL: "http://127.0.0.1:1234/v1" },
]
```

Cover available with models, available with no models, unavailable, timeout, and one failed candidate not hiding the other.

- [x] **Step 2: Implement bounded local detection**

Use a 1,500 ms timeout per candidate, return stable candidate IDs, and preserve model IDs from successful discovery. Do not inspect processes, scan ports, or contact non-loopback hosts.

- [x] **Step 3: Verify and commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/desktop
bun test src/main/model-center/local-detection.test.ts
git add src/main/model-center/local-detection.ts src/main/model-center/local-detection.test.ts
git commit -m "feat: detect local model services"
```

### Task 6: Inject Keychain Credentials Into Supervised Sidecars

**Files:**

- Modify: `packages/desktop/src/main/server.ts`
- Modify: `packages/desktop/src/main/server.test.ts`
- Create: `packages/desktop/src/main/sidecar-environment.ts`
- Create: `packages/desktop/src/main/model-center/environment.ts`
- Create: `packages/desktop/src/main/model-center/environment.test.ts`
- Modify: `packages/desktop/src/main/index.ts`

- [x] **Step 1: Write environment and spawn tests**

Assert API keys and sensitive headers map only to deterministic environment names, absent credentials are skipped, and `spawnLocalServer` merges injected values into the utility-process environment without assigning them to `process.env`. Assert logger metadata and sidecar status contain no secret values.

- [x] **Step 2: Extend `spawnLocalServer` with per-spawn environment input**

Add `environment?: Readonly<Record<string, string>>` to `SpawnLocalServerOptions`. `createSidecarEnv` copies the parent environment, applies the explicit map to the child copy, strips `DEBUG`, and never mutates the parent.

- [x] **Step 3: Build the environment from encrypted profile envelopes**

For each valid profile, read its credential reference just before spawn and emit API-key and sensitive-header variables matching Task 1 serialization. Decryption or missing-secret failures omit only that profile's variables and emit a redacted warning with profile ID.

- [x] **Step 4: Reload credentials through a supervised restart**

Wire `reloadCredentials()` to `restartProductSidecar()`. The supervisor's injected spawn closure rebuilds the environment on every initial start, manual restart, and automatic crash recovery.

- [x] **Step 5: Verify and commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/desktop
bun test src/main/server.test.ts src/main/model-center/environment.test.ts src/main/sidecar-supervisor.test.ts
bun run typecheck
git add src/main/server.ts src/main/server.test.ts src/main/model-center/environment.ts src/main/model-center/environment.test.ts src/main/index.ts
git commit -m "feat: inject model credentials into sidecar"
```

### Task 7: Expose the Model Center Through Typed IPC

**Files:**

- Create: `packages/desktop/src/main/model-center/service.ts`
- Create: `packages/desktop/src/main/model-center/service.test.ts`
- Modify: `packages/desktop/src/product/host.ts`
- Modify: `packages/desktop/src/product/host.test.ts`
- Modify: `packages/desktop/src/main/ipc.ts`
- Modify: `packages/desktop/src/preload/product-host.ts`
- Modify: `packages/desktop/src/preload/product-host.test.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/preload/types.ts`
- Modify: `packages/desktop/src/main/index.ts`

- [x] **Step 1: Write service and IPC allow-list tests**

Cover capabilities, list, save, edit, remove, discover, test, detect-local, select-default, and reload-credentials channels. Feed extra fields and malformed IDs through IPC and assert they are rejected. Serialize every successful response and assert it excludes fixture secrets.

- [x] **Step 2: Implement the model-center service**

Compose the repository, credential service, probe service, and local detector. Save credentials before publishing a profile; if profile persistence fails, restore the previous envelope. Delete credentials idempotently. Persist capability reports only after validating that the tested model still belongs to the current profile.

- [x] **Step 3: Add exact typed channels**

Add these channel names to `PRODUCT_HOST_CHANNELS`:

```ts
modelCenterCapabilities
modelCenterList
modelCenterSave
modelCenterRemove
modelCenterDiscover
modelCenterTest
modelCenterDetectLocal
modelCenterSelectDefault
modelCenterReloadCredentials
```

Register one handler per channel. Sanitize inputs before service calls and outputs before crossing the preload boundary.

- [x] **Step 4: Extend preload and Desktop host wrappers**

Expose only `ProductModelCenterAPI`; do not add generic IPC invocation, raw store access, credential read, environment read, or arbitrary HTTP methods. Keep sidecar subscription recovery behavior unchanged.

- [x] **Step 5: Verify and commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/desktop
bun test src/main/model-center src/product/host.test.ts src/preload/product-host.test.ts
bun run typecheck
git add src/main/model-center src/main/ipc.ts src/main/index.ts src/product/host.ts src/product/host.test.ts src/preload
git commit -m "feat: expose typed model center host"
```

### Task 8: Apply Profiles Through the OpenCode Public Configuration API

**Files:**

- Create: `packages/app/src/product/model-center/controller.ts`
- Create: `packages/app/src/product/model-center/controller.test.ts`
- Modify: `packages/app/src/product/model-center/index.ts`
- Modify: `packages/app/src/product/opencode-contract.test.ts`

- [x] **Step 1: Write orchestration tests with fake host and config API**

Assert this exact successful order for save:

```text
host.modelCenter.save
serverSync.updateConfig(non-secret provider patch)
host.modelCenter.reloadCredentials
serverSync.refreshProviders
```

Assert delete first disables the provider in OpenCode config, then removes the profile/credential, reloads the sidecar, and refreshes providers. Assert default selection updates both profile state and OpenCode's `model` key. Failure tests must retain the previous usable profile and return a redacted actionable error.

- [x] **Step 2: Implement a controller over product host and public config functions**

The controller accepts injected `updateConfig`, `refreshProviders`, and `disabledProviders` accessors instead of importing server internals. It serializes only Task 1 config patches and never calls OpenCode auth storage for product-managed private/local profiles.

- [x] **Step 3: Extend the OpenCode contract lock**

Assert the consumed public config surface still exposes global config update, provider refresh/list, model defaults, and model selection values. Keep protected runtime packages unchanged.

- [x] **Step 4: Verify and commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/app
bun test --conditions=solid --preload ./happydom.ts ./src/product/model-center ./src/product/opencode-contract.test.ts
bun run typecheck
git add src/product/model-center src/product/opencode-contract.test.ts
git commit -m "feat: apply model profiles through public config"
```

### Task 9: Build the Models-First Visual Setup Flow

**Files:**

- Create: `packages/app/src/components/settings-v2/model-center.tsx`
- Create: `packages/app/src/components/settings-v2/model-center-controller.ts`
- Create: `packages/app/src/components/settings-v2/model-center-controller.test.ts`
- Create: `packages/app/src/components/settings-v2/dialog-model-profile.tsx`
- Create: `packages/app/src/components/settings-v2/model-capability-status.tsx`
- Modify: `packages/app/src/components/settings-v2/dialog-settings-v2.tsx`
- Modify: `packages/app/src/components/settings-v2/models.tsx`
- Modify: `packages/app/src/components/settings-v2/providers.tsx`
- Modify: `packages/app/src/components/settings-v2/settings-v2.css`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`

- [ ] **Step 1: Write controller tests for the complete form state machine**

Cover create/edit, provider-kind defaults, local detection selection, API-key replacement without readback, sensitive headers, discovery, manual model add/remove, default selection, capability-test state, cancellation, double-submit prevention, save, delete confirmation, and redacted errors.

- [ ] **Step 2: Make Models the first server settings entry**

Order the server section as Models, Providers, Servers. The Models page is the primary model center; Providers remains the complete inherited cloud-provider catalog and Models retains inherited per-model visibility controls below product-managed profiles.

- [ ] **Step 3: Build the model-center page**

Use full-width settings sections, not nested cards:

- Default model with provider/model label and Change action.
- Model sources with rows for managed private/local profiles and connected cloud providers.
- Add source actions for Cloud provider, Private endpoint, Detect Ollama/LM Studio, and Custom local URL.
- Available models with inherited visibility switches.

Rows show source type, endpoint host, default model, secret-present state, last-test time, and capability badge. Use icon buttons with accessible labels for edit and delete.

- [ ] **Step 4: Build the create/edit dialog**

Use a provider-kind segmented control, labeled text/password inputs, model list with explicit selection controls, and a collapsed Advanced section for non-sensitive headers, sensitive-header names/values, timeout, context limit, output limit, proxy URL, and TLS policy. Per-profile proxy and `allowInsecureTls` settings remain visibly off and saving either is rejected because the unmodified OpenCode runtime cannot safely scope either transport behavior per profile. The form explains the actionable limitation instead of silently accepting settings that agent requests would ignore.

- [ ] **Step 5: Add discovery, manual fallback, test, and diagnostics states**

Discovery and testing have stable progress dimensions, abort stale responses by generation, and retain manually entered IDs. Show category-specific remediation without raw responses. Disable Save only for invalid form data; permit saving a partial/chat-only profile but mark it unavailable for default agent selection.

- [ ] **Step 6: Add English fallback and Simplified Chinese product copy**

Add every new key to `en.ts` and translated values to `zh.ts`. Other locales inherit English through the existing dictionary merge. Run parity tests without weakening their expectations.

- [ ] **Step 7: Verify and commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/app
bun test --conditions=solid --preload ./happydom.ts ./src/components/settings-v2/model-center-controller.test.ts ./src/product/model-center ./src/i18n/parity.test.ts
bun run typecheck
git add src/components/settings-v2 src/i18n/en.ts src/i18n/zh.ts
git commit -m "feat: add visual model setup flow"
```

### Task 10: Prove the Phase 2 Gate and Add CI Evidence

**Files:**

- Create: `packages/desktop/src/main/model-center/e2e-secrets.test.ts`
- Modify: `.github/workflows/product.yml`
- Create: `docs/product/phase-2/verification.md`
- Create: `docs/product/phase-2/artifacts/model-center-private.png`
- Create: `docs/product/phase-2/artifacts/model-center-local.png`
- Modify: `docs/product/baseline/feature-parity.md`
- Modify: `docs/superpowers/plans/2026-08-01-visual-model-center.md`

- [ ] **Step 1: Add the secret-leak regression test and complete CI gate**

The test stores a known canary through the real service with fake `safeStorage`, executes list/discover/test error paths, and scans profile-store JSON, serialized IPC responses, captured logs, and serialized OpenCode patches. Only ciphertext may contain a transformed representation; plaintext canaries must have zero matches.

Extend Product CI to run all App unit tests affected by the model center, all Desktop tests, App/Desktop type checks, lint, protected-runtime diff, and deterministic Desktop build.

- [ ] **Step 2: Run the complete automated gate from the detached worktree**

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run lint
bun run --cwd packages/app test:unit
bun run --cwd packages/app typecheck
bun run --cwd packages/desktop test
bun run --cwd packages/desktop typecheck
git diff --exit-code v1.18.10...HEAD -- packages/core packages/opencode packages/server packages/protocol
MODELS_DEV_API_JSON=/tmp/models-dev-audit.2X2ZYe/packages/web/dist/_api.json OPENCODE_CHANNEL=dev bun run --cwd packages/desktop build
```

Expected: every command exits 0 and the protected-runtime diff is empty.

- [ ] **Step 3: Package and run macOS acceptance**

Package the arm64 development app with isolated `CFFIXED_USER_HOME` and XDG roots. Use Agent Browser against the packaged app to:

1. connect one available inherited cloud provider and run a minimal task;
2. configure a deterministic private OpenAI-compatible fixture without JSON, discover a model, pass streaming/tool tests, select it, and run an agent task;
3. detect a real Ollama or LM Studio service when installed, otherwise configure a loopback local fixture through the identical local-provider flow and explicitly record that real-service detection was unavailable;
4. restart the app and prove profiles/default selection persist while API-key fields remain masked and unreadable;
5. delete a profile and prove its provider is disabled and its credential entry removed.

- [ ] **Step 4: Run visual and accessibility review**

Capture desktop screenshots at 1440x900 and 1024x768 plus a mobile-width renderer check. Verify no overlap, clipping, layout shifts, nested cards, inaccessible icon buttons, or untranslated product copy. Run axe-core and require zero violations; document any incomplete automated contrast checks separately.

- [ ] **Step 5: Record performance and security evidence**

Measure three packaged starts using the Phase 0 procedure and compare medians against 1.192 s sidecar, 1.585 s renderer, and 1.676 s initialized boundaries. Record profile/test latency, package identity, artifact hashes, encrypted-store inspection, OpenCode-config inspection, and log canary scan.

- [ ] **Step 6: Update parity, verification, and checklist state**

Mark visual provider profiles, Keychain credentials, and automatic local-model discovery as implemented only after evidence exists. Record preserved cloud providers and any unavailable real local service honestly. Change every completed Phase 2 checkbox to `[x]`.

- [ ] **Step 7: Commit Phase 2 evidence**

```bash
git add .github/workflows/product.yml packages/desktop/src/main/model-center/e2e-secrets.test.ts docs/product/phase-2 docs/product/baseline/feature-parity.md docs/superpowers/plans/2026-08-01-visual-model-center.md
git commit -m "docs: complete phase 2 visual model center"
```

## Self-Review Checklist

- [ ] Every Phase 2 deliverable in the approved design maps to a task above.
- [ ] No task requires a protected runtime package change.
- [ ] All secret-bearing inputs terminate in main-process credential/probe operations; all outputs are renderer-safe.
- [ ] Cloud, private, and local setup each have a visual path and gate evidence.
- [ ] Discovery failure has a manual-model path.
- [ ] Compatibility is based on streaming and tool behavior, not only a successful TCP connection.
- [ ] macOS is implemented now while credential and model-center interfaces remain replaceable for Windows.
- [ ] Commands, paths, signatures, expected results, and commit points contain no implementation placeholders.
