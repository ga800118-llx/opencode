# Model Capability Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic capability-test errors with stage-aware diagnostics and localized, actionable copy.

**Architecture:** The desktop probe remains responsible for identifying which capability stage failed and applies a stage fallback only when normal error classification is unknown. The app stores the structured diagnostic and maps its kind to model-test-specific i18n keys before rendering.

**Tech Stack:** TypeScript, Bun test, SolidJS stores and components, Electron desktop model-center service, existing app i18n dictionaries.

---

## File Structure

- Modify `packages/desktop/src/main/model-center/diagnostics.ts`: support an optional known-stage fallback kind without replacing specific diagnostics.
- Modify `packages/desktop/src/main/model-center/probe.ts`: pass streaming and tool-calling fallback kinds at their respective failure boundaries.
- Modify `packages/desktop/src/main/model-center/mock-openai-server.fixture.test.ts`: provide deterministic HTTP 400 fixture modes.
- Modify `packages/desktop/src/main/model-center/probe.test.ts`: verify stage-aware capability diagnostics end to end.
- Create `packages/app/src/components/settings-v2/model-test-presentation.ts`: map structured diagnostic kinds to translation keys.
- Create `packages/app/src/components/settings-v2/model-test-presentation.test.ts`: cover every diagnostic kind.
- Modify `packages/app/src/components/settings-v2/model-center-controller.ts`: retain the structured test diagnostic.
- Modify `packages/app/src/components/settings-v2/model-center-controller.test.ts`: verify structured diagnostic state and stale-state clearing.
- Modify `packages/app/src/components/settings-v2/dialog-model-profile.tsx`: render translated diagnostic copy.
- Modify `packages/app/src/i18n/model-center-copy.ts`: add English and Simplified Chinese capability-test messages.

### Task 1: Stage-Aware Probe Diagnostics

**Files:**
- Modify: `packages/desktop/src/main/model-center/diagnostics.ts`
- Modify: `packages/desktop/src/main/model-center/probe.ts`
- Modify: `packages/desktop/src/main/model-center/mock-openai-server.fixture.test.ts`
- Test: `packages/desktop/src/main/model-center/probe.test.ts`

- [ ] **Step 1: Add failing HTTP 400 capability tests**

Add mock modes that return HTTP 400 only for streaming or tool-calling requests. Add assertions equivalent to:

```ts
test.each([
  { mode: "stream-http-error", kind: "streaming", streaming: false, toolCalling: true },
  { mode: "tool-http-error", kind: "tool-calling", streaming: true, toolCalling: false },
] as const)("classifies an unknown $mode failure by probe stage", async ({ mode, kind, streaming, toolCalling }) => {
  await withServer(mode, async (baseURL) => {
    const result = await createModelProbe({ requestID: () => `req-${mode}` }).test({
      target: target(baseURL),
      modelID: "coder",
    })
    expect(result).toMatchObject({
      classification: "partially-compatible",
      checks: { basicChat: true, streaming, toolCalling },
      diagnostic: { kind, status: 400, requestID: `req-${mode}` },
    })
  })
})
```

Implement the fixture branches exactly at the existing stream and tool boundaries:

```ts
if (bodyField(body, "stream") === true) {
  if (mode === "stream-http-error") return Response.json({ error: "private fixture detail" }, { status: 400 })
  if (mode === "chat-only") return Response.json({ choices: [{ message: { content: "OK" } }] })
  // existing SSE success response
}

if (Array.isArray(tools) && tools.length) {
  if (mode === "tool-http-error") return Response.json({ error: "private fixture detail" }, { status: 400 })
  if (mode === "agent" || mode === "stream-http-error") {
    // existing successful report_probe tool call response
  }
  // existing unsupported-tool response
}
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
cd packages/desktop
bun test src/main/model-center/probe.test.ts
```

Expected: the new cases fail because HTTP 400 currently normalizes to `unknown`.

- [ ] **Step 3: Implement optional fallback classification**

Extend `createProbeDiagnostic` with an optional `fallbackKind`. Normalize first, then replace only an `unknown` kind with the supplied stage kind while preserving status and request ID:

