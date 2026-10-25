// SPDX-License-Identifier: Apache-2.0
const en = {
  motionControls: 'Vehicle motion controls',
  motionCaption: 'Illustrative route movement',
  motionPlay: 'Play motion',
  motionPause: 'Pause motion',
  motionResume: 'Resume motion',
  routes: 'Routes',
  results: 'Results',
  controls: 'Map controls',
  search: 'Search routes or stops',
  placeholder: 'Name or code',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  reset: 'Show the whole network',
  side: 'Routes and search',
  searchResults: 'Search results',
  prompt: 'Select a route or a stop.',
  all: 'Browse all routes and stops',
  map: 'Network map. Use arrow keys to pan and the buttons to zoom.',
  loading: 'Loading the map...',
  confirmed: 'Wheelchair access confirmed',
  inaccessible: 'Not wheelchair accessible',
  unknown: 'Wheelchair access unconfirmed',
  schematic: 'Diagram not to scale',
  geographic: 'Geographic map',
  accessKey: 'Wheelchair symbol: confirmed wheelchair access',
  from: 'From',
  until: 'Until',
  baseMapDate: 'Base map snapshot',
  unknownDate: 'date unconfirmed',
  platformLinks: 'Dashed station links are schematic, not walking directions',
  noResults: 'No results found.',
  resultCount: (count) => `${count} ${count === 1 ? 'result' : 'results'}.`,
  updateBase: 'Update OpenStreetMap',
  updatingBase: 'Updating the base map...',
  baseSnapshot: (date) => `OSM data: ${date}`,
  baseUpdateFailed: (date) => `Update unavailable. Showing OSM data: ${date}`,
  route: (code, name) => `Route ${code}: ${name}`,
  selectRoute: (code, name) => `Select route ${code}: ${name}`,
  routeInfo: (code, name, count) =>
    `Route ${code} - ${name}. ${count} ${count === 1 ? 'stop' : 'stops'}.`,
  routeResult: (code, name) => `Route ${code} - ${name}`,
  stopInfo: (name, codes, access) => `${name}. Routes ${codes}. ${access}.`,
  description: (routes, stops) =>
    `${routes} ${routes === 1 ? 'route' : 'routes'} and ${stops} ${stops === 1 ? 'stop' : 'stops'}. Each route is identified by code and colour. Crossings without a station symbol do not indicate an interchange.`
};
const es = {
  motionControls: 'Controles de movimiento de vehículos',
  motionCaption: 'Movimiento ilustrativo de líneas',
  motionPlay: 'Reproducir movimiento',
  motionPause: 'Pausar movimiento',
  motionResume: 'Reanudar movimiento',
  routes: 'Líneas',
  results: 'Resultados',
  controls: 'Controles del mapa',
  search: 'Buscar línea o parada',
  placeholder: 'Nombre o código',
  zoomIn: 'Acercar',
  zoomOut: 'Alejar',
  reset: 'Ver toda la red',
  side: 'Líneas y búsqueda',
  searchResults: 'Resultados de búsqueda',
  prompt: 'Selecciona una línea o una parada.',
  all: 'Consultar todas las líneas y paradas',
  map: 'Plano de la red. Usa las flechas para desplazar y los botones para ampliar.',
  loading: 'Cargando el plano...',
  confirmed: 'Acceso en silla de ruedas confirmado',
  inaccessible: 'No accesible en silla de ruedas',
  unknown: 'Accesibilidad en silla de ruedas sin confirmar',
  schematic: 'Esquema sin escala',
  geographic: 'Mapa geográfico',
  accessKey: 'Símbolo de silla de ruedas: acceso en silla de ruedas confirmado',
  from: 'Desde',
  until: 'Hasta',
  baseMapDate: 'Datos del mapa base',
  unknownDate: 'fecha sin confirmar',
  platformLinks:
    'Los enlaces discontinuos de estación son esquemáticos, no indicaciones peatonales',
  noResults: 'No se han encontrado resultados.',
  resultCount: (count) =>
    `${count} ${count === 1 ? 'resultado' : 'resultados'}.`,
  updateBase: 'Actualizar OpenStreetMap',
  updatingBase: 'Actualizando el mapa base...',
  baseSnapshot: (date) => `Datos OSM: ${date}`,
  baseUpdateFailed: (date) =>
    `Actualización no disponible. Datos OSM visibles: ${date}`,
  route: (code, name) => `Línea ${code}: ${name}`,
  selectRoute: (code, name) => `Seleccionar línea ${code}: ${name}`,
  routeInfo: (code, name, count) =>
    `Línea ${code} - ${name}. ${count} ${count === 1 ? 'parada' : 'paradas'}.`,
  routeResult: (code, name) => `Línea ${code} - ${name}`,
  stopInfo: (name, codes, access) => `${name}. Líneas ${codes}. ${access}.`,
  description: (routes, stops) =>
    `${routes} ${routes === 1 ? 'línea' : 'líneas'} y ${stops} ${stops === 1 ? 'parada' : 'paradas'}. Cada línea se identifica por código y color. Los cruces sin símbolo no indican transbordo.`
};
export function localeCopy(locale = 'en') {
  if (!['en', 'es'].includes(locale)) throw new TypeError('Unsupported locale');
  return locale === 'es' ? es : en;
}
export const accessCopy = (accessible, copy) =>
  accessible === true
    ? copy.confirmed
    : accessible === false
      ? copy.inaccessible
      : copy.unknown;
