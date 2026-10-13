// One results story on the main screen: provenance, the agent shortlist,
// the V1/V2 diff, the timeline, Demo mode, and the district map.

var tdFlowHost = null;
var tdMapLoading = false;
var tdMapModule = null;
var tdPaintQueued = false;

function tdEsc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function tdDelta(delta) {
  var n = Number(delta);
  if (!isFinite(n)) return '';
  return n > 0 ? '+' + n : String(n);
}

function tdStoryOf(result) {
  return result && result.story ? result.story : null;
}

function tdEnsureButton() {
  if (document.getElementById('td-demo-head')) return;
  var header = document.querySelector('.byb-header div');
  if (!header) return;
  var btn = document.createElement('button');
  btn.id = 'td-demo-head';
  btn.type = 'button';
  btn.className = 'byb-pill';
  btn.textContent = 'Demo mode';
  btn.addEventListener('click', function () {
    var path = (location.pathname || '/').replace(/\/+$/, '') || '/';
    location.href = path + '?demo=1';
  });
  header.insertBefore(btn, header.firstChild);
}

function tdShell() {
  return '<div data-td-story="1">' +
    '<div class="td-story-bar"><p class="td-caption" id="td-caption"></p><button type="button" class="td-demo" id="td-demo">Demo mode</button></div>' +
    '<div class="td-grid">' +
    '<section class="td-card" id="td-score" aria-label="Cultural resonance"></section>' +
    '<section class="td-card" id="td-short" aria-label="Agent shortlist"></section>' +
    '<section class="td-card wide" id="td-ledger" aria-label="Provenance ledger"></section>' +
    '<section class="td-card wide" id="td-diff" aria-label="Version 1 and Version 2"></section>' +
    '<section class="td-card wide" id="td-time" aria-label="Version timeline"></section>' +
    '<section class="td-card wide" id="td-map-slot" aria-label="District map"></section>' +
    '</div></div>';
}

function tdMapMarkup(city, caption) {
  return '<div class="td-map-embed">' +
    '<div id="td-map" class="td-map" role="application" aria-label="แผนที่ย่านแบบโต้ตอบ"></div>' +
    '<div class="td-map-side">' +
    '<p class="td-over" id="td-sub"></p>' +
    '<label>City <select id="td-city" class="td-city" data-city="' + tdEsc(city) + '" data-caption="' + tdEsc(caption) + '" aria-label="Brief city"></select></label>' +
    '<p class="td-caption" id="td-badge"></p>' +
    '<p class="td-caption" id="td-note"></p>' +
    '<div class="td-toggle" role="group" aria-label="Fits or friction">' +
    '<button type="button" id="td-fits" data-district="fits" aria-pressed="true">Fits</button>' +
    '<button type="button" id="td-friction" data-district="friction" aria-pressed="false">Friction</button></div>' +
    '<div class="td-toggle" role="group" aria-label="Version">' +
    '<button type="button" id="td-v1" data-version="v1" aria-pressed="false">V1</button>' +
    '<button type="button" id="td-v2" data-version="v2" aria-pressed="false">V2</button>' +
    '<button type="button" id="td-both" data-version="both" aria-pressed="true">V1 vs V2</button></div>' +
    '<div id="td-cards" class="td-cards"></div>' +
    '<div id="td-readout"></div></div></div>';
}

