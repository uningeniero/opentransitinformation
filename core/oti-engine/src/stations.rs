// SPDX-License-Identifier: Apache-2.0
use crate::geometry::*;

type Marker = (Point, Point, f64);
pub struct Symbol {
    pub center: Point,
    pub endpoints: [Point; 2],
    pub radius: f64,
    pub anchors: Vec<Point>,
    pub markers: Vec<Marker>,
    pub connections: Vec<(String, Vec<Point>)>,
    pub primitives: Vec<Marker>,
}
fn fit(anchors: &[Point], radius: f64) -> Marker {
    let directions = [
        Point::new(1., 0.),
        Point::new(0., 1.),
        Point::new(1., 1.).unit(),
        Point::new(1., -1.).unit(),
    ];
    let mut best = (f64::INFINITY, anchors[0], anchors[0], radius);
    for axis in directions {
        let normal = axis.normal();
        let low = anchors
            .iter()
            .map(|p| p.dot(axis))
            .fold(f64::INFINITY, f64::min);
        let high = anchors
            .iter()
            .map(|p| p.dot(axis))
            .fold(f64::NEG_INFINITY, f64::max);
        let near = anchors
            .iter()
            .map(|p| p.dot(normal))
            .fold(f64::INFINITY, f64::min);
        let far = anchors
            .iter()
            .map(|p| p.dot(normal))
            .fold(f64::NEG_INFINITY, f64::max);
        let r = radius + (far - near) / 2.;
        let a = axis.mul(low).add(normal.mul((near + far) / 2.));
        let b = axis.mul(high).add(normal.mul((near + far) / 2.));
        let area = (high - low + 2. * r) * 2. * r;
        if area < best.0 - 1e-6 {
            best = (area, a, b, r);
        }
    }
    (best.1, best.2, best.3)
}
fn closest(a: Marker, b: Marker) -> (Point, Point) {
    let mut best = (f64::INFINITY, a.0, b.0);
    for p in [a.0, a.1] {
        let q = project(p, &[b.0, b.1]).0;
        if p.dist(q) < best.0 {
            best = (p.dist(q), p, q);
        }
    }
    for q in [b.0, b.1] {
        let p = project(q, &[a.0, a.1]).0;
        if p.dist(q) < best.0 {
            best = (p.dist(q), p, q);
        }
    }
    (best.1, best.2)
}
fn connection(
    a: Point,
    b: Point,
    served: &[usize],
    index: &SegmentIndex,
    line_width: f64,
) -> (String, Vec<Point>) {
    let mut candidates = vec![
        vec![a, Point::new(b.x, a.y), b],
        vec![a, Point::new(a.x, b.y), b],
    ];
    for x in [a.x.min(b.x) - 14., a.x.max(b.x) + 14.] {
        candidates.push(vec![a, Point::new(x, a.y), Point::new(x, b.y), b]);
    }
    for y in [a.y.min(b.y) - 14., a.y.max(b.y) + 14.] {
        candidates.push(vec![a, Point::new(a.x, y), Point::new(b.x, y), b]);
    }
    let mut best = None;
    for mut line in candidates {
        line.dedup_by(|a, b| a.dist(*b) < 1e-6);
        if line.len() < 2 {
            continue;
        }
        let (d, points) = rounded_offset(&line, &vec![0.; line.len() - 1], 5.);
        let mut score = points.windows(2).map(|p| p[0].dist(p[1])).sum::<f64>();
        for p in points.windows(2) {
            let r = Rect {
                x: p[0].x.min(p[1].x) - 4.,
                y: p[0].y.min(p[1].y) - 4.,
                w: (p[0].x - p[1].x).abs() + 8.,
                h: (p[0].y - p[1].y).abs() + 8.,
            };
            for id in index.query(r) {
                let (c, d, route) = index.segments[id];
                if !served.contains(&route)
                    && segment_distance(p[0], p[1], c, d) < 2.5 + line_width / 2. + 0.75
                {
                    score += 100000.;
                }
            }
        }
        if best.as_ref().map_or(true, |(s, _, _)| score < *s) {
            best = Some((score, d, points));
        }
    }
    let (_, d, points) = best.unwrap();
    (d, points)
}
pub fn build(
    input: &[Point],
    radius: f64,
    served: &[usize],
    index: &SegmentIndex,
    line_width: f64,
    geographic: bool,
) -> Symbol {
    let mut anchors = input.to_vec();
    anchors.sort_by(|a, b| a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y)));
    anchors.dedup_by(|a, b| a.dist(*b) < 0.25);
    let full = fit(&anchors, radius);
    if full.2 <= radius + 1.25 && (!geographic || full.0.dist(full.1) <= radius * 3.) {
        return Symbol {
            center: full.0.add(full.1).mul(0.5),
            endpoints: [full.0, full.1],
            radius: full.2,
            anchors,
            markers: vec![full],
            primitives: vec![(full.0, full.1, full.2 + 1.)],
            connections: vec![],
        };
    }
    let mut clusters: Vec<Vec<Point>> = anchors.iter().map(|p| vec![*p]).collect();
    let markers = loop {
        let markers: Vec<Marker> = clusters.iter().map(|c| fit(c, radius)).collect();
        let mut merge = None;
        'find: for i in 0..markers.len() {
            for j in i + 1..markers.len() {
                let a = markers[i];
                let b = markers[j];
                if segment_distance(a.0, a.1, b.0, b.1) < a.2 + b.2 + 2.75 {
                    merge = Some((i, j));
                    break 'find;
                }
            }
        }
        if let Some((i, j)) = merge {
            let more = clusters.remove(j);
            clusters[i].extend(more);
        } else {
            break markers;
        }
    };
    if markers.len() == 1 {
        let (a, b, r) = markers[0];
        return Symbol {
            center: a.add(b).mul(0.5),
            endpoints: [a, b],
            radius: r,
            anchors,
            primitives: vec![(a, b, r + 1.)],
            markers,
            connections: vec![],
        };
    }
    let mut connections = vec![];
    let mut primitives: Vec<Marker> = markers.iter().map(|(a, b, r)| (*a, *b, r + 1.)).collect();
    let mut visited = vec![false; markers.len()];
    visited[0] = true;
    for _ in 1..markers.len() {
        let mut best = (f64::INFINITY, 0, 0, markers[0].0, markers[0].0);
        for i in 0..markers.len() {
            if visited[i] {
                for j in 0..markers.len() {
                    if !visited[j] {
                        let (a, b) = closest(markers[i], markers[j]);
                        if a.dist(b) < best.0 {
                            best = (a.dist(b), i, j, a, b);
                        }
                    }
                }
            }
        }
        visited[best.2] = true;
        let (d, points) = connection(best.3, best.4, served, index, line_width);
        for pair in points.windows(2) {
            primitives.push((pair[0], pair[1], 2.5));
        }
        connections.push((d, points));
    }
    let low = Point::new(
        markers
            .iter()
            .map(|m| m.0.x.min(m.1.x) - m.2)
            .fold(f64::INFINITY, f64::min),
        markers
            .iter()
            .map(|m| m.0.y.min(m.1.y) - m.2)
            .fold(f64::INFINITY, f64::min),
    );
    let high = Point::new(
        markers
            .iter()
            .map(|m| m.0.x.max(m.1.x) + m.2)
            .fold(f64::NEG_INFINITY, f64::max),
        markers
            .iter()
            .map(|m| m.0.y.max(m.1.y) + m.2)
            .fold(f64::NEG_INFINITY, f64::max),
    );
    Symbol {
        center: low.add(high).mul(0.5),
        endpoints: [low, high],
        radius,
        anchors,
        markers,
        connections,
        primitives,
    }
}