```ts
export function createProbeDiagnostic(
  error: unknown,
  requestID: string,
  fallbackKind?: Extract<ProductErrorKind, "streaming" | "tool-calling">,
): ProductModelDiagnostic {
  const normalized = normalizeProductError(error)
  const fallback =
    normalized.kind === "unknown" && fallbackKind
      ? normalizeProductError({ code: fallbackKind === "streaming" ? "SSE_ERROR" : "TOOL_CALL_ERROR" })
      : normalized
  return Object.freeze({
    kind: fallback.kind,
    message: fallback.message,
    requestID,
    ...(normalized.diagnostic?.status === undefined ? {} : { status: normalized.diagnostic.status }),
    detail: fallback.action,
  })
}
```

Keep the copy source internal and safe; do not include provider response bodies. Pass `"streaming"` from the streaming catch and `"tool-calling"` from the tool catch in `probe.ts`.

- [ ] **Step 4: Run desktop probe tests and typecheck**

Run:

```bash
cd packages/desktop
bun test src/main/model-center/probe.test.ts src/main/model-center/service.test.ts
bun typecheck
```

Expected: all tests pass and `tsgo -b` exits zero.

- [ ] **Step 5: Commit the probe fix**

```bash
git add packages/desktop/src/main/model-center/diagnostics.ts \
  packages/desktop/src/main/model-center/probe.ts \
  packages/desktop/src/main/model-center/mock-openai-server.fixture.test.ts \
  packages/desktop/src/main/model-center/probe.test.ts
git commit -m "fix(desktop): classify capability probe failures"
```

### Task 2: Localized Capability-Test Presentation

**Files:**
- Create: `packages/app/src/components/settings-v2/model-test-presentation.ts`
- Create: `packages/app/src/components/settings-v2/model-test-presentation.test.ts`
- Modify: `packages/app/src/components/settings-v2/model-center-controller.ts`
- Modify: `packages/app/src/components/settings-v2/model-center-controller.test.ts`
- Modify: `packages/app/src/components/settings-v2/dialog-model-profile.tsx`
- Modify: `packages/app/src/i18n/model-center-copy.ts`

- [ ] **Step 1: Write failing presentation and controller tests**

Create a pure map covering every `ProductErrorKind`:

```ts
const expected = {
  "unreachable-endpoint": "settings.modelCenter.test.unreachableEndpoint",
  authentication: "settings.modelCenter.test.authentication",
  "incompatible-api": "settings.modelCenter.test.incompatible",
  "missing-model": "settings.modelCenter.test.missingModel",
  streaming: "settings.modelCenter.test.streaming",
  "tool-calling": "settings.modelCenter.test.toolCalling",
  timeout: "settings.modelCenter.test.timeout",
  tls: "settings.modelCenter.test.tls",
  "server-crash": "settings.modelCenter.test.serverCrash",
  aborted: "settings.modelCenter.test.aborted",
  unknown: "settings.modelCenter.test.unexpected",
} as const
```

Update controller assertions so `form.state.diagnostic` equals the returned `ProductModelDiagnostic` object instead of its English message.

- [ ] **Step 2: Run focused app tests and confirm failure**

Run:

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts \
  src/components/settings-v2/model-test-presentation.test.ts \
  src/components/settings-v2/model-center-controller.test.ts
```

Expected: tests fail until the presentation map and structured state are implemented.

- [ ] **Step 3: Implement structured state and localized presentation**

Change form state to:

```ts
diagnostic?: ProductModelDiagnostic
```

Store `result.diagnostic` directly. In the dialog, resolve the key through `modelTestPresentation(form.state.diagnostic)` and render it with `language.t(...)`. Preserve `state.error` precedence for rejected operations.

Add these complete English messages:

```ts
"settings.modelCenter.test.unreachableEndpoint": "Could not reach the model endpoint. Check the URL and service, then retry.",
"settings.modelCenter.test.authentication": "Authentication failed. Check the API key and request headers.",
"settings.modelCenter.test.incompatible": "The endpoint does not provide a compatible chat API.",
"settings.modelCenter.test.missingModel": "The selected model is unavailable. Choose another model or correct its ID.",
"settings.modelCenter.test.streaming": "The model response stream failed. Check streaming support or retry.",
"settings.modelCenter.test.toolCalling":
  "The model could not complete a tool call. Choose a model with structured tool support.",
