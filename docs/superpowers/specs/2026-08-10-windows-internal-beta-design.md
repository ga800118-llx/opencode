# Guai Code Windows Internal Beta Design

## Goal

Deliver and verify a friend-testable Windows 11 x64 installer for Guai Code Beta without requiring Bun, a system Git installation, administrator access, or a code-signing certificate on the tester's machine.

## Release Identity

- Product: `Guai Code Beta`
- Version: `0.1.0-alpha.2`
- Bundle/application ID: `com.guaicode.desktop.beta`
- Architecture: Windows x64 only
- Installer: per-user, one-click NSIS executable
- Updates: disabled for Beta
- Signing: unsigned internal build; SmartScreen instructions are part of the tester guide

The Mac `v0.1.0-alpha.1` artifacts remain unchanged. Windows work is a new release because it changes packaged runtime contents and platform behavior.

## Runtime Dependencies

Bun, Node.js, package-manager dependencies, and the source tree are build-machine dependencies only. Testers install one Guai Code package and do not install Bun or Node.js.

Git for Windows is bundled as MinGit inside the application at `resources/mingit`. The application prepends `resources/mingit/cmd` to its own Windows process environment before the embedded server starts. This environment is inherited by the embedded server and tools, but the installer does not modify the machine or user PATH, Git configuration, registry associations, context menus, or an existing Git installation.

The pinned dependency is the official Git for Windows release:

- Release: `v2.55.0.windows.3`
- Asset: `MinGit-2.55.0.3-64-bit.zip`
- SHA-256: `f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05`

The build fails closed if the downloaded archive hash differs. MinGit's `LICENSE.txt` stays in the bundled tree and is copied beside the installer for review.

## Packaging Architecture

`package-internal-windows.ts` is the single entry point for Windows internal builds. It:

1. Requires Windows x64.
2. Sets the Beta channel and disables publishing.
3. downloads or reuses the pinned MinGit archive and validates its SHA-256.
4. Extracts MinGit into ignored staging output.
5. Rebuilds the embedded server and renderer from current source.
6. Runs electron-builder for NSIS x64.
7. Verifies the unpacked executable, installer, MinGit executable, licenses, and expected unsigned/valid signature state.
8. Creates a portable ZIP from `win-unpacked` as a fallback.
9. Copies the installer, ZIP, tester guide, OpenCode MIT license, and Git for Windows license into a versioned delivery directory.
10. Writes a deterministic SHA-256 manifest.

The final delivery directory is:

```text
packages/desktop/dist/internal-beta/0.1.0-alpha.2/windows-x64/
```

It contains:

```text
Guai-Code-Beta-0.1.0-alpha.2-win-x64.exe
Guai-Code-Beta-0.1.0-alpha.2-win-x64-portable.zip
Guai-Code-Beta-Windows-试用说明.md
OpenCode-MIT-License.txt
Git-for-Windows-License.txt
SHA256SUMS.txt
```

## Runtime Environment

The bundled Git resolver is a small, pure product module. It enables bundled Git only when all conditions are true:

- platform is `win32`;
- Electron reports a packaged application;
- `resources/mingit/cmd/git.exe` exists.

When enabled, it places the bundled `cmd` directory before the inherited PATH while preserving the rest of the user's environment. Development builds and non-Windows products remain unchanged. Missing bundled Git does not prevent application startup; it is logged and the user's existing PATH remains available.

## Windows Verification

A dedicated GitHub Actions workflow runs on a real GitHub-hosted Windows x64 runner. It performs source tests and type checking, calls the internal packaging command, and then runs an installed-package smoke script.

The smoke script:

- verifies installer metadata and expected signature state;
- silently installs into a temporary per-user directory;
- verifies `Guai Code Beta.exe`, product version, bundled licenses, and MinGit;
- executes bundled `git.exe --version`;
- launches the installed app with isolated Electron and XDG directories;
- waits for the packaged log to report `server ready`;
- restarts with the same isolated profile and requires a second `server ready`;
- confirms no model profile was imported from the build machine;
- silently uninstalls and verifies the installed directory is removed;
- uploads the delivery files and smoke evidence regardless of later download steps.

Automated App, Desktop, OpenCode, and package type checks remain release gates. The downloaded artifacts are rehashed on the Mac after GitHub Actions completes, and exact hashes, run URL, source commit, installer metadata, and known SmartScreen limitations are recorded in the Windows verification document.

## Error Handling And Security

- A non-Windows or non-x64 host receives an explicit packaging error.
- MinGit network, checksum, or extraction failure stops the build.
- Missing installer, unpacked executable, license, or bundled Git stops the build.
- Invalid Authenticode status stops verification. `NotSigned` is accepted only for this internal Beta; `Valid` is also accepted for a future signed build.
- The workflow does not receive model API keys or signing credentials.
- Delivery artifacts are scanned for known plaintext credential canaries.
- No upstream OpenCode update feed is enabled or published.

## Non-Goals

- Windows ARM64 and Windows 10 qualification
- Public release or automatic update hosting
- Microsoft code-signing certificate acquisition
- System-wide Git installation or shell associations
- WSL installation or configuration
- Bundling arbitrary developer tools beyond MinGit
