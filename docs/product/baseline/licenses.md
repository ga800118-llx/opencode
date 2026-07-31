# License Baseline

OpenCode v1.18.10 is distributed under the MIT License. The root manifest and the
inspected Desktop, App, Core, Server, Protocol, and OpenCode package manifests all
declare `MIT`. The fork must retain the upstream copyright and permission notice
in source and distributed copies.

## Product Rules

1. Keep the upstream `LICENSE` file and required dependency notices.
2. Do not imply endorsement by OpenCode or OpenAI.
3. Do not use OpenCode or Codex as the final product name or logo.
4. Generate a complete production third-party notice inventory before Phase 4 distribution.
5. Review every newly added dependency for license compatibility.
6. Preserve attribution when upstream source is modified or redistributed.

## Current Packaging Gap

The Phase 0 unsigned `.app` does not include the root OpenCode `LICENSE` text in
its application resources. Electron-builder currently packages Desktop `out` and
`resources`, while the root license remains outside the bundle. Phase 0 records
this as an upstream distribution gap; the product build must add the MIT notice
and verified third-party notices before any Phase 4 distribution.

Phase 0 license review is an engineering inventory, not a legal opinion.
