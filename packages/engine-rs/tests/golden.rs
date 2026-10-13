use tastedraft_engine::{
    bangkok_brief, berlin_brief, default_brief_v2, default_sample_brief, derive_subs, engine_constants_json,
    ledger_points, provide_evidence, rescore_param_diffs, rescore_param_diffs_json, score_mock_brief,
    score_mock_brief_json, score_sample_brief, score_sample_brief_json, tokyo_brief, QlooParamDiff, FRICTION_FACTOR,
    WEIGHTS_ANCHOR, WEIGHTS_AUDIENCE, WEIGHTS_CROSS, WEIGHTS_LOCAL,
};

#[test]
fn weights_and_default_brief_are_the_calibrated_71() {
    assert_eq!(
        (WEIGHTS_ANCHOR, WEIGHTS_CROSS, WEIGHTS_LOCAL, WEIGHTS_AUDIENCE, FRICTION_FACTOR),
        (30, 25, 20, 25, 0.4)
    );
    let scored = score_sample_brief(&default_sample_brief()).unwrap();
    assert_eq!(
        (scored.subscores.anchor, scored.subscores.cross, scored.subscores.local, scored.subscores.audience, scored.subscores.friction),
        (80, 80, 74, 68, 12)
    );
    assert_eq!(
        (scored.points.anchor, scored.points.cross, scored.points.local, scored.points.audience, scored.points.friction, scored.points.total),
        (24, 20, 15, 17, -5, 71)
    );
    assert_eq!(
        scored.points.anchor + scored.points.cross + scored.points.local + scored.points.audience + scored.points.friction,
        scored.points.total
    );
    assert_eq!(scored.evidence_strength, "HIGH");
    assert_eq!(scored.display.text, "71");
    let again = ledger_points(derive_subs(Some(&provide_evidence(&default_sample_brief()))).unwrap());
    assert_eq!(again.total, 71);
}

#[test]
fn accessible_posture_still_scores_82() {
    let mut brief = default_sample_brief();
    brief.applied = true;
    let scored = score_sample_brief(&brief).unwrap();
    assert_eq!(scored.points.total, 82);
    assert_eq!(
        (scored.points.anchor, scored.points.cross, scored.points.local, scored.points.audience, scored.points.friction),
        (24, 20, 18, 22, -2)
    );
}

#[test]
fn agent_price_diff_rescores_to_80() {
    let changes = vec![QlooParamDiff {
        param: "filter.price_level.max".to_string(),
        from: Some("3".to_string()),
        to: Some("2".to_string()),
    }];
    let scored = rescore_param_diffs(&default_brief_v2(), &changes).unwrap();
    assert_eq!(scored.baseline, 71);
    assert_eq!(scored.total, 80);
    assert_eq!(scored.predicted_delta, 9);
    assert_eq!(
        (scored.points.anchor, scored.points.cross, scored.points.local, scored.points.audience, scored.points.friction),
        (24, 20, 17, 22, -3)
    );
}

#[test]
fn mock_briefs_score_bangkok_tokyo_berlin() {
    let bangkok = score_mock_brief(&bangkok_brief());
    let tokyo = score_mock_brief(&tokyo_brief());
    let berlin = score_mock_brief(&berlin_brief());
    assert_eq!(
        (
            bangkok.subscores.anchor,
            bangkok.subscores.cross,
            bangkok.subscores.local,
            bangkok.subscores.audience,
            bangkok.subscores.friction
        ),
        (Some(81), Some(50), Some(91), Some(70), Some(11))
    );
    assert_eq!(
        (
            tokyo.subscores.anchor,
            tokyo.subscores.cross,
            tokyo.subscores.local,
            tokyo.subscores.audience,
            tokyo.subscores.friction
        ),
        (Some(76), Some(49), Some(70), Some(72), Some(4))
    );
    assert_eq!(
        (
            berlin.subscores.anchor,
            berlin.subscores.cross,
            berlin.subscores.local,
            berlin.subscores.audience,
            berlin.subscores.friction
        ),
        (Some(62), Some(37), Some(44), Some(38), Some(24))
    );
    assert_eq!(
        (bangkok.ledger.total, tokyo.ledger.total, berlin.ledger.total),
        (Some(69), Some(65), Some(37))
    );
    assert_eq!(bangkok.evidence_strength, "MEDIUM");
    assert!(bangkok.gaps.is_empty());
    assert!(bangkok.ledger.rows[0].provenance.detail.contains("td-mock-tag-night-market 0.62"));
}

#[test]
fn null_measurement_stays_a_gap() {
    let input = serde_json::json!({
        "anchor": { "source": "mock:/v2/insights", "groups": [{ "rows": [{ "affinity": null, "contributions": [], "evidenceRefs": ["target-0"] }] }] },
        "cross": { "source": "mock:/v2/insights", "groups": [] },
        "local": { "source": "mock:/v2/insights", "groups": [] },
        "audience": { "source": "mock:/v2/insights", "groups": [{ "rows": [{ "affinity": 0.5, "contributions": [], "evidenceRefs": ["target-0"] }] }] },
        "activeRefCount": 4
    });
    let scored = tastedraft_engine::score_insight_measurements(&serde_json::from_value(input).unwrap());
    assert_eq!(scored.subscores.anchor, None);
    assert_eq!(scored.subscores.audience, Some(50));
    assert_eq!(scored.subscores.friction, None);
    assert_eq!(scored.ledger.total, Some(13));
    assert_eq!(scored.evidence_strength, "LIMITED");
    assert_eq!(scored.gaps, vec!["anchor", "cross", "local", "friction"]);
    assert_ne!(scored.subscores.anchor, Some(42));
    assert_ne!(scored.subscores.cross, Some(36));
}

#[test]
fn json_boundary_matches_the_typed_scores() {
    let constants: serde_json::Value = serde_json::from_str(&engine_constants_json()).unwrap();
    assert_eq!(constants["weights"]["anchor"], 30);
    assert_eq!(constants["frictionFactor"].as_f64(), Some(0.4));
    let brief = serde_json::to_string(&default_sample_brief()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&score_sample_brief_json(&brief).unwrap()).unwrap();
    assert_eq!(parsed["points"]["total"], 71);
    let v2 = serde_json::to_string(&default_brief_v2()).unwrap();
    let changes = r#"[{"param":"filter.price_level.max","from":"3","to":"2"}]"#;
    let rescored: serde_json::Value = serde_json::from_str(&rescore_param_diffs_json(&v2, changes).unwrap()).unwrap();
    assert_eq!(rescored["total"], 80);
    assert_eq!(rescored["predictedDelta"], 9);
    let bangkok = serde_json::to_string(&bangkok_brief()).unwrap();
    let mock: serde_json::Value = serde_json::from_str(&score_mock_brief_json(&bangkok).unwrap()).unwrap();
    assert_eq!(mock["ledger"]["total"], 69);
}

#[test]
fn limited_display_rounds_to_nearest_five() {
    let shown = tastedraft_engine::display_score(71, 1);
    assert!(shown.limited);
    assert_eq!(shown.approx, 70);
    assert_eq!(shown.text, "\u{2248} 70");
    assert_eq!(shown.why, "Why \u{2248} 70?");
}
