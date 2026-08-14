# Mac Stability Verification

Date: 2026-08-14

## Build

- Source commit: `2284bb671deaf6906209b69cef9068050350d785`
- Branch: `codex/phase-0-3`
- Package: `/Users/kdtc/Documents/AI_Agent/packages/desktop/dist/internal-beta/0.1.0-alpha.2`
- QA copy: `/Users/kdtc/Documents/AI_Agent-QA/mac-final/2284bb671-20260814-110215`
- Architecture: Apple Silicon (`darwin-arm64`)
- Signing: ad-hoc signed, not notarized
- ZIP SHA-256: `2fd5e9860c2f4f64e45849fce6c2ce2d3bdb063ce9bbcfb22ad5bb097d1f3021`
- DMG SHA-256: `4004e0f56735bd5324f03d91f7fb12a9c45e21a1d5938f53e010db7f5720ee65`
- Models snapshot SHA-256: `69f539d17920613e1812d8948e6cb21fd99978614a9582b7c7ed8c5dabe16e19`

The internal package builder verified the source commit, embedded runtimes, code signature, ZIP contents, DMG checksum, delivery manifest, and reproducible build metadata.

## Automated Checks

- App stability cases: 122 passed.
- Desktop model probe/proxy cases: 27 passed.
- LLM request policy cases: 21 passed.
- OpenCode HTTP and OpenAPI cases: 43 passed.
- Session coordinator and migration cases: 24 passed across the final focused suites.
- Schema: 15 passed; Protocol: 2 passed; Client: 19 passed; legacy SDK: 1 passed.
- Core, App, Desktop, LLM, OpenCode, Schema, Protocol, Client, Server, and SDK type checks passed.
- Client and legacy SDK generators were rerun after commit and produced no source differences.
- Final concurrency review result: no P0, P1, or P2 findings.

One full Core run passed 1,194 tests and hit one unrelated file-lock timing failure. That exact case passed immediately when rerun in isolation. The full 86-second suite was not repeated after the final focused coordinator fix, per the decision to omit lengthy tests.

## Packaged Smoke Checks

### Clean profile

- ZIP checksum, extraction, and deep code-sign verification passed.
- Packaged Electron 42.3.3 launched with isolated Home, config, cache, and user-data directories.
- The bundled Git runtime was detected.
- The supervised Sidecar started and reported ready in about two seconds.

### Existing profile

- The current package launched against a copied previous beta QA profile.
- First-launch onboarding remained completed.
- The supervised Sidecar started and reported ready.
- The existing Session count remained `1`.
- The upgrade marker SHA-256 remained `bfeb6fa3e714e3b355eb138c265bd0acab443ef704823ee145be05418bcd74b9`.
- The database migrated `session_input` to the durable compaction shape with `type`, nullable `prompt`, and nullable `delivery` columns.

## Deferred Tester Checks

The following intentionally remain for manual QA:

1. Run an active model response for 65 minutes and confirm it is not stopped by a total runtime deadline.
2. Run a silent-stream soak and confirm the UI changes only to slow/unverified status without aborting the request.
3. Edit project name, color, and start command; restart the packaged app and verify persistence.
4. Confirm context cost is absent, invoke Compact, and verify the conversation remains usable.
5. Install a Skill while the Skill page is open and verify it appears without restarting.
6. Add a project and immediately create a task without restarting.
7. Repeat items 3-6 on a clean profile and an upgraded real-user profile.

Windows packaging, Apple Developer ID signing, and notarization are outside this Mac internal-beta verification.
