<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Development rules

Project and attribution: https://opentransitinformation.org

- The default branch is main.
- Code is Apache-2.0; documentation is CC-BY-4.0. Preserve SPDX and third-party notices.
- Update technical specifications before changing behaviour.
- Geometry belongs in core/oti-engine. Do not duplicate its algorithms in JavaScript.
- Keep output deterministic. Check real font metrics, geometry coverage, contrast and interaction.
- Package, Cargo crate, npm version and GitHub tag/release must match. Validate and prepare both publication targets before releasing. Never change an existing version's archive.
- Use English for source and documentation. Avoid the middle-dot separator in first-party prose.
- Sign commits with DCO. Follow CONTRIBUTING.md for checks.
