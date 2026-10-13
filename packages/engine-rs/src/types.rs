use serde::{Deserialize, Serialize};

pub const WEIGHTS_ANCHOR: i64 = 30;
pub const WEIGHTS_CROSS: i64 = 25;
pub const WEIGHTS_LOCAL: i64 = 20;
pub const WEIGHTS_AUDIENCE: i64 = 25;
pub const FRICTION_FACTOR: f64 = 0.4;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EvidenceRef {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub fit: String,
    #[serde(default)]
    pub provenance: String,
    #[serde(default)]
    pub affinity: Option<f64>,
    #[serde(default)]
    pub minimal: Option<f64>,
    #[serde(default)]
    pub electronic: Option<f64>,
    #[serde(default)]
    pub streetwear: Option<f64>,
    #[serde(default)]
    pub city: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EvidenceDomain {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub affinity: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BasePenalty {
    #[serde(default)]
    pub base: Option<f64>,
    #[serde(default)]
    pub penalty: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SignalTriple {
    #[serde(default)]
    pub fashion: Option<f64>,
    #[serde(default)]
    pub music: Option<f64>,
    #[serde(default)]
    pub design: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvidencePacket {
    pub source_id: String,
    pub mixed: bool,
    #[serde(default)]
    pub facets: Vec<String>,
    #[serde(default)]
    pub refs: Vec<EvidenceRef>,
    #[serde(default)]
    pub domains: Vec<EvidenceDomain>,
    #[serde(default)]
    pub local: Option<BasePenalty>,
    #[serde(default)]
    pub audience: Option<BasePenalty>,
    #[serde(default)]
    pub friction: Option<f64>,
    #[serde(default)]
    pub signal: Option<SignalTriple>,
    #[serde(default)]
    pub cross_adjust: Option<f64>,
    #[serde(default)]
    pub posture: String,
    #[serde(default)]
    pub scarcity: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Subscores {
    pub anchor: i64,
    pub cross: i64,
    pub local: i64,
    pub audience: i64,
    pub friction: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct NullableSubs {
    pub anchor: Option<i64>,
    pub cross: Option<i64>,
    pub local: Option<i64>,
    pub audience: Option<i64>,
    pub friction: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct LedgerPoints {
    pub anchor: i64,
    pub cross: i64,
    pub local: i64,
    pub audience: i64,
    pub friction: i64,
    pub total: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct NullableLedger {
    pub anchor: Option<i64>,
    pub cross: Option<i64>,
    pub local: Option<i64>,
    pub audience: Option<i64>,
    pub friction: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DisplayScore {
    pub text: String,
    pub why: String,
    pub limited: bool,
    pub approx: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    pub source: String,
    pub detail: String,
    pub evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LedgerRow {
    pub id: String,
    pub subscore: Option<i64>,
    pub weight: f64,
    pub points: Option<i64>,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScoreLedger {
    pub rows: Vec<LedgerRow>,
    pub total: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScoredPacket {
    pub score: Option<i64>,
    pub subs: NullableSubs,
    pub ledger: NullableLedger,
    pub evidence_strength: String,
    pub gaps: Vec<String>,
    pub display: Option<DisplayScore>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExplainabilityContribution {
    pub input: String,
    pub weight: f64,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MeasuredAffinity {
    pub affinity: Option<f64>,
    #[serde(default)]
    pub contributions: Vec<ExplainabilityContribution>,
    #[serde(default)]
    pub evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MeasuredGroup {
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub rows: Vec<MeasuredAffinity>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DimensionInput {
    #[serde(default)]
    pub groups: Vec<MeasuredGroup>,
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InsightScoreInput {
    pub anchor: DimensionInput,
    pub cross: DimensionInput,
    pub local: DimensionInput,
    pub audience: DimensionInput,
    #[serde(default)]
    pub active_ref_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InsightScore {
    pub ledger: ScoreLedger,
    pub evidence_strength: String,
    pub gaps: Vec<String>,
    pub subscores: NullableSubs,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SampleBrief {
    #[serde(default)]
    pub idea: String,
    #[serde(default)]
    pub age: String,
    #[serde(default)]
    pub city: String,
    #[serde(default)]
    pub pos: String,
    #[serde(default)]
    pub refs: Vec<String>,
    #[serde(default)]
    pub applied: bool,
    #[serde(default)]
    pub posture: Option<String>,
    #[serde(default)]
    pub scarcity: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EntityRef {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TagRef {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
}

/// BriefV2 fields the engine reads. Extra contract fields are ignored.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BriefV2 {
    #[serde(default)]
    pub idea: String,
    #[serde(default)]
    pub interests: Vec<TagRef>,
    #[serde(default)]
    pub references: Vec<EntityRef>,
    #[serde(default)]
    pub locations: Vec<EntityRef>,
    #[serde(default)]
    pub city: String,
    #[serde(default)]
    pub age: String,
    #[serde(default)]
    pub gender: Option<String>,
    #[serde(default)]
    pub positioning: String,
    #[serde(default)]
    pub constraints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QlooParamDiff {
    pub param: String,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SampleScore {
    pub subscores: Subscores,
    pub points: LedgerPoints,
    pub ledger: ScoreLedger,
    pub evidence_strength: String,
    pub display: DisplayScore,
    pub packet: EvidencePacket,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rescore {
    pub baseline: i64,
    pub total: i64,
    pub predicted_delta: i64,
    pub subscores: Subscores,
    pub points: LedgerPoints,
    pub ledger: ScoreLedger,
}

pub fn present(value: Option<f64>) -> bool {
    value.is_some()
}

pub fn num_or_zero(value: Option<f64>) -> f64 {
    value.unwrap_or(0.0)
}
