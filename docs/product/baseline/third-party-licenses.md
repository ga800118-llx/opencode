# Third-Party License Baseline

## Scope and Method

This is a conservative engineering inventory of the frozen Bun installation for
OpenCode v1.18.10. It scans every unique `name@version` present in Bun's installed
package store, including development and optional platform dependencies. It does
not claim that every scanned package is shipped in the macOS application, and it
does not replace the production bundle notice inventory required before Phase 4.

Reproduce after `bun install --frozen-lockfile`:

```bash
node <<'NODE'
const fs = require("fs")
const path = require("path")
const root = "node_modules/.bun"
const packages = new Map()

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const modules = path.join(root, entry.name, "node_modules")
  if (!fs.existsSync(modules)) continue

  for (const first of fs.readdirSync(modules, { withFileTypes: true })) {
    const candidates = first.name.startsWith("@") && first.isDirectory()
      ? fs.readdirSync(path.join(modules, first.name), { withFileTypes: true })
          .filter((item) => item.isDirectory())
          .map((item) => path.join(modules, first.name, item.name))
      : first.isDirectory() ? [path.join(modules, first.name)] : []

    for (const directory of candidates) {
      const manifest = path.join(directory, "package.json")
      if (!fs.existsSync(manifest)) continue
      const data = JSON.parse(fs.readFileSync(manifest, "utf8"))
      if (!data.name || !data.version) continue
      packages.set(`${data.name}@${data.version}`, data.license ?? data.licenses ?? null)
    }
  }
}

const counts = {}
for (const license of packages.values()) {
  const value = typeof license === "string"
    ? license
    : Array.isArray(license)
      ? license.map((item) => typeof item === "string" ? item : item.type).join(" OR ")
      : license?.type ?? "MISSING"
  counts[value] = (counts[value] ?? 0) + 1
}
console.log(JSON.stringify({ uniquePackages: packages.size, counts }, null, 2))
NODE
```

Observed on the Phase 0 detached worktree:

| Manifest license expression | Unique packages |
| --- | ---: |
| MIT | 1,797 |
| Apache-2.0 | 277 |
| ISC | 134 |
| BSD-3-Clause | 39 |
| BSD-2-Clause | 25 |
| BlueOak-1.0.0 | 19 |
| MPL-2.0 | 5 |
| MIT OR Apache-2.0 | 4 |
| (MIT OR CC0-1.0) | 4 |
| OFL-1.1 | 3 |
| apache-2.0 | 3 |
| CC0-1.0 | 3 |
| (Apache-2.0 AND BSD-3-Clause) | 2 |
| FSL-1.1-MIT | 2 |
| MIT/X11 | 2 |
| LGPL-3.0-or-later | 1 |
| Python-2.0 | 1 |
| CC-BY-4.0 | 1 |
| (MPL-2.0 OR Apache-2.0) | 1 |
| (AFL-2.1 OR BSD-3-Clause) | 1 |
| Unlicense | 1 |
| WTFPL OR ISC | 1 |
| CC-BY-3.0 | 1 |
| WTFPL | 1 |
| 0BSD | 1 |
| (WTFPL OR MIT) | 1 |
| Missing manifest license | 6 |

The expressions total 2,336 unique installed packages. Capitalization variants
are preserved so the evidence matches package manifests rather than silently
normalizing their declarations.

## Items Requiring Explicit Notice Handling

- MPL-2.0 appears in five packages; `dompurify` offers MPL-2.0 or Apache-2.0.
- `@img/sharp-libvips-darwin-arm64@1.0.4` declares
  `LGPL-3.0-or-later` and needs verified libvips notice/source compliance in a
  distributed bundle.
- Three OFL packages and two CC-BY packages require their applicable font or
  attribution notices.
- Two FSL-1.1-MIT packages require product counsel or a documented compatibility
  decision before distribution; Phase 0 does not treat FSL as equivalent to MIT.
- Apache, BSD, MIT, ISC, and other notice-bearing packages still require their
  copyright and license text in the generated production notice file.

## Missing Manifest Declarations

Six installed packages omit a manifest `license` field:

- `@openauthjs/openauth@0.0.0-20250322224806`
- `@solidjs/start@2.0.0-devinxi.0`
- `buffers@0.1.1`
- `poe-oauth@0.0.8`
- `seq-queue@0.0.5`
- `zod-to-ts@1.2.0`

The installed `seq-queue` and `zod-to-ts` packages include MIT license files.
The other four packages contain neither a manifest declaration nor a license
file in the frozen installation and remain unresolved distribution blockers.
Their licenses must be verified from the exact source revisions before Phase 4;
an inferred repository license is not accepted as evidence.

## Packaged Application Observation

The unsigned Phase 0 `.app` contains license files only for
`@lydell/node-pty-darwin-arm64` and `@parcel/watcher-darwin-arm64`. It omits the
root OpenCode MIT license and does not contain a complete notice inventory.
Therefore the Phase 0 package is for local engineering validation only and is not
approved for distribution.
