// Thin client for the TasteDraft backend.
//
// Set the apiBase prop (or ?apiBase=) to an origin that this page can fetch.
// With no apiBase the screen never calls fetch and uses the local engine.
// The API server marks the served page (data-tastedraft-api="same-origin" and
// window.__TASTEDRAFT_API_BASE__) so the bundled screen calls that same origin.
//
// The .dc.html artifact sandbox often blocks fetch (CSP / opaque origin).
// This client does not work around that block. Serve dist/TasteDraft.dc.html
// from a normal HTTP server and point apiBase at a backend that allows CORS.
// A failed fetch inside that sandbox is reported as a sandbox error, with retry.

function apiError(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  err.unresolved = (extra && extra.unresolved) || [];
  err.hint = (extra && extra.hint) || '';
  err.status = extra && extra.status;
  if (extra && extra.step != null) err.step = extra.step;
  return err;
}

function sandboxHint() {
  return 'ไฟล์ .dc.html ใน artifact sandbox อาจบล็อก fetch. เสิร์ฟหน้านี้ผ่านเว็บเซิร์ฟเวอร์ปกติ แล้วชี้ apiBase ไปที่ backend ที่เปิด CORS. ถ้าไม่ตั้ง apiBase หน้านี้ใช้เอนจินในเครื่องและไม่ยิงเครือข่าย';
}

function isLikelySandbox() {
  try {
    if (typeof location === 'undefined') return false;
    const p = location.protocol;
    if (p === 'file:' || p === 'blob:' || p === 'about:' || p === 'data:') return true;
  } catch (e) {
    return true;
  }
  return false;
}

function classifyFetchError(err) {
  const raw = err && err.message ? err.message : String(err || '');
  const sandbox = isLikelySandbox() || /content security policy|\bCSP\b|blocked by client/i.test(raw);
  if (sandbox) return apiError('sandbox', 'สภาพแวดล้อมนี้บล็อก fetch จึงเรียก API ไม่ได้', { hint: sandboxHint() });
  return apiError('network', 'เรียก API ไม่สำเร็จ', { hint: 'ตรวจ apiBase, ว่าเซิร์ฟเวอร์ทำงาน, และ CORS. ' + sandboxHint() });
}

function strList(value) {
  if (!value) return [];
  if (typeof value === 'string') return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  const out = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item === 'string' && item) out.push(item);
    else if (item && typeof item === 'object') {
      const name = item.name || item.reference || item.text || '';
      if (name) out.push(String(name));
    }
  }
  return out;
}

function pickUnresolved(body) {
  if (!body || typeof body !== 'object') return [];
  const direct = strList(body.unresolved || body.missing || body.notFound || body.entitiesNotFound);
  if (direct.length) return direct;
  if (body.reference && isEntityCode(body.code || body.status || body.error)) return [String(body.reference)];
  if (body.name && isEntityCode(body.code || body.status || body.error)) return [String(body.name)];
  const fromSignals = [];
  const signals = body.signals || [];
  for (let i = 0; i < signals.length; i++) {
    const sources = signals[i].sources || [];
    for (let j = 0; j < sources.length; j++) {
      const src = sources[j];
      if (!src || typeof src !== 'object') continue;
      if (src.found === false || src.status === 'not_found' || src.status === 'entity_not_found') {
        if (src.name) fromSignals.push(String(src.name));
      }
    }
  }
  return fromSignals;
}

function isEntityCode(value) {
  const code = String(value || '').toLowerCase();
  return code.indexOf('entity_not_found') >= 0 || code === 'not_found' || code === 'unresolved' || code === 'ambiguous_entity';
}

function shouldBlockForEntity(body) {
  if (!body || typeof body !== 'object') return false;
  const code = String(body.code || body.status || body.error || '').toLowerCase();
  return code.indexOf('entity_not_found') >= 0 || code === 'unresolved';
}

function entityError(body) {
  const unresolved = pickUnresolved(body);
  const message = unresolved.length
    ? ('ไม่พบ ' + unresolved.join(', ') + ' เป็น cultural entity. แก้ reference แล้วลองใหม่')
    : 'ไม่พบ cultural entity ที่อ้างถึง. แก้ reference แล้วลองใหม่';
  return apiError('entity_not_found', message, {
    unresolved: unresolved,
    hint: 'กลับไปแก้รายการใน cultural references'
  });
}

function isPendingStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'pending' || s === 'running' || s === 'queued' || s === 'processing' || s === 'started';
}

function isReadyStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'ready' || s === 'complete' || s === 'completed' || s === 'ok' || s === 'succeeded' || s === 'success' || s === 'done' || s === 'stale' || s === 'ambiguous' || s === 'limited';
}

function isErrorStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'error' || s === 'failed' || s === 'failure';
}

function numOr(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return isFinite(n) ? n : fallback;
}

function ledgerTotal(ledger) {
  const keys = ['anchor', 'cross', 'local', 'audience', 'friction'];
  let any = false;
  let sum = 0;
  for (let i = 0; i < keys.length; i++) {
    if (ledger[keys[i]] == null || ledger[keys[i]] === '') continue;
    const n = Number(ledger[keys[i]]);
    if (!isFinite(n)) continue;
    any = true;
    sum += n;
  }
  return any ? sum : null;
}

function normalizeFit(item) {
  if (typeof item === 'string') return { text: item, isNew: false };
  if (!item || typeof item !== 'object') return { text: '', isNew: false };
  return { text: item.text || item.name || '', isNew: !!item.isNew };
}

function normalizeSignal(item) {
  const srcs = [];
  const raw = (item && item.sources) || [];
  for (let i = 0; i < raw.length; i++) {
    if (typeof raw[i] === 'string') srcs.push(raw[i]);
    else if (raw[i] && raw[i].name && raw[i].found !== false && raw[i].status !== 'not_found' && raw[i].status !== 'entity_not_found') {
      srcs.push(String(raw[i].name));
    }
  }
  return {
    domain: (item && item.domain) || '',
    name: (item && item.name) || '',
    level: (item && (item.level || item.strength)) || 'Limited',
    feeds: (item && item.feeds) || '',
    sources: srcs
  };
}

function normalizeResult(body) {
  const src = body && typeof body === 'object' ? body : {};
  const nested = src.result && typeof src.result === 'object' ? src.result : null;
  const data = nested && src.score == null && src.ledger == null ? nested : src;
  const ledgerIn = data.ledger || {};
  const districtsIn = data.districts || {};
  const signals = (data.signals || []).map(normalizeSignal).filter(function (s) { return s.domain || s.name; });
  const fits = (data.fits || []).map(normalizeFit).filter(function (f) { return f.text; });
  const frictions = (data.frictions || []).map(function (f) {
    return { text: (f && (f.text || f.name)) || '', why: (f && f.why) || '' };
  }).filter(function (f) { return f.text; });
  const proposals = (data.proposals || []).map(function (p, i) {
    return {
      id: (p && (p.id || p.recommendationId)) || ('rec-' + i),
      before: (p && p.before) || '',
      after: (p && p.after) || '',
      why: (p && p.why) || '',
      evidence: (p && p.evidence) || '',
      predictedDelta: p && p.predictedDelta != null ? p.predictedDelta : null,
      param: (p && p.param) || '',
      from: p && p.from != null ? p.from : null,
      to: p && p.to != null ? p.to : null
    };
  }).filter(function (p) { return p.before || p.after; });
  const strength = String(data.evidenceStrength || data.evidence || 'MEDIUM').toUpperCase();
  const status = String(data.status || 'ready');
  let score = data.score;
  if (score == null) score = ledgerTotal(ledgerIn);
  return {
    score: score == null ? null : numOr(score, 0),
    ledger: {
      anchor: ledgerIn.anchor == null ? null : numOr(ledgerIn.anchor, 0),
      cross: ledgerIn.cross == null ? null : numOr(ledgerIn.cross, 0),
      local: ledgerIn.local == null ? null : numOr(ledgerIn.local, 0),
      audience: ledgerIn.audience == null ? null : numOr(ledgerIn.audience, 0),
      friction: ledgerIn.friction == null ? null : numOr(ledgerIn.friction, 0)
    },
    evidenceStrength: strength,
    ambiguous: strength === 'AMBIGUOUS' || String(status).toLowerCase() === 'ambiguous' || !!data.ambiguous,
    inferred: strList(data.inferred),
    signals: signals,
    districts: { min: strList(districtsIn.min), lux: strList(districtsIn.lux) },
    fits: fits,
    frictions: frictions,
    proposals: proposals,
    provider: data.provider || data.sourceId || '',
    status: status,
    unresolved: pickUnresolved(data),
    recommendationId: data.recommendationId || data.recommendation_id || '',
    activeCount: data.activeCount != null ? data.activeCount : null,
    inferenceText: data.inferenceText || '',
    mapCaption: data.mapCaption || '',
    mixed: !!data.mixed,
    simulationId: data.simulationId || '',
    version: data.version || data.ver || null,
    story: data.story || null
  };
}

