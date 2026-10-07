/* Candidate exam page */
(function () {
  'use strict';
  const cfg = window.APP_CONFIG || {};
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const safeJson = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  const fmt = (ms) => new Date(Number(ms)).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const SCREENS = ['s-login', 's-list', 's-intro', 's-exam', 's-done'];
  const isObj = (q) => q.type === 'mcq' || q.type === 'checkbox';

  let token = null, user = null, list = [], listTimer = null, listOffset = 0;

  function show(id) { SCREENS.forEach((s) => { $('#' + s).hidden = s !== id; }); window.scrollTo(0, 0); }
  let toastTimer;
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = 'toast'), bad ? 6000 : 2800);
  }

  // ---------- dialogs and overlays ----------
  function dialog(html, actions) {
    $('#dlg-body').innerHTML = html;
    const foot = $('#dlg-foot'); foot.innerHTML = '';
    (actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.kind || ''); b.textContent = a.label; b.onclick = () => a.onClick(b);
      foot.appendChild(b);
    });
    $('#dlg').hidden = false;
  }
  const closeDialog = () => { $('#dlg').hidden = true; };
  function overlay(html) { $('#ov').innerHTML = '<div class="ov-card">' + html + '</div>'; $('#ov').hidden = false; }
  const hideOverlay = () => { $('#ov').hidden = true; $('#ov').innerHTML = ''; };

  // ---------- auth + API ----------
  const placeholder = (v) => !v || String(v).indexOf('PASTE_') === 0;

  function jwtExp(t) {
    try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch (e) { return 0; }
  }

  function showLogin(msg) {
    show('s-login');
    const el = $('#login-error'); el.hidden = !msg; el.textContent = msg || '';
  }

  window.examInit = function () {
    if (placeholder(cfg.API_URL) || placeholder(cfg.GOOGLE_CLIENT_ID)) { showLogin('Not configured yet: fill in config.js.'); return; }
    google.accounts.id.initialize({
      client_id: cfg.GOOGLE_CLIENT_ID, hd: cfg.ALLOWED_DOMAIN,
      callback: (resp) => { token = resp.credential; sessionStorage.setItem('idtoken', token); afterLogin(); }
    });
    google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', text: 'signin_with' });
    const saved = sessionStorage.getItem('idtoken');
    if (saved && jwtExp(saved) > Date.now() + 60000) { token = saved; afterLogin(); } else showLogin();
  };

  async function afterLogin() {
    try {
      user = await callAuth('whoami');
      $('#who').textContent = user.name || user.email;
      loadList();
    } catch (e) { showLogin(e.message); }
  }

  $('#out').onclick = () => {
    if (window.google) google.accounts.id.disableAutoSelect();
    sessionStorage.removeItem('idtoken'); token = null; clearTimeout(listTimer); showLogin();
  };

  async function post(body) {
    const res = await fetch(cfg.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body)
    });
    return res.json();
  }

  async function callAuth(action, payload) {
    let j;
    try { j = await post({ action: action, token: token, payload: payload || {} }); }
    catch (e) { throw new Error('Could not reach the server. Check your connection and try again.'); }
    if (j.ok) return j.data;
    if (j.code === 401) { sessionStorage.removeItem('idtoken'); token = null; showLogin('Your sign-in expired. Please sign in again.'); }
    const err = new Error(j.error || 'Something went wrong.'); err.code = j.code; throw err;
  }

  /** Exam-time calls. Retries network/server hiccups; a 409 means another window took over. */
  async function callSession(action, payload, tries) {
    tries = tries || 4;
    let delay = 800;
    for (let i = 0; i < tries; i++) {
      let j;
      try {
        j = await post({ action: action, payload: Object.assign({ attempt_id: X.attempt_id, session_id: X.session_id }, payload || {}) });
      } catch (e) {
        if (i === tries - 1) { const ne = new Error('offline'); ne.net = true; throw ne; }
        await sleep(delay + Math.random() * 400); delay *= 2; continue;
      }
      if (j.ok) return j.data;
      if (j.code === 409) { const fe = new Error(j.error); fe.fatal = true; throw fe; }
      if (j.code >= 500) {
        if (i === tries - 1) { const ne = new Error(j.error || 'server'); ne.net = true; throw ne; }
        await sleep(delay + Math.random() * 400); delay *= 2; continue;
      }
      throw new Error(j.error || 'Request failed.');
    }
  }

  // ---------- dashboard ----------
  async function loadList(silent) {
    show('s-list');
    if (!silent) $('#list').innerHTML = '<p class="muted">Loading...</p>';
    try {
      const r = await callAuth('myAssessments');
      list = r.items; listOffset = r.server_now - Date.now();
      drawList();
    } catch (e) { if (!silent) $('#list').innerHTML = '<p class="error">' + esc(e.message) + '</p>'; }
    clearTimeout(listTimer);
    listTimer = setTimeout(() => { if (!$('#s-list').hidden) loadList(true); }, 20000);
  }

  function drawList() {
    const box = $('#list');
    if (!list.length) { box.innerHTML = '<div class="panel empty">No assessments have been assigned to you yet.</div>'; return; }
    box.innerHTML = list.map((a, i) => {
      let action = '', note = '';
      if (a.state === 'open') action = '<button class="btn primary" data-i="' + i + '">Start</button>';
      else if (a.state === 'in_progress') { action = '<button class="btn primary" data-i="' + i + '">Resume</button>'; note = '<span class="badge warn">In progress</span>'; }
      else if (a.state === 'upcoming') note = '<span class="badge info">Opens ' + esc(fmt(a.start_time)) + '</span>';
      else if (a.state === 'completed') note = '<span class="badge ok">Submitted</span> <span class="muted small">Results will be shared after review.</span>';
      else note = '<span class="badge bad">Window closed</span>';
      return '<div class="a-card"><div><h2>' + esc(a.title) + '</h2>' +
        (a.description ? '<p class="muted" style="margin:0 0 .4rem">' + esc(a.description) + '</p>' : '') +
        '<p class="small muted" style="margin:0">' + esc(fmt(a.start_time)) + ' to ' + esc(fmt(a.end_time)) + ' &middot; ' + a.duration_min + ' min</p></div>' +
        '<div style="text-align:right">' + note + (note && action ? '<br>' : '') + action + '</div></div>';
    }).join('');
    box.querySelectorAll('button[data-i]').forEach((b) => (b.onclick = () => openIntro(list[+b.dataset.i])));
  }

  // ---------- instructions ----------
  function openIntro(a) {
    const resume = a.state === 'in_progress';
    const neg = Number(a.negative_marking) > 0 ? 'Wrong single and multiple choice answers lose ' + (Math.round(a.negative_marking * 100) / 100) + ' of the question marks.' : 'There is no negative marking.';
    const viol = a.max_violations > 0
      ? 'If you leave the exam screen more than ' + (a.max_violations - 1) + ' time' + (a.max_violations - 1 === 1 ? '' : 's') + ', the exam is submitted automatically.'
      : 'Every time you leave the exam screen is recorded.';
    $('#s-intro').innerHTML = '<div class="intro"><p class="small"><a href="#" id="in-back">Back to assessments</a></p>' +
      '<h1>' + esc(a.title) + '</h1>' +
      '<div class="facts"><div class="fact"><b>' + a.duration_min + ' min</b>Duration</div>' +
      '<div class="fact"><b>' + (a.question_count || '-') + '</b>Questions</div>' +
      '<div class="fact"><b>' + a.section_names.length + '</b>Section' + (a.section_names.length === 1 ? '' : 's') + '</div></div>' +
      (a.instructions ? '<div class="panel"><h3>Instructions</h3><div class="pre">' + esc(a.instructions) + '</div></div>' : '') +
      '<div class="panel"><h3>Exam rules</h3><ul class="rules">' +
      '<li>The exam opens in full screen. Stay in it until you submit.</li>' +
      '<li>Do not switch tabs or windows. ' + esc(viol) + '</li>' +
      '<li>Copying, pasting and right-click are disabled.</li>' +
      '<li>' + esc(neg) + '</li>' +
      '<li>The timer runs on the server. Refreshing the page does not pause it. Your answers are saved as you go.</li>' +
      '<li>Open the exam in only one window or device.</li></ul>' +
      (resume ? '<p><strong>You have an exam in progress. The clock has been running.</strong></p>'
        : '<label class="check"><input type="checkbox" id="in-agree"> I have read and understood these instructions.</label>') +
      '</div><p id="in-err" class="error" role="alert" hidden></p>' +
      '<button class="btn primary" id="in-go"' + (resume ? '' : ' disabled') + '>' + (resume ? 'Resume exam' : 'Begin exam') + '</button></div>';
    show('s-intro');
    $('#in-back').onclick = (e) => { e.preventDefault(); loadList(); };
    const ag = $('#in-agree'); if (ag) ag.onchange = () => { $('#in-go').disabled = !ag.checked; };
    $('#in-go').onclick = (e) => begin(a, e.target);
  }

  async function enterFullscreen() {
    const el = document.documentElement;
    if (el.requestFullscreen) { try { await el.requestFullscreen(); return true; } catch (e) { /* fall through */ } }
    return false;
  }
  function exitFullscreen() { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); }

  async function begin(a, btn) {
    btn.disabled = true; $('#in-err').hidden = true;
    const fs = await enterFullscreen();
    try {
      const saved = safeJson(sessionStorage.getItem('sess_' + a.id));
      const v = await callAuth('startAttempt', { assessment_id: a.id, session_id: saved ? saved.s : '' });
      startExam(v, fs);
    } catch (e) {
      exitFullscreen();
      $('#in-err').textContent = e.message; $('#in-err').hidden = false; btn.disabled = false;
    }
  }

  // ---------- exam state ----------
  const X = { active: false, finished: false, T: { deadline: 0, serverNow: 0, perf: 0 }, A: {}, sections: [], cur: { s: 0, i: 0 }, online: true };
  const SQ = { items: [], busy: false };
  let saveTimer = null, lastViolation = -99999, infoAt = {};

  const serverNow = () => X.T.serverNow + (performance.now() - X.T.perf);
  function applyTime(r) {
    if (r && r.server_now) { X.T.serverNow = r.server_now; X.T.perf = performance.now(); }
    if (r && r.deadline) X.T.deadline = r.deadline;
  }
  const hasResp = (r) => (Array.isArray(r) ? r.length > 0 : String(r || '').trim() !== '');
  const curQ = () => X.sections[X.cur.s].questions[X.cur.i];
  const curA = () => X.A[curQ().id];

  function startExam(v, fs) {
    X.attempt_id = v.attempt_id; X.session_id = v.session_id; X.assessment_id = v.assessment.id;
    X.title = v.assessment.title; X.neg = Number(v.assessment.negative_marking) || 0; X.max = v.assessment.max_violations;
    X.violations = v.violations || 0; X.sections = v.sections; X.fsUsed = fs; X.finished = false; X.submitting = false;
    X.T = { deadline: v.deadline, serverNow: v.server_now, perf: performance.now() };
    X.A = {};
    v.sections.forEach((s) => s.questions.forEach((q) => {
      const sv = v.answers[q.id];
      X.A[q.id] = sv
        ? { resp: isObj(q) ? (Array.isArray(sv.response) ? sv.response : []) : String(sv.response || ''), marked: !!sv.marked, visited: true, spent: sv.time_spent || 0 }
        : { resp: isObj(q) ? [] : '', marked: false, visited: false, spent: 0 };
    }));
    sessionStorage.setItem('sess_' + X.assessment_id, JSON.stringify({ a: X.attempt_id, s: X.session_id }));
    SQ.items = []; SQ.busy = false; X.online = true; lastViolation = -99999;
    try { google.accounts.id.cancel(); } catch (e) { /* ignore */ }

    X.active = true;
    show('s-exam');
    $('#x-title').textContent = X.title;
    X.cur = { s: 0, i: 0 };
    go(0, 0, true);
    tick(); clearInterval(X.tickId); X.tickId = setInterval(tick, 500);
    scheduleHeartbeat();
    if (!fs) logInfo('no_fullscreen');
  }

  // ---------- navigation ----------
  function go(s, i, initial) {
    if (!initial) commitCurrent();
    X.cur = { s: s, i: i };
    drawAll();
  }
  function nextPos() {
    const { s, i } = X.cur;
    if (i + 1 < X.sections[s].questions.length) return { s: s, i: i + 1 };
    if (s + 1 < X.sections.length) return { s: s + 1, i: 0 };
    return null;
  }
  function prevPos() {
    const { s, i } = X.cur;
    if (i > 0) return { s: s, i: i - 1 };
    if (s > 0) return { s: s - 1, i: X.sections[s - 1].questions.length - 1 };
    return null;
  }
  function advance() {
    const n = nextPos();
    if (n) go(n.s, n.i);
    else { commitCurrent(); drawAll(); toast('That was the last question. Review the palette, then submit.'); }
  }

  $('#b-save').onclick = () => advance();
  $('#b-mark').onclick = () => { curA().marked = !curA().marked; advance(); };
  $('#b-prev').onclick = () => { const p = prevPos(); if (p) go(p.s, p.i); };
  $('#b-clear').onclick = () => { curA().resp = isObj(curQ()) ? [] : ''; drawAll(); scheduleSave(300); };
  $('#b-submit').onclick = () => confirmSubmit();

  // ---------- drawing ----------
  function stateOf(q) {
    const a = X.A[q.id];
    if (!a.visited) return 'nv';
    const ans = hasResp(a.resp);
    return a.marked ? (ans ? 'am' : 'm') : (ans ? 'a' : 'na');
  }
  const LBL = { nv: 'not visited', na: 'not answered', a: 'answered', m: 'marked for review', am: 'answered and marked for review' };

  function drawAll() { drawQuestion(); drawTabs(); drawPalette(); }

  function drawQuestion() {
    const q = curQ(), a = X.A[q.id], sec = X.sections[X.cur.s];
    a.visited = true; X.enteredAt = performance.now();
    const negTxt = isObj(q) && X.neg > 0 ? ' &middot; wrong answer: -' + (Math.round(q.marks * X.neg * 100) / 100) : '';
    let h = '<div class="qhead"><span>Question ' + (X.cur.i + 1) + ' of ' + sec.questions.length + '</span>' +
      '<span class="muted">' + q.marks + ' mark' + (q.marks === 1 ? '' : 's') + negTxt + '</span></div>' +
      '<div class="qtext">' + esc(q.text) + '</div>';
    if (q.image_url && /^https:\/\//i.test(q.image_url)) h += '<img class="qimg" alt="Figure for this question" src="' + esc(q.image_url) + '">';
    if (isObj(q)) {
      const multi = q.type === 'checkbox';
      h += '<div class="qhint">' + (multi ? 'Select all correct answers.' : 'Select one answer.') + '</div>';
      h += q.options.map((o, idx) => '<label class="opt' + (a.resp.indexOf(o.key) >= 0 ? ' picked' : '') + '"><input type="' + (multi ? 'checkbox' : 'radio') + '" name="opt" value="' + esc(o.key) + '"' +
        (a.resp.indexOf(o.key) >= 0 ? ' checked' : '') + '><span class="ol">' + String.fromCharCode(65 + idx) + '</span><span class="ot">' + esc(o.text) + '</span></label>').join('');
    } else {
      const code = q.type === 'pseudocode';
      h += '<div class="qhint">' + (code ? 'Write your logic as pseudo-code. Exact syntax does not matter; clear steps do.' : 'Write your answer below.') + '</div>' +
        '<textarea class="answer-box' + (code ? ' code' : '') + '" id="ans" spellcheck="' + (code ? 'false' : 'true') + '" aria-label="Your answer"></textarea>' +
        '<div class="small muted" id="wc"></div>';
    }
    h += '<div class="marked-note small" id="mk">' + (a.marked ? '<span class="badge info">Marked for review</span>' : '') + '</div>';
    const box = $('#x-q'); box.innerHTML = h; box.scrollTop = 0;

    if (isObj(q)) {
      box.querySelectorAll('input[name=opt]').forEach((el) => (el.onchange = () => {
        a.resp = q.type === 'checkbox'
          ? Array.from(box.querySelectorAll('input[name=opt]:checked')).map((x) => x.value).sort()
          : [el.value];
        box.querySelectorAll('.opt').forEach((l) => l.classList.toggle('picked', l.querySelector('input').checked));
        drawPalette(); drawTabs(); scheduleSave(900);
      }));
    } else {
      const ta = $('#ans'); ta.value = a.resp;
      const wc = () => { const n = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0; $('#wc').textContent = n + ' word' + (n === 1 ? '' : 's'); };
      wc();
      ta.oninput = () => { a.resp = ta.value; wc(); drawPalette(); drawTabs(); scheduleSave(2000); };
      if (q.type === 'pseudocode') {
        ta.onkeydown = (e) => {
          if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 2; ta.oninput(); }
        };
      }
    }
    $('#b-mark').textContent = a.marked ? 'Unmark & next' : 'Mark for review & next';
    $('#b-prev').disabled = !prevPos();
  }

  function drawTabs() {
    $('#x-tabs').innerHTML = X.sections.map((s, i) => {
      const done = s.questions.filter((q) => hasResp(X.A[q.id].resp)).length;
      return '<button class="tab" role="tab" aria-selected="' + (i === X.cur.s) + '" data-s="' + i + '">' + esc(s.name) + '<small>' + done + '/' + s.questions.length + '</small></button>';
    }).join('');
    document.querySelectorAll('#x-tabs .tab').forEach((b) => (b.onclick = () => { if (+b.dataset.s !== X.cur.s) go(+b.dataset.s, 0); }));
  }

  function drawPalette() {
    const sec = X.sections[X.cur.s], c = { nv: 0, na: 0, a: 0, m: 0, am: 0 };
    const btns = sec.questions.map((q, i) => {
      const st = stateOf(q); c[st]++;
      return '<button class="pq ' + st + (i === X.cur.i ? ' cur' : '') + '" data-i="' + i + '" aria-label="Question ' + (i + 1) + ', ' + LBL[st] + '"' + (i === X.cur.i ? ' aria-current="true"' : '') + '>' + (i + 1) + '</button>';
    }).join('');
    $('#x-side').innerHTML =
      '<div class="legend"><span><i class="sw a"></i>' + c.a + ' Answered</span><span><i class="sw na"></i>' + c.na + ' Not answered</span>' +
      '<span><i class="sw nv"></i>' + c.nv + ' Not visited</span><span><i class="sw m"></i>' + c.m + ' Marked</span>' +
      '<span style="grid-column:1/3"><i class="sw am"></i>' + c.am + ' Answered &amp; marked for review</span></div>' +
      '<p class="pal-title">' + esc(sec.name) + '</p><div class="palette">' + btns + '</div>';
    document.querySelectorAll('#x-side .pq').forEach((b) => (b.onclick = () => go(X.cur.s, +b.dataset.i)));
  }

  function drawSync() {
    const el = $('#x-sync');
    if (!X.online) { el.textContent = 'Connection lost. Retrying. Your answers are kept on this page.'; el.className = 'x-sync small bad'; }
    else if (SQ.items.length || SQ.busy) { el.textContent = 'Saving...'; el.className = 'x-sync small'; }
    else { el.textContent = 'All answers saved'; el.className = 'x-sync small'; }
  }

  // ---------- saving ----------
  function commitCurrent() {
    if (!X.active) return;
    const q = curQ(), a = X.A[q.id];
    a.spent += (performance.now() - X.enteredAt) / 1000; X.enteredAt = performance.now();
    clearTimeout(saveTimer);
    enqueueSave(q.id);
  }
  function scheduleSave(ms) {
    const id = curQ().id;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => enqueueSave(id), ms);
  }
  function enqueueSave(qid) {
    const a = X.A[qid];
    const item = { question_id: qid, response: a.resp, marked: a.marked, time_spent: Math.round(a.spent) };
    const k = SQ.items.findIndex((x, idx) => x.question_id === qid && !(idx === 0 && SQ.busy));
    if (k >= 0) SQ.items[k] = item; else SQ.items.push(item);
    pump(); drawSync();
  }
  async function pump() {
    if (SQ.busy || !X.active) return;
    SQ.busy = true;
    try {
      while (SQ.items.length && X.active) {
        try {
          const r = await callSession('saveAnswer', SQ.items[0]);
          SQ.items.shift(); X.online = true; applyTime(r);
          if (r.status && r.status !== 'in_progress') { finish(r.reason || 'time'); return; }
        } catch (e) {
          if (e.fatal) { lost(e.message); return; }
          if (e.net) { X.online = false; drawSync(); await sleep(3000); } else { SQ.items.shift(); toast(e.message, true); }
        }
        drawSync();
      }
    } finally { SQ.busy = false; drawSync(); }
  }

  // ---------- timer + heartbeat ----------
  function tick() {
    if (!X.active) return;
    const left = X.T.deadline - serverNow();
    const t = Math.max(0, Math.floor(left / 1000));
    const p = (n) => String(n).padStart(2, '0');
    const el = $('#x-timer');
    el.textContent = p(Math.floor(t / 3600)) + ':' + p(Math.floor((t % 3600) / 60)) + ':' + p(t % 60);
    el.className = 'timer' + (t <= 60 ? ' danger' : t <= 600 ? ' warn' : '');
    if (left <= 0 && !X.submitting) { X.submitting = true; doSubmit(true); }
  }

  function scheduleHeartbeat() {
    clearTimeout(X.hbId);
    X.hbId = setTimeout(async () => {
      if (!X.active) return;
      try {
        const r = await callSession('heartbeat', {}, 2);
        X.online = true; applyTime(r);
        if (typeof r.violations === 'number') X.violations = r.violations;
        if (r.status !== 'in_progress') { finish(r.reason || 'time'); return; }
      } catch (e) { if (e.fatal) { lost(e.message); return; } X.online = false; }
      drawSync(); scheduleHeartbeat();
    }, 25000 + Math.random() * 10000);
  }

  // ---------- submit ----------
  function confirmSubmit() {
    commitCurrent();
    let tot = { n: 0, a: 0, na: 0, m: 0, nv: 0 };
    const rows = X.sections.map((s) => {
      const c = { n: s.questions.length, a: 0, na: 0, m: 0, nv: 0 };
      s.questions.forEach((q) => { const st = stateOf(q); if (st === 'a' || st === 'am') c.a++; else if (st === 'na' || st === 'm') c.na++; if (st === 'm' || st === 'am') c.m++; if (st === 'nv') { c.nv++; } });
      Object.keys(tot).forEach((k) => (tot[k] += c[k]));
      return '<tr><td>' + esc(s.name) + '</td><td>' + c.n + '</td><td>' + c.a + '</td><td>' + (c.n - c.a) + '</td><td>' + c.m + '</td></tr>';
    }).join('');
    dialog('<h2>Submit your exam?</h2><table class="sum"><thead><tr><th>Section</th><th>Questions</th><th>Answered</th><th>Not answered</th><th>Marked</th></tr></thead><tbody>' + rows +
      '<tr><td><strong>Total</strong></td><td>' + tot.n + '</td><td>' + tot.a + '</td><td>' + (tot.n - tot.a) + '</td><td>' + tot.m + '</td></tr></tbody></table>' +
      '<p>You cannot change your answers after submitting.</p>', [
      { label: 'Go back', onClick: closeDialog },
      { label: 'Submit now', kind: 'primary', onClick: (b) => { b.disabled = true; closeDialog(); doSubmit(false); } }
    ]);
  }

  async function doSubmit(auto) {
    if (!X.active) return;
    commitCurrent(); clearTimeout(saveTimer);
    const t0 = Date.now();
    while ((SQ.items.length || SQ.busy) && Date.now() - t0 < 12000) await sleep(250);
    for (;;) {
      try {
        const r = await callSession('submitAttempt', {});
        finish(r.reason || (auto ? 'time' : 'candidate')); return;
      } catch (e) {
        if (e.fatal) { lost(e.message); return; }
        if (!auto) { toast('Could not submit yet. Check your connection and try again.', true); X.submitting = false; return; }
        await sleep(3000);
      }
    }
  }

  const DONE_MSG = {
    candidate: 'Your responses have been submitted.',
    time: 'Time is up. Your responses were submitted automatically.',
    violations: 'Your exam was submitted automatically because you left the exam screen too many times.'
  };

  function finish(reason) {
    if (X.finished) return;
    X.finished = true; X.active = false;
    clearInterval(X.tickId); clearTimeout(X.hbId); clearTimeout(saveTimer);
    exitFullscreen(); hideOverlay(); closeDialog();
    sessionStorage.removeItem('sess_' + X.assessment_id);
    $('#s-done').innerHTML = '<div class="done-card"><h1>Exam submitted</h1><p>' + esc(DONE_MSG[reason] || DONE_MSG.candidate) + '</p>' +
      '<p class="muted">Your results will be shared after review. You can close this window.</p>' +
      '<button class="btn" id="done-back">Back to assessments</button></div>';
    show('s-done');
    $('#done-back').onclick = () => loadList();
  }

  function lost(msg) {
    X.active = false; clearInterval(X.tickId); clearTimeout(X.hbId); closeDialog();
    overlay('<h2>This window has been stopped</h2><p>' + esc(msg || 'The exam is open in another window or device.') + '</p>' +
      '<p class="muted">Your saved answers are safe. Close this window and continue in the other one.</p>');
  }

  // ---------- anti-cheating ----------
  function logInfo(type) {
    const now = Date.now();
    if (!X.active || now - (infoAt[type] || 0) < 5000) return;
    infoAt[type] = now;
    callSession('logFlag', { type: type }, 1).catch(() => {});
  }

  function violation(type) {
    if (!X.active) return;
    const t = performance.now();
    if (t - lastViolation < 2000) return;
    lastViolation = t;
    const label = { tab_hidden: 'You switched to another tab or window.', window_blur: 'You clicked outside the exam window.', fullscreen_exit: 'You left full screen.' }[type];
    showPause(label, null);
    callSession('logFlag', { type: type }, 2).then((r) => {
      if (r.status !== 'in_progress' || r.submitted) { finish(r.reason || 'violations'); return; }
      X.violations = r.violations; X.max = r.max;
      showPause(label, r);
    }).catch((e) => { if (e.fatal) lost(e.message); });
  }

  function showPause(label, r) {
    let line = 'This has been recorded.';
    if (r && X.max > 0) {
      const left = X.max - r.violations;
      line = '<div class="strike">Warning ' + r.violations + ' of ' + X.max + '</div>' +
        '<p>' + (left <= 1 ? 'The next time you leave, your exam will be submitted automatically.' : left + ' more and your exam will be submitted automatically.') + '</p>';
    }
    overlay('<h2>' + esc(label) + '</h2><p>' + line + '</p><p class="muted small">The timer is still running.</p><button class="btn primary" id="ov-back">Return to exam</button>');
    $('#ov-back').onclick = async () => {
      if (X.fsUsed && !document.fullscreenElement) await enterFullscreen();
      hideOverlay();
    };
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) violation('tab_hidden'); });
  window.addEventListener('blur', () => {
    setTimeout(() => { if (X.active && !document.hidden && !document.hasFocus()) violation('window_blur'); }, 350);
  });
  document.addEventListener('fullscreenchange', () => { if (X.active && X.fsUsed && !document.fullscreenElement) violation('fullscreen_exit'); });

  const block = (type, msg) => (e) => { if (!X.active) return; e.preventDefault(); logInfo(type); toast(msg, true); };
  document.addEventListener('copy', block('copy_blocked', 'Copying is disabled during the exam.'));
  document.addEventListener('cut', block('cut_blocked', 'Cutting is disabled during the exam.'));
  document.addEventListener('paste', block('paste_blocked', 'Pasting is disabled during the exam.'));
  document.addEventListener('contextmenu', block('context_menu', 'Right-click is disabled during the exam.'));
  document.addEventListener('keydown', (e) => {
    if (!X.active) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (e.key === 'F12' || (mod && e.shiftKey && 'ijc'.indexOf(k) >= 0) || (mod && 'ups'.indexOf(k) >= 0 && k.length === 1)) {
      e.preventDefault(); logInfo('shortcut_blocked');
    }
  });
  window.addEventListener('beforeunload', (e) => { if (X.active) { e.preventDefault(); e.returnValue = ''; } });
})();
