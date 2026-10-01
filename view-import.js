/* Bulk import of questions from CSV */
(function () {
  const { $, esc, api, toast } = App;

  const HEADERS = ['type', 'topic', 'tags', 'difficulty', 'marks', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'option_e', 'option_f', 'answer', 'rubric', 'model_answer', 'explanation', 'image_url'];
  const REQUIRED = ['type', 'topic', 'difficulty', 'question'];
  const TEMPLATE = [
    HEADERS,
    ['mcq', 'Example topic', 'example-tag', 'easy', '1', 'Replace with a single-choice question', 'First option', 'Second option', 'Third option', 'Fourth option', '', '', 'B', '', '', 'Optional explanation', ''],
    ['checkbox', 'Example topic', '', 'medium', '2', 'Replace with a multiple-choice question', 'Option one', 'Option two', 'Option three', 'Option four', '', '', 'A|C', '', '', '', ''],
    ['descriptive', 'Example topic', 'teaching', 'medium', '', 'Replace with a descriptive question', '', '', '', '', '', '', '', 'Explains the concept correctly:3|Gives a relevant example:2', 'Write the ideal answer here', '', ''],
    ['pseudocode', 'Example topic', '', 'hard', '', 'Replace with a pseudo-code question', '', '', '', '', '', '', '', 'Correct logic:4|Handles edge cases:2', 'Write the model pseudo-code here', '', '']
  ];

  const csvCell = (v) => (/[",\n\r]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  const toCSV = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = []; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  const S = { rows: null, result: null, fileName: '' };

  function render() {
    S.rows = null; S.result = null;
    $('#view').innerHTML =
      '<div class="page-head"><div><h1>Import questions</h1><p class="muted">Upload a CSV, review the checks, then import the valid rows.</p></div>' +
      '<button class="btn" id="im-tpl">Download template</button></div>' +
      '<div class="panel"><div class="field"><label for="im-file">CSV file</label><input id="im-file" type="file" accept=".csv,text/csv">' +
      '<div class="hint">Up to 500 rows per file. For checkbox questions separate correct answers with | (for example A|C). Rubric format: criterion:points|criterion:points.</div></div></div>' +
      '<div id="im-out"></div>';
    $('#im-tpl').onclick = () => App.download('question-template.csv', toCSV(TEMPLATE));
    $('#im-file').onchange = onFile;
  }

  async function onFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    const out = $('#im-out');
    S.fileName = f.name;
    let grid;
    try { grid = parseCSV(await f.text()); } catch (err) { out.innerHTML = '<p class="error">Could not read that file.</p>'; return; }
    if (grid.length < 2) { out.innerHTML = '<p class="error">The file needs a header row and at least one question.</p>'; return; }

    const head = grid[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const missing = REQUIRED.filter((h) => head.indexOf(h) < 0);
    if (missing.length) { out.innerHTML = '<p class="error">Missing column(s): ' + esc(missing.join(', ')) + '. Download the template to see the expected columns.</p>'; return; }

    S.rows = grid.slice(1).map((r) => { const o = {}; head.forEach((h, i) => { o[h] = (r[i] || '').trim(); }); return o; });
    out.innerHTML = '<p class="muted">Checking ' + S.rows.length + ' rows...</p>';
    try {
      S.result = await api('importQuestions', { rows: S.rows, commit: false });
    } catch (err) { out.innerHTML = '<p class="error">' + esc(err.message) + '</p>'; return; }
    drawPreview();
  }

  function drawPreview() {
    const r = S.result, out = $('#im-out');
    out.innerHTML =
      '<div class="panel"><div class="row"><div class="grow"><h3>' + esc(S.fileName) + '</h3>' +
      '<p style="margin:0"><span class="badge ok">' + r.valid + ' ready</span> <span class="badge ' + (r.invalid ? 'bad' : '') + '">' + r.invalid + ' with errors</span> ' +
      '<span class="muted small">Rows with errors are skipped. Fix them in the file and upload again; rows already imported will show as duplicates.</span></p></div></div>' +
      '<div class="row" style="margin-top:.9rem"><label class="check"><input type="checkbox" id="im-approve" checked> Approve questions on import</label><span class="grow"></span>' +
      '<button class="btn primary" id="im-go"' + (r.valid ? '' : ' disabled') + '>Import ' + r.valid + ' question' + (r.valid === 1 ? '' : 's') + '</button></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Row</th><th>Result</th><th>Question</th><th>Type</th><th>Topic</th></tr></thead><tbody>' +
      r.results.map((x) => '<tr><td class="mono">' + x.row + '</td><td>' +
        (x.ok ? '<span class="badge ok">Ready</span>' : '<span class="badge bad">Error</span><div class="error small">' + x.errors.map(esc).join('<br>') + '</div>') +
        '</td><td class="text-cell"><div class="clamp">' + esc(x.preview.text) + '</div></td><td>' + esc(x.preview.type) + '</td><td>' + esc(x.preview.topic) + '</td></tr>').join('') +
      '</tbody></table></div>';

    $('#im-go').onclick = (e) => App.busy(e.target, async () => {
      try {
        const res = await api('importQuestions', { rows: S.rows, commit: true, status: $('#im-approve').checked ? 'approved' : 'draft' });
        toast(res.imported + ' question(s) imported.');
        if (App.views.questions.reset) App.views.questions.reset();
        location.hash = '#/questions';
      } catch (err) { toast(err.message, true); }
    });
  }

  App.views.import = { render: render };
})();
