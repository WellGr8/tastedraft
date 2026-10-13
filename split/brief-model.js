// Pure helpers for the input screen: type disambiguation, city bias, spellcheck.
// Kept in step with server/src/providers/qloo/search.ts ranking rules.

var TD_DICT = [
  'streetwear', 'minimalist', 'japanese', 'electronic', 'underground', 'premium',
  'limited', 'independent', 'luxury', 'identity', 'fashion', 'audience', 'cultural',
  'exclusive', 'accessible', 'brand', 'artist', 'concept', 'music', 'design',
  'minimal', 'resonance', 'campaign', 'product', 'preorder'
];

var TD_STOP = {
  with: 1, an: 1, a: 1, the: 1, at: 1, in: 1, on: 1, of: 1, and: 1, or: 1,
  sold: 1, price: 1, runs: 1, for: 1, to: 1, from: 1, this: 1, that: 1,
  your: 1, you: 1, are: 1, is: 1, it: 1, be: 1, as: 1, by: 1, into: 1
};

var TD_IMG = {
  comme: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Comme_des_Garcons_logo.svg/500px-Comme_des_Garcons_logo.svg.png',
  muji: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/MUJI_logo.svg/500px-MUJI_logo.svg.png',
  aphex: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Aphex_Twin%2C_2008.jpg/500px-Aphex_Twin%2C_2008.jpg',
  lost: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/New_York_Bar_Unplugged%2C_Park_Hyatt_Tokyo_%288376387540%29.jpg/500px-New_York_Bar_Unplugged%2C_Park_Hyatt_Tokyo_%288376387540%29.jpg',
  silver: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Know_Your_City_No.101_Silver_Lake_Reservoir.jpg/500px-Know_Your_City_No.101_Silver_Lake_Reservoir.jpg'
};

var TD_CITY_PLACES = {
  'Los Angeles': ['Silver Lake', 'Echo Park', 'Beverly Hills', 'West Hollywood'],
  'New York': ['Lower East Side', 'Williamsburg', 'Upper East Side', 'Tribeca'],
  'San Francisco': ['Mission', 'Hayes Valley', 'Pacific Heights', 'Union Square'],
  'Austin': ['East Austin', 'South Congress', 'Westlake', 'The Domain'],
  'Miami': ['Wynwood', 'Little Haiti', 'South Beach', 'Brickell'],
  'Chicago': ['Logan Square', 'Wicker Park', 'Gold Coast', 'River North'],
  'Seattle': ['Capitol Hill', 'Fremont', 'Medina', 'Bellevue']
};

var TD_TAGS = [
  { id: 'td-mock-tag-paper-cut', name: 'paper-cut minimal', type: 'urn:tag:td-mock' },
  { id: 'td-mock-tag-night-grid', name: 'night-grid electronic', type: 'urn:tag:td-mock' },
  { id: 'td-local-streetwear', name: 'streetwear', type: 'urn:tag:genre:fashion' },
  { id: 'td-local-japanese', name: 'japanese fashion', type: 'urn:tag:genre:fashion' },
  { id: 'td-local-electronic', name: 'electronic', type: 'urn:tag:genre:music' },
  { id: 'td-local-minimal', name: 'minimalist', type: 'urn:tag:style' },
  { id: 'td-local-underground', name: 'underground', type: 'urn:tag:style' }
];

