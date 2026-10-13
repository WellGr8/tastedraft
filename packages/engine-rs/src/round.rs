/// JavaScript `Math.round`: halves go toward +∞.
pub fn js_round(n: f64) -> i64 {
    if !n.is_finite() {
        return 0;
    }
    let floor = n.floor();
    let mut out = floor as i64;
    if n - floor >= 0.5 {
        out += 1;
    }
    out
}

/// `Number#toFixed`, which for these magnitudes matches rounding the scaled value.
pub fn js_to_fixed(n: f64, digits: u32) -> String {
    if !n.is_finite() {
        return "NaN".to_string();
    }
    let neg = n.is_sign_negative() && n != 0.0;
    let factor = 10_f64.powi(digits as i32);
    let scaled = js_round(n.abs() * factor);
    let scale = 10_i64.pow(digits);
    let whole = scaled / scale;
    let frac = (scaled % scale).unsigned_abs();
    let body = if digits == 0 {
        whole.to_string()
    } else {
        format!("{whole}.{frac:0width$}", width = digits as usize)
    };
    if neg {
        format!("-{body}")
    } else {
        body
    }
}

pub fn clamp100(n: f64) -> i64 {
    let n = js_round(n);
    if n < 0 {
        0
    } else if n > 100 {
        100
    } else {
        n
    }
}

pub fn avg(xs: &[f64]) -> f64 {
    if xs.is_empty() {
        return 0.0;
    }
    let mut sum = 0.0;
    for value in xs {
        sum += *value;
    }
    sum / xs.len() as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_matches_javascript() {
        assert_eq!(js_round(0.5), 1);
        assert_eq!(js_round(12.5), 13);
        assert_eq!(js_round(-1.5), -1);
        assert_eq!(js_round(-0.5), 0);
        assert_eq!(js_round(-1.2), -1);
        assert_eq!(js_round(-1.7), -2);
    }

    #[test]
    fn to_fixed_matches_javascript() {
        assert_eq!(js_to_fixed(0.5, 2), "0.50");
        assert_eq!(js_to_fixed(0.62, 2), "0.62");
        assert_eq!(js_to_fixed(0.58, 2), "0.58");
        assert_eq!(js_to_fixed(2.0 / 3.0, 2), "0.67");
        assert_eq!(js_to_fixed(1.0, 2), "1.00");
    }
}
