// SPDX-License-Identifier: Apache-2.0
use crate::geometry::*;
use crate::json::Value;
use std::collections::{BTreeMap, BTreeSet};

fn issue(code: &str, id: &str, severity: &str) -> Value {
    Value::object(vec![
        ("code", code.into()),
        ("targetId", id.into()),
        ("severity", severity.into()),
    ])
}
fn points(values: &Value) -> Vec<Point> {
    values.array().iter().map(point).collect()
}
fn key(a: Point, b: Point) -> (String, f64) {
    let sa = format!("{:.3}:{:.3}", a.x, a.y);
    let sb = format!("{:.3}:{:.3}", b.x, b.y);
    if sa < sb {
        (format!("{}|{}", sa, sb), 1.)
    } else {
        (format!("{}|{}", sb, sa), -1.)
    }
}

struct Path {
    route: usize,
    part: usize,
    points: Vec<Point>,
    stop_ids: Vec<String>,
    stop_positions: BTreeMap<String, Point>,
    start_terminal: bool,
    end_terminal: bool,
    drawn: Vec<Point>,
    svg: String,
    offsets: Vec<f64>,
}
struct Stop {
    id: String,
    point: Point,
    endpoints: [Point; 2],
    radius: f64,
    routes: Vec<usize>,
    terminal: bool,
    priority: f64,
    anchors: Vec<Point>,
    markers: Vec<(Point, Point, f64)>,
    connections: Vec<(String, Vec<Point>)>,
    primitives: Vec<(Point, Point, f64)>,
}

pub fn topology(input: &Value) -> Result<Value, String> {
    let network = input.get("network");
    let stops = network.get("stops").array();
    let routes = network.get("routes").array();
    if stops.len() > 5000 || routes.len() > 300 {
        return Err("Topology exceeds network limits".into());
    }
    let mut adjacency: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut sequences = vec![];
    for route in routes {
        for p in route.get("paths").array() {
            let ids: Vec<String> = p
                .get("stopIds")
                .array()
                .iter()
                .map(|s| s.str().to_string())
                .collect();
            for pair in ids.windows(2) {
                adjacency
                    .entry(pair[0].clone())
                    .or_default()
                    .insert(pair[1].clone());
                adjacency
                    .entry(pair[1].clone())
                    .or_default()
                    .insert(pair[0].clone());
            }
            sequences.push(ids)
        }
    }
    sequences.sort_by(|a, b| b.len().cmp(&a.len()).then(a.cmp(b)));
    let mut positions: BTreeMap<String, Point> = BTreeMap::new();
    let mut component = 0.;
    for seq in sequences {
        if seq.iter().all(|id| positions.contains_key(id)) {
            continue;
        }
        if seq.iter().all(|id| !positions.contains_key(id)) {
            for (i, id) in seq.iter().enumerate() {
                if !positions.contains_key(id) {
                    positions.insert(id.clone(), Point::new(i as f64 * 120., component));
                }
            }
            component += 420.;
            continue;
        }
        let mut free = 0usize;
        for (i, id) in seq.iter().enumerate() {
            if positions.contains_key(id) {
                continue;
            }
            let prev = (0..i).rev().find(|j| positions.contains_key(&seq[*j]));
            let next = (i + 1..seq.len()).find(|j| positions.contains_key(&seq[*j]));
            let p = match (prev, next) {
                (Some(a), Some(b)) => {
                    let pa = positions[&seq[a]];
                    let pb = positions[&seq[b]];
                    let t = (i - a) as f64 / (b - a) as f64;
                    pa.mul(1. - t)
                        .add(pb.mul(t))
                        .add(Point::new(0., if free % 2 == 0 { -110. } else { 110. }))
                }
                (Some(a), None) => {
                    let pa = positions[&seq[a]];
                    Point::new(pa.x + 120. * (i - a) as f64, pa.y + 120.)
                }
                (None, Some(b)) => {
                    let pb = positions[&seq[b]];
                    Point::new(pb.x - 120. * (b - i) as f64, pb.y - 120.)
                }
                _ => Point::new(i as f64 * 120., component),
            };
            let mut p = p;
            while positions.values().any(|q| q.dist(p) < 60.) {
                p.y += 100.
            }
            positions.insert(id.clone(), p);
            free += 1;
        }
    }
    for (i, s) in stops.iter().enumerate() {
        positions
            .entry(s.get("id").str().to_string())
            .or_insert(Point::new(i as f64 * 120., component + 180.));
    }
    Ok(Value::object(vec![(
        "positions",
        Value::Object(positions.into_iter().map(|(k, p)| (k, p.json())).collect()),
    )]))
}

