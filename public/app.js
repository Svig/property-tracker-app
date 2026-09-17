// ============================================================
// Viewing Register — frontend (no build step, plain JS + fetch)
// ============================================================
const STATUSES = [
  { k:'new', label:'New Enquiry', cls:'new' },
  { k:'contacted', label:'Contacted', cls:'contacted' },
  { k:'scheduled', label:'Viewing Scheduled', cls:'scheduled' },
  { k:'offer', label:'Offer Made', cls:'offer' },
  { k:'won', label:'Closed \u2013 Won', cls:'won' },
  { k:'lost', label:'Closed \u2013 Lost', cls:'lost' },
];
const FINANCING = ['Cash buyer','Bond pre-approved','Needs bond approval','Not sure yet'];
const TIMELINE = ['Immediately','1\u20133 months','3\u20136 months','Just browsing'];
const SOURCE = ['Signboard','Online listing','Referral','Walk-in','Repeat client','Other'];

const statusMeta = k => STATUSES.find(s => s.k === k) || STATUSES[0];
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-ZA', { day:'2-digit', month:'short', year:'numeric' }) : '\u2014';
const fmtWhen = iso => { const d = new Date(iso); return d.toLocaleDateString('en-ZA',{day:'2-digit',month:'short'}) + ' \u00b7 ' + d.toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'}); };

// ---------------- app state ----------------
const state = {
  token: localStorage.getItem('vr_token') || null,
  user: null,
  view: 'signin',           // signin | dashboard | users
  clients: [],
  viewing: { property:'', recent:[] },
  users: [],
  selectedClientId: null,
  editingProperty: false,
  loading: true,
  toast: null,
  authError: null,
};

const root = document.getElementById('root');

function showToast(msg){
  state.toast = msg;
  render();
  setTimeout(() => { state.toast = null; render(); }, 2600);
}

// ---------------- API helper ----------------
async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) {
    logout();
    throw new Error('Session expired. Please log in again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function logout(){
  state.token = null;
  state.user = null;
  localStorage.removeItem('vr_token');
  render();
}

async function bootstrap(){
  if (!state.token) { state.loading = false; return render(); }
  try {
    const { user } = await api('/auth/me');
    state.user = user;
    await loadAll();
  } catch (e) {
    logout();
  }
  state.loading = false;
  render();
}

async function loadAll(){
  const [clientsRes, viewingRes] = await Promise.all([api('/clients'), api('/viewing/current')]);
  state.clients = clientsRes.clients;
  state.viewing = viewingRes;
  if (state.user.role === 'admin') {
    const { users } = await api('/users');
    state.users = users;
  }
}

// ---------------- render dispatcher ----------------
function render(){
  if (state.loading) { root.innerHTML = `<div class="loading">Opening the register\u2026</div>`; return; }
  if (!state.token || !state.user) { root.innerHTML = renderLogin(); attachLoginHandlers(); return; }

  root.innerHTML = `
    <header>
      <div class="brand">
        <span class="mark">Viewing Register</span>
        <span class="sub">Property Client Tracker</span>
      </div>
      <div class="tabs">
        <button data-view="signin" class="${state.view==='signin'?'active':''}">New Sign-In</button>
        <button data-view="dashboard" class="${state.view==='dashboard'?'active':''}">Dashboard</button>
        ${state.user.role==='admin' ? `<button data-view="users" class="${state.view==='users'?'active':''}">Manage Users</button>` : ''}
      </div>
      <div class="who">
        <span>${escapeHtml(state.user.name)} \u00b7 ${state.user.role}</span>
        <button id="logoutBtn">Log out</button>
      </div>
    </header>
    <main id="main"></main>
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ''}
  `;

  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { state.view = b.dataset.view; render(); });
  document.getElementById('logoutBtn').onclick = logout;

  const main = document.getElementById('main');
  if (state.view === 'signin') { main.innerHTML = renderSignIn(); attachSignInHandlers(); }
  else if (state.view === 'dashboard') { main.innerHTML = renderDashboard(); attachDashboardHandlers(); }
  else if (state.view === 'users') { main.innerHTML = renderUsers(); attachUsersHandlers(); }

  if (state.selectedClientId) {
    document.body.insertAdjacentHTML('beforeend', renderDrawer());
    attachDrawerHandlers();
  }
  if (state.editingProperty) {
    document.body.insertAdjacentHTML('beforeend', renderPropertyModal());
    attachPropertyModalHandlers();
  }
}

