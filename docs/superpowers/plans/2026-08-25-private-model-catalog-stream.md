# Private Model Catalog And Stream Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make restored projects inherit complete desktop private-model state and correctly handle non-content and error events from OpenAI-compatible streams.

**Architecture:** Strengthen the existing app-level catalog overlay so desktop-managed providers are authoritative without affecting unrelated providers. Give only the OpenAI-compatible route a tolerant event protocol layered on the existing OpenAI chat state machine, preserving native OpenAI behavior and the one-stream-call execution invariant.

**Tech Stack:** TypeScript, SolidJS app state helpers, Effect Schema/Stream, Bun test.

---

### Task 1: Repair Partial Private Provider Catalogs

**Files:**
- Modify: `packages/app/src/hooks/provider-catalog.ts`
- Test: `packages/app/src/hooks/provider-catalog.test.ts`

- [ ] **Step 1: Write failing catalog tests**

Add cases where the directory already lists `agent-profile-private` as connected but has either no map entry, a stale map entry, or no default. Assert that the global provider definition and default replace those partial values while a normal directory provider remains untouched.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `bun test src/hooks/provider-catalog.test.ts` from `packages/app`.

Expected: the new partial-catalog assertions fail because the current helper exits when the private provider ID is already connected.

- [ ] **Step 3: Implement authoritative private-provider overlay**

Change `includeDesktopModelProfiles` so it selects all valid globally connected `agent-profile-*` IDs, not only IDs absent from the directory connection set. Copy each selected provider into a cloned `all` map, ensure the ID is connected, and copy its global default when present. Return the original directory object only when no desktop-managed provider can be overlaid.

- [ ] **Step 4: Run app tests and type checking**

Run from `packages/app`:

```bash
bun test src/hooks/provider-catalog.test.ts
bun typecheck
```

Expected: all provider-catalog tests pass and type checking exits successfully.

### Task 2: Decode Compatible Stream Control And Error Events

**Files:**
- Modify: `packages/llm/src/protocols/openai-chat.ts`
- Modify: `packages/llm/src/protocols/openai-compatible-chat.ts`
- Test: `packages/llm/test/provider/openai-compatible-chat.test.ts`

- [ ] **Step 1: Write failing compatible-stream tests**

Add SSE fixtures for a `base_resp` metadata event before a normal response, a usage-only event, and an explicit `{ "error": { "message": "Temporary upstream failure" } }` event. Keep a malformed `{ "choices": "invalid" }` fixture to prove invalid content is still rejected.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `bun test test/provider/openai-compatible-chat.test.ts` from `packages/llm`.

Expected: control and error event assertions fail under the strict standard OpenAI event schema.

- [ ] **Step 3: Export a compatible protocol without changing the native route**

In `openai-chat.ts`, retain the existing standard `protocol` and export a second protocol using the same request lowering, parser state, step function, and finish handling with a compatible event union. The compatible step will ignore metadata, map usage-only chunks through the existing usage mapper, and fail explicit error events with their upstream message.

- [ ] **Step 4: Use the compatible protocol only on the compatible route**

Update `openai-compatible-chat.ts` to construct its route with the compatible protocol. Do not alter the native `OpenAIChat.route` or session runner.

- [ ] **Step 5: Run LLM tests and type checking**

Run from `packages/llm`:

```bash
bun test test/provider/openai-compatible-chat.test.ts test/provider/openai-chat.test.ts
bun typecheck
```

Expected: compatible and native stream suites pass, malformed stream coverage remains green, and type checking exits successfully.

### Task 3: Regression Verification

**Files:**
- No additional files.

- [ ] **Step 1: Run both focused suites together**

```bash
(cd packages/app && bun test src/hooks/provider-catalog.test.ts)
(cd packages/llm && bun test test/provider/openai-compatible-chat.test.ts test/provider/openai-chat.test.ts)
```

Expected: all tests pass.

- [ ] **Step 2: Review the final diff for scope**

Run:

```bash
git diff --check
git diff -- packages/app/src/hooks/provider-catalog.ts packages/app/src/hooks/provider-catalog.test.ts packages/llm/src/protocols/openai-chat.ts packages/llm/src/protocols/openai-compatible-chat.ts packages/llm/test/provider/openai-compatible-chat.test.ts
```

Expected: no whitespace errors and no changes outside the two approved behavior boundaries and their tests.
