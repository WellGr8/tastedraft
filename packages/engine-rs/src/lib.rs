//! Deterministic TasteDraft scoring engine.
//!
//! The same functions run as native Rust tests and, behind `wasm32`, as JSON-in /
//! JSON-out exports for the browser and Node.

mod agent;
mod api;
mod insights;
mod ledger;
mod mock;
mod round;
mod sample;
mod score;
mod types;

#[cfg(target_arch = "wasm32")]
mod wasm;

pub use agent::{apply_diffs_to_engine, default_brief_v2, rescore_param_diffs, score_sample_brief};
pub use api::{
    derive_subs_json, display_score_json, engine_constants_json, evidence_strength_json, ledger_points_json,
    rescore_param_diffs_json, score_insights_json, score_mock_brief_json, score_packet_json, score_sample_brief_json,
};
pub use insights::score_insight_measurements;
pub use mock::{berlin_brief, bangkok_brief, score_mock_brief, tokyo_brief};
pub use sample::{default_sample_brief, provide_evidence, DEFAULT_IDEA};
pub use score::{derive_subs, display_score, evidence_key, ledger_points, measurements_missing, score_packet};
pub use types::*;
