/* People: owner manages who can sign in and with what role */
(function () {
  const { $, $$, esc, api, toast } = App;
  const ROLES = [['owner', 'Owner'], ['creator', 'Creator'], ['reviewer', 'Reviewer'], ['candidate', 'Candidate']];
  const HELP = {
    owner: 'Everything, including people and roles.',
    creator: 'Question bank and assessments.',
    reviewer: 'Grades written answers (available in a later phase).',
    candidate: 'Takes assessments they are assigned to.'
  };

  async function render() {
    const v = $('#view');
    v.innerHTML = '<p class="muted">Loading people...</p>';
    let users;
    try { users = await api('listUsers'); } catch (e) { v.innerHTML = '<p class="error">' + esc(e.message) + '</p>'; return; }
    users.sort((a, b) => ROLES.findIndex((r) => r[0] === a.role) - ROLES.findIndex((r) => r[0] === b.role) || a.email.localeCompare(b.email));
    const roleOpts = (cur) => ROLES.map((r) => '<option value="' + r[0] + '"' + (cur === r[0] ? ' selected' : '') + '>' + r[1] + '</option>').join('');

    v.innerHTML =
      '<div class="page-head"><div><h1>People</h1><p class="muted">Only people listed here can sign in, and only with a @' + esc(App.cfg.ALLOWED_DOMAIN) + ' account.</p></div></div>' +
      '<div class="panel"><h3>Add a person</h3><div class="row" style="align-items:flex-end">' +
      '<div class="grow"><label for="pp-email">Email</label><input id="pp-email" type="email" placeholder="name@' + esc(App.cfg.ALLOWED_DOMAIN) + '"></div>' +
      '<div class="grow"><label for="pp-name">Name (optional)</label><input id="pp-name"></div>' +
      '<div><label for="pp-role">Role</label><select id="pp-role">' + roleOpts('creator') + '</select></div>' +
      '<button class="btn primary" id="pp-add">Add person</button></div>' +
      '<p class="hint muted small" id="pp-help" style="margin:.5rem 0 0"></p><p id="pp-err" class="error" role="alert" hidden></p></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Active</th></tr></thead><tbody>' +
      users.map((u) => {
        const me = u.email === App.user.email;
        return '<tr data-email="' + esc(u.email) + '" data-name="' + esc(u.name) + '"><td>' + esc(u.email) + (me ? ' <span class="badge info">You</span>' : '') + '</td><td>' + esc(u.name) + '</td>' +
          '<td><select class="pp-r" aria-label="Role for ' + esc(u.email) + '"' + (me ? ' disabled' : '') + '>' + roleOpts(u.role) + '</select></td>' +
          '<td><input type="checkbox" class="pp-a" aria-label="Active"' + (u.active ? ' checked' : '') + (me ? ' disabled' : '') + '></td></tr>';
      }).join('') + '</tbody></table></div>';

    const help = () => { $('#pp-help').textContent = HELP[$('#pp-role').value]; };
    $('#pp-role').onchange = help; help();

    $('#pp-add').onclick = (e) => App.busy(e.target, async () => {
      const err = $('#pp-err'); err.hidden = true;
      try {
        await api('saveUser', { email: $('#pp-email').value, name: $('#pp-name').value, role: $('#pp-role').value, active: true });
        toast('Person saved.'); render();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });

    $$('#view tbody tr').forEach((tr) => {
      const update = async () => {
        try {
          await api('saveUser', { email: tr.dataset.email, name: tr.dataset.name, role: $('.pp-r', tr).value, active: $('.pp-a', tr).checked });
          toast('Updated ' + tr.dataset.email + '.');
        } catch (ex) { toast(ex.message, true); render(); }
      };
      $('.pp-r', tr).onchange = update;
      $('.pp-a', tr).onchange = update;
    });
  }

  App.views.people = { render: render };
})();
