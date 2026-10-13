use crate::round::{avg, clamp100, js_round};
use crate::ledger::weights_of;
use crate::types::{
    BasePenalty, DisplayScore, EvidencePacket, FRICTION_FACTOR, LedgerPoints, NullableLedger,
    NullableSubs, ScoredPacket, Subscores, WEIGHTS_ANCHOR, WEIGHTS_AUDIENCE, WEIGHTS_CROSS,
    WEIGHTS_LOCAL,
};

pub const NULL_SIGNAL: &str = "deriveSubs received a null signal. Missing evidence is a gap, not zero.";

/// A former number left unmeasured. Those are gaps, not zeroes.
pub fn measurements_missing(packet: &EvidencePacket) -> bool {
    if packet.refs.iter().any(|r| !crate::types::present(r.affinity)) {
        return true;
    }
    if packet.domains.iter().any(|d| !crate::types::present(d.affinity)) {
        return true;
    }
    let local_missing = match &packet.local {
        Some(side) => !crate::types::present(side.base) || !crate::types::present(side.penalty),
        None => true,
    };
    if local_missing {
        return true;
    }
    let audience_missing = match &packet.audience {
        Some(side) => !crate::types::present(side.base) || !crate::types::present(side.penalty),
        None => true,
    };
    if audience_missing {
        return true;
    }
    if !crate::types::present(packet.friction) || !crate::types::present(packet.cross_adjust) {
        return true;
    }
    match &packet.signal {
        Some(signal) => {
            !crate::types::present(signal.fashion)
                || !crate::types::present(signal.music)
                || !crate::types::present(signal.design)
        }
        None => true,
    }
}

pub fn derive_subs(packet: Option<&EvidencePacket>) -> Result<Subscores, String> {
    if let Some(packet) = packet {
        if measurements_missing(packet) {
            return Err(NULL_SIGNAL.to_string());
        }
    }
    let refs = packet.map(|p| p.refs.as_slice()).unwrap_or(&[]);
    let domains = packet.map(|p| p.domains.as_slice()).unwrap_or(&[]);
    let anchor = if refs.is_empty() {
        42
    } else {
        let values: Vec<f64> = refs.iter().map(|r| crate::types::num_or_zero(r.affinity)).collect();
        clamp100(avg(&values))
    };
    let cross = if domains.is_empty() {
        36
    } else {
        let values: Vec<f64> = domains
            .iter()
            .map(|d| crate::types::num_or_zero(d.affinity))
            .collect();
        let coverage = (domains.len() as f64 / 3.0).min(1.0);
        let adjust = packet.map(|p| crate::types::num_or_zero(p.cross_adjust)).unwrap_or(0.0);
        // `crossAdjust || 0` in JS: zero and null both contribute nothing.
        let adjust = if adjust == 0.0 { 0.0 } else { adjust };
        clamp100(avg(&values) * coverage + adjust)
    };
    let local_in = packet.and_then(|p| p.local.as_ref());
    let aud_in = packet.and_then(|p| p.audience.as_ref());
    let local = side_score(local_in);
    let audience = side_score(aud_in);
    let friction = clamp100(packet.map(|p| crate::types::num_or_zero(p.friction)).unwrap_or(0.0));
    Ok(Subscores {
        anchor,
        cross,
        local,
        audience,
        friction,
    })
}

fn side_score(side: Option<&BasePenalty>) -> i64 {
    let base = side.map(|s| crate::types::num_or_zero(s.base)).unwrap_or(0.0);
    let penalty = side.map(|s| crate::types::num_or_zero(s.penalty)).unwrap_or(0.0);
    clamp100(base - penalty)
}

pub fn ledger_points(subs: Subscores) -> LedgerPoints {
    let anchor = js_round(subs.anchor as f64 * WEIGHTS_ANCHOR as f64 / 100.0);
    let cross = js_round(subs.cross as f64 * WEIGHTS_CROSS as f64 / 100.0);
    let local = js_round(subs.local as f64 * WEIGHTS_LOCAL as f64 / 100.0);
    let audience = js_round(subs.audience as f64 * WEIGHTS_AUDIENCE as f64 / 100.0);
    let friction = -js_round(subs.friction as f64 * FRICTION_FACTOR);
    LedgerPoints {
        anchor,
        cross,
        local,
        audience,
        friction,
        total: anchor + cross + local + audience + friction,
    }
}

/// 4 or more active references is HIGH, 2–3 is MEDIUM, fewer than 2 is LIMITED.
pub fn evidence_key(active_ref_count: u32) -> &'static str {
    if active_ref_count >= 4 {
        "HIGH"
    } else if active_ref_count >= 2 {
        "MEDIUM"
    } else {
        "LIMITED"
    }
}

/// LIMITED scores display rounded to the nearest 5. The ledger keeps the exact sum.
pub fn display_score(total: i64, active_ref_count: u32) -> DisplayScore {
    let limited = evidence_key(active_ref_count) == "LIMITED";
    if !limited {
        return DisplayScore {
            text: total.to_string(),
            why: format!("Why {total}?"),
            limited: false,
            approx: total,
        };
    }
    let approx = js_round(total as f64 / 5.0) * 5;
    DisplayScore {
        text: format!("\u{2248} {approx}"),
        why: format!("Why \u{2248} {approx}?"),
        limited: true,
        approx,
    }
}

