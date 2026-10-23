// SPDX-License-Identifier: Apache-2.0
use crate::geometry::Point;
use crate::json::Value;
use std::collections::{BTreeMap, BTreeSet};

const MAX_SOURCE_OBJECTS: usize = 50000;
const MAX_SOURCE_NODES: usize = 50000;
const MAX_RELATION_MEMBERS: usize = 10000;
const MAX_NODE_REFERENCES: usize = 100000;

fn add_references(total: &mut usize, count: usize, scope: &str) -> Result<(), String> {
    *total = total
        .checked_add(count)
        .filter(|n| *n <= MAX_NODE_REFERENCES)
        .ok_or_else(|| format!("OSM route exceeds 100000 {scope} node references"))?;
    Ok(())
}

fn id(value: &Value) -> Result<i64, String> {
    let n = value.num(f64::NAN);
    if !n.is_finite() || n.fract() != 0. || n <= 0. || n > 9007199254740991. {
        return Err("Invalid OSM object identifier".into());
    }
    Ok(n as i64)
}

pub fn build(input: &Value) -> Result<Value, String> {
    let elements = input.get("data").get("elements").array();
    if elements.len() > MAX_SOURCE_OBJECTS {
        return Err("OSM route exceeds 50000 source objects".into());
    }
    let mut source_nodes = 0;
    let mut source_references = 0;
    for element in elements {
        match element.get("type").str() {
            "node" => source_nodes += 1,
            "way" => add_references(
                &mut source_references,
                element.get("nodes").array().len(),
                "source",
            )?,
            _ => {}
        }
    }
    if source_nodes > MAX_SOURCE_NODES {
        return Err("OSM route exceeds 50000 source nodes".into());
    }
    let relation_id = id(input.get("relationId"))?;
    let mut nodes = BTreeMap::new();
    let mut stop_position_nodes = BTreeSet::new();
    let mut ways = BTreeMap::new();
    let mut relation = None;
    for element in elements {
        let key = id(element.get("id"))?;
        match element.get("type").str() {
            "node" => {
                let p = Point::new(
                    element.get("lon").num(f64::NAN),
                    element.get("lat").num(f64::NAN),
                );
                if !p.x.is_finite() || !p.y.is_finite() || p.x.abs() > 180. || p.y.abs() > 85.051129
                {
                    return Err("Invalid source node coordinates".into());
                }
                if nodes.insert(key, p).is_some() {
                    return Err("Duplicate OSM route node".into());
                }
                if element.get("tags").get("public_transport").str() == "stop_position" {
                    stop_position_nodes.insert(key);
                }
            }
            "way" => {
                if ways.insert(key, element).is_some() {
                    return Err("Duplicate OSM route way".into());
                }
            }
            "relation" if key == relation_id => {
                if relation.replace(element).is_some() {
                    return Err("Duplicate OSM route relation".into());
                }
            }
            _ => {}
        }
    }
    let relation = relation.ok_or("The selected OSM relation is missing")?;
    if relation.get("tags").get("type").str() != "route" {
        return Err("Expected an explicit OSM route relation".into());
    }
    let members = relation.get("members").array();
    if members.len() > MAX_RELATION_MEMBERS {
        return Err("OSM route exceeds 10000 relation members".into());
    }
    let selected = input.get("selectedStops").array();
    if selected.len() < 2 || selected.len() > 5000 {
        return Err("Expected 2..5000 explicit source stop positions".into());
    }
    let mut member_ways = vec![];
    let mut member_stops = BTreeSet::new();
    let mut route_references = 0;
    for member in members {
        let role = member.get("role").str();
        if ["platform", "platform_entry_only", "platform_exit_only"].contains(&role) {
            continue;
        }
        if member.get("type").str() == "node"
            && ["stop", "stop_entry_only", "stop_exit_only"].contains(&role)
        {
            member_stops.insert(id(member.get("ref"))?);
        }
        if member.get("type").str() != "way" {
            continue;
        }
        if !["", "forward", "backward"].contains(&role) {
            return Err(format!("Unsupported OSM route way role: {role}"));
        }
        let key = id(member.get("ref"))?;
        let way = ways.get(&key).ok_or("OSM route is missing a member way")?;
        if way.get("tags").get("public_transport").str() == "platform"
            || way.get("tags").get("railway").str() == "platform"
        {
            continue;
        }
        let count = way.get("nodes").array().len();
        if count < 2 {
            return Err("OSM route contains a degenerate member way".into());
        }
        add_references(&mut route_references, count, "member-way")?;
        member_ways.push((key, *way, role));
    }
    if member_ways.is_empty() {
        return Err("OSM relation contains no route ways".into());
    }
    let mut pieces = vec![];
    let mut member_ids = vec![];
    for (key, way, role) in member_ways {
        let mut sequence = way
            .get("nodes")
            .array()
            .iter()
            .map(id)
            .collect::<Result<Vec<_>, _>>()?;
        if role == "backward" {
            sequence.reverse();
        }
        pieces.push((sequence, role.to_string()));
        member_ids.push(key);
    }
    let mut chain = pieces[0].0.clone();
    if pieces[0].1.is_empty() && pieces.len() > 1 {
        let next = &pieces[1].0;
        let last_connects = next.first() == chain.last() || next.last() == chain.last();
        let first_connects = next.first() == chain.first() || next.last() == chain.first();
        if !last_connects && first_connects {
            chain.reverse();
        }
    }
    for (piece, role) in pieces.iter().skip(1) {
        let mut piece = piece.clone();
        if chain.last() != piece.first() {
            if role.is_empty() && chain.last() == piece.last() {
                piece.reverse();
            } else {
                return Err(
                    "OSM route members are disconnected or contradict their direction roles".into(),
                );
            }
        }
        chain.extend(piece.into_iter().skip(1));
        if chain.len() > 100000 {
            return Err("OSM route exceeds 100000 vertices".into());
        }
    }
    let mut node_indices = BTreeMap::new();
    for (index, node) in chain.iter().enumerate() {
        if !nodes.contains_key(node) {
            return Err("OSM route is missing node coordinates".into());
        }
        node_indices
            .entry(*node)
            .and_modify(|position| *position = None)
            .or_insert(Some(index));
    }
    let mut indices = vec![];
    let mut positions = BTreeMap::new();
    let mut seen_nodes = BTreeMap::new();
    for stop in selected {
        let stop_id = stop.get("id").str();
        if stop_id.is_empty() || stop_id.len() > 256 {
            return Err("Invalid selected stop identifier".into());
        }
        let node_id = id(stop.get("nodeId"))?;
        if !member_stops.contains(&node_id) || !stop_position_nodes.contains(&node_id) {
            return Err(
                "Selected stops must be explicit stop_position node members with supported stop roles in the selected OSM relation".into(),
            );
        }
        let index = node_indices
            .get(&node_id)
            .copied()
            .flatten()
            .ok_or("A selected stop must identify one unique node on the route chain")?;
        if seen_nodes.insert(node_id, true).is_some()
            || positions
                .insert(stop_id.to_string(), nodes[&node_id].json())
                .is_some()
        {
            return Err("Duplicate selected stop or source node".into());
        }
        indices.push(index);
    }
    let ascending = indices.windows(2).all(|p| p[0] < p[1]);
    let descending = indices.windows(2).all(|p| p[0] > p[1]);
    if !ascending && !descending {
        return Err("Selected stops contradict the authoritative OSM route order".into());
    }
    let start = indices[0].min(*indices.last().unwrap());
    let end = indices[0].max(*indices.last().unwrap());
    let margin = input.get("continuationVertices").num(0.);
    if !margin.is_finite() || margin.fract() != 0. || !(0.0..=64.0).contains(&margin) {
        return Err("continuationVertices must be an integer from 0 to 64".into());
    }
    let from = start.saturating_sub(margin as usize);
    let to = (end + margin as usize).min(chain.len() - 1);
    let mut excerpt = chain[from..=to].to_vec();
    if descending {
        excerpt.reverse();
    }
    Ok(Value::object(vec![
        (
            "coordinates",
            Value::Array(excerpt.iter().map(|n| nodes[n].json()).collect()),
        ),
        (
            "sourceNodeIds",
            Value::Array(excerpt.iter().map(|n| (*n as f64).into()).collect()),
        ),
        ("stopPositions", Value::Object(positions)),
        ("relationId", (relation_id as f64).into()),
        ("relationVersion", relation.get("version").clone()),
        ("relationTimestamp", relation.get("timestamp").clone()),
        (
            "memberWayIds",
            Value::Array(member_ids.iter().map(|n| (*n as f64).into()).collect()),
        ),
        ("sourceVertices", chain.len().into()),
        ("excerptVertices", excerpt.len().into()),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Value {
        crate::json::parse(
            r#"{
              "relationId":20,"selectedStops":[{"id":"a","nodeId":2},{"id":"b","nodeId":3}],
              "data":{"elements":[
                {"type":"node","id":1,"lon":-0.15,"lat":51.5,"tags":{"public_transport":"stop_position"}},
                {"type":"node","id":2,"lon":-0.147,"lat":51.501,"tags":{"public_transport":"stop_position"}},
                {"type":"node","id":3,"lon":-0.144,"lat":51.499,"tags":{"public_transport":"stop_position"}},
                {"type":"node","id":4,"lon":-0.14,"lat":51.5,"tags":{"public_transport":"stop_position"}},
                {"type":"way","id":10,"nodes":[2,1]},
                {"type":"way","id":11,"nodes":[2,3,4]},
                {"type":"way","id":12,"tags":{"public_transport":"platform"},"nodes":[999,998]},
                {"type":"relation","id":20,"tags":{"type":"route"},"members":[
                  {"type":"node","ref":2,"role":"stop"},
                  {"type":"node","ref":3,"role":"stop"},
                  {"type":"way","ref":12,"role":"platform"},
                  {"type":"relation","ref":13,"role":"platform"},
                  {"type":"way","ref":10,"role":""},
                  {"type":"way","ref":11,"role":""}
                ]}
              ]}}
            "#,
        )
        .unwrap()
    }

    fn set(value: &mut Value, key: &str, replacement: Value) {
        if let Value::Object(object) = value {
            object.insert(key.into(), replacement);
        } else {
            panic!("Expected a fixture object");
        }
    }

    fn elements(input: &mut Value) -> &mut Vec<Value> {
        if let Value::Object(input) = input {
            if let Value::Object(data) = input.get_mut("data").unwrap() {
                if let Value::Array(elements) = data.get_mut("elements").unwrap() {
                    return elements;
                }
            }
        }
        panic!("Expected fixture elements");
    }

    fn element<'a>(input: &'a mut Value, kind: &str, key: i64) -> &'a mut Value {
        elements(input)
            .iter_mut()
            .find(|value| value.get("type").str() == kind && id(value.get("id")) == Ok(key))
            .unwrap()
    }

    fn members(input: &mut Value) -> &mut Vec<Value> {
        if let Value::Object(relation) = element(input, "relation", 20) {
            if let Value::Array(members) = relation.get_mut("members").unwrap() {
                return members;
            }
        }
        panic!("Expected fixture relation members");
    }

    #[test]
    fn exact_route_excerpt_retains_bends_and_direction() {
        let mut input = fixture();
        set(&mut input, "continuationVertices", 1.0.into());
        let result = build(&input).unwrap();
        assert_eq!(result.get("sourceNodeIds").stringify(), "[1,2,3,4]");
        assert_eq!(result.get("memberWayIds").stringify(), "[10,11]");
        assert_eq!(
            result.get("stopPositions").get("a").stringify(),
            "[-0.147,51.501]"
        );
        if let Value::Object(input) = &mut input {
            if let Value::Array(stops) = input.get_mut("selectedStops").unwrap() {
                stops.reverse();
            }
        }
        set(&mut input, "continuationVertices", 0.0.into());
        assert_eq!(
            build(&input).unwrap().get("sourceNodeIds").stringify(),
            "[3,2]"
        );
    }

    #[test]
    fn selected_track_nodes_require_explicit_stop_membership() {
        let mut input = fixture();
        members(&mut input).remove(0);
        assert!(build(&input)
            .unwrap_err()
            .contains("explicit stop_position"));
    }

    #[test]
    fn selected_stop_members_require_the_stop_position_tag() {
        let mut input = fixture();
        set(element(&mut input, "node", 2), "tags", Value::Null);
        assert!(build(&input)
            .unwrap_err()
            .contains("explicit stop_position"));
    }

    #[test]
    fn selected_nodes_require_supported_stop_roles() {
        for role in [
            "",
            "via",
            "platform",
            "platform_entry_only",
            "platform_exit_only",
        ] {
            let mut input = fixture();
            set(&mut members(&mut input)[0], "role", role.into());
            assert!(build(&input).unwrap_err().contains("supported stop roles"));
        }
        let mut input = fixture();
        set(
            &mut members(&mut input)[0],
            "role",
            "stop_entry_only".into(),
        );
        set(&mut members(&mut input)[1], "role", "stop_exit_only".into());
        assert!(build(&input).is_ok());
    }

    #[test]
    fn unknown_way_roles_fail_even_for_tagged_platforms() {
        for index in [2, 4] {
            let mut input = fixture();
            set(
                &mut members(&mut input)[index],
                "role",
                "unrecognised".into(),
            );
            assert!(build(&input)
                .unwrap_err()
                .contains("Unsupported OSM route way role"));
        }
    }

    #[test]
    fn all_explicit_platform_roles_and_platform_tags_remain_excluded() {
        for role in ["platform", "platform_entry_only", "platform_exit_only", ""] {
            let mut input = fixture();
            set(&mut members(&mut input)[2], "role", role.into());
            for relation_role in ["platform", "platform_entry_only", "platform_exit_only"] {
                set(&mut members(&mut input)[3], "role", relation_role.into());
                assert_eq!(
                    build(&input).unwrap().get("memberWayIds").stringify(),
                    "[10,11]"
                );
            }
        }
    }

    #[test]
    fn repeated_source_stop_occurrences_remain_ambiguous() {
        let mut input = fixture();
        set(
            element(&mut input, "way", 11),
            "nodes",
            Value::Array(vec![2.0.into(), 3.0.into(), 2.0.into(), 4.0.into()]),
        );
        assert!(build(&input).unwrap_err().contains("one unique node"));
    }

    #[test]
    fn explicit_way_direction_roles_are_preserved() {
        let mut input = fixture();
        set(&mut members(&mut input)[4], "role", "backward".into());
        set(&mut members(&mut input)[5], "role", "forward".into());
        assert!(build(&input).is_ok());
        set(&mut members(&mut input)[4], "role", "forward".into());
        assert!(build(&input).unwrap_err().contains("direction roles"));
    }

    #[test]
    fn source_reference_budget_includes_the_first_way_and_excluded_platforms() {
        for key in [10, 12] {
            let mut input = fixture();
            set(
                element(&mut input, "way", key),
                "nodes",
                Value::Array(vec![1.0.into(); MAX_NODE_REFERENCES + 1]),
            );
            assert!(build(&input)
                .unwrap_err()
                .contains("100000 source node references"));
        }
    }

    #[test]
    fn repeated_member_reference_budget_is_checked_before_assembly() {
        let mut input = fixture();
        set(
            element(&mut input, "way", 10),
            "nodes",
            Value::Array(vec![1.0.into(); 1001]),
        );
        let repeated = members(&mut input)[4].clone();
        *members(&mut input) = vec![repeated; 100];
        assert!(build(&input)
            .unwrap_err()
            .contains("100000 member-way node references"));
    }

    #[test]
    fn relation_member_budget_counts_excluded_platforms() {
        let mut input = fixture();
        let platform = members(&mut input)[3].clone();
        *members(&mut input) = vec![platform; MAX_RELATION_MEMBERS + 1];
        assert!(build(&input)
            .unwrap_err()
            .contains("10000 relation members"));
    }
}
