use std::sync::OnceLock;

use regex::Regex;

use crate::round::avg;
use crate::types::{BasePenalty, EvidenceDomain, EvidencePacket, EvidenceRef, SampleBrief, SignalTriple};

pub const DEFAULT_IDEA: &str =
    "Japanese minimalist streetwear with an underground electronic identity, sold at a premium price in limited runs";

pub const AGE_18: &str = "18\u{2013}25";
pub const AGE_26: &str = "26\u{2013}35";
pub const AGE_36: &str = "36\u{2013}45";
pub const AGE_46: &str = "46+";

pub const DEFAULT_REFS: [&str; 5] = [
    "Comme des Garçons",
    "Muji",
    "Aphex Twin",
    "Lost in Translation",
    "Silver Lake",
];

const PLACE_BONUS: f64 = 4.0;

struct Facets {
    japanese: f64,
    minimal: f64,
    streetwear: f64,
    electronic: f64,
}

struct RefRecord {
    kind: &'static str,
    fit: &'static str,
    provenance: &'static str,
    generic: f64,
    city: Option<&'static str>,
    facets: Facets,
}

struct CityRow {
    local_base: f64,
    premium_drag: f64,
    scarcity_drag: f64,
    audience_mod: f64,
    friction_mod: f64,
}

struct AgeRow {
    base: f64,
    independent: f64,
    mass: f64,
    premium: f64,
    luxury: f64,
    accessible: f64,
}

fn known_ref(name: &str) -> Option<RefRecord> {
    let facets = |japanese, minimal, streetwear, electronic| Facets {
        japanese,
        minimal,
        streetwear,
        electronic,
    };
    Some(match name {
        "Comme des Garçons" => RefRecord {
            kind: "Brand",
            fit: "logo",
            provenance: "sample",
            generic: 46.0,
            city: None,
            facets: facets(100.0, 96.0, 90.0, 66.0),
        },
        "Muji" => RefRecord {
            kind: "Brand",
            fit: "logo",
            provenance: "sample",
            generic: 46.0,
            city: None,
            facets: facets(70.0, 80.0, 38.0, 20.0),
        },
        "Aphex Twin" => RefRecord {
            kind: "Artist",
            fit: "circle",
            provenance: "sample",
            generic: 46.0,
            city: None,
            facets: facets(40.0, 70.0, 78.0, 100.0),
        },
        "Lost in Translation" => RefRecord {
            kind: "Film",
            fit: "photo",
            provenance: "sample",
            generic: 46.0,
            city: None,
            facets: facets(90.0, 60.0, 36.0, 30.0),
        },
        "Silver Lake" => RefRecord {
            kind: "Place",
            fit: "photo",
            provenance: "sample",
            generic: 46.0,
            city: Some("Los Angeles"),
            facets: facets(44.0, 68.0, 92.0, 84.0),
        },
        _ => return None,
    })
}

fn city_row(name: &str) -> Option<CityRow> {
    // Bangkok, Seoul, New York, and Lisbon are scaled from a live Qloo heatmap
    // against Los Angeles (price affinity 0.680, popularity affinity 0.453,
    // local_base 86, premium_drag 10). Place mean prices nudge premium_drag.
    //   local_base = round(86 * popularity / 0.453)
    //   premium_drag = round(10 * price / 0.680 + (place_price - 2.4))
    //   scarcity_drag = round(premium_drag * 0.6)
    //   audience_mod = round(4 * popularity / 0.453)
    //   friction_mod = round((price - 0.680) / 0.680 * 4)
    // Bangkok 0.442 / 0.628 / place 2.75. Seoul 0.348 / 0.687 / 2.273.
    // New York 0.409 / 0.731 / 2.5. Lisbon 0.441 / 0.634 / 2.0.
    // Tokyo stays on the Los Angeles row so the tour preview stays 52.
    Some(match name {
        "Los Angeles" => CityRow { local_base: 86.0, premium_drag: 10.0, scarcity_drag: 6.0, audience_mod: 4.0, friction_mod: 0.0 },
        "New York" | "NYC" => CityRow { local_base: 78.0, premium_drag: 11.0, scarcity_drag: 7.0, audience_mod: 4.0, friction_mod: 0.0 },
        "San Francisco" => CityRow { local_base: 81.0, premium_drag: 7.0, scarcity_drag: 5.0, audience_mod: 0.0, friction_mod: 1.0 },
        "Austin" => CityRow { local_base: 83.0, premium_drag: 4.0, scarcity_drag: 2.0, audience_mod: 3.0, friction_mod: -1.0 },
        "Miami" => CityRow { local_base: 64.0, premium_drag: 14.0, scarcity_drag: 9.0, audience_mod: -8.0, friction_mod: 4.0 },
        "Chicago" => CityRow { local_base: 77.0, premium_drag: 8.0, scarcity_drag: 5.0, audience_mod: -2.0, friction_mod: 1.0 },
        "Seattle" => CityRow { local_base: 85.0, premium_drag: 5.0, scarcity_drag: 3.0, audience_mod: -2.0, friction_mod: 2.0 },
        // 83–87 rounds to the same local points as Los Angeles (86). Bangkok 83.9 and
        // Lisbon 83.7 sit just below that, so both use 82 and the lower reading shows.
        "Bangkok" => CityRow { local_base: 82.0, premium_drag: 10.0, scarcity_drag: 6.0, audience_mod: 4.0, friction_mod: 0.0 },
        "Seoul" => CityRow { local_base: 66.0, premium_drag: 10.0, scarcity_drag: 6.0, audience_mod: 3.0, friction_mod: 0.0 },
        "Lisbon" => CityRow { local_base: 82.0, premium_drag: 9.0, scarcity_drag: 5.0, audience_mod: 4.0, friction_mod: 0.0 },
        _ => return None,
    })
}

