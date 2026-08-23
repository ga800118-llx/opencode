# Message File Actions Design

## Goal

Make file references in assistant replies behave like desktop file links without changing model, session, permission, server, or tool-call behavior.

All file types are eligible. Markdown is only the transport used by the reply to render blue linked text; it does not limit the target to `.md` files.

## Interaction

- A single click opens the referenced file in the existing Guai Code file panel.
- A double click opens the file with the operating system's default application.
- A context menu offers internal open, default open, installed editor choices, reveal in Finder/File Explorer, and copy path.
- Hovering a valid reference uses a pointer cursor, brightens the text, and adds an underline; the resolved full path remains available as the native title.
- Web links continue to open as web links.
- Missing, malformed, or out-of-workspace paths never execute a desktop action.

The existing file viewer remains authoritative for internal preview. Text, source, images, SVG, audio, and binary fallback behavior are reused as-is. This feature does not add PDF, Office, archive, or video renderers; those files remain available to the system default application and Finder/File Explorer regardless of extension.

## Architecture

### Reference Parsing

Add a pure message-file-reference module under the session timeline. It parses the raw `href` attribute from links and the text of inline code classified by the Markdown renderer as a path, then rejects `http`, `https`, `mailto`, fragments, and unsupported URI schemes.

The parser accepts relative paths, POSIX absolute paths, Windows drive and UNC paths, `file://` URLs, percent-encoded names, Unicode names, spaces, files without extensions, and optional line suffixes. Resolution is lexical and workspace-contained: relative references are resolved below the active session directory, and absolute references are accepted only when they are inside that directory. `..` traversal outside the workspace is rejected.

### Message Interaction Controller

Add a focused SolidJS controller for the message timeline. Event delegation stays on the existing timeline scroll surface so the streaming Markdown renderer and every message part do not need new props or lifecycle work.

The controller will only react when an event target is inside `[data-component="markdown"] a[href]` or `[data-inline-code-kind="path"]` and the raw reference resolves to a workspace file. It will:

- use `useFile`, `useSessionLayout`, and `createOpenSessionFileTab` for internal tabs;
- use `platform.openPath` for the default application or a selected installed editor;
- use `platform.revealPath` for Finder/File Explorer;
- use the Clipboard API for copying the absolute path;
- use the existing OS-specific editor lists and app availability check;
- use a controlled `MenuV2` anchored at the pointer for context actions.

The timeline keeps its existing click callback and scroll behavior. Non-file targets are ignored without preventing their default behavior.

### Local And Remote Sessions

Internal preview uses the server file API and therefore works for local and remote sessions.

Desktop open, reveal, and installed-application actions are available only when the active server scope is local and the desktop platform exposes the corresponding capability. Remote sessions retain internal open and copy-path actions; a remote path is never passed to the local operating system.

## Error Handling

- Internal load errors remain visible in the existing file tab.
- `openPath`, `revealPath`, app detection, and clipboard failures use the existing request-failed toast pattern.
- A false result from `revealPath` produces a file-not-found toast.
- An invalid or escaping path-like reference is intercepted, reports an error, and does not navigate or open a local path.
- Repeated clicks reuse the existing normalized file tab instead of creating duplicate tabs.

## Testing

- Unit-test parsing and resolution for macOS, Windows, UNC, relative, encoded, Unicode, extensionless, and line-suffixed files.
- Unit-test rejection of web URLs, fragments, unsupported schemes, sibling-prefix absolute paths, and escaping relative paths.
- Component-test event delegation so file links are intercepted while external links are not.
- Run focused Bun tests and `bun typecheck` from `packages/app`.
- Run the application production renderer build and inspect the final diff for unrelated changes.
- Perform manual Mac checks for text, PDF/Office, image, archive, missing file, default open, Finder reveal, and copy path. Package-level Windows verification can follow without changing this implementation.

## Scope Guard

This change does not modify:

- model configuration, discovery, or credentials;
- prompt admission, model execution, or tool calls;
- task naming, history, or tab reconciliation;
- permission modes or timers;
- server protocols or generated SDKs;
- desktop startup, Sidecar supervision, packaging, or update behavior;
- generic Markdown rendering outside the task message timeline.
