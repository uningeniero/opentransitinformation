// SPDX-License-Identifier: Apache-2.0
use crate::geometry::{project, Point};
use crate::json::Value;
use std::collections::BTreeSet;

fn number(v: &Value, default: f64, low: f64, high: f64, name: &str) -> Result<f64, String> {
    let n = match v {
        Value::Null => default,
        Value::Number(n) => *n,
        _ => return Err(format!("Invalid motion {name}")),
    };
    if !n.is_finite() || n < low || n > high {
        return Err(format!("Invalid motion {name}"));
    }
    Ok(n)
}
fn integer(
    v: &Value,
    default: usize,
    low: usize,
    high: usize,
    name: &str,
) -> Result<usize, String> {
    let n = number(v, default as f64, low as f64, high as f64, name)?;
    if n.fract() != 0. {
        return Err(format!("Invalid motion {name}"));
    }
    Ok(n as usize)
}
fn clean(n: f64) -> Value {
    ((n * 1000.).round() / 1000.).into()
}
fn cumulative(points: &[Point]) -> Vec<f64> {
    let mut result = vec![0.];
    for pair in points.windows(2) {
        result.push(result.last().unwrap() + pair[0].dist(pair[1]));
    }
    result
}

pub fn stop_anchors(points: &[Point], anchors: &[(String, Point)]) -> Value {
    let lengths = cumulative(points);
    let total = *lengths.last().unwrap_or(&0.);
    if points.len() < 2 || total < 1e-9 {
        return Value::Array(vec![]);
    }
    let mut stops: Vec<(String, f64)> = anchors
        .iter()
        .map(|(id, p)| {
            let (_, _, segment, t) = project(*p, points);
            let distance = lengths[segment] + points[segment].dist(points[segment + 1]) * t;
            (id.clone(), (distance / total).clamp(0., 1.))
        })
        .collect();
    stops.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
    stops.dedup_by(|a, b| a.0 == b.0 && (a.1 - b.1).abs() < 1e-9);
    Value::Array(
        stops
            .into_iter()
            .map(|(id, fraction)| {
                Value::object(vec![("id", id.into()), ("fraction", fraction.into())])
            })
            .collect(),
    )
}

fn position(points: &[Point], lengths: &[f64], fraction: f64) -> (Point, f64) {
    let distance = fraction.clamp(0., 1.) * lengths.last().unwrap();
    let at = lengths
        .partition_point(|n| *n <= distance)
        .saturating_sub(1)
        .min(points.len() - 2);
    let a = points[at];
    let b = points[at + 1];
    let delta = b.sub(a);
    let t = ((distance - lengths[at]) / (lengths[at + 1] - lengths[at])).clamp(0., 1.);
    (a.add(delta.mul(t)), delta.y.atan2(delta.x).to_degrees())
}

