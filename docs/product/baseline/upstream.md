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
  OPENCODE_CHANNEL=dev bun run --cwd packages/desktop dev
MODELS_DEV_API_JSON=/path/to/models.dev/_api.json \
  OPENCODE_CHANNEL=dev bun run --cwd packages/desktop build
```

The `MODELS_DEV_API_JSON` override is required in networks where
`https://models.dev/api.json` is not reachable. Reproduce the Phase 0 snapshot as
follows:

```bash
export PATH="$HOME/.bun/bin:$PATH"
models_dir=/tmp/models-dev-410468e
git clone https://github.com/anomalyco/models.dev.git "$models_dir"
git -C "$models_dir" checkout 410468e9bbcbeb2f6336f8ca3b555a9964317a81
test "$(git -C "$models_dir" rev-parse HEAD)" = "410468e9bbcbeb2f6336f8ca3b555a9964317a81"
(cd "$models_dir" && bun install --frozen-lockfile)
bun run --cwd "$models_dir/packages/web" build
test "$(shasum -a 256 "$models_dir/packages/web/dist/_api.json" | cut -d' ' -f1)" = \
  "0935bc2a6a6068e0355a94976211db2d9e7c0198ec3e22866dd996f61b2a8306"
```

Use `$models_dir/packages/web/dist/_api.json` as the override path. The SHA-256
assertion fixes both the source commit and the generated data consumed by the
desktop development launch and build. The Phase 0 development launch was
verified from `/tmp/ai-agent-phase0-gate`: Electron Vite served the renderer on
`http://localhost:5173`, launched Electron, started the sidecar, and reached the
desktop screen successfully.
