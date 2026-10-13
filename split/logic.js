const STEPS = ['Structuring your audience', 'Resolving cultural references', 'Mapping location', 'Finding cross-domain cultural signals', 'Evaluating cultural friction'];

function copyFor(provider) {
  const id = String(provider || 'sample').toLowerCase();
  if (SOURCE_LABELS[id]) return sourceCopy(id);
  const label = id || 'evidence';
  return {
    id: label,
    badge: label,
    found: 'หลักฐานพบว่า',
    points: 'หลักฐานชี้ว่า',
    derived: 'Derived from ' + label + ' cultural signals · our deterministic model',
    derivedTitle: 'Calculated by our deterministic model from the evidence provider. The score is not a provider score.',
    modal: 'Signal นี้มาจาก ' + label + ' ส่วนคะแนนคำนวณโดยโมเดลของเรา',
    panel: label + ' + deterministic evaluation',
    on: String(label).toUpperCase() + ' ON',
    off: String(label).toUpperCase() + ' OFF',
    fold: label + ' OFF / ON',
    switchLabel: label + ' evidence mode'
  };
}

function levelRank(level) {
  const v = String(level || '').toLowerCase();
  if (v === 'strong' || v === 'high' || v === '3') return 3;
  if (v === 'moderate' || v === 'medium' || v === 'mod' || v === '2') return 2;
  return 1;
}

function levelLabel(level) {
  const rank = levelRank(level);
  if (rank === 3) return 'Strong';
  if (rank === 2) return 'Moderate';
  return 'Limited';
}