fn age_row(age: &str) -> Option<AgeRow> {
    Some(match age {
        AGE_18 => AgeRow { base: 84.0, independent: 2.0, mass: 14.0, premium: 20.0, luxury: 36.0, accessible: 0.0 },
        AGE_26 => AgeRow { base: 80.0, independent: 4.0, mass: 12.0, premium: 10.0, luxury: 22.0, accessible: 2.0 },
        AGE_36 => AgeRow { base: 68.0, independent: 6.0, mass: 8.0, premium: 4.0, luxury: 10.0, accessible: 2.0 },
        AGE_46 => AgeRow { base: 50.0, independent: 10.0, mass: 8.0, premium: 6.0, luxury: 4.0, accessible: 4.0 },
        _ => return None,
    })
}

fn price_friction(age: &str, posture: &str) -> f64 {
    let row: &[(&str, f64)] = match age {
        AGE_18 => &[("Independent", 3.0), ("Mass", 6.0), ("Premium", 8.0), ("Luxury", 18.0), ("accessible", 4.0)],
        AGE_26 => &[("Independent", 3.0), ("Mass", 5.0), ("Premium", 6.0), ("Luxury", 12.0), ("accessible", 3.0)],
        AGE_36 => &[("Independent", 4.0), ("Mass", 5.0), ("Premium", 4.0), ("Luxury", 7.0), ("accessible", 3.0)],
        AGE_46 => &[("Independent", 7.0), ("Mass", 5.0), ("Premium", 4.0), ("Luxury", 4.0), ("accessible", 3.0)],
        _ => &[],
    };
    row.iter().find(|(key, _)| *key == posture).map(|(_, value)| *value).unwrap_or(0.0)
}

fn scarcity_friction(age: &str, scarcity: &str) -> f64 {
    let row: &[(&str, f64)] = match age {
        AGE_18 => &[("limited", 4.0), ("preorder", 2.0), ("none", 0.0)],
        AGE_26 => &[("limited", 3.0), ("preorder", 1.0), ("none", 0.0)],
        AGE_36 => &[("limited", 2.0), ("preorder", 1.0), ("none", 0.0)],
        AGE_46 => &[("limited", 2.0), ("preorder", 1.0), ("none", 0.0)],
        _ => &[],
    };
    row.iter().find(|(key, _)| *key == scarcity).map(|(_, value)| *value).unwrap_or(0.0)
}

fn concept_patterns() -> &'static [( &'static str, Regex)] {
    static RE: OnceLock<Vec<(&'static str, Regex)>> = OnceLock::new();
    RE.get_or_init(|| {
        vec![
            ("japanese", Regex::new(r"(?i)japan|japanese|ญี่ปุ่น").unwrap()),
            ("minimal", Regex::new(r"(?i)minimal|มินิมอล").unwrap()),
            ("streetwear", Regex::new(r"(?i)street\s?wear|สตรีท").unwrap()),
            ("electronic", Regex::new(r"(?i)electronic|underground|อิเล็กทรอนิก").unwrap()),
        ]
    })
}

fn premium_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)premium|luxury|พรีเมียม|หรู|ราคาสูง").unwrap())
}

fn limited_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)limited|exclusive|scarcity|ลิมิเต็ด|ขาดแคลน").unwrap())
}

