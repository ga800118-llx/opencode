# Device Personalization Implementation Plan

**Goal:** Add one device-wide personalization text setting that augments normal interactive conversations without changing the existing built-in agent behavior.

**Architecture:** Store the normalized text in the existing local `settings.v3` record. Capture the saved value when a normal prompt is submitted, transport it as an optional prompt field through both compatibility paths, persist it with the V2 user prompt, and append only the latest user prompt's value to the provider system request. Empty or missing values preserve today's behavior exactly.

**Tech Stack:** SolidJS, TypeScript, Effect Schema, Bun tests, generated Protocol client.

---

## Task 1: Add the local personalization setting

**Files:**
- Modify: `packages/app/src/context/settings.tsx`
- Modify: `packages/app/src/context/settings.test.ts`

1. Add a `personalization.instructions` string with an empty default.
2. Export a whitespace-normalization helper and expose a read/set API from `useSettings()`.
3. Test trimming, empty normalization, and preservation of multiline content.

## Task 2: Add the focused settings page

**Files:**
- Create: `packages/app/src/components/settings-v2/personalization.tsx`
- Modify: `packages/app/src/components/settings-v2/dialog-settings-v2.tsx`
- Modify: `packages/app/src/components/settings-v2/settings-v2.css`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`

1. Add the `Personalization / 个性化` navigation item and panel.
2. Render one large textarea with explicit Save and Restore default actions.
3. Keep edits local to the draft until Save; restore clears the saved value after confirmation.
4. Add only page-specific styling and translations.

## Task 3: Attach personalization only to normal prompts

**Files:**
- Modify: `packages/app/src/components/prompt-input/submit.ts`
- Modify: `packages/app/src/components/prompt-input/submit.test.ts`
- Modify: `packages/app/src/product/contracts.ts`
- Modify: `packages/app/src/product/task-adapter.ts`
- Modify: `packages/app/src/product/task-adapter.test.ts`

1. Capture the saved personalization text in `FollowupDraft` for ordinary messages.
2. Pass it through `ProductPromptInput` and the task adapter.
3. Verify normal messages include it while slash commands and shell commands remain unchanged.

## Task 4: Carry the optional field through V1 and V2 transports

**Files:**
- Modify: `packages/app/src/utils/server.ts`
- Modify: `packages/app/src/utils/server.test.ts`
- Modify: `packages/app/src/utils/server-compat.ts`
- Modify: `packages/app/src/utils/server-compat.test.ts`
- Modify: `packages/schema/src/prompt-input.ts`
- Modify: `packages/schema/src/prompt.ts`
- Modify: `packages/schema/src/session-message.ts`
- Modify: `packages/core/src/session.ts`
- Regenerate: `packages/client/src/generated/**`

1. Add an optional `system` field to prompt input, durable prompt data, and projected user messages.
2. Preserve it when converting the desktop request to V2 and when routing to the V1 SDK.
3. Run `bun run generate` from `packages/client`; do not edit generated files manually.

## Task 5: Apply only the latest interactive personalization

**Files:**
- Modify: `packages/core/src/session/runner/llm.ts`
- Modify: `packages/core/test/session-runner.test.ts`

1. Read the latest user message's optional `system` value when constructing an LLM request.
2. Append it after the existing agent and durable system context.
3. Test initial use, tool-turn continuation, replacement on the next user message, and clearing on the next user message.

## Task 6: Verify the scoped change

1. Run focused app and core tests from their package directories.
2. Run `bun typecheck` from affected package directories.
3. Build the desktop app to catch integration errors.
4. Review the final diff to confirm no unrelated model, project, session, permission, Skill, or branding behavior changed.
