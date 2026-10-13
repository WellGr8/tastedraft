use std::sync::OnceLock;

use regex::Regex;

use crate::insights::score_insight_measurements;
use crate::types::{
    BriefV2, DimensionInput, ExplainabilityContribution, InsightScore, InsightScoreInput, MeasuredGroup,
};

const MOCK_SOURCE: &str = "mock:/v2/insights";

struct CatalogEntity {
    id: &'static str,
    #[allow(dead_code)]
    name: &'static str,
    subtype: &'static str,
    anchor: Option<f64>,
    cross: Option<f64>,
    local: Option<f64>,
    audience: Option<f64>,
}

struct ExplainInput {
    input: &'static str,
    weight: f64,
}

struct Scenario {
    city: &'static str,
    explain: &'static [ExplainInput],
    entities: &'static [CatalogEntity],
}

fn affinity_of(entity: &CatalogEntity, role: &str) -> Option<f64> {
    match role {
        "anchor" => entity.anchor,
        "cross" => entity.cross,
        "local" => entity.local,
        "audience" => entity.audience,
        _ => None,
    }
}

fn scenarios() -> &'static [Scenario] {
    static SCENARIOS: OnceLock<Vec<Scenario>> = OnceLock::new();
    SCENARIOS.get_or_init(|| {
        vec![
            Scenario {
                city: "Bangkok",
                explain: &[
                    ExplainInput { input: "td-mock-tag-night-market", weight: 0.62 },
                    ExplainInput { input: "td-mock-entity-maa-kai-yang", weight: 0.38 },
                ],
                entities: &[
                    CatalogEntity { id: "td-mock-entity-yaowarat-grill", name: "Yaowarat Grill", subtype: "urn:entity:place", anchor: Some(0.84), cross: Some(0.9), local: Some(0.91), audience: Some(0.7) },
                    CatalogEntity { id: "td-mock-entity-talad-neon", name: "Talad Neon", subtype: "urn:entity:place", anchor: None, cross: Some(0.9), local: None, audience: None },
                    CatalogEntity { id: "td-mock-entity-maa-kai-yang", name: "Maa Kai Yang", subtype: "urn:entity:brand", anchor: Some(0.78), cross: Some(0.6), local: None, audience: Some(0.7) },
                    CatalogEntity { id: "td-mock-entity-boat-noodle-lamp", name: "Boat Noodle Lamp", subtype: "urn:entity:brand", anchor: None, cross: Some(0.6), local: None, audience: None },
                ],
            },
            Scenario {
                city: "Tokyo",
                explain: &[
                    ExplainInput { input: "td-mock-tag-indie-venue", weight: 0.58 },
                    ExplainInput { input: "td-mock-entity-koenji-echo", weight: 0.42 },
                ],
                entities: &[
                    CatalogEntity { id: "td-mock-entity-paper-coast", name: "Paper Coast", subtype: "urn:entity:artist", anchor: Some(0.88), cross: Some(0.92), local: None, audience: Some(0.84) },
                    CatalogEntity { id: "td-mock-entity-shimokitazawa-static", name: "Shimokitazawa Static", subtype: "urn:entity:artist", anchor: None, cross: Some(0.86), local: None, audience: None },
                    CatalogEntity { id: "td-mock-entity-koenji-echo", name: "Koenji Echo", subtype: "urn:entity:place", anchor: Some(0.64), cross: Some(0.58), local: Some(0.7), audience: Some(0.6) },
                ],
            },
            Scenario {
                city: "Berlin",
                explain: &[
                    ExplainInput { input: "td-mock-tag-vegan-sneaker", weight: 0.51 },
                    ExplainInput { input: "td-mock-entity-kreuzberg-yard", weight: 0.49 },
                ],
                entities: &[
                    CatalogEntity { id: "td-mock-entity-hof-sneaker", name: "Hof Sneaker", subtype: "urn:entity:brand", anchor: Some(0.66), cross: Some(0.62), local: None, audience: Some(0.4) },
                    CatalogEntity { id: "td-mock-entity-spree-canvas", name: "Spree Canvas", subtype: "urn:entity:brand", anchor: None, cross: Some(0.58), local: None, audience: None },
                    CatalogEntity { id: "td-mock-entity-kreuzberg-yard", name: "Kreuzberg Yard", subtype: "urn:entity:place", anchor: Some(0.58), cross: Some(0.5), local: Some(0.44), audience: Some(0.36) },
                ],
            },
        ]
    })
    .as_slice()
}