pub fn read_facets(idea: &str) -> Vec<String> {
    concept_patterns()
        .iter()
        .filter(|(_, re)| re.is_match(idea))
        .map(|(id, _)| (*id).to_string())
        .collect()
}

pub fn has_premium_language(idea: &str) -> bool {
    premium_re().is_match(idea)
}

pub fn has_limited_language(idea: &str) -> bool {
    limited_re().is_match(idea)
}

fn imul(a: u32, b: u32) -> u32 {
    (a as i32).wrapping_mul(b as i32) as u32
}

/// FNV-1a over UTF-16 code units, matching `Math.imul(...) >>> 0`.
fn hash_name(name: &str) -> u32 {
    let mut h: u32 = 2_166_136_261;
    for unit in name.encode_utf16() {
        h = imul(h ^ u32::from(unit), 16_777_619);
    }
    h
}

fn inferred_record(name: &str) -> RefRecord {
    let h = hash_name(name);
    let band = |shift: u32| 40.0 + f64::from((h >> shift) % 22);
    RefRecord {
        kind: "Reference",
        fit: "photo",
        provenance: "inferred",
        generic: 44.0 + f64::from(h % 8),
        city: None,
        facets: Facets {
            japanese: band(0),
            minimal: band(5),
            streetwear: band(10),
            electronic: band(15),
        },
    }
}

fn record_for(name: &str) -> RefRecord {
    known_ref(name).unwrap_or_else(|| inferred_record(name))
}

fn facet_value(facets: &Facets, id: &str) -> f64 {
    match id {
        "japanese" => facets.japanese,
        "minimal" => facets.minimal,
        "streetwear" => facets.streetwear,
        "electronic" => facets.electronic,
        _ => 40.0,
    }
}

fn concept_affinity(rec: &RefRecord, facets: &[String]) -> f64 {
    if facets.is_empty() {
        return rec.generic;
    }
    let vals: Vec<f64> = facets.iter().map(|id| facet_value(&rec.facets, id)).collect();
    let mut strongest = vals[0];
    let mut sum = 0.0;
    for value in &vals {
        sum += *value;
        if *value > strongest {
            strongest = *value;
        }
    }
    f64::from(crate::round::js_round(strongest * 0.5 + (sum / vals.len() as f64) * 0.5) as i32)
}

fn price_drag(city: &CityRow, posture: &str) -> f64 {
    if posture == "Premium" {
        city.premium_drag
    } else if posture == "Luxury" {
        city.premium_drag + 8.0
    } else if posture == "Mass" {
        f64::from(crate::round::js_round(city.premium_drag * 0.4) as i32)
    } else {
        0.0
    }
}

fn nonempty<'a>(value: Option<&'a str>, fallback: &'a str) -> &'a str {
    match value {
        Some(text) if !text.is_empty() => text,
        _ => fallback,
    }
}

pub fn default_sample_brief() -> SampleBrief {
    SampleBrief {
        idea: DEFAULT_IDEA.to_string(),
        age: AGE_18.to_string(),
        city: "Los Angeles".to_string(),
        pos: "Premium".to_string(),
        refs: DEFAULT_REFS.iter().map(|name| (*name).to_string()).collect(),
        applied: false,
        posture: None,
        scarcity: None,
    }
}

