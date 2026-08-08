# Guai Code Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace user-facing references to the current product with Guai Code while preserving OpenCode attribution and every functional OpenCode identifier.

**Architecture:** Apply semantic text replacements in UI-localization and prose documentation only. Leave URLs, shell commands, code fences, configuration examples, package names, paths, environment variables, protocol names, and TypeScript identifiers untouched. Treat the existing README origin section as attribution and make that relationship explicit.

**Tech Stack:** TypeScript/TSX, Astro/MDX, JSON/TypeScript localization modules, Bun.

---

### Task 1: Change application and desktop UI strings

**Files:**
- Modify: `packages/console/app/src/component/header.tsx`
- Modify: `packages/console/app/src/routes/[...404].tsx`
- Modify: `packages/console/app/src/routes/temp.tsx`
- Modify: `packages/console/app/src/routes/brand/index.tsx`
- Modify: visible SVG wordmarks below `packages/console/app/src/asset/`
- Modify: `packages/app/src/components/windows-app-menu.tsx`
- Modify: `packages/app/src/desktop-menu-copy.ts`
- Modify: `packages/app/src/i18n/*.ts`
- Modify: `packages/desktop/src/renderer/i18n/*.ts`
- Modify: `packages/desktop/src/main/**/*.ts`
- Test: `packages/desktop/src/main/menu-template.test.ts`

- [ ] **Step 1: Find strings that represent the current product**

Run:

```bash
rg -n -i 'OpenCode|Open Code' packages/app/src/i18n packages/app/src/components/windows-app-menu.tsx packages/app/src/desktop-menu-copy.ts packages/desktop/src/renderer/i18n packages/desktop/src/main
```

Expected: text-bearing values such as Console wordmarks, window menu labels, language-setting text, server descriptions, WSL onboarding, and provider connection copy.

- [ ] **Step 2: Replace only natural-language values**

Change string values such as:

```ts
const appName = "Guai Code"
"help.documentation": "Guai Code Documentation"
```

Keep property names, internal identifiers, URLs, provider IDs, package imports, executable names, resource file names, and `OPENCODE_*` values unchanged. Replace only SVG wordmarks that visibly spell the old product name.

- [ ] **Step 3: Run focused desktop tests**

Run from `packages/desktop`: `bun test src/main/menu-template.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit the UI copy changes**

Run: `git add packages/console/app/src packages/app/src/components/windows-app-menu.tsx packages/app/src/desktop-menu-copy.ts packages/app/src/i18n packages/desktop/src/renderer/i18n packages/desktop/src/main && git commit -m "refactor(app): rename visible product copy"`

### Task 2: Change web UI and documentation prose

**Files:**
- Modify: `packages/web/src/components/**/*.astro`
- Modify: `packages/web/src/components/**/*.tsx`
- Modify: `packages/web/src/content/i18n/*.json`
- Modify: `packages/web/src/content/docs/**/*.mdx`

- [ ] **Step 1: Identify Markdown fence boundaries before editing**

Run: `rg -n -i 'OpenCode|Open Code' packages/web/src/content/docs packages/web/src/content/i18n packages/web/src/components`

Expected: prose statements about the current product and UI labels, alongside code/config examples that must not be altered.

- [ ] **Step 2: Replace only prose and display text**

Use `Guai Code` for product-facing sentences and labels, including page descriptions, headings, and image alt text. Skip every line inside fenced code blocks and do not change `opencode` lower-case command/configuration tokens, URLs, custom-element names, import paths, or TypeScript symbols.

Example result:

```mdx
Guai Code provides an interactive terminal interface or TUI for working on your projects with an LLM.
```

- [ ] **Step 3: Typecheck the web package**

Run from `packages/web`: `bun typecheck`

Expected: PASS.

- [ ] **Step 4: Commit the web copy changes**

Run: `git add packages/web/src/components packages/web/src/content/i18n packages/web/src/content/docs && git commit -m "docs(web): rename visible product copy"`

### Task 3: Update repository documentation and preserve attribution

**Files:**
- Modify: `README*.md`
- Modify: `SECURITY.md`

- [ ] **Step 1: Replace current-product prose in every README translation**

Update visible names such as the screenshot alt text, desktop-app statement, agent/configuration descriptions, and contribution wording to `Guai Code`. Do not alter badges, links, install commands, artifact names, environment variables, or configuration paths.

- [ ] **Step 2: Convert the source section into explicit attribution**

Replace the current `Building on OpenCode` ownership language with a short statement that Guai Code is based on OpenCode and retains the original project name only as an upstream reference.

- [ ] **Step 3: Update security prose**

Change statements describing the application to name Guai Code. Keep the GitHub advisory URL and `OPENCODE_SERVER_PASSWORD` untouched.

- [ ] **Step 4: Review URL and command invariants**

Run: `git diff -- README*.md SECURITY.md | rg '^[-+].*(https?://|\`?opencode|OPENCODE_|\.opencode)'`

Expected: no changes to URLs, commands, configuration identifiers, or environment-variable names.

- [ ] **Step 5: Commit repository documentation changes**

Run: `git add README*.md SECURITY.md && git commit -m "docs: rename product copy to Guai Code"`

### Task 4: Completion audit

**Files:**
- Verify: all changed files

- [ ] **Step 1: Search for remaining display-name occurrences**

Run: `rg -n -i 'OpenCode|Open Code' packages/app/src packages/desktop/src packages/web/src README*.md SECURITY.md`

Expected: remaining matches are exclusively URLs, code/config examples, identifiers, test fixtures, or explicit upstream attribution.

- [ ] **Step 2: Confirm no functional identifiers changed**

Run: `git diff --check && git diff --word-diff=plain -- packages/app packages/desktop packages/web README*.md SECURITY.md`

Expected: no whitespace failures and no lower-case `opencode` functional token changed to `guai`.

- [ ] **Step 3: Run package typechecks**

Run from each package directory: `bun typecheck`

Expected: PASS for `packages/app`, `packages/desktop`, and `packages/web`.

- [ ] **Step 4: Commit the audit-ready migration**

Run: `git add packages/app packages/desktop packages/web README*.md SECURITY.md && git commit -m "refactor: complete Guai Code branding"`
