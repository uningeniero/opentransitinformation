<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Contributing

Project: https://opentransitinformation.org

Use the issue tracker for reproducible technical defects. Include the package version, a minimal synthetic/open-data input, expected output and the QA report. Keep credentials and private datasets out of reports.

Geometry belongs in the Rust core. Update the relevant technical specification before changing public behaviour. JavaScript handles adapters, transport and presentation. Preserve source IDs, licences and explicit review provenance.

Run the build, Node tests, TypeScript checks, package audit and release-version check before submitting a pull request. For rendering changes, also run `npm run test:browser`, `npm run test:design` and `npm run test:osm-browser` from the package folder. Use the embedded font for visual checks.

Code is Apache-2.0 and documentation is CC-BY-4.0. Add the appropriate SPDX header. Preserve third-party notices. Sign contributions with `git commit -s`. Use branch `main` as the contribution base. Package, Rust crate, npm release and GitHub tag/release versions must agree.
