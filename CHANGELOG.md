<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Changelog

## 0.4.0

- Add optional demonstrative vehicle motion to existing rendered route parts, with distance-based frames and declared stop dwells calculated in Rust.
- Expose `createMotionPlan`, `motionFrame`, `mountVehicleMotion` and `viewer.motion`; self-contained HTML uses the same component.
- Add keyboard Play/Pause controls, reduced-motion handling and clock suspension for hover, focus, hidden documents and offscreen maps.
- Preserve motion pause and elapsed time when OpenStreetMap context is refreshed.
- Use visible route button text for accessible names.
- Include the diagnostics and documentation corrections prepared for unpublished 0.3.3 and 0.3.4.

## 0.3.4 (unreleased)

- Clarify diagnostics for unsupported constraints, extracted networks and required GTFS tables.
- State CSV and route-text size limits in UTF-16 code units.
- Describe duplicate OSM object handling and the stop-order requirement for OSM route chains.
- Include the rendering labels, count grammar, CLI help and documentation changes prepared for the unpublished 0.3.3 release.

## 0.3.3 (unreleased)

- Use the effective rendering mode for map footer labels.
- Label geographic output `Geographic map` in English and `Mapa geográfico` in Spanish.
- Use singular and plural forms for search results, map descriptions and stop counts in English and Spanish.
- Include the existing `--width`, `--height` and `--colors` CLI options in `--help`.
- Describe keyboard controls and textual route alternatives in package documentation and metadata.

## 0.3.2

- Use the canonical repository and software name `opentransitinformation`.
- Update source, issue and citation links.
- Preserve the 0.3 geometry and map APIs.

## 0.3.1

- Link the package to its public source repository and issue tracker.
- Include explicit project attribution to https://opentransitinformation.org.
- Add checks for matching npm, crate and GitHub release versions.
- Preserve the 0.3 geometry and map APIs.
