// Input screen: linked reference and location cards, debounced autocomplete,
// and spellcheck on the idea and interests fields. Tag chips come from /api/tags.

var tdHost = null;
var tdInstalled = false;
var tdTick = 0;
var tdTimers = {};
var tdSeq = { reference: 0, location: 0, interests: 0 };
var tdPopEl = null;
var tdPopKind = '';
var tdPopAnchor = null;

function tdWarn(err) {
  try { console.warn('[brief]', err); } catch (e) { /* ignore */ }
}

function tdCurrentCity(self) {
  var sel = document.getElementById('city');
  if (sel && sel.value) return sel.value;
  return (self && self.state && self.state.city) || '';
}

function tdApiBase(self) {
  try {
    if (typeof readApiBase === 'function') return readApiBase(self && self.props);
  } catch (e) { /* ignore */ }
  return '';
}

function tdFit(entity) {
  if (entity && entity.fit) return entity.fit;
  var label = tdTypeLabel(entity && entity.type);
  if (label === 'Brand') return 'logo';
  if (label === 'Artist') return 'circle';
  return 'photo';
}

function tdMetaLine(entity) {
  var parts = [tdTypeLabel(entity.type)];
  if (entity.city) parts.push(entity.city);
  return parts.join(' · ');
}

function tdTagLabel(type) {
  var parts = String(type || '').split(':');
  return parts[parts.length - 1] || type;
}

function tdMeta(self, name) {
  if (self._tdCatalog && self._tdCatalog[name]) return self._tdCatalog[name];
  var found = tdSuggest(name, { kind: 'reference' });
  for (var i = 0; i < found.length; i++) {
    if (tdNorm(found[i].name) === tdNorm(name)) return found[i];
  }
  if (typeof REF_EVIDENCE !== 'undefined' && REF_EVIDENCE[name]) {
    var rec = REF_EVIDENCE[name];
    return {
      id: 'td-sample-' + tdSlug(name),
      name: name,
      type: rec.type || 'Reference',
      image: rec.image || '',
      city: rec.city || '',
      source: 'sample',
      fit: rec.fit || ''
    };
  }
  return { id: 'td-name-' + tdSlug(name), name: name, type: 'Reference', source: 'sample' };
}

function tdSeedLocations(self) {
  var refs = (self.state && self.state.refs) || [];
  var out = [];
  for (var i = 0; i < refs.length; i++) {
    var meta = tdMeta(self, refs[i]);
    if (tdTypeLabel(meta.type) !== 'Place') continue;
    out.push(meta);
  }
  return out;
}

function tdVisibleLocations(self) {
  var city = tdCurrentCity(self);
  var list = self._tdLocations || [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    if (!list[i].city || tdSameCity(list[i].city, city)) out.push(list[i]);
  }
  return out;
}

function tdRemember(self, entity) {
  if (!self._tdCatalog) self._tdCatalog = {};
  self._tdCatalog[entity.name] = entity;
}

function tdThumb(entity, small) {
  var span = document.createElement('span');
  span.className = 'td-thumb';
  var letter = document.createElement('b');
  letter.textContent = String((entity && entity.name) || '?').charAt(0).toUpperCase();
  span.appendChild(letter);
  if (entity && entity.image) {
    var img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.src = entity.image;
    img.addEventListener('load', function () { if (img.naturalWidth > 0) letter.remove(); });
    img.addEventListener('error', function () { img.remove(); });
    span.appendChild(img);
  }
  if (small) span.classList.add('is-small');
  return span;
}

function tdCopy(entity, showBelong) {
  var copy = document.createElement('span');
  copy.className = 'td-card-copy';
  var name = document.createElement('span');
  name.className = 'td-card-name';
  name.textContent = entity.name;
  var meta = document.createElement('span');
  meta.className = 'td-card-meta';
  meta.textContent = tdMetaLine(entity);
  copy.appendChild(name);
  copy.appendChild(meta);
  if (showBelong && entity.city) {
    var city = document.createElement('span');
    city.className = 'td-card-city';
    city.textContent = 'ใน ' + entity.city;
    copy.appendChild(city);
  }
  return copy;
}

function tdRemoveButton(label, onClick) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
  btn.addEventListener('click', onClick);
  return btn;
}

