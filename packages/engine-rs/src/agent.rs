use crate::ledger::sample_ledger;
use crate::sample::{provide_evidence, AGE_18, AGE_26, AGE_36, AGE_46, DEFAULT_IDEA, DEFAULT_REFS};
use crate::score::{derive_subs, display_score, evidence_key, ledger_points};
use crate::types::{BriefV2, EntityRef, QlooParamDiff, Rescore, SampleBrief, SampleScore};

const AGES: [&str; 4] = [AGE_18, AGE_26, AGE_36, AGE_46];
const BUCKETS: [&str; 4] = ["24_and_younger", "30_to_34", "35_to_44", "45_to_54"];
const POS: [&str; 4] = ["Independent", "Premium", "Mass", "Luxury"];
const CITY_NAMES: [&str; 7] = [
    "Los Angeles",
    "New York",
    "San Francisco",
    "Austin",
    "Miami",
    "Chicago",
    "Seattle",
];

struct SampleEntity {
    id: &'static str,
    name: &'static str,
}

const SAMPLE_ENTITIES: [SampleEntity; 5] = [
    SampleEntity { id: "comme-des-garcons", name: "Comme des Garçons" },
    SampleEntity { id: "muji", name: "Muji" },
    SampleEntity { id: "aphex-twin", name: "Aphex Twin" },
    SampleEntity { id: "lost-in-translation", name: "Lost in Translation" },
    SampleEntity { id: "silver-lake", name: "Silver Lake" },
];

struct Districts {
    min: &'static [&'static str],
    lux: &'static [&'static str],
}

fn districts_for(city: &str) -> Districts {
    match city {
        "New York" => Districts { min: &["Lower East Side", "Williamsburg"], lux: &["Upper East Side", "Tribeca"] },
        "San Francisco" => Districts { min: &["Mission", "Hayes Valley"], lux: &["Pacific Heights", "Union Square"] },
        "Austin" => Districts { min: &["East Austin", "South Congress"], lux: &["Westlake", "The Domain"] },
        "Miami" => Districts { min: &["Wynwood", "Little Haiti"], lux: &["South Beach", "Brickell"] },
        "Chicago" => Districts { min: &["Logan Square", "Wicker Park"], lux: &["Gold Coast", "River North"] },
        "Seattle" => Districts { min: &["Capitol Hill", "Fremont"], lux: &["Medina", "Bellevue"] },
        _ => Districts { min: &["Silver Lake", "Echo Park"], lux: &["Beverly Hills", "West Hollywood"] },
    }
}

pub fn score_sample_brief(brief: &SampleBrief) -> Result<SampleScore, String> {
    let packet = provide_evidence(brief);
    let subscores = derive_subs(Some(&packet))?;
    let points = ledger_points(subscores);
    let ledger = sample_ledger(subscores, points, &packet);
    let active = packet.refs.len() as u32;
    Ok(SampleScore {
        subscores,
        points,
        ledger,
        evidence_strength: evidence_key(active).to_string(),
        display: display_score(points.total, active),
        packet,
    })
}

pub fn engine_brief_from_v2(brief: &BriefV2) -> SampleBrief {
    SampleBrief {
        idea: brief.idea.clone(),
        age: brief.age.clone(),
        city: brief.city.clone(),
        pos: brief.positioning.clone(),
        refs: brief.references.iter().map(|reference| reference.name.clone()).collect(),
        applied: false,
        posture: None,
        scarcity: None,
    }
}

pub fn default_brief_v2() -> BriefV2 {
    BriefV2 {
        idea: DEFAULT_IDEA.to_string(),
        interests: Vec::new(),
        references: DEFAULT_REFS
            .iter()
            .map(|name| {
                let known = SAMPLE_ENTITIES.iter().find(|entity| entity.name == *name);
                EntityRef {
                    id: known.map(|entity| entity.id.to_string()).unwrap_or_else(|| slug(name)),
                    name: (*name).to_string(),
                    kind: match *name {
                        "Aphex Twin" => "urn:entity:artist",
                        "Lost in Translation" => "urn:entity:movie",
                        "Silver Lake" => "urn:entity:place",
                        _ => "urn:entity:brand",
                    }
                    .to_string(),
                }
            })
            .collect(),
        locations: vec![EntityRef {
            id: "silver-lake".to_string(),
            name: "Silver Lake".to_string(),
            kind: "urn:entity:place".to_string(),
        }],
        city: "Los Angeles".to_string(),
        age: AGE_18.to_string(),
        gender: None,
        positioning: "Premium".to_string(),
        constraints: vec!["premium price".to_string(), "limited runs".to_string()],
    }
}