struct BuiltQuery {
    role: &'static str,
    entity_type: String,
    wanted: Option<Vec<String>>,
}

pub fn score_mock_brief(brief: &BriefV2) -> InsightScore {
    let queries = build_queries(brief);
    let scenario = scenarios().iter().find(|item| item.city.eq_ignore_ascii_case(brief.city.trim()));
    let mut anchor_groups = Vec::new();
    let mut cross_groups = Vec::new();
    let mut local_groups = Vec::new();
    let mut audience_groups = Vec::new();
    for query in &queries {
        let rows = match scenario {
            Some(scenario) => rows_for(scenario, query),
            None => Vec::new(),
        };
        let group = MeasuredGroup {
            label: Some(query.entity_type.clone()),
            rows,
        };
        match query.role {
            "anchor" => anchor_groups.push(group),
            "cross" => cross_groups.push(group),
            "local" => local_groups.push(group),
            "audience" => audience_groups.push(group),
            _ => {}
        }
    }
    let dimension = |groups: Vec<MeasuredGroup>| DimensionInput {
        groups,
        source: MOCK_SOURCE.to_string(),
    };
    score_insight_measurements(&InsightScoreInput {
        anchor: dimension(anchor_groups),
        cross: dimension(cross_groups),
        local: dimension(local_groups),
        audience: dimension(audience_groups),
        active_ref_count: brief.references.len() as u32,
    })
}

fn rows_for(scenario: &Scenario, query: &BuiltQuery) -> Vec<crate::types::MeasuredAffinity> {
    scenario
        .entities
        .iter()
        .filter(|entity| entity.subtype == query.entity_type)
        .filter_map(|entity| {
            let affinity = affinity_of(entity, query.role)?;
            let include = match &query.wanted {
                Some(ids) => ids.iter().any(|id| id == entity.id),
                None => query.role == "cross" || query.role == "local",
            };
            if !include {
                return None;
            }
            let contributions = scenario
                .explain
                .iter()
                .filter(|item| item.input != entity.id)
                .map(|item| ExplainabilityContribution {
                    input: item.input.to_string(),
                    weight: item.weight,
                    target: entity.id.to_string(),
                })
                .collect();
            Some(crate::types::MeasuredAffinity {
                affinity: Some(affinity),
                contributions,
                evidence_refs: vec![entity.id.to_string()],
            })
        })
        .collect()
}

fn build_queries(brief: &BriefV2) -> Vec<BuiltQuery> {
    let types = target_entity_types(brief);
    let city = brief.city.trim();
    let age = qloo_age(&brief.age);
    let gender = qloo_gender(brief.gender.as_deref());
    let mut queries = Vec::new();
    for entity_type in types {
        let anchors = ids_of_type(brief, &entity_type);
        if !anchors.is_empty() {
            queries.push(BuiltQuery {
                role: "anchor",
                entity_type: entity_type.clone(),
                wanted: Some(anchors.clone()),
            });
            if age.is_some() || gender.is_some() {
                queries.push(BuiltQuery {
                    role: "audience",
                    entity_type: entity_type.clone(),
                    wanted: Some(anchors),
                });
            }
        }
        queries.push(BuiltQuery {
            role: "cross",
            entity_type: entity_type.clone(),
            wanted: None,
        });
    }
    if !city.is_empty() {
        let places: Vec<&crate::types::EntityRef> = brief
            .locations
            .iter()
            .filter(|item| {
                matches!(
                    to_entity_urn(&item.kind).as_deref(),
                    Some("urn:entity:place") | Some("urn:entity:destination")
                )
            })
            .collect();
        let all_destination = !places.is_empty()
            && places.iter().all(|item| to_entity_urn(&item.kind).as_deref() == Some("urn:entity:destination"));
        let local_type = if all_destination { "urn:entity:destination" } else { "urn:entity:place" };
        let local_ids: Vec<String> = places
            .iter()
            .filter(|item| to_entity_urn(&item.kind).as_deref() == Some(local_type))
            .map(|item| item.id.clone())
            .filter(|id| !id.is_empty())
            .collect();
        queries.push(BuiltQuery {
            role: "local",
            entity_type: local_type.to_string(),
            wanted: if local_ids.is_empty() { None } else { Some(local_ids) },
        });
    }
    queries
}

