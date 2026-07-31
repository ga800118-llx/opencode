# Upstream Baseline

- Repository: https://github.com/anomalyco/opencode
- Release: `v1.18.10`
- Commit: `7902e04c3a67f7c69726bc955efb46e29214c797`
- Release date: 2026-07-30
- License: MIT
- Package manager: Bun 1.3.14
- Desktop: Electron 42.3.3, electron-vite 5, SolidJS 1.9.10
- Product branch: `codex/phase-0-3`
- Upstream remote: `upstream` (push URL disabled)
- Import merge: `d1168e32db4dc75f63b0a872e8babe5ef9a11699`

The repository contains the complete upstream history and the pinned release is an
ancestor of the product branch. Local `main` marks the import baseline. A product
`origin` is intentionally absent until a product-hosting repository exists.

## Update Policy

One upstream release is pinned per product milestone. Upstream updates are merged
only between phases after contract, parity, model-center, and desktop-workflow
checks. Product code must not track the moving `dev` branch.

## Reproduction Commands

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun install --frozen-lockfile
bun run --cwd packages/desktop typecheck
(cd packages/desktop && bun test src)
MODELS_DEV_API_JSON=/path/to/models.dev/_api.json \
  OPENCODE_CHANNEL=dev bun run --cwd packages/desktop build
```

The `MODELS_DEV_API_JSON` override is required in networks where
`https://models.dev/api.json` is not reachable. The file must be generated from a
pinned Models.dev checkout; Phase 0 used commit
`410468e9bbcbeb2f6336f8ca3b555a9964317a81`.