pub fn layout(input: &Value) -> Result<Value, String> {
    let network = input.get("network");
    let options = input.get("options");
    let style = input.get("style");
    let width = options.get("width").num(1200.);
    let height = options.get("height").num(760.);
    let pad = options.get("padding").num(140.);
    if !(360.0..=12000.0).contains(&width) || !(300.0..=12000.0).contains(&height) {
        return Err("Canvas dimensions outside 360..12000 by 300..12000".into());
    }
    let routes = network.get("routes").array();
    let stop_values = network.get("stops").array();
    if routes.len() > 300 || stop_values.len() > 5000 {
        return Err("Network exceeds 300 routes or 5000 stops".into());
    }
    let active: BTreeSet<&str> = options
        .get("activeRoutes")
        .array()
        .iter()
        .map(|s| s.str())
        .collect();
    let filtered = !active.is_empty();
    let geographic = network.get("coordinateSystem").str() == "wgs84";
    let lat0 = stop_values
        .iter()
        .map(|s| point(s.get("position")).y)
        .sum::<f64>()
        / stop_values.len().max(1) as f64;
    let lon0 = point(stop_values.first().unwrap_or(&Value::Null).get("position")).x;
    let raw = |p: Point| {
        if geographic {
            let mut d = p.x - lon0;
            while d > 180. {
                d -= 360.
            }
            while d < -180. {
                d += 360.
            }
            Point::new(d * lat0.to_radians().cos(), -p.y)
        } else {
            p
        }
    };
    let mut world: Vec<Point> = stop_values
        .iter()
        .map(|s| raw(point(s.get("position"))))
        .collect();
    for r in routes {
        for p in r.get("paths").array() {
            world.extend(points(p.get("coordinates")).into_iter().map(raw))
        }
    }
    if world.is_empty() {
        return Err("Network has no coordinates".into());
    }
    let mut min = Point::new(f64::INFINITY, f64::INFINITY);
    let mut max = Point::new(f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in &world {
        min.x = min.x.min(p.x);
        min.y = min.y.min(p.y);
        max.x = max.x.max(p.x);
        max.y = max.y.max(p.y)
    }
    if options.get("bounds").array().len() == 4 {
        let b = options.get("bounds").array();
        let p = raw(Point::new(b[0].num(min.x), b[1].num(min.y)));
        let q = raw(Point::new(b[2].num(max.x), b[3].num(max.y)));
        min = Point::new(p.x.min(q.x), p.y.min(q.y));
        max = Point::new(p.x.max(q.x), p.y.max(q.y))
    }
    let top = options.get("topInset").num(90.);
    if top > height - 100. {
        return Err("Canvas is too short for its title".into());
    }
    let availw = (width - 2. * pad).max(80.);
    let availh = (height - top - pad - 30.).max(80.);
    let scale = (availw / (max.x - min.x).max(1e-6)).min(availh / (max.y - min.y).max(1e-6));
    let dx = (width - (max.x - min.x) * scale) / 2.;
    let dy = top + (height - top - 30. - (max.y - min.y) * scale) / 2.;
    let transform = |p: Point| {
        let q = raw(p);
        Point::new(dx + (q.x - min.x) * scale, dy + (q.y - min.y) * scale)
    };
    let mut stop_map = BTreeMap::new();
    for s in stop_values {
        stop_map.insert(
            s.get("id").str().to_string(),
            transform(point(s.get("position"))),
        );
    }
    let linewidth = style.get("lineWidth").num(6.);
    let spacing = style.get("lineSpacing").num(9.);
    let radius = style.get("cornerRadius").num(24.);
    let symbol = style.get("stopRadius").num(4.5);
    let schematic = options.get("mode").str() == "schematic";
    let source_geometry = matches!(options.get("sourceGeometry"), Value::Bool(true));
    if source_geometry && schematic {
        return Err("Source geographic geometry cannot be schematized".into());
    }
    let mut paths = vec![];
    let mut edge_routes: BTreeMap<String, BTreeSet<usize>> = BTreeMap::new();
    let mut issues = vec![];
    for (ri, r) in routes.iter().enumerate() {
        for (pi, p) in r.get("paths").array().iter().enumerate() {
            let stop_ids: Vec<String> = p
                .get("stopIds")
                .array()
                .iter()
                .map(|s| s.str().to_string())
                .collect();
            let mut line: Vec<Point> = if p.get("coordinates").array().len() >= 2 {
                points(p.get("coordinates"))
                    .into_iter()
                    .map(transform)
                    .collect()
            } else {
                stop_ids
                    .iter()
                    .filter_map(|id| stop_map.get(id).copied())
                    .collect()
            };
            line.dedup_by(|a, b| a.dist(*b) < 1e-6);
            if line.len() < 2 {
                return Err(format!("Degenerate route path {}", r.get("id").str()));
            }
            if schematic {
                line = octilinear(&line)
            }
            paths.push(Path {
                route: ri,
                part: pi,
                points: line,
                stop_ids,
                stop_positions: if let Value::Object(values) = p.get("stopPositions") {
                    values
                        .iter()
                        .map(|(id, value)| (id.clone(), transform(point(value))))
                        .collect()
                } else {
                    BTreeMap::new()
                },
                start_terminal: !matches!(p.get("startTerminus"), Value::Bool(false)),
                end_terminal: !matches!(p.get("endTerminus"), Value::Bool(false)),
                drawn: vec![],
                svg: String::new(),
                offsets: vec![],
            });
        }
    }
    let tolerance = if source_geometry {
        0.
    } else {
        options
            .get("corridorTolerance")
            .num(if schematic { 0. } else { 2. })
    };
    if !(0.0..=20.0).contains(&tolerance) {
        return Err("corridorTolerance must be 0..20 pixels".into());
    }
    crate::mark(10);
    crate::mark(5000 + (tolerance * 100.) as u32);
    crate::mark(6000 + paths.len() as u32);
    let lines: Vec<Vec<Point>> = paths.iter().map(|p| p.points.clone()).collect();
    crate::mark(11);
    let members: Vec<Vec<String>> = paths.iter().map(|p| p.stop_ids.clone()).collect();
    crate::mark(12);
    let (aligned, matched, max_displacement) = if source_geometry {
        (lines.clone(), 0, 0.)
    } else {
        crate::corridors::align(&lines, &members, tolerance)?
    };
    crate::mark(30);
    for (path, line) in paths.iter_mut().zip(aligned) {
        path.points = line;
        for s in path.points.windows(2) {
            edge_routes
                .entry(key(s[0], s[1]).0)
                .or_default()
                .insert(path.route);
        }
    }
    let lines: Vec<Vec<Point>> = paths.iter().map(|p| p.points.clone()).collect();
    let owners: Vec<usize> = paths.iter().map(|p| p.route).collect();
    let route_ids: Vec<String> = routes
        .iter()
        .map(|r| r.get("id").str().to_string())
        .collect();
    let (offsets, maximum_lanes) = if source_geometry {
        (
            lines
                .iter()
                .map(|line| vec![0.; line.len().saturating_sub(1)])
                .collect(),
            edge_routes
                .values()
                .map(|owners| owners.len())
                .max()
                .unwrap_or(1),
        )
    } else {
        crate::lanes::assign(&lines, &owners, &route_ids, spacing)
    };
    if maximum_lanes > 12 {
        issues.push(issue("CORRIDOR_LANE_SPREAD", "network", "warning"));
    }
    let mut max_offset: f64 = 0.;
    for (path, offsets) in paths.iter_mut().zip(offsets) {
        path.offsets = offsets;
        for d in &path.offsets {
            max_offset = max_offset.max(d.abs())
        }
    }
    let radius = radius.max(max_offset + linewidth);
    for path in &mut paths {
        let (svg, drawn) = if source_geometry {
            let mut svg = format!("M{}", xy(path.points[0]));
            for p in path.points.iter().skip(1) {
                svg.push_str(&format!(" L{}", xy(*p)));
            }
            (svg, path.points.clone())
        } else {
            rounded_offset(&path.points, &path.offsets, radius)
        };
        path.svg = svg;
        path.drawn = drawn;
    }
    crate::mark(40);
    crate::mark(7000000 + paths.iter().map(|p| p.drawn.len()).sum::<usize>() as u32);
    let mut index = SegmentIndex::with_cell(8.);
    let mut crossings = 0usize;
    let mut indexed = BTreeSet::new();
    for path in &paths {
        if filtered && !active.contains(routes[path.route].get("id").str()) {
            continue;
        }
        for pair in path.drawn.windows(2) {
            let a = pair[0];
            let b = pair[1];
            if a.dist(b) < 0.01 {
                continue;
            }
            let sa = format!("{:.3}:{:.3}", a.x, a.y);
            let sb = format!("{:.3}:{:.3}", b.x, b.y);
            let key = if sa < sb {
                format!("{}|{}|{}", path.route, sa, sb)
            } else {
                format!("{}|{}|{}", path.route, sb, sa)
            };
            if !indexed.insert(key) {
                continue;
            }
            let r = Rect {
                x: a.x.min(b.x),
                y: a.y.min(b.y),
                w: (a.x - b.x).abs(),
                h: (a.y - b.y).abs(),
            };
            for id in index.query(r) {
                let (c, d, route) = index.segments[id];
                if route != path.route && intersection(a, b, c, d) {
                    crossings += 1
                }
            }
            index.insert(a, b, path.route);
        }
    }
    crate::mark(50);
    let mut stops = vec![];
    for s in stop_values {
        let id = s.get("id").str().to_string();
        let p = *stop_map.get(&id).unwrap();
        let mut anchors = vec![];
        let mut served = vec![];
        let mut terminal = false;
        for (ri, r) in routes.iter().enumerate() {
            if filtered && !active.contains(r.get("id").str()) {
                continue;
            }
            let mut best = None;
            for path in paths
                .iter()
                .filter(|l| l.route == ri && l.stop_ids.contains(&id))
            {
                terminal |= path.stop_ids.first() != path.stop_ids.last()
                    && ((path.start_terminal && path.stop_ids.first() == Some(&id))
                        || (path.end_terminal && path.stop_ids.last() == Some(&id)));
                let anchor = path.stop_positions.get(&id).copied().unwrap_or(p);
                let q = project(anchor, &path.drawn);
                if source_geometry && path.stop_positions.contains_key(&id) && q.1 > 0.001 {
                    return Err(format!(
                        "Source anchor for {} is not on its route geometry",
                        id
                    ));
                }
                if best.map_or(true, |b: (Point, f64)| q.1 < b.1) {
                    best = Some((q.0, q.1))
                }
            }
            if let Some((q, _)) = best {
                anchors.push(q);
                served.push(ri)
            }
        }
        if anchors.is_empty() {
            if filtered {
                continue;
            }
            issues.push(issue("UNSERVED_STOP", &id, "warning"));
            anchors.push(p)
        }
        let mut length = 0.;
        for a in &anchors {
            for b in &anchors {
                let d = a.dist(*b);
                if d > length {
                    length = d;
                }
            }
        }
        if length > spacing * served.len().max(1) as f64 + 30. {
            issues.push(issue("SEPARATED_PLATFORMS", &id, "warning"))
        }
        let sr = if served.len() > 1 {
            symbol + 1.
        } else {
            symbol
        };
        let shape =
            crate::stations::build(&anchors, sr, &served, &index, linewidth, source_geometry);
        stops.push(Stop {
            id,
            point: shape.center,
            endpoints: shape.endpoints,
            anchors: shape.anchors,
            markers: shape.markers,
            connections: shape.connections,
            primitives: shape.primitives,
            radius: shape.radius,
            routes: served,
            terminal,
            priority: s.get("priority").num(1.),
        });
    }
    crate::mark(60);
    for s in &stops {
        let mut crossing = false;
        for (a, b, radius) in &s.primitives {
            let r = Rect {
                x: a.x.min(b.x) - radius,
                y: a.y.min(b.y) - radius,
                w: (a.x - b.x).abs() + 2. * radius,
                h: (a.y - b.y).abs() + 2. * radius,
            };
            for id in index.query(r) {
                let (c, d, route) = index.segments[id];
                if !s.routes.contains(&route)
                    && segment_distance(*a, *b, c, d) < radius + linewidth / 2. + 0.5
                {
                    crossing = true;
                    break;
                }
            }
            if crossing {
                break;
            }
        }
        if crossing {
            issues.push(issue("STATION_CROSSES_UNSERVED_ROUTE", &s.id, "error"));
        }
    }
    let mut symbol_rects = vec![];
    for s in &stops {
        let x = s
            .primitives
            .iter()
            .map(|(a, b, r)| a.x.min(b.x) - r - 1.)
            .fold(f64::INFINITY, f64::min);
        let y = s
            .primitives
            .iter()
            .map(|(a, b, r)| a.y.min(b.y) - r - 1.)
            .fold(f64::INFINITY, f64::min);
        let maxx = s
            .primitives
            .iter()
            .map(|(a, b, r)| a.x.max(b.x) + r + 1.)
            .fold(f64::NEG_INFINITY, f64::max);
        let maxy = s
            .primitives
            .iter()
            .map(|(a, b, r)| a.y.max(b.y) + r + 1.)
            .fold(f64::NEG_INFINITY, f64::max);
        symbol_rects.push(Rect {
            x,
            y,
            w: maxx - x,
            h: maxy - y,
        })
    }
    let mut order: Vec<usize> = (0..stops.len()).collect();
    order.sort_by(|a, b| {
        let score = |i: usize| {
            stops[i].routes.len() as f64 * 100.
                + if stops[i].terminal { 50. } else { 0. }
                + stops[i].priority * 10.
        };
        score(*b)
            .total_cmp(&score(*a))
            .then(stops[*a].id.cmp(&stops[*b].id))
    });
    let mut labels = vec![];
    let mut placed: Vec<Rect> = vec![];
    let mut leaders: Vec<(Point, Point)> = vec![];
    let label_gap = style.get("labelGap").num(7.);
    let font_size = style.get("fontSize").num(16.);
    let bounds = Rect {
        x: 20.,
        y: top,
        w: width - 40.,
        h: height - top - 30.,
    };
    for path in &paths {
        if (!filtered || active.contains(routes[path.route].get("id").str()))
            && path.drawn.iter().any(|p| !bounds.contains(*p))
        {
            issues.push(issue(
                "ROUTE_OUTSIDE_FRAME",
                routes[path.route].get("id").str(),
                "error",
            ));
        }
    }
    let mut node_overlap = 0usize;
    for i in 0..symbol_rects.len() {
        for j in i + 1..symbol_rects.len() {
            if symbol_rects[i].overlaps(symbol_rects[j], 1.)
                && stops[i].primitives.iter().any(|(a, b, r)| {
                    stops[j]
                        .primitives
                        .iter()
                        .any(|(c, d, s)| segment_distance(*a, *b, *c, *d) < r + s + 1.)
                })
            {
                node_overlap += 1
            }
        }
    }
    if node_overlap > 0 {
        issues.push(issue("STOP_SYMBOL_OVERLAP", "network", "error"))
    }
    for si in order {
        let s = &stops[si];
        let m = input.get("metrics").get(&s.id);
        let w = m.get("width").num(80.);
        let h = m.get("height").num(font_size * 1.25);
        let mut preference = "";
        for c in network.get("constraints").array() {
            if c.get("targetId").str() == s.id && c.get("kind").str() == "label-side" {
                preference = c.get("value").str()
            }
        }
        let dirs = [
            "right",
            "left",
            "top-right",
            "bottom-right",
            "top-left",
            "bottom-left",
            "top",
            "bottom",
            "angle-0",
            "angle-1",
            "angle-2",
            "angle-3",
            "angle-4",
            "angle-5",
            "angle-6",
            "angle-7",
        ];
        let mut best: Option<(f64, Rect, usize)> = None;
        let extent = Point::new(symbol_rects[si].w / 2., symbol_rects[si].h / 2.);
        let callout = |r: Rect| -> Option<Option<(Point, Point)>> {
            let nearest = Point::new(
                s.point.x.clamp(r.x, r.x + r.w),
                s.point.y.clamp(r.y, r.y + r.h),
            );
            let (on, attach_radius) = s
                .primitives
                .iter()
                .map(|(a, b, r)| (project(nearest, &[*a, *b]).0, *r))
                .min_by(|(a, r), (b, s)| (a.dist(nearest) - r).total_cmp(&(b.dist(nearest) - s)))
                .unwrap();
            let delta = nearest.sub(on);
            let gap = delta.len() - attach_radius;
            if gap <= font_size * 2.6 {
                return Some(None);
            }
            if gap > font_size * 12. {
                return None;
            }
            let direction = delta.unit();
            let a = on.add(direction.mul(attach_radius + 1.75));
            let b = nearest.sub(direction.mul(2.));
            let query = Rect {
                x: a.x.min(b.x),
                y: a.y.min(b.y),
                w: (a.x - b.x).abs(),
                h: (a.y - b.y).abs(),
            };
            for id in index.query(query) {
                let (c, d, _) = index.segments[id];
                if segment_distance(a, b, c, d) < linewidth / 2. + 1. {
                    return None;
                }
            }
            if symbol_rects
                .iter()
                .enumerate()
                .any(|(i, rect)| i != si && rect.crosses(a, b, 2.))
                || placed.iter().any(|rect| rect.crosses(a, b, 2.))
                || leaders
                    .iter()
                    .any(|(c, d)| segment_distance(a, b, *c, *d) < 2.)
            {
                return None;
            }
            Some(Some((a, b)))
        };
        for ring in 0..22 {
            let gap = label_gap + ring as f64 * (font_size + 5.);
            for (di, d) in dirs.iter().enumerate() {
                let (x, y) = match *d {
                    "right" => (s.point.x + extent.x + gap, s.point.y - h / 2.),
                    "left" => (s.point.x - extent.x - gap - w, s.point.y - h / 2.),
                    "top-right" => (s.point.x + extent.x + gap, s.point.y - extent.y - gap - h),
                    "bottom-right" => (s.point.x + extent.x + gap, s.point.y + extent.y + gap),
                    "top-left" => (
                        s.point.x - extent.x - gap - w,
                        s.point.y - extent.y - gap - h,
                    ),
                    "bottom-left" => (s.point.x - extent.x - gap - w, s.point.y + extent.y + gap),
                    "top" => (s.point.x - w / 2., s.point.y - extent.y - gap - h),
                    _ => (s.point.x - w / 2., s.point.y + extent.y + gap),
                };
                let (x, y) = if di >= 8 {
                    let angle =
                        (di - 8) as f64 * std::f64::consts::PI / 4. + std::f64::consts::PI / 8.;
                    (
                        s.point.x + angle.cos() * (extent.x + gap + w / 2.) - w / 2.,
                        s.point.y + angle.sin() * (extent.y + gap + h / 2.) - h / 2.,
                    )
                } else {
                    (x, y)
                };
                let r = Rect { x, y, w, h };
                if r.x < bounds.x
                    || r.y < bounds.y
                    || r.x + w > bounds.x + bounds.w
                    || r.y + h > bounds.y + bounds.h
                {
                    continue;
                }
                if placed.iter().any(|b| r.overlaps(*b, 4.))
                    || symbol_rects.iter().any(|b| r.overlaps(*b, 3.))
                    || leaders.iter().any(|(a, b)| r.crosses(*a, *b, 2.))
                {
                    continue;
                }
                if index.rect_hits(r, linewidth / 2. + 2.) > 0 {
                    continue;
                }
                let Some(leader) = callout(r) else {
                    continue;
                };
                let score = ring as f64 * 35.
                    + di as f64 * 0.4
                    + leader.map_or(0., |(a, b)| 20. + a.dist(b) * 0.1)
                    + if !preference.is_empty() && preference != *d {
                        15.
                    } else {
                        0.
                    };
                if best.as_ref().map_or(true, |b| score < b.0) {
                    best = Some((score, r, ring))
                }
            }
            if best.as_ref().map_or(false, |b| b.0 < 30.) {
                break;
            }
        }
        if best.is_none() {
            let step = (font_size + 6.).max(16.);
            let limit = (width.max(height) / step).ceil() as i32;
            'search: for ring in 1..=limit {
                for gx in -ring..=ring {
                    for gy in -ring..=ring {
                        if gx.abs() != ring && gy.abs() != ring {
                            continue;
                        }
                        let r = Rect {
                            x: s.point.x + gx as f64 * step - w / 2.,
                            y: s.point.y + gy as f64 * step - h / 2.,
                            w,
                            h,
                        };
                        if r.x < bounds.x
                            || r.y < bounds.y
                            || r.x + w > bounds.x + bounds.w
                            || r.y + h > bounds.y + bounds.h
                        {
                            continue;
                        }
                        if placed.iter().any(|b| r.overlaps(*b, 4.))
                            || symbol_rects.iter().any(|b| r.overlaps(*b, 3.))
                            || index.rect_hits(r, linewidth / 2. + 2.) > 0
                            || leaders.iter().any(|(a, b)| r.crosses(*a, *b, 2.))
                        {
                            continue;
                        }
                        if callout(r).is_none() {
                            continue;
                        }
                        best = Some((ring as f64 * step, r, 999));
                        break 'search;
                    }
                }
            }
        }
        if let Some((_, r, _)) = best {
            let leader = if let Some((a, b)) = callout(r).flatten() {
                if a.dist(b) > font_size * 6. {
                    issues.push(issue("LONG_LABEL_LEADER", &s.id, "warning"));
                }
                leaders.push((a, b));
                Value::Array(vec![a.json(), b.json()])
            } else {
                Value::Null
            };
            labels.push(Value::object(vec![
                ("stopId", s.id.clone().into()),
                ("bounds", r.json()),
                ("leader", leader),
                ("terminal", Value::Bool(s.terminal)),
            ]));
            placed.push(r);
        } else {
            issues.push(issue("LABEL_UNPLACED", &s.id, "error"))
        }
    }
    crate::mark(70);
    let path_json = paths
        .iter()
        .filter(|p| !filtered || active.contains(routes[p.route].get("id").str()))
        .map(|p| {
            Value::object(vec![
                ("routeId", routes[p.route].get("id").clone()),
                ("part", p.part.into()),
                ("d", p.svg.clone().into()),
                (
                    "motionStops",
                    crate::motion::stop_anchors(
                        &p.drawn,
                        &p.stop_ids
                            .iter()
                            .filter_map(|id| {
                                p.stop_positions
                                    .get(id)
                                    .or_else(|| stop_map.get(id))
                                    .map(|point| (id.clone(), *point))
                            })
                            .collect::<Vec<_>>(),
                    ),
                ),
                (
                    "continuations",
                    Value::Array(
                        [
                            (!p.start_terminal, 0usize, 1usize),
                            (!p.end_terminal, p.drawn.len() - 1, p.drawn.len() - 2),
                        ]
                        .into_iter()
                        .filter(|(show, _, _)| *show)
                        .map(|(_, at, adjacent)| {
                            let tip = p.drawn[at];
                            let u = p.drawn[adjacent].sub(tip).unit();
                            let n = u.normal();
                            Value::Array(vec![
                                tip.add(u.mul(9.)).add(n.mul(5.)).json(),
                                tip.json(),
                                tip.add(u.mul(9.)).sub(n.mul(5.)).json(),
                            ])
                        })
                        .collect(),
                    ),
                ),
                (
                    "points",
                    Value::Array(p.drawn.iter().map(|p| p.json()).collect()),
                ),
                (
                    "offsets",
                    Value::Array(p.offsets.iter().map(|n| (*n).into()).collect()),
                ),
            ])
        })
        .collect();
    let stop_json = stops
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let source = symbol_rects[i];
            let hit = Rect {
                x: source.x - (24. - source.w).max(0.) / 2.,
                y: source.y - (24. - source.h).max(0.) / 2.,
                w: source.w.max(24.),
                h: source.h.max(24.),
            };
            Value::object(vec![
                ("id", s.id.clone().into()),
                ("position", s.point.json()),
                (
                    "endpoints",
                    Value::Array(s.endpoints.iter().map(|p| p.json()).collect()),
                ),
                ("radius", s.radius.into()),
                ("hitBounds", hit.json()),
                (
                    "anchors",
                    Value::Array(s.anchors.iter().map(|p| p.json()).collect()),
                ),
                (
                    "markers",
                    Value::Array(
                        s.markers
                            .iter()
                            .map(|(a, b, r)| {
                                Value::object(vec![
                                    ("endpoints", Value::Array(vec![a.json(), b.json()])),
                                    ("radius", (*r).into()),
                                ])
                            })
                            .collect(),
                    ),
                ),
                (
                    "connections",
                    Value::Array(
                        s.connections
                            .iter()
                            .map(|(d, _)| Value::object(vec![("d", d.clone().into())]))
                            .collect(),
                    ),
                ),
                (
                    "symbolKind",
                    if !s.connections.is_empty() {
                        "interchange"
                    } else if s.endpoints[0].dist(s.endpoints[1]) < 0.01 {
                        "circle"
                    } else {
                        "capsule"
                    }
                    .into(),
                ),
                (
                    "routes",
                    Value::Array(
                        s.routes
                            .iter()
                            .map(|r| routes[*r].get("id").clone())
                            .collect(),
                    ),
                ),
                ("terminal", Value::Bool(s.terminal)),
            ])
        })
        .collect();
    let (background, context_labels) = crate::context::build(
        input,
        transform,
        bounds,
        &placed,
        &symbol_rects,
        &index,
        &leaders,
    )?;
    let context_label_count = context_labels.len();
    Ok(Value::object(vec![
        ("width", width.into()),
        ("height", height.into()),
        ("paths", Value::Array(path_json)),
        ("stops", Value::Array(stop_json)),
        ("labels", Value::Array(labels)),
        ("background", Value::Array(background)),
        ("mapBounds", bounds.json()),
        ("contextLabels", Value::Array(context_labels)),
        ("issues", Value::Array(issues)),
        (
            "statistics",
            Value::object(vec![
                ("routes", routes.len().into()),
                ("paths", paths.len().into()),
                ("stops", stops.len().into()),
                ("labels", placed.len().into()),
                ("labelLeaders", leaders.len().into()),
                ("contextLabels", context_label_count.into()),
                ("maximumCorridorLanes", maximum_lanes.into()),
                ("crossings", crossings.into()),
                (
                    "sharedEdges",
                    edge_routes.values().filter(|r| r.len() > 1).count().into(),
                ),
                ("matchedCorridorSamples", matched.into()),
                ("maxCorridorDisplacement", max_displacement.into()),
                ("maxLaneOffset", max_offset.into()),
                ("cornerRadius", radius.into()),
            ]),
        ),
    ]))
}
