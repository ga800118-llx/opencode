# Desktop Icons

The desktop icon assets are generated from the shared Guai G geometry. Do not edit the generated PNG, ICO, ICNS, or favicon files by hand.

From `packages/desktop`, run:

```sh
bun run brand:icons
```

The generator requires macOS because it uses `sips` and `iconutil` to render the source SVG and build the ICNS file. It updates the top-level desktop assets for the `dev`, `beta`, and `prod` channels, plus the UI favicon assets. Platform-specific legacy folders are intentionally left unchanged.

The packaged macOS icon and the unpackaged Dock icon are produced from the same master artwork so their geometry and inset stay consistent.
