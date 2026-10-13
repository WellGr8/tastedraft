//! Deterministic feature scores shared with `apps/api/src/engine/features.ts`.
//! Demographic mismatch, avoided test cost, and the re-interview flag.

pub const MIND_CHANGE_POINTS: i32 = 5;

const AGE_ORDER: [&str; 6] = [
    "24_and_younger",
    "25_to_29",
    "30_to_34",
    "35_to_44",
    "45_to_54",
    "55_and_older",
];

#[derive(Clone, Copy)]
pub struct SkewRow<'a> {
    pub dimension: &'a str,
    pub bucket: &'a str,
    pub value: f64,
}

fn clamp01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn age_index(bucket: &str) -> i32 {
    AGE_ORDER.iter().position(|item| *item == bucket).map(|index| index as i32).unwrap_or(-1)
}

pub fn demographic_mismatch(skew: &[SkewRow<'_>], target_age: Option<&str>, target_gender: Option<&str>) -> i32 {
    let mut peak_bucket: Option<&str> = None;
    let mut peak_value = 0.0;
    for row in skew.iter().filter(|row| row.dimension == "age") {
        let replace = match peak_bucket {
            None => true,
            Some(current) => {
                row.value > peak_value
                    || ((row.value - peak_value).abs() < f64::EPSILON && age_index(row.bucket) >= 0 && (age_index(current) < 0 || age_index(row.bucket) < age_index(current)))
            }
        };
        if replace {
            peak_bucket = Some(row.bucket);
            peak_value = row.value;
        }
    }
    let target_value = target_age.and_then(|age| {
        skew.iter().find(|row| row.dimension == "age" && row.bucket == age).map(|row| row.value)
    });
    let peak_index = peak_bucket.map(age_index).unwrap_or(-1);
    let target_index = target_age.map(age_index).unwrap_or(-1);
    let distance = if peak_index < 0 || target_index < 0 {
        1.0
    } else {
        (peak_index - target_index).abs() as f64 / (AGE_ORDER.len() as f64 - 1.0)
    };
    let skew_penalty = target_value.map(|value| clamp01((1.0 - value) / 2.0)).unwrap_or(1.0);
    let age_part = 0.55 * distance + 0.45 * skew_penalty;
    let combined = if let Some(gender) = target_gender {
        let gender_penalty = skew
            .iter()
            .find(|row| row.dimension == "gender" && row.bucket == gender)
            .map(|row| clamp01((1.0 - row.value) / 2.0))
            .unwrap_or(1.0);
        0.75 * age_part + 0.25 * gender_penalty
    } else {
        age_part
    };
    (clamp01(combined) * 100.0).round() as i32
}

pub fn estimate_avoided_cost(pilot: Option<f64>, focus_group: Option<f64>, sample_size: i32, rounds: i32) -> (f64, f64) {
    let pilot_cost = pilot.unwrap_or(0.0);
    let focus = focus_group.unwrap_or(0.0) * sample_size as f64;
    let per_round_cents = ((pilot_cost + focus) * 100.0).round() as i64;
    let avoided_cents = per_round_cents * rounds as i64;
    (per_round_cents as f64 / 100.0, avoided_cents as f64 / 100.0)
}

pub fn persona_mind_change(before: Option<i32>, after: Option<i32>) -> (Option<i32>, bool) {
    match (before, after) {
        (Some(left), Some(right)) => {
            let delta = right - left;
            (Some(delta), delta.abs() >= MIND_CHANGE_POINTS)
        }
        _ => (None, false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mismatch_matches_the_typescript_fixture() {
        let skew = [
            SkewRow { dimension: "age", bucket: "24_and_younger", value: 0.4 },
            SkewRow { dimension: "age", bucket: "25_to_29", value: 0.38 },
            SkewRow { dimension: "age", bucket: "30_to_34", value: 0.31 },
            SkewRow { dimension: "age", bucket: "35_to_44", value: -0.68 },
            SkewRow { dimension: "age", bucket: "45_to_54", value: -0.45 },
            SkewRow { dimension: "age", bucket: "55_and_older", value: -0.51 },
            SkewRow { dimension: "gender", bucket: "female", value: 0.2 },
            SkewRow { dimension: "gender", bucket: "male", value: -0.2 },
        ];
        assert_eq!(demographic_mismatch(&skew, Some("35_to_44"), Some("female")), 63);
        assert_eq!(demographic_mismatch(&skew, Some("35_to_44"), None), 71);
    }

    #[test]
    fn avoided_cost_adds_pilot_and_focus_group() {
        let (per_round, avoided) = estimate_avoided_cost(Some(8000.0), Some(150.0), 12, 2);
        assert_eq!(per_round, 9800.0);
        assert_eq!(avoided, 19600.0);
    }

    #[test]
    fn five_points_changes_a_mind() {
        assert_eq!(persona_mind_change(Some(40), Some(44)), (Some(4), false));
        assert_eq!(persona_mind_change(Some(40), Some(45)), (Some(5), true));
    }

    #[test]
    fn videogame_urn_is_not_video_game() {
        assert_eq!(crate::mock::entity_urn_for_test("video_game").as_deref(), Some("urn:entity:videogame"));
        assert_eq!(crate::mock::entity_urn_for_test("urn:entity:video_game").as_deref(), Some("urn:entity:videogame"));
    }
}