function tdChipName(chip) {
  var named = chip.querySelector('.td-card-name');
  if (named && named.textContent) return named.textContent.trim();
  var btn = chip.querySelector('button');
  var label = btn ? (btn.getAttribute('aria-label') || '') : '';
  var match = label.match(/^ลบ\s+(.+)$/);
  if (match) return match[1];
  return (chip.textContent || '').trim();
}

function tdUpgradeChip(chip, entity) {
  var btn = chip.querySelector('button');
  var stamp = [entity.name, tdTypeLabel(entity.type), entity.city || '', entity.image || ''].join('|');
  var stray = false;
  for (var i = 0; i < chip.childNodes.length; i++) {
    var node = chip.childNodes[i];
    if (node.nodeType === 3 && String(node.textContent || '').trim()) stray = true;
  }
  if (!stray && chip.getAttribute('data-td-stamp') === stamp && chip.querySelector('.td-thumb')) return;
  chip.classList.add('td-card');
  chip.classList.toggle('is-logo', tdFit(entity) === 'logo');
  chip.classList.toggle('is-circle', tdFit(entity) === 'circle');
  chip.setAttribute('data-td-stamp', stamp);
  var nodes = Array.prototype.slice.call(chip.childNodes);
  for (var j = 0; j < nodes.length; j++) {
    if (nodes[j] !== btn) chip.removeChild(nodes[j]);
  }
  var thumb = tdThumb(entity);
  var copy = tdCopy(entity, tdTypeLabel(entity.type) === 'Place');
  if (btn) {
    chip.insertBefore(thumb, btn);
    chip.insertBefore(copy, btn);
  } else {
    chip.appendChild(thumb);
    chip.appendChild(copy);
  }
}

function tdPaintReferences(self) {
  var box = document.querySelector('.byb-chips');
  if (!box || !document.getElementById('idea')) return;
  box.classList.add('td-cards');
  var chips = box.querySelectorAll('.byb-chip');
  for (var i = 0; i < chips.length; i++) {
    var name = tdChipName(chips[i]);
    if (!name) continue;
    tdUpgradeChip(chips[i], tdMeta(self, name));
  }
  var input = box.parentNode && box.parentNode.querySelector('input[aria-label="เพิ่ม reference"]');
  if (!input) return;
  input.setAttribute('data-td-kind', 'reference');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', tdPopEl && tdPopKind === 'reference' ? 'true' : 'false');
  if (self._tdRefDraft && document.activeElement !== input && input.value !== self._tdRefDraft) {
    input.value = self._tdRefDraft;
  }
}

function tdPaintLocations(self) {
  var anchor = document.querySelector('input[aria-label="เพิ่ม reference"]');
  var group = anchor && anchor.closest('.byb-group');
  if (!group || !group.parentNode || !document.getElementById('idea')) return;
  var city = tdCurrentCity(self);
  var box = document.getElementById('td-locations');
  var refocus = false;
  if (!box) {
    refocus = !!(document.activeElement && document.activeElement.id === 'td-loc-input');
    box = document.createElement('div');
    box.id = 'td-locations';
    box.className = 'byb-group td-locations';
    box.innerHTML = '<span class="byb-label" id="td-loc-label"></span><p class="byb-help" id="td-loc-help"></p><div id="td-location-cards" class="td-cards"></div><div class="byb-addrow"><input id="td-loc-input" class="byb-field byb-line" type="text" data-td-kind="location" autocomplete="off" role="combobox" aria-autocomplete="list"></div>';
    group.parentNode.insertBefore(box, group.nextSibling);
  }
  var label = document.getElementById('td-loc-label');
  var help = document.getElementById('td-loc-help');
  var cards = document.getElementById('td-location-cards');
  var locInput = document.getElementById('td-loc-input');
  if (label) label.textContent = 'Locations · สถานที่ใน ' + city;
  if (help) help.textContent = 'การค้นหาอิงจากเมืองที่เลือก · การ์ดที่เพิ่มจะผูกกับ ' + city;
  if (locInput) {
    locInput.placeholder = 'ค้นหาสถานที่ใน ' + city;
    locInput.setAttribute('aria-label', 'ค้นหาสถานที่ใน ' + city);
    locInput.setAttribute('aria-expanded', tdPopEl && tdPopKind === 'location' ? 'true' : 'false');
    if (document.activeElement !== locInput && locInput.value !== (self._tdLocDraft || '')) {
      locInput.value = self._tdLocDraft || '';
    }
    if (refocus) locInput.focus();
  }
  if (!cards) return;
  var rows = tdVisibleLocations(self);
  var stamp = city + '|' + rows.map(function (row) { return row.id + row.image + row.city; }).join(',');
  if (cards.getAttribute('data-td-stamp') === stamp) return;
  cards.setAttribute('data-td-stamp', stamp);
  cards.textContent = '';
  if (!rows.length) {
    var empty = document.createElement('p');
    empty.className = 'td-empty';
    empty.textContent = 'ยังไม่มีสถานที่ใน ' + city;
    cards.appendChild(empty);
    return;
  }
  for (var i = 0; i < rows.length; i++) {
    cards.appendChild(tdLocationCard(self, rows[i]));
  }
}