/// Apply Qloo parameter diffs, then score. The delta is the engine's, not a model's.
pub fn rescore_param_diffs(brief: &BriefV2, changes: &[QlooParamDiff]) -> Result<Rescore, String> {
    let baseline = score_sample_brief(&engine_brief_from_v2(brief))?;
    let next_brief = apply_diffs_to_engine(brief, changes);
    let next = score_sample_brief(&next_brief)?;
    Ok(Rescore {
        baseline: baseline.points.total,
        total: next.points.total,
        predicted_delta: next.points.total - baseline.points.total,
        subscores: next.subscores,
        points: next.points.clone(),
        ledger: next.ledger,
    })
}

pub fn apply_diffs_to_engine(brief: &BriefV2, changes: &[QlooParamDiff]) -> SampleBrief {
    let mut next = engine_brief_from_v2(brief);
    let mut posture: Option<String> = None;
    let mut positioning = false;
    for change in changes {
        match change.param.as_str() {
            "filter.price_level.max" | "filter.price_level.min" => {
                posture = posture_for_price(change.to.as_deref());
            }
            "signal.demographics.age" => {
                if let Some(to) = change.to.as_deref() {
                    if let Some(band) = band_for_bucket(to) {
                        next.age = band.to_string();
                    }
                }
            }
            "filter.location.query" => {
                if let Some(to) = change.to.as_deref() {
                    next.city = city_for_location_query(to);
                }
            }
            "signal.interests.tags" => {
                if let Some(to) = change.to.as_deref() {
                    next.pos = positioning_for_tag(to);
                    positioning = true;
                }
            }
            "filter.tags" => match change.to.as_deref() {
                Some("preorder-drop") => next.scarcity = Some("preorder".to_string()),
                Some("limited-run") => next.scarcity = Some("limited".to_string()),
                _ => {}
            },
            "signal.interests.entities" => {
                if let Some(to) = change.to.as_deref() {
                    next.refs = to
                        .split(',')
                        .map(str::trim)
                        .filter(|id| !id.is_empty())
                        .map(|id| entity_name(brief, id))
                        .collect();
                }
            }
            _ => {}
        }
    }
    if let Some(posture) = posture {
        next.posture = Some(posture);
    } else if positioning {
        next.posture = None;
    }
    next
}

fn posture_for_price(value: Option<&str>) -> Option<String> {
    match value {
        Some("1") => Some("Mass".to_string()),
        Some("2") => Some("accessible".to_string()),
        Some("4") => Some("Luxury".to_string()),
        _ => None,
    }
}

fn band_for_bucket(bucket: &str) -> Option<&'static str> {
    BUCKETS.iter().position(|item| *item == bucket).map(|index| AGES[index])
}

fn city_for_location_query(query: &str) -> String {
    if CITY_NAMES.contains(&query) {
        return query.to_string();
    }
    for city in CITY_NAMES {
        let districts = districts_for(city);
        if districts.min.contains(&query) || districts.lux.contains(&query) {
            return city.to_string();
        }
    }
    query.to_string()
}

fn positioning_for_tag(tag: &str) -> String {
    let mut chars = tag.chars();
    let titled = match chars.next() {
        Some(first) => {
            let mut titled = first.to_uppercase().collect::<String>();
            titled.push_str(&chars.as_str().to_lowercase());
            titled
        }
        None => String::new(),
    };
    if POS.contains(&titled.as_str()) {
        titled
    } else {
        tag.to_string()
    }
}

fn entity_name(brief: &BriefV2, id: &str) -> String {
    if let Some(reference) = brief.references.iter().find(|reference| reference.id == id) {
        return reference.name.clone();
    }
    SAMPLE_ENTITIES
        .iter()
        .find(|entity| entity.id == id)
        .map(|entity| entity.name.to_string())
        .unwrap_or_else(|| id.to_string())
}

fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}
