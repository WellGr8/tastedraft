// Local brief → the same result shape the API returns.
// The screen renders this shape. It does not keep a streetwear script.

function emptyResult() {
  return {
    score: 0,
    ledger: { anchor: 0, cross: 0, local: 0, audience: 0, friction: 0 },
    evidenceStrength: 'LIMITED',
    ambiguous: false,
    inferred: [],
    signals: [],
    districts: { min: [], lux: [] },
    fits: [],
    frictions: [],
    proposals: [],
    provider: 'sample',
    status: 'ready',
    unresolved: [],
    recommendationId: '',
    activeCount: 0,
    inferenceText: '',
    mapCaption: '',
    mixed: false,
    simulationId: '',
    version: null
  };
}

function districtsFor(city) {
  const row = CITIES[city] || CITIES['Los Angeles'];
  return { min: row[0].slice(), lux: row[1].slice() };
}

function levelWord(n) {
  n = Number(n) || 0;
  if (n >= 75) return 'Strong';
  if (n >= 55) return 'Moderate';
  return 'Limited';
}

function meanFacet(refs, id) {
  if (!refs.length) return 0;
  let s = 0;
  for (let i = 0; i < refs.length; i++) {
    const facets = refs[i].facets || {};
    const v = facets[id];
    s += v == null ? 0 : v;
  }
  return s / refs.length;
}

function namesWhere(refs, pred) {
  const out = [];
  for (let i = 0; i < refs.length; i++) if (pred(refs[i])) out.push(refs[i].name);
  return out;
}

function joinAnd(list) {
  if (!list || !list.length) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return list[0] + ' และ ' + list[1];
  return list.slice(0, -1).join(', ') + ' และ ' + list[list.length - 1];
}

const FACET_FIT = {
  japanese: 'Japanese references',
  minimal: 'Minimal aesthetic',
  streetwear: 'Streetwear',
  electronic: 'Electronic identity'
};

function fitsFrom(packet, brief) {
  const refs = packet.refs || [];
  const facets = packet.facets || [];
  const fits = [];
  for (let i = 0; i < facets.length; i++) {
    const id = facets[i];
    if (!refs.length || meanFacet(refs, id) < 55) continue;
    fits.push({ text: FACET_FIT[id] || id, isNew: false });
  }
  if (brief.applied) {
    fits.push({ text: 'Accessible premium', isNew: true });
    if ((packet.scarcity || '') === 'preorder') fits.push({ text: 'Independent pre-order drops', isNew: true });
  }
  return fits;
}

function frictionsFrom(packet, brief, subs, districts) {
  const copy = sourceCopy(packet.sourceId);
  const age = brief.age;
  const city = brief.city;
  const min = joinAnd(districts.min);
  const lux = joinAnd(districts.lux);
  const out = [];
  if (!brief.applied) {
    const pos = brief.pos || 'Premium';
    const priceGap = pos === 'Premium' || pos === 'Luxury' || hasPremiumLanguage(brief.idea || '');
    if (priceGap) {
      out.push({
        text: pos + ' pricing signals',
        why: copy.found + 'กลุ่มวัย ' + age + ' ใน ' + city + ' เข้ากับย่าน ' + min + ' มากกว่าท่าทีราคาแบบ ' + pos
      });
    }
    if ((packet.scarcity || '') === 'limited') {
      out.push({
        text: 'Limited-run exclusivity',
        why: 'ความขาดแคลนแบบนี้กระจุกที่ ' + lux + ' ไม่ใช่ ' + min + ' ที่ idea นี้เข้ากันที่สุด'
      });
    }
    if (!out.length && subs.friction >= 8) {
      out.push({
        text: 'Cultural friction',
        why: copy.found + 'ช่องว่างทางวัฒนธรรมของแนวนี้ใน ' + city + ' อยู่ที่ ' + subs.friction
      });
    }
  } else if (subs.friction > 0) {
    out.push({
      text: 'Pricing signals',
      why: 'หลังปรับท่าทีราคาแล้ว แรงเสียดทานที่เหลือกับกลุ่มวัย ' + age + ' ใน ' + city + ' อยู่ที่ ' + subs.friction
    });
  }
  return out;
}

function proposalsFrom(packet, brief, districts) {
  if (brief.applied || brief.posture === 'accessible') return [];
  const copy = sourceCopy(packet.sourceId);
  const age = brief.age;
  const city = brief.city;
  const min = joinAnd(districts.min);
  const pos = brief.pos || 'Premium';
  const priceGap = pos === 'Premium' || pos === 'Luxury' || hasPremiumLanguage(brief.idea || '');
  if (!priceGap) return [];
  const price = {
    id: 'price-level',
    before: 'Price level 3',
    after: 'Price level 2',
    why: 'The price evidence conflicts with this audience, so the Qloo price filter should move to the level that evidence can support.',
    evidence: copy.points + 'กลุ่มวัย ' + age + ' ใน ' + city + ' เข้ากับ ' + min,
    predictedDelta: 9,
    param: 'filter.price_level.max',
    from: '3',
    to: '2'
  };
  const idea = brief.idea || '';
  const isDemo = idea.indexOf('Japanese minimalist streetwear') === 0 && city === 'Los Angeles' && age === '18–25' && pos === 'Premium';
  if (!isDemo) {
    price.before = pos + ' pricing';
    return [price];
  }
  return [
    price,
    {
      id: 'positioning',
      before: 'Positioning Premium',
      after: 'Positioning Independent',
      why: 'Premium positioning sits away from the indie place in the evidence.',
      evidence: 'friction.positioning',
      predictedDelta: 5,
      param: 'signal.interests.tags',
      from: 'premium',
      to: 'independent'
    },
    {
      id: 'audience-age',
      before: 'Age 18–25',
      after: 'Age 26–35',
      why: 'This age band is the weak fit for the current price.',
      evidence: 'audience.age',
      predictedDelta: 3,
      param: 'signal.demographics.age',
      from: '24_and_younger',
      to: '30_to_34'
    }
  ];
}