function tdLocationCard(self, entity) {
  var card = document.createElement('article');
  card.className = 'td-loc-card td-card' + (tdFit(entity) === 'logo' ? ' is-logo' : '') + (tdFit(entity) === 'circle' ? ' is-circle' : '');
  card.appendChild(tdThumb(entity));
  card.appendChild(tdCopy(entity, true));
  card.appendChild(tdRemoveButton('ลบ ' + entity.name, function () {
    self._tdLocations = (self._tdLocations || []).filter(function (row) { return row.id !== entity.id; });
    var cards = document.getElementById('td-location-cards');
    if (cards) cards.removeAttribute('data-td-stamp');
    tdPaintLocations(self);
  }));
  return card;
}

function tdPaintTags(self) {
  var input = document.getElementById('interests');
  if (!input || !input.parentNode) return;
  input.setAttribute('data-td-kind', 'interests');
  input.setAttribute('spellcheck', 'true');
  input.setAttribute('autocorrect', 'on');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  var tags = self._tdTags || [];
  var row = document.getElementById('td-tags');
  if (!tags.length) {
    if (row) row.remove();
    return;
  }
  if (!row) {
    row = document.createElement('div');
    row.id = 'td-tags';
    row.className = 'td-tags';
    input.parentNode.insertBefore(row, input);
  }
  var stamp = tags.map(function (tag) { return tag.id; }).join('|');
  if (row.getAttribute('data-td-stamp') === stamp) return;
  row.setAttribute('data-td-stamp', stamp);
  row.textContent = '';
  for (var i = 0; i < tags.length; i++) {
    row.appendChild(tdTagChip(self, tags[i]));
  }
}

function tdTagChip(self, tag) {
  var chip = document.createElement('span');
  chip.className = 'td-tag';
  var name = document.createElement('span');
  name.textContent = tag.name;
  chip.appendChild(name);
  if (tag.type) {
    var type = document.createElement('small');
    type.textContent = tdTagLabel(tag.type);
    chip.appendChild(type);
  }
  chip.appendChild(tdRemoveButton('ลบ ' + tag.name, function () { tdRemoveTag(self, tag); }));
  return chip;
}

function tdRemoveTag(self, tag) {
  self._tdTags = (self._tdTags || []).filter(function (item) { return item.id !== tag.id; });
  var row = document.getElementById('td-tags');
  if (row) row.removeAttribute('data-td-stamp');
  self.setState({ interests: (self._tdTags || []).map(function (item) { return item.name; }).join(', ') });
}

function tdIdeaText(self) {
  var el = document.getElementById('idea');
  if (el && document.activeElement === el) return el.value;
  return (self.state && self.state.idea) || (el ? el.value : '');
}

function tdPaintSpell(anchor, id, suggestions, onPick) {
  if (!anchor || !anchor.parentNode) return;
  var row = document.getElementById(id);
  if (!suggestions.length) {
    if (row) row.remove();
    return;
  }
  if (!row) {
    row = document.createElement('div');
    row.id = id;
    row.className = 'td-spell';
    row.setAttribute('role', 'group');
    anchor.parentNode.insertBefore(row, anchor.nextSibling);
  }
  var stamp = suggestions.map(function (item) { return item.from + '>' + item.to + '@' + item.index; }).join(',');
  if (row.getAttribute('data-td-stamp') === stamp) return;
  row.setAttribute('data-td-stamp', stamp);
  row.textContent = '';
  var label = document.createElement('p');
  label.textContent = 'น่าจะหมายถึง';
  row.appendChild(label);
  suggestions.forEach(function (item) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = item.to;
    btn.addEventListener('click', function () { onPick(item); });
    row.appendChild(btn);
  });
}

