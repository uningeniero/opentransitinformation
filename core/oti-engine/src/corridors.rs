// SPDX-License-Identifier: Apache-2.0
use crate::geometry::*;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy)]
struct Match {
    path: usize,
    along: f64,
    distance: f64,
}
fn lengths(line: &[Point]) -> Vec<f64> {
    let mut a = vec![0.];
    for s in line.windows(2) {
        a.push(a.last().unwrap() + s[0].dist(s[1]))
    }
    a
}
fn at(line: &[Point], lengths: &[f64], distance: f64) -> Point {
    let i = lengths
        .partition_point(|n| *n < distance)
        .saturating_sub(1)
        .min(line.len() - 2);
    let t = ((distance - lengths[i]) / (lengths[i + 1] - lengths[i]).max(1e-9)).clamp(0., 1.);
    line[i].add(line[i + 1].sub(line[i]).mul(t))
}
fn subline(line: &[Point], lengths: &[f64], a: f64, b: f64) -> Vec<Point> {
    let mut out = vec![at(line, lengths, a)];
    if b >= a {
        for (i, p) in line.iter().enumerate() {
            if lengths[i] > a + 1e-5 && lengths[i] < b - 1e-5 {
                out.push(*p)
            }
        }
    } else {
        for (i, p) in line.iter().enumerate().rev() {
            if lengths[i] < a - 1e-5 && lengths[i] > b + 1e-5 {
                out.push(*p)
            }
        }
    }
    out.push(at(line, lengths, b));
    out
}

pub fn align(
    lines: &[Vec<Point>],
    memberships: &[Vec<String>],
    tolerance: f64,
) -> Result<(Vec<Vec<Point>>, usize, f64), String> {
    if tolerance <= 0. {
        return Ok((split_shared(lines), 0, 0.));
    }
    let mut index = SegmentIndex::with_cell(16.);
    let mut local_segments = vec![];
    let mut indexed = BTreeSet::new();
    let mut canonical: Vec<Vec<Point>> = vec![];
    let mut distances: Vec<Vec<f64>> = vec![];
    let mut matched = 0usize;
    let mut maximum: f64 = 0.;
    let mut total = 0usize;
    for (pi, line) in lines.iter().enumerate() {
        crate::mark(1000 + pi as u32);
        let compatible: BTreeSet<usize> = (0..pi)
            .filter(|j| memberships[pi].iter().any(|s| memberships[*j].contains(s)))
            .collect();
        let mut output = line.clone();
        if !compatible.is_empty() {
            let mut samples = vec![(line[0], line[1].sub(line[0]).unit())];
            for pair in line.windows(2) {
                let d = pair[1].sub(pair[0]);
                let steps = (d.len() / tolerance.max(1.)).ceil().max(1.) as usize;
                if samples.len() + steps > 250000 {
                    return Err("Corridor sampling limit exceeded".into());
                }
                for i in 1..=steps {
                    samples.push((pair[0].add(d.mul(i as f64 / steps as f64)), d.unit()))
                }
            }
            let mut last_reference: Option<usize> = None;
            let matches: Vec<Option<Match>> = samples
                .iter()
                .map(|(p, tangent)| {
                    let mut best: Option<Match> = None;
                    let mut best_score = f64::INFINITY;
                    for id in index.query(Rect {
                        x: p.x - tolerance,
                        y: p.y - tolerance,
                        w: 2. * tolerance,
                        h: 2. * tolerance,
                    }) {
                        let (a, b, path) = index.segments[id];
                        if !compatible.contains(&path) {
                            continue;
                        }
                        let d = b.sub(a);
                        if d.unit().dot(*tangent).abs() < 0.866 {
                            continue;
                        }
                        let t = (p.sub(a).dot(d) / d.dot(d).max(1e-9)).clamp(0., 1.);
                        let distance = point_segment(*p, a, b);
                        if distance > tolerance {
                            continue;
                        }
                        let along = distances[path][local_segments[id]] + d.len() * t;
                        let score = distance
                            + if last_reference.is_some() && last_reference != Some(path) {
                                tolerance
                            } else {
                                0.
                            };
                        if score < best_score - 1e-6 {
                            best_score = score;
                            best = Some(Match {
                                path,
                                along,
                                distance,
                            })
                        }
                    }
                    last_reference = best.map(|b| b.path);
                    best
                })
                .collect();
            output = vec![];
            let mut i = 0;
            while i < samples.len() {
                if let Some(start) = matches[i] {
                    let mut j = i + 1;
                    let mut direction = 0.;
                    let mut previous = start.along;
                    while j < samples.len() {
                        let Some(next) = matches[j] else { break };
                        if next.path != start.path {
                            break;
                        }
                        let delta = next.along - previous;
                        let source_step = samples[j].0.dist(samples[j - 1].0);
                        if delta.abs() > source_step * 2. + tolerance {
                            break;
                        }
                        if direction == 0. && delta.abs() > 0.1 {
                            direction = delta.signum()
                        }
                        if direction != 0. && delta * direction < -tolerance * 0.25 {
                            break;
                        }
                        previous = next.along;
                        j += 1;
                    }
                    let end = matches[j - 1].unwrap();
                    if j - i >= 3 && (end.along - start.along).abs() >= tolerance * 3. {
                        let part = subline(
                            &canonical[start.path],
                            &distances[start.path],
                            start.along,
                            end.along,
                        );
                        output.extend(part);
                        matched += j - i;
                        for m in matches.iter().take(j).skip(i).flatten() {
                            maximum = maximum.max(m.distance)
                        }
                        i = j;
                        continue;
                    }
                }
                output.push(samples[i].0);
                i += 1;
            }
            output.dedup_by(|a, b| a.dist(*b) < 1e-5);
            if output.len() < 2 {
                output = line.clone()
            }
        }
        total += output.len();
        if total > 250000 {
            return Err("Aligned network exceeds 250000 vertices".into());
        }
        let cumulative = lengths(&output);
        for (si, pair) in output.windows(2).enumerate() {
            let a = format!("{:.4}:{:.4}", pair[0].x, pair[0].y);
            let b = format!("{:.4}:{:.4}", pair[1].x, pair[1].y);
            let key = if a < b {
                format!("{}|{}", a, b)
            } else {
                format!("{}|{}", b, a)
            };
            if indexed.insert(key) {
                index.insert(pair[0], pair[1], pi);
                local_segments.push(si)
            }
        }
        canonical.push(output);
        distances.push(cumulative);
    }
    crate::mark(20);
    Ok((split_shared(&canonical), matched, maximum))
}