function escapeHtml(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ================= LOGIN =================
function renderLogin(){
  return `
    <div class="login-wrap">
      <div class="deed">
        <h2>Sign in</h2>
        <p>Viewing Register \u2014 staff access only.</p>
        <form id="loginForm">
          <div class="field"><label>Email</label><input type="email" id="loginEmail" required></div>
          <div class="field"><label>Password</label><input type="password" id="loginPassword" required></div>
          ${state.authError ? `<div class="error-text">${escapeHtml(state.authError)}</div>` : ''}
          <button class="btn brass" style="width:100%;margin-top:8px;" type="submit">Log in</button>
        </form>
      </div>
    </div>
  `;
}
function attachLoginHandlers(){
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    try {
      const { token, user } = await api('/auth/login', { method:'POST', body:{ email, password } });
      state.token = token; state.user = user; state.authError = null;
      localStorage.setItem('vr_token', token);
      state.loading = true; render();
      await loadAll();
      state.loading = false;
      render();
    } catch (err) {
      state.authError = err.message;
      render();
    }
  };
}

// ================= SIGN-IN =================
let signInForm = { name:'', phone:'', email:'', property:'', budget:'', financing:'', timeline:'', source:'', consent:false, consentMarketing:false };
let signInDone = null;

function renderSignIn(){
  if (signInDone) {
    return `<div class="signin-wrap"><div class="deed thanks">
      <div class="mark">Thank you, ${escapeHtml(signInDone)}.</div>
      <p style="color:var(--ink-light)">You're on the register. An agent will be in touch shortly.</p>
    </div></div>`;
  }
  if (signInForm.property === '' && state.viewing.property) signInForm.property = state.viewing.property;

  const radioGroup = (name, options, current) => options.map(opt => `
    <label class="opt ${current===opt?'selected':''}" data-group="${name}" data-value="${escapeHtml(opt)}">
      <input type="radio" name="${name}" ${current===opt?'checked':''} style="display:none"/>${escapeHtml(opt)}
    </label>`).join('');

  return `
    <div class="signin-wrap">
      <div class="viewing-bar">
        <div>
          <span class="vb-label">Now viewing</span>
          <div class="vb-name">${escapeHtml(state.viewing.property || 'No property set')}</div>
        </div>
        <button id="changePropertyBtn">Change property</button>
      </div>
      <form id="signInForm" class="deed with-bar">
        <h2>Viewing Sign-In</h2>
        <p class="tagline">Please pop in your details below \u2014 it takes under a minute.</p>

        <div class="field"><label>Full name</label>
          <input type="text" id="si_name" value="${escapeHtml(signInForm.name)}" placeholder="Jane Dlamini" required></div>
        <div class="grid2">
          <div class="field"><label>Mobile number</label>
            <input type="tel" id="si_phone" value="${escapeHtml(signInForm.phone)}" placeholder="082 000 0000" required></div>
          <div class="field"><label>Email (optional)</label>
            <input type="email" id="si_email" value="${escapeHtml(signInForm.email)}" placeholder="jane@example.com"></div>
        </div>
        <div class="field"><label>Property / unit you're viewing</label>
          <input type="text" id="si_property" value="${escapeHtml(signInForm.property)}" placeholder="e.g. 12 Vineyard Close, Unit 4B"></div>
        <div class="field"><label>Approximate budget</label>
          <input type="text" id="si_budget" value="${escapeHtml(signInForm.budget)}" placeholder="e.g. R1.8m \u2013 R2.2m"></div>

        <div class="field"><label>Financing</label><div class="radio-row" id="si_financing">${radioGroup('financing', FINANCING, signInForm.financing)}</div></div>
        <div class="field"><label>Buying timeline</label><div class="radio-row" id="si_timeline">${radioGroup('timeline', TIMELINE, signInForm.timeline)}</div></div>
        <div class="field"><label>How did you hear about this viewing?</label><div class="radio-row" id="si_source">${radioGroup('source', SOURCE, signInForm.source)}</div></div>

        <div class="consent-box">
          <input type="checkbox" id="si_consent" ${signInForm.consent?'checked':''} required>
          <p><label for="si_consent" style="display:inline;text-transform:none;font-weight:500;letter-spacing:0">
            I agree to my details being captured and kept on record for this enquiry, in line with POPIA. (Required)
          </label></p>
        </div>
        <div class="consent-box optional">
          <input type="checkbox" id="si_consentMarketing" ${signInForm.consentMarketing?'checked':''}>
          <p><label for="si_consentMarketing" style="display:inline;text-transform:none;font-weight:500;letter-spacing:0">
            I'd also like to be contacted about this and similar properties in future. (Optional)
          </label></p>
        </div>

        <div style="margin-top:20px">
          <button class="btn brass" type="submit" style="width:100%">Sign In</button>
        </div>
      </form>
    </div>
  `;
}

