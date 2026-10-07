/* Core: auth, API client, router, modal, toast, helpers */
(function () {
  const cfg = window.APP_CONFIG || {};
  const App = (window.App = { cfg: cfg, token: null, user: null, views: {}, _onToken: null });

  const $ = (s, el) => (el || document).querySelector(s);
  App.$ = $;
  App.$$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  App.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  App.fmtDate = (ms) => (ms ? new Date(Number(ms)).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '-');
  App.toLocalInput = (ms) => {
    if (!ms) return '';
    const d = new Date(Number(ms)), p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  };
  App.fromLocalInput = (v) => (v ? new Date(v).getTime() : 0);

  const BADGE = { approved: 'ok', published: 'ok', draft: 'warn', closed: 'info', archived: '', owner: 'info', creator: 'info', reviewer: 'info', candidate: '' };
  App.badge = (s) => '<span class="badge ' + (BADGE[s] || '') + '">' + App.esc(s) + '</span>';

  App.download = (name, text) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  /** Disable a button while an async action runs. */
  App.busy = async (btn, fn) => {
    const label = btn.textContent;
    btn.disabled = true;
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
  };

  // ---------- toast ----------
  let toastTimer;
  App.toast = (msg, bad) => {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = 'toast'), bad ? 6000 : 2800);
  };

  // ---------- modal ----------
  let dismissable = true;
  App.modal = {
    open(o) {
      dismissable = o.dismissable !== false;
      $('#modal-title').textContent = o.title || '';
      const body = $('#modal-body');
      body.innerHTML = '';
      if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
      const foot = $('#modal-foot');
      foot.innerHTML = '';
      (o.actions || []).forEach((a) => {
        const b = document.createElement('button');
        b.className = 'btn ' + (a.kind || '');
        b.textContent = a.label;
        b.onclick = () => a.onClick(b);
        foot.appendChild(b);
      });
      foot.hidden = !(o.actions || []).length;
      $('#modal-x').hidden = !dismissable;
      $('.modal-box').classList.toggle('wide', !!o.wide);
      $('#modal').hidden = false;
      return body;
    },
    close() { $('#modal').hidden = true; $('#modal-body').innerHTML = ''; }
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden && dismissable) App.modal.close(); });

  // ---------- auth ----------
  const isPlaceholder = (v) => !v || String(v).indexOf('PASTE_') === 0;

  function jwtExp(t) {
    try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch (e) { return 0; }
  }

  function showLogin(msg) {
    App.user = null;
    $('#app').hidden = true;
    $('#login').hidden = false;
    const el = $('#login-error');
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  function showApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#me-name').textContent = App.user.name || App.user.email;
    $('#me-role').textContent = App.user.role + (App.user.name ? ' - ' + App.user.email : '');
    route();
  }

  async function login() {
    try {
      App.user = await App.api('whoami', {}, { noReauth: true });
      showApp();
    } catch (e) {
      sessionStorage.removeItem('idtoken');
      App.token = null;
      showLogin(e.message);
    }
  }

  App.initAuth = function () {
    if (isPlaceholder(cfg.API_URL) || isPlaceholder(cfg.GOOGLE_CLIENT_ID)) {
      showLogin('Not configured yet: fill in API_URL and GOOGLE_CLIENT_ID in config.js.');
      return;
    }
    google.accounts.id.initialize({
      client_id: cfg.GOOGLE_CLIENT_ID,
      hd: cfg.ALLOWED_DOMAIN,
      callback: (resp) => {
        App.token = resp.credential;
        sessionStorage.setItem('idtoken', App.token);
        if (App._onToken) { const f = App._onToken; App._onToken = null; f(); } else login();
      }
    });
    google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', text: 'signin_with' });
    const saved = sessionStorage.getItem('idtoken');
    if (saved && jwtExp(saved) > Date.now() + 60000) { App.token = saved; login(); } else showLogin();
  };

  let reauthPromise = null;
  function reauth() {
    if (reauthPromise) return reauthPromise;
    reauthPromise = new Promise((resolve) => {
      App.modal.open({
        title: 'Session expired',
        body: '<p>Sign in again to continue. Whatever is on this page is kept.</p><div id="gbtn2"></div>',
        dismissable: false
      });
      google.accounts.id.renderButton($('#gbtn2'), { theme: 'outline', size: 'large', text: 'signin_with' });
      App._onToken = () => { App.modal.close(); reauthPromise = null; resolve(); };
    });
    return reauthPromise;
  }

  $('#signout').onclick = () => {
    if (window.google) google.accounts.id.disableAutoSelect();
    sessionStorage.removeItem('idtoken');
    App.token = null;
    showLogin();
  };

  // ---------- API ----------
  App.api = async function (action, payload, opts) {
    opts = opts || {};
    for (let attempt = 0; attempt < 2; attempt++) {
      let j;
      try {
        const res = await fetch(cfg.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight on Apps Script
          body: JSON.stringify({ action: action, token: App.token, payload: payload || {} })
        });
        j = await res.json();
      } catch (e) {
        throw new Error('Could not reach the server. Check your connection and the API_URL in config.js.');
      }
      if (j.ok) return j.data;
      if (j.code === 401 && attempt === 0 && App.user && !opts.noReauth) { await reauth(); continue; }
      throw new Error(j.error || 'Something went wrong.');
    }
  };

  // ---------- router ----------
  function navFor(role) {
    const q = { key: 'questions', label: 'Question bank' }, i = { key: 'import', label: 'Import questions' },
      a = { key: 'assessments', label: 'Assessments' }, p = { key: 'people', label: 'People' };
    if (role === 'owner') return [q, i, a, p];
    if (role === 'creator') return [q, i, a];
    return [{ key: 'noaccess', label: 'Home' }];
  }

  App.views.noaccess = {
    render() {
      $('#view').innerHTML = '<div class="page-head"><h1>Nothing here for your role yet</h1></div>' +
        '<div class="panel"><p>The review queue for reviewers arrives in a later phase. Candidates take exams from the <a href="exam.html">candidate page</a>, not this admin site.</p></div>';
    }
  };

  function route() {
    if (!App.user) return;
    const parts = (location.hash || '').replace(/^#\/?/, '').split('/');
    const items = navFor(App.user.role);
    const key = items.some((n) => n.key === parts[0]) ? parts[0] : items[0].key;
    $('#nav').innerHTML = items.map((n) => '<a href="#/' + n.key + '"' + (n.key === key ? ' aria-current="page"' : '') + '>' + App.esc(n.label) + '</a>').join('');
    App.views[key].render(parts.slice(1).join('/') || null);
  }
  App.route = route;
  window.addEventListener('hashchange', route);
})();