fn split_shared(lines: &[Vec<Point>]) -> Vec<Vec<Point>> {
    let mut index = SegmentIndex::with_cell(16.);
    let mut owners: Vec<Vec<(usize, usize, bool)>> = vec![];
    let mut unique: BTreeMap<String, usize> = BTreeMap::new();
    let mut vertices = BTreeMap::new();
    for (pi, line) in lines.iter().enumerate() {
        for (si, pair) in line.windows(2).enumerate() {
            let a = format!("{:.5}:{:.5}", pair[0].x, pair[0].y);
            let b = format!("{:.5}:{:.5}", pair[1].x, pair[1].y);
            let forward = a < b;
            let key = if forward {
                format!("{}|{}", a, b)
            } else {
                format!("{}|{}", b, a)
            };
            if let Some(id) = unique.get(&key) {
                owners[*id].push((pi, si, forward))
            } else {
                let id = owners.len();
                unique.insert(key, id);
                owners.push(vec![(pi, si, forward)]);
                if forward {
                    index.insert(pair[0], pair[1], id)
                } else {
                    index.insert(pair[1], pair[0], id)
                }
            }
        }
        for p in line {
            vertices
                .entry(format!("{:.5}:{:.5}", p.x, p.y))
                .or_insert(*p);
        }
    }
    let mut split: BTreeMap<(usize, usize), Vec<(f64, Point)>> = BTreeMap::new();
    for p in vertices.values() {
        for id in index.query(Rect {
            x: p.x - 0.001,
            y: p.y - 0.001,
            w: 0.002,
            h: 0.002,
        }) {
            let (a, b, group) = index.segments[id];
            let d = b.sub(a);
            let t = p.sub(a).dot(d) / d.dot(d).max(1e-12);
            if t > 1e-5 && t < 1. - 1e-5 && point_segment(*p, a, b) < 1e-5 {
                for (pi, si, forward) in &owners[group] {
                    split
                        .entry((*pi, *si))
                        .or_default()
                        .push((if *forward { t } else { 1. - t }, *p))
                }
            }
        }
    }
    lines
        .iter()
        .enumerate()
        .map(|(pi, line)| {
            let mut out = vec![line[0]];
            for (si, pair) in line.windows(2).enumerate() {
                if let Some(list) = split.get_mut(&(pi, si)) {
                    list.sort_by(|a, b| a.0.total_cmp(&b.0));
                    for (_, p) in list {
                        if out.last().unwrap().dist(*p) > 1e-5 {
                            out.push(*p)
                        }
                    }
                }
                if out.last().unwrap().dist(pair[1]) > 1e-5 {
                    out.push(pair[1])
                }
            }
            out
        })
        .collect()
}