pub fn plan(input: &Value) -> Result<Value, String> {
    let options = input.get("options");
    if options.get("mode").str() != "demo" {
        return Err("Motion mode must be demo".into());
    }
    let duration = integer(options.get("durationMs"), 30000, 4000, 120000, "durationMs")?;
    let fps = integer(options.get("fps"), 60, 1, 60, "fps")?;
    let dwell = integer(options.get("dwellMs"), 450, 0, 5000, "dwellMs")?;
    let count = (duration * fps).div_ceil(1000);
    let selections = options.get("vehicles").array();
    if selections.is_empty() || selections.len() > 16 || count * selections.len() > 60000 {
        return Err("Motion frame or vehicle budget exceeded".into());
    }
    let paths = input.get("layout").get("paths").array();
    let mut ids = BTreeSet::new();
    let mut vehicles = vec![];
    let mut point_budget = 0usize;
    for selection in selections {
        let id = selection.get("id").str();
        let route = selection.get("routeId").str();
        if id.is_empty() || id.len() > 256 || route.is_empty() || !ids.insert(id) {
            return Err("Motion vehicles require unique IDs and existing routes".into());
        }
        let part = integer(selection.get("part"), 0, 0, 100000, "part")?;
        let phase = number(selection.get("phase"), 0.2, 0., 1., "phase")?;
        if phase >= 1. {
            return Err("Motion phase must be less than 1".into());
        }
        let matches: Vec<_> = paths
            .iter()
            .filter(|p| p.get("routeId").str() == route && p.get("part").num(-1.) == part as f64)
            .collect();
        if matches.len() != 1 {
            return Err("Motion vehicle references an unavailable or ambiguous route part".into());
        }
        let path = matches[0];
        let mut points = vec![];
        if path.get("points").array().len() > 100000 {
            return Err("Motion path point budget exceeded".into());
        }
        for value in path.get("points").array() {
            let coords = value.array();
            if coords.len() != 2 {
                return Err("Invalid motion path coordinate".into());
            }
            let p = Point::new(
                number(&coords[0], f64::NAN, -1e8, 1e8, "coordinate")?,
                number(&coords[1], f64::NAN, -1e8, 1e8, "coordinate")?,
            );
            if points.last().is_none_or(|last: &Point| last.dist(p) > 1e-9) {
                points.push(p);
            }
        }
        point_budget += points.len();
        if points.len() < 2 || point_budget > 250000 {
            return Err("Motion path is empty or exceeds the point budget".into());
        }
        let lengths = cumulative(&points);
        let total = *lengths.last().unwrap();
        if !total.is_finite() || total < 1e-6 {
            return Err("Degenerate motion path".into());
        }
        let mut stops = vec![];
        for stop in path.get("motionStops").array() {
            let fraction = number(stop.get("fraction"), f64::NAN, 0., 1., "stop fraction")?;
            let stop_id = stop.get("id").str();
            if stop_id.is_empty() {
                return Err("Motion stop requires an ID".into());
            }
            if fraction > 1e-6 && fraction < 1. - 1e-6 {
                stops.push((stop_id.to_string(), fraction));
            }
        }
        if stops.len() > 2048 {
            return Err("Motion stop budget exceeded".into());
        }
        stops.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
        let dwell_total = stops.len() * dwell;
        if dwell_total > duration / 2 {
            return Err("Motion dwell must leave at least half the cycle for movement".into());
        }
        let travel = (duration - dwell_total) as f64;
        let departures: Vec<f64> = stops
            .iter()
            .enumerate()
            .map(|(i, s)| s.1 * travel + ((i + 1) * dwell) as f64)
            .collect();
        let closed = points[0].dist(*points.last().unwrap()) < 0.01;
        let mut frames = Vec::with_capacity(count);
        for frame in 0..count {
            let time = ((frame as f64 / count as f64 + phase) % 1.) * duration as f64;
            let completed = departures.partition_point(|t| *t <= time);
            let mut fraction = ((time - (completed * dwell) as f64) / travel).clamp(0., 1.);
            let mut stop_index = Value::Null;
            if completed < stops.len()
                && time >= stops[completed].1 * travel + (completed * dwell) as f64
            {
                fraction = stops[completed].1;
                stop_index = completed.into();
            }
            let (p, heading) = position(&points, &lengths, fraction);
            let opacity = if closed {
                1.
            } else {
                (fraction / 0.04).min((1. - fraction) / 0.04).clamp(0., 1.)
            };
            frames.push(Value::Array(vec![
                clean(p.x),
                clean(p.y),
                clean(heading),
                fraction.into(),
                clean(opacity),
                stop_index,
            ]));
        }
        vehicles.push(Value::object(vec![
            ("id", id.into()),
            ("routeId", route.into()),
            ("part", part.into()),
            ("length", total.into()),
            ("closed", Value::Bool(closed)),
            (
                "stops",
                Value::Array(
                    stops
                        .iter()
                        .map(|s| {
                            Value::object(vec![
                                ("id", s.0.clone().into()),
                                ("fraction", s.1.into()),
                            ])
                        })
                        .collect(),
                ),
            ),
            ("frames", Value::Array(frames)),
        ]));
    }
    Ok(Value::object(vec![
        ("mode", "demo".into()),
        ("durationMs", duration.into()),
        ("fps", fps.into()),
        ("frameCount", count.into()),
        ("vehicles", Value::Array(vehicles)),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Value {
        crate::json::parse(r#"{"layout":{"paths":[{"routeId":"a","part":0,"points":[[0,0],[90,0],[90,10]],"motionStops":[{"id":"s","fraction":0.5}]}]},"options":{"mode":"demo","durationMs":4000,"fps":10,"dwellMs":200,"vehicles":[{"id":"v","routeId":"a","phase":0}]}}"#).unwrap()
    }
    #[test]
    fn sampling_uses_distance_not_vertex_index() {
        let p = vec![
            Point::new(0., 0.),
            Point::new(90., 0.),
            Point::new(90., 10.),
        ];
        let (at, h) = position(&p, &cumulative(&p), 0.5);
        assert_eq!(at.x, 50.);
        assert_eq!(at.y, 0.);
        assert_eq!(h, 0.);
    }
    #[test]
    fn deterministic_and_actual_stop_dwell() {
        let a = plan(&fixture()).unwrap();
        assert_eq!(a.stringify(), plan(&fixture()).unwrap().stringify());
        let frames = a.get("vehicles").array()[0].get("frames").array();
        assert_eq!(frames[19].array()[0].num(-1.), 50.);
        assert_eq!(frames[20].array()[0].num(-1.), 50.);
        assert_eq!(frames[19].array()[5].num(-1.), 0.);
        assert_eq!(frames[0].array()[4].num(-1.), 0.);
    }
    #[test]
    fn unknown_parts_do_not_join_disconnected_geometry() {
        let mut v = fixture();
        if let Value::Object(ref mut options) = v {
            if let Value::Object(ref mut o) = options.get_mut("options").unwrap() {
                if let Value::Array(ref mut vehicles) = o.get_mut("vehicles").unwrap() {
                    if let Value::Object(ref mut vehicle) = vehicles[0] {
                        vehicle.insert("part".into(), 1usize.into());
                    }
                }
            }
        }
        assert!(plan(&v).is_err());
    }
    #[test]
    fn stop_anchors_are_declared_and_ordered() {
        let p = vec![Point::new(0., 0.), Point::new(100., 0.)];
        let s = stop_anchors(
            &p,
            &[
                ("b".into(), Point::new(80., 0.)),
                ("a".into(), Point::new(20., 0.)),
            ],
        );
        assert_eq!(s.array()[0].get("id").str(), "a");
        assert!((s.array()[0].get("fraction").num(0.) - 0.2).abs() < 1e-9);
    }
    #[test]
    fn non_demo_mode_rejected() {
        assert!(plan(&Value::Null).is_err());
    }
}
