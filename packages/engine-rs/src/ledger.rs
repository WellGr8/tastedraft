use crate::round::js_round;
use crate::types::{
    EvidencePacket, FRICTION_FACTOR, LedgerPoints, LedgerRow, Provenance, ScoreLedger, Subscores,
    WEIGHTS_ANCHOR, WEIGHTS_AUDIENCE, WEIGHTS_CROSS, WEIGHTS_LOCAL,
};

pub fn row_weight(id: &str) -> f64 {
    match id {
        "anchor" => WEIGHTS_ANCHOR as f64,
        "cross" => WEIGHTS_CROSS as f64,
        "local" => WEIGHTS_LOCAL as f64,
        "audience" => WEIGHTS_AUDIENCE as f64,
        "friction" => FRICTION_FACTOR,
        _ => 0.0,
    }
}

pub fn points_for(id: &str, subscore: Option<i64>) -> Option<i64> {
    let subscore = subscore?;
    if id == "friction" {
        Some(-js_round(subscore as f64 * FRICTION_FACTOR))
    } else {
        Some(js_round(subscore as f64 * row_weight(id) / 100.0))
    }
}

pub fn sample_ledger(subs: Subscores, points: LedgerPoints, packet: &EvidencePacket) -> ScoreLedger {
    let names: Vec<String> = packet.refs.iter().map(|r| r.name.clone()).collect();
    let rows = vec![
        sample_row("anchor", subs.anchor, points.anchor, &names, format!("Anchor affinity {} from the sample graph.", subs.anchor)),
        sample_row("cross", subs.cross, points.cross, &names, format!("Cross-domain fit {} from the sample graph.", subs.cross)),
        sample_row("local", subs.local, points.local, &names, format!("Local fit {} from the sample graph.", subs.local)),
        sample_row(
            "audience",
            subs.audience,
            points.audience,
            &names,
            format!("Audience fit {} from the sample graph.", subs.audience),
        ),
        sample_row(
            "friction",
            subs.friction,
            points.friction,
            &names,
            format!("Cultural friction {} from the sample graph.", subs.friction),
        ),
    ];
    ScoreLedger {
        total: Some(points.total),
        rows,
    }
}

fn sample_row(id: &str, subscore: i64, points: i64, refs: &[String], detail: String) -> LedgerRow {
    LedgerRow {
        id: id.to_string(),
        subscore: Some(subscore),
        weight: row_weight(id),
        points: Some(points),
        provenance: Provenance {
            source: "sample".to_string(),
            detail,
            evidence_refs: refs.to_vec(),
        },
    }
}

pub fn weights_of() -> serde_json::Value {
    serde_json::json!({
        "anchor": WEIGHTS_ANCHOR,
        "cross": WEIGHTS_CROSS,
        "local": WEIGHTS_LOCAL,
        "audience": WEIGHTS_AUDIENCE,
    })
}
