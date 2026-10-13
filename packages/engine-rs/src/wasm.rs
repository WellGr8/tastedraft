use wasm_bindgen::prelude::*;

use crate::api;

fn ok(result: Result<String, String>) -> Result<String, JsValue> {
    result.map_err(|err| JsValue::from_str(&err))
}

#[wasm_bindgen(js_name = deriveSubs)]
pub fn derive_subs(packet_json: &str) -> Result<String, JsValue> {
    ok(api::derive_subs_json(packet_json))
}

#[wasm_bindgen(js_name = ledgerPoints)]
pub fn ledger_points(subs_json: &str) -> Result<String, JsValue> {
    ok(api::ledger_points_json(subs_json))
}

#[wasm_bindgen(js_name = displayScore)]
pub fn display_score(total: f64, active_ref_count: u32) -> String {
    api::display_score_json(total, active_ref_count)
}

#[wasm_bindgen(js_name = evidenceStrength)]
pub fn evidence_strength(active_ref_count: u32) -> String {
    api::evidence_strength_json(active_ref_count)
}

#[wasm_bindgen(js_name = scorePacket)]
pub fn score_packet(packet_json: &str) -> Result<String, JsValue> {
    ok(api::score_packet_json(packet_json))
}

#[wasm_bindgen(js_name = scoreInsights)]
pub fn score_insights(input_json: &str) -> Result<String, JsValue> {
    ok(api::score_insights_json(input_json))
}

#[wasm_bindgen(js_name = scoreSampleBrief)]
pub fn score_sample_brief(brief_json: &str) -> Result<String, JsValue> {
    ok(api::score_sample_brief_json(brief_json))
}

#[wasm_bindgen(js_name = rescoreParamDiffs)]
pub fn rescore_param_diffs(brief_json: &str, changes_json: &str) -> Result<String, JsValue> {
    ok(api::rescore_param_diffs_json(brief_json, changes_json))
}

#[wasm_bindgen(js_name = scoreMockBrief)]
pub fn score_mock_brief(brief_json: &str) -> Result<String, JsValue> {
    ok(api::score_mock_brief_json(brief_json))
}

#[wasm_bindgen(js_name = engineConstants)]
pub fn engine_constants() -> String {
    api::engine_constants_json()
}