function signalsFrom(packet, subs, districts) {
  const refs = packet.refs || [];
  const facets = packet.facets || [];
  const signal = packet.signal || {};
  let fashionName = 'Fashion affinity';
  if (facets.indexOf('streetwear') >= 0 && meanFacet(refs, 'streetwear') >= meanFacet(refs, 'japanese')) fashionName = 'Streetwear';
  else if (facets.indexOf('japanese') >= 0 || facets.indexOf('streetwear') >= 0) {
    fashionName = facets.indexOf('japanese') >= 0 && meanFacet(refs, 'japanese') >= meanFacet(refs, 'streetwear') ? 'Japanese fashion' : 'Streetwear';
  }
  const musicName = facets.indexOf('electronic') >= 0 ? 'Electronic' : 'Music affinity';
  const designName = facets.indexOf('minimal') >= 0 ? 'Minimal aesthetic' : 'Design affinity';
  const place = joinAnd(districts.min) || 'Local districts';
  const brands = namesWhere(refs, function (r) { return r.type === 'Brand'; });
  const artists = namesWhere(refs, function (r) { return r.type === 'Artist'; });
  const places = namesWhere(refs, function (r) { return r.type === 'Place'; });
  const all = namesWhere(refs, function () { return true; });
  return [
    { domain: 'Fashion', name: fashionName, level: levelWord(signal.fashion), feeds: 'Anchor affinity', sources: brands.length ? brands : all },
    { domain: 'Music', name: musicName, level: levelWord(signal.music), feeds: 'Cross-domain fit', sources: artists.length ? artists : all },
    { domain: 'Design', name: designName, level: levelWord(signal.design), feeds: 'Anchor affinity', sources: all },
    { domain: 'Location', name: place, level: levelWord(subs.local), feeds: 'Local fit', sources: places }
  ];
}

function rankWord(level) {
  const v = String(level || '').toLowerCase();
  if (v === 'strong' || v === 'high') return 3;
  if (v === 'moderate' || v === 'medium') return 2;
  return 1;
}

function proseFrom(brief, fits, districts, signals) {
  const age = brief.age;
  const city = brief.city;
  const labels = [];
  for (let i = 0; i < fits.length; i++) if (!fits[i].isNew) labels.push(fits[i].text);
  let inference;
  if (labels.length) inference = 'คนวัย ' + age + ' ใน ' + city + ' ที่ตอบรับแนวนี้สอดคล้องกับ ' + joinAnd(labels);
  else inference = 'คนวัย ' + age + ' ใน ' + city + ' ยังไม่มีแนวที่ references ชุดนี้รองรับ idea อย่างชัดเจน';
  if (signals.length) {
    let top = signals[0];
    for (let i = 1; i < signals.length; i++) if (rankWord(signals[i].level) > rankWord(top.level)) top = signals[i];
    inference += ' สัญญาณที่อ่านได้ชัดที่สุดตอนนี้คือ ' + top.name;
  }
  const min = districts.min || [];
  const lux = districts.lux || [];
  let map = 'สัญญาณแนวที่เข้ากับ idea หนาที่สุดใน ' + (joinAnd(min) || city);
  if (lux.length) map += ' ขณะที่อีกขั้วกระจุกอยู่ที่ ' + joinAnd(lux);
  return { inferenceText: inference, mapCaption: map };
}

function buildLocalResult(brief) {
  const safe = brief || {};
  const packet = provideEvidence(safe);
  const subs = deriveSubs(packet);
  const points = ledgerPoints(subs);
  const districts = districtsFor(safe.city);
  const signals = signalsFrom(packet, subs, districts);
  const fits = fitsFrom(packet, safe);
  const frictions = frictionsFrom(packet, safe, subs, districts);
  const proposals = proposalsFrom(packet, safe, districts);
  const prose = proseFrom(safe, fits, districts, signals);
  const refs = packet.refs || [];
  const inferred = [];
  for (let i = 0; i < refs.length; i++) if (refs[i].provenance === 'inferred') inferred.push(refs[i].name);
  return {
    score: points.total,
    ledger: {
      anchor: points.anchor,
      cross: points.cross,
      local: points.local,
      audience: points.audience,
      friction: points.friction
    },
    evidenceStrength: evidenceKey(refs.length),
    ambiguous: packet.sourceId === 'inferred' || !!packet.mixed,
    inferred: inferred,
    signals: signals,
    districts: districts,
    fits: fits,
    frictions: frictions,
    proposals: proposals,
    provider: packet.sourceId,
    status: 'ready',
    unresolved: [],
    recommendationId: '',
    activeCount: refs.length,
    inferenceText: prose.inferenceText,
    mapCaption: prose.mapCaption,
    mixed: !!packet.mixed,
    simulationId: '',
    version: safe.applied ? 2 : 1
  };
}

function describeResult(brief, result) {
  const r = result || emptyResult();
  const districts = r.districts || { min: [], lux: [] };
  const fits = (r.fits || []).filter(function (f) { return f && f.text && String(f.text).indexOf('ยังไม่พบ') !== 0; });
  const signals = r.signals || [];
  if (r.inferenceText && r.mapCaption) return { inferenceText: r.inferenceText, mapCaption: r.mapCaption };
  const prose = proseFrom(brief || {}, fits, districts, signals);
  return {
    inferenceText: r.inferenceText || prose.inferenceText,
    mapCaption: r.mapCaption || prose.mapCaption
  };
}