function tdPaintIdeaSpell(self) {
  var idea = document.getElementById('idea');
  if (!idea) return;
  idea.setAttribute('spellcheck', 'true');
  idea.setAttribute('autocorrect', 'on');
  tdPaintSpell(idea, 'td-spell-idea', tdSpellSuggestions(tdIdeaText(self)), function (item) {
    var next = tdApplySuggestion(tdIdeaText(self), item);
    self.setState({ idea: next });
  });
}

function tdPaintInterestSpell(self) {
  var input = document.getElementById('interests');
  if (!input) return;
  tdPaintSpell(input, 'td-spell-interests', tdSpellSuggestions(self._tdInterestDraft || ''), function (item) {
    self._tdInterestDraft = tdApplySuggestion(self._tdInterestDraft || '', item);
    input.value = self._tdInterestDraft;
    tdOnQuery(self, 'interests', input);
  });
}

function tdPaint(self) {
  if (!self || typeof document === 'undefined') return;
  tdPainting = true;
  try {
    if (!document.getElementById('idea')) {
      tdClosePop();
      return;
    }
    tdPaintIdeaSpell(self);
    tdPaintInterestSpell(self);
    tdPaintTags(self);
    tdPaintReferences(self);
    tdPaintLocations(self);
    if (tdPopEl && tdPopAnchor && tdPopAnchor.isConnected) tdPlace(tdPopEl, tdPopAnchor);
    else if (tdPopEl && tdPopAnchor && !tdPopAnchor.isConnected) tdClosePop();
  } finally {
    tdPainting = false;
  }
}
var tdPainting = false;

function tdClosePop() {
  if (tdPopAnchor) tdPopAnchor.setAttribute('aria-expanded', 'false');
  if (tdPopEl && tdPopEl.parentNode) tdPopEl.parentNode.removeChild(tdPopEl);
  tdPopEl = null;
  tdPopKind = '';
  tdPopAnchor = null;
  if (tdHost) tdHost._tdPopOpen = false;
}

function tdPlace(pop, anchor) {
  var rect = anchor.getBoundingClientRect();
  var width = Math.min(Math.max(rect.width, 260), window.innerWidth - 16);
  var left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
  pop.style.width = width + 'px';
  pop.style.left = left + 'px';
  var top = rect.bottom + 6;
  pop.style.top = top + 'px';
  var height = pop.offsetHeight;
  if (top + height > window.innerHeight - 8 && rect.top > height + 8) {
    pop.style.top = (rect.top - height - 6) + 'px';
  }
}

function tdOpenPop(anchor, kind, items, renderItem) {
  tdClosePop();
  if (!anchor || !items || !items.length) return;
  var pop = document.createElement('div');
  pop.className = 'td-pop';
  pop.setAttribute('role', 'listbox');
  var active = tdHost && tdHost._tdActive || 0;
  for (var i = 0; i < items.length; i++) {
    var btn = renderItem(items[i], i, i === active);
    (function (item) {
      btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      btn.addEventListener('click', function () { tdPick(tdHost, kind, item); });
    })(items[i]);
    pop.appendChild(btn);
  }
  document.body.appendChild(pop);
  tdPopEl = pop;
  tdPopKind = kind;
  tdPopAnchor = anchor;
  if (tdHost) {
    tdHost._tdPopOpen = true;
    tdHost._tdLastKind = kind;
    tdHost._tdLastResults = items;
  }
  anchor.setAttribute('aria-expanded', 'true');
  tdPlace(pop, anchor);
}

function tdEntityOption(entity, index, on) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'td-opt' + (on ? ' is-on' : '') + (tdFit(entity) === 'logo' ? ' is-logo' : '') + (tdFit(entity) === 'circle' ? ' is-circle' : '');
  btn.setAttribute('role', 'option');
  btn.setAttribute('aria-selected', on ? 'true' : 'false');
  btn.appendChild(tdThumb(entity));
  btn.appendChild(tdCopy(entity, false));
  return btn;
}

function tdTagOption(tag, index, on) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'td-opt' + (on ? ' is-on' : '');
  btn.setAttribute('role', 'option');
  btn.setAttribute('aria-selected', on ? 'true' : 'false');
  var thumb = document.createElement('span');
  thumb.className = 'td-thumb';
  var letter = document.createElement('b');
  letter.textContent = String(tag.name || '?').charAt(0).toUpperCase();
  thumb.appendChild(letter);
  btn.appendChild(thumb);
  var copy = document.createElement('span');
  copy.className = 'td-card-copy';
  var name = document.createElement('span');
  name.className = 'td-card-name';
  name.textContent = tag.name;
  var meta = document.createElement('span');
  meta.className = 'td-card-meta';
  meta.textContent = tag.type ? tdTagLabel(tag.type) : 'Tag';
  copy.appendChild(name);
  copy.appendChild(meta);
  btn.appendChild(copy);
  return btn;
}

