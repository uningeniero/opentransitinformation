<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Deterministic demonstrative motion

The package provides the vehicle-motion component consumed by the website and offline HTML exports. Route geometry, distance-based progress, stop anchors, dwell intervals and prepared poses belong to the Rust core. Browser code owns the clock, frame selection, controls and DOM presentation.

Prepared bounded frame sequences avoid recomputing layout or spawning a worker for every animation frame. They retain the actual rendered route parts and sampled corners. Open paths fade at their ends before restarting rather than inventing a return connection. A vehicle never traverses an undeclared path part. Demonstration timing remains distinct from operator timetables and live positions.

Autoplay is opt-in and disabled initially by reduced-motion preference. A persistent native button controls the same component in standalone SVG and the complete viewer. Hover, keyboard interaction, hidden documents and offscreen maps suspend its clock. User pause remains authoritative. No audio is started.

The implementation is additive: existing static diagram geometry, source identifiers, labels and QA remain. Published archives and previously prepared tags stay immutable. A feature release pairs the new package with its exact public source, tag, archive and registry verification before website adoption.
