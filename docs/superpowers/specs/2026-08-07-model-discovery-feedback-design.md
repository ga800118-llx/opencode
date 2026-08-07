# Model Discovery Feedback And Long-List Design

**Date:** 2026-08-07
**Status:** Approved for implementation
**Scope:** Model source create/edit dialog in Agent Desktop

## Summary

The model source dialog currently performs discovery but makes failures and
large successful results effectively invisible. Discovery feedback renders
below the visible dialog body, while the body computes to `overflow: hidden`.
An edited source with 33 models produces more than 2,000px of content inside a
369px viewport, leaving only part of the first model row visible and preventing
wheel or trackpad access to the remaining models.

This change makes discovery state visible next to the action that caused it,
adds a bounded searchable model-results list, restores dialog-body scrolling
for small windows and advanced settings, and preserves existing model results
when a discovery attempt fails. It does not change provider persistence,
credential storage, model probing, or the OpenCode runtime.

## Goals

1. Make validation, progress, success, and failure visible without scrolling.
2. Distinguish malformed URLs, unreachable endpoints, rejected credentials,
   incompatible APIs, timeouts, and successful discovery in localized copy.
3. Make 1, 33, and 100 discovered models searchable and reachable with mouse,
   trackpad, and keyboard input.
4. Keep existing models intact when rediscovery fails.
5. Keep the dialog usable at 1024x768, 1440x900, and compact desktop sizes.
6. Preserve the existing macOS Keychain and credential-redaction boundaries.

## Non-Goals

- Changing the model discovery protocol or adding provider-specific probes.
- Automatically appending `/v1` to every endpoint.
- Replacing the model source dialog with a new full-page editor.
- Adding model virtualization before measured scale requires it.
- Changing how profiles are saved, enabled, tested, or selected as default.

## Approaches Considered

### A. Bounded searchable results list

Keep the existing dialog and controller, place discovery feedback beside the
discovery controls, restore outer-body scrolling, and constrain the model list
to a scrollable region. This keeps the current persistence and selection model
while scaling to large provider catalogs. Selected.

### B. Outer dialog scrolling only

Forcing the whole dialog to scroll would expose the hidden content, but dozens
of models would still create a very long form and separate the discovery
button, selected model, capability test, and footer. Rejected as incomplete.

### C. Dedicated model-source page

A full page would provide more room but would increase navigation and
implementation scope for a focused dialog defect. Deferred.

## Interaction Design

### Discovery states

The model section owns one explicit presentation state:

| State | Visible result |
| --- | --- |
| Idle | No status message |
| Invalid input | Inline localized validation message |
| Discovering | Disabled button, spinner/progress label, polite status text |
| Success | `Found N models` status and visible model list |
| Failure | Localized error plus a specific recovery action |

The status block sits directly below the discovery/manual-add controls and
above the result list. It uses `role="status"` and `aria-live="polite"` for
progress and success. Failures use an assertive announcement without moving
focus away from the endpoint field or discovery button.

### Error mapping

The UI maps the safe product diagnostic to actionable copy:

- malformed URL: enter a complete HTTP or HTTPS endpoint;
- unreachable endpoint: check the address and service availability;
- authentication: update the API key or model permissions;
- incompatible API: verify the OpenAI-compatible base URL and whether `/v1`
  is missing;
- timeout: check the network or increase the timeout;
- TLS: fix the endpoint certificate;
- unknown: retry and retain the safe request ID for diagnostics.

Raw response bodies, credentials, request headers, and provider messages never
render. Existing redaction remains the security boundary.

### Successful results

Success renders a count and a search field. The model list:

- has a responsive maximum height between 280px and 340px;
- scrolls independently with stable scrollbar space;
- supports model-name and model-ID substring search;
- keeps each row at a stable minimum height;
- shows the display name and ID on separate lines;
- truncates long text visually without changing the accessible name;
- retains radio selection and the existing remove action.

An empty search result is distinct from an endpoint that returned no models.
Manual model IDs remain in the same list and participate in search.

### Rediscovery behavior

Discovery is transactional from the user's perspective. A successful response
reconciles discovered models with manual entries. A failed response leaves the
current list and selection unchanged and updates only the visible diagnostic.
Stale responses remain ignored by the existing generation counter.

Changing source type, endpoint URL, or API key clears stale feedback. Saved
models remain visible until a later successful discovery replaces the
discovered subset, so a transient outage cannot erase usable configuration.

## Layout

The dialog keeps a fixed header and footer. Its body must compute to vertical
scrolling rather than hidden overflow so advanced settings stay reachable at
small heights. The model list provides the bounded inner scroll region so a
large catalog cannot expand the form by thousands of pixels.

The first result row must be fully visible immediately after discovery. The
footer must not overlap list rows, capability controls, diagnostics, or
advanced settings.

## Component Boundaries

- `model-center-controller.ts` owns transactional discovery results, search
  input, filtered models, and the safe diagnostic object.
- `dialog-model-profile.tsx` renders status, count, search, and result states.
- `model-center-copy.ts` maps diagnostic kinds to localized user actions.
- `settings-v2.css` owns dialog and list scrolling, stable row dimensions, and
  responsive constraints.
- Existing desktop probe, IPC, Keychain, and runtime configuration modules are
  unchanged unless a test proves a contract defect.

## Testing

1. Controller tests cover successful count, localized-feedback inputs,
   preserving models on failure, stale responses, and name/ID search.
2. Component tests cover visible progress, success, failure, no-results search,
   and accessible status semantics.
3. CSS/renderer checks assert vertical scrolling, bounded list height, complete
   first-row visibility, reachable last row, and non-overlapping footer.
4. Desktop QA uses invalid URL, rejected credential, 1 model, 33 models, and
   100 models at compact and standard viewport sizes.
5. Secret scans confirm API keys never appear in rendered text, logs, fixtures,
   screenshots, or serialized profile data.

## Acceptance Criteria

1. A malformed or unreachable endpoint produces a visible Chinese or English
   message without scrolling.
2. A rejected API key is reported as an authentication problem.
3. An HTML/non-API endpoint suggests checking the API base URL and `/v1`.
4. Success reports the discovered model count.
5. The first row is fully visible, and the last of 33 or 100 models is reachable
   through normal scrolling.
6. Search matches display names and exact/raw model IDs.
7. Failed rediscovery preserves the pre-existing model list and selection.
8. Header and footer remain fixed and do not cover content.
9. Advanced settings remain reachable in compact windows.
10. No protected runtime package changes are required.
