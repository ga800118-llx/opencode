# Guai Logo Refresh Design

## Goal

Adopt the approved negative-space G as the Guai Code product mark and produce
a Mac beta package whose application, Dock, launcher, splash, and in-app brand
surfaces use one coherent identity.

## Visual System

- The master mark is a clean geometric G reconstructed as vector geometry from
  the approved brand sheet. Raster crops from the sheet are not used as source
  assets.
- Desktop application icons use a near-black rounded square with a centered
  white G. The background is `#0D0D0D` and the mark is white.
- Compact in-app marks use the standalone G and inherit the existing light or
  dark theme icon color tokens.
- Brand wordmarks pair the G with `GUAI`. The formal product name remains
  `Guai Code`; bundle identifiers, storage namespaces, and channel names remain
  unchanged.
- Gold remains a secondary brand accent and is not used for the default app
  icon.

## Asset Scope

- Replace the UI `Mark`, `Splash`, and `Logo` vector geometry.
- Replace web/renderer favicon assets that currently contain the old mark.
- Replace the tracked Dev, Beta, and production desktop icon sets from one
  master so future packages do not regress to the old symbol.
- Regenerate `icon.icns` with the complete macOS icon size set and keep
  `dock.png` synchronized with the packaged icon.
- Generate the requested Mac package through the existing internal beta
  packaging workflow. No Windows package is produced in this task.

## Isolation

This change does not alter models, sessions, permissions, server behavior,
runtime configuration, package identity, user data, or update channels. Only
brand components, static image assets, their deterministic generator, and
focused asset tests may change.

## Verification

- Render and inspect the master icon at 1024, 256, 64, 32, and 16 pixels.
- Verify the G remains open and legible at the smallest sizes.
- Run UI and desktop typechecks plus focused branding/packaging tests.
- Build the desktop application and inspect the generated `.app` icon and DMG.
- Confirm the final package contains `Guai Code Beta.app` and no old icon
  resources at the primary application icon paths.
