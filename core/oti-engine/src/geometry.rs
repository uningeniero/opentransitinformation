// SPDX-License-Identifier: Apache-2.0
use crate::json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::f64::consts::PI;

#[derive(Clone, Copy, Debug)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}
impl Point {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
    pub fn add(self, b: Self) -> Self {
        Self::new(self.x + b.x, self.y + b.y)
    }
    pub fn sub(self, b: Self) -> Self {
        Self::new(self.x - b.x, self.y - b.y)
    }
    pub fn mul(self, n: f64) -> Self {
        Self::new(self.x * n, self.y * n)
    }
    pub fn dot(self, b: Self) -> f64 {
        self.x * b.x + self.y * b.y
    }
    pub fn cross(self, b: Self) -> f64 {
        self.x * b.y - self.y * b.x
    }
    pub fn len(self) -> f64 {
        self.x.hypot(self.y)
    }
    pub fn unit(self) -> Self {
        let n = self.len();
        if n < 1e-9 {
            Self::new(1., 0.)
        } else {
            self.mul(1. / n)
        }
    }
    pub fn normal(self) -> Self {
        Self::new(-self.y, self.x)
    }
    pub fn dist(self, b: Self) -> f64 {
        self.sub(b).len()
    }
    pub fn json(self) -> Value {
        Value::Array(vec![self.x.into(), self.y.into()])
    }
}
pub fn point(v: &Value) -> Point {
    Point::new(
        v.array().first().map_or(0., |x| x.num(0.)),
        v.array().get(1).map_or(0., |x| x.num(0.)),
    )
}
pub fn fmt(n: f64) -> String {
    let n = if n.abs() < 0.0005 { 0. } else { n };
    format!("{:.3}", n)
        .trim_end_matches('0')
        .trim_end_matches('.')
        .into()
}
pub fn xy(p: Point) -> String {
    format!("{} {}", fmt(p.x), fmt(p.y))
}
pub fn project(p: Point, line: &[Point]) -> (Point, f64, usize, f64) {
    let mut best = (Point::new(0., 0.), f64::INFINITY, 0, 0.);
    for (i, s) in line.windows(2).enumerate() {
        let d = s[1].sub(s[0]);
        let t = (p.sub(s[0]).dot(d) / d.dot(d).max(1e-12)).clamp(0., 1.);
        let q = s[0].add(d.mul(t));
        let dist = q.dist(p);
        if dist < best.1 {
            best = (q, dist, i, t)
        }
    }
    best
}
pub fn point_segment(p: Point, a: Point, b: Point) -> f64 {
    let d = b.sub(a);
    let t = (p.sub(a).dot(d) / d.dot(d).max(1e-12)).clamp(0., 1.);
    p.dist(a.add(d.mul(t)))
}
pub fn intersection(a: Point, b: Point, c: Point, d: Point) -> bool {
    let ab = b.sub(a);
    let cd = d.sub(c);
    let den = ab.cross(cd);
    if den.abs() < 1e-8 {
        return false;
    }
    let t = c.sub(a).cross(cd) / den;
    let u = c.sub(a).cross(ab) / den;
    t > 1e-5 && t < 1. - 1e-5 && u > 1e-5 && u < 1. - 1e-5
}
pub fn segment_distance(a: Point, b: Point, c: Point, d: Point) -> f64 {
    if intersection(a, b, c, d) {
        return 0.;
    }
    point_segment(a, c, d)
        .min(point_segment(b, c, d))
        .min(point_segment(c, a, b))
        .min(point_segment(d, a, b))
}