fn target_entity_types(brief: &BriefV2) -> Vec<String> {
    let mut out = Vec::new();
    let mut add = |urn: Option<String>| {
        let Some(urn) = urn else { return };
        if out.iter().any(|item| item == &urn) || out.len() >= 4 {
            return;
        }
        out.push(urn);
    };
    for item in brief.references.iter().chain(brief.locations.iter()) {
        add(to_entity_urn(&item.kind));
    }
    let text = std::iter::once(brief.idea.as_str())
        .chain(brief.interests.iter().map(|tag| tag.name.as_str()))
        .collect::<Vec<_>>()
        .join(" ");
    for (re, types) in category_cues() {
        if !re.is_match(&text) {
            continue;
        }
        for kind in *types {
            add(Some((*kind).to_string()));
        }
    }
    out
}

fn ids_of_type(brief: &BriefV2, urn: &str) -> Vec<String> {
    brief
        .references
        .iter()
        .filter(|item| to_entity_urn(&item.kind).as_deref() == Some(urn))
        .map(|item| item.id.clone())
        .filter(|id| !id.is_empty())
        .collect()
}

fn qloo_age(age: &str) -> Option<&'static str> {
    match age.trim() {
        "18\u{2013}25" | "18-25" => Some("24_and_younger"),
        "26\u{2013}35" | "26-35" => Some("30_to_34"),
        "36\u{2013}45" | "36-45" => Some("35_to_44"),
        "46+" => Some("45_to_54"),
        "24_and_younger" | "25_to_29" | "30_to_34" | "35_and_younger" | "35_to_44" | "36_to_55" | "45_to_54" | "55_and_older" => {
            // The returned string has to be 'static. Match arms above cover the product bands.
            // Raw Qloo buckets are recognized so an audience query is still built.
            Some(match age.trim() {
                "24_and_younger" => "24_and_younger",
                "25_to_29" => "25_to_29",
                "30_to_34" => "30_to_34",
                "35_and_younger" => "35_and_younger",
                "35_to_44" => "35_to_44",
                "36_to_55" => "36_to_55",
                "45_to_54" => "45_to_54",
                _ => "55_and_older",
            })
        }
        _ => None,
    }
}

fn qloo_gender(gender: Option<&str>) -> Option<String> {
    let value = gender?.trim().to_lowercase();
    if value.is_empty() {
        return None;
    }
    match value.as_str() {
        "female" | "f" => Some("female".to_string()),
        "male" | "m" => Some("male".to_string()),
        _ => None,
    }
}

#[cfg(test)]
pub(crate) fn entity_urn_for_test(kind: &str) -> Option<String> {
    to_entity_urn(kind)
}

fn to_entity_urn(kind: &str) -> Option<String> {
    let raw = kind.trim();
    if raw == "urn:entity:video_game" {
        return Some("urn:entity:videogame".to_string());
    }
    if raw.starts_with("urn:entity:") {
        return Some(raw.to_string());
    }
    let mapped = match raw.to_lowercase().as_str() {
        "brand" => "urn:entity:brand",
        "artist" => "urn:entity:artist",
        "film" | "movie" => "urn:entity:movie",
        "place" | "restaurant" => "urn:entity:place",
        "destination" => "urn:entity:destination",
        "person" => "urn:entity:person",
        "book" => "urn:entity:book",
        "podcast" => "urn:entity:podcast",
        "tv_show" | "tv show" => "urn:entity:tv_show",
        "videogame" | "video_game" => "urn:entity:videogame",
        _ => return None,
    };
    Some(mapped.to_string())
}

