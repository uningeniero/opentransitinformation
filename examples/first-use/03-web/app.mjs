// SPDX-License-Identifier: Apache-2.0
import { mountViewer } from './vendor/browser.mjs';

const status = document.querySelector('#status');
status.textContent = 'Loading the interactive map.';
try {
  const response = await fetch('./network.json');
  if (!response.ok) throw new Error(`Input request failed: HTTP ${response.status}`);
  const network = await response.json();
  const viewer = await mountViewer(document.querySelector('#interactive-map'), network, {
    generatedAt: '2026-10-27T00:00:00Z', width: 1000, height: 640
  });
  window.exampleViewer = viewer;
  document.querySelector('#static-map').hidden = true;
  status.textContent = 'Interactive map ready - 1 route and 3 stops.';
  status.dataset.state = 'ready';
} catch (error) {
  status.textContent = `Interactive map unavailable: ${error.code || error.name}. ${error.message} The static map and route list remain available.`;
  status.dataset.state = 'error';
}
