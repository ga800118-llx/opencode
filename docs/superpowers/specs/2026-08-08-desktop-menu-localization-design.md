# Desktop Menu Localization Design

## Objective

When the application language is Simplified Chinese, every user-visible label in these desktop interaction surfaces must be Chinese:

1. The macOS application menu bar and every submenu item.
2. The Electron right-click context menu, including editing, link, image, media, and development actions.
3. The prompt composer add menu opened from the plus button.

The change must preserve menu behavior, keyboard shortcuts, native editing roles, and the existing multilingual renderer. Changing the application language must update native menus without requiring a restart.

## Current State

- `packages/app/src/desktop-menu.ts` stores English labels. In `packages/desktop/src/main/menu.ts`, role-based entries discard those labels and let Electron choose system-language copy.
- `packages/desktop/src/main/index.ts` installs `electron-context-menu` without its `labels` option, so Copy, Paste, Save Image, Copy Link, and Inspect Element remain English on an English macOS installation.
- `packages/session-ui/src/v2/components/prompt-input/index.tsx` hardcodes the plus-menu labels and several adjacent prompt labels in English even though the app dictionaries already contain translations.
- The renderer stores the selected locale, but the main process has no narrow channel for receiving locale changes.

## Chosen Approach

Use the application locale as the source of truth.

- `zh` receives complete Simplified Chinese native-shell copy.
- `zht` receives complete Traditional Chinese native-shell copy.
- Other locales retain the current English native-shell fallback in this task. The in-app prompt menu continues to use the app's complete existing locale dictionaries.
- The renderer sends only a validated locale identifier to the main process. It does not send arbitrary menu labels.

This avoids coupling native menus to the operating-system language and prevents untrusted renderer text from becoming native menu configuration.

## Architecture

### Shared desktop menu definition

Replace user-visible string literals in the shared desktop menu definition with stable label identifiers. A small copy resolver returns English, Simplified Chinese, or Traditional Chinese text and interpolates the runtime product name where macOS conventions include it.

Every role-based entry receives an explicit resolved label. Electron roles remain attached so Undo, Redo, Cut, Copy, Paste, Select All, Hide, Quit, and zoom behavior continue to use native commands and accelerators.

The menu template builder will be pure and exported for tests. The side-effecting `createMenu` function only installs the already-resolved template.

### Native locale controller

The desktop main process owns a small locale controller with these responsibilities:

- Normalize renderer input to the supported application locale vocabulary.
- Hold the current locale.
- Rebuild the macOS application menu after a locale change.
- Dispose and reinstall `electron-context-menu` with labels for the new locale.
- Avoid work when the locale has not changed.

The preload exposes a single `setApplicationLocale(locale)` method. The desktop platform implementation forwards it, and the app language provider calls it reactively. Web builds receive no native-locale implementation.

### Right-click context menu

Configure every label supported by the installed `electron-context-menu` version, not only Copy and Paste:

- spelling, lookup, and search labels;
- Cut, Copy, Paste, and Select All;
- image and video copy/save labels;
- link copy/save labels;
- Inspect Element and Services.

Currently hidden actions remain translated so enabling them later cannot reintroduce English copy.

### Prompt composer copy

Add a typed copy object to `PromptInputV2`. English defaults remain inside the reusable component for backward compatibility, while the app passes localized strings from `useLanguage()`.

The copy object covers:

- plus-button tooltip and accessible name;
- Images and files, Commands, Context, and Shell command menu items;
- empty result, drag-to-attach, remove attachment, prompt accessible name;
- choose agent, choose model, choose model variant;
- Send and Stop.

Existing app translation keys are reused where available. New keys are added only for concepts that do not already have an appropriate key, with locale parity preserved.

## Behavioral Requirements

- With application locale `zh`, no English action label remains in the macOS menu bar, native context menu, or prompt add menu.
- Product names such as `Agent Desktop Dev` remain brand names and are not translated.
- Keyboard accelerators and command IDs remain unchanged.
- Native roles continue to execute through Electron rather than custom clipboard code.
- Changing the app language updates subsequent native menus during the same process lifetime.
- Context-menu localization applies to all current and future application windows registered by the global context-menu handler.
- No arbitrary renderer-provided strings are accepted as labels.

## Testing

### Unit and type tests

- Verify every desktop menu label identifier resolves for English and Simplified Chinese.
- Build the Simplified Chinese native template and assert all expected top-level and submenu labels, explicit labels for role items, unchanged commands, roles, and accelerators.
- Verify the context-menu label object covers every supported `Labels` field and contains expected Chinese editing/media labels.
- Verify locale normalization rejects unsupported values and suppresses duplicate rebuilds.
- Render the prompt add menu with Chinese copy and assert its tooltip/accessibility label and all four menu items.
- Run app, session-ui, and desktop type checks plus app i18n parity tests.

### Packaged macOS verification

- Launch a newly packaged arm64 app with application locale set to Simplified Chinese.
- Open every top-level native menu and confirm all visible action labels are Chinese.
- Right-click editable text and confirm Cut, Copy, Paste, and Select All are Chinese.
- Right-click a link or image and confirm the relevant copy/save labels are Chinese.
- Open the prompt plus menu and confirm every item is Chinese.
- Switch away from Chinese and back during the same run, then confirm native and renderer menus refresh.

## Out of Scope

- Translating the product brand name.
- Adding native application menus on Windows where the app currently installs none.
- Completing native-shell translations for every non-Chinese locale.
- Changing command behavior, shortcuts, clipboard semantics, or attachment support.
