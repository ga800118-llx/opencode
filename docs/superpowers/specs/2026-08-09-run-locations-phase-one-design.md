# Run Locations Phase One Design

## Goal

Keep the existing multi-server architecture while removing server terminology and controls from the default Simple experience. Advanced mode presents the same capability as **Run locations**, using task-oriented language such as **This device** and **Add remote computer**.

## Scope

Phase one changes presentation only. It does not change server protocols, authentication, persistence, health polling, model credentials, or remote deployment.

## Presentation Policy

- Advanced mode exposes all configured run locations and their management controls.
- Simple mode exposes only the currently active run location, so existing remote configuration is preserved but cannot be browsed or changed.
- Simple mode hides the run-location settings tab, the switch command, and the title-bar status popover.
- When Simple mode is using a remote location, the title bar shows a compact, read-only `Running remotely` indicator so execution placement is never ambiguous.
- Changing from Advanced to Simple never deletes connections or silently switches the active location.

## Settings

- The settings group containing Models, Providers, Run locations, and Skills is titled `Agent` rather than `Server`.
- The Run locations tab appears only in Advanced mode.
- A stale or direct request for the hidden tab resolves to General settings.
- The `Server status` visibility setting appears only in Advanced mode and is renamed `Run status`.

## Run Location Language

- Built-in sidecar: `This device` / `本机`
- Server management: `Run locations` / `运行位置`
- Add action: `Add remote computer` / `添加远程电脑`
- Default action: `Use on startup` / `启动时使用`
- Default badge: `Startup` / `启动默认`
- Connection fields retain address, username, and password semantics without exposing internal sidecar terminology.

## Home And Commands

- Advanced mode keeps the existing multi-location project grouping and row menus.
- Simple mode supplies only the active connection to the Home project view, which naturally removes server grouping and management menus.
- The command palette registers the run-location switch command only in Advanced mode.

## Failure Behavior

This phase retains existing connection and sidecar recovery behavior. It only prevents Simple mode from presenting alternate-server switching as a normal workflow. Existing remote failures remain recoverable by returning to Advanced mode.

## Testing

- Unit-test the presentation policy for Simple local, Simple remote, and Advanced states.
- Unit-test filtering so Simple keeps only the active location without mutating the stored list.
- Exercise settings and title-bar presentation in component tests where practical.
- Run package tests and type checks.
- Build and launch the Mac desktop package, then verify both modes visually.

## Non-Goals

- Remote server installer or pairing codes
- Credential synchronization to remote servers
- HTTPS or VPN provisioning
- Multi-user authorization
- Background task durability changes