function tdNorm(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tdSlug(value) {
  return tdNorm(value).replace(/\s+/g, '-');
}

function tdCanonicalType(type) {
  var lower = String(type || '').trim().toLowerCase();
  if (!lower) return '';
  if (lower.indexOf('urn:') === 0) {
    if (lower.indexOf(':movie') >= 0 || lower.indexOf(':film') >= 0) return 'urn:entity:movie';
    if (lower.indexOf(':brand') >= 0) return 'urn:entity:brand';
    if (lower.indexOf(':artist') >= 0) return 'urn:entity:artist';
    if (lower.indexOf(':place') >= 0 || lower.indexOf(':destination') >= 0 || lower.indexOf(':locality') >= 0) return 'urn:entity:place';
    if (lower.indexOf(':person') >= 0) return 'urn:entity:person';
    return lower;
  }
  if (lower === 'brand') return 'urn:entity:brand';
  if (lower === 'artist') return 'urn:entity:artist';
  if (lower === 'film' || lower === 'movie') return 'urn:entity:movie';
  if (lower === 'place' || lower === 'location') return 'urn:entity:place';
  if (lower === 'person') return 'urn:entity:person';
  return lower;
}

function tdSameType(left, right) {
  var a = tdCanonicalType(left);
  var b = tdCanonicalType(right);
  return !!a && a === b;
}

function tdTypeLabel(type) {
  var urn = tdCanonicalType(type);
  if (urn === 'urn:entity:brand') return 'Brand';
  if (urn === 'urn:entity:artist') return 'Artist';
  if (urn === 'urn:entity:movie') return 'Film';
  if (urn === 'urn:entity:place') return 'Place';
  if (urn === 'urn:entity:person') return 'Person';
  var raw = String(type || '').trim();
  if (!raw) return 'Reference';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function tdIsPlace(type) {
  return tdCanonicalType(type) === 'urn:entity:place';
}

function tdIsBrand(type) {
  return tdCanonicalType(type) === 'urn:entity:brand';
}

function tdSameCity(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function tdClone(entity, extra) {
  var next = {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    source: entity.source || 'sample'
  };
  if (entity.image) next.image = entity.image;
  if (entity.city) next.city = entity.city;
  if (entity.fit) next.fit = entity.fit;
  if (extra && extra.city) next.city = extra.city;
  return next;
}

function tdRank(entity, query, city, typed) {
  var name = tdNorm(entity.name);
  var score = 0;
  if (query && name === query) score += 100;
  else if (query && name.indexOf(query) === 0) score += 40;
  else if (query && name.indexOf(query) >= 0) score += 20;
  if (city && entity.city && tdSameCity(entity.city, city)) score += 30;
  if (!typed && query && name === query && tdIsBrand(entity.type)) score += 8;
  return score;
}

function tdDisambiguate(entities, options) {
  var opts = options || {};
  var wanted = tdCanonicalType(opts.type);
  var city = String(opts.city || '').trim();
  var placeSearch = wanted === 'urn:entity:place';
  var query = tdNorm(opts.query || '');
  var seen = {};
  var rows = [];
  var list = entities || [];
  for (var i = 0; i < list.length; i++) {
    var entity = list[i];
    if (!entity || !entity.name) continue;
    if (wanted && !tdSameType(entity.type, wanted)) continue;
    if (placeSearch && city && entity.city && !tdSameCity(entity.city, city)) continue;
    var next = tdClone(entity, placeSearch && city && !entity.city ? { city: city } : null);
    var key = next.id + '|' + tdCanonicalType(next.type);
    if (seen[key]) continue;
    seen[key] = 1;
    rows.push({ entity: next, index: rows.length, score: tdRank(next, query, city, !!wanted) });
  }
  rows.sort(function (a, b) { return b.score - a.score || a.index - b.index; });
  var out = [];
  for (var j = 0; j < rows.length; j++) out.push(rows[j].entity);
  return out;
}

function tdEntity(id, name, type, extra) {
  var row = { id: id, name: name, type: type, source: 'sample' };
  if (extra && extra.image) row.image = extra.image;
  if (extra && extra.city) row.city = extra.city;
  if (extra && extra.fit) row.fit = extra.fit;
  return row;
}

function tdReferenceCatalog() {
  return [
    tdEntity('td-local-comme', 'Comme des Garçons', 'urn:entity:brand', { image: TD_IMG.comme, fit: 'logo' }),
    tdEntity('td-local-muji', 'Muji', 'urn:entity:brand', { image: TD_IMG.muji, fit: 'logo' }),
    tdEntity('td-local-muji-person', 'Muji', 'urn:entity:person', { fit: 'photo' }),
    tdEntity('td-local-aphex', 'Aphex Twin', 'urn:entity:artist', { image: TD_IMG.aphex, fit: 'circle' }),
    tdEntity('td-local-lost', 'Lost in Translation', 'urn:entity:movie', { image: TD_IMG.lost, fit: 'photo' }),
    tdEntity('td-local-los-angeles-silver-lake', 'Silver Lake', 'urn:entity:place', { image: TD_IMG.silver, city: 'Los Angeles', fit: 'photo' })
  ];
}

function tdPlaceCatalog() {
  var out = [];
  var cities = Object.keys(TD_CITY_PLACES);
  for (var i = 0; i < cities.length; i++) {
    var city = cities[i];
    var names = TD_CITY_PLACES[city];
    for (var j = 0; j < names.length; j++) {
      var name = names[j];
      var extra = { city: city, fit: 'photo' };
      if (name === 'Silver Lake') extra.image = TD_IMG.silver;
      out.push(tdEntity('td-local-' + tdSlug(city) + '-' + tdSlug(name), name, 'urn:entity:place', extra));
    }
  }
  return out;
}

function tdSuggest(query, options) {
  var opts = options || {};
  var q = tdNorm(query || '');
  if (!q) return [];
  var pool = opts.pool || (opts.kind === 'location' ? tdPlaceCatalog() : tdReferenceCatalog());
  var matched = [];
  for (var i = 0; i < pool.length; i++) {
    if (tdNorm(pool[i].name).indexOf(q) >= 0) matched.push(pool[i]);
  }
  return tdDisambiguate(matched, {
    query: query,
    type: opts.kind === 'location' ? 'place' : (opts.type || ''),
    city: opts.kind === 'location' ? (opts.city || '') : (opts.city || '')
  });
}

function tdMergeEntities(primary, extra) {
  var out = (primary || []).slice();
  var more = extra || [];
  for (var i = 0; i < more.length; i++) {
    var item = more[i];
    var dup = false;
    for (var j = 0; j < out.length; j++) {
      if (tdNorm(out[j].name) === tdNorm(item.name) && tdSameType(out[j].type, item.type)) dup = true;
    }
    if (!dup) out.push(item);
  }
  return out;
}

function tdSuggestTags(query) {
  var q = tdNorm(query || '');
  if (!q) return [];
  var out = [];
  for (var i = 0; i < TD_TAGS.length; i++) {
    if (tdNorm(TD_TAGS[i].name).indexOf(q) >= 0) out.push(TD_TAGS[i]);
  }
  return out;
}

function tdMergeTags(primary, extra) {
  var out = (primary || []).slice();
  var more = extra || [];
  for (var i = 0; i < more.length; i++) {
    var item = more[i];
    var dup = false;
    for (var j = 0; j < out.length; j++) {
      if (out[j].id === item.id || tdNorm(out[j].name) === tdNorm(item.name)) dup = true;
    }
    if (!dup) out.push(item);
  }
  return out;
}

function tdEditDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  var prevRow = [];
  var j;
  for (j = 0; j <= b.length; j++) prevRow[j] = j;
  for (var i = 1; i <= a.length; i++) {
    var row = [i];
    for (j = 1; j <= b.length; j++) {
      var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prevRow[j] + 1, prevRow[j - 1] + cost);
    }
    prevRow = row;
  }
  return prevRow[b.length];
}

function tdMatchCase(source, replacement) {
  if (source && source.charAt(0) === source.charAt(0).toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function tdSpellSuggestions(text) {
  var source = String(text || '');
  var re = /[A-Za-z][A-Za-z'-]*/g;
  var out = [];
  var match;
  while ((match = re.exec(source))) {
    var word = match[0];
    var key = word.toLowerCase();
    if (key.length < 4 || TD_STOP[key] || TD_DICT.indexOf(key) >= 0) continue;
    var best = '';
    var bestD = 3;
    var limit = key.length >= 6 ? 2 : 1;
    for (var i = 0; i < TD_DICT.length; i++) {
      var dist = tdEditDistance(key, TD_DICT[i]);
      if (dist > 0 && dist <= limit && dist < bestD) {
        bestD = dist;
        best = TD_DICT[i];
      }
    }
    if (best) out.push({ from: word, to: tdMatchCase(word, best), index: match.index });
  }
  return out.slice(-3);
}

function tdApplySuggestion(text, suggestion) {
  var source = String(text || '');
  if (!suggestion || suggestion.index == null) return source;
  return source.slice(0, suggestion.index) + suggestion.to + source.slice(suggestion.index + suggestion.from.length);
}
