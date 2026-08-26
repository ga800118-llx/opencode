# Guai Logo Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old application mark with the approved negative-space G and produce a verified Guai Code Beta Mac package.

**Architecture:** Keep one vector path constant in the UI package and reuse it in a deterministic desktop asset generator. The generator renders the black rounded-square app icon into tracked PNG, ICO, ICNS, and favicon assets while the UI components render the standalone themed mark directly.

**Tech Stack:** TypeScript, SolidJS SVG components, Bun, macOS `sips`, macOS `iconutil`, Electron Builder.

---

### Task 1: Define The Vector Brand Geometry

**Files:**
- Create: `packages/ui/src/components/logo-geometry.tsx`
- Modify: `packages/ui/src/components/logo.tsx`
- Modify: `packages/ui/src/components/logo.css`
- Create: `packages/ui/src/components/logo.test.tsx`

- [ ] **Step 1: Add a failing geometry/component test**

Assert that `GUAI_MARK_PATH` is used by `Mark`, that the brand wordmark renders
`GUAI`, and that the old rectangular five-part G slot names are absent.

- [ ] **Step 2: Run the focused UI test**

Run from `packages/ui`: `bun test src/components/logo.test.tsx`

Expected: failure because `logo-geometry.tsx` does not exist and the old
component still renders `Guai Code`.

- [ ] **Step 3: Add the approved geometry and update the components**

Export one `GUAI_MARK_VIEWBOX` and `GUAI_MARK_PATH` constant. Use the path for
`Mark`, `Splash`, and the symbol inside `Logo`; render `GUAI` as the wordmark.
Keep fills on existing icon theme tokens so the standalone mark is white in
dark mode and black in light mode.

- [ ] **Step 4: Update the compact mark aspect ratio**

Change `logo.css` from the old `4/5` ratio to the new vector view box ratio so
width-only usages do not distort or shift adjacent content.

- [ ] **Step 5: Run the focused test and UI typecheck**

Run from `packages/ui`:

```bash
bun test src/components/logo.test.tsx
bun typecheck
```

Expected: both commands pass.

### Task 2: Add A Deterministic Desktop Asset Generator

**Files:**
- Create: `packages/desktop/scripts/generate-brand-icons.ts`
- Create: `packages/desktop/scripts/generate-brand-icons.test.ts`
- Modify: `packages/desktop/package.json`

- [ ] **Step 1: Add failing generator tests**

Test that the generated SVG contains `#0D0D0D`, a white mark, rounded-square
geometry, and `GUAI_MARK_PATH`. Test the ICO encoder header, image count, and
PNG offsets using in-memory fixture buffers.

- [ ] **Step 2: Run the focused desktop test**

Run from `packages/desktop`:
`bun test scripts/generate-brand-icons.test.ts`

Expected: failure because the generator does not exist.

- [ ] **Step 3: Implement SVG, PNG, ICO, and ICNS generation**

Create a generator that:

- Builds a 1024-pixel black rounded-square SVG from `GUAI_MARK_PATH`.
- Uses `sips` to render and resize PNG assets.
- Encodes PNG payloads into ICO directory entries without another runtime
  dependency.
- Builds a complete macOS iconset and calls `iconutil -c icns`.
- Writes the top-level Dev, Beta, and production desktop icon assets.
- Writes both active and legacy favicon variants from the same master.

Expose pure SVG and ICO helpers for tests and guard file generation with
`if (import.meta.main)`.

- [ ] **Step 4: Add the package command**

Add `"brand:icons": "bun ./scripts/generate-brand-icons.ts"` to
`packages/desktop/package.json`.

- [ ] **Step 5: Pass generator tests**

Run from `packages/desktop`:
`bun test scripts/generate-brand-icons.test.ts`

Expected: all generator tests pass.

### Task 3: Generate And Inspect The Brand Assets

**Files:**
- Modify: `packages/desktop/icons/dev/*` top-level desktop assets
- Modify: `packages/desktop/icons/beta/*` top-level desktop assets
- Modify: `packages/desktop/icons/prod/*` top-level desktop assets
- Modify: `packages/ui/src/assets/favicon/*`

- [ ] **Step 1: Generate tracked assets**

Run from `packages/desktop`: `bun run brand:icons`

Expected: the command reports regenerated Dev, Beta, production, favicon, ICO,
and ICNS assets without changing Android or iOS legacy folders.

- [ ] **Step 2: Inspect large and small icon outputs**

Render or open `icons/beta/icon.png`, `icons/beta/64x64.png`,
`icons/beta/32x32.png`, and the 16-pixel ICO frame. Verify the black rounded
square, white G, open negative space, centering, and consistent edge padding.

- [ ] **Step 3: Validate generated formats**

Run from `packages/desktop`:

```bash
file icons/beta/icon.png icons/beta/icon.ico icons/beta/icon.icns
iconutil -c iconset icons/beta/icon.icns -o /tmp/guai-beta.iconset
```

Expected: valid PNG, multi-image Windows icon, and macOS ICNS with 16 through
1024 pixel representations.

### Task 4: Verify Application Integration

**Files:**
- Verify: `packages/ui/src/components/logo.tsx`
- Verify: `packages/desktop/icons/beta/*`
- Verify: `packages/ui/src/assets/favicon/*`

- [ ] **Step 1: Run focused tests and package typechecks**

Run:

```bash
cd packages/ui && bun test src/components/logo.test.tsx && bun typecheck
cd ../desktop && bun test scripts/generate-brand-icons.test.ts electron-builder.config.test.ts && bun typecheck
cd ../app && bun typecheck
```

Expected: all commands pass.

- [ ] **Step 2: Build the desktop application**

Run from `packages/desktop`: `OPENCODE_CHANNEL=beta bun run build`

Expected: Electron main, preload, and renderer builds complete successfully.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check` and `git diff --name-only`.

Expected: changes are limited to brand components, brand generation, static
brand assets, tests, package scripts, and this plan/spec documentation.

### Task 5: Produce And Validate The Mac Package

**Files:**
- Generate: `packages/desktop/dist/internal-beta/0.1.0-alpha.8/*mac-arm64*`

- [ ] **Step 1: Run the internal Mac beta packaging workflow**

Run from `packages/desktop`: `bun run package:mac:internal`

Expected: signed internal Beta `.dmg` and `.zip` artifacts are generated for
Apple Silicon using `icons/beta/icon.icns`.

- [ ] **Step 2: Validate the packaged application icon**

Mount the DMG read-only, inspect `Guai Code Beta.app/Contents/Resources`, and
extract the bundle icon. Verify its checksum differs from the old icon and its
rendered appearance matches the approved black-square white-G master.

- [ ] **Step 3: Report the package path and verification results**

Provide the absolute `.dmg` or `.dmg.zip` path, package size, version, CPU
architecture, code-signing status, and the completed test summary.

- [ ] **Step 4: Commit the implementation**

Stage only the brand implementation and generated assets, then commit:

```bash
git commit -m "feat(desktop): adopt Guai G logo"
```