pub fn provide_evidence(brief: &SampleBrief) -> EvidencePacket {
    let idea = brief.idea.as_str();
    let age = if age_row(&brief.age).is_some() { brief.age.as_str() } else { AGE_18 };
    let city_name = if city_row(&brief.city).is_some() { brief.city.as_str() } else { "Los Angeles" };
    let city = city_row(city_name).expect("city row");
    let pos = if brief.pos.is_empty() { "Premium" } else { brief.pos.as_str() };
    let facets = read_facets(idea);
    let posture = nonempty(brief.posture.as_deref(), if brief.applied { "accessible" } else { pos });
    let scarcity = nonempty(
        brief.scarcity.as_deref(),
        if brief.applied {
            "preorder"
        } else if has_limited_language(idea) {
            "limited"
        } else {
            "none"
        },
    );
    let applied_like = brief.applied || brief.posture.as_deref() == Some("accessible");
    let idea_conflict = !applied_like && has_premium_language(idea) && (pos == "Independent" || pos == "Mass");

    let mut refs = Vec::new();
    for name in &brief.refs {
        let rec = record_for(name);
        let affinity = concept_affinity(&rec, &facets);
        refs.push(EvidenceRef {
            name: name.clone(),
            kind: rec.kind.to_string(),
            fit: rec.fit.to_string(),
            provenance: rec.provenance.to_string(),
            affinity: Some(affinity),
            minimal: Some(rec.facets.minimal),
            electronic: Some(rec.facets.electronic),
            streetwear: Some(rec.facets.streetwear),
            city: rec.city.unwrap_or("").to_string(),
        });
    }

    let mut type_order: Vec<String> = Vec::new();
    let mut by_type: Vec<(String, Vec<f64>)> = Vec::new();
    for reference in &refs {
        let affinity = reference.affinity.unwrap_or(0.0);
        if let Some((_, values)) = by_type.iter_mut().find(|(kind, _)| kind == &reference.kind) {
            values.push(affinity);
        } else {
            type_order.push(reference.kind.clone());
            by_type.push((reference.kind.clone(), vec![affinity]));
        }
    }
    let domains: Vec<EvidenceDomain> = type_order
        .iter()
        .map(|kind| {
            let values = by_type.iter().find(|(key, _)| key == kind).map(|(_, values)| values.as_slice()).unwrap_or(&[]);
            EvidenceDomain {
                kind: kind.clone(),
                affinity: Some(avg(values)),
            }
        })
        .collect();

    let place_bonus = if refs.iter().any(|reference| !reference.city.is_empty() && reference.city == city_name) {
        PLACE_BONUS
    } else {
        0.0
    };
    let mut local_penalty = price_drag(&city, posture);
    if scarcity == "limited" {
        local_penalty += city.scarcity_drag;
    }
    if idea_conflict {
        local_penalty += 4.0;
    }

    let age_row = age_row(age).expect("age row");
    let mut audience_penalty = match posture {
        "Independent" => age_row.independent,
        "Mass" => age_row.mass,
        "Premium" => age_row.premium,
        "Luxury" => age_row.luxury,
        "accessible" => age_row.accessible,
        _ => age_row.premium,
    };
    if idea_conflict {
        audience_penalty += 6.0;
    }

    let mut friction = price_friction(age, posture) + scarcity_friction(age, scarcity) + city.friction_mod;
    if idea_conflict {
        friction += 4.0;
    }

    let fashion = if let Some((_, values)) = by_type.iter().find(|(kind, _)| kind == "Brand") {
        f64::from(crate::round::js_round(avg(values)) as i32)
    } else if !refs.is_empty() {
        let values: Vec<f64> = refs.iter().map(|r| r.streetwear.unwrap_or(0.0)).collect();
        f64::from(crate::round::js_round(avg(&values)) as i32)
    } else {
        48.0
    };
    let music = if let Some((_, values)) = by_type.iter().find(|(kind, _)| kind == "Artist") {
        f64::from(crate::round::js_round(avg(values)) as i32)
    } else if !refs.is_empty() {
        let values: Vec<f64> = refs.iter().map(|r| r.electronic.unwrap_or(0.0)).collect();
        f64::from(crate::round::js_round(avg(&values)) as i32)
    } else {
        42.0
    };
    let design = if refs.is_empty() {
        48.0
    } else {
        let values: Vec<f64> = refs.iter().map(|r| r.minimal.unwrap_or(0.0)).collect();
        f64::from(crate::round::js_round(avg(&values)) as i32)
    };

    let wants_electronic = facets.iter().any(|facet| facet == "electronic");
    let has_electronic_artist = refs.iter().any(|reference| reference.kind == "Artist" && reference.electronic.unwrap_or(0.0) >= 80.0);
    let mut cross_adjust = 0.0;
    if wants_electronic && !refs.is_empty() && !has_electronic_artist {
        cross_adjust -= 6.0;
    }

    let inferred_count = refs.iter().filter(|reference| reference.provenance == "inferred").count();
    let source_id = if !refs.is_empty() && inferred_count == refs.len() {
        "inferred"
    } else {
        "sample"
    };

    EvidencePacket {
        source_id: source_id.to_string(),
        mixed: inferred_count > 0 && inferred_count < refs.len(),
        facets,
        refs,
        domains,
        local: Some(BasePenalty {
            base: Some(city.local_base + place_bonus),
            penalty: Some(local_penalty),
        }),
        audience: Some(BasePenalty {
            base: Some(age_row.base + city.audience_mod),
            penalty: Some(audience_penalty),
        }),
        friction: Some(friction),
        signal: Some(SignalTriple {
            fashion: Some(fashion),
            music: Some(music),
            design: Some(design),
        }),
        cross_adjust: Some(cross_adjust),
        posture: posture.to_string(),
        scarcity: scarcity.to_string(),
    }
}
