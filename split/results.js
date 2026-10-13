/* Results demo. Numbers come from results-demo.json, which the agent test locks to the engine. */
function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function formatDelta(delta) {
  var n = Number(delta);
  if (!Number.isFinite(n)) return '';
  if (n > 0) return '+' + n;
  return String(n);
}

function framePhase(index) {
  if (index >= 5) return 'done';
  if (index >= 4) return 'shortlist';
  return 'score';
}

function changedDiffs(diff) {
  return (diff || []).filter(function (row) { return row.changed; });
}

function ledgerPairs(payload) {
  var v1 = payload.v1.rows;
  var v2 = payload.v2.rows;
  return v1.map(function (row, index) {
    var next = v2[index] || row;
    return {
      label: row.label,
      v1: row.points,
      v2: next.points,
      changed: row.points !== next.points,
      provenance: row.provenance,
      nextProvenance: next.provenance
    };
  });
}

function render(payload, phase, caption) {
  var page = document.getElementById('page');
  var done = phase === 'done';
  var showList = phase === 'shortlist' || done;
  page.setAttribute('data-phase', phase);
  document.getElementById('caption').textContent = caption || (done ? payload.captions[payload.captions.length - 1] : 'Press Demo mode. One click scores the default brief, ranks the diffs, and approves the top lift.');
  document.getElementById('honesty').textContent = payload.honesty;
  document.getElementById('score-card').innerHTML = scoreHtml(payload, done);
  document.getElementById('diff-card').innerHTML = diffHtml(payload, done);
  document.getElementById('agent-card').innerHTML = showList ? listHtml(payload) : '<p class="over">Agent</p><p class="empty">The shortlist appears after the engine ranks every simulated diff.</p>';
  document.getElementById('time-card').innerHTML = timeHtml(payload, done);
  var button = document.getElementById('demo');
  button.disabled = phase === 'score' || phase === 'shortlist';
  button.textContent = done ? 'Replay demo' : (phase === 'ready' ? 'Demo mode' : 'Running…');
}

function scoreHtml(payload, done) {
  var current = done ? payload.v2 : payload.v1;
  var gain = done ? '<span class="gain">Engine ' + esc(formatDelta(payload.v2.delta)) + '</span>' : '';
  return '<p class="over">Cultural resonance</p><div class="scores"><div class="score"><span>Version 1</span><b>' + esc(payload.v1.total) + '</b></div><div class="score' + (done ? '' : ' is-wait') + '"><span>Version 2</span><b>' + (done ? esc(payload.v2.total) : '—') + '</b></div>' + gain + '</div>' + ledgerHtml(payload, done, current);
}

function ledgerHtml(payload, done) {
  var rows = ledgerPairs(payload).map(function (row) {
    var prove = esc(row.provenance);
    if (done && row.nextProvenance !== row.provenance) prove += '<br>' + esc(row.nextProvenance);
    return '<div class="row' + (done && row.changed ? ' is-changed' : '') + '"><span>' + esc(row.label) + '</span><span class="n">' + esc(row.v1) + '</span><span class="n">' + (done ? esc(row.v2) : '—') + '</span><p class="prove">' + prove + '</p></div>';
  }).join('');
  return '<div class="ledger"><div class="row"><span></span><span class="n">V1</span><span class="n">V2</span></div>' + rows + '</div>';
}

function diffHtml(payload, done) {
  var why = done ? '<p class="why"><b>Why this version. </b>' + esc(payload.approved.why) + '</p>' : '';
  var cols = '<div class="cols"><div><p class="over">Version 1</p>' + fieldsHtml(payload.diff, 'before', done) + '</div><div><p class="over">Version 2</p>' + (done ? fieldsHtml(payload.diff, 'after', done) : '<p class="empty">Waiting for a person to approve the top diff.</p>') + '</div></div>';
  return '<p class="over">What changed</p>' + why + cols;
}

function fieldsHtml(diff, key, mark) {
  return '<div class="fields">' + diff.map(function (row) {
    var changed = mark && row.changed;
    var value = '<span class="v">' + esc(row[key]) + '</span>';
    if (changed && key === 'before') value = '<span class="was">' + esc(row.before) + '</span>';
    if (changed && key === 'after') value = '<span class="now">' + esc(row.after) + '</span>';
    return '<div class="field' + (changed ? ' is-changed' : '') + '"><span>' + esc(row.label) + '</span>' + value + '</div>';
  }).join('') + '</div>';
}

function listHtml(payload) {
  var cards = payload.shortlist.map(function (item) {
    var from = item.from == null ? 'none' : item.from;
    var to = item.to == null ? 'none' : item.to;
    return '<article class="prop"><div class="param">' + esc(item.param) + '</div><div><span class="was">' + esc(from) + '</span> → <span class="now">' + esc(to) + '</span></div><p>' + esc(item.why) + '</p><p class="meta">Engine ' + esc(formatDelta(item.predictedDelta)) + ' · ' + esc(item.evidenceRefs.join(', ')) + '</p></article>';
  }).join('');
  return '<p class="over">Top 3 of ' + esc(payload.considered) + ' simulated</p><div class="short">' + cards + '</div>';
}

function timeHtml(payload, done) {
  var items = payload.timeline.filter(function (tick) { return done || tick.id === 'v1'; });
  var html = items.map(function (tick) {
    return '<article class="tick"><strong>' + esc(tick.label) + '</strong><b>' + esc(tick.score) + '</b><p>' + esc(tick.title) + '</p><p>' + esc(tick.note) + '</p></article>';
  }).join('');
  if (!done) html += '<article class="tick"><strong>Version 2</strong><b>—</b><p>After approval</p></article>';
  return '<p class="over">Timeline</p><div class="time">' + html + '</div>';
}

function boot(payload) {
  var timers = [];
  var button = document.getElementById('demo');
  function stop() {
    timers.forEach(clearTimeout);
    timers = [];
  }
  function play() {
    stop();
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || /(?:\?|&)done=1(?:&|$)/.test(location.search)) {
      render(payload, 'done');
      return;
    }
    render(payload, 'score', payload.captions[0]);
    payload.captions.forEach(function (caption, index) {
      timers.push(setTimeout(function () {
        render(payload, framePhase(index), caption);
      }, index * 1100));
    });
  }
  button.disabled = false;
  button.addEventListener('click', play);
  if (/(?:\?|&)done=1(?:&|$)/.test(location.search)) render(payload, 'done');
  else render(payload, 'ready');
}

function showBootError(error) {
  var caption = document.getElementById('caption');
  if (caption) caption.textContent = error && error.message ? error.message : 'The results demo did not load.';
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function () {
    fetch('results-demo.json')
      .then(function (response) {
        if (!response.ok) throw new Error('The demo snapshot is missing.');
        return response.json();
      })
      .then(boot)
      .catch(showBootError);
  });
}
