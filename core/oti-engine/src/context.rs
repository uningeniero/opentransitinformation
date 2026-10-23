// SPDX-License-Identifier: Apache-2.0
use crate::geometry::{point, point_segment, Point, Rect, SegmentIndex};
use crate::json::Value;
use std::collections::BTreeSet;

struct Feature {
    id: String,
    kind: String,
    geometry: String,
    classification: String,
    name: String,
    rings: Vec<Vec<Point>>,
    bounds: Rect,
}

fn extent(lines: &[Vec<Point>]) -> Rect {
    let mut min = Point::new(f64::INFINITY, f64::INFINITY);
    let mut max = Point::new(f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in lines.iter().flatten() {
        min.x = min.x.min(p.x);
        min.y = min.y.min(p.y);
        max.x = max.x.max(p.x);
        max.y = max.y.max(p.y);
    }
    Rect {
        x: min.x,
        y: min.y,
        w: max.x - min.x,
        h: max.y - min.y,
    }
}

fn area(ring: &[Point]) -> f64 {
    let origin = ring[0];
    ring.windows(2)
        .map(|p| p[0].sub(origin).cross(p[1].sub(origin)))
        .sum::<f64>()
        / 2.
}

fn simplify(line: &[Point], tolerance: f64) -> Vec<Point> {
    if line.len() <= 2 || tolerance <= 0. {
        return line.to_vec();
    }
    let mut keep = vec![false; line.len()];
    keep[0] = true;
    keep[line.len() - 1] = true;
    let mut stack = vec![(0, line.len() - 1)];
    let mut budget = line.len().saturating_mul(64) + 10000;
    while let Some((a, b)) = stack.pop() {
        let mut distance = tolerance;
        let mut split = None;
        for i in a + 1..b {
            if budget == 0 {
                return line.to_vec();
            }
            budget -= 1;
            let d = point_segment(line[i], line[a], line[b]);
            if d > distance {
                distance = d;
                split = Some(i);
            }
        }
        if let Some(i) = split {
            keep[i] = true;
            if i > a + 1 {
                stack.push((a, i));
            }
            if b > i + 1 {
                stack.push((i, b));
            }
        }
    }
    line.iter()
        .enumerate()
        .filter_map(|(i, p)| keep[i].then_some(*p))
        .collect()
}

fn inside(point: Point, rings: &[Vec<Point>], budget: &mut usize) -> bool {
    let mut contained = false;
    for ring in rings {
        if ring.len() > *budget {
            return false;
        }
        *budget -= ring.len();
        for pair in ring.windows(2) {
            let a = pair[0];
            let b = pair[1];
            if (a.y > point.y) != (b.y > point.y)
                && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x
            {
                contained = !contained;
            }
        }
    }
    contained
}

fn rectangle_inside(rect: Rect, rings: &[Vec<Point>], budget: &mut usize) -> bool {
    let corners = [
        Point::new(rect.x - 2., rect.y - 2.),
        Point::new(rect.x + rect.w + 2., rect.y - 2.),
        Point::new(rect.x + rect.w + 2., rect.y + rect.h + 2.),
        Point::new(rect.x - 2., rect.y + rect.h + 2.),
    ];
    if !corners.iter().all(|p| inside(*p, rings, budget)) {
        return false;
    }
    for ring in rings {
        if ring.len() > *budget {
            return false;
        }
        *budget -= ring.len();
        if ring.windows(2).any(|p| rect.crosses(p[0], p[1], 2.)) {
            return false;
        }
    }
    true
}

fn visible(a: Rect, b: Rect) -> Option<Rect> {
    let x = a.x.max(b.x);
    let y = a.y.max(b.y);
    let right = (a.x + a.w).min(b.x + b.w);
    let bottom = (a.y + a.h).min(b.y + b.h);
    (right > x && bottom > y).then_some(Rect {
        x,
        y,
        w: right - x,
        h: bottom - y,
    })
}

fn priority(kind: &str) -> usize {
    match kind {
        "water" => 0,
        "park" => 1,
        "district" => 2,
        "urban" => 3,
        "building" => 4,
        _ => 5,
    }
}

pub fn build(
    input: &Value,
    transform: impl Fn(Point) -> Point,
    bounds: Rect,
    foreground_labels: &[Rect],
    symbols: &[Rect],
    index: &SegmentIndex,
    leaders: &[(Point, Point)],
) -> Result<(Vec<Value>, Vec<Value>), String> {
    let network = input.get("network");
    let tolerance = input
        .get("options")
        .get("backgroundSimplification")
        .num(0.6);
    if !(0.0..=3.0).contains(&tolerance) {
        return Err("backgroundSimplification must be 0..3 pixels".into());
    }
    let values = network.get("background").array();
    if values.len() > 20000 {
        return Err("Background exceeds 20000 features".into());
    }
    let mut features = vec![];
    let mut vertices = 0;
    for value in values {
        let id = value.get("id").str().to_string();
        let kind = value.get("kind").str().to_string();
        let geometry = value.get("geometry").str().to_string();
        let polygon = geometry == "polygon";
        let mut rings = vec![];
        for ring in value.get("coordinates").array() {
            let raw: Vec<Point> = ring.array().iter().map(point).collect();
            vertices += raw.len();
            if vertices > 150000 {
                return Err("Background exceeds 150000 vertices".into());
            }
            if polygon {
                if raw.len() < 4
                    || raw.first().unwrap().dist(*raw.last().unwrap()) > 1e-10
                    || area(&raw).abs() <= 1e-18
                {
                    return Err(format!("Invalid polygon ring in background feature {}", id));
                }
            } else if raw.len() < 2 {
                return Err(format!("Invalid background line {}", id));
            }
            let projected: Vec<Point> = raw.into_iter().map(&transform).collect();
            // Rings remain exact to preserve holes and shared polygon boundaries.
            rings.push(if polygon {
                projected
            } else {
                simplify(&projected, tolerance)
            });
        }
        if rings.is_empty() {
            return Err(format!("Empty background feature {}", id));
        }
        let bbox = extent(&rings);
        features.push(Feature {
            id,
            kind,
            geometry,
            classification: value.get("classification").str().to_string(),
            name: value.get("name").str().to_string(),
            rings,
            bounds: bbox,
        });
    }
    let output = features
        .iter()
        .map(|f| {
            Value::object(vec![
                ("id", f.id.clone().into()),
                ("kind", f.kind.clone().into()),
                ("geometry", f.geometry.clone().into()),
                ("classification", f.classification.clone().into()),
                ("name", f.name.clone().into()),
                (
                    "coordinates",
                    Value::Array(
                        f.rings
                            .iter()
                            .map(|r| Value::Array(r.iter().map(|p| p.json()).collect()))
                            .collect(),
                    ),
                ),
            ])
        })
        .collect();
    if input.get("options").get("backgroundStyle").str() == "none" {
        return Ok((output, vec![]));
    }
    let mut order: Vec<usize> = (0..features.len()).collect();
    order.sort_by(|a, b| {
        priority(&features[*a].kind)
            .cmp(&priority(&features[*b].kind))
            .then(
                (features[*b].bounds.w * features[*b].bounds.h)
                    .total_cmp(&(features[*a].bounds.w * features[*a].bounds.h)),
            )
            .then(features[*a].id.cmp(&features[*b].id))
    });
    let mut names = BTreeSet::new();
    let mut placed: Vec<Rect> = vec![];
    let mut labels = vec![];
    let mut attempts = 0;
    let mut budget = 3000000usize;
    for fi in order {
        let f = &features[fi];
        if f.name.is_empty()
            || f.kind == "land"
            || labels.len() >= 200
            || attempts >= 2500
            || budget == 0
        {
            continue;
        }
        let key = format!("{}:{}", f.kind, f.name.to_lowercase());
        if names.contains(&key) {
            continue;
        }
        let m = input.get("contextMetrics").get(&f.id);
        let width = m.get("width").num(0.);
        let height = m.get("height").num(0.);
        if width <= 0. || height <= 0. || width > bounds.w - 20. {
            continue;
        }
        let label_extent = if f.geometry == "line" {
            Rect {
                x: f.bounds.x - 24.,
                y: f.bounds.y - 24.,
                w: f.bounds.w + 48.,
                h: f.bounds.h + 48.,
            }
        } else {
            f.bounds
        };
        let Some(region) = visible(label_extent, bounds) else {
            continue;
        };
        let mut centers = vec![];
        if f.geometry == "polygon" {
            for (x, y) in [
                (0.5, 0.5),
                (0.35, 0.5),
                (0.65, 0.5),
                (0.5, 0.3),
                (0.5, 0.7),
                (0.25, 0.25),
                (0.75, 0.25),
                (0.25, 0.75),
                (0.75, 0.75),
                (0.15, 0.5),
                (0.85, 0.5),
                (0.5, 0.15),
                (0.5, 0.85),
            ] {
                centers.push(Point::new(region.x + region.w * x, region.y + region.h * y));
            }
        } else {
            for ring in f.rings.iter().take(16) {
                for fraction in [0.5, 0.3, 0.7] {
                    let total: f64 = ring.windows(2).map(|p| p[0].dist(p[1])).sum();
                    let target = total * fraction;
                    let mut travelled = 0.;
                    for pair in ring.windows(2) {
                        let length = pair[0].dist(pair[1]);
                        if travelled + length >= target {
                            let p = pair[0].add(
                                pair[1]
                                    .sub(pair[0])
                                    .mul((target - travelled) / length.max(1e-9)),
                            );
                            centers.push(p.add(Point::new(0., -20.)));
                            centers.push(p.add(Point::new(0., 20.)));
                            break;
                        }
                        travelled += length;
                    }
                }
            }
        }
        for center in centers {
            attempts += 1;
            if attempts > 2500 {
                break;
            }
            let rect = Rect {
                x: center.x - width / 2.,
                y: center.y - height / 2.,
                w: width,
                h: height,
            };
            if rect.x < bounds.x + 6.
                || rect.y < bounds.y + 6.
                || rect.x + width > bounds.x + bounds.w - 6.
                || rect.y + height > bounds.y + bounds.h - 6.
            {
                continue;
            }
            if foreground_labels.iter().any(|r| rect.overlaps(*r, 9.))
                || symbols.iter().any(|r| rect.overlaps(*r, 8.))
                || placed.iter().any(|r| rect.overlaps(*r, 12.))
                || leaders.iter().any(|(a, b)| rect.crosses(*a, *b, 5.))
                || index.rect_hits(rect, input.get("style").get("lineWidth").num(6.) / 2. + 6.) > 0
            {
                continue;
            }
            if f.geometry == "polygon" && !rectangle_inside(rect, &f.rings, &mut budget) {
                continue;
            }
            labels.push(Value::object(vec![
                ("featureId", f.id.clone().into()),
                ("kind", f.kind.clone().into()),
                ("name", f.name.clone().into()),
                ("bounds", rect.json()),
            ]));
            names.insert(key);
            placed.push(rect);
            break;
        }
    }
    Ok((output, labels))
}