function tdLoadStyle(href) {
  if (document.querySelector('link[href="' + href + '"]')) return;
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function tdLoadScript(src) {
  return new Promise(function (resolve, reject) {
    if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
    var script = document.createElement('script');
    script.src = src;
    script.onload = function () { resolve(); };
    script.onerror = function () { reject(new Error('script ' + src)); };
    document.head.appendChild(script);
  });
}

function tdBootMap() {
  if (tdMapModule && typeof tdMapModule.bootMap === 'function') {
    try { tdMapModule.bootMap(); } catch (err) {
      var note = document.getElementById('td-note');
      if (note) note.textContent = err && err.message ? err.message : 'Map failed to load';
    }
  }
}

function tdMountMap(city, caption) {
  var slot = document.getElementById('td-map-slot');
  if (!slot) return;
  var mapNode = document.getElementById('td-map');
  if (!mapNode || slot.getAttribute('data-city') !== city) {
    slot.setAttribute('data-city', city);
    slot.innerHTML = tdMapMarkup(city, caption);
  } else {
    var cityNode = document.getElementById('td-city');
    if (cityNode) cityNode.setAttribute('data-caption', caption);
  }
  if (tdMapModule) {
    tdBootMap();
    return;
  }
  if (tdMapLoading) return;
  tdMapLoading = true;
  var origin = '';
  try { origin = location.origin || ''; } catch (e) { origin = ''; }
  tdLoadStyle('https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css');
  tdLoadStyle(origin + '/assets/map.css');
  tdLoadScript('https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js').then(function () {
    return import(origin + '/assets/map.js');
  }).then(function (mod) {
    tdMapModule = mod;
    tdBootMap();
  }).catch(function (err) {
    tdMapLoading = false;
    var note = document.getElementById('td-note');
    if (note) note.textContent = err && err.message ? err.message : 'Map failed to load';
  });
}

function tdLedger(v1, done, v2) {
  var story = tdStoryOf(v1);
  var rows = (story && story.provenance) || [];
  if (!rows.length && v1 && v1.ledger) {
    rows = ['anchor', 'cross', 'local', 'audience', 'friction'].map(function (id) {
      return { id: id, label: id, points: v1.ledger[id], detail: '' };
    });
  }
  var v2ledger = done && v2 && v2.ledger ? v2.ledger : null;
  var body = rows.map(function (row) {
    var next = v2ledger ? v2ledger[row.id] : null;
    var changed = done && next != null && next !== row.points;
    return '<div class="td-row' + (changed ? ' is-changed' : '') + '"><span>' + tdEsc(row.label) + '<p>' + tdEsc(row.detail || '') + '</p></span><b>' + tdEsc(row.points) + '</b><b>' + (done && next != null ? tdEsc(next) : '—') + '</b></div>';
  }).join('');
  return '<p class="td-over">Provenance ledger</p><div class="td-row"><span></span><b>V1</b><b>V2</b></div>' + body;
}

function tdShort(v1, done) {
  var list = (v1 && v1.proposals) || [];
  var story = tdStoryOf(v1);
  var considered = story && story.considered ? story.considered : list.length;
  if (!list.length) return '<p class="td-over">Agent</p><p class="td-caption">No measured lift to propose.</p>';
  var cards = list.slice(0, 3).map(function (item, index) {
    var from = item.from == null ? '' : item.from;
    var to = item.to == null ? '' : item.to;
    var approve = index === 0 && !done ? '<button type="button" id="td-approve">Approve top diff</button>' : '';
    return '<article class="td-prop"><b>' + tdEsc(item.param || item.before) + '</b><div><span class="td-was">' + tdEsc(from || item.before) + '</span> → <span class="td-now">' + tdEsc(to || item.after) + '</span></div><p>' + tdEsc(item.why) + '</p><p>Engine ' + tdEsc(tdDelta(item.predictedDelta)) + ' · ' + tdEsc(item.evidence || '') + '</p>' + approve + '</article>';
  }).join('');
  return '<p class="td-over">Top ' + Math.min(3, list.length) + ' of ' + tdEsc(considered) + ' simulated</p>' + cards;
}

function tdDiff(v1, done, v2) {
  var top = v1 && v1.proposals && v1.proposals[0];
  if (!top) return '<p class="td-over">What changed</p><p class="td-caption">Waiting for a scored brief.</p>';
  var after = done ? '<span class="td-now">' + tdEsc(top.to || top.after) + '</span>' : '—';
  return '<p class="td-over">What changed</p><p>' + tdEsc(done ? top.why : 'Version 2 appears when a person approves the top diff.') + '</p>' +
    '<div class="td-field"><span>Version 1</span><span class="td-was">' + tdEsc(top.from || top.before) + '</span></div>' +
    '<div class="td-field"><span>Version 2</span>' + after + '</div>' +
    (v2 && done ? '<p class="td-gain">Engine ' + tdEsc(tdDelta((v2.score || 0) - (v1.score || 0))) + ' · ' + tdEsc(v1.score) + ' → ' + tdEsc(v2.score) + '</p>' : '');
}

function tdTime(v1, done, v2) {
  var v1score = v1 && v1.score != null ? v1.score : '—';
  var v2score = done && v2 && v2.score != null ? v2.score : '—';
  var note = done && v2 && v2.proposals && v2.proposals[0] ? '' : (done && v1 && v1.proposals && v1.proposals[0] ? v1.proposals[0].why : 'After approval');
  return '<p class="td-over">Timeline</p><div class="td-time">' +
    '<article class="td-tick"><strong>Version 1</strong><b>' + tdEsc(v1score) + '</b><p>Scored brief</p></article>' +
    '<article class="td-tick"><strong>Version 2</strong><b>' + tdEsc(v2score) + '</b><p>' + tdEsc(note) + '</p></article></div>';
}

function tdPaintFlow(self) {
  tdFlowHost = self;
  tdEnsureButton();
  if (!self.state || self.state.phase !== 'result') return;
  var host = document.getElementById('td-story');
  if (!host) return;
  if (!host.querySelector('[data-td-story]')) host.innerHTML = tdShell();
  var v1 = self.state.apiV1;
  var done = !!self.state.applied && !!self.state.apiV2;
  var v2 = done ? self.state.apiV2 : null;
  var story = tdStoryOf(v1);
  var caption = document.getElementById('td-caption');
  var lines = story && story.captions ? story.captions : [];
  if (caption) {
    var narrate = lines.length && ((done && queryFlag('demo') === '1') || (story && story.mode === 'insights'));
    if (narrate) {
      caption.innerHTML = lines.map(function (line) {
        return '<span class="td-line">' + tdEsc(line) + '</span>';
      }).join('');
    } else if (!self._tdDemoTimer) {
      caption.textContent = done ? (lines[lines.length - 1] || '') : (lines[0] || 'Score, then approve the top diff.');
    }
  }
  var score = document.getElementById('td-score');
  if (score) {
    var gain = done ? '<span class="td-gain">Engine ' + tdEsc(tdDelta((v2.score || 0) - (v1.score || 0))) + '</span>' : '';
    score.innerHTML = '<p class="td-over">Cultural resonance</p><div class="td-scores"><div><span>Version 1</span><b>' + tdEsc(v1 && v1.score != null ? v1.score : '—') + '</b></div><div><span>Version 2</span><b>' + (done ? tdEsc(v2.score) : '—') + '</b></div>' + gain + '</div>';
  }
  var ledger = document.getElementById('td-ledger');
  if (ledger) ledger.innerHTML = tdLedger(v1, done, v2);
  var list = document.getElementById('td-short');
  if (list) list.innerHTML = tdShort(v1, done);
  var diff = document.getElementById('td-diff');
  if (diff) diff.innerHTML = tdDiff(v1, done, v2);
  var time = document.getElementById('td-time');
  if (time) time.innerHTML = tdTime(v1, done, v2);
  var demo = document.getElementById('td-demo');
  if (demo && !demo.dataset.bound) {
    demo.dataset.bound = '1';
    demo.addEventListener('click', function () {
      var path = (location.pathname || '/').replace(/\/+$/, '') || '/';
      location.href = path + '?demo=1';
    });
  }
  var city = (self.state.briefV2 && self.state.briefV2.city) || self.state.city || 'Los Angeles';
  var captionText = (self.state.idea || '').slice(0, 80) + ' · ' + city;
  tdMountMap(city, captionText);
  tdMaybeDemo(self, lines);
}

function tdDemoPace() {
  var q = queryFlag('pace');
  if (q === '0') return 0;
  var n = Number(q);
  if (q !== '' && isFinite(n) && n >= 0) return n;
  return 900;
}

function tdMaybeDemo(self, lines) {
  if (queryFlag('demo') !== '1') return;
  if (!self.state || !self.state.apiV1 || self.state.applied || self.state.acting || self._tdDemoApplied || self._tdDemoTimer) return;
  var pace = tdDemoPace();
  if (pace === 0 || !lines.length) {
    self._tdDemoApplied = true;
    self.applyProposal();
    return;
  }
  var index = 0;
  var tick = function () {
    var node = document.getElementById('td-caption');
    if (node && lines[index]) node.textContent = lines[index];
    index += 1;
    if (index >= lines.length) {
      self._tdDemoTimer = null;
      self._tdDemoApplied = true;
      if (!self.state.applied && !self.state.acting) self.applyProposal();
      return;
    }
    self._tdDemoTimer = setTimeout(tick, pace);
  };
  self._tdDemoTimer = setTimeout(tick, pace);
}

function tdFlushFlow() {
  tdPaintQueued = false;
  if (!tdFlowHost) return;
  try { tdPaintFlow(tdFlowHost); } catch (err) {
    try { console.warn('[flow]', err); } catch (e) { /* ignore */ }
  }
}

function tdScheduleFlow() {
  if (tdPaintQueued) return;
  tdPaintQueued = true;
  var run = function () { tdFlushFlow(); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 16);
}

function tdInstallFlow() {
  if (typeof document !== 'undefined' && !document.documentElement.dataset.tdApprove) {
    document.documentElement.dataset.tdApprove = '1';
    document.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest || !target.closest('#td-approve') || !tdFlowHost) return;
      if (tdFlowHost.state && tdFlowHost.state.applied) return;
      tdFlowHost.applyProposal();
    });
  }
  if (typeof Component === 'undefined' || !Component.prototype || typeof Component.prototype.renderVals !== 'function' || typeof document === 'undefined') return;
  var orig = Component.prototype.renderVals;
  Component.prototype.renderVals = function () {
    var view = orig.apply(this, arguments);
    tdFlowHost = this;
    tdScheduleFlow();
    return view;
  };
  setTimeout(tdScheduleFlow, 40);
  setTimeout(tdScheduleFlow, 240);
}

tdInstallFlow();
