/* Question bank: list, filter, bulk status, editor */
(function () {
  const { $, $$, esc, api, toast, badge } = App;
  const S = { list: null, f: { search: '', type: '', topic: '', difficulty: '', status: '' }, sel: new Set() };
  const TYPES = { mcq: 'Single choice', checkbox: 'Multiple choice', descriptive: 'Descriptive', pseudocode: 'Pseudo-code' };
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  App.QTYPES = TYPES;

  async function load() {
    S.list = await api('listQuestions');
    App.questionCache = S.list;
  }

  function topics() {
    return Array.from(new Set((S.list || []).map((q) => q.topic))).sort();
  }

  function filtered() {
    const f = S.f, s = f.search.toLowerCase();
    return S.list.filter((q) =>
      (!s || q.text.toLowerCase().indexOf(s) >= 0 || q.tags.join(' ').toLowerCase().indexOf(s) >= 0 || q.id.toLowerCase() === s) &&
      (!f.type || q.type === f.type) && (!f.topic || q.topic === f.topic) &&
      (!f.difficulty || q.difficulty === f.difficulty) && (!f.status || q.status === f.status));
  }

  async function render() {
    const v = $('#view');
    if (!S.list) {
      v.innerHTML = '<p class="muted">Loading questions...</p>';
      try { await load(); } catch (e) { v.innerHTML = '<p class="error">' + esc(e.message) + '</p>'; return; }
    }
    const opt = (o, sel) => o.map((x) => '<option value="' + esc(x[0]) + '"' + (sel === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>').join('');
    v.innerHTML =
      '<div class="page-head"><div><h1>Question bank</h1><p class="muted">' + S.list.length + ' questions. Only approved questions are used in exams.</p></div>' +
      '<div class="row"><a class="btn" href="#/import">Import CSV</a><button class="btn primary" id="q-new">New question</button></div></div>' +
      '<div class="filters">' +
      '<input id="f-search" type="search" placeholder="Search text, tag or ID" value="' + esc(S.f.search) + '" aria-label="Search">' +
      '<select id="f-type" aria-label="Type"><option value="">All types</option>' + opt(Object.entries(TYPES), S.f.type) + '</select>' +
      '<select id="f-topic" aria-label="Topic"><option value="">All topics</option>' + opt(topics().map((t) => [t, t]), S.f.topic) + '</select>' +
      '<select id="f-diff" aria-label="Difficulty"><option value="">All levels</option>' + opt([['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], S.f.difficulty) + '</select>' +
      '<select id="f-status" aria-label="Status"><option value="">All statuses</option>' + opt([['draft', 'Draft'], ['approved', 'Approved'], ['archived', 'Archived']], S.f.status) + '</select>' +
      '</div><div id="q-bulk"></div><div id="q-table"></div>';

    $('#q-new').onclick = () => editor(null);
    const bind = (id, key) => { $(id).oninput = $(id).onchange = (e) => { S.f[key] = e.target.value; drawTable(); }; };
    bind('#f-search', 'search'); bind('#f-type', 'type'); bind('#f-topic', 'topic'); bind('#f-diff', 'difficulty'); bind('#f-status', 'status');
    drawTable();
  }

  function drawTable() {
    const rows = filtered();
    const box = $('#q-table');
    if (!S.list.length) {
      box.innerHTML = '<div class="panel empty"><p>No questions yet.</p><a class="btn primary" href="#/import">Import a CSV</a> <button class="btn" id="q-new2">Write one</button></div>';
      $('#q-new2').onclick = () => editor(null);
      return;
    }
    if (!rows.length) { box.innerHTML = '<div class="panel empty">No questions match these filters.</div>'; drawBulk(); return; }
    const allSel = rows.every((q) => S.sel.has(q.id));
    box.innerHTML = '<div class="table-wrap"><table><thead><tr>' +
      '<th><input type="checkbox" id="q-all" aria-label="Select all shown"' + (allSel ? ' checked' : '') + '></th>' +
      '<th>Question</th><th>Type</th><th>Topic</th><th>Level</th><th>Marks</th><th>Status</th></tr></thead><tbody>' +
      rows.map((q) => '<tr class="click" data-id="' + esc(q.id) + '"><td><input type="checkbox" class="q-sel" aria-label="Select ' + esc(q.id) + '"' + (S.sel.has(q.id) ? ' checked' : '') + '></td>' +
        '<td class="text-cell"><div class="clamp">' + esc(q.text) + '</div>' + (q.tags.length ? '<div class="muted small">' + esc(q.tags.join(', ')) + '</div>' : '') + '</td>' +
        '<td>' + esc(TYPES[q.type] || q.type) + '</td><td>' + esc(q.topic) + '</td><td>' + esc(q.difficulty) + '</td>' +
        '<td class="mono">' + q.marks + '</td><td>' + badge(q.status) + '</td></tr>').join('') +
      '</tbody></table></div>';

    $('#q-all').onchange = (e) => { rows.forEach((q) => (e.target.checked ? S.sel.add(q.id) : S.sel.delete(q.id))); drawTable(); };
    $$('#q-table tbody tr').forEach((tr) => {
      tr.onclick = (e) => {
        const id = tr.dataset.id;
        if (e.target.classList.contains('q-sel')) {
          e.target.checked ? S.sel.add(id) : S.sel.delete(id);
          drawBulk();
          $('#q-all').checked = rows.every((q) => S.sel.has(q.id));
          return;
        }
        editor(S.list.find((q) => q.id === id));
      };
    });
    drawBulk();
  }

  function drawBulk() {
    const b = $('#q-bulk');
    if (!S.sel.size) { b.innerHTML = ''; return; }
    b.innerHTML = '<div class="bulkbar"><strong>' + S.sel.size + ' selected</strong><span class="grow"></span>' +
      '<button class="btn small" data-s="approved">Approve</button><button class="btn small" data-s="draft">Move to draft</button>' +
      '<button class="btn small danger" data-s="archived">Archive</button><button class="btn small ghost" id="q-clear">Clear</button></div>';
    $('#q-clear').onclick = () => { S.sel.clear(); drawTable(); };
    $$('#q-bulk [data-s]').forEach((btn) => {
      btn.onclick = () => App.busy(btn, async () => {
        try {
          const r = await api('setQuestionStatus', { ids: Array.from(S.sel), status: btn.dataset.s });
          toast(r.updated + ' question(s) updated.');
          S.sel.clear(); S.list = null; render();
        } catch (e) { toast(e.message, true); }
      });
    });
  }

  // ---------- editor ----------
  function editor(q) {
    const st = q ? JSON.parse(JSON.stringify(q)) : {
      type: 'mcq', topic: '', tags: [], difficulty: 'easy', marks: 1, text: '', options: ['', '', '', ''], answer: [],
      rubric: [{ criterion: '', points: 1 }], model_answer: '', explanation: '', image_url: '', status: 'approved'
    };
    if (!st.options.length) st.options = ['', '', '', ''];
    if (!st.rubric.length) st.rubric = [{ criterion: '', points: 1 }];
    st.tagsText = (st.tags || []).join(', ');
    const isObj = () => st.type === 'mcq' || st.type === 'checkbox';
    const sum = () => st.rubric.reduce((s, r) => s + (Number(r.points) > 0 ? Number(r.points) : 0), 0);
    const sel = (id, opts, cur) => '<select id="' + id + '">' + opts.map((o) => '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';

    const body = App.modal.open({
      title: q ? 'Edit question ' + q.id : 'New question', wide: true,
      body:
        '<p id="qe-err" class="error" role="alert" hidden></p>' +
        '<div class="grid2"><div class="field"><label for="qe-type">Type</label>' + sel('qe-type', Object.entries(TYPES), st.type) + '</div>' +
        '<div class="field"><label for="qe-status">Status</label>' + sel('qe-status', [['draft', 'Draft'], ['approved', 'Approved'], ['archived', 'Archived']], st.status) + '</div></div>' +
        '<div class="field"><label for="qe-text">Question</label><textarea id="qe-text" rows="4"></textarea></div>' +
        '<div class="grid3"><div class="field"><label for="qe-topic">Topic</label><input id="qe-topic" list="qe-topics"><datalist id="qe-topics">' + topics().map((t) => '<option value="' + esc(t) + '">').join('') + '</datalist></div>' +
        '<div class="field"><label for="qe-diff">Difficulty</label>' + sel('qe-diff', [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], st.difficulty) + '</div>' +
        '<div class="field"><label for="qe-marks">Marks</label><input id="qe-marks" type="number" min="0.5" step="0.5"></div></div>' +
        '<div class="grid2"><div class="field"><label for="qe-tags">Tags</label><input id="qe-tags" placeholder="predict-output, loops"><div class="hint">Comma separated. Use tags like predict-output or find-bug to pick these in exam rules.</div></div>' +
        '<div class="field"><label for="qe-img">Image link (optional)</label><input id="qe-img" placeholder="https://..."></div></div>' +
        '<div id="qe-obj" class="field"><label>Options</label><div id="qe-opts"></div><button type="button" class="btn small" id="qe-addopt">Add option</button>' +
        '<div class="hint" id="qe-opthint"></div></div>' +
        '<div id="qe-sub"><div class="field"><label>Rubric</label><div id="qe-rub"></div><button type="button" class="btn small" id="qe-addrub">Add criterion</button><div class="hint" id="qe-rubsum"></div></div>' +
        '<div class="field"><label for="qe-model">Model answer</label><textarea id="qe-model" rows="4"></textarea><div class="hint">The AI grader and human reviewers compare answers against this.</div></div></div>' +
        '<div class="field"><label for="qe-expl">Explanation (optional)</label><textarea id="qe-expl" rows="2"></textarea></div>',
      actions: [
        { label: 'Cancel', onClick: () => App.modal.close() },
        { label: 'Save question', kind: 'primary', onClick: save }
      ]
    });

    const g = (id) => $(id, body);
    g('#qe-text').value = st.text; g('#qe-topic').value = st.topic; g('#qe-marks').value = st.marks;
    g('#qe-tags').value = st.tagsText; g('#qe-img').value = st.image_url || '';
    g('#qe-model').value = st.model_answer || ''; g('#qe-expl').value = st.explanation || '';

    const link = (id, key) => { g(id).oninput = g(id).onchange = (e) => { st[key] = e.target.value; }; };
    link('#qe-text', 'text'); link('#qe-topic', 'topic'); link('#qe-diff', 'difficulty'); link('#qe-status', 'status');
    link('#qe-tags', 'tagsText'); link('#qe-img', 'image_url'); link('#qe-model', 'model_answer'); link('#qe-expl', 'explanation');
    g('#qe-marks').oninput = (e) => { st.marks = e.target.value; };
    g('#qe-type').onchange = (e) => {
      st.type = e.target.value;
      if (st.type === 'mcq' && st.answer.length > 1) st.answer = [st.answer[0]];
      layout();
    };

    function layout() {
      g('#qe-obj').hidden = !isObj();
      g('#qe-sub').hidden = isObj();
      g('#qe-marks').disabled = !isObj();
      if (!isObj()) g('#qe-marks').value = sum(); else g('#qe-marks').value = st.marks;
      drawOpts(); drawRubric();
    }

    function drawOpts() {
      const multi = st.type === 'checkbox';
      g('#qe-opts').innerHTML = st.options.map((o, i) =>
        '<div class="opt-row"><strong>' + LETTERS[i] + '</strong>' +
        '<input type="' + (multi ? 'checkbox' : 'radio') + '" name="qe-ans" data-i="' + i + '" aria-label="Option ' + LETTERS[i] + ' is correct"' + (st.answer.indexOf(LETTERS[i]) >= 0 ? ' checked' : '') + '>' +
        '<input type="text" class="opt-text" data-i="' + i + '" value="' + esc(o) + '" aria-label="Option ' + LETTERS[i] + ' text">' +
        '<button type="button" class="btn small ghost" data-rm="' + i + '"' + (st.options.length <= 2 ? ' disabled' : '') + '>Remove</button></div>').join('');
      g('#qe-addopt').disabled = st.options.length >= LETTERS.length;
      g('#qe-opthint').textContent = multi ? 'Tick every correct option.' : 'Select the one correct option.';
      $$('.opt-text', body).forEach((el) => (el.oninput = () => { st.options[+el.dataset.i] = el.value; }));
      $$('input[name=qe-ans]', body).forEach((el) => (el.onchange = () => {
        const L = LETTERS[+el.dataset.i];
        if (multi) st.answer = el.checked ? st.answer.concat(L) : st.answer.filter((a) => a !== L);
        else st.answer = [L];
      }));
      $$('[data-rm]', body).forEach((el) => (el.onclick = () => {
        const i = +el.dataset.rm, L = LETTERS[i];
        st.options.splice(i, 1);
        // shift answer letters after the removed option
        st.answer = st.answer.filter((a) => a !== L).map((a) => (LETTERS.indexOf(a) > i ? LETTERS[LETTERS.indexOf(a) - 1] : a));
        drawOpts();
      }));
    }
    g('#qe-addopt').onclick = () => { if (st.options.length < LETTERS.length) { st.options.push(''); drawOpts(); } };

    function drawRubric() {
      g('#qe-rub').innerHTML = st.rubric.map((r, i) =>
        '<div class="rub-row"><input type="text" class="rc" data-i="' + i + '" placeholder="What earns these points" value="' + esc(r.criterion) + '" aria-label="Criterion ' + (i + 1) + '">' +
        '<input type="number" class="rp" data-i="' + i + '" min="0.5" step="0.5" value="' + esc(r.points) + '" aria-label="Points ' + (i + 1) + '">' +
        '<button type="button" class="btn small ghost" data-rr="' + i + '"' + (st.rubric.length <= 1 ? ' disabled' : '') + '>Remove</button></div>').join('');
      g('#qe-rubsum').textContent = 'Total marks: ' + sum();
      $$('.rc', body).forEach((el) => (el.oninput = () => { st.rubric[+el.dataset.i].criterion = el.value; }));
      $$('.rp', body).forEach((el) => (el.oninput = () => {
        st.rubric[+el.dataset.i].points = el.value;
        g('#qe-rubsum').textContent = 'Total marks: ' + sum();
        g('#qe-marks').value = sum();
      }));
      $$('[data-rr]', body).forEach((el) => (el.onclick = () => { st.rubric.splice(+el.dataset.rr, 1); drawRubric(); g('#qe-marks').value = sum(); }));
    }
    g('#qe-addrub').onclick = () => { st.rubric.push({ criterion: '', points: 1 }); drawRubric(); };

    layout();

    function save(btn) {
      const payload = {
        id: q ? q.id : undefined, type: st.type, status: st.status, text: st.text, topic: st.topic,
        difficulty: st.difficulty, tags: st.tagsText.split(',').map((t) => t.trim()).filter(Boolean),
        image_url: st.image_url, explanation: st.explanation
      };
      if (isObj()) { payload.marks = st.marks; payload.options = st.options; payload.answer = st.answer; }
      else { payload.marks = sum(); payload.rubric = st.rubric; payload.model_answer = st.model_answer; }
      return App.busy(btn, async () => {
        try {
          await api('saveQuestion', payload);
          App.modal.close(); toast('Question saved.');
          S.list = null; render();
        } catch (e) {
          const err = g('#qe-err');
          err.textContent = e.message; err.hidden = false;
          body.parentElement.scrollTop = 0; body.scrollTop = 0;
        }
      });
    }
  }

  App.views.questions = { render: render, reset: function () { S.list = null; } };
})();
