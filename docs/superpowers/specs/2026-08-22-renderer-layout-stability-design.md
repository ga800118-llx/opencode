# Renderer Layout Stability Design

## Goal

Prevent repeated `ResizeObserver loop completed with undelivered notifications` errors during streamed session rendering, and prevent Vite from reloading the development renderer when syntax-highlighting code is first used.

## Scope

- Keep the existing session layout, automatic scrolling, custom scrollbar, and message rendering behavior.
- Coalesce layout writes initiated by resize callbacks into one animation-frame update.
- Avoid reactive state writes when the calculated scrollbar state has not changed.
- Pre-optimize the lazily reached Shiki streaming dependency in desktop development.
- Do not redesign the timeline, virtual list, or packaged runtime.

## Architecture

Resize observers remain responsible for detecting geometry changes. Their callbacks will schedule a single animation-frame update instead of synchronously mutating scroll position or reactive dimensions during the browser's resize-delivery phase. The custom scrollbar calculation will publish only values that differ from current state.

The desktop renderer Vite configuration will include `@shikijs/stream` in `optimizeDeps.include`, ensuring that the dependency is optimized before the renderer starts instead of when the first highlighted response is rendered.

## Failure Handling

Scheduled animation frames are cancelled when their owning component is disposed. Missing or detached elements remain no-ops. The implementation must not suppress browser errors globally because that would hide future layout regressions.

## Verification

- Unit-test animation-frame coalescing and cleanup behavior.
- Run the affected UI tests and package type checks.
- Exercise a streaming response containing fenced code in the desktop development build and confirm that the renderer neither emits the resize-loop warning nor reloads for dependency optimization.
- Build the packaged renderer and confirm the Shiki chunk is bundled without a Vite development dependency.