fn category_cues() -> &'static [(Regex, &'static [&'static str])] {
    static CUES: OnceLock<Vec<(Regex, &'static [&'static str])>> = OnceLock::new();
    CUES.get_or_init(|| {
        vec![
            (Regex::new(r"(?i)sneaker|streetwear|fashion|apparel|clothing|รองเท้า|แฟชั่น").unwrap(), &["urn:entity:brand"]),
            (Regex::new(r"(?i)night[- ]?market|\bsnack\b|street food|restaurant|\bfood\b|อาหาร|ของกิน").unwrap(), &["urn:entity:place", "urn:entity:brand"]),
            (Regex::new(r"(?i)\bmusic\b|\bvenue\b|\bdj\b|\bband\b|\balbum\b|concert|เพลง|ดนตรี|\bindie\b").unwrap(), &["urn:entity:artist", "urn:entity:place"]),
            (Regex::new(r"(?i)\bfilm\b|\bmovie\b|cinema|หนัง").unwrap(), &["urn:entity:movie"]),
            (Regex::new(r"(?i)podcast").unwrap(), &["urn:entity:podcast"]),
            (Regex::new(r"(?i)\bbook\b|\bnovel\b").unwrap(), &["urn:entity:book"]),
            (Regex::new(r"(?i)video game|videogame|\bgame\b").unwrap(), &["urn:entity:videogame"]),
            (Regex::new(r"(?i)hotel|destination|neighborhood|district|ย่าน").unwrap(), &["urn:entity:destination", "urn:entity:place"]),
        ]
    })
}

pub fn bangkok_brief() -> BriefV2 {
    authored_brief(
        "A late-night snack stall on a Bangkok night market row, grilled and eaten standing up",
        "Bangkok",
        "18\u{2013}25",
        None,
        "Mass",
        &[("td-mock-tag-night-market", "night market snack"), ("td-mock-tag-street-grill", "charcoal street grill")],
        &[
            ("td-mock-entity-yaowarat-grill", "Yaowarat Grill", "urn:entity:place"),
            ("td-mock-entity-maa-kai-yang", "Maa Kai Yang", "urn:entity:brand"),
        ],
        &[("td-mock-entity-yaowarat-grill", "Yaowarat Grill", "urn:entity:place")],
    )
}

pub fn tokyo_brief() -> BriefV2 {
    authored_brief(
        "A small Tokyo venue for indie bands, with a listening bar in the back",
        "Tokyo",
        "26\u{2013}35",
        Some("female"),
        "Independent",
        &[("td-mock-tag-indie-venue", "indie live venue")],
        &[
            ("td-mock-entity-paper-coast", "Paper Coast", "urn:entity:artist"),
            ("td-mock-entity-koenji-echo", "Koenji Echo", "urn:entity:place"),
        ],
        &[("td-mock-entity-koenji-echo", "Koenji Echo", "urn:entity:place")],
    )
}

pub fn berlin_brief() -> BriefV2 {
    authored_brief(
        "A Berlin vegan sneaker made in small runs and sold from a courtyard shop",
        "Berlin",
        "18\u{2013}25",
        None,
        "Independent",
        &[("td-mock-tag-vegan-sneaker", "vegan sneaker")],
        &[
            ("td-mock-entity-hof-sneaker", "Hof Sneaker", "urn:entity:brand"),
            ("td-mock-entity-kreuzberg-yard", "Kreuzberg Yard", "urn:entity:place"),
        ],
        &[("td-mock-entity-kreuzberg-yard", "Kreuzberg Yard", "urn:entity:place")],
    )
}

fn authored_brief(
    idea: &str,
    city: &str,
    age: &str,
    gender: Option<&str>,
    positioning: &str,
    interests: &[(&str, &str)],
    references: &[(&str, &str, &str)],
    locations: &[(&str, &str, &str)],
) -> BriefV2 {
    BriefV2 {
        idea: idea.to_string(),
        interests: interests
            .iter()
            .map(|(id, name)| crate::types::TagRef { id: (*id).to_string(), name: (*name).to_string() })
            .collect(),
        references: entity_list(references),
        locations: entity_list(locations),
        city: city.to_string(),
        age: age.to_string(),
        gender: gender.map(str::to_string),
        positioning: positioning.to_string(),
        constraints: Vec::new(),
    }
}

fn entity_list(rows: &[(&str, &str, &str)]) -> Vec<crate::types::EntityRef> {
    rows.iter()
        .map(|(id, name, kind)| crate::types::EntityRef {
            id: (*id).to_string(),
            name: (*name).to_string(),
            kind: (*kind).to_string(),
        })
        .collect()
}
