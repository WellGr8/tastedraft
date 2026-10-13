use crate::ledger::{points_for, row_weight};
use crate::round::{avg, clamp100, js_to_fixed};
use crate::types::{
    DimensionInput, ExplainabilityContribution, InsightScore, InsightScoreInput, LedgerRow, MeasuredGroup,
    NullableSubs, Provenance, ScoreLedger,
};

pub fn score_insight_measurements(input: &InsightScoreInput) -> InsightScore {
    let anchor = mean_subscore(&input.anchor);
    let cross = cross_subscore(&input.cross);
    let local = mean_subscore(&input.local);
    let audience = mean_subscore(&input.audience);
    let friction = match (anchor.subscore, audience.subscore) {
        (Some(anchor_score), Some(audience_score)) => Some(clamp100((anchor_score - audience_score).max(0) as f64)),
        _ => None,
    };
    let subscores = NullableSubs {
        anchor: anchor.subscore,
        cross: cross.subscore,
        local: local.subscore,
        audience: audience.subscore,
        friction,
    };

    let anchor_contributions = contributions_of(&input.anchor);
    let cross_contributions = contributions_of(&input.cross);
    let local_contributions = contributions_of(&input.local);
    let audience_contributions = contributions_of(&input.audience);
    let friction_input = DimensionInput {
        source: input.anchor.source.clone(),
        groups: input
            .anchor
            .groups
            .iter()
            .cloned()
            .chain(input.audience.groups.iter().cloned())
            .collect(),
    };
    let friction_contributions = contributions_of(&friction_input);

    let rows = vec![
        insight_row(
            "anchor",
            anchor.subscore,
            &input.anchor.source,
            if anchor.subscore.is_none() {
                "Anchor was not measured. No affinity was invented.".to_string()
            } else {
                format!(
                    "Anchor affinity is the mean of {} concept anchors. {}",
                    anchor.count,
                    contribution_text(&anchor_contributions)
                )
            },
            evidence_refs_of(&input.anchor, &anchor_contributions),
        ),
        insight_row(
            "cross",
            cross.subscore,
            &input.cross.source,
            if cross.subscore.is_none() {
                "Cross-domain fit was not measured. No affinity was invented.".to_string()
            } else {
                let labels = if cross.labels.is_empty() {
                    String::new()
                } else {
                    format!(" ({})", cross.labels.join(", "))
                };
                format!(
                    "Cross-domain fit is the mean of {} entity types{} scaled by coverage {}. {}",
                    cross.domains,
                    labels,
                    js_to_fixed(cross.coverage, 2),
                    contribution_text(&cross_contributions)
                )
            },
            evidence_refs_of(&input.cross, &cross_contributions),
        ),
        insight_row(
            "local",
            local.subscore,
            &input.local.source,
            if local.subscore.is_none() {
                "Local fit was not measured. No affinity was invented.".to_string()
            } else {
                format!(
                    "Local fit is the mean of {} place results for the brief city. {}",
                    local.count,
                    contribution_text(&local_contributions)
                )
            },
            evidence_refs_of(&input.local, &local_contributions),
        ),
        insight_row(
            "audience",
            audience.subscore,
            &input.audience.source,
            if audience.subscore.is_none() {
                "Audience fit was not measured. No affinity was invented.".to_string()
            } else {
                format!(
                    "Audience fit is the mean of {} demographic affinities. {}",
                    audience.count,
                    contribution_text(&audience_contributions)
                )
            },
            evidence_refs_of(&input.audience, &audience_contributions),
        ),
        insight_row(
            "friction",
            friction,
            &input.anchor.source,
            if friction.is_none() {
                "Friction was not measured. It is the gap between anchor and audience, and one of those was missing.".to_string()
            } else {
                format!(
                    "Friction is the gap between anchor subscore {} and audience subscore {}. {}",
                    anchor.subscore.unwrap_or(0),
                    audience.subscore.unwrap_or(0),
                    contribution_text(&friction_contributions)
                )
            },
            evidence_refs_of(&friction_input, &friction_contributions),
        ),
    ];

    let present: Vec<i64> = rows.iter().filter_map(|row| row.points).collect();
    let gaps: Vec<String> = rows.iter().filter(|row| row.points.is_none()).map(|row| row.id.clone()).collect();
    let strength = if gaps.is_empty() {
        crate::score::evidence_key(input.active_ref_count).to_string()
    } else {
        "LIMITED".to_string()
    };
    InsightScore {
        ledger: ScoreLedger {
            total: if present.is_empty() { None } else { Some(present.iter().sum()) },
            rows,
        },
        evidence_strength: strength,
        gaps,
        subscores,
    }
}

