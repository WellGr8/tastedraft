use crate::agent::{rescore_param_diffs, score_sample_brief};
use crate::insights::score_insight_measurements;
use crate::mock::score_mock_brief;
use crate::score::{derive_subs, display_score, evidence_key, ledger_points, score_packet, weights_json};
use crate::types::{BriefV2, EvidencePacket, InsightScoreInput, QlooParamDiff, SampleBrief, Subscores};

fn to_json<T: serde::Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|err| err.to_string())
}

fn from_json<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, String> {
    serde_json::from_str(json).map_err(|err| err.to_string())
}

pub fn derive_subs_json(packet_json: &str) -> Result<String, String> {
    let packet = if packet_json.trim() == "null" {
        None
    } else {
        Some(from_json::<EvidencePacket>(packet_json)?)
    };
    to_json(&derive_subs(packet.as_ref())?)
}

pub fn ledger_points_json(subs_json: &str) -> Result<String, String> {
    let subs = from_json::<Subscores>(subs_json)?;
    to_json(&ledger_points(subs))
}

pub fn display_score_json(total: f64, active_ref_count: u32) -> String {
    let total = crate::round::js_round(total);
    serde_json::to_string(&display_score(total, active_ref_count)).unwrap_or_else(|_| "{}".to_string())
}

pub fn evidence_strength_json(active_ref_count: u32) -> String {
    evidence_key(active_ref_count).to_string()
}

pub fn score_packet_json(packet_json: &str) -> Result<String, String> {
    let packet = from_json::<EvidencePacket>(packet_json)?;
    to_json(&score_packet(&packet)?)
}

pub fn score_insights_json(input_json: &str) -> Result<String, String> {
    let input = from_json::<InsightScoreInput>(input_json)?;
    to_json(&score_insight_measurements(&input))
}

pub fn score_sample_brief_json(brief_json: &str) -> Result<String, String> {
    let brief = from_json::<SampleBrief>(brief_json)?;
    to_json(&score_sample_brief(&brief)?)
}

pub fn rescore_param_diffs_json(brief_json: &str, changes_json: &str) -> Result<String, String> {
    let brief = from_json::<BriefV2>(brief_json)?;
    let changes = from_json::<Vec<QlooParamDiff>>(changes_json)?;
    to_json(&rescore_param_diffs(&brief, &changes)?)
}

pub fn score_mock_brief_json(brief_json: &str) -> Result<String, String> {
    let brief = from_json::<BriefV2>(brief_json)?;
    to_json(&score_mock_brief(&brief))
}

pub fn engine_constants_json() -> String {
    weights_json().to_string()
}
