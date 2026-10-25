// SPDX-License-Identifier: Apache-2.0
import { mountViewer } from './viewer.mjs';
import { loadOpenStreetMap, withOpenStreetMap } from './osm.mjs';
import { localeCopy } from './locale.mjs';
import { OtiError } from './model.mjs';

export async function mountOpenStreetMapViewer(container, input, options = {}) {
  const settings = options.openStreetMap;
  if (!settings?.bounds)
    throw new OtiError(
      'INVALID_OSM_OPTIONS',
      'openStreetMap.bounds is required'
    );
  const copy = localeCopy(options.locale);
  const controller = new AbortController();
  const osmOptions = { ...settings, signal: controller.signal };
  let network = input;
  const freshOnMount = network.metadata?.baseMap?.source !== 'OpenStreetMap';
  if (freshOnMount)
    network = withOpenStreetMap(network, await loadOpenStreetMap(osmOptions));
  let viewer = await mountViewer(container, network, options);
  let pending;
  let disposed = false;
  const doc = container.ownerDocument;
  const controls = doc.createElement('div');
  controls.className = 'oti-toolbar oti-osm-tools';
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = copy.updateBase;
  const status = doc.createElement('span');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const date = () =>
    viewer.diagram.network.metadata.baseMap.dataAsOf || copy.unknownDate;
  status.textContent = copy.baseSnapshot(date());
  controls.append(button, status);
  viewer.root.querySelector('.oti-toolbar').after(controls);
  const refresh = () => {
    if (disposed)
      return Promise.resolve({
        updated: false,
        error: new OtiError('VIEWER_DESTROYED', 'Viewer has been destroyed')
      });
    if (pending) return pending;
    button.disabled = true;
    status.textContent = copy.updatingBase;
    pending = (async () => {
      try {
        const snapshot = await loadOpenStreetMap(osmOptions);
        const nextNetwork = withOpenStreetMap(network, snapshot);
        const staging = doc.createElement('div');
        const nextViewer = await mountViewer(staging, nextNetwork, options);
        if (disposed) {
          nextViewer.destroy();
          return { updated: false };
        }
        const view = viewer.getView();
        const state = viewer.getState();
        nextViewer.setView(view);
        if (state.stopId) nextViewer.selectStop(state.stopId);
        else if (state.routeId) nextViewer.selectRoute(state.routeId);
        const restoreFocus = doc.activeElement === button;
        const motionState = viewer.motion?.getState();
        if (motionState && nextViewer.motion) {
          nextViewer.motion.seek(motionState.elapsedMs);
          if (
            motionState.requestedPlaying &&
            !nextViewer.motion.getState().reducedMotion
          )
            nextViewer.motion.play();
          else nextViewer.motion.pause();
        }
        viewer.destroy();
        container.replaceChildren(nextViewer.root);
        viewer = nextViewer;
        network = nextNetwork;
        viewer.root.querySelector('.oti-toolbar').after(controls);
        viewer.setView(view);
        if (restoreFocus) button.focus({ preventScroll: true });
        status.textContent = copy.baseSnapshot(date());
        return { updated: true, provenance: snapshot.provenance };
      } catch (error) {
        if (!disposed) status.textContent = copy.baseUpdateFailed(date());
        return { updated: false, error };
      } finally {
        button.disabled = false;
        pending = undefined;
      }
    })();
    return pending;
  };
  button.addEventListener('click', refresh, { signal: controller.signal });
  const whenRefreshed =
    settings.refreshOnLoad === false || freshOnMount
      ? Promise.resolve({
          updated: freshOnMount,
          provenance: network.metadata.baseMap
        })
      : refresh();
  return {
    get motion() {
      return viewer.motion;
    },
    get diagram() {
      return viewer.diagram;
    },
    get root() {
      return viewer.root;
    },
    selectRoute: (id) => viewer.selectRoute(id),
    selectStop: (id) => viewer.selectStop(id),
    clear: () => viewer.clear(),
    getState: () => viewer.getState(),
    getView: () => viewer.getView(),
    setView: (view) => viewer.setView(view),
    refresh,
    whenRefreshed,
    destroy: () => {
      disposed = true;
      controller.abort();
      viewer.destroy();
      viewer.root.remove();
    }
  };
}
