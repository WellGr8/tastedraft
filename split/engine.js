// Deterministic fit engine.
// Weights are config (the backend owns them); the LLM never sets a number.
// Points are rounded per row so the ledger sums to the total.
const WEIGHTS = { anchor: 30, cross: 25, local: 20, audience: 25 };
const FRICTION_FACTOR = 0.4;

// The sample evidence provider is calibrated so the default brief still
// produces these sub-scores. They are the contract, not the live input.
const SUBS1 = { anchor: 80, cross: 80, local: 74, audience: 68, friction: 12 };
const SUBS2 = { anchor: 80, cross: 80, local: 90, audience: 88, friction: 6 };

function clamp100(n) {
  n = Math.round(n);
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function avg(xs) {
  if (!xs.length) return 0;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

// packet is what an evidence provider returns. A Qloo provider can replace
// the sample one later; this function only reads affinities.
//   refs[].affinity          0–100 concept affinity of each active reference
//   domains[].affinity       0–100 mean affinity of one cultural domain
//   local.base / .penalty    indie-district fit, before and after conflict drag
//   audience.base / .penalty age×city fit, before and after price drag
//   friction                 0–100 conflict gap (not yet weighted)
function deriveSubs(packet) {
  const refs = (packet && packet.refs) || [];
  const domains = (packet && packet.domains) || [];
  const anchor = refs.length ? clamp100(avg(refs.map((r) => r.affinity))) : 42;
  let cross = 36;
  if (domains.length) {
    // Coverage reaches full weight at 3 domains. Fewer domains scale the mean down.
    // crossAdjust is an evidence gap (for example, an electronic concept with no
    // artist reference). It is 0 for the calibrated default brief.
    const coverage = Math.min(1, domains.length / 3);
    cross = clamp100(avg(domains.map((d) => d.affinity)) * coverage + (packet.crossAdjust || 0));
  }
  const localIn = (packet && packet.local) || {};
  const audIn = (packet && packet.audience) || {};
  const local = clamp100((localIn.base || 0) - (localIn.penalty || 0));
  const audience = clamp100((audIn.base || 0) - (audIn.penalty || 0));
  const friction = clamp100((packet && packet.friction) || 0);
  return { anchor: anchor, cross: cross, local: local, audience: audience, friction: friction };
}

function ledgerPoints(subs) {
  const p = {
    anchor: Math.round(subs.anchor * WEIGHTS.anchor / 100),
    cross: Math.round(subs.cross * WEIGHTS.cross / 100),
    local: Math.round(subs.local * WEIGHTS.local / 100),
    audience: Math.round(subs.audience * WEIGHTS.audience / 100),
    friction: -Math.round(subs.friction * FRICTION_FACTOR)
  };
  p.total = p.anchor + p.cross + p.local + p.audience + p.friction;
  return p;
}

// Evidence strength is the count of active, non-muted references.
// LIMITED scores display rounded to the nearest 5; the ledger keeps the exact sum.
function evidenceKey(activeRefCount) {
  if (activeRefCount >= 4) return 'HIGH';
  if (activeRefCount >= 2) return 'MEDIUM';
  return 'LIMITED';
}

function displayScore(total, activeRefCount) {
  const limited = evidenceKey(activeRefCount) === 'LIMITED';
  if (!limited) return { text: String(total), why: 'Why ' + total + '?', limited: false, approx: total };
  const approx = Math.round(total / 5) * 5;
  return { text: '\u2248 ' + approx, why: 'Why \u2248 ' + approx + '?', limited: true, approx: approx };
}
