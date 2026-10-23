// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const cargo = await readFile(new URL('../../../core/oti-engine/Cargo.toml', import.meta.url), 'utf8');
const cargoLock = await readFile(new URL('../../../core/oti-engine/Cargo.lock', import.meta.url), 'utf8');
assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].version, pkg.version);
assert.equal(cargo.match(/^version = "([^"]+)"/m)[1], pkg.version);
assert.equal(cargoLock.match(/name = "oti-engine"\s+version = "([^"]+)"/)[1], pkg.version);
assert.equal(pkg.homepage, 'https://opentransitinformation.org');
assert.equal(pkg.repository.url, 'git+https://github.com/uningeniero/opentransitinformation-engine.git');
assert.equal(pkg.bugs.url, 'https://github.com/uningeniero/opentransitinformation-engine/issues');
if (process.env.GITHUB_REF?.startsWith('refs/tags/')) assert.equal(process.env.GITHUB_REF.slice(10), `v${pkg.version}`);
console.log(JSON.stringify({ name: pkg.name, version: pkg.version, tag: `v${pkg.version}`, repository: pkg.repository.url, homepage: pkg.homepage, checked: true }));