function attachSignInHandlers(){
  document.getElementById('changePropertyBtn').onclick = () => { state.editingProperty = true; render(); };

  document.querySelectorAll('#signInForm .opt').forEach(el => {
    el.onclick = () => {
      const group = el.dataset.group;
      const key = group === 'financing' ? 'financing' : group === 'timeline' ? 'timeline' : 'source';
      signInForm[key] = el.dataset.value;
      render();
    };
  });

  const f = document.getElementById('signInForm');
  ['name','phone','email','property','budget'].forEach(key => {
    document.getElementById('si_' + key).oninput = e => { signInForm[key] = e.target.value; };
  });
  document.getElementById('si_consent').onchange = e => { signInForm.consent = e.target.checked; };
  document.getElementById('si_consentMarketing').onchange = e => { signInForm.consentMarketing = e.target.checked; };

  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!signInForm.name.trim() || !signInForm.phone.trim() || !signInForm.consent) return;
    try {
      const { client } = await api('/clients', { method:'POST', body: { ...signInForm, viewingDate: new Date().toISOString().slice(0,10) } });
      state.clients.unshift(client);
      signInDone = signInForm.name;
      const firstName = signInForm.name;
      signInForm = { name:'', phone:'', email:'', property: state.viewing.property, budget:'', financing:'', timeline:'', source:'', consent:false, consentMarketing:false };
      render();
      showToast('Saved \u2013 welcome, ' + firstName.split(' ')[0]);
      setTimeout(() => { signInDone = null; render(); }, 1800);
    } catch (err) {
      showToast(err.message);
    }
  };
}

