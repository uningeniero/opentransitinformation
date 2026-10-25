<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Demonstrative route motion

`createMotionPlan(diagram, options)` prepares a deterministic frame sequence from an existing engine layout. `diagram` supplies `layout` and `network`; it may be a complete `createDiagram` result. `options.mode` is explicitly `demo`. Timing is illustrative and does not read a vehicle feed or infer a timetable.

Rust owns the resolved path, cumulative distance, projected stop anchors, tangent, progress, dwell intervals and frame positions. JavaScript selects a prepared frame from elapsed demonstration time and updates the DOM. It does not interpolate route geometry. Each vehicle references an existing `routeId` and `part`; disconnected parts are never joined.

The layout exposes `motionStops` on each path: declared stop IDs and their fractions along the core's drawn polyline. These anchors use the same source-specific stop positions and path as the station layout. Frames follow that polyline, including the core's sampled corners. Open paths fade at their ends before restarting; no connecting segment is invented. Closed paths retain continuous visibility. Stops are presentation anchors, not boarding predictions.

The cycle duration defaults to 30000 ms and is an integer from 4000 to 120000. Frame rate defaults to 60 and is an integer from 1 to 60. Dwell defaults to 450 ms per interior declared stop and is bounded to 0..5000 ms. Total dwell must leave at least half the cycle for movement. Up to 16 vehicles and 60000 vehicle frames are allowed. Vehicle IDs are unique, `part` is a non-negative integer and phase is in `[0, 1)`. Missing path stop anchors produce movement without stop dwells.

`motionFrame(plan, elapsedMs)` selects a deterministic prepared frame, wrapping at the cycle duration. It returns vehicle identity, route/part, position, heading, progress, opacity and any dwell stop. Non-finite or negative elapsed time is rejected. The serialisable plan and frame API work in Node and browsers.

`mountVehicleMotion(container, plan, options)` adds the original neutral vehicle glyph to an existing SVG in the same layout coordinate system. Cropping through the SVG viewBox does not change the plan. The glyph stays approximately 18 by 10 CSS pixels inside a 24-pixel footprint as the SVG is resized or zoomed. It does not intercept route/station interaction. Static network labels and the underlying diagram remain available.

The component displays `Illustrative route movement` and a visible keyboard-operable Play/Pause control. Autoplay is opt-in. Reduced-motion preference prevents autoplay and a change to reduced motion pauses it. An explicit Play action can start the demonstration. Hidden documents and offscreen components suspend the clock; resuming does not skip the hidden interval. `pause`, `play`, `seek`, `getState` and `destroy` are exposed. Destroy cancels callbacks and removes only the component's own elements/listeners. No audio is played.

`createDiagram(network, {motion: {...}})` includes the plan without changing static geometry or SVG. `mountViewer` attaches it as `viewer.motion`; self-contained `toHtml` exports include the same component and controls. Motion is absent unless requested. A renderer must retain the illustrative label alongside motion and preserve actual network/source metadata.

Viewer route buttons take their accessible names from their visible code and name, separated by a text space. The motion control also uses its visible text as its accessible name.

Vehicles follow the viewer's route dimming and are omitted from print output. Updating OpenStreetMap context preserves the user's pause choice and elapsed demonstration time.
