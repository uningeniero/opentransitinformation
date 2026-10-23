<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# TSS 0.3 - Executable design profiles

OTI derives line width, lane spacing, corner radius, station symbols, label gaps and margins as a proportional system. Text is measured with the embedded font and rendered with the same quoted CSS family and weight. Preserve official names and their original characters. Route codes and colours provide redundant identification; colour alone never identifies a service. Transfers come from explicit shared stop IDs, never from a geometric crossing.

## Corridors and junctions

A corridor continues through degree-two vertices and straight continuations at branches. Its orientation propagates through the whole chain. The route covering the greatest corridor length keeps its axis; ties use stable route IDs. Routes sharing an edge occupy different persistent lanes, while routes that never coincide can reuse a lane. Reversing a path or reordering routes must preserve physical geometry. Octilinear elbow selection uses a canonical direction. Residual lane changes use bounded local tangent transitions, never a long diagonal across a straight interstation segment. Closed paths round the seam and do not invent a passenger terminus at the arbitrary first vertex.

Retain loops and complete source paths. Geographic corridor alignment only compares paths with an explicit shared stop and follows monotonic intervals of actual geometry. It never substitutes a shortest path. `corridorTolerance` bounds the displacement in output pixels: default 2 for geographic mode, 0 for schematic mode, maximum 20. Publish the maximum observed displacement in QA. This is cartographic generalisation, not evidence that nearby roads share infrastructure.

Collinear transfer anchors use a compact capsule on a consistent 0/45/90/135-degree axis. Dense anchors belonging to the same stop merge into one enclosing marker, including their actual outlines. Separate anchor groups use thin orthogonal transfer links behind their markers. Distinct stop IDs never merge. A transfer symbol crossing an unserved route is an error. Overlapping symbols from distinct stops are an error; auto-expansion may resolve them, otherwise strict export fails. All route geometry must fit the map frame.

Wheelchair accessibility does not inflate the station symbol. Confirmed accessibility adds a measured pictogram beside the name. Unknown accessibility remains unknown. Nearby labels associate by proximity; leaders are reserved for more distant labels, start outside the real symbol outline, and avoid routes, other symbols, labels and leaders. Long leaders remain explicit diagnostics. Editorial label-side preferences retain author and reason.

## Type, colour and interaction

The profiles require main type of at least 16 px; print uses 18 px. Required text contrast is at least 4.5:1 (7:1 for the high-contrast profile); essential graphic separation is at least 3:1. Route casings account for actual context paints rather than only the page background. A single contrasting casing is preferred; a black/white double casing protects mixed surfaces when needed. Insufficient lane space for that treatment is an error. These are scoped diagnostics, not a complete accessibility certification.

High-contrast route badges retain route colour in the border when the coloured fill cannot support 7:1 text. Colour-vision diagnostics use public Machado matrices in linear RGB. An sRGB distance below 35 between routes sharing a stop is a heuristic warning, not a WCAG criterion or a prediction of individual perception. Default color mode preserves source values; deterministic adaptive colouring is explicit and retains original assignments in metadata.

Profiles are `schematic`, `geographic`, `print` and `highContrast`. Titles, legends and validity panels wrap with final font metrics. SVG IDs and CSS are scoped per instance; consumers embedding repeated standalone diagrams supply distinct `idPrefix` values. The viewer assigns its own instance prefix, supports search, selection, keyboard, pan, pinch and a textual route alternative. A mobile overview is not a claim that every label is readable without zoom. Product copy defaults to English; explicit `locale: 'es'` provides a secondary Spanish interface without changing network names or geometry.

## Vector context

`backgroundStyle` accepts `none`, `subtle`, `atlas` and `mono`. Land, water, parks, urban areas, buildings, boundaries, streets and railways use distinct subordinate treatments. Every context layer is clipped to the map area with a local instance ID. Large or remote context never changes the network frame or covers the title, legend or footer. Polygon holes stay holes; rivers may be open lines. Polygon rings remain exact, while `backgroundSimplification` bounds line simplification to 0..3 output pixels (default 0.6).

Context names are secondary 16 px labels; water names are italic with measured advance and extra ink padding. They are considered only after all transport labels and must fit without interfering with routes, symbols, leaders or other labels. A context label may be omitted; it never displaces transport information. Label halos and accessibility-icon backplates preserve separation from supplied surfaces. Context is supplied by the consumer; no maps, names, sources, rights or live services are invented. Dark custom backgrounds are supported technical combinations, not an editorially approved official night theme.

Source research stays outside the npm distribution. The profiles are OTI design decisions and do not reproduce TfL branding, Johnston fonts or protected maps.