struct Mean {
    subscore: Option<i64>,
    count: usize,
}

struct CrossMean {
    subscore: Option<i64>,
    domains: usize,
    coverage: f64,
    labels: Vec<String>,
}

fn unit(value: Option<f64>) -> Option<f64> {
    let value = value?;
    if !value.is_finite() || value < 0.0 || value > 1.0 {
        None
    } else {
        Some(value)
    }
}

fn units_of(group: &MeasuredGroup) -> Vec<f64> {
    group.rows.iter().filter_map(|row| unit(row.affinity)).collect()
}

fn mean_subscore(input: &DimensionInput) -> Mean {
    let values: Vec<f64> = input.groups.iter().flat_map(units_of).collect();
    if values.is_empty() {
        return Mean { subscore: None, count: 0 };
    }
    Mean {
        subscore: Some(clamp100(avg(&values) * 100.0)),
        count: values.len(),
    }
}

fn cross_subscore(input: &DimensionInput) -> CrossMean {
    let mut means = Vec::new();
    let mut labels = Vec::new();
    for group in &input.groups {
        let values = units_of(group);
        if values.is_empty() {
            continue;
        }
        means.push(avg(&values));
        if let Some(label) = group.label.as_ref().filter(|label| !label.is_empty()) {
            labels.push(label.clone());
        }
    }
    if means.is_empty() {
        return CrossMean {
            subscore: None,
            domains: 0,
            coverage: 0.0,
            labels,
        };
    }
    let coverage = (means.len() as f64 / 3.0).min(1.0);
    CrossMean {
        subscore: Some(clamp100(avg(&means) * coverage * 100.0)),
        domains: means.len(),
        coverage,
        labels,
    }
}

fn contributions_of(input: &DimensionInput) -> Vec<ExplainabilityContribution> {
    let mut seen = std::collections::HashSet::new();
    let mut rows = Vec::new();
    for group in &input.groups {
        for row in &group.rows {
            for contribution in &row.contributions {
                if !(0.0..=1.0).contains(&contribution.weight) {
                    continue;
                }
                let key = format!("{}\n{}\n{}", contribution.input, contribution.target, js_number(contribution.weight));
                if !seen.insert(key) {
                    continue;
                }
                rows.push(contribution.clone());
            }
        }
    }
    rows.sort_by(|a, b| {
        b.weight
            .partial_cmp(&a.weight)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.input.cmp(&b.input))
            .then_with(|| a.target.cmp(&b.target))
    });
    rows
}

fn evidence_refs_of(input: &DimensionInput, contributions: &[ExplainabilityContribution]) -> Vec<String> {
    let mut ids = Vec::new();
    for group in &input.groups {
        for row in &group.rows {
            ids.extend(row.evidence_refs.iter().cloned());
        }
    }
    for contribution in contributions {
        ids.push(contribution.input.clone());
        ids.push(contribution.target.clone());
    }
    let mut unique = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for id in ids {
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        unique.push(id);
    }
    unique.sort();
    unique
}

fn contribution_text(contributions: &[ExplainabilityContribution]) -> String {
    if contributions.is_empty() {
        return "Explainability returned no contributions.".to_string();
    }
    let parts: Vec<String> = contributions
        .iter()
        .take(6)
        .map(|row| format!("{} {} \u{2192} {}", row.input, js_to_fixed(row.weight, 2), row.target))
        .collect();
    format!("Contributions: {}.", parts.join("; "))
}

fn insight_row(id: &str, subscore: Option<i64>, source: &str, detail: String, evidence_refs: Vec<String>) -> LedgerRow {
    LedgerRow {
        id: id.to_string(),
        subscore,
        weight: row_weight(id),
        points: points_for(id, subscore),
        provenance: Provenance {
            source: source.to_string(),
            detail,
            evidence_refs,
        },
    }
}

/// JavaScript `String(number)` for the dedupe key. Enough for the authored weights.
fn js_number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        let raw = format!("{n}");
        raw
    }
}