fn is_num(value: Option<f64>) -> bool {
    value.is_some_and(|n| n.is_finite())
}

/// Fully measured packets use deriveSubs. A null dimension stays out of the total.
pub fn score_packet(packet: &EvidencePacket) -> Result<ScoredPacket, String> {
    if !measurements_missing(packet) {
        let subs = derive_subs(Some(packet))?;
        let points = ledger_points(subs);
        let active = packet.refs.len() as u32;
        return Ok(ScoredPacket {
            score: Some(points.total),
            subs: NullableSubs {
                anchor: Some(subs.anchor),
                cross: Some(subs.cross),
                local: Some(subs.local),
                audience: Some(subs.audience),
                friction: Some(subs.friction),
            },
            ledger: NullableLedger {
                anchor: Some(points.anchor),
                cross: Some(points.cross),
                local: Some(points.local),
                audience: Some(points.audience),
                friction: Some(points.friction),
            },
            evidence_strength: evidence_key(active).to_string(),
            gaps: Vec::new(),
            display: Some(display_score(points.total, active)),
        });
    }
    Ok(score_partial(packet))
}

fn score_partial(packet: &EvidencePacket) -> ScoredPacket {
    let mut gaps = Vec::new();
    let affinities: Vec<f64> = packet.refs.iter().filter_map(|r| r.affinity.filter(|n| n.is_finite())).collect();
    let anchor = if !affinities.is_empty() {
        Some(clamp100(avg(&affinities)))
    } else if packet.refs.is_empty() {
        Some(42)
    } else {
        gaps.push("anchor".to_string());
        None
    };

    let domain_values: Vec<f64> = packet
        .domains
        .iter()
        .filter_map(|d| d.affinity.filter(|n| n.is_finite()))
        .collect();
    let cross = if !domain_values.is_empty() {
        let coverage = (domain_values.len() as f64 / 3.0).min(1.0);
        let mut value = avg(&domain_values) * coverage;
        if is_num(packet.cross_adjust) {
            value += packet.cross_adjust.unwrap_or(0.0);
        }
        Some(clamp100(value))
    } else if packet.domains.is_empty() && packet.refs.is_empty() {
        Some(36)
    } else {
        gaps.push("cross".to_string());
        None
    };

    let local = partial_side(packet.local.as_ref(), "local", &mut gaps);
    let audience = partial_side(packet.audience.as_ref(), "audience", &mut gaps);
    let friction = if is_num(packet.friction) {
        Some(clamp100(packet.friction.unwrap_or(0.0)))
    } else {
        gaps.push("friction".to_string());
        None
    };

    let subs = NullableSubs {
        anchor,
        cross,
        local,
        audience,
        friction,
    };
    let ledger = NullableLedger {
        anchor: weighted(anchor, WEIGHTS_ANCHOR),
        cross: weighted(cross, WEIGHTS_CROSS),
        local: weighted(local, WEIGHTS_LOCAL),
        audience: weighted(audience, WEIGHTS_AUDIENCE),
        friction: friction.map(|value| -js_round(value as f64 * FRICTION_FACTOR)),
    };
    let present: Vec<i64> = [ledger.anchor, ledger.cross, ledger.local, ledger.audience, ledger.friction]
        .into_iter()
        .flatten()
        .collect();
    let score = if present.is_empty() {
        None
    } else {
        Some(present.iter().sum())
    };
    let measured_refs = affinities.len();
    let strength = if !gaps.is_empty() || measured_refs < packet.refs.len() {
        "LIMITED"
    } else {
        evidence_key(packet.refs.len() as u32)
    };
    let display = score.map(|total| {
        let count = if strength == "LIMITED" { 0 } else { packet.refs.len() as u32 };
        display_score(total, count)
    });
    ScoredPacket {
        score,
        subs,
        ledger,
        evidence_strength: strength.to_string(),
        gaps,
        display,
    }
}

fn partial_side(side: Option<&BasePenalty>, name: &str, gaps: &mut Vec<String>) -> Option<i64> {
    let Some(side) = side else {
        gaps.push(name.to_string());
        return None;
    };
    if !is_num(side.base) {
        gaps.push(name.to_string());
        return None;
    }
    if !is_num(side.penalty) {
        return Some(clamp100(side.base.unwrap_or(0.0)));
    }
    Some(clamp100(side.base.unwrap_or(0.0) - side.penalty.unwrap_or(0.0)))
}

fn weighted(sub: Option<i64>, weight: i64) -> Option<i64> {
    sub.map(|value| js_round(value as f64 * weight as f64 / 100.0))
}

pub fn weights_json() -> serde_json::Value {
    serde_json::json!({
        "weights": weights_of(),
        "frictionFactor": FRICTION_FACTOR,
    })
}
