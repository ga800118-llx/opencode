# Device Skill Inventory Design

## Goal

Make Skills settings a device-level management surface. Users can open it from
Home or a task and see every Skill discovered from global, shared, built-in,
plugin, configured, and known project sources without first selecting a
project.

Execution remains location-scoped. A project-local Skill is still available
only where the runtime already exposes it; this change only unifies discovery
and management in the desktop settings UI.

## Decisions

- The settings dialog builds an ordered, unique list of location directories
  from the active task, the recent project, every known project, and the global
  config directory.
- The Skills page requests management snapshots for those directories and
  aggregates them in the app. No Protocol, Server API, or runtime discovery
  changes are required.
- Repeated snapshots of the same installation are deduplicated by management
  ID. Distinct installations with the same Skill name are then presented as
  one logical device-level row.
- A logical row is enabled when at least one installation is enabled. Changing
  its switch applies the requested state to every installation represented by
  the row, using the location context that discovered each installation.
- A single-installation row keeps the existing recoverable delete behavior.
  Multi-installation rows do not offer bulk deletion because deleting several
  sources behind one confirmation would be ambiguous and unnecessarily risky.
- Existing source, scope, status, path, filtering, refresh, and protected-source
  behavior remains. A merged row indicates additional sources without adding
  a second management hierarchy.

## Data Flow

1. `DialogSettings` resolves the device location list from desktop project
   state and the active route.
2. `SettingsSkillsV2` loads each location through the existing Skill management
   API.
3. The controller deduplicates installations by ID, groups them by name, and
   chooses a stable representative for display.
4. Polling, focus refresh, and manual refresh replace the query cache with a
   newly aggregated snapshot.
5. Enable or disable operations target every installation in the logical row,
   then refresh the complete device inventory.

## Error Handling

- A failed location request fails the initial device query so the page does not
  silently claim that no Skills are installed.
- After a successful snapshot, refresh failures retain the last successful
  inventory and show the existing refresh warning.
- Empty or duplicate project paths are removed before any requests are made.
- If no location can be resolved, the existing location-required state remains
  as a final fallback.
- A partially failed multi-installation toggle is followed by a full refresh so
  the UI reflects the states actually persisted by the server.

## Performance

- Device aggregation runs only while the Skills tab is active.
- Each unique location is requested once per refresh cycle.
- The existing periodic refresh remains available for Skills installed by an
  external process, but other settings tabs do not poll Skill locations.

## Verification

- Directory tests cover active, recent, project-list, global-only, and duplicate
  paths.
- Controller tests cover ID deduplication, same-name grouping, stable display
  selection, filters, and logical enabled state.
- Browser tests open Skills from Home, return different project snapshots, and
  prove that duplicate names render once.
- Existing Skill mutation, cold-start, refresh, and source-label tests continue
  to pass.