function tdMarkActive() {
  if (!tdPopEl || !tdHost) return;
  var buttons = tdPopEl.querySelectorAll('.td-opt');
  var active = tdHost._tdActive || 0;
  for (var i = 0; i < buttons.length; i++) {
    var on = i === active;
    buttons[i].classList.toggle('is-on', on);
    buttons[i].setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) buttons[i].scrollIntoView({ block: 'nearest' });
  }
}

function tdDraftFor(self, kind) {
  if (kind === 'interests') return self._tdInterestDraft || '';
  if (kind === 'location') return self._tdLocDraft || '';
  if (kind === 'reference') return self._tdRefDraft || '';
  return '';
}

function tdQueryCurrent(self, kind, q, anchor) {
  var wanted = tdNorm(q);
  if (anchor && tdNorm(anchor.value) === wanted) return true;
  if (tdNorm(tdDraftFor(self, kind)) !== wanted) return false;
  if (anchor) anchor.value = tdDraftFor(self, kind);
  return true;
}

function tdAnchor(kind) {
  if (kind === 'reference') return document.querySelector('[data-td-kind="reference"]');
  if (kind === 'location') return document.getElementById('td-loc-input');
  if (kind === 'interests') return document.getElementById('interests');
  return null;
}

function tdDebounced(key, fn) {
  clearTimeout(tdTimers[key]);
  tdTimers[key] = setTimeout(fn, 280);
}

