// SPDX-License-Identifier: Apache-2.0
export function fixture() {
  const nodes = [
    ['Puerto', -6, 0],
    ['Mercado', -4, 0],
    ['Jardines', -2, 0],
    ['Central', 0, 0],
    ['Universidad', 2, 0],
    ['Museo', 4, 0],
    ['Estación del Este', 6, 0],
    ['Parque Norte', -3, -4],
    ['Hospital', -1, -4],
    ['Biblioteca', 0, -2],
    ['Recinto Ferial', 5, 3],
    ['Terminal Sur', 6, 3],
    ['Aeropuerto', -6, 4],
    ['Ribera', -4, 2],
    ['Campus Norte', 1, -5],
    ['Artes', -4, -3]
  ];
  const stops = nodes.map(([name, x, y], i) => ({
    id: `s${i}`,
    name,
    position: [x, y],
    accessible: [0, 3, 6, 8, 12].includes(i) ? true : null,
    priority: [3, 6, 8].includes(i) ? 4 : 1
  }));
  const route = (id, code, name, color, sequence) => ({
    id,
    shortName: code,
    name,
    color,
    paths: [{ stopIds: sequence.map((i) => `s${i}`) }]
  });
  return {
    id: 'synthetic-town',
    name: 'Red de transporte',
    coordinateSystem: 'planar',
    stops,
    routes: [
      route('west-east', '1', 'Puerto - Estación', '#005B96', [0, 1, 2, 3, 4, 5, 6]),
      route('north-south', '2', 'Parque - Terminal Sur', '#A91642', [7, 8, 9, 3, 4, 5, 10, 11]),
      route('airport', 'A', 'Aeropuerto - Campus', '#20754A', [12, 13, 2, 3, 9, 8, 14]),
      route('circular', 'C', 'Circular del Centro', '#6D3E91', [1, 15, 7, 8, 9, 3, 2, 1])
    ],
    metadata: {
      source: 'Red sintética de prueba',
      license: 'CC0-1.0',
      validFrom: '2026-01-01',
      validUntil: '2026-12-31'
    },
    background: []
  };
}
export function smallGtfs() {
  return {
    stops: [
      {
        stop_id: 'a',
        stop_name: 'Puerto',
        stop_lon: '-1.8',
        stop_lat: '43.3',
        wheelchair_boarding: '1'
      },
      {
        stop_id: 'b',
        stop_name: 'Centro',
        stop_lon: '-1.79',
        stop_lat: '43.31',
        wheelchair_boarding: '0'
      },
      {
        stop_id: 'c',
        stop_name: 'Hospital',
        stop_lon: '-1.78',
        stop_lat: '43.32',
        wheelchair_boarding: '2'
      }
    ],
    routes: [
      {
        route_id: 'r1',
        route_short_name: '1',
        route_long_name: 'Puerto - Hospital',
        route_color: '005B96'
      }
    ],
    trips: [
      {
        route_id: 'r1',
        trip_id: 't1',
        service_id: 'weekday',
        direction_id: '0',
        shape_id: 'shape1'
      },
      { route_id: 'r1', trip_id: 't2', service_id: 'weekend', direction_id: '1' }
    ],
    stop_times: [
      { trip_id: 't1', stop_id: 'c', stop_sequence: '3' },
      { trip_id: 't1', stop_id: 'a', stop_sequence: '1' },
      { trip_id: 't1', stop_id: 'b', stop_sequence: '2' },
      { trip_id: 't2', stop_id: 'c', stop_sequence: '1' },
      { trip_id: 't2', stop_id: 'b', stop_sequence: '2' },
      { trip_id: 't2', stop_id: 'a', stop_sequence: '3' }
    ],
    shapes: [
      { shape_id: 'shape1', shape_pt_lon: '-1.78', shape_pt_lat: '43.32', shape_pt_sequence: '3' },
      { shape_id: 'shape1', shape_pt_lon: '-1.8', shape_pt_lat: '43.3', shape_pt_sequence: '1' },
      { shape_id: 'shape1', shape_pt_lon: '-1.79', shape_pt_lat: '43.31', shape_pt_sequence: '2' }
    ],
    calendar: [
      {
        service_id: 'weekday',
        start_date: '20260101',
        end_date: '20261231',
        monday: '1',
        tuesday: '1',
        wednesday: '1',
        thursday: '1',
        friday: '1',
        saturday: '0',
        sunday: '0'
      },
      {
        service_id: 'weekend',
        start_date: '20260101',
        end_date: '20261231',
        monday: '0',
        tuesday: '0',
        wednesday: '0',
        thursday: '0',
        friday: '0',
        saturday: '1',
        sunday: '1'
      }
    ]
  };
}