// ================= PROPERTY MODAL =================
function renderPropertyModal(){
  const recent = state.viewing.recent || [];
  return `
    <div class="overlay center" id="propOverlay">
      <div class="property-modal">
        <h3>Set the property being viewed</h3>
        <p class="hint">This pre-fills the sign-in form for everyone at this viewing.</p>
        <div class="field" style="margin-bottom:0">
          <label>Property / unit</label>
          <input type="text" id="propInput" autofocus value="${escapeHtml(state.viewing.property || '')}" placeholder="e.g. 12 Vineyard Close, Unit 4B">
        </div>
        ${recent.length ? `<div class="recent-chips">${recent.map(p => `<button type="button" data-p="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}</div>` : ''}
        <div class="modal-actions">
          ${state.viewing.property ? `<button class="btn secondary" id="propCancel">Cancel</button>` : ''}
          <button class="btn brass" id="propSave">Save & Continue</button>
        </div>
      </div>
    </div>
  `;
}
function attachPropertyModalHandlers(){
  const overlay = document.getElementById('propOverlay');
  const input = document.getElementById('propInput');
  overlay.onclick = e => { if (e.target === overlay && state.viewing.property) { state.editingProperty = false; render(); } };
  document.querySelectorAll('.recent-chips button').forEach(b => b.onclick = () => { input.value = b.dataset.p; });
  const cancelBtn = document.getElementById('propCancel');
  if (cancelBtn) cancelBtn.onclick = () => { state.editingProperty = false; render(); };
  document.getElementById('propSave').onclick = async () => {
    const val = input.value.trim();
    if (!val) return;
    try {
      const res = await api('/viewing/current', { method:'POST', body:{ property: val } });
      state.viewing.property = res.property;
      const viewingRes = await api('/viewing/current');
      state.viewing = viewingRes;
      signInForm.property = val;
      state.editingProperty = false;
      render();
    } catch (err) { showToast(err.message); }
  };
}

// ================= DASHBOARD =================
let dashQuery = '';
let dashStatus = 'all';

function renderDashboard(){
  const filtered = state.clients
    .filter(c => dashStatus === 'all' || c.status === dashStatus)
    .filter(c => {
      if (!dashQuery.trim()) return true;
      const q = dashQuery.toLowerCase();
      return (c.name||'').toLowerCase().includes(q) || (c.property||'').toLowerCase().includes(q) || (c.phone||'').includes(q);
    })
    .sort((a,b) => a.name.localeCompare(b.name));

  const weekAgo = Date.now() - 7*24*60*60*1000;
  const stats = {
    total: state.clients.length,
    thisWeek: state.clients.filter(c => new Date(c.created_at).getTime() > weekAgo).length,
    active: state.clients.filter(c => !['won','lost'].includes(c.status)).length,
    won: state.clients.filter(c => c.status === 'won').length,
  };

  return `
    <div class="stats">
      <div class="card stat"><div class="num">${stats.total}</div><div class="lbl">Total Clients</div></div>
      <div class="card stat"><div class="num">${stats.thisWeek}</div><div class="lbl">Added This Week</div></div>
      <div class="card stat"><div class="num">${stats.active}</div><div class="lbl">Active Leads</div></div>
      <div class="card stat"><div class="num">${stats.won}</div><div class="lbl">Closed Won</div></div>
    </div>
    <div class="toolbar">
      <input type="text" id="dashSearch" placeholder="Search by name, phone or property\u2026" value="${escapeHtml(dashQuery)}">
      <select id="dashStatus">
        <option value="all" ${dashStatus==='all'?'selected':''}>All statuses</option>
        ${STATUSES.map(s => `<option value="${s.k}" ${dashStatus===s.k?'selected':''}>${s.label}</option>`).join('')}
      </select>
      <a class="btn secondary" href="/api/clients/export/csv?token=${encodeURIComponent(state.token)}" id="exportLink">Export CSV</a>
    </div>
    <div class="list-col">
      ${filtered.length === 0 ? `<div class="card empty"><div class="mark">No clients here yet</div><div>Sign-ins from viewings will appear on this register.</div></div>` :
        filtered.map(c => `
          <div class="card client-card" data-id="${c.id}">
            <div class="top">
              <div>
                <div class="name">${escapeHtml(c.name)}</div>
                <div class="meta">${escapeHtml(c.phone)}${c.email ? ' \u00b7 '+escapeHtml(c.email) : ''}</div>
              </div>
              <span class="chip ${statusMeta(c.status).cls}">${statusMeta(c.status).label}</span>
            </div>
            ${c.property ? `<div class="prop">${escapeHtml(c.property)}</div>` : ''}
            <div class="meta" style="margin-top:6px">Signed in ${fmtDate(c.created_at)}${c.budget ? ' \u00b7 '+escapeHtml(c.budget) : ''}</div>
          </div>
        `).join('')}
    </div>
  `;
}

function attachDashboardHandlers(){
  document.getElementById('dashSearch').oninput = e => { dashQuery = e.target.value; render(); };
  document.getElementById('dashStatus').onchange = e => { dashStatus = e.target.value; render(); };
  document.querySelectorAll('.client-card').forEach(el => {
    el.onclick = () => { state.selectedClientId = Number(el.dataset.id); render(); };
  });
  // NOTE: CSV export uses a query-string token here for simplicity of a plain <a> download link.
  // In production, prefer a short-lived signed download URL instead of the JWT in the querystring
  // (see README security notes).
}

// ================= CLIENT DETAIL DRAWER =================
let noteDraft = '';

function renderDrawer(){
  const c = state.clients.find(x => x.id === state.selectedClientId);
  if (!c) return '';
  return `
    <div class="overlay" id="drawerOverlay">
      <div class="drawer">
        <div class="drawer-head">
          <h2>${escapeHtml(c.name)}</h2>
          <button class="closeX" id="drawerClose">&times;</button>
        </div>
        <span class="chip ${statusMeta(c.status).cls}">${statusMeta(c.status).label}</span>
        <dl class="kv">
          <dt>Phone</dt><dd>${escapeHtml(c.phone || '\u2014')}</dd>
          <dt>Email</dt><dd>${escapeHtml(c.email || '\u2014')}</dd>
          <dt>Property</dt><dd>${escapeHtml(c.property || '\u2014')}</dd>
          <dt>Budget</dt><dd>${escapeHtml(c.budget || '\u2014')}</dd>
          <dt>Financing</dt><dd>${escapeHtml(c.financing || '\u2014')}</dd>
          <dt>Timeline</dt><dd>${escapeHtml(c.timeline || '\u2014')}</dd>
          <dt>Source</dt><dd>${escapeHtml(c.source || '\u2014')}</dd>
          <dt>Signed in</dt><dd>${fmtDate(c.created_at)}</dd>
          <dt>Marketing OK</dt><dd>${c.consent_marketing ? 'Yes \u2013 opted in' : 'No'}</dd>
        </dl>
        <label style="margin-bottom:8px">Update status</label>
        <div class="status-row">
          ${STATUSES.map(s => `<button data-status="${s.k}" class="${c.status===s.k?'active':''}">${s.label}</button>`).join('')}
        </div>
        <label style="margin-top:6px">Follow-up notes</label>
        <div class="notes-list">
          ${(c.notes||[]).length === 0 ? `<div style="font-size:13px;color:var(--ink-light)">No notes yet.</div>` :
            (c.notes||[]).slice().reverse().map(n => `<div class="note"><div class="when">${fmtWhen(n.created_at)}</div>${escapeHtml(n.note)}</div>`).join('')}
        </div>
        <div class="addnote">
          <textarea id="noteInput" placeholder="Add a follow-up note\u2026">${escapeHtml(noteDraft)}</textarea>
          <button class="btn secondary" id="addNoteBtn">Add</button>
        </div>
        <div style="margin-top:26px;border-top:1px solid var(--line);padding-top:16px">
          <button class="danger-link" id="deleteClientBtn">Remove this client from the register</button>
        </div>
      </div>
    </div>
  `;
}

function attachDrawerHandlers(){
  const overlay = document.getElementById('drawerOverlay');
  overlay.onclick = e => { if (e.target === overlay) { state.selectedClientId = null; noteDraft = ''; render(); } };
  document.getElementById('drawerClose').onclick = () => { state.selectedClientId = null; noteDraft = ''; render(); };

  document.querySelectorAll('.status-row button').forEach(b => {
    b.onclick = async () => {
      try {
        const { client } = await api(`/clients/${state.selectedClientId}`, { method:'PATCH', body:{ status: b.dataset.status } });
        state.clients = state.clients.map(c => c.id === client.id ? { ...c, ...client } : c);
        render();
      } catch (err) { showToast(err.message); }
    };
  });

  document.getElementById('noteInput').oninput = e => { noteDraft = e.target.value; };
  document.getElementById('addNoteBtn').onclick = async () => {
    if (!noteDraft.trim()) return;
    try {
      const { notes } = await api(`/clients/${state.selectedClientId}/notes`, { method:'POST', body:{ text: noteDraft } });
      state.clients = state.clients.map(c => c.id === state.selectedClientId ? { ...c, notes } : c);
      noteDraft = '';
      render();
    } catch (err) { showToast(err.message); }
  };

  document.getElementById('deleteClientBtn').onclick = async () => {
    const c = state.clients.find(x => x.id === state.selectedClientId);
    if (!confirm(`Remove ${c.name} from the register? This cannot be undone.`)) return;
    try {
      await api(`/clients/${state.selectedClientId}`, { method:'DELETE' });
      state.clients = state.clients.filter(x => x.id !== state.selectedClientId);
      state.selectedClientId = null;
      render();
      showToast('Client record removed');
    } catch (err) { showToast(err.message); }
  };
}

// ================= MANAGE USERS (admin only) =================
let newUserForm = { name:'', email:'', password:'', role:'agent' };

function renderUsers(){
  return `
    <div class="card" style="margin-bottom:20px">
      ${state.users.map(u => `
        <div class="user-row">
          <div>
            <div class="u-name">${escapeHtml(u.name)} ${u.id===state.user.id ? '<span style="color:var(--ink-light);font-weight:400">(you)</span>' : ''}</div>
            <div class="u-email">${escapeHtml(u.email)}</div>
          </div>
          <div class="user-actions">
            <span class="chip role-${u.role}">${u.role}</span>
            <span class="chip ${u.is_active ? 'won' : 'lost'}">${u.is_active ? 'active' : 'disabled'}</span>
            ${u.id!==state.user.id ? `<button class="btn secondary" data-toggle="${u.id}" data-active="${u.is_active}" style="padding:6px 12px;font-size:12px">${u.is_active?'Disable':'Enable'}</button>
            <button class="danger-link" data-del="${u.id}">Delete</button>` : ''}
          </div>
        </div>
      `).join('')}
    </div>

    <div class="card" style="padding:22px;max-width:460px">
      <h3 style="font-family:var(--font-display);margin-top:0">Add a new user</h3>
      <form id="newUserForm">
        <div class="field"><label>Name</label><input type="text" id="nu_name" required></div>
        <div class="field"><label>Email</label><input type="email" id="nu_email" required></div>
        <div class="field"><label>Temporary password</label><input type="password" id="nu_password" minlength="8" required></div>
        <div class="field">
          <label>Role</label>
          <select id="nu_role">
            <option value="agent">Agent \u2014 captures & manages clients</option>
            <option value="admin">Admin \u2014 also manages user logins</option>
          </select>
        </div>
        <button class="btn brass" type="submit">Create user</button>
      </form>
    </div>
  `;
}

function attachUsersHandlers(){
  document.querySelectorAll('[data-toggle]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.toggle;
      const nowActive = b.dataset.active === 'true';
      try {
        await api(`/users/${id}`, { method:'PATCH', body:{ is_active: !nowActive } });
        state.users = state.users.map(u => u.id == id ? { ...u, is_active: !nowActive } : u);
        render();
      } catch (err) { showToast(err.message); }
    };
  });
  document.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('Delete this user? They will no longer be able to log in.')) return;
      try {
        await api(`/users/${b.dataset.del}`, { method:'DELETE' });
        state.users = state.users.filter(u => u.id != b.dataset.del);
        render();
      } catch (err) { showToast(err.message); }
    };
  });
  document.getElementById('newUserForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      name: document.getElementById('nu_name').value,
      email: document.getElementById('nu_email').value,
      password: document.getElementById('nu_password').value,
      role: document.getElementById('nu_role').value,
    };
    try {
      await api('/users', { method:'POST', body });
      const { users } = await api('/users');
      state.users = users;
      render();
      showToast('User created');
    } catch (err) { showToast(err.message); }
  };
}

bootstrap();
