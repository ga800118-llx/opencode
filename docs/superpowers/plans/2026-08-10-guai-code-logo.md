# Guai Code Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and validate one review-ready 1024×1024 Guai Code desktop application icon from the approved design.

**Architecture:** Use the built-in ImageGen workflow for the raster master, then copy the selected output into `packages/identity` without replacing existing assets. Validate the master visually and inspect reduced 32×32 and 16×16 renderings before presenting it for approval.

**Tech Stack:** Built-in ImageGen, macOS `sips`, local image inspection

---

### Task 1: Generate the Review Master

**Files:**

- Create: `packages/identity/guai-code-logo-preview.png`

- [x] **Step 1: Generate the icon**

Use the built-in ImageGen tool with the approved `logo-brand` prompt from `docs/superpowers/specs/2026-08-10-guai-code-logo-design.md`. Require a square, symbol-only desktop icon with a deep coffee-black rounded-square base, bold orange geometric G, and one gold anomaly pixel.

- [x] **Step 2: Preserve the generated preview in the project**

Copy the generated PNG from the ImageGen output path to:

```bash
cp <generated-image-path> packages/identity/guai-code-logo-preview.png
```

Expected: `packages/identity/guai-code-logo-preview.png` exists and existing `mark.*` assets remain unchanged.

### Task 2: Validate Desktop-Icon Legibility

**Files:**

- Inspect: `packages/identity/guai-code-logo-preview.png`
- Create: `/tmp/guai-code-logo-32.png`
- Create: `/tmp/guai-code-logo-16.png`

- [x] **Step 1: Inspect the full-size master**

Verify that the image contains only the approved rounded-square base, orange G, and gold anomaly pixel. Reject text, extra symbols, scenery, mockup framing, watermarks, weak contrast, or imitation of another developer-tool logo.

- [x] **Step 2: Render reduced-size checks**

```bash
sips -z 32 32 packages/identity/guai-code-logo-preview.png --out /tmp/guai-code-logo-32.png
sips -z 16 16 packages/identity/guai-code-logo-preview.png --out /tmp/guai-code-logo-16.png
```

Expected: both commands report successful image creation.

- [x] **Step 3: Inspect the reduced images**

Confirm that the G silhouette remains recognizable, the anomaly pixel does not merge into the G, and the icon maintains clear contrast at 32×32 and 16×16.

- [x] **Step 4: Present the preview**

Show `packages/identity/guai-code-logo-preview.png` to the user with the final ImageGen prompt and saved path. Do not replace or regenerate the existing platform icon set until the preview is approved.
