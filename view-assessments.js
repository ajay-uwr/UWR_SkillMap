/* Assessments: list + builder */
(function () {
  const { $, $$, esc, api, toast, badge, fmtDate } = App;
  const TYPES = App.QTYPES;
  let E = null, topicList = [], tagList = [], attTimer = null;

  const blank = () => ({
    id: null, status: 'draft', title: '', description: '', instructions: '',
    start_time: 0, end_time: 0, duration_min: 60, pass_mark: 50, negative_marking: 0,
    shuffle_questions: true, shuffle_options: true, max_violations: 3, ai_grading: true, human_review_all: false,
    sections: [{ name: 'Section 1', rules: [newRule()] }], emails: '', attempts_allowed: 1
  });
  function newRule() { return { type: 'mcq', topic: '', tag: '', difficulty: 'any', count: 5 }; }

  function fromServer(a) {
    const e = Object.assign(blank(), a);
    e.sections = a.sections.length ? a.sections : [];
    e.emails = a.assigned.map((x) => x.email).join('\n');
    e.attempts_allowed = a.assigned.length ? a.assigned[0].attempts_allowed : 1;
    return e;
  }

  function render(arg) { return arg ? editorView(arg) : listView(); }

  // ---------- list ----------
  async function listView() {
    const v = $('#view');
    v.innerHTML = '<p class="muted">Loading assessments...</p>';
    let list;
    try { list = await api('listAssessments'); } catch (e) { v.innerHTML = '<p class="error">' + esc(e.message) + '</p>'; return; }
    v.innerHTML = '<div class="page-head"><div><h1>Assessments</h1><p class="muted">Each assessment has its own sections, question rules and candidates.</p></div>' +
      '<a class="btn primary" href="#/assessments/new">New assessment</a></div>' +
      (list.length ? '<div class="table-wrap"><table><thead><tr><th>Title</th><th>Status</th><th>Window</th><th>Duration</th><th>Sections</th><th>Candidates</th></tr></thead><tbody>' +
        list.map((a) => '<tr class="click" data-id="' + esc(a.id) + '"><td><strong>' + esc(a.title) + '</strong></td><td>' + badge(a.status) + '</td>' +
          '<td>' + (a.start_time ? esc(fmtDate(a.start_time)) + '<div class="muted small">to ' + esc(fmtDate(a.end_time)) + '</div>' : '<span class="muted">Not set</span>') + '</td>' +
          '<td class="mono">' + a.duration_min + ' min</td><td class="mono">' + a.section_count + '</td><td class="mono">' + a.assigned_count + '</td></tr>').join('') +
        '</tbody></table></div>'
        : '<div class="panel empty"><p>No assessments yet.</p><a class="btn primary" href="#/assessments/new">Create the first one</a></div>');
    $$('#view tr.click').forEach((tr) => (tr.onclick = () => (location.hash = '#/assessments/' + tr.dataset.id)));
  }

  // ---------- editor ----------
  async function editorView(arg) {
    const v = $('#view');
    v.innerHTML = '<p class="muted">Loading...</p>';
    try {
      const qs = await api('listQuestions');
      const live = qs.filter((q) => q.status !== 'archived');
      topicList = Array.from(new Set(live.map((q) => q.topic))).sort();
      tagList = Array.from(new Set([].concat.apply([], live.map((q) => q.tags)))).sort();
      E = arg === 'new' ? blank() : fromServer(await api('getAssessment', { id: arg }));
    } catch (e) { v.innerHTML = '<p class="error">' + esc(e.message) + '</p>'; return; }
    draw();
  }

  const fld = (label, inner, hint) => '<div class="field"><label>' + label + '</label>' + inner + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
  const chk = (k, label) => '<label class="check" style="margin-bottom:.6rem"><input type="checkbox" data-k="' + k + '"' + (E[k] ? ' checked' : '') + '> ' + label + '</label>';

  function draw() {
    const v = $('#view'), locked = E.status !== 'draft', tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const negOpts = [['0', 'No negative marking'], ['0.25', 'Deduct 1/4 of the marks'], ['0.3333', 'Deduct 1/3 of the marks'], ['0.5', 'Deduct 1/2 of the marks']];
    let actions = '';
    if (E.status === 'draft') actions = '<button class="btn" id="a-save">Save draft</button><button class="btn primary" id="a-publish">Publish</button>';
    if (E.status === 'published') actions = '<button class="btn" data-st="draft">Move back to draft</button><button class="btn" data-st="closed">Close</button>';
    if (E.status === 'closed') actions = '<button class="btn" data-st="published">Reopen</button><button class="btn" data-st="archived">Archive</button>';
    if (E.status === 'archived') actions = '<button class="btn" data-st="closed">Unarchive</button>';
    if (E.status === 'draft' && E.id) actions += '<button class="btn ghost danger" data-st="archived">Archive</button>';

    v.innerHTML =
      '<div class="page-head"><div><p class="small"><a href="#/assessments">All assessments</a></p><h1>' + esc(E.id ? E.title || 'Assessment' : 'New assessment') + '</h1>' +
      (E.id ? '<p>' + badge(E.status) + ' <span class="muted small">' + esc(E.id) + '</span></p>' : '') + '</div><div class="row">' + actions + '</div></div>' +
      '<p id="as-err" class="error" role="alert" hidden></p>' +
      (locked ? '<div class="panel"><strong>This assessment is ' + esc(E.status) + '.</strong> Settings are locked. Move it back to draft to edit (only possible before anyone has started).</div>' : '') +
      '<div id="as-form"><fieldset ' + (locked ? 'disabled' : '') + '>' +
      '<div class="panel"><h3>Basics</h3>' +
      fld('Title', '<input data-k="title" value="' + esc(E.title) + '" placeholder="e.g. Trainer assessment, August batch">') +
      fld('Description (internal)', '<textarea data-k="description" rows="2">' + esc(E.description) + '</textarea>') +
      fld('Instructions for candidates', '<textarea data-k="instructions" rows="5">' + esc(E.instructions) + '</textarea>', 'Shown on the start screen before the exam begins.') + '</div>' +

      '<div class="panel"><h3>Schedule</h3><div class="grid3">' +
      fld('Window opens', '<input type="datetime-local" data-k="start_time" data-t="dt" value="' + App.toLocalInput(E.start_time) + '">', 'Time zone: ' + esc(tz)) +
      fld('Window closes', '<input type="datetime-local" data-k="end_time" data-t="dt" value="' + App.toLocalInput(E.end_time) + '">', 'Candidates can begin between these two times.') +
      fld('Duration (minutes)', '<input type="number" min="1" max="300" data-k="duration_min" value="' + esc(E.duration_min) + '">', 'The window must be at least this long.') + '</div></div>' +

      '<div class="panel"><h3>Scoring and exam rules</h3><div class="grid3">' +
      fld('Pass mark (%)', '<input type="number" min="0" max="100" data-k="pass_mark" value="' + esc(E.pass_mark) + '">') +
      fld('Negative marking', '<select data-k="negative_marking">' + negOpts.map((o) => '<option value="' + o[0] + '"' + (Number(E.negative_marking) === Number(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>', 'Applies to wrong single and multiple choice answers.') +
      fld('Auto-submit after violations', '<input type="number" min="0" max="20" data-k="max_violations" value="' + esc(E.max_violations) + '">', 'Tab switches and fullscreen exits. 0 means never auto-submit.') + '</div>' +
      chk('shuffle_questions', 'Shuffle question order within each section') + chk('shuffle_options', 'Shuffle answer options') + '</div>' +

      '<div class="panel"><h3>Grading</h3>' +
      chk('ai_grading', 'Grade descriptive and pseudo-code answers with AI first') +
      chk('human_review_all', 'Send every written answer to a human reviewer, not only doubtful ones') +
      '<p class="muted small" style="margin:.4rem 0 0">Results are held back until you release them.</p></div>' +

      '<div class="panel"><div class="row"><h3 class="grow" style="margin:0">Sections and question rules</h3></div>' +
      '<p class="muted small">Each rule draws random approved questions from the bank. Leave topic or tag empty to match anything.</p>' +
      '<datalist id="dl-topics">' + topicList.map((t) => '<option value="' + esc(t) + '">').join('') + '</datalist>' +
      '<datalist id="dl-tags">' + tagList.map((t) => '<option value="' + esc(t) + '">').join('') + '</datalist>' +
      '<div id="sec-box"></div><button class="btn small" data-act="add-sec">Add section</button></div>' +
      '</fieldset></div>' +

      '<div class="panel"><div class="row"><button class="btn" id="a-check">Check question availability</button><button class="btn" id="a-preview">Preview a sample paper</button></div><div id="check-out" style="margin-top:.9rem"></div></div>' +

      '<div class="panel"><h3>Candidates</h3><div class="grid2">' +
      fld('Email addresses', '<textarea id="a-emails" rows="6" placeholder="one per line">' + esc(E.emails) + '</textarea>', 'Only @' + esc(App.cfg.ALLOWED_DOMAIN) + ' accounts. People not yet in the system are added as candidates.') +
      fld('Attempts allowed each', '<input type="number" id="a-attempts" min="1" max="5" value="' + esc(E.attempts_allowed) + '">', 'You can grant a retake later.') + '</div>' +
      '<button class="btn" id="a-savecand"' + (E.id && E.status !== 'archived' ? '' : ' disabled') + '>Save candidates</button>' +
      (E.id ? '' : ' <span class="muted small">Save the draft first.</span>') + '</div>' +
      (E.id && (E.status === 'published' || E.status === 'closed') ? '<div class="panel" id="att-panel"><p class="muted">Loading attempts...</p></div>' : '');

    drawSections();
    bindEditor();
    clearInterval(attTimer);
    if (E.id && (E.status === 'published' || E.status === 'closed')) {
      loadAttempts();
      attTimer = setInterval(loadAttempts, 20000);
    }
  }

  function drawSections() {
    const box = $('#sec-box');
    const opt = (o, cur) => o.map((x) => '<option value="' + x[0] + '"' + (String(cur) === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>').join('');
    const typeOpts = [['any', 'Any type']].concat(Object.entries(TYPES));
    const diffOpts = [['any', 'Any level'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
    box.innerHTML = E.sections.map((s, i) =>
      '<div class="section-box"><div class="row"><div class="grow"><label>Section name</label><input data-sk data-s="' + i + '" value="' + esc(s.name) + '"></div>' +
      '<button class="btn small ghost" data-act="up-sec" data-s="' + i + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move section up">Up</button>' +
      '<button class="btn small ghost" data-act="down-sec" data-s="' + i + '"' + (i === E.sections.length - 1 ? ' disabled' : '') + ' aria-label="Move section down">Down</button>' +
      '<button class="btn small ghost danger" data-act="rm-sec" data-s="' + i + '">Remove section</button></div>' +
      s.rules.map((r, j) =>
        '<div class="rule"><div><label>Type</label><select data-rk="type" data-s="' + i + '" data-r="' + j + '">' + opt(typeOpts, r.type) + '</select></div>' +
        '<div><label>Topic</label><input list="dl-topics" data-rk="topic" data-s="' + i + '" data-r="' + j + '" value="' + esc(r.topic) + '" placeholder="Any topic"></div>' +
        '<div><label>Tag</label><input list="dl-tags" data-rk="tag" data-s="' + i + '" data-r="' + j + '" value="' + esc(r.tag) + '" placeholder="Any tag"></div>' +
        '<div><label>Level</label><select data-rk="difficulty" data-s="' + i + '" data-r="' + j + '">' + opt(diffOpts, r.difficulty) + '</select></div>' +
        '<div><label>Count</label><input type="number" min="1" max="100" data-rk="count" data-s="' + i + '" data-r="' + j + '" value="' + esc(r.count) + '"></div>' +
        '<button class="btn small ghost" data-act="rm-rule" data-s="' + i + '" data-r="' + j + '" aria-label="Remove rule">Remove</button></div>').join('') +
      '<button class="btn small" data-act="add-rule" data-s="' + i + '">Add rule</button></div>').join('') ||
      '<p class="muted">No sections yet.</p>';
  }

  function bindEditor() {
    const form = $('#as-form');
    const onField = (e) => {
      const el = e.target;
      if (el.dataset.k) {
        E[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.dataset.t === 'dt' ? App.fromLocalInput(el.value) : el.value;
      } else if (el.hasAttribute('data-sk')) E.sections[+el.dataset.s].name = el.value;
      else if (el.dataset.rk) E.sections[+el.dataset.s].rules[+el.dataset.r][el.dataset.rk] = el.value;
    };
    form.addEventListener('input', onField);
    form.addEventListener('change', onField);
    form.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const s = +b.dataset.s, r = +b.dataset.r, secs = E.sections;
      switch (b.dataset.act) {
        case 'add-sec': secs.push({ name: 'Section ' + (secs.length + 1), rules: [newRule()] }); break;
        case 'rm-sec': secs.splice(s, 1); break;
        case 'up-sec': secs.splice(s - 1, 0, secs.splice(s, 1)[0]); break;
        case 'down-sec': secs.splice(s + 1, 0, secs.splice(s, 1)[0]); break;
        case 'add-rule': secs[s].rules.push(newRule()); break;
        case 'rm-rule': secs[s].rules.splice(r, 1); break;
      }
      drawSections();
    });

    $$('[data-st]').forEach((b) => (b.onclick = () => changeStatus(b.dataset.st, b)));
    const save = $('#a-save'); if (save) save.onclick = () => App.busy(save, () => saveAll().then((ok) => ok && toast('Draft saved.')));
    const pub = $('#a-publish'); if (pub) pub.onclick = () => confirmPublish();
    $('#a-check').onclick = (e) => App.busy(e.target, checkRules);
    $('#a-preview').onclick = (e) => App.busy(e.target, preview);
    $('#a-emails').oninput = (e) => { E.emails = e.target.value; };
    $('#a-attempts').oninput = (e) => { E.attempts_allowed = e.target.value; };
    const sc = $('#a-savecand'); sc.onclick = () => App.busy(sc, saveCandidates);
  }

  const emailList = () => E.emails.split(/[\s,;]+/).filter(Boolean);
  const sectionsPayload = () => E.sections.map((s) => ({ name: s.name, rules: s.rules.map((r) => Object.assign({}, r, { count: Number(r.count) })) }));

  function showError(msg) {
    const el = $('#as-err');
    if (!el) return toast(msg, true);
    el.textContent = msg; el.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const clearError = () => { const el = $('#as-err'); if (el) el.hidden = true; };

  /** Saves settings + sections (+ candidates). Returns true on success. */
  async function saveAll() {
    clearError();
    const payload = {
      id: E.id || undefined, title: E.title, description: E.description, instructions: E.instructions,
      start_time: E.start_time || 0, end_time: E.end_time || 0, duration_min: Number(E.duration_min),
      pass_mark: Number(E.pass_mark), negative_marking: Number(E.negative_marking),
      shuffle_questions: E.shuffle_questions, shuffle_options: E.shuffle_options, max_violations: Number(E.max_violations),
      ai_grading: E.ai_grading, human_review_all: E.human_review_all, sections: sectionsPayload()
    };
    try {
      const hadId = !!E.id;
      const r = await api('saveAssessment', payload);
      E.id = r.id;
      if (hadId || emailList().length) {
        await api('setAssigned', { assessment_id: E.id, emails: emailList(), attempts_allowed: Number(E.attempts_allowed) });
      }
      if (!hadId) { location.hash = '#/assessments/' + E.id; } else { await editorView(E.id); }
      return true;
    } catch (e) { showError(e.message); return false; }
  }

  async function saveCandidates() {
    clearError();
    try {
      const r = await api('setAssigned', { assessment_id: E.id, emails: emailList(), attempts_allowed: Number(E.attempts_allowed) });
      toast(r.total + ' candidate(s) saved' + (r.new_users ? ', ' + r.new_users + ' new account(s) added.' : '.'));
    } catch (e) { showError(e.message); }
  }

  function confirmPublish() {
    App.modal.open({
      title: 'Publish this assessment?',
      body: '<p>Candidates on the list can start between <strong>' + esc(fmtDate(E.start_time)) + '</strong> and <strong>' + esc(fmtDate(E.end_time)) + '</strong>. Settings and question rules are locked once published.</p>',
      actions: [
        { label: 'Cancel', onClick: () => App.modal.close() },
        { label: 'Publish', kind: 'primary', onClick: (b) => App.busy(b, async () => { App.modal.close(); await changeStatus('published', b, true); }) }
      ]
    });
  }

  async function changeStatus(status, btn, saveFirst) {
    const run = async () => {
      clearError();
      try {
        if (saveFirst || (E.status === 'draft' && status === 'published')) { if (!(await saveAll())) return; }
        await api('setAssessmentStatus', { id: E.id, status: status });
        toast(status === 'published' ? 'Published.' : status === 'archived' ? 'Archived.' : status === 'closed' ? 'Closed.' : 'Moved to ' + status + '.');
        if (status === 'archived') location.hash = '#/assessments'; else await editorView(E.id);
      } catch (e) { showError(e.message); }
    };
    return btn ? App.busy(btn, run) : run();
  }

  // ---------- live attempts ----------
  const ST = {
    not_started: ['Not started', ''], in_progress: ['In progress', 'warn'], submitted: ['Submitted', 'info'],
    pending_review: ['Needs review', 'warn'], graded: ['Auto-graded', 'ok']
  };
  const REASON = { candidate: 'by candidate', time: 'time up', violations: 'too many violations' };

  async function loadAttempts() {
    const box = $('#att-panel');
    if (!box) { clearInterval(attTimer); return; }
    try { drawAttempts(await api('listAttempts', { assessment_id: E.id })); }
    catch (e) { box.innerHTML = '<p class="error">' + esc(e.message) + '</p>'; }
  }

  function drawAttempts(r) {
    const box = $('#att-panel');
    if (!box) return;
    const c = {};
    r.rows.forEach((x) => { c[x.status] = (c[x.status] || 0) + 1; });
    const link = new URL('exam.html', location.href).href;
    box.innerHTML =
      '<div class="row"><h3 class="grow" style="margin:0">Candidates and attempts</h3>' +
      '<button class="btn small" id="att-refresh">Refresh</button><button class="btn small primary" id="att-process">Process submissions now</button></div>' +
      '<p class="small muted" style="margin:.5rem 0">Candidate page: <a href="' + esc(link) + '" target="_blank" rel="noopener">' + esc(link) + '</a> &middot; refreshes every 20 seconds</p>' +
      '<p>' + Object.keys(ST).map((k) => '<span class="badge ' + ST[k][1] + '">' + ST[k][0] + ': ' + (c[k] || 0) + '</span>').join(' ') + '</p>' +
      (r.rows.length ? '<div class="table-wrap"><table><thead><tr><th>Candidate</th><th>Status</th><th>Violations</th><th>Other flags</th><th>Started</th><th>Submitted</th><th>Auto score</th></tr></thead><tbody>' +
        r.rows.map((x) => {
          const st = ST[x.status] || [x.status, ''];
          const other = Object.keys(x.flags).filter((k) => ['tab_hidden', 'window_blur', 'fullscreen_exit'].indexOf(k) < 0)
            .map((k) => k.replace(/_/g, ' ') + ' x' + x.flags[k]).join(', ');
          return '<tr><td>' + esc(x.name || x.email) + (x.name ? '<div class="muted small">' + esc(x.email) + '</div>' : '') + '</td>' +
            '<td><span class="badge ' + st[1] + '">' + st[0] + '</span>' + (x.online ? ' <span class="badge ok">online</span>' : '') +
            (x.reason ? '<div class="muted small">' + esc(REASON[x.reason] || x.reason) + '</div>' : '') + '</td>' +
            '<td class="mono">' + (x.violations ? '<strong class="error">' + x.violations + '</strong>' : '0') + '</td>' +
            '<td class="small">' + esc(other || '-') + '</td>' +
            '<td>' + (x.started ? esc(App.fmtDate(x.started)) : '-') + '</td><td>' + (x.submitted ? esc(App.fmtDate(x.submitted)) : '-') + '</td>' +
            '<td class="mono">' + (x.auto_max === null ? '-' : x.auto_score + ' / ' + x.auto_max) + (x.written_count ? '<div class="muted small">+ ' + x.written_count + ' written</div>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<p class="muted">No candidates assigned.</p>') +
      '<p class="muted small" style="margin-top:.6rem">Auto score covers single and multiple choice only. Written answers are graded in the next phase. Scores are never shown to candidates.</p>';
    $('#att-refresh').onclick = (e) => App.busy(e.target, loadAttempts);
    $('#att-process').onclick = (e) => App.busy(e.target, async () => {
      try {
        const res = await api('processSubmissions', { assessment_id: E.id });
        toast(res.finalized + ' expired attempt(s) closed, ' + res.graded + ' graded.');
        await loadAttempts();
      } catch (err) { toast(err.message, true); }
    });
  }

  // ---------- rule check and preview ----------
  const ruleText = (r) => r.count + ' x ' + (r.type === 'any' ? 'any type' : TYPES[r.type]) + (r.topic ? ' in ' + r.topic : '') +
    (r.tag ? ', tagged ' + r.tag : '') + (r.difficulty !== 'any' ? ', ' + r.difficulty : '');

  async function checkRules() {
    clearError();
    try {
      const r = await api('checkRules', { sections: sectionsPayload() });
      $('#check-out').innerHTML =
        '<p>' + (r.ok ? '<span class="badge ok">Every rule can be filled</span>' : '<span class="badge bad">Some rules cannot be filled</span>') +
        ' A sample paper has <strong>' + r.totalQuestions + '</strong> questions and <strong>' + r.totalMarks + '</strong> marks.</p>' +
        '<p class="muted small">Marks can differ between candidates when the questions a rule draws from carry different marks.</p>' +
        r.sections.map((s) => '<h3 style="margin-top:.8rem">' + esc(s.name) + '</h3>' + s.rules.map((rule) => {
          const why = rule.ok ? rule.matching + ' approved questions match'
            : rule.matching < rule.needed ? 'only ' + rule.matching + ' approved questions match'
              : 'matches overlap with other rules, only ' + rule.drawn + ' could be drawn';
          return '<div class="check-result ' + (rule.ok ? 'ok' : 'bad') + '">' + esc(ruleText(rule)) + ' <span class="muted">(' + why + ')</span></div>';
        }).join('')).join('');
    } catch (e) { showError(e.message); }
  }

  async function preview() {
    clearError();
    try {
      const r = await api('previewPaper', { sections: sectionsPayload() });
      const body = '<p>' + (r.ok ? '' : '<span class="badge bad">Some rules could not be filled</span> ') +
        r.totalQuestions + ' questions, ' + r.totalMarks + ' marks. <span class="muted">This is one random draw. Each candidate gets their own.</span></p>' +
        r.sections.map((s) => '<h3>' + esc(s.name) + '</h3><div class="table-wrap" style="margin-bottom:1rem"><table><thead><tr><th>Type</th><th>Topic</th><th>Level</th><th>Marks</th><th>Question</th></tr></thead><tbody>' +
          (s.questions.map((q) => '<tr><td>' + esc(TYPES[q.type]) + '</td><td>' + esc(q.topic) + '</td><td>' + esc(q.difficulty) + '</td><td class="mono">' + q.marks + '</td><td class="text-cell"><div class="clamp">' + esc(q.text) + '</div></td></tr>').join('') ||
            '<tr><td colspan="5" class="muted">No questions drawn.</td></tr>') + '</tbody></table></div>').join('');
      App.modal.open({ title: 'Sample paper', wide: true, body: body, actions: [{ label: 'Close', kind: 'primary', onClick: () => App.modal.close() }] });
    } catch (e) { showError(e.message); }
  }

  App.views.assessments = { render: render };
})();