async function tdFetchJson(url) {
  if (typeof fetch !== 'function') return null;
  try {
    var res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function tdFetchSearch(self, q, type, city) {
  var base = tdApiBase(self);
  if (!base) return [];
  var params = new URLSearchParams();
  params.set('q', q);
  if (type) params.set('type', type);
  if (city) params.set('city', city);
  var data = await tdFetchJson(base + '/api/search?' + params.toString());
  return (data && data.entities) || [];
}

async function tdFetchTags(self, q) {
  var base = tdApiBase(self);
  if (!base) return [];
  var data = await tdFetchJson(base + '/api/tags?q=' + encodeURIComponent(q));
  return (data && data.tags) || [];
}

function tdOnQuery(self, kind, input) {
  if (!self || !input) return;
  var value = input.value || '';
  if (kind === 'reference') self._tdRefDraft = value;
  if (kind === 'location') self._tdLocDraft = value;
  if (kind === 'interests') {
    self._tdInterestDraft = value;
    tdPaintInterestSpell(self);
  }
  var seq = ++tdSeq[kind];
  tdDebounced(kind, function () {
    if (tdSeq[kind] !== seq) return;
    tdRunQuery(self, kind, value);
  });
}

async function tdRunQuery(self, kind, value) {
  var q = String(value || '').trim();
  var anchor = tdAnchor(kind);
  if (!q) {
    tdClosePop();
    return;
  }
  if (!tdQueryCurrent(self, kind, q, anchor)) return;
  var city = tdCurrentCity(self);
  var items = [];
  if (kind === 'interests') {
    var spells = tdSpellSuggestions(q);
    var remote = await tdFetchTags(self, q);
    if (spells.length && tdNorm(spells[0].to) !== tdNorm(q)) {
      remote = tdMergeTags(remote, await tdFetchTags(self, spells[0].to));
    }
    var local = tdSuggestTags(q);
    if (spells.length) local = tdMergeTags(local, tdSuggestTags(spells[0].to));
    items = tdMergeTags(remote, local).slice(0, 8);
  } else if (kind === 'location') {
    var places = await tdFetchSearch(self, q, 'urn:entity:place', city);
    items = tdDisambiguate(tdMergeEntities(places, tdSuggest(q, { kind: 'location', city: city })), {
      query: q,
      type: 'place',
      city: city
    }).slice(0, 8);
  } else {
    var refs = await tdFetchSearch(self, q, '', '');
    items = tdDisambiguate(tdMergeEntities(refs, tdSuggest(q, { kind: 'reference' })), { query: q }).slice(0, 8);
  }
  anchor = tdAnchor(kind);
  if (!tdQueryCurrent(self, kind, q, anchor)) return;
  anchor = tdAnchor(kind);
  self._tdActive = 0;
  if (kind === 'interests') tdOpenPop(anchor, kind, items, tdTagOption);
  else tdOpenPop(anchor, kind, items, tdEntityOption);
}

function tdCommitReference(self, entity) {
  var name = String(entity.name || '').trim();
  if (!name) return;
  var refs = (self.state.refs || []).slice();
  if (refs.length >= 8 || refs.indexOf(name) >= 0) {
    self._tdRefDraft = '';
    tdClosePop();
    var existing = document.querySelector('[data-td-kind="reference"]');
    if (existing) existing.value = '';
    return;
  }
  tdRemember(self, entity);
  if (tdTypeLabel(entity.type) === 'Place') {
    var city = entity.city || '';
    var loc = city ? entity : Object.assign({}, entity, { city: tdCurrentCity(self) });
    tdRemember(self, loc);
    var locations = self._tdLocations || [];
    var exists = locations.some(function (row) { return tdNorm(row.name) === tdNorm(loc.name) && tdSameCity(row.city || '', loc.city || ''); });
    if (!exists) self._tdLocations = locations.concat([loc]);
  }
  self._tdRefDraft = '';
  tdClosePop();
  var input = document.querySelector('[data-td-kind="reference"]');
  if (input) input.value = '';
  self.setState({ refs: refs.concat([name]), refDraft: '' });
}

function tdCommitLocation(self, entity) {
  var city = entity.city || tdCurrentCity(self);
  var row = {
    id: entity.id || ('td-free-place-' + tdSlug(city) + '-' + tdSlug(entity.name)),
    name: entity.name,
    type: entity.type || 'urn:entity:place',
    source: entity.source || 'sample',
    city: city
  };
  if (entity.image) row.image = entity.image;
  if (entity.fit) row.fit = entity.fit;
  var list = self._tdLocations || [];
  var dup = list.some(function (item) { return tdNorm(item.name) === tdNorm(row.name) && tdSameCity(item.city || '', row.city || ''); });
  self._tdLocDraft = '';
  tdClosePop();
  var input = document.getElementById('td-loc-input');
  if (input) input.value = '';
  if (!dup) self._tdLocations = list.concat([row]);
  var cards = document.getElementById('td-location-cards');
  if (cards) cards.removeAttribute('data-td-stamp');
  tdPaintLocations(self);
}

function tdResolveQuery(q, kind, city) {
  var rows = tdSuggest(q, { kind: kind, city: city || '' });
  if (!rows.length) return null;
  if (tdNorm(rows[0].name) === tdNorm(q) || rows.length === 1) return rows[0];
  return null;
}

function tdCommitReferenceQuery(self) {
  var input = tdAnchor('reference');
  var q = String((input && input.value) || self._tdRefDraft || '').trim();
  if (!q) return;
  var picked = null;
  if (self._tdPopOpen && self._tdLastKind === 'reference' && self._tdLastResults && self._tdLastResults.length) {
    picked = self._tdLastResults[self._tdActive || 0];
  }
  if (!picked) picked = tdResolveQuery(q, 'reference', '');
  if (!picked) picked = { id: 'td-free-' + tdSlug(q), name: q, type: 'Reference', source: 'sample' };
  tdCommitReference(self, picked);
}

function tdCommitLocationQuery(self) {
  var input = tdAnchor('location');
  var q = String((input && input.value) || self._tdLocDraft || '').trim();
  if (!q) return;
  var city = tdCurrentCity(self);
  var picked = null;
  if (self._tdPopOpen && self._tdLastKind === 'location' && self._tdLastResults && self._tdLastResults.length) {
    picked = self._tdLastResults[self._tdActive || 0];
  }
  if (!picked) picked = tdResolveQuery(q, 'location', city);
  if (!picked) {
    picked = { id: 'td-free-place-' + tdSlug(city) + '-' + tdSlug(q), name: q, type: 'urn:entity:place', city: city, source: 'sample' };
  }
  tdCommitLocation(self, picked);
}

function tdAddTag(self, tag) {
  var tags = self._tdTags || [];
  var dup = tags.some(function (item) { return item.id === tag.id || tdNorm(item.name) === tdNorm(tag.name); });
  if (!dup) self._tdTags = tags.concat([tag]);
  self._tdInterestDraft = '';
  tdClosePop();
  var input = document.getElementById('interests');
  if (input) input.value = '';
  var row = document.getElementById('td-tags');
  if (row) row.removeAttribute('data-td-stamp');
  self.setState({ interests: (self._tdTags || []).map(function (item) { return item.name; }).join(', ') });
}

function tdPick(self, kind, item) {
  if (!self || !item) return;
  if (kind === 'interests') tdAddTag(self, item);
  else if (kind === 'location') tdCommitLocation(self, item);
  else tdCommitReference(self, item);
}

function tdDecorateView(self, view) {
  tdHost = self;
  if (!self._tdCatalog) self._tdCatalog = {};
  if (!self._tdLocations) self._tdLocations = tdSeedLocations(self);
  if (!self._tdTags) self._tdTags = [];
  if (self._tdInterestDraft == null) self._tdInterestDraft = '';
  if (self._tdRefDraft == null) self._tdRefDraft = '';
  if (self._tdLocDraft == null) self._tdLocDraft = '';
  view.interests = self._tdInterestDraft;
  view.onInterests = function (e) {
    var next = e.target.value;
    if (next === self._tdInterestDraft) return;
    self._tdInterestDraft = next;
    tdOnQuery(self, 'interests', e.target);
    self.setState({ tdInterestDraftShown: next });
  };
  var origIdea = view.onIdea;
  view.onIdea = function (e) {
    if (origIdea) origIdea(e);
    tdPaintIdeaSpell(self);
  };
  view.onRefDraft = function (e) {
    self._tdRefDraft = e.target.value;
    tdOnQuery(self, 'reference', e.target);
  };
  view.addRef = function () { tdCommitReferenceQuery(self); };
}

function tdOnKey(e) {
  var target = e.target;
  if (!target || !target.getAttribute || !tdHost) return;
  var kind = target.getAttribute('data-td-kind');
  if (!kind) return;
  if (e.key === 'Escape') {
    tdClosePop();
    return;
  }
  var open = tdHost._tdPopOpen && tdHost._tdLastKind === kind && tdPopEl;
  var items = open ? (tdHost._tdLastResults || []) : [];
  if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    var dir = e.key === 'ArrowDown' ? 1 : -1;
    var next = (tdHost._tdActive || 0) + dir;
    if (next < 0) next = items.length - 1;
    if (next >= items.length) next = 0;
    tdHost._tdActive = next;
    tdMarkActive();
    return;
  }
  if (e.key === 'Enter' && kind !== 'idea') {
    e.preventDefault();
    if (open && items.length) tdPick(tdHost, kind, items[tdHost._tdActive || 0]);
    else if (kind === 'location') tdCommitLocationQuery(tdHost);
    else if (kind === 'reference') tdCommitReferenceQuery(tdHost);
  }
}

function tdBind() {
  document.addEventListener('keydown', tdOnKey, true);
  document.addEventListener('mousedown', function (e) {
    if (!tdPopEl) return;
    if (tdPopEl.contains(e.target)) return;
    if (e.target && e.target.getAttribute && e.target.getAttribute('data-td-kind')) return;
    tdClosePop();
  }, true);
  window.addEventListener('resize', function () {
    if (tdPopEl && tdPopAnchor && tdPopAnchor.isConnected) tdPlace(tdPopEl, tdPopAnchor);
  });
  document.addEventListener('input', function (e) {
    var target = e.target;
    if (!target || !target.getAttribute || !tdHost) return;
    if (target.getAttribute('data-td-kind') === 'location') tdOnQuery(tdHost, 'location', target);
  }, true);
}

function tdSchedulePaint() {
  var host = tdHost;
  if (!host) return;
  var tick = ++tdTick;
  var run = function () {
    if (tick !== tdTick) return;
    try { tdPaint(host); } catch (err) { tdWarn(err); }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 16);
}

function tdInstall() {
  if (tdInstalled) return;
  if (typeof Component === 'undefined' || !Component.prototype || typeof Component.prototype.renderVals !== 'function' || typeof document === 'undefined') return;
  tdInstalled = true;
  var orig = Component.prototype.renderVals;
  Component.prototype.renderVals = function () {
    var view = orig.apply(this, arguments);
    try { tdDecorateView(this, view); } catch (err) { tdWarn(err); }
    tdSchedulePaint();
    return view;
  };
  tdBind();
  setTimeout(tdSchedulePaint, 40);
  setTimeout(tdSchedulePaint, 240);
}

tdInstall();