class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = {
      phase: props.phase || 'input', step: 0,
      idea: DEFAULT_IDEA, ageIdx: 0, city: 'Los Angeles', interests: '', pos: 'Premium',
      refs: ['Comme des Garçons', 'Muji', 'Aphex Twin', 'Lost in Translation', 'Silver Lake'], refDraft: '',
      applied: false, ver: 1, busy: false, busyText: '', toast: '', muted: [], anim: null,
      modal: null, draft: null, confirmDiscard: false, evSel: 0,
      open: {}, evOpen: false, whyOpen: false, qFold: false, qOn: true,
      analyzeError: '', analyzeHint: '', analyzeDetail: '', failedStep: -1,
      resultError: '', stale: false, fixNote: '', unresolved: [], canFixRef: false,
      acting: false, dismissed: false, mode: 'local',
      projectId: '', simulationId: '', apiV1: null, apiV2: null
    };
    this._gen = 0;
    this.timers = [];
    this.onKey = this.onKey.bind(this);
    if (this.state.phase === 'result' && !readApiBase(props)) {
      this.state.apiV1 = buildLocalResult(this.briefFrom(this.state, false));
      this.state.apiV2 = buildLocalResult(this.briefFrom(this.state, true));
    }
  }
  componentDidMount() {
    try { document.addEventListener('keydown', this.onKey); } catch (e) { /* ignore */ }
    const preset = presetBrief();
    if (preset && this.state.phase === 'input') {
      this.setState(preset, () => this.mountFlow());
      return;
    }
    this.mountFlow();
  }
  mountFlow() {
    if (this.state.phase === 'analyzing' || (this.state.phase === 'result' && this.apiBase() && !this.state.apiV1)) {
      this._gen += 1;
      const gen = this._gen;
      if (this.state.phase !== 'analyzing') {
        this.setState({ phase: 'analyzing', step: 0, analyzeError: '', resultError: '' }, () => this.runPipeline(gen, 'start'));
      } else this.runPipeline(gen, 'start');
    } else if (this.wantsAutostart() && this.state.phase === 'input') this.beginTest();
  }
  componentDidUpdate(prev) {
    if (prev.phase !== this.props.phase && this.props.phase && this.props.phase !== this.state.phase) {
      this._gen += 1;
      const gen = this._gen;
      this.clearTimers();
      const phase = this.props.phase;
      this.setState({ phase: phase, step: 0, applied: false, ver: 1, busy: false, modal: null, analyzeError: '', resultError: '', stale: false }, () => {
        if (phase === 'analyzing' || (phase === 'result' && this.apiBase())) this.runPipeline(gen, 'start');
        else if (phase === 'result' && !this.state.apiV1) {
          this.setState({
            apiV1: buildLocalResult(this.briefFrom(this.state, false)),
            apiV2: buildLocalResult(this.briefFrom(this.state, true)),
            mode: 'local'
          });
        }
      });
    }
  }
  componentWillUnmount() {
    this._gen += 1;
    this.clearTimers();
    try { document.removeEventListener('keydown', this.onKey); } catch (e) { /* ignore */ }
  }
  clearTimers() { this.timers.forEach((t) => clearTimeout(t)); this.timers = []; }
  later(fn, ms) { this.timers.push(setTimeout(fn, ms)); }
  toastMsg(text) {
    this.setState({ toast: text });
    this.later(() => {
      if (this.state.toast === text) this.setState({ toast: '' });
    }, 4500);
  }
  top() { try { window.scrollTo({ top: 0 }); } catch (e) { /* ignore */ } }
  apiBase() { return readApiBase(this.props); }
  wantsAutostart() {
    const q = queryFlag('autostart');
    const demo = queryFlag('demo');
    return q === '1' || q === 'true' || demo === '1';
  }
  paceMs() {
    const q = queryFlag('pace');
    if (q !== '') {
      const n = Number(q);
      if (isFinite(n) && n >= 0) return n;
    }
    return 110;
  }
  client() {
    const fetchImpl = typeof fetch === 'function' ? fetch.bind(typeof window !== 'undefined' ? window : globalThis) : null;
    return createTasteApi(this.apiBase(), fetchImpl);
  }
  setStateAsync(partial) {
    const self = this;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      try { self.setState(partial, finish); } catch (e) { finish(); }
      setTimeout(finish, 80);
    });
  }
  noteProgress(origin, step, detail) {
    const patch = { step: step, analyzeDetail: detail, failedStep: -1 };
    if (origin === 'rerun') patch.busyText = detail;
    this.setState(patch);
  }
  async runPipeline(gen, origin) {
    if (gen !== this._gen) return;
    const brief = this.briefFrom(this.state, false);
    const briefApplied = this.briefFrom(this.state, true);
    const note = (step, detail) => { if (gen === this._gen) this.noteProgress(origin, step, detail); };
    try {
      const outcome = this.apiBase()
        ? await this.runApiStages(gen, brief, note)
        : await this.runLocalStages(gen, brief, briefApplied, note);
      if (gen !== this._gen || !outcome) return;
      this.top();
      await this.setStateAsync({
        phase: 'result',
        step: STEPS.length,
        busy: false,
        acting: false,
        stale: !!outcome.stale,
        applied: false,
        ver: 1,
        open: {},
        dismissed: false,
        analyzeError: '',
        resultError: '',
        analyzeDetail: '',
        unresolved: outcome.unresolved || [],
        canFixRef: !!(outcome.unresolved && outcome.unresolved.length)
      });
    } catch (err) {
      if (gen !== this._gen) return;
      if (err && err.code === 'aborted') return;
      this.failRun(err, origin);
    }
  }
  async runLocalStages(gen, brief, briefApplied, note) {
    const gap = this.paceMs();
    const alive = () => gen === this._gen;
    note(0, 'กำลังจัดโครงสร้างกลุ่มเป้าหมายจาก brief');
    if (!(brief.idea || '').trim()) throw apiError('invalid', 'ใส่ idea ก่อนทดสอบ', { step: 0 });
    await waitMs(gap);
    if (!alive()) return null;
    note(1, 'กำลังจับคู่ references กับข้อมูลตัวอย่าง');
    let packet;
    try { packet = provideEvidence(brief); }
    catch (e) { if (e.step == null) e.step = 1; throw e; }
    await waitMs(gap);
    if (!alive()) return null;
    note(2, 'กำลังวางย่านของ ' + (brief.city || ''));
    districtsFor(brief.city);
    await waitMs(gap);
    if (!alive()) return null;
    note(3, 'กำลังอ่านสัญญาณข้ามโดเมน');
    try { deriveSubs(packet); }
    catch (e) { if (e.step == null) e.step = 3; throw e; }
    await waitMs(gap);
    if (!alive()) return null;
    note(4, 'กำลังประเมิน cultural friction');
    let v1;
    let v2;
    try {
      v1 = buildLocalResult(brief);
      v2 = buildLocalResult(Object.assign({}, brief, { applied: false, posture: 'accessible' }));
    } catch (e) { if (e.step == null) e.step = 4; throw e; }
    if (!alive()) return null;
    await this.setStateAsync({ apiV1: v1, apiV2: v2, mode: 'local', projectId: '', simulationId: '' });
    return { stale: false, unresolved: v1.unresolved || [] };
  }
  async runApiStages(gen, brief, note) {
    const api = this.client();
    const cancelled = () => gen !== this._gen;
    note(0, 'กำลังจัดโครงสร้างกลุ่มเป้าหมายจาก brief');
    if (!(brief.idea || '').trim()) throw apiError('invalid', 'ใส่ idea ก่อนทดสอบ', { step: 0 });
    note(1, 'กำลังส่ง brief ไปสร้างโปรเจกต์และจับคู่ references');
    let project;
    try { project = await api.createProject(brief); }
    catch (e) { if (e.step == null) e.step = 1; throw e; }
    if (cancelled()) return null;
    note(2, 'กำลังส่งเมือง ' + brief.city + ' เข้าการจำลอง');
    let sim;
    try { sim = await api.createSimulation(project.id, brief, false); }
    catch (e) { if (e.step == null) e.step = 2; throw e; }
    if (cancelled()) return null;
    note(3, 'กำลังรอสัญญาณวัฒนธรรมจากการจำลอง');
    let raw = sim.body || {};
    try {
      if (!resultReady(raw)) {
        if (!sim.id) throw apiError('bad_payload', 'การจำลองยังไม่จบและไม่มีรหัสให้ติดตาม', { step: 3 });
        raw = await api.waitSimulation(sim.id, cancelled);
      }
      if (shouldBlockForEntity(raw)) throw entityError(raw);
    } catch (e) { if (e.step == null) e.step = 3; throw e; }
    if (cancelled()) return null;
    note(4, 'กำลังอ่าน ledger และประวัติเวอร์ชัน');
    let norm;
    let versions;
    try {
      norm = normalizeResult(raw);
      if (sim.id) norm.simulationId = norm.simulationId || sim.id;
      versions = await api.listVersions(project.id);
    } catch (e) { if (e.step == null) e.step = 4; throw e; }
    if (cancelled()) return null;
    let v2 = null;
    for (let i = 0; i < versions.length; i++) {
      if (Number(versions[i].version) === 2 && versions[i].score != null) v2 = versions[i];
    }
    await this.setStateAsync({
      apiV1: norm,
      apiV2: v2,
      mode: 'api',
      projectId: project.id,
      simulationId: norm.simulationId || sim.id || ''
    });
    return {
      stale: String(norm.status || '').toLowerCase() === 'stale',
      unresolved: norm.unresolved || []
    };
  }
  failRun(err, origin) {
    const step = err && err.step != null ? err.step : this.state.step;
    const unresolved = (err && err.unresolved) || [];
    const canFix = !!(err && err.code === 'entity_not_found');
    const where = STEPS[step] ? ('ขั้น ' + STEPS[step] + '. ') : '';
    const hint = where + ((err && err.hint) || '');
    const message = (err && err.message) || 'วิเคราะห์ไม่สำเร็จ';
    if (origin === 'rerun' && this.state.apiV1) {
      this.setState({
        phase: 'result', busy: false, acting: false, stale: true,
        resultError: message, analyzeHint: hint, analyzeError: '',
        failedStep: step, unresolved: unresolved, canFixRef: canFix, analyzeDetail: ''
      });
      return;
    }
    this.setState({
      phase: 'analyzing', busy: false, acting: false,
      analyzeError: message, analyzeHint: hint, resultError: '',
      failedStep: step, step: step, unresolved: unresolved, canFixRef: canFix, analyzeDetail: ''
    });
  }
  retryAnalysis() {
    const origin = this.state.phase === 'result' && this.state.apiV1 ? 'rerun' : 'start';
    this._gen += 1;
    const gen = this._gen;
    this.clearTimers();
    const patch = { analyzeError: '', resultError: '', failedStep: -1, canFixRef: false, analyzeHint: '' };
    if (origin === 'start') {
      patch.phase = 'analyzing';
      patch.step = 0;
      patch.stale = false;
      this.top();
    } else {
      patch.busy = true;
      patch.busyText = 'กำลังชนกับวัฒนธรรมใหม่';
      patch.stale = true;
    }
    this.setState(patch, () => { if (gen === this._gen) this.runPipeline(gen, origin); });
  }
  beginTest() {
    this._gen += 1;
    const gen = this._gen;
    this.clearTimers();
    this.top();
    this.setState({
      phase: 'analyzing', step: 0, failedStep: -1, analyzeError: '', analyzeHint: '', analyzeDetail: '',
      applied: false, ver: 1, open: {}, modal: null, dismissed: false, busy: false, acting: false,
      resultError: '', stale: false, canFixRef: false, unresolved: [], fixNote: ''
    }, () => { if (gen === this._gen) this.runPipeline(gen, 'start'); });
  }
  fixReference() {
    this._gen += 1;
    this.clearTimers();
    const fromState = this.state.unresolved || [];
    const fromResult = (this.state.apiV1 && (this.state.apiV1.unresolved || []).concat(this.state.apiV1.inferred || [])) || [];
    const names = fromState.length ? fromState : fromResult;
    this.setState({
      phase: 'input', busy: false, acting: false, analyzeError: '', resultError: '',
      modal: null, draft: null, unresolved: names, canFixRef: names.length > 0,
      fixNote: names.length
        ? ('ไม่พบหรือยังตีความไม่ได้สำหรับ ' + names.join(', ') + ' — ลบหรือแก้ชื่อ แล้วทดสอบใหม่')
        : 'แก้ cultural references แล้วทดสอบใหม่'
    }, () => {
      try {
        const el = document.querySelector('.byb-addrow input');
        if (el) el.focus();
      } catch (e) { /* ignore */ }
    });
  }
  animateScore(a, b) {
    for (let v = a + 1; v <= b; v++) this.later(() => this.setState({ anim: v }), (v - a) * 75);
    this.later(() => this.setState({ anim: null }), (b - a + 1) * 75);
  }
  applyProposal() {
    if (this.state.acting || this.state.busy) return;
    const base = this.apiBase();
    this.setState({ modal: null, draft: null, confirmDiscard: false });
    try { if (this.lastFocus && this.lastFocus.focus) this.lastFocus.focus(); } catch (e) { /* ignore */ }
    if (!base) {
      const v1 = this.state.apiV1 || buildLocalResult(this.briefFrom(this.state, false));
      const v2 = this.state.apiV2 || buildLocalResult(this.briefFrom(this.state, true));
      const a = v1.score;
      const b = v2.score;
      this.setState({ busy: false, applied: true, ver: 2, open: {}, apiV1: v1, apiV2: v2, anim: b > a ? a : null, resultError: '', stale: false, dismissed: false });
      this.toastMsg('Version 2 พร้อมแล้ว · resonance ' + a + ' → ' + b);
      this.top();
      if (b > a) this.animateScore(a, b);
      return;
    }
    this.setState({ acting: true, busy: true, busyText: 'กำลังจำลอง Version 2', resultError: '' });
    this.applyViaApi();
  }
  async applyViaApi() {
    const gen = this._gen;
    const api = this.client();
    const first = recommendationIds(this.state.apiV1)[0] || '';
    if (!first) {
      this.setState({ busy: false, acting: false, resultError: 'ไม่มีรหัสข้อเสนอให้ apply', analyzeHint: 'ผลจำลองควรมี recommendationId หรือ proposals[].id' });
      return;
    }
    try {
      const seen = {};
      let nextId = first;
      let lastSim = null;
      let guard = 0;
      while (nextId && guard < 4) {
        if (seen[nextId]) break;
        seen[nextId] = true;
        guard += 1;
        const body = await api.applyRecommendation(nextId);
        if (gen !== this._gen) return;
        if (shouldBlockForEntity(body)) throw entityError(body);
        const sim = body && body.simulation ? body.simulation : body;
        if (shouldBlockForEntity(sim)) throw entityError(sim);
        const status = String((sim && sim.status) || (body && body.status) || '');
        const pendingId = sim && (sim.id || sim.simulationId);
        if (isPendingStatus(status) && pendingId) {
          const waited = await api.waitSimulation(pendingId, () => gen !== this._gen);
          if (waited && (waited.score != null || waited.ledger)) lastSim = normalizeResult(waited);
          nextId = openProposalId(waited, seen);
          continue;
        }
        if (isErrorStatus(status)) {
          throw apiError('failed', (sim && (sim.error || sim.message)) || 'การจำลองล้มเหลว', { hint: 'ลองรันการวิเคราะห์อีกครั้ง' });
        }
        if (sim && (sim.score != null || sim.ledger)) {
          lastSim = normalizeResult(sim);
          nextId = '';
          continue;
        }
        nextId = openProposalId(sim, seen);
      }
      if (gen !== this._gen) return;
      const v2 = lastSim;
      if (!v2 || v2.score == null) throw apiError('bad_payload', 'ยังไม่เห็น Version 2 หลัง apply', { hint: 'POST apply ควรคืน simulation พร้อม score' });
      const a = this.state.apiV1 ? this.state.apiV1.score : 0;
      const b = v2.score;
      this.setState({
        busy: false, acting: false, applied: true, ver: 2, open: {}, apiV2: v2,
        resultError: '', stale: String(v2.status || '').toLowerCase() === 'stale', anim: b > a ? a : null
      });
      this.toastMsg('Version 2 พร้อมแล้ว · resonance ' + a + ' → ' + b);
      this.top();
      if (b > a) this.animateScore(a, b);
    } catch (err) {
      if (gen !== this._gen) return;
      this.setState({
        busy: false, acting: false,
        resultError: (err && err.message) || 'จำลอง Version 2 ไม่สำเร็จ',
        analyzeHint: (err && err.hint) || '',
        canFixRef: !!(err && err.code === 'entity_not_found'),
        unresolved: (err && err.unresolved) || this.state.unresolved
      });
    }
  }
  dismissProposal() {
    const self = this;
    const base = this.apiBase();
    const ids = recommendationIds(this.state.apiV1);
    if (!base || !ids.length) { this.closeModal(); return; }
    if (this.state.acting) return;
    this.setState({ acting: true, busy: true, busyText: 'กำลังปิดข้อเสนอ' });
    const api = this.client();
    const run = async () => {
      for (let i = 0; i < ids.length; i++) await api.dismissRecommendation(ids[i]);
    };
    run().then(() => {
      self.setState({ acting: false, busy: false, dismissed: true });
      self.closeModal();
      self.toastMsg('ปิดข้อเสนอแล้ว');
    }).catch((err) => {
      self.setState({ acting: false, busy: false, resultError: (err && err.message) || 'ปิดข้อเสนอไม่สำเร็จ', analyzeHint: (err && err.hint) || '' });
      self.closeModal();
    });
  }

  openModal(name, draft) {
    try { this.lastFocus = document.activeElement; } catch (e) { this.lastFocus = null; }
    this.setState({ modal: name, draft: draft || null, confirmDiscard: false }, () => {
      this.later(() => {
        try {
          const root = document.getElementById('mdl');
          const first = root && root.querySelector('textarea, input[type=text], select, .byb-solid');
          if (first) first.focus();
        } catch (e) { /* ignore */ }
      }, 60);
    });
  }
  closeModal() {
    this.setState({ modal: null, draft: null, confirmDiscard: false });
    try { if (this.lastFocus && this.lastFocus.focus) this.lastFocus.focus(); } catch (e) { /* ignore */ }
  }
  isDirty() {
    const s = this.state, d = s.draft;
    if (!d) return false;
    if (s.modal === 'brief') return d.idea !== s.idea || d.ageIdx !== s.ageIdx || d.city !== s.city || d.pos !== s.pos;
    if (s.modal === 'refs') return JSON.stringify(d.refs) !== JSON.stringify(s.refs) || JSON.stringify(d.muted) !== JSON.stringify(s.muted);
    return false;
  }
  requestClose() {
    if (this.isDirty()) this.setState({ confirmDiscard: true });
    else this.closeModal();
  }
  onKey(e) {
    if (!this.state.modal) return;
    if (e.key === 'Escape') { e.preventDefault(); this.requestClose(); return; }
    if (e.key !== 'Tab') return;
    try {
      const root = document.getElementById('mdl');
      if (!root) return;
      const f = Array.prototype.slice.call(root.querySelectorAll('button:not([disabled]), input, select, textarea, [href]'));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    } catch (err) { /* ignore */ }
  }
  saveDraft() {
    const s = this.state, d = s.draft;
    if (!d) return;
    const patch = { modal: null, draft: null, stale: true, resultError: '', analyzeError: '' };
    if (s.modal === 'brief') {
      patch.idea = d.idea.trim() || s.idea;
      patch.ageIdx = d.ageIdx;
      patch.city = d.city;
      patch.pos = d.pos;
    } else if (s.modal === 'refs') {
      patch.refs = d.refs;
      patch.muted = d.muted;
    }
    try { if (this.lastFocus && this.lastFocus.focus) this.lastFocus.focus(); } catch (e) { /* ignore */ }
    this._gen += 1;
    const gen = this._gen;
    this.clearTimers();
    patch.busy = true;
    patch.busyText = 'กำลังชนกับวัฒนธรรมใหม่';
    this.setState(patch, () => { if (gen === this._gen) this.runPipeline(gen, 'rerun'); });
  }

  briefFrom(state, applied) {
    const brief = {
      idea: state.idea,
      age: AGES[state.ageIdx] || AGES[0],
      city: state.city,
      pos: state.pos,
      interests: state.interests || '',
      refs: (state.refs || []).filter((r) => (state.muted || []).indexOf(r) < 0),
      applied: !!applied
    };
    if (state.briefV2) brief.briefV2 = state.briefV2;
    return brief;
  }
  band(n) { return n >= 80 ? 'HIGH' : (n >= 60 ? 'MODERATE' : 'LOW'); }
  fmt(n) { return n > 0 ? '+' + n : (n < 0 ? '−' + Math.abs(n) : '0'); }
  segments(text, lex, counter) {
    if (!text) return [];
    const usable = [];
    const lookup = {};
    (lex || []).forEach((x) => {
      if (!x[0]) return;
      lookup[String(x[0]).toLowerCase()] = x[1];
      usable.push(String(x[0]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    });
    if (!usable.length) return [{ text: text, cls: '', style: '' }];
    usable.sort((a, b) => b.length - a.length);
    const re = new RegExp('(' + usable.join('|') + ')', 'gi');
    const out = [];
    String(text).split(re).forEach((part, i) => {
      if (part === '') return;
      if (i % 2 === 0) { out.push({ text: part, cls: '', style: '' }); return; }
      const cat = lookup[part.toLowerCase()];
      if (cat === 'persona' || cat === 'place') { out.push({ text: part, cls: 'byb-' + cat, style: '' }); return; }
      out.push({ text: part, cls: 'byb-hl byb-hl-' + cat, style: 'animation-delay:' + (300 + counter.n * 120) + 'ms' });
      counter.n++;
    });
    return out;
  }
  kernels(city, applied) {
    let h = 0;
    const name = String(city || '');
    for (let i = 0; i < name.length; i++) h = (h * 33 + name.charCodeAt(i)) >>> 0;
    const j = (h % 8) / 10;
    if (applied) return { min: { x: 3.9 + j, y: 2.5, s: 1.35 }, lux: { x: 1.3, y: 1.05, s: 0.72 } };
    return { min: { x: 4.05 + j, y: 2.35, s: 1.12 }, lux: { x: 1.35, y: 1.1, s: 0.95 } };
  }
  hexes(c) {
    const rows = [[1, 5], [0, 6], [0, 6], [1, 6], [2, 6], [3, 6], [4, 5]];
    const w = 1 / 7.5, h = w * 1.1547, H = 5.5 * h;
    const g = (cx, cy, k) => { const dx = cx - k.x, dy = (cy - k.y) * 0.866; return Math.exp(-(dx * dx + dy * dy) / (2 * k.s * k.s)); };
    const out = []; let i = 0;
    rows.forEach((range, r) => {
      for (let col = range[0]; col <= range[1]; col++) {
        const cx = col + (r % 2 ? 0.5 : 0);
        const dm = g(cx, r, c.min), dl = g(cx, r, c.lux);
        const gold = dl > dm && dl > 0.2;
        const bg = gold ? 'rgba(184,137,43,' + (0.16 + 0.74 * dl).toFixed(2) + ')' : 'rgba(23,24,43,' + (0.07 + 0.8 * dm).toFixed(2) + ')';
        out.push({ style: 'left:' + (cx * w * 100).toFixed(2) + '%;top:' + ((r * 0.75 / 5.5) * 100).toFixed(2) + '%;width:' + (w * 100).toFixed(2) + '%;height:' + ((h / H) * 100).toFixed(2) + '%;background:' + bg + ';animation-delay:' + (i * 12) + 'ms' });
        i++;
      }
    });
    return out;
  }
  pin(k, color) {
    const w = 1 / 7.5;
    return 'left:' + (k.x * w * 100 + w * 50).toFixed(2) + '%;top:' + ((k.y * 0.75 / 5.5) * 100 + (1 / 5.5) * 50).toFixed(2) + '%;--pin:' + color;
  }
  signalRows(list) {
    const self = this;
    return (list || []).map((x, i) => {
      const L = levelRank(x.level);
      const label = levelLabel(x.level);
      return {
        domain: x.domain, name: x.name, level: label, feeds: x.feeds || '', sources: x.sources || [],
        pipsCls: L === 2 ? 'byb-pips is-mod' : 'byb-pips',
        p1: 'on', p2: L >= 2 ? 'on' : '', p3: L >= 3 ? 'on' : '',
        open: () => {
          const aria = 'ดูหลักฐาน ' + x.name;
          self.setState({ evSel: i }, () => {
            self.openModal('evidence', null);
            self.lastFocus = { focus: function () {
              try {
                const nodes = document.querySelectorAll('button[aria-label]');
                for (let k = 0; k < nodes.length; k++) {
                  if (nodes[k].getAttribute('aria-label') === aria) { nodes[k].focus(); return; }
                }
              } catch (err) { /* ignore */ }
            } };
          });
        }
      };
    });
  }
  renderVals() {
    const s = this.state;
    const self = this;
    const city = (s.phase !== 'input' && s.briefV2 && s.briefV2.city) || s.city;
    const age = AGES[s.ageIdx];
    const active = s.refs.filter((r) => s.muted.indexOf(r) < 0);
    const n = active.length;
    const v1 = s.apiV1 || emptyResult();
    const v2 = s.apiV2 || null;
    const isV2 = !!(s.applied && s.ver === 2 && v2);
    const cur = isV2 ? v2 : v1;
    const districts = cur.districts || { min: [], lux: [] };
    const distMin = (districts.min || []).join(' · ');
    const distLux = (districts.lux || []).join(' · ');
    const limited = String(cur.evidenceStrength || '').toUpperCase() === 'LIMITED';
    const isAmbiguous = !!cur.ambiguous || String(cur.evidenceStrength || '').toUpperCase() === 'AMBIGUOUS';
    const liveTotal = (s.anim !== null && isV2) ? s.anim : cur.score;
    const shownLive = displayScore(liveTotal, limited ? 0 : 4);
    const shownFinal = displayScore(cur.score, limited ? 0 : 4);
    const copy = copyFor(cur.provider || (s.phase === 'result' ? 'sample' : 'sample'));
    const b = this.band(cur.score || 0);
    const pn = (v) => (v === 'HIGH' ? 'สูง' : (v === 'MODERATE' ? 'ปานกลาง' : 'ต่ำ'));
    const set = (o) => () => self.setState(o);
    const described = describeResult(this.briefFrom(s, isV2), cur);
    const signalList = this.signalRows(cur.signals || []);
    const sigCount = signalList.length;
    const doms = {};
    signalList.forEach((sig) => { if (sig.domain) doms[sig.domain] = true; });
    const domCount = Object.keys(doms).length;
    const lex = [];
    signalList.forEach((sig) => {
      const cat = sig.domain === 'Music' ? 'music' : (sig.domain === 'Location' ? 'place' : (sig.domain === 'Design' ? 'value' : 'fashion'));
      if (sig.name) lex.push([sig.name, cat]);
    });
    (cur.fits || []).forEach((f) => { if (f && f.text) lex.push([f.text, 'fashion']); });
    (districts.min || []).concat(districts.lux || []).forEach((name) => lex.push([name, 'place']));
    const counter = { n: 0 };
    const inference = this.segments(described.inferenceText, lex, counter);
    const mapCap = this.segments(described.mapCaption, lex, counter);
    const missing = {};
    (s.unresolved || []).concat(cur.unresolved || []).concat(cur.inferred || []).forEach((name) => { if (name) missing[name] = true; });
    const imgs = (self.props && self.props.refImages) || {};
    const metaOf = (r) => REF_EVIDENCE[r] || { type: 'Reference', fit: 'photo', image: '' };
    const cover = (r) => {
      const meta = metaOf(r);
      const type = meta.type || 'Reference';
      const shape = 'cv ' + (meta.fit === 'circle' ? 'rd' : 'sq') + (meta.fit === 'logo' ? ' logo' : '');
      const image = imgs[r] || meta.image || '';
      return { type: type, shape: shape, image: image, hasImage: !!image };
    };
    const hue = (str) => { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360; return 'background:linear-gradient(135deg,hsl(' + h + ',34%,40%),hsl(' + ((h + 48) % 360) + ',38%,56%))'; };

    const idx = signalList.length ? Math.min(s.evSel, signalList.length - 1) : 0;
    const sel = signalList[idx] || { domain: '', name: '', level: '', feeds: '', sources: [] };
    const ev = {
      domain: sel.domain, name: sel.name, level: sel.level,
      meaning: sel.name ? (sel.name + ' อยู่ในระดับ ' + sel.level + ' สำหรับคนวัย ' + age + ' ใน ' + city) : 'ยังไม่มี signal จากผลนี้',
      feeds: sel.feeds || '—',
      refs: (sel.sources || []).length ? sel.sources.join(', ') : 'ไม่มี reference ที่ผูกกับสัญญาณนี้'
    };

    let fits = (cur.fits || []).map((f) => ({ text: f.text, isNew: !!f.isNew }));
    if (!fits.length) fits = [{ text: 'ยังไม่พบจุดที่เข้ากันจากหลักฐานชุดนี้', isNew: false }];
    let fsrc = (cur.frictions || []).slice();
    if (!fsrc.length) fsrc = [{ text: 'ไม่พบแรงเสียดทานที่ชัด', why: 'หลักฐานชุดนี้ไม่ได้ชี้จุดที่วัฒนธรรมสะดุด' }];
    const frictions = fsrc.map((x, i) => ({
      text: x.text, why: x.why || '', open: !!s.open[i], chevCls: s.open[i] ? 'byb-wchev is-open' : 'byb-wchev',
      toggle: () => { const o = Object.assign({}, self.state.open); o[i] = !o[i]; self.setState({ open: o }); }
    }));
    const frictionNames = fsrc.map((f) => f.text).filter((t) => t && t.indexOf('ไม่พบ') !== 0);
    const proposalSrc = v1.proposals || [];
    const showProposalPreview = !s.applied && !s.dismissed && proposalSrc.length > 0;

    const ledgerDef = [['Anchor affinity', 'anchor'], ['Cross-domain fit', 'cross'], ['Local fit', 'local'], ['Audience fit', 'audience'], ['Cultural friction', 'friction']];
    const cell = (ledger, key) => (ledger && ledger[key] != null && ledger[key] !== '') ? this.fmt(ledger[key]) : '—';
    const ledger = ledgerDef.map((x) => ({
      label: x[0],
      v1: cell(v1.ledger, x[1]),
      v2: s.applied && v2 ? cell(v2.ledger, x[1]) : '—'
    }));
    const cmp = !v2 ? [] : [{ label: 'Resonance', v1: String(v1.score), v2: String(v2.score), delta: this.fmt(v2.score - v1.score) }].concat(
      [['Audience fit', 'audience'], ['Local fit', 'local'], ['Friction', 'friction']].map((x) => ({
        label: x[0],
        v1: cell(v1.ledger, x[1]),
        v2: cell(v2.ledger, x[1]),
        delta: (v1.ledger && v1.ledger[x[1]] != null && v2.ledger && v2.ledger[x[1]] != null) ? this.fmt(v2.ledger[x[1]] - v1.ledger[x[1]]) : '—'
      })));
    const changes = proposalSrc.filter((p) => p.before && p.after).map((p, i, arr) => ({ before: p.before, after: p.after, dot: i < arr.length - 1 }));

    const m = s.modal, dr = s.draft || {};
    const dirty = this.isDirty();
    const mt = {
      brief: ['แก้ concept และกลุ่มเป้าหมาย', s.applied ? 'บันทึกแล้ว Agent จะประเมินใหม่ และ V2 ปัจจุบันจะถูกล้างเพราะสร้างจาก brief เดิม' : 'บันทึกแล้ว Agent จะรันการประเมินใหม่ให้ทันที', 'บันทึกและประเมินใหม่', 'ยกเลิก'],
      refs: ['Taste playlist', 'จัดเพลย์ลิสต์รสนิยมที่ idea ของคุณอ้างอิง เปิดหรือปิดแต่ละรายการเพื่อกำหนดว่าอะไรถูกใช้เป็นหลักฐาน', 'บันทึกและประเมินใหม่', 'ยกเลิก'],
      proposal: ['Agent เสนอ ' + proposalSrc.length + ' การเปลี่ยนแปลง', 'ดูว่าอะไรจะเปลี่ยน เพราะอะไร แล้วค่อยตัดสินใจ', 'Apply และจำลอง V2', 'Dismiss'],
      compare: ['V1 เทียบ V2', 'ผลการจำลองใหม่เทียบกับ concept เดิม', 'ดู V2', 'ปิด'],
      evidence: ['หลักฐานเบื้องหลัง', 'ที่มาของ signal นี้และส่วนที่มันเข้าไปอยู่ในคะแนน', 'เข้าใจแล้ว', '']
    }[m] || ['', '', '', ''];
    const mDisabled = s.acting || (m === 'brief' && (!dirty || !(dr.idea || '').trim())) || (m === 'refs' && !dirty);
    const failAt = s.analyzeError ? s.failedStep : -1;
    const steps = STEPS.map((t, i) => {
      const isFail = failAt === i;
      const isDone = !isFail && i < (failAt >= 0 ? failAt : s.step);
      const isOn = !s.analyzeError && s.phase === 'analyzing' && i === s.step && s.step < STEPS.length;
      return { text: t, done: isDone, active: isOn, fail: isFail, cls: 'byb-step' + (isFail ? ' is-fail' : (isDone ? ' is-done' : (isOn ? ' is-on' : ''))) };
    });
    const progress = s.analyzeError ? Math.max(0, failAt) : Math.min(s.step, STEPS.length);
    const gain = v2 ? (v2.score - v1.score) : 0;
    const v2Limited = !!(v2 && String(v2.evidenceStrength || '').toUpperCase() === 'LIMITED');
    const clip = String(s.idea || '').replace(/\s+/g, ' ').trim();
    const shortIdea = clip.length > 140 ? clip.slice(0, 137) + '…' : clip;
    let grounded = sigCount + ' signals จาก ' + domCount + ' domains';
    if (distMin) grounded += ' ชี้ว่า ' + distMin + ' เป็นย่านที่เข้ากับ idea นี้ที่สุด';
    if (frictionNames.length) grounded += ' จุดที่ขัดคือ ' + frictionNames.join(' และ ');
    if (v2 && proposalSrc.length) grounded += ' ถ้าแก้ตามข้อเสนอ resonance จาก ' + v1.score + ' เป็น ' + v2.score;
    const unresolved = (s.unresolved && s.unresolved.length) ? s.unresolved : (cur.unresolved || []);
    let ambiguousNote = 'หลักฐานชุดนี้ตีความได้มากกว่าหนึ่งทาง ผลจึงไม่ควรอ่านเป็นข้อสรุปเดียว';
    if ((cur.inferred || []).length) ambiguousNote = 'references ที่ไม่มีในชุดตัวอย่างจึงเป็นการอนุมาน: ' + cur.inferred.join(', ') + '. แก้ชื่อหรือเพิ่มรายการที่รู้จัก';
    let agentLead = 'หลักฐานชุดนี้ไม่ได้ชี้จุดที่ควรแก้';
    if (s.applied && v2) {
      const left = displayScore(v1.score, String(v1.evidenceStrength || '').toUpperCase() === 'LIMITED' ? 0 : 4).text;
      const right = displayScore(v2.score, v2Limited ? 0 : 4).text;
      agentLead = 'ปรับแล้ว resonance ' + (gain >= 0 ? 'เพิ่มจาก ' : 'เปลี่ยนจาก ') + left + ' เป็น ' + right;
    } else if (proposalSrc.length || frictionNames.length) {
      agentLead = 'พบจุดที่วัฒนธรรมสะดุด ' + (frictionNames.length || proposalSrc.length) + ' จุด นี่คือสิ่งที่ฉันอยากเปลี่ยน';
    }
    let agentBtn = 'ดูข้อเสนอ';
    if (isV2) agentBtn = 'เทียบ V1 ↔ V2';
    else if (s.applied) agentBtn = 'ดู V2';
    const kernels = this.kernels(city, isV2);
    let scoreSentence = 'Idea นี้เข้ากับคนวัย ' + age + ' ใน ' + city + ' ในระดับ' + pn(b);
    if (frictionNames.length) scoreSentence += ' และมีจุดที่วัฒนธรรมสะดุด ' + frictionNames.length + ' จุด';
    else scoreSentence += ' และยังไม่เห็นจุดที่วัฒนธรรมสะดุดชัด';
    const derivedNote = copy.derived + ((cur.mixed || (cur.inferred || []).length) ? ' · unknown references are inferred' : '');
    let staleNote = 'brief เปลี่ยนแล้ว ผลนี้ยังเป็นรอบก่อนหน้า';
    if (s.resultError) staleNote = 'การประเมินรอบล่าสุดไม่สำเร็จ ตัวเลขด้านล่างยังเป็นรอบก่อน';
    else if (String(cur.status || '').toLowerCase() === 'stale') staleNote = 'แหล่งข้อมูลระบุว่าผลนี้ล้าสมัย';

    return {
      isInput: s.phase === 'input', isAnalyze: s.phase === 'analyzing', isResult: s.phase === 'result',
      idea: s.idea, interests: s.interests || '',
      ages: AGES.map((a, i) => ({ label: a, checked: i === s.ageIdx, pick: () => self.setState({ ageIdx: i }) })),
      poss: POS.map((p) => ({ label: p, checked: p === s.pos, pick: () => self.setState({ pos: p }) })),
      cities: Object.keys(CITIES).map((c) => ({ name: c, sel: c === s.city })),
      refs: s.refs.map((r, i) => ({
        name: r,
        cls: 'byb-chip' + (missing[r] ? ' is-missing' : ''),
        remove: () => self.setState({ refs: self.state.refs.filter((x, j) => j !== i) })
      })),
      onIdea: (e) => self.setState({ idea: e.target.value }),
      onInterests: (e) => self.setState({ interests: e.target.value }),
      onCity: (e) => self.setState({ city: e.target.value }),
      onRefDraft: (e) => self.setState({ refDraft: e.target.value }),
      addRef: () => { const v = (self.state.refDraft || '').trim(); if (v && self.state.refs.length < 8 && self.state.refs.indexOf(v) < 0) self.setState({ refs: self.state.refs.concat([v]), refDraft: '' }); },
      fixNote: s.fixNote, hasFixNote: !!s.fixNote,
      startTest: () => self.beginTest(),
      goInput: () => {
        self._gen += 1;
        self.clearTimers();
        self.top();
        self.setState({ phase: 'input', step: 0, applied: false, ver: 1, busy: false, acting: false, modal: null, open: {}, toast: '', analyzeError: '', resultError: '', stale: false, fixNote: '' });
      },
      anOver: s.analyzeError ? (s.canFixRef ? 'Reference not found' : 'Analysis stopped') : 'Understanding your concept',
      anTitle: 'กำลังทดสอบ idea ของคุณกับวัฒนธรรมของ ' + city,
      steps: steps, barStyle: 'width:' + Math.round((progress / STEPS.length) * 100) + '%',
      analyzeBusy: s.phase === 'analyzing' && !s.analyzeError,
      hasAnalyzeDetail: !!s.analyzeDetail && !s.analyzeError,
      analyzeDetail: s.analyzeDetail,
      analyzeError: s.analyzeError, hasAnalyzeError: !!s.analyzeError, analyzeHint: s.analyzeHint,
      retryAnalysis: () => self.retryAnalysis(),
      fixReference: () => self.fixReference(),
      canFixRef: !!s.canFixRef,
      showBack: !!s.analyzeError && !s.canFixRef,
      swCls: s.qOn ? 'is-on' : '', swLabel: s.qOn ? copy.on : copy.off,
      headToggle: () => { self.setState({ qOn: !self.state.qOn, qFold: true }, () => { try { document.getElementById('sec-evidence-compare').scrollIntoView({ behavior: 'smooth' }); } catch (e) { /* ignore */ } }); },
      busy: s.busy, busyText: s.busyText, wsCls: (s.busy ? 'is-busy' : '') + (s.stale ? ' is-stale' : ''),
      ver: isV2 ? 2 : 1, verLabel: isV2 ? 'Version 2' : 'Version 1',
      v1Cls: isV2 ? '' : 'is-on', v2Cls: isV2 ? 'is-on' : '', noV2: !s.applied,
      setV1: set({ ver: 1, open: {} }), setV2: () => { if (self.state.applied) self.setState({ ver: 2, open: {} }); },
      age: age, city: city, pos: s.pos, refCount: n, isV2: isV2,
      openBrief: () => self.openModal('brief', { idea: self.state.idea, ageIdx: self.state.ageIdx, city: self.state.city, pos: self.state.pos }),
      openRefs: () => self.openModal('refs', { refs: self.state.refs.slice(), muted: self.state.muted.slice(), refDraft: '' }),
      npInitial: s.idea.charAt(0).toUpperCase(), npCover: 'background:linear-gradient(135deg,#2F3FD6,#8B5CFF)',
      goAgent: () => { try { document.getElementById('sec-agent').scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* ignore */ } },
      plChips: s.refs.map((r) => Object.assign({
        name: r, initial: r.charAt(0).toUpperCase(), coverStyle: hue(r),
        cls: (s.muted.indexOf(r) < 0 ? 'pl-card' : 'pl-card is-off') + (missing[r] ? ' is-missing' : '')
      }, cover(r))),
      applied: s.applied,
      scoreV2Shown: v2 ? displayScore(s.anim !== null ? s.anim : v2.score, v2Limited ? 0 : 4).text : '—',
      mapBtn: s.evOpen ? 'ซ่อนแผนที่ย่าน' : 'ดูแผนที่ย่าน',
      agentHint: s.applied ? 'เทียบรายละเอียดทุกมิติได้ใน modal' : (proposalSrc.length ? 'รีวิวก่อน Apply ได้ Agent จะรันการประเมินซ้ำให้' : 'ไม่มีข้อเสนอจากหลักฐานชุดนี้'),
      scoreText: shownLive.text, scoreCls: s.stale ? 'ws-bn is-soft' : 'ws-bn',
      evidenceBadge: s.phase === 'result' ? copy.badge : (self.apiBase() ? 'API' : sourceCopy('sample').badge),
      derivedNote: derivedNote,
      derivedTitle: copy.derivedTitle,
      evidenceModalNote: copy.modal,
      evidencePanel: copy.panel,
      foldTitle: copy.fold,
      evidenceSwitchLabel: copy.switchLabel,
      onLabel: copy.on,
      offLabel: copy.off,
      bandLabel: b, bandCls: 'byb-band ' + (b === 'HIGH' ? 'is-high' : (b === 'MODERATE' ? 'is-mod' : 'is-low')),
      gain: gain,
      gainLabel: (gain > 0 ? '+' : (gain < 0 ? '−' : '')) + Math.abs(gain),
      evLabel: String(cur.evidenceStrength || 'LIMITED'),
      isLimited: limited && s.phase === 'result' && !!s.apiV1,
      evNote: limited ? 'Limited cultural evidence' : (isAmbiguous ? 'Ambiguous cultural evidence' : (n + ' references · ' + sigCount + ' signals')),
      scoreSentence: scoreSentence,
      isAmbiguous: isAmbiguous && s.phase === 'result' && !!s.apiV1,
      ambiguousNote: ambiguousNote,
      canEditEvidence: isAmbiguous && !!((cur.inferred || []).length || (cur.unresolved || []).length),
      showResultError: !!s.resultError && s.phase === 'result',
      resultError: s.resultError,
      isStale: !!s.stale && s.phase === 'result',
      staleNote: staleNote,
      staleRetry: !!s.stale && !s.resultError,
      hasUnresolved: unresolved.length > 0 && s.phase === 'result',
      unresolvedLabel: unresolved.join(', '),
      fits: fits, frictions: frictions,
      showProposalPreview: showProposalPreview,
      showAgentBtn: !!(s.applied || proposalSrc.length),
      changes: changes, hasChanges: changes.length > 0,
      agentLead: agentLead,
      agentBtn: agentBtn,
      agentAction: () => {
        const st = self.state;
        if (st.busy || st.acting) return;
        if (st.applied && st.ver === 2) self.openModal('compare', null);
        else if (st.applied) self.setState({ ver: 2, open: {} });
        else if ((st.apiV1 && st.apiV1.proposals || []).length) self.openModal('proposal', null);
      },
      evOpen: s.evOpen, evChev: s.evOpen ? 'chv is-open' : 'chv', toggleEv: () => self.setState({ evOpen: !self.state.evOpen }),
      sigCount: sigCount, domCount: domCount, inference: inference, mapCap: mapCap,
      signals: signalList,
      hexes: this.hexes(kernels),
      pinMin: this.pin(kernels.min, '#17182B'), pinLux: this.pin(kernels.lux, '#B8892B'),
      distMin: distMin, distLux: distLux, hasMin: !!distMin, hasLux: !!distLux,
      whyOpen: s.whyOpen, whyChev: s.whyOpen ? 'chv is-open' : 'chv', whyTitle: shownFinal.why,
      whyLimitNote: limited ? 'หัวข้อปัดเป็นขั้น 5 เพราะหลักฐานมีจำกัด · ตารางด้านล่างคือผลรวมจริง ' + cur.score : '',
      toggleWhy: () => self.setState({ whyOpen: !self.state.whyOpen }),
      v2Head: s.applied ? 'V2' : '', ledger: ledger, score1: String(v1.score), score2: v2 ? String(v2.score) : '—', ledgerV2: s.applied && v2 ? String(v2.score) : '—',
      qFold: s.qFold, qChev: s.qFold ? 'chv is-open' : 'chv', toggleQ: () => self.setState({ qFold: !self.state.qFold }),
      qOn: s.qOn, qOff: !s.qOn, onCls: s.qOn ? 'is-on' : '', offCls: s.qOn ? '' : 'is-on',
      setOn: set({ qOn: true }), setOff: set({ qOn: false }),
      genericQuote: '“' + (shortIdea || 'idea นี้') + ' น่าจะเข้ากับ ' + city + ' ได้ดี”',
      groundedQuote: grounded,
      qdiff: [
        { k: 'Evidence', off: 'ไม่มีแหล่งอ้างอิง', on: sigCount + ' signals · ' + domCount + ' domains' },
        { k: 'Location', off: 'ทั้งเมืองเหมือนกัน', on: distMin || city },
        { k: 'Score', off: 'ประมาณจากความรู้สึก', on: 'คำนวณได้ ' + v1.score },
        { k: 'Critique', off: 'ไม่มีจุดที่ตรวจได้', on: frictionNames.length ? (v2 && proposalSrc.length ? (proposalSrc.length + ' จุด → V2 ' + v2.score) : frictionNames.join(' · ')) : 'ไม่พบ friction ที่ชัด' }
      ],
      modal: !!m, mBrief: m === 'brief', mRefs: m === 'refs', mProposal: m === 'proposal', mCompare: m === 'compare', mEvidence: m === 'evidence',
      mTitle: mt[0], mDesc: mt[1], mPrimaryLabel: mt[2], mQuiet: mt[3], mHasQuiet: !!mt[3], mDisabled: mDisabled,
      mQuietAction: m === 'proposal' ? (() => self.dismissProposal()) : (() => self.requestClose()),
      backdrop: (e) => { if (e.target === e.currentTarget) self.requestClose(); },
      requestClose: () => self.requestClose(),
      confirmDiscard: s.confirmDiscard, keepEditing: set({ confirmDiscard: false }), discard: () => self.closeModal(),
      mPrimary: () => {
        const mm = self.state.modal;
        if (mm === 'brief' || mm === 'refs') self.saveDraft();
        else if (mm === 'proposal') self.applyProposal();
        else if (mm === 'compare') { self.setState({ ver: 2, open: {} }); self.closeModal(); }
        else self.closeModal();
      },
      dIdea: dr.idea != null ? dr.idea : '',
      onDIdea: (e) => { const v = e.target.value; self.setState({ draft: Object.assign({}, self.state.draft, { idea: v }) }); },
      dAges: AGES.map((a, i) => ({ label: a, checked: i === dr.ageIdx, pick: () => self.setState({ draft: Object.assign({}, self.state.draft, { ageIdx: i }) }) })),
      dPoss: POS.map((p) => ({ label: p, checked: p === dr.pos, pick: () => self.setState({ draft: Object.assign({}, self.state.draft, { pos: p }) }) })),
      dCities: Object.keys(CITIES).map((c) => ({ name: c, sel: c === dr.city })),
      onDCity: (e) => { const v = e.target.value; self.setState({ draft: Object.assign({}, self.state.draft, { city: v }) }); },
      dRefs: (dr.refs || []).map((r, i) => {
        const on = (dr.muted || []).indexOf(r) < 0;
        const rowCls = (on ? '' : 'is-off') + (missing[r] ? ' is-missing' : '');
        return Object.assign({
          name: r, on: on, initial: r.charAt(0).toUpperCase(), coverStyle: hue(r), rowCls: rowCls, swCls: on ? 'is-on' : '',
          toggle: () => { const x = self.state.draft; const mu = x.muted.indexOf(r) < 0 ? x.muted.concat([r]) : x.muted.filter((q) => q !== r); self.setState({ draft: Object.assign({}, x, { muted: mu }) }); },
          remove: () => { const x = self.state.draft; self.setState({ draft: Object.assign({}, x, { refs: x.refs.filter((q, j) => j !== i), muted: x.muted.filter((q) => q !== r) }) }); }
        }, cover(r));
      }),
      dRefDraft: dr.refDraft || '',
      onDRefDraft: (e) => { const v = e.target.value; self.setState({ draft: Object.assign({}, self.state.draft, { refDraft: v }) }); },
      addDRef: () => { const x = self.state.draft; const v = (x.refDraft || '').trim(); if (v && x.refs.length < 8 && x.refs.indexOf(v) < 0) self.setState({ draft: Object.assign({}, x, { refs: x.refs.concat([v]), refDraft: '' }) }); },
      dRefHint: (dr.refs ? dr.refs.filter((r) => (dr.muted || []).indexOf(r) < 0).length : 0) + ' รายการที่เปิดใช้ · สูงสุด 8 · แนะนำ 3 รายการขึ้นไปเพื่อให้หลักฐานพอ',
      props: proposalSrc, cmp: cmp,
      whyChanged: proposalSrc.map((p) => ({ text: p.why || (p.before + ' → ' + p.after) })),
      ev: ev, toast: s.toast
    };
  }
}
