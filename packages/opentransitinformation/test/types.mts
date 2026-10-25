// SPDX-License-Identifier: Apache-2.0
import {
  createDiagram,
  createMotionPlan,
  motionFrame,
  mountVehicleMotion,
  fromText,
  mountViewer,
  extractDocument,
  confirmExtraction,
  loadOpenStreetMap,
  withOpenStreetMap,
  mountOpenStreetMapViewer,
  fromOpenStreetMapRoute,
  type Network,
  type DiagramOptions
} from '../dist/index.mjs';
import { toHtml } from '../dist/node.mjs';
const options: DiagramOptions = {
  profile: 'schematic',
  width: 1200,
  generatedAt: '2026-10-23T00:00:00Z'
};
const network: Network = await fromText('1: A > B');
const diagram = await createDiagram(network, options);
const motionPlan = await createMotionPlan(diagram, {
  mode: 'demo',
  autoplay: false
});
const frame = motionFrame(motionPlan, 1000);
const motion = mountVehicleMotion(document.createElement('div'), motionPlan);
motion.seek(frame.timeMs);
motion.pause();
const paused: boolean = motion.getState().requestedPlaying;
motion.destroy();
const svg: string = diagram.svg;
const html: string = await toHtml(network, options);
const viewer = await mountViewer(
  document.createElement('div'),
  network,
  options
);
viewer.selectRoute(network.routes[0].id);
viewer.setView(viewer.getView());
viewer.motion?.pause();
const draft = await extractDocument(new Uint8Array(), {
  mimeType: 'image/png',
  extractor: async () => ({ network, confidence: 0.8 })
});
confirmExtraction(draft, { author: 'Reviewer', reason: 'Checked' });
console.log(svg, html, paused);
const bounds: [number, number, number, number] = [-0.16, 51.49, -0.13, 51.52];
const snapshot = await loadOpenStreetMap({ bounds, maxAgeMs: 86400000 });
const city = withOpenStreetMap(
  { ...network, coordinateSystem: 'wgs84' },
  snapshot
);
const live = await mountOpenStreetMapViewer(
  document.createElement('div'),
  city,
  {
    openStreetMap: { bounds, refreshOnLoad: false },
    backgroundStyle: 'atlas'
  }
);
const refreshed: boolean = (await live.refresh()).updated;
await fromOpenStreetMapRoute(
  { elements: [] },
  {
    relationId: 1,
    selectedStops: [
      { id: 'a', nodeId: 2 },
      { id: 'b', nodeId: 3 }
    ]
  }
);
live.destroy();
console.log(refreshed);