pub struct SegmentIndex {
    pub segments: Vec<(Point, Point, usize)>,
    cells: BTreeMap<(i32, i32), Vec<usize>>,
    cell_size: f64,
}
impl SegmentIndex {
    pub fn with_cell(cell_size: f64) -> Self {
        Self {
            segments: vec![],
            cells: BTreeMap::new(),
            cell_size,
        }
    }
    pub fn insert(&mut self, a: Point, b: Point, route: usize) {
        let id = self.segments.len();
        self.segments.push((a, b, route));
        let steps = (a.dist(b) / (self.cell_size / 2.)).ceil().max(1.) as usize;
        let mut keys = BTreeSet::new();
        for i in 0..=steps {
            let p = a.add(b.sub(a).mul(i as f64 / steps as f64));
            let x = (p.x / self.cell_size).floor() as i32;
            let y = (p.y / self.cell_size).floor() as i32;
            for dx in -1..=1 {
                for dy in -1..=1 {
                    keys.insert((x + dx, y + dy));
                }
            }
        }
        for key in keys {
            self.cells.entry(key).or_default().push(id)
        }
    }
    pub fn query(&self, r: Rect) -> BTreeSet<usize> {
        let mut ids = BTreeSet::new();
        let x0 = (r.x / self.cell_size).floor() as i32;
        let y0 = (r.y / self.cell_size).floor() as i32;
        let x1 = ((r.x + r.w) / self.cell_size).floor() as i32;
        let y1 = ((r.y + r.h) / self.cell_size).floor() as i32;
        for x in x0..=x1 {
            for y in y0..=y1 {
                if let Some(list) = self.cells.get(&(x, y)) {
                    ids.extend(list)
                }
            }
        }
        ids
    }
    pub fn rect_hits(&self, r: Rect, pad: f64) -> usize {
        let x0 = ((r.x - pad) / self.cell_size).floor() as i32;
        let y0 = ((r.y - pad) / self.cell_size).floor() as i32;
        let x1 = ((r.x + r.w + pad) / self.cell_size).floor() as i32;
        let y1 = ((r.y + r.h + pad) / self.cell_size).floor() as i32;
        for x in x0..=x1 {
            for y in y0..=y1 {
                if let Some(ids) = self.cells.get(&(x, y)) {
                    for id in ids {
                        let (a, b, _) = self.segments[*id];
                        if r.crosses(a, b, pad) {
                            return 1;
                        }
                    }
                }
            }
        }
        0
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
impl Rect {
    pub fn json(self) -> Value {
        Value::object(vec![
            ("x", self.x.into()),
            ("y", self.y.into()),
            ("width", self.w.into()),
            ("height", self.h.into()),
        ])
    }
    pub fn overlaps(self, b: Self, gap: f64) -> bool {
        self.x < b.x + b.w + gap
            && self.x + self.w + gap > b.x
            && self.y < b.y + b.h + gap
            && self.y + self.h + gap > b.y
    }
    pub fn contains(self, p: Point) -> bool {
        p.x >= self.x && p.x <= self.x + self.w && p.y >= self.y && p.y <= self.y + self.h
    }
    pub fn crosses(self, a: Point, b: Point, pad: f64) -> bool {
        let r = Self {
            x: self.x - pad,
            y: self.y - pad,
            w: self.w + 2. * pad,
            h: self.h + 2. * pad,
        };
        if r.contains(a) || r.contains(b) {
            return true;
        }
        let p = [
            Point::new(r.x, r.y),
            Point::new(r.x + r.w, r.y),
            Point::new(r.x + r.w, r.y + r.h),
            Point::new(r.x, r.y + r.h),
        ];
        (0..4).any(|i| intersection(a, b, p[i], p[(i + 1) % 4]))
    }
}

pub fn rounded_offset(points: &[Point], offsets: &[f64], radius: f64) -> (String, Vec<Point>) {
    if points.len() > 3 && points[0].dist(*points.last().unwrap()) < 1e-6 {
        let count = points.len() - 1;
        let seam = (0..count)
            .max_by(|a, b| {
                points[*a]
                    .dist(points[*a + 1])
                    .total_cmp(&points[*b].dist(points[*b + 1]))
                    .then_with(|| {
                        let pa = points[*a].add(points[*a + 1]).mul(0.5);
                        let pb = points[*b].add(points[*b + 1]).mul(0.5);
                        pb.x.total_cmp(&pa.x).then(pb.y.total_cmp(&pa.y))
                    })
            })
            .unwrap();
        let middle = points[seam].add(points[seam + 1]).mul(0.5);
        let mut rotated = vec![middle];
        let mut off = vec![offsets.get(seam).copied().unwrap_or(0.)];
        for k in 1..=count {
            let i = (seam + k) % count;
            rotated.push(points[i]);
            off.push(offsets.get(i).copied().unwrap_or(0.));
        }
        rotated.push(middle);
        let (mut svg, sampled) = rounded_offset_open(&rotated, &off, radius);
        svg.push_str(" Z");
        return (svg, sampled);
    }
    rounded_offset_open(points, offsets, radius)
}
fn rounded_offset_open(points: &[Point], offsets: &[f64], radius: f64) -> (String, Vec<Point>) {
    if points.len() < 2 {
        return (String::new(), vec![]);
    }
    let n = points.len();
    let dirs: Vec<Point> = points.windows(2).map(|s| s[1].sub(s[0]).unit()).collect();
    let off = |i: usize| offsets.get(i).copied().unwrap_or(0.);
    let start = points[0].add(dirs[0].normal().mul(off(0)));
    let mut path = format!("M{}", xy(start));
    let mut sampled = vec![start];
    for i in 1..n - 1 {
        let a = dirs[i - 1];
        let b = dirs[i];
        let turn = a.cross(b);
        let dot = a.dot(b).clamp(-1., 1.);
        let angle = dot.acos();
        let d1 = off(i - 1);
        let d2 = off(i);
        if angle < 0.00001 && (d1 - d2).abs() < 0.00001 {
            continue;
        }
        if angle < 0.01 {
            let trim = radius
                .max((d1 - d2).abs() * 1.5)
                .min(points[i].dist(points[i - 1]) * 0.44)
                .min(points[i + 1].dist(points[i]) * 0.44);
            let p1 = points[i].sub(a.mul(trim)).add(a.normal().mul(d1));
            let p2 = points[i].add(b.mul(trim)).add(b.normal().mul(d2));
            let c1 = p1.add(a.mul(trim * 0.9));
            let c2 = p2.sub(b.mul(trim * 0.9));
            path.push_str(&format!(" L{} C{} {} {}", xy(p1), xy(c1), xy(c2), xy(p2)));
            sampled.push(p1);
            for k in 1..=20 {
                let t = k as f64 / 20.;
                let u = 1. - t;
                sampled.push(
                    p1.mul(u * u * u)
                        .add(c1.mul(3. * u * u * t))
                        .add(c2.mul(3. * u * t * t))
                        .add(p2.mul(t * t * t)),
                );
            }
            continue;
        }
        if angle > PI - 0.02 || turn.abs() < 1e-7 {
            let q1 = points[i].add(a.normal().mul(d1));
            let q2 = points[i].add(b.normal().mul(d2));
            path.push_str(&format!(" L{} L{}", xy(q1), xy(q2)));
            sampled.extend([q1, q2]);
            continue;
        }
        let tan = (angle / 2.).tan();
        let trim = (radius * tan)
            .min(points[i].dist(points[i - 1]) * 0.44)
            .min(points[i + 1].dist(points[i]) * 0.44);
        let actual = trim / tan;
        let s = points[i].sub(a.mul(trim));
        let e = points[i].add(b.mul(trim));
        let p1 = s.add(a.normal().mul(d1));
        let p2 = e.add(b.normal().mul(d2));
        path.push_str(&format!(" L{}", xy(p1)));
        sampled.push(p1);
        let sign = turn.signum();
        let r = actual - sign * d1;
        if (d1 - d2).abs() < 1e-5 && r > 0.2 {
            let center = s.add(a.normal().mul(sign * actual));
            let v = p1.sub(center);
            let theta = angle * sign;
            path.push_str(&format!(
                " A{} {} 0 0 {} {}",
                fmt(r),
                fmt(r),
                if turn > 0. { 1 } else { 0 },
                xy(p2)
            ));
            let steps = (angle / 0.08).ceil() as usize;
            for k in 1..=steps {
                let t = theta * k as f64 / steps as f64;
                sampled.push(center.add(Point::new(
                    v.x * t.cos() - v.y * t.sin(),
                    v.x * t.sin() + v.y * t.cos(),
                )))
            }
        } else {
            let c1 = p1.add(a.mul(trim * 0.6));
            let c2 = p2.sub(b.mul(trim * 0.6));
            path.push_str(&format!(" C{} {} {}", xy(c1), xy(c2), xy(p2)));
            let steps = ((p1.dist(c1) + c1.dist(c2) + c2.dist(p2)) / 2.)
                .ceil()
                .clamp(2., 20.) as usize;
            for k in 1..=steps {
                let t = k as f64 / steps as f64;
                let u = 1. - t;
                sampled.push(
                    p1.mul(u * u * u)
                        .add(c1.mul(3. * u * u * t))
                        .add(c2.mul(3. * u * t * t))
                        .add(p2.mul(t * t * t)),
                )
            }
        }
    }
    let end = points[n - 1].add(dirs[n - 2].normal().mul(off(n - 2)));
    path.push_str(&format!(" L{}", xy(end)));
    sampled.push(end);
    (path, sampled)
}

pub fn octilinear(points: &[Point]) -> Vec<Point> {
    let mut out = vec![points[0]];
    for s in points.windows(2) {
        let (a, b) = if s[0]
            .x
            .total_cmp(&s[1].x)
            .then(s[0].y.total_cmp(&s[1].y))
            .is_le()
        {
            (s[0], s[1])
        } else {
            (s[1], s[0])
        };
        let d = b.sub(a);
        let dx = d.x.abs();
        let dy = d.y.abs();
        if dx > 1e-6 && dy > 1e-6 && (dx - dy).abs() > 1e-5 {
            let p = if dx > dy {
                Point::new(b.x - d.x.signum() * dy, a.y)
            } else {
                Point::new(a.x, b.y - d.y.signum() * dx)
            };
            if out.last().unwrap().dist(p) > 1e-4 {
                out.push(p)
            }
        }
        if out.last().unwrap().dist(s[1]) > 1e-4 {
            out.push(s[1])
        }
    }
    out
}
