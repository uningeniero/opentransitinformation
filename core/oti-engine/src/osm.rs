// SPDX-License-Identifier: Apache-2.0
use crate::geometry::{point_segment, Point};
use crate::json::Value;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

const MAX_ELEMENTS: usize = 50000;
const MAX_INPUT_VERTICES: usize = 500000;
const MAX_FEATURES: usize = 20000;
const MAX_OUTPUT_VERTICES: usize = 150000;
const MAX_MEMBERS: usize = 10000;
const MAX_TOPOLOGY_WORK: usize = 30000000;
const EPS: f64 = 1e-12;

#[derive(Clone, Debug)]
struct Failure {
    code: &'static str,
    message: String,
}
impl Failure {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    fn limit(message: impl Into<String>) -> Self {
        Self::new("OSM_COMPLEXITY_LIMIT", message)
    }
}

#[derive(Clone, Debug)]
struct Vertex {
    point: Point,
    node: Option<String>,
}
#[derive(Clone)]
struct Class {
    kind: &'static str,
    geometry: &'static str,
    classification: String,
}
struct Fragment {
    id: String,
    vertices: Vec<Vertex>,
}

fn id(value: &Value) -> Option<String> {
    match value {
        Value::Number(n)
            if n.is_finite() && *n > 0. && n.fract() == 0. && *n <= 9007199254740991. =>
        {
            Some(format!("{:.0}", n))
        }
        Value::String(s)
            if !s.is_empty() && s.len() <= 20 && s.bytes().all(|c| c.is_ascii_digit()) =>
        {
            s.parse::<u64>()
                .ok()
                .filter(|n| *n > 0)
                .map(|n| n.to_string())
        }
        _ => None,
    }
}
fn coordinate(value: &Value) -> Option<Point> {
    match (value.get("lon"), value.get("lat")) {
        (Value::Number(x), Value::Number(y))
            if x.is_finite() && y.is_finite() && x.abs() <= 180. && y.abs() <= 85.051129 =>
        {
            Some(Point::new(
                if *x == 0. { 0. } else { *x },
                if *y == 0. { 0. } else { *y },
            ))
        }
        _ => None,
    }
}
fn tag<'a>(tags: &'a Value, key: &str) -> &'a str {
    tags.get(key).str()
}
fn classified(kind: &'static str, geometry: &'static str, value: &str) -> Class {
    Class {
        kind,
        geometry,
        classification: value.to_string(),
    }
}
fn classify(tags: &Value, relation: bool) -> Option<Class> {
    let building = tag(tags, "building");
    if !building.is_empty() && building != "no" {
        return Some(classified("building", "polygon", building));
    }
    let natural = tag(tags, "natural");
    let landuse = tag(tags, "landuse");
    let waterway = tag(tags, "waterway");
    if natural == "water" || matches!(landuse, "reservoir" | "basin") || waterway == "riverbank" {
        let class = if !tag(tags, "water").is_empty() {
            tag(tags, "water")
        } else if !waterway.is_empty() {
            waterway
        } else if !landuse.is_empty() {
            landuse
        } else {
            "water"
        };
        return Some(classified("water", "polygon", class));
    }
    if matches!(waterway, "river" | "canal" | "stream" | "drain" | "ditch") {
        return Some(classified(
            "water",
            if relation { "polygon" } else { "line" },
            waterway,
        ));
    }
    let leisure = tag(tags, "leisure");
    if matches!(
        leisure,
        "park" | "garden" | "nature_reserve" | "recreation_ground" | "golf_course"
    ) {
        return Some(classified("park", "polygon", leisure));
    }
    if matches!(
        landuse,
        "forest" | "grass" | "meadow" | "recreation_ground" | "village_green" | "cemetery"
    ) {
        return Some(classified("park", "polygon", landuse));
    }
    if matches!(
        natural,
        "wood" | "scrub" | "heath" | "grassland" | "wetland"
    ) {
        return Some(classified("park", "polygon", natural));
    }
    if matches!(
        landuse,
        "residential"
            | "commercial"
            | "retail"
            | "industrial"
            | "brownfield"
            | "construction"
            | "education"
            | "garages"
            | "railway"
            | "military"
    ) {
        return Some(classified("urban", "polygon", landuse));
    }
    let highway = tag(tags, "highway");
    if matches!(
        highway,
        "motorway"
            | "motorway_link"
            | "trunk"
            | "trunk_link"
            | "primary"
            | "primary_link"
            | "secondary"
            | "secondary_link"
            | "tertiary"
            | "tertiary_link"
            | "unclassified"
            | "residential"
            | "living_street"
            | "service"
            | "pedestrian"
            | "footway"
            | "path"
            | "cycleway"
            | "steps"
            | "track"
    ) {
        if highway == "pedestrian" && (tag(tags, "area") == "yes" || relation) {
            return Some(classified("urban", "polygon", highway));
        }
        return Some(classified("street", "line", highway));
    }
    let railway = tag(tags, "railway");
    if matches!(
        railway,
        "rail"
            | "light_rail"
            | "subway"
            | "tram"
            | "narrow_gauge"
            | "monorail"
            | "funicular"
            | "preserved"
            | "disused"
    ) {
        return Some(classified("rail", "line", railway));
    }
    let boundary = tag(tags, "boundary");
    if matches!(boundary, "national_park" | "protected_area") {
        return Some(classified("park", "polygon", boundary));
    }
    if matches!(
        boundary,
        "administrative" | "postal_code" | "political" | "census"
    ) {
        return Some(classified(
            "district",
            if relation { "polygon" } else { "line" },
            boundary,
        ));
    }
    let place = tag(tags, "place");
    if matches!(place, "suburb" | "quarter" | "neighbourhood") {
        return Some(classified("district", "polygon", place));
    }
    if natural == "coastline" {
        return Some(classified("land", "line", natural));
    }
    if matches!(
        natural,
        "beach" | "sand" | "bare_rock" | "scree" | "shingle"
    ) {
        return Some(classified("land", "polygon", natural));
    }
    if matches!(
        landuse,
        "farmland" | "farmyard" | "orchard" | "vineyard" | "allotments"
    ) {
        return Some(classified("land", "polygon", landuse));
    }
    None
}

