// SPDX-License-Identifier: Apache-2.0
use crate::geometry::Point;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

fn node(p: Point) -> String {
    format!("{:.3}:{:.3}", p.x, p.y)
}
fn edge(a: Point, b: Point) -> (String, Point, Point, f64) {
    if a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y)).is_le() {
        (format!("{}|{}", node(a), node(b)), a, b, 1.)
    } else {
        (format!("{}|{}", node(b), node(a)), b, a, -1.)
    }
}

pub fn assign(
    lines: &[Vec<Point>],
    owners: &[usize],
    route_ids: &[String],
    spacing: f64,
) -> (Vec<Vec<f64>>, usize) {
    let mut unique: BTreeMap<String, (Point, Point, BTreeSet<usize>)> = BTreeMap::new();
    for (line, owner) in lines.iter().zip(owners) {
        for pair in line.windows(2) {
            let (key, a, b, _) = edge(pair[0], pair[1]);
            unique
                .entry(key)
                .or_insert_with(|| (a, b, BTreeSet::new()))
                .2
                .insert(*owner);
        }
    }
    let keys: BTreeMap<String, usize> = unique
        .keys()
        .enumerate()
        .map(|(i, k)| (k.clone(), i))
        .collect();
    let edges: Vec<_> = unique.values().cloned().collect();
    let mut vertices: BTreeMap<String, Vec<(usize, f64)>> = BTreeMap::new();
    for (i, (a, b, _)) in edges.iter().enumerate() {
        vertices.entry(node(*a)).or_default().push((i, 1.));
        vertices.entry(node(*b)).or_default().push((i, -1.));
    }
    let mut neighbors = vec![vec![]; edges.len()];
    for incident in vertices.values() {
        for i in 0..incident.len() {
            for j in i + 1..incident.len() {
                let (a, sa) = incident[i];
                let (b, sb) = incident[j];
                let da = edges[a].1.sub(edges[a].0).unit().mul(sa);
                let db = edges[b].1.sub(edges[b].0).unit().mul(sb);
                if incident.len() == 2 || da.dot(db) < -0.99999 {
                    let relation = -sa * sb;
                    neighbors[a].push((b, relation));
                    neighbors[b].push((a, relation));
                }
            }
        }
    }
    let mut orientations = vec![0.; edges.len()];
    let mut groups = vec![0; edges.len()];
    let mut memberships = vec![];
    let mut maximum = 0;
    for seed in 0..edges.len() {
        if orientations[seed] != 0. {
            continue;
        }
        let group = memberships.len();
        let mut routes = BTreeSet::new();
        let mut conflicts: BTreeMap<usize, BTreeSet<usize>> = BTreeMap::new();
        let mut coverage: BTreeMap<usize, f64> = BTreeMap::new();
        let mut queue = VecDeque::from([seed]);
        orientations[seed] = 1.;
        while let Some(i) = queue.pop_front() {
            groups[i] = group;
            routes.extend(edges[i].2.iter().copied());
            for &route in &edges[i].2 {
                *coverage.entry(route).or_default() += edges[i].0.dist(edges[i].1);
                conflicts
                    .entry(route)
                    .or_default()
                    .extend(edges[i].2.iter().copied().filter(|r| *r != route));
            }
            for &(j, relation) in &neighbors[i] {
                if orientations[j] == 0. {
                    orientations[j] = orientations[i] * relation;
                    queue.push_back(j);
                }
            }
        }
        let mut routes: Vec<usize> = routes.into_iter().collect();
        routes.sort_by(|a, b| {
            coverage[b]
                .total_cmp(&coverage[a])
                .then(route_ids[*a].cmp(&route_ids[*b]))
        });
        let mut slots: BTreeMap<usize, i32> = BTreeMap::new();
        for route in routes {
            let occupied: BTreeSet<i32> = conflicts[&route]
                .iter()
                .filter_map(|r| slots.get(r).copied())
                .collect();
            let mut candidate = 0;
            for i in 0..=owners.len() * 2 {
                candidate = if i % 2 == 1 {
                    (i as i32 + 1) / 2
                } else {
                    -(i as i32) / 2
                };
                if !occupied.contains(&candidate) {
                    break;
                }
            }
            slots.insert(route, candidate);
        }
        let low = slots.values().min().copied().unwrap_or(0);
        let high = slots.values().max().copied().unwrap_or(0);
        maximum = maximum.max((high - low + 1) as usize);
        memberships.push(slots);
    }
    let offsets = lines
        .iter()
        .zip(owners)
        .map(|(line, owner)| {
            line.windows(2)
                .map(|pair| {
                    let (key, _, _, sign) = edge(pair[0], pair[1]);
                    let i = keys[&key];
                    let slots = &memberships[groups[i]];
                    sign * orientations[i] * slots[owner] as f64 * spacing
                })
                .collect()
        })
        .collect();
    (offsets, maximum)
}