"settings.modelCenter.test.timeout": "The capability test timed out. Check the service or increase the timeout.",
"settings.modelCenter.test.tls": "Could not establish a secure TLS connection. Check the endpoint certificate.",
"settings.modelCenter.test.serverCrash": "The agent service stopped during the capability test. Restart it and retry.",
"settings.modelCenter.test.aborted": "The capability test was canceled.",
"settings.modelCenter.test.unexpected": "The capability test failed unexpectedly. Retry once.",
```

Add these complete Simplified Chinese messages:

```ts
"settings.modelCenter.test.unreachableEndpoint": "无法连接模型端点。请检查 URL 和服务状态后重试。",
"settings.modelCenter.test.authentication": "身份验证失败。请检查 API 密钥和请求头。",
"settings.modelCenter.test.incompatible": "该端点未提供兼容的聊天 API。",
"settings.modelCenter.test.missingModel": "所选模型不可用。请选择其他模型或更正模型 ID。",
"settings.modelCenter.test.streaming": "模型流式响应失败。请检查流式支持或重试。",
"settings.modelCenter.test.toolCalling":
  "该模型未能完成工具调用。请选择支持结构化工具调用的模型。",
"settings.modelCenter.test.timeout": "能力测试超时。请检查服务或增加超时时间。",
"settings.modelCenter.test.tls": "无法建立安全的 TLS 连接。请检查端点证书。",
"settings.modelCenter.test.serverCrash": "能力测试期间智能体服务已停止。请重启后重试。",
"settings.modelCenter.test.aborted": "能力测试已取消。",
"settings.modelCenter.test.unexpected": "能力测试意外失败。请重试一次。",
```

- [ ] **Step 4: Run app tests and typechecks**

Run:

```bash
cd packages/app
bun test --conditions=solid --preload ./happydom.ts \
  src/components/settings-v2/model-test-presentation.test.ts \
  src/components/settings-v2/model-center-controller.test.ts \
  src/i18n/parity.test.ts
bun typecheck
bun run typecheck:e2e
```

Expected: tests and both typechecks pass.

- [ ] **Step 5: Commit the localized presentation**

```bash
git add packages/app/src/components/settings-v2/model-test-presentation.ts \
  packages/app/src/components/settings-v2/model-test-presentation.test.ts \
  packages/app/src/components/settings-v2/model-center-controller.ts \
  packages/app/src/components/settings-v2/model-center-controller.test.ts \
  packages/app/src/components/settings-v2/dialog-model-profile.tsx \
  packages/app/src/i18n/model-center-copy.ts
git commit -m "fix(app): localize capability test diagnostics"
```

### Task 3: Regression and Runtime Verification

**Files:**
- Verify only; no source changes expected.

- [ ] **Step 1: Run the complete affected suites**

```bash
cd packages/desktop
bun test src/main/model-center
bun typecheck

cd ../app
bun test --conditions=solid --preload ./happydom.ts src/components/settings-v2 src/product src/i18n/parity.test.ts
bun typecheck
```

Expected: all affected tests pass.

- [ ] **Step 2: Verify the live desktop app**

Use the currently running Electron development app:

1. Open Settings, Models, and edit the saved private endpoint.
2. Select `deepseek-v4-pro`.
3. Click `测试能力`.
4. Confirm the result remains `部分兼容` with `流式 OK / 工具 --`.
5. Confirm the feedback is the localized tool-calling explanation and no longer `An unexpected product error occurred.`

- [ ] **Step 3: Audit and commit any test-only correction**

Run:

```bash
git diff --check
git status --short
git diff --name-only 48c0ff839^..HEAD | rg '^packages/(core|opencode|server|protocol)/' || true
```

Expected: no whitespace errors, only the existing `.superpowers/` remains untracked, and no protected package changed.