fn decode_geometry(
    value: &Value,
    nodes: &BTreeMap<String, Point>,
    read: &mut usize,
) -> Result<Vec<Vertex>, Failure> {
    let references = value.get("nodes").array();
    let ids: Option<Vec<String>> = if references.is_empty() {
        None
    } else {
        Some(
            references
                .iter()
                .map(id)
                .collect::<Option<Vec<_>>>()
                .ok_or_else(|| {
                    Failure::new(
                        "OSM_INCOMPLETE_GEOMETRY",
                        "Way contains an invalid node reference",
                    )
                })?,
        )
    };
    if let Value::Array(geometry) = value.get("geometry") {
        *read = read.saturating_add(geometry.len());
        if *read > MAX_INPUT_VERTICES {
            return Err(Failure::limit(
                "OSM input exceeds 500000 decoded geometry vertices",
            ));
        }
        if geometry.len() >= 2 && ids.as_ref().map_or(true, |n| n.len() == geometry.len()) {
            if let Some(points) = geometry.iter().map(coordinate).collect::<Option<Vec<_>>>() {
                return Ok(points
                    .into_iter()
                    .enumerate()
                    .map(|(i, point)| Vertex {
                        point,
                        node: ids.as_ref().map(|n| n[i].clone()),
                    })
                    .collect());
            }
        }
    }
    if let Some(ids) = ids {
        if ids.len() >= 2 {
            if let Some(points) = ids
                .iter()
                .map(|id| nodes.get(id).copied())
                .collect::<Option<Vec<_>>>()
            {
                *read = read.saturating_add(points.len());
                if *read > MAX_INPUT_VERTICES {
                    return Err(Failure::limit(
                        "OSM input exceeds 500000 decoded geometry vertices",
                    ));
                }
                return Ok(points
                    .into_iter()
                    .zip(ids)
                    .map(|(point, id)| Vertex {
                        point,
                        node: Some(id),
                    })
                    .collect());
            }
        }
    }
    Err(Failure::new(
        "OSM_INCOMPLETE_GEOMETRY",
        "Geometry or node references are incomplete; no connecting segment was inferred",
    ))
}
fn point_cmp(a: Point, b: Point) -> Ordering {
    a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y))
}
fn points_cmp(a: &[Point], b: &[Point]) -> Ordering {
    a.iter()
        .zip(b)
        .map(|(a, b)| point_cmp(*a, *b))
        .find(|c| !c.is_eq())
        .unwrap_or_else(|| a.len().cmp(&b.len()))
}
fn key(p: Point) -> (u64, u64) {
    (p.x.to_bits(), p.y.to_bits())
}
fn same(a: &Vertex, b: &Vertex) -> bool {
    key(a.point) == key(b.point)
        && match (&a.node, &b.node) {
            (Some(a), Some(b)) => a == b,
            _ => true,
        }
}
fn closed(vertices: &[Vertex]) -> bool {
    vertices.len() > 2 && same(vertices.first().unwrap(), vertices.last().unwrap())
}
fn least_rotation(points: &[Point]) -> usize {
    let n = points.len();
    let mut a = 0;
    let mut b = 1;
    let mut k = 0;
    while a < n && b < n && k < n {
        match point_cmp(points[(a + k) % n], points[(b + k) % n]) {
            Ordering::Equal => k += 1,
            Ordering::Greater => {
                a += k + 1;
                if a == b {
                    a += 1;
                }
                k = 0;
            }
            Ordering::Less => {
                b += k + 1;
                if a == b {
                    b += 1;
                }
                k = 0;
            }
        }
    }
    a.min(b) % n
}
fn canonical_ring(ring: &[Point]) -> Vec<Point> {
    let points = &ring[..ring.len() - 1];
    let forward = least_rotation(points);
    let reversed: Vec<Point> = points.iter().rev().copied().collect();
    let reverse = least_rotation(&reversed);
    let a: Vec<Point> = (0..points.len())
        .map(|i| points[(forward + i) % points.len()])
        .collect();
    let b: Vec<Point> = (0..points.len())
        .map(|i| reversed[(reverse + i) % points.len()])
        .collect();
    let mut result = if points_cmp(&a, &b).is_gt() { b } else { a };
    result.push(result[0]);
    result
}
fn canonical_line(points: &[Point]) -> Vec<Point> {
    if points.len() >= 4 && key(points[0]) == key(*points.last().unwrap()) {
        return canonical_ring(points);
    }
    let reversed: Vec<Point> = points.iter().rev().copied().collect();
    if points_cmp(points, &reversed).is_gt() {
        reversed
    } else {
        points.to_vec()
    }
}
fn area(ring: &[Point]) -> f64 {
    let origin = ring[0];
    ring.windows(2)
        .map(|p| p[0].sub(origin).cross(p[1].sub(origin)))
        .sum::<f64>()
        / 2.
}
fn spend(work: &mut usize) -> Result<(), Failure> {
    if *work == 0 {
        Err(Failure::limit(
            "OSM topology validation exceeds 30000000 segment checks",
        ))
    } else {
        *work -= 1;
        Ok(())
    }
}
fn overlap(a: Point, b: Point, c: Point, d: Point) -> bool {
    if a.x.max(b.x) < c.x.min(d.x) - EPS
        || c.x.max(d.x) < a.x.min(b.x) - EPS
        || a.y.max(b.y) < c.y.min(d.y) - EPS
        || c.y.max(d.y) < a.y.min(b.y) - EPS
    {
        return false;
    }
    let ab = b.sub(a);
    let cd = d.sub(c);
    let ab_len = ab.len();
    let cd_len = cd.len();
    if ab_len <= EPS || cd_len <= EPS {
        return false;
    }
    let den = ab.cross(cd);
    if den.abs() > EPS * ab_len.max(cd_len) {
        let t = c.sub(a).cross(cd) / den;
        let u = c.sub(a).cross(ab) / den;
        return t > EPS / ab_len
            && t < 1. - EPS / ab_len
            && u > EPS / cd_len
            && u < 1. - EPS / cd_len;
    }
    if ab.cross(cd).abs() > EPS * ab.len().max(cd.len()).max(EPS)
        || c.sub(a).cross(ab).abs() > EPS * ab.len().max(EPS)
    {
        return false;
    }
    let direction = ab.mul(1. / ab_len);
    let c0 = c.sub(a).dot(direction);
    let c1 = d.sub(a).dot(direction);
    c0.max(c1).min(ab.len()) - c0.min(c1).max(0.) > EPS
}
fn validate_ring(ring: &[Point], work: &mut usize) -> Result<(), Failure> {
    if ring.len() < 4 || key(ring[0]) != key(*ring.last().unwrap()) {
        return Err(Failure::new(
            "OSM_UNCLOSED_RING",
            "Area is not a closed ring; no closing segment was invented",
        ));
    }
    if area(ring).abs() <= 1e-18 {
        return Err(Failure::new(
            "OSM_DEGENERATE_AREA",
            "Closed area has zero or unrepresentable area",
        ));
    }
    for i in 0..ring.len() - 1 {
        if ring[i].dist(ring[i + 1]) <= EPS {
            continue;
        }
        for j in i + 1..ring.len() - 1 {
            if j == i + 1 || (i == 0 && j == ring.len() - 2) {
                continue;
            }
            spend(work)?;
            if overlap(ring[i], ring[i + 1], ring[j], ring[j + 1]) {
                return Err(Failure::new(
                    "OSM_SELF_INTERSECTING_RING",
                    "Area boundary crosses or overlaps itself",
                ));
            }
        }
    }
    Ok(())
}
fn location(p: Point, ring: &[Point], work: &mut usize) -> Result<i8, Failure> {
    let mut inside = false;
    for edge in ring.windows(2) {
        spend(work)?;
        if point_segment(p, edge[0], edge[1]) <= EPS {
            return Ok(0);
        }
        if (edge[0].y > p.y) != (edge[1].y > p.y)
            && p.x
                < (edge[1].x - edge[0].x) * (p.y - edge[0].y) / (edge[1].y - edge[0].y) + edge[0].x
        {
            inside = !inside;
        }
    }
    Ok(if inside { 1 } else { -1 })
}
fn rings_cross(a: &[Point], b: &[Point], work: &mut usize) -> Result<bool, Failure> {
    for x in a.windows(2) {
        for y in b.windows(2) {
            spend(work)?;
            if overlap(x[0], x[1], y[0], y[1]) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
fn any_inside(points: &[Point], ring: &[Point], work: &mut usize) -> Result<bool, Failure> {
    for p in points {
        if location(*p, ring, work)? > 0 {
            return Ok(true);
        }
    }
    Ok(false)
}
fn wholly_inside(points: &[Point], ring: &[Point], work: &mut usize) -> Result<bool, Failure> {
    for point in &points[..points.len() - 1] {
        if location(*point, ring, work)? < 0 {
            return Ok(false);
        }
    }
    Ok(!rings_cross(points, ring, work)?)
}

fn assemble(mut fragments: Vec<Fragment>, work: &mut usize) -> Result<Vec<Vec<Point>>, Failure> {
    fragments.sort_by(|a, b| a.id.cmp(&b.id));
    let mut rings = vec![];
    let mut open = vec![];
    for fragment in fragments {
        if closed(&fragment.vertices) {
            let points: Vec<Point> = fragment.vertices.iter().map(|p| p.point).collect();
            validate_ring(&points, work)?;
            rings.push(canonical_ring(&points));
        } else {
            open.push(fragment);
        }
    }
    let mut endpoints: BTreeMap<(u64, u64), Vec<(usize, bool)>> = BTreeMap::new();
    for (i, f) in open.iter().enumerate() {
        endpoints
            .entry(key(f.vertices[0].point))
            .or_default()
            .push((i, true));
        endpoints
            .entry(key(f.vertices.last().unwrap().point))
            .or_default()
            .push((i, false));
    }
    for connections in endpoints.values() {
        if connections.len() != 2 {
            return Err(Failure::new(
                if connections.len() < 2 {
                    "OSM_UNCLOSED_RING"
                } else {
                    "OSM_AMBIGUOUS_RING"
                },
                "Member endpoints do not form unambiguous closed rings",
            ));
        }
        let vertex = |(i, start): (usize, bool)| {
            if start {
                &open[i].vertices[0]
            } else {
                open[i].vertices.last().unwrap()
            }
        };
        if !same(vertex(connections[0]), vertex(connections[1])) {
            return Err(Failure::new(
                "OSM_INCONSISTENT_REFERENCE",
                "Coincident endpoints refer to different OSM nodes",
            ));
        }
    }
    let mut unused: BTreeSet<usize> = (0..open.len()).collect();
    while let Some(seed) = unused.iter().next().copied() {
        unused.remove(&seed);
        let mut chain = open[seed].vertices.clone();
        while !closed(&chain) {
            let last = chain.last().unwrap();
            let candidate = endpoints[&key(last.point)]
                .iter()
                .find(|(i, _)| unused.contains(i))
                .copied()
                .ok_or_else(|| {
                    Failure::new(
                        "OSM_UNCLOSED_RING",
                        "Member chain does not close; no segment was invented",
                    )
                })?;
            let (next, starts) = candidate;
            unused.remove(&next);
            let vertices = &open[next].vertices;
            if starts {
                chain.extend(vertices.iter().skip(1).cloned());
            } else {
                chain.extend(vertices.iter().rev().skip(1).cloned());
            }
            if chain.len() > MAX_INPUT_VERTICES {
                return Err(Failure::limit("OSM assembled ring exceeds vertex limit"));
            }
        }
        let points: Vec<Point> = chain.iter().map(|p| p.point).collect();
        validate_ring(&points, work)?;
        rings.push(canonical_ring(&points));
    }
    rings.sort_by(|a, b| points_cmp(a, b));
    Ok(rings)
}

fn make_feature(id: String, name: &str, class: &Class, rings: &[Vec<Point>]) -> Value {
    let mut fields = vec![
        ("id", id.into()),
        ("kind", class.kind.into()),
        ("geometry", class.geometry.into()),
        ("classification", class.classification.clone().into()),
        (
            "coordinates",
            Value::Array(
                rings
                    .iter()
                    .map(|r| Value::Array(r.iter().map(|p| p.json()).collect()))
                    .collect(),
            ),
        ),
    ];
    if !name.is_empty() {
        fields.push(("name", name.into()));
    }
    Value::object(fields)
}
fn relation_features(
    relation: &Value,
    relation_id: &str,
    class: &Class,
    ways: &BTreeMap<String, Result<Vec<Vertex>, Failure>>,
    way_nodes: &BTreeMap<String, Option<Vec<String>>>,
    nodes: &BTreeMap<String, Point>,
    read: &mut usize,
    work: &mut usize,
) -> Result<Vec<Value>, Failure> {
    let members = relation.get("members").array();
    if members.is_empty() || members.len() > MAX_MEMBERS {
        return Err(if members.len() > MAX_MEMBERS {
            Failure::limit("OSM relation exceeds 10000 members")
        } else {
            Failure::new("OSM_INCOMPLETE_RELATION", "Area relation has no members")
        });
    }
    let mut ordered: Vec<&Value> = members.iter().collect();
    ordered.sort_by(|a, b| {
        a.get("role")
            .str()
            .cmp(b.get("role").str())
            .then(id(a.get("ref")).cmp(&id(b.get("ref"))))
    });
    let mut outer = vec![];
    let mut inner = vec![];
    let mut seen = BTreeSet::new();
    for member in ordered {
        let role = member.get("role").str();
        if !matches!(role, "outer" | "inner" | "") || member.get("type").str() != "way" {
            return Err(Failure::new(
                "OSM_UNSUPPORTED_MEMBER",
                "Area relation contains a non-way or unsupported member role",
            ));
        }
        let member_id = id(member.get("ref")).ok_or_else(|| {
            Failure::new(
                "OSM_INCOMPLETE_RELATION",
                "Area relation has a member without an OSM reference",
            )
        })?;
        if !seen.insert(member_id.clone()) {
            return Err(Failure::new(
                "OSM_DUPLICATE_MEMBER",
                "Area relation repeats a way member",
            ));
        }
        let mut vertices = if let Some(Ok(vertices)) = ways.get(&member_id) {
            vertices.clone()
        } else {
            decode_geometry(member, nodes, read).map_err(|failure| {
                if failure.code == "OSM_COMPLEXITY_LIMIT" {
                    failure
                } else {
                    Failure::new(
                        "OSM_INCOMPLETE_RELATION",
                        format!(
                            "Way {} is missing or incomplete; the area relation was not filled",
                            member_id
                        ),
                    )
                }
            })?
        };
        if let Some(references) = way_nodes.get(&member_id) {
            let references = references.as_ref().ok_or_else(|| {
                Failure::new(
                    "OSM_INCONSISTENT_REFERENCE",
                    "Member way contains an invalid node reference",
                )
            })?;
            if references.len() != vertices.len() {
                return Err(Failure::new(
                    "OSM_INCONSISTENT_REFERENCE",
                    "Member geometry does not match its node reference sequence",
                ));
            }
            for (vertex, reference) in vertices.iter_mut().zip(references) {
                vertex.node = Some(reference.clone());
            }
        }
        let fragment = Fragment {
            id: member_id,
            vertices,
        };
        if role == "inner" {
            inner.push(fragment);
        } else {
            outer.push(fragment);
        }
    }
    let outers = assemble(outer, work)?;
    let holes = assemble(inner, work)?;
    if outers.is_empty() {
        return Err(Failure::new(
            "OSM_INCOMPLETE_RELATION",
            "Area relation has no outer ring",
        ));
    }
    let mut groups: Vec<Vec<Vec<Point>>> = outers.iter().map(|r| vec![r.clone()]).collect();
    for hole in holes {
        let mut candidates = vec![];
        for (i, outer) in outers.iter().enumerate() {
            let mut contained = true;
            for p in &hole[..hole.len() - 1] {
                if location(*p, outer, work)? < 0 {
                    contained = false;
                    break;
                }
            }
            if contained && !rings_cross(&hole, outer, work)? {
                candidates.push(i);
            }
        }
        candidates.sort_by(|a, b| {
            area(&outers[*a])
                .abs()
                .total_cmp(&area(&outers[*b]).abs())
                .then(a.cmp(b))
        });
        let target = candidates.first().copied().ok_or_else(|| {
            Failure::new(
                "OSM_UNASSIGNED_HOLE",
                "An inner ring does not belong wholly inside an outer ring",
            )
        })?;
        for other in groups[target].iter().skip(1) {
            if rings_cross(&hole, other, work)?
                || any_inside(&hole, other, work)?
                || any_inside(other, &hole, work)?
            {
                return Err(Failure::new(
                    "OSM_OVERLAPPING_HOLES",
                    "Inner rings overlap or nest without a separate outer island",
                ));
            }
        }
        groups[target].push(hole);
    }
    for i in 0..groups.len() {
        for j in i + 1..groups.len() {
            if rings_cross(&groups[i][0], &groups[j][0], work)? {
                return Err(Failure::new(
                    "OSM_OVERLAPPING_OUTERS",
                    "Outer rings cross or overlap",
                ));
            }
            for (a, b) in [(i, j), (j, i)] {
                if location(groups[a][0][0], &groups[b][0], work)? > 0 {
                    let mut island = false;
                    for hole in groups[b].iter().skip(1) {
                        if wholly_inside(&groups[a][0], hole, work)? {
                            island = true;
                            break;
                        }
                    }
                    if !island {
                        return Err(Failure::new(
                            "OSM_OVERLAPPING_OUTERS",
                            "An outer ring lies inside another filled outer area",
                        ));
                    }
                }
            }
        }
    }
    let name = tag(relation.get("tags"), "name");
    Ok(groups
        .iter()
        .enumerate()
        .map(|(part, rings)| {
            make_feature(
                format!("osm-relation-{}-{}", relation_id, part),
                name,
                class,
                rings,
            )
        })
        .collect())
}

fn issue(target: String, failure: Failure) -> Value {
    Value::object(vec![
        ("code", failure.code.into()),
        ("severity", "warning".into()),
        ("targetId", target.into()),
        ("message", failure.message.into()),
    ])
}
fn append(features: &mut Vec<Value>, new: Value, vertices: &mut usize) -> Result<(), String> {
    *vertices += new
        .get("coordinates")
        .array()
        .iter()
        .map(|r| r.array().len())
        .sum::<usize>();
    if features.len() + 1 > MAX_FEATURES {
        return Err("OSM output exceeds 20000 features; use a smaller or explicitly filtered source extract".into());
    }
    if *vertices > MAX_OUTPUT_VERTICES {
        return Err(
            "OSM output exceeds 150000 vertices; no features were silently truncated".into(),
        );
    }
    features.push(new);
    Ok(())
}

pub fn import(input: &Value) -> Result<Value, String> {
    let elements = match input.get("elements") {
        Value::Array(values) => values,
        _ => return Err("Expected an Overpass JSON object with an elements array".into()),
    };
    if elements.len() > MAX_ELEMENTS {
        return Err("OSM input exceeds 50000 elements".into());
    }
    let mut objects: BTreeMap<(String, String), &Value> = BTreeMap::new();
    let mut duplicates = BTreeSet::new();
    let mut issues = vec![];
    for element in elements {
        let kind = element.get("type").str();
        if !matches!(kind, "node" | "way" | "relation") {
            continue;
        }
        let Some(osm_id) = id(element.get("id")) else {
            issues.push(issue(
                format!("osm-{}-unknown", kind),
                Failure::new(
                    "OSM_INVALID_ID",
                    "OSM object has no exact positive identifier",
                ),
            ));
            continue;
        };
        let key = (kind.to_string(), osm_id);
        if objects.insert(key.clone(), element).is_some() {
            duplicates.insert(key);
        }
    }
    for key in &duplicates {
        objects.remove(key);
        issues.push(issue(
            format!("osm-{}-{}", key.0, key.1),
            Failure::new(
                "OSM_DUPLICATE_OBJECT",
                "Duplicate OSM objects were omitted rather than choosing an arbitrary revision",
            ),
        ));
    }
    let nodes: BTreeMap<String, Point> = objects
        .iter()
        .filter_map(|((kind, id), value)| {
            (kind == "node")
                .then(|| coordinate(value).map(|p| (id.clone(), p)))
                .flatten()
        })
        .collect();
    let mut read = nodes.len();
    let mut ways = BTreeMap::new();
    let mut way_nodes = BTreeMap::new();
    for ((kind, id), value) in &objects {
        if kind == "way" {
            if !value.get("nodes").array().is_empty() {
                way_nodes.insert(
                    id.clone(),
                    value
                        .get("nodes")
                        .array()
                        .iter()
                        .map(self::id)
                        .collect::<Option<Vec<_>>>(),
                );
            }
            let result = decode_geometry(value, &nodes, &mut read);
            if let Err(e) = &result {
                if e.code == "OSM_COMPLEXITY_LIMIT" {
                    return Err(e.message.clone());
                }
            }
            ways.insert(id.clone(), result);
        }
    }
    let mut features = vec![];
    let mut output_vertices = 0;
    let mut work = MAX_TOPOLOGY_WORK;
    let mut suppressed: BTreeMap<String, BTreeSet<&'static str>> = BTreeMap::new();
    let mut omitted: usize = 0;
    let mut relations: usize = 0;
    let mut ignored: usize = 0;
    let mut suppressed_ways: usize = 0;
    for ((kind, osm_id), value) in &objects {
        if kind != "relation" {
            continue;
        }
        let relation_type = tag(value.get("tags"), "type");
        if !matches!(relation_type, "multipolygon" | "boundary") {
            ignored += 1;
            continue;
        }
        let Some(class) = classify(value.get("tags"), true) else {
            ignored += 1;
            continue;
        };
        if class.geometry != "polygon" {
            ignored += 1;
            continue;
        }
        relations += 1;
        let result = relation_features(
            value, osm_id, &class, &ways, &way_nodes, &nodes, &mut read, &mut work,
        );
        let success = result.is_ok();
        for member in value.get("members").array() {
            if member.get("type").str() == "way"
                && (success || matches!(member.get("role").str(), "outer" | ""))
            {
                if let Some(reference) = id(member.get("ref")) {
                    suppressed.entry(reference).or_default().insert(class.kind);
                }
            }
        }
        match result {
            Ok(values) => {
                for feature in values {
                    append(&mut features, feature, &mut output_vertices)?;
                }
            }
            Err(failure) => {
                if failure.code == "OSM_COMPLEXITY_LIMIT" {
                    return Err(failure.message);
                }
                omitted += 1;
                issues.push(issue(format!("osm-relation-{}", osm_id), failure));
            }
        }
    }
    for ((kind, osm_id), value) in &objects {
        if kind != "way" {
            continue;
        }
        let Some(class) = classify(value.get("tags"), false) else {
            ignored += 1;
            continue;
        };
        if class.geometry == "polygon"
            && suppressed
                .get(osm_id)
                .is_some_and(|kinds| kinds.contains(class.kind))
        {
            suppressed_ways += 1;
            continue;
        }
        let result = ways[osm_id].clone().and_then(|vertices| {
            let points: Vec<Point> = vertices.iter().map(|v| v.point).collect();
            let geometry = if class.geometry == "polygon" {
                if !closed(&vertices) {
                    return Err(Failure::new(
                        "OSM_UNCLOSED_RING",
                        "Area way is not closed; no closing segment was invented",
                    ));
                }
                validate_ring(&points, &mut work)?;
                canonical_ring(&points)
            } else {
                if points.iter().all(|p| key(*p) == key(points[0])) {
                    return Err(Failure::new(
                        "OSM_DEGENERATE_LINE",
                        "Way geometry contains only one distinct position",
                    ));
                }
                canonical_line(&points)
            };
            Ok(make_feature(
                format!("osm-way-{}", osm_id),
                tag(value.get("tags"), "name"),
                &class,
                &[geometry],
            ))
        });
        match result {
            Ok(feature) => append(&mut features, feature, &mut output_vertices)?,
            Err(failure) => {
                if failure.code == "OSM_COMPLEXITY_LIMIT" {
                    return Err(failure.message);
                }
                omitted += 1;
                issues.push(issue(format!("osm-way-{}", osm_id), failure));
            }
        }
    }
    if issues.len() > 5000 {
        return Err("OSM import exceeds 5000 diagnostics; source validation is required".into());
    }
    features.sort_by(|a, b| a.get("id").str().cmp(b.get("id").str()));
    issues.sort_by(|a, b| {
        a.get("targetId")
            .str()
            .cmp(b.get("targetId").str())
            .then(a.get("code").str().cmp(b.get("code").str()))
            .then(a.get("message").str().cmp(b.get("message").str()))
    });
    let mut kinds: BTreeMap<String, Value> = BTreeMap::new();
    for feature in &features {
        let kind = feature.get("kind").str().to_string();
        let count = kinds.get(&kind).map_or(0., |v| v.num(0.)) + 1.;
        kinds.insert(kind, count.into());
    }
    Ok(Value::object(vec![
        (
            "statistics",
            Value::object(vec![
                ("inputElements", elements.len().into()),
                ("ways", ways.len().into()),
                ("areaRelations", relations.into()),
                ("features", features.len().into()),
                ("vertices", output_vertices.into()),
                ("decodedVertices", read.into()),
                ("omittedObjects", omitted.into()),
                ("ignoredObjects", ignored.into()),
                ("suppressedMemberWays", suppressed_ways.into()),
                ("topologyChecks", (MAX_TOPOLOGY_WORK - work).into()),
                ("kinds", Value::Object(kinds)),
            ]),
        ),
        ("features", Value::Array(features)),
        ("issues", Value::Array(issues)),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json::parse;
    fn run(source: &str) -> Value {
        import(&parse(source).unwrap()).unwrap()
    }
    #[test]
    fn imports_real_tag_classes_without_turning_nodes_or_route_relations_into_services() {
        let result = run(
            r#"{"elements":[{"type":"node","id":1,"lat":51,"lon":0,"tags":{"highway":"bus_stop"}},{"type":"way","id":2,"tags":{"highway":"primary","name":"Real Road"},"geometry":[{"lon":0,"lat":51},{"lon":1,"lat":51}]},{"type":"way","id":3,"tags":{"railway":"subway"},"geometry":[{"lon":0,"lat":51},{"lon":1,"lat":52}]},{"type":"way","id":4,"tags":{"building":"yes"},"geometry":[{"lon":0,"lat":51},{"lon":1,"lat":51},{"lon":1,"lat":52},{"lon":0,"lat":51}]},{"type":"relation","id":5,"tags":{"type":"route","route":"subway","name":"Not an operator service source"},"members":[]}]}"#,
        );
        assert_eq!(result.get("features").array().len(), 3);
        assert_eq!(
            result.get("features").array()[0]
                .get("classification")
                .str(),
            "primary"
        );
        assert_eq!(
            result.get("statistics").get("kinds").get("rail").num(0.),
            1.
        );
    }
    #[test]
    fn joins_reversed_shuffled_fragments_and_assigns_inner_ring() {
        let result = run(
            r#"{"elements":[{"type":"relation","id":20,"tags":{"type":"multipolygon","natural":"water","name":"Actual Lake"},"members":[{"type":"way","ref":3,"role":"inner","geometry":[{"lon":1,"lat":1},{"lon":2,"lat":1},{"lon":2,"lat":2},{"lon":1,"lat":2},{"lon":1,"lat":1}]},{"type":"way","ref":2,"role":"outer","geometry":[{"lon":0,"lat":0},{"lon":0,"lat":3},{"lon":3,"lat":3}]},{"type":"way","ref":1,"role":"outer","geometry":[{"lon":3,"lat":3},{"lon":3,"lat":0},{"lon":0,"lat":0}]}]}]}"#,
        );
        assert!(result.get("issues").array().is_empty());
        let features = result.get("features").array();
        assert_eq!(features.len(), 1);
        assert_eq!(features[0].get("coordinates").array().len(), 2);
    }
    #[test]
    fn refuses_missing_members_and_does_not_close_open_area_ways() {
        let result = run(
            r#"{"elements":[{"type":"way","id":1,"tags":{"natural":"water"},"geometry":[{"lon":0,"lat":0},{"lon":1,"lat":0},{"lon":1,"lat":1}]},{"type":"relation","id":2,"tags":{"type":"multipolygon","natural":"water"},"members":[{"type":"way","ref":99,"role":"outer"}]}]}"#,
        );
        assert!(result.get("features").array().is_empty());
        assert_eq!(result.get("issues").array().len(), 2);
    }
    #[test]
    fn geometry_order_and_way_direction_do_not_change_output() {
        let mut input=parse(r#"{"elements":[{"type":"way","id":1,"tags":{"leisure":"park"},"geometry":[{"lon":0,"lat":0},{"lon":3,"lat":0},{"lon":3,"lat":3},{"lon":0,"lat":0}]},{"type":"way","id":2,"tags":{"highway":"residential"},"geometry":[{"lon":0,"lat":1},{"lon":3,"lat":1}]}]}"#).unwrap();
        let before = import(&input).unwrap().get("features").stringify();
        if let Value::Object(root) = &mut input {
            if let Value::Array(elements) = root.get_mut("elements").unwrap() {
                elements.reverse();
                for element in elements {
                    if let Value::Object(e) = element {
                        if let Value::Array(g) = e.get_mut("geometry").unwrap() {
                            g.reverse();
                        }
                    }
                }
            }
        }
        assert_eq!(before, import(&input).unwrap().get("features").stringify());
    }
    #[test]
    fn preserves_multiple_outer_parts_and_owns_holes_by_containment() {
        let result = run(
            r#"{"elements":[{"type":"relation","id":1,"tags":{"type":"multipolygon","leisure":"park"},"members":[{"type":"way","ref":1,"role":"outer","geometry":[{"lon":0,"lat":0},{"lon":4,"lat":0},{"lon":4,"lat":4},{"lon":0,"lat":4},{"lon":0,"lat":0}]},{"type":"way","ref":2,"role":"outer","geometry":[{"lon":10,"lat":0},{"lon":14,"lat":0},{"lon":14,"lat":4},{"lon":10,"lat":4},{"lon":10,"lat":0}]},{"type":"way","ref":3,"role":"inner","geometry":[{"lon":11,"lat":1},{"lon":12,"lat":1},{"lon":12,"lat":2},{"lon":11,"lat":2},{"lon":11,"lat":1}]}]}]}"#,
        );
        assert_eq!(result.get("features").array().len(), 2);
        assert_eq!(
            result.get("features").array()[1]
                .get("coordinates")
                .array()
                .len(),
            2
        );
    }
    #[test]
    fn resolves_way_node_references_and_suppresses_duplicate_member_areas() {
        let result = run(
            r#"{"elements":[{"type":"node","id":1,"lon":0,"lat":0},{"type":"node","id":2,"lon":2,"lat":0},{"type":"node","id":3,"lon":2,"lat":2},{"type":"way","id":4,"tags":{"natural":"water"},"nodes":[1,2,3,1]},{"type":"relation","id":5,"tags":{"type":"multipolygon","natural":"water"},"members":[{"type":"way","ref":4,"role":"outer"}]}]}"#,
        );
        assert_eq!(result.get("features").array().len(), 1);
        assert_eq!(
            result.get("statistics").get("suppressedMemberWays").num(0.),
            1.
        );
    }
    #[test]
    fn rejects_degenerate_self_crossing_and_unassigned_hole_areas() {
        let result = run(
            r#"{"elements":[{"type":"way","id":1,"tags":{"building":"yes"},"geometry":[{"lon":0,"lat":0},{"lon":1,"lat":1},{"lon":2,"lat":2},{"lon":0,"lat":0}]},{"type":"relation","id":2,"tags":{"type":"multipolygon","natural":"water"},"members":[{"type":"way","ref":3,"role":"outer","geometry":[{"lon":0,"lat":0},{"lon":2,"lat":0},{"lon":2,"lat":2},{"lon":0,"lat":2},{"lon":0,"lat":0}]},{"type":"way","ref":4,"role":"inner","geometry":[{"lon":3,"lat":3},{"lon":4,"lat":3},{"lon":4,"lat":4},{"lon":3,"lat":3}]}]}]}"#,
        );
        assert!(result.get("features").array().is_empty());
        assert_eq!(result.get("issues").array().len(), 2);
    }
    #[test]
    fn clipped_null_geometry_is_omitted_without_joining_missing_positions() {
        let result = run(
            r#"{"elements":[{"type":"way","id":1,"tags":{"highway":"primary"},"geometry":[{"lon":0,"lat":0},null,{"lon":1,"lat":1}]}]}"#,
        );
        assert!(result.get("features").array().is_empty());
        assert_eq!(
            result.get("issues").array()[0].get("code").str(),
            "OSM_INCOMPLETE_GEOMETRY"
        );
    }
    #[test]
    fn relation_member_order_and_direction_leave_canonical_features_unchanged() {
        let mut input=parse(r#"{"elements":[{"type":"relation","id":20,"tags":{"type":"multipolygon","natural":"water"},"members":[{"type":"way","ref":3,"role":"inner","geometry":[{"lon":1,"lat":1},{"lon":2,"lat":1},{"lon":2,"lat":2},{"lon":1,"lat":2},{"lon":1,"lat":1}]},{"type":"way","ref":2,"role":"outer","geometry":[{"lon":0,"lat":0},{"lon":0,"lat":3},{"lon":3,"lat":3}]},{"type":"way","ref":1,"role":"outer","geometry":[{"lon":3,"lat":3},{"lon":3,"lat":0},{"lon":0,"lat":0}]}]}]}"#).unwrap();
        let before = import(&input).unwrap();
        if let Value::Object(root) = &mut input {
            if let Value::Array(elements) = root.get_mut("elements").unwrap() {
                for element in elements {
                    if let Value::Object(object) = element {
                        if let Value::Array(members) = object.get_mut("members").unwrap() {
                            members.reverse();
                            for member in members {
                                if let Value::Object(m) = member {
                                    if let Value::Array(geometry) = m.get_mut("geometry").unwrap() {
                                        geometry.reverse();
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        let after = import(&input).unwrap();
        assert_eq!(
            before.get("features").stringify(),
            after.get("features").stringify()
        );
        assert_eq!(
            before.get("issues").stringify(),
            after.get("issues").stringify()
        );
    }
    #[test]
    fn coincident_coordinates_never_close_distinct_osm_node_references() {
        let result = run(
            r#"{"elements":[{"type":"way","id":1,"nodes":[11,12,13,14]},{"type":"relation","id":2,"tags":{"type":"multipolygon","natural":"water"},"members":[{"type":"way","ref":1,"role":"outer","geometry":[{"lon":0,"lat":0},{"lon":1,"lat":0},{"lon":1,"lat":1},{"lon":0,"lat":0}]}]}]}"#,
        );
        assert!(result.get("features").array().is_empty());
        assert_eq!(
            result.get("issues").array()[0].get("code").str(),
            "OSM_INCONSISTENT_REFERENCE"
        );
    }
    #[test]
    fn crossing_tests_work_at_real_osm_coordinate_scale() {
        let result = run(
            r#"{"elements":[{"type":"way","id":1,"tags":{"building":"yes"},"geometry":[{"lon":0,"lat":0},{"lon":0.00004,"lat":0.00004},{"lon":0,"lat":0.00005},{"lon":0.00005,"lat":0},{"lon":0,"lat":0}]}]}"#,
        );
        assert!(result.get("features").array().is_empty());
        assert_eq!(
            result.get("issues").array()[0].get("code").str(),
            "OSM_SELF_INTERSECTING_RING"
        );
    }
    #[test]
    fn input_limits_fail_explicitly_instead_of_truncating_features() {
        let input = Value::object(vec![(
            "elements",
            Value::Array(vec![Value::Null; MAX_ELEMENTS + 1]),
        )]);
        assert!(import(&input).unwrap_err().contains("50000"));
    }
    #[test]
    fn outer_island_must_remain_wholly_inside_its_enclosing_hole() {
        let result = run(
            r#"{"elements":[{"type":"relation","id":1,"tags":{"type":"multipolygon","natural":"water"},"members":[{"type":"way","ref":1,"role":"outer","geometry":[{"lon":0,"lat":0},{"lon":10,"lat":0},{"lon":10,"lat":10},{"lon":0,"lat":10},{"lon":0,"lat":0}]},{"type":"way","ref":2,"role":"inner","geometry":[{"lon":2,"lat":2},{"lon":8,"lat":2},{"lon":8,"lat":8},{"lon":2,"lat":8},{"lon":2,"lat":2}]},{"type":"way","ref":3,"role":"outer","geometry":[{"lon":3,"lat":3},{"lon":9,"lat":3},{"lon":9,"lat":9},{"lon":3,"lat":9},{"lon":3,"lat":3}]}]}]}"#,
        );
        assert!(result.get("features").array().is_empty());
        assert_eq!(
            result.get("issues").array()[0].get("code").str(),
            "OSM_OVERLAPPING_OUTERS"
        );
    }
    #[test]
    fn valid_outer_island_inside_a_hole_is_preserved_as_a_separate_part() {
        let result = run(
            r#"{"elements":[{"type":"relation","id":1,"tags":{"type":"multipolygon","natural":"water"},"members":[{"type":"way","ref":1,"role":"outer","geometry":[{"lon":0,"lat":0},{"lon":10,"lat":0},{"lon":10,"lat":10},{"lon":0,"lat":10},{"lon":0,"lat":0}]},{"type":"way","ref":2,"role":"inner","geometry":[{"lon":2,"lat":2},{"lon":8,"lat":2},{"lon":8,"lat":8},{"lon":2,"lat":8},{"lon":2,"lat":2}]},{"type":"way","ref":3,"role":"outer","geometry":[{"lon":3,"lat":3},{"lon":7,"lat":3},{"lon":7,"lat":7},{"lon":3,"lat":7},{"lon":3,"lat":3}]}]}]}"#,
        );
        assert!(result.get("issues").array().is_empty());
        assert_eq!(result.get("features").array().len(), 2);
        assert_eq!(
            result
                .get("features")
                .array()
                .iter()
                .map(|f| f.get("coordinates").array().len() - 1)
                .sum::<usize>(),
            1
        );
    }
    #[test]
    #[ignore = "requires an explicitly supplied external Overpass extract"]
    fn external_extract_smoke() {
        let path = std::env::var("OTI_OSM_SMOKE_PATH")
            .expect("Set OTI_OSM_SMOKE_PATH to the external extract");
        let source = std::fs::read_to_string(path).unwrap();
        let started = std::time::Instant::now();
        let result = import(&parse(&source).unwrap()).unwrap();
        assert!(!result.get("features").array().is_empty());
        println!(
            "statistics={} elapsedMs={} issues={}",
            result.get("statistics").stringify(),
            started.elapsed().as_millis(),
            result.get("issues").stringify()
        );
    }
}