function errorFromHttp(status, data) {
  if (shouldBlockForEntity(data) || (status === 422 && pickUnresolved(data).length)) return entityError(data || {});
  const message = data && (typeof data.message === 'string' && data.message || typeof data.error === 'string' && data.error);
  return apiError(status >= 500 ? 'server' : 'http', message || ('API ตอบสถานะ ' + status), {
    status: status,
    hint: status >= 500 ? 'เซิร์ฟเวอร์ผิดพลาด ลองใหม่ได้' : 'คำขอไม่สำเร็จ'
  });
}

function waitMs(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function pickId(data) {
  if (!data || typeof data !== 'object') return '';
  return data.id || data.projectId || data.simulationId || (data.project && data.project.id) || (data.simulation && data.simulation.id) || '';
}

function projectPayload(brief) {
  const body = {
    idea: brief.idea,
    age: brief.age,
    city: brief.city,
    interests: brief.interests || '',
    positioning: brief.pos,
    references: brief.refs || []
  };
  if (brief.briefV2) body.briefV2 = brief.briefV2;
  return body;
}

function resultReady(data) {
  if (!data || typeof data !== 'object') return false;
  if (shouldBlockForEntity(data)) return false;
  const status = String(data.status || '');
  if (isErrorStatus(status) || isPendingStatus(status)) return false;
  if (data.score == null && !data.ledger) return false;
  if (isReadyStatus(status)) return true;
  return data.score != null && !!data.ledger;
}

function createTasteApi(base, fetchImpl) {
  const root = String(base || '').replace(/\/+$/, '');
  const doFetch = fetchImpl;

  async function request(method, path, body) {
    if (!root) throw apiError('no_base', 'ไม่ได้ตั้ง apiBase');
    if (typeof doFetch !== 'function') {
      throw apiError('sandbox', 'ไม่มี fetch ในสภาพแวดล้อมนี้', { hint: sandboxHint() });
    }
    let res;
    try {
      const headers = { Accept: 'application/json' };
      const init = { method: method, headers: headers };
      if (body != null) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      res = await doFetch(root + path, init);
    } catch (err) {
      throw classifyFetchError(err);
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch (e) { data = { message: String(text).slice(0, 180) }; }
    }
    if (!res.ok) throw errorFromHttp(res.status, data);
    return data || {};
  }

  return {
    base: root,
    request: request,
    createProject: async function (brief) {
      const data = await request('POST', '/api/projects', projectPayload(brief));
      if (shouldBlockForEntity(data)) throw entityError(data);
      const id = pickId(data);
      if (!id) throw apiError('bad_payload', 'API ไม่ได้คืนรหัสโปรเจกต์', { hint: 'POST /api/projects ควรคืน { id }' });
      return { id: id, body: data };
    },
    createSimulation: async function (projectId, brief, applied) {
      const data = await request('POST', '/api/simulations', Object.assign({ projectId: projectId, applied: !!applied }, projectPayload(brief)));
      if (shouldBlockForEntity(data)) throw entityError(data);
      const id = pickId(data);
      if (!id && !resultReady(data)) {
        throw apiError('bad_payload', 'API ไม่ได้คืนรหัสการจำลอง', { hint: 'POST /api/simulations ควรคืน { id, status }' });
      }
      return { id: id, body: data };
    },
    getSimulation: function (id) {
      return request('GET', '/api/simulations/' + encodeURIComponent(id));
    },
    waitSimulation: async function (id, isCancelled) {
      for (let i = 0; i < 30; i++) {
        if (isCancelled && isCancelled()) throw apiError('aborted', 'ยกเลิกการวิเคราะห์แล้ว');
        const data = await request('GET', '/api/simulations/' + encodeURIComponent(id));
        if (shouldBlockForEntity(data)) throw entityError(data);
        const status = String(data.status || '');
        if (isErrorStatus(status)) {
          throw apiError('failed', (typeof data.message === 'string' && data.message) || (typeof data.error === 'string' && data.error) || 'การจำลองล้มเหลว', { hint: 'ลองรันการวิเคราะห์อีกครั้ง' });
        }
        if (resultReady(data)) return data;
        await waitMs(i === 0 ? 200 : 450);
      }
      throw apiError('timeout', 'รอผลจำลองนานเกินไป', { hint: 'GET /api/simulations/:id ยังไม่เป็น ready' });
    },
    applyRecommendation: function (id) {
      return request('POST', '/api/recommendations/' + encodeURIComponent(id) + '/apply', {});
    },
    dismissRecommendation: function (id) {
      return request('POST', '/api/recommendations/' + encodeURIComponent(id) + '/dismiss', {});
    },
    listVersions: async function (projectId) {
      const data = await request('GET', '/api/projects/' + encodeURIComponent(projectId) + '/versions');
      const list = Array.isArray(data) ? data : ((data && (data.versions || data.items)) || []);
      const out = [];
      for (let i = 0; i < list.length; i++) {
        const item = list[i] || {};
        const versionNo = item.number || item.version || item.ver || (i + 1);
        const payload = item.score != null || item.ledger || (item.signals && item.signals.length)
          ? item
          : (item.result || item.simulation || null);
        if (!payload || (payload.score == null && !payload.ledger)) {
          out.push({
            version: versionNo,
            score: null,
            ledger: null,
            proposals: [],
            signals: [],
            fits: [],
            frictions: [],
            districts: { min: [], lux: [] },
            provider: '',
            status: item.origin || '',
            evidenceStrength: ''
          });
          continue;
        }
        const norm = normalizeResult(payload);
        norm.version = versionNo;
        if (item.simulationId) norm.simulationId = item.simulationId;
        out.push(norm);
      }
      return out;
    }
  };
}

function recommendationIds(result) {
  if (!result) return [];
  if (result.recommendationId) return [result.recommendationId];
  const ids = [];
  const list = result.proposals || [];
  for (let i = 0; i < list.length; i++) if (list[i].id) ids.push(list[i].id);
  return ids;
}

function openProposalId(sim, seen) {
  const proposals = (sim && sim.proposals) || [];
  for (let i = 0; i < proposals.length; i++) {
    const proposal = proposals[i];
    if (!proposal || !proposal.id || (seen && seen[proposal.id])) continue;
    if (String(proposal.status || 'open') !== 'open') continue;
    return proposal.id;
  }
  return '';
}

function readApiBase(props) {
  let value = props && props.apiBase != null ? String(props.apiBase).trim() : '';
  try {
    if (typeof location !== 'undefined' && location.search) {
      const params = new URLSearchParams(location.search);
      if (params.has('apiBase')) value = String(params.get('apiBase') || '').trim();
    }
  } catch (e) { /* ignore */ }
  if (!value || value === 'same-origin') {
    try {
      const marked = typeof document !== 'undefined' && document.documentElement && document.documentElement.getAttribute('data-tastedraft-api') === 'same-origin';
      const preset = (typeof window !== 'undefined' && window.__TASTEDRAFT_API_BASE__) ? String(window.__TASTEDRAFT_API_BASE__) : '';
      if (marked || value === 'same-origin' || preset) value = preset || ((typeof location !== 'undefined' && location.origin) ? location.origin : '');
    } catch (e) { /* ignore */ }
  }
  return String(value || '').replace(/\/+$/, '');
}

function queryFlag(name) {
  try {
    if (typeof location === 'undefined' || !location.search) return '';
    return new URLSearchParams(location.search).get(name) || '';
  } catch (e) {
    return '';
  }
}

function presetBrief() {
  if (queryFlag('brief') !== 'bangkok') return null;
  const place = 'urn:entity:place';
  const brand = 'urn:entity:brand';
  const entity = (id, name, type) => ({
    id: id,
    name: name,
    type: type,
    city: 'Bangkok',
    source: 'mock',
    image: 'https://example.invalid/tastedraft-mock/' + id + '.png'
  });
  return {
    idea: 'A late-night snack stall on a Bangkok night market row, grilled and eaten standing up',
    ageIdx: 0,
    pos: 'Mass',
    refs: ['Yaowarat Grill', 'Maa Kai Yang'],
    muted: [],
    interests: 'night market snack, charcoal street grill',
    briefV2: {
      idea: 'A late-night snack stall on a Bangkok night market row, grilled and eaten standing up',
      interests: [
        { id: 'td-mock-tag-night-market', name: 'night market snack', type: 'urn:tag:td-mock' },
        { id: 'td-mock-tag-street-grill', name: 'charcoal street grill', type: 'urn:tag:td-mock' }
      ],
      references: [
        entity('td-mock-entity-yaowarat-grill', 'Yaowarat Grill', place),
        entity('td-mock-entity-maa-kai-yang', 'Maa Kai Yang', brand)
      ],
      locations: [entity('td-mock-entity-yaowarat-grill', 'Yaowarat Grill', place)],
      city: 'Bangkok',
      age: '18–25',
      positioning: 'Mass',
      constraints: ['Serve after dusk']
    }
  };
}
