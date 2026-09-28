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
const CURRENCY = 'R'; // South African Rand — change this one constant to rebrand currency

const statusMeta = k => STATUSES.find(s => s.k === k) || STATUSES[0];
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-ZA', { day:'2-digit', month:'short', year:'numeric' }) : '\u2014';
const fmtWhen = iso => { const d = new Date(iso); return d.toLocaleDateString('en-ZA',{day:'2-digit',month:'short'}) + ' \u00b7 ' + d.toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'}); };
const digitsOnly = s => (s || '').replace(/[^\d]/g, '');
const formatThousands = digits => digits ? Number(digits).toLocaleString('en-ZA') : '';

// ---------------- app state ----------------
const state = {
  token: localStorage.getItem('vr_token') || null,
  user: null,
  theme: null,               // { appName, primaryColor, brassColor, logoUrl } — this tenant's branding, applied at login/session-restore
  view: 'signin',           // signin | dashboard | users | properties
  clients: [],
  viewing: { property:'', propertyId:null, listingUrl:null, recent:[] },
  users: [],
  properties: [],
  historyCache: {},         // clientId -> [{...}] viewing history across properties
  selectedClientId: null,
  editingProperty: false,
  visitorsForPropertyId: null,
  agentsForPropertyId: null,
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
  if (res.status === 401 && state.token) { // only a real expired session, not a failed login attempt (no token yet)
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
  resetTheme();
  render();
}

// Applies this tenant's branding as CSS variable overrides on :root, and
// swaps the header's title/logo. Deliberately scoped: only the two
// "identity" colors (--ink, the dark/primary tone; --brass, the accent)
// are overridden, not every derived shade (--ink-light, --brass-dark,
// etc.) — a full recomputed palette per tenant is a bigger follow-up if
// wanted. This runs after every login and every session-restore (/me),
// so it can never show stale branding from a previously logged-in tenant
// on a shared device.
function applyTheme(theme){
  state.theme = theme || null;
  const el = document.documentElement;
  if (theme?.primaryColor) el.style.setProperty('--ink', theme.primaryColor);
  else el.style.removeProperty('--ink');
  if (theme?.brassColor) el.style.setProperty('--brass', theme.brassColor);
  else el.style.removeProperty('--brass');
  document.title = (theme?.appName || 'Viewing Register') + ' \u2014 Viewing Sign-In';
}

function resetTheme(){
  applyTheme(null);
}

async function bootstrap(){
  if (!state.token) { state.loading = false; return render(); }
  try {
    const { user, theme } = await api('/auth/me');
    state.user = user;
    applyTheme(theme);
    await loadAll();
  } catch (e) {
    logout();
  }
  state.loading = false;
  render();
}

async function loadAll(){
  const [clientsRes, viewingRes, propertiesRes] = await Promise.all([api('/clients'), api('/viewing/current'), api('/properties')]);
  state.clients = clientsRes.clients;
  state.viewing = viewingRes;
  state.properties = propertiesRes.properties;
  if (state.user.role === 'admin') {
    const { users } = await api('/users');
    state.users = users;
  }
}

// ---------------- render dispatcher ----------------
function render(){
  // These are appended directly to <body> (outside #root) so they can sit
  // above everything, but that means nothing ever clears them automatically
  // the way root.innerHTML reassignment does. Remove any leftover ones from
  // the previous render before deciding whether a fresh one is needed —
  // otherwise closing a modal leaves an invisible-but-still-there copy
  // stacking up in the DOM (this was the "Save & Continue doesn't close it"
  // bug).
  document.getElementById('drawerOverlay')?.remove();
  document.getElementById('propOverlay')?.remove();
  document.getElementById('visitorsOverlay')?.remove();
  document.getElementById('agentsOverlay')?.remove();

  if (state.loading) { root.innerHTML = `<div class="loading">Opening the register\u2026</div>`; return; }
  if (!state.token || !state.user) { root.innerHTML = renderLogin(); attachLoginHandlers(); return; }

  root.innerHTML = `
    <header>
      <div class="brand">
        ${state.theme?.logoUrl
          ? `<img src="${escapeHtml(state.theme.logoUrl)}" alt="${escapeHtml(state.theme.appName || 'logo')}" style="height:28px;max-width:160px;object-fit:contain;border-radius:3px">`
          : `<span class="mark">${escapeHtml(state.theme?.appName || 'Viewing Register')}</span>`}
        <span class="sub">Property Client Tracker</span>
      </div>
      <div class="tabs">
        <button data-view="signin" class="${state.view==='signin'?'active':''}">New Sign-In</button>
        <button data-view="dashboard" class="${state.view==='dashboard'?'active':''}">Dashboard</button>
        ${state.user.role==='admin' ? `<button data-view="users" class="${state.view==='users'?'active':''}">Manage Users</button>` : ''}
        <button data-view="properties" class="${state.view==='properties'?'active':''}">Properties</button>
      </div>
      <div class="who">
        ${localStorage.getItem('vr_superadmin_token') ? `<button id="backToSuperAdminBtn" style="border-color:var(--rust);color:#D98F73">\u2190 Back to Super Admin</button>` : ''}
        <span>${escapeHtml(state.user.name)} \u00b7 ${state.user.role}</span>
        <button id="logoutBtn">Log out</button>
      </div>
    </header>
    <main id="main"></main>
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ''}
  `;

  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
    if (b.dataset.view === 'signin' && signInDone) signInDone = null; // landing on Sign-In always gives a fresh form, never a stale thank-you screen
    state.view = b.dataset.view;
    render();
  });
  document.getElementById('logoutBtn').onclick = logout;
  const backBtn = document.getElementById('backToSuperAdminBtn');
  if (backBtn) backBtn.onclick = () => { window.location.href = '/superadmin'; };

  const main = document.getElementById('main');
  if (state.view === 'signin') { main.innerHTML = renderSignIn(); attachSignInHandlers(); }
  else if (state.view === 'dashboard') { main.innerHTML = renderDashboard(); attachDashboardHandlers(); }
  else if (state.view === 'users') { main.innerHTML = renderUsers(); attachUsersHandlers(); }
  else if (state.view === 'properties') { main.innerHTML = renderProperties(); attachPropertiesHandlers(); }

  if (state.selectedClientId) {
    document.body.insertAdjacentHTML('beforeend', renderDrawer());
    attachDrawerHandlers();
  }
  if (state.editingProperty) {
    document.body.insertAdjacentHTML('beforeend', renderPropertyModal());
    attachPropertyModalHandlers();
  }
  if (state.visitorsForPropertyId) {
    document.body.insertAdjacentHTML('beforeend', renderVisitorsModal());
    attachVisitorsModalHandlers();
  }
  if (state.agentsForPropertyId) {
    document.body.insertAdjacentHTML('beforeend', renderAgentsModal());
    attachAgentsModalHandlers();
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
      const { token, user, theme } = await api('/auth/login', { method:'POST', body:{ email, password } });
      state.token = token; state.user = user; state.authError = null;
      applyTheme(theme);
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
let signInForm = {
  name:'', phone:'', email:'', property:'', propertyId:null,
  budgetFrom:'', budgetTo:'', financing:'', timeline:'',
  source:[], sourceDetail:'', consent:false, consentMarketing:false,
};
let signInDone = null; // { name, listingUrl } while showing the thank-you screen

function renderSignIn(){
  if (signInDone) {
    return `<div class="signin-wrap"><div class="deed thanks">
      <div class="mark">Thank you, ${escapeHtml(signInDone.name)}!</div>
      <p style="color:var(--ink-light)">Enjoy your tour of the home. If you have any questions or would like price and feature sheets, an agent is nearby to help you.</p>
      ${signInDone.listingUrl ? `<a class="btn brass" href="${escapeHtml(signInDone.listingUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:14px;margin-right:10px;text-decoration:none">View Listing</a>` : ''}
      <button class="btn secondary" id="signInAnotherBtn" style="margin-top:14px">Sign in another guest</button>
    </div></div>`;
  }
  signInForm.property = state.viewing.property || '';
  signInForm.propertyId = state.viewing.propertyId || null;

  const radioGroup = (name, options, current) => options.map(opt => `
    <label class="opt ${current===opt?'selected':''}" data-group="${name}" data-value="${escapeHtml(opt)}">
      <input type="radio" class="opt-input" name="${name}" ${current===opt?'checked':''} style="display:none"/>${escapeHtml(opt)}
    </label>`).join('');

  const sourceGroup = SOURCE.map((opt, i) => `
    <label class="opt ${signInForm.source.includes(opt)?'selected':''}" data-source="${escapeHtml(opt)}">
      <input type="checkbox" id="src_${i}" ${signInForm.source.includes(opt)?'checked':''} style="display:none"/>${escapeHtml(opt)}
    </label>`).join('');

  const isReferral = signInForm.source.includes('Referral');
  const detailLabel = isReferral ? 'Referred by who?' : 'Notes';
  const detailPlaceholder = isReferral ? "The name of the person who referred you" : 'Anything else you\u2019d like us to know (optional)';

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
          <input type="text" id="si_property" value="${escapeHtml(signInForm.property)}" placeholder="Set via \"Change property\" above" readonly></div>

        <div class="field"><label>Approximate budget</label>
          <div class="grid2">
            <div class="currency-field">
              <span class="currency-prefix">${CURRENCY}</span>
              <input type="text" inputmode="numeric" id="si_budgetFrom" value="${escapeHtml(formatThousands(signInForm.budgetFrom))}" placeholder="From, e.g. 1,800,000">
            </div>
            <div class="currency-field">
              <span class="currency-prefix">${CURRENCY}</span>
              <input type="text" inputmode="numeric" id="si_budgetTo" value="${escapeHtml(formatThousands(signInForm.budgetTo))}" placeholder="To (optional)">
            </div>
          </div>
        </div>

        <div class="field"><label>Financing</label><div class="radio-row" id="si_financing">${radioGroup('financing', FINANCING, signInForm.financing)}</div></div>
        <div class="field"><label>Buying timeline</label><div class="radio-row" id="si_timeline">${radioGroup('timeline', TIMELINE, signInForm.timeline)}</div></div>
        <div class="field"><label>How did you hear about this viewing/us?</label><div class="radio-row" id="si_source">${sourceGroup}</div></div>
        <div class="field"><label>${detailLabel}</label>
          <input type="text" id="si_sourceDetail" value="${escapeHtml(signInForm.sourceDetail)}" placeholder="${escapeHtml(detailPlaceholder)}"></div>

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
  if (signInDone) {
    // thank-you screen: only this button exists, nothing else to bind
    const backBtn = document.getElementById('signInAnotherBtn');
    if (backBtn) backBtn.onclick = () => { signInDone = null; render(); };
    return;
  }

  document.getElementById('changePropertyBtn').onclick = () => { state.editingProperty = true; render(); };

  document.querySelectorAll('#signInForm .opt[data-group] .opt-input').forEach(input => {
    input.onchange = () => {
      const label = input.closest('.opt');
      signInForm[label.dataset.group] = label.dataset.value;
      render();
    };
  });

  document.querySelectorAll('#signInForm .opt[data-source] input').forEach(input => {
    input.onchange = () => {
      const label = input.closest('.opt');
      const val = label.dataset.source;
      const i = signInForm.source.indexOf(val);
      if (input.checked) { if (i === -1) signInForm.source.push(val); }
      else { if (i !== -1) signInForm.source.splice(i, 1); }
      render(); // re-render so the Referred-by/Notes label updates immediately
    };
  });

  const f = document.getElementById('signInForm');
  ['name','phone','email','sourceDetail'].forEach(key => {
    document.getElementById('si_' + key).oninput = e => { signInForm[key] = e.target.value; };
  });

  ['budgetFrom','budgetTo'].forEach(key => {
    const el = document.getElementById('si_' + key);
    el.oninput = e => {
      const digits = digitsOnly(e.target.value);
      signInForm[key] = digits;
      e.target.value = formatThousands(digits); // live thousands-formatting as they type
    };
  });

  document.getElementById('si_consent').onchange = e => { signInForm.consent = e.target.checked; };
  document.getElementById('si_consentMarketing').onchange = e => { signInForm.consentMarketing = e.target.checked; };

  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!signInForm.name.trim() || !signInForm.phone.trim() || !signInForm.consent) return;

    const budgetParts = [];
    if (signInForm.budgetFrom) budgetParts.push(`${CURRENCY} ${formatThousands(signInForm.budgetFrom)}`);
    if (signInForm.budgetTo) budgetParts.push(`${CURRENCY} ${formatThousands(signInForm.budgetTo)}`);
    const budget = budgetParts.length === 2 ? budgetParts.join(' \u2013 ') : (budgetParts[0] || '');

    try {
      const { client } = await api('/clients', {
        method:'POST',
        body: {
          name: signInForm.name, phone: signInForm.phone, email: signInForm.email,
          property: signInForm.property, propertyId: signInForm.propertyId,
          budget, financing: signInForm.financing, timeline: signInForm.timeline,
          source: signInForm.source, sourceDetail: signInForm.sourceDetail,
          consent: signInForm.consent, consentMarketing: signInForm.consentMarketing,
          viewingDate: new Date().toISOString().slice(0,10),
        },
      });
      state.clients.unshift(client);
      signInDone = { name: signInForm.name, listingUrl: state.viewing.listingUrl };
      const firstName = signInForm.name;
      signInForm = {
        name:'', phone:'', email:'', property: state.viewing.property, propertyId: state.viewing.propertyId,
        budgetFrom:'', budgetTo:'', financing:'', timeline:'', source:[], sourceDetail:'',
        consent:false, consentMarketing:false,
      };
      render();
      showToast('Saved \u2013 welcome, ' + firstName.split(' ')[0]);
      setTimeout(() => { signInDone = null; render(); }, 4000);
    } catch (err) {
      showToast(err.message);
    }
  };
}

// ================= PROPERTY MODAL =================
function renderPropertyModal(){
  const recent = state.viewing.recent || []; // [{id, name, listing_url}]
  const allProps = state.properties || [];
  return `
    <div class="overlay center" id="propOverlay">
      <div class="property-modal">
        <h3>Set the property being viewed</h3>
        <p class="hint">Pick an existing property, or type a new one to add it on the fly \u2014 this pre-fills the sign-in form for everyone at this viewing.</p>
        <div class="field" style="margin-bottom:0">
          <label>Property / unit</label>
          <input type="text" id="propInput" autofocus list="propList" value="${escapeHtml(state.viewing.property || '')}" placeholder="e.g. 12 Vineyard Close, Unit 4B">
          <datalist id="propList">
            ${allProps.map(p => `<option value="${escapeHtml(p.name)}">`).join('')}
          </datalist>
        </div>
        ${recent.length ? `<div class="recent-chips">${recent.map(p => `<button type="button" data-p="${escapeHtml(p.name)}">${escapeHtml(p.name)}</button>`).join('')}</div>` : ''}
        <p class="hint" style="margin:12px 0 0">Need to add an address or listing link? Do that from the <strong>Properties</strong> tab afterwards.</p>
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
    const match = (state.properties || []).find(p => p.name.toLowerCase() === val.toLowerCase());
    const body = match ? { propertyId: match.id } : { propertyName: val };
    try {
      await api('/viewing/current', { method:'POST', body });
      const [viewingRes, propertiesRes] = await Promise.all([api('/viewing/current'), api('/properties')]);
      state.viewing = viewingRes;
      state.properties = propertiesRes.properties;
      signInForm.property = viewingRes.property;
      signInForm.propertyId = viewingRes.propertyId;
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
    el.onclick = () => {
      const id = Number(el.dataset.id);
      state.selectedClientId = id;
      render();
      loadClientHistory(id);
    };
  });
  // NOTE: CSV export uses a query-string token here for simplicity of a plain <a> download link.
  // In production, prefer a short-lived signed download URL instead of the JWT in the querystring
  // (see README security notes).
}

async function loadClientHistory(id){
  try {
    const { history } = await api(`/clients/${id}/history`);
    state.historyCache[id] = history;
    if (state.selectedClientId === id) render();
  } catch (err) {
    // non-critical — the drawer just keeps showing "Loading history..."
  }
}

// ================= CLIENT DETAIL DRAWER =================
let noteDraft = '';

function renderDrawer(){
  const c = state.clients.find(x => x.id === state.selectedClientId);
  if (!c) return '';
  const history = state.historyCache[c.id];
  const isReferral = (c.source || '').includes('Referral');

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
          <dt>Property</dt><dd>${escapeHtml(c.property || '\u2014')}${c.property_listing_url ? ` \u00b7 <a href="${escapeHtml(c.property_listing_url)}" target="_blank" rel="noopener noreferrer">View Listing</a>` : ''}</dd>
          <dt>Budget</dt><dd>${escapeHtml(c.budget || '\u2014')}</dd>
          <dt>Financing</dt><dd>${escapeHtml(c.financing || '\u2014')}</dd>
          <dt>Timeline</dt><dd>${escapeHtml(c.timeline || '\u2014')}</dd>
          <dt>Source</dt><dd>${escapeHtml(c.source || '\u2014')}</dd>
          <dt>${isReferral ? 'Referred by' : 'Notes'}</dt><dd>${escapeHtml(c.source_detail || '\u2014')}</dd>
          <dt>Signed in</dt><dd>${fmtDate(c.created_at)}</dd>
          <dt>Marketing OK</dt><dd>${c.consent_marketing ? 'Yes \u2013 opted in' : 'No'}</dd>
        </dl>

        <label style="margin-bottom:8px">Viewing history</label>
        <div class="notes-list">
          ${history === undefined ? `<div style="font-size:13px;color:var(--ink-light)">Loading history\u2026</div>` :
            history.length <= 1 ? `<div style="font-size:13px;color:var(--ink-light)">No other viewings on record for this phone number.</div>` :
            history.map(h => `
              <div class="note">
                <div class="when">${fmtWhen(h.created_at)}${h.id===c.id ? ' \u00b7 this sign-in' : ''}</div>
                ${escapeHtml(h.property || 'Property not recorded')}${h.property_listing_url ? ` \u00b7 <a href="${escapeHtml(h.property_listing_url)}" target="_blank" rel="noopener noreferrer">View Listing</a>` : ''}
              </div>
            `).join('')}
        </div>

        <label style="margin-bottom:8px;margin-top:16px">Update status</label>
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
let newUserForm = { name:'', email:'', mobile:'', password:'', role:'agent' };
let editingUserId = null;
let editUserDraft = {};

function renderUsers(){
  return `
    <div class="card" style="margin-bottom:20px">
      ${state.users.map(u => {
        const isSelf = u.id === state.user.id;
        const locked = u.is_primary_admin; // protected from anyone, including other admins
        if (editingUserId === u.id) {
          return `
            <div class="user-row" data-editrow="${u.id}">
              <div style="flex:1;min-width:240px;display:flex;flex-direction:column;gap:8px">
                <input type="text" id="eu_name" value="${escapeHtml(editUserDraft.name)}" placeholder="Name">
                <input type="email" id="eu_email" value="${escapeHtml(editUserDraft.email)}" placeholder="Email">
                <input type="tel" id="eu_mobile" value="${escapeHtml(editUserDraft.mobile)}" placeholder="Mobile number (optional)">
              </div>
              <div class="user-actions">
                <button class="btn brass" data-save-user="${u.id}" style="padding:8px 14px;font-size:12.5px">Save</button>
                <button class="btn secondary" data-cancel-edit-user style="padding:8px 14px;font-size:12.5px">Cancel</button>
              </div>
            </div>
          `;
        }
        return `
        <div class="user-row">
          <div>
            <div class="u-name">
              ${escapeHtml(u.name)}
              ${isSelf ? '<span style="color:var(--ink-light);font-weight:400"> (you)</span>' : ''}
              ${locked ? '<span class="chip role-admin" style="margin-left:6px">Primary Admin</span>' : ''}
            </div>
            <div class="u-email">${escapeHtml(u.email)}${u.mobile ? ' \u00b7 '+escapeHtml(u.mobile) : ''}</div>
          </div>
          <div class="user-actions">
            <span class="chip role-${u.role}">${u.role}</span>
            <span class="chip ${u.is_active ? 'won' : 'lost'}">${u.is_active ? 'active' : 'disabled'}</span>
            <button class="btn secondary" data-edit-user="${u.id}" style="padding:6px 12px;font-size:12px">Edit</button>
            <button class="btn secondary" data-reset-pw="${u.id}" style="padding:6px 12px;font-size:12px">Reset password</button>
            ${!locked ? `<button class="btn secondary" data-role="${u.id}" data-current-role="${u.role}" style="padding:6px 12px;font-size:12px">${u.role==='admin' ? 'Demote to Agent' : 'Promote to Admin'}</button>` : ''}
            ${!locked && !isSelf ? `<button class="btn secondary" data-toggle="${u.id}" data-active="${u.is_active ? 'true' : 'false'}" style="padding:6px 12px;font-size:12px">${u.is_active?'Disable':'Enable'}</button>
            <button class="danger-link" data-del="${u.id}">Delete</button>` : ''}
          </div>
        </div>
      `;
      }).join('')}
    </div>

    <div class="card" style="padding:22px;max-width:460px">
      <h3 style="font-family:var(--font-display);margin-top:0">Add a new user</h3>
      <form id="newUserForm">
        <div class="field"><label>Name</label><input type="text" id="nu_name" required></div>
        <div class="field"><label>Email</label><input type="email" id="nu_email" required></div>
        <div class="field"><label>Mobile number (optional)</label><input type="tel" id="nu_mobile" placeholder="082 000 0000"></div>
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
  document.querySelectorAll('[data-edit-user]').forEach(b => {
    b.onclick = () => {
      const u = state.users.find(x => x.id == b.dataset.editUser);
      editingUserId = u.id;
      editUserDraft = { name: u.name, email: u.email, mobile: u.mobile || '' };
      render();
    };
  });
  document.querySelectorAll('[data-cancel-edit-user]').forEach(b => {
    b.onclick = () => { editingUserId = null; render(); };
  });
  ['eu_name','eu_email','eu_mobile'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.oninput = e => {
      const key = id === 'eu_name' ? 'name' : id === 'eu_email' ? 'email' : 'mobile';
      editUserDraft[key] = e.target.value;
    };
  });
  document.querySelectorAll('[data-save-user]').forEach(b => {
    b.onclick = async () => {
      try {
        const { user } = await api(`/users/${b.dataset.saveUser}`, { method:'PATCH', body: editUserDraft });
        state.users = state.users.map(u => u.id === user.id ? user : u);
        editingUserId = null;
        render();
        showToast('User details updated.');
      } catch (err) { showToast(err.message); }
    };
  });

  document.querySelectorAll('[data-role]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.role;
      const newRole = b.dataset.currentRole === 'admin' ? 'agent' : 'admin';
      const verb = newRole === 'admin' ? 'promote this user to Admin' : 'demote this user to Agent';
      if (!confirm(`Are you sure you want to ${verb}?`)) return;
      try {
        const { user } = await api(`/users/${id}`, { method:'PATCH', body:{ role: newRole } });
        state.users = state.users.map(u => u.id === user.id ? user : u);
        render();
      } catch (err) { showToast(err.message); }
    };
  });

  document.querySelectorAll('[data-reset-pw]').forEach(b => {
    b.onclick = async () => {
      const newPassword = prompt('Enter a new password for this user (at least 8 characters):');
      if (newPassword === null) return; // cancelled
      if (newPassword.length < 8) { showToast('Password must be at least 8 characters.'); return; }
      try {
        await api(`/users/${b.dataset.resetPw}`, { method:'PATCH', body:{ password: newPassword } });
        showToast('Password reset.');
      } catch (err) { showToast(err.message); }
    };
  });
  document.querySelectorAll('[data-toggle]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.toggle;
      const nowActive = b.dataset.active === 'true';
      try {
        const { user } = await api(`/users/${id}`, { method:'PATCH', body:{ is_active: !nowActive } });
        state.users = state.users.map(u => u.id == id ? user : u);
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
      mobile: document.getElementById('nu_mobile').value,
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

// ================= MANAGE PROPERTIES =================
let newPropertyForm = { name:'', address:'', listingUrl:'' };
let editingPropertyId = null;
let editPropertyDraft = {};

function renderProperties(){
  return `
    <div class="card" style="margin-bottom:20px">
      ${state.properties.length === 0 ? `<div class="empty"><div class="mark">No properties yet</div><div>${state.user.role==='admin' ? 'Add one below, or set one from the sign-in screen\u2019s "Change property" button.' : 'You\u2019re not assigned to any properties yet \u2014 ask an admin to assign you one.'}</div></div>` :
        state.properties.map(p => {
          const isEditing = editingPropertyId === p.id;
          if (isEditing) {
            return `
              <div class="user-row" data-editrow="${p.id}">
                <div style="flex:1;min-width:220px;display:flex;flex-direction:column;gap:8px">
                  <input type="text" id="ep_name" value="${escapeHtml(editPropertyDraft.name)}" placeholder="Property name">
                  <input type="text" id="ep_address" value="${escapeHtml(editPropertyDraft.address)}" placeholder="Address (optional)">
                  <input type="text" id="ep_listingUrl" value="${escapeHtml(editPropertyDraft.listingUrl)}" placeholder="Listing URL (optional)">
                </div>
                <div class="user-actions">
                  <button class="btn brass" data-save-prop="${p.id}" style="padding:8px 14px;font-size:12.5px">Save</button>
                  <button class="btn secondary" data-cancel-edit style="padding:8px 14px;font-size:12.5px">Cancel</button>
                </div>
              </div>
            `;
          }
          return `
            <div class="user-row">
              <div>
                <div class="u-name">${escapeHtml(p.name)}</div>
                <div class="u-email">${escapeHtml(p.address || '')}</div>
                ${p.listing_url ? `<a href="${escapeHtml(p.listing_url)}" target="_blank" rel="noopener noreferrer" style="font-size:12.5px">View Listing \u2197</a>` : ''}
              </div>
              <div class="user-actions">
                <button class="btn secondary" data-visitors="${p.id}" style="padding:6px 12px;font-size:12px">Visitors</button>
                ${state.user.role==='admin' ? `<button class="btn secondary" data-agents="${p.id}" style="padding:6px 12px;font-size:12px">Agents</button>` : ''}
                <button class="btn secondary" data-edit-prop="${p.id}" style="padding:6px 12px;font-size:12px">Edit</button>
                <button class="danger-link" data-del-prop="${p.id}">Delete</button>
              </div>
            </div>
          `;
        }).join('')}
    </div>

    <div class="card" style="padding:22px;max-width:460px">
      <h3 style="font-family:var(--font-display);margin-top:0">Add a property</h3>
      <form id="newPropertyForm">
        <div class="field"><label>Name</label><input type="text" id="np_name" placeholder="e.g. 12 Vineyard Close, Unit 4B" required></div>
        <div class="field"><label>Address (optional)</label><input type="text" id="np_address" placeholder="Street, suburb, city"></div>
        <div class="field"><label>Listing URL (optional)</label><input type="text" id="np_listingUrl" placeholder="https://..."></div>
        <button class="btn brass" type="submit">Add property</button>
      </form>
    </div>
  `;
}

function attachPropertiesHandlers(){
  document.getElementById('newPropertyForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      name: document.getElementById('np_name').value,
      address: document.getElementById('np_address').value,
      listingUrl: document.getElementById('np_listingUrl').value,
    };
    try {
      await api('/properties', { method:'POST', body });
      const { properties } = await api('/properties');
      state.properties = properties;
      render();
      showToast('Property added');
    } catch (err) { showToast(err.message); }
  };

  document.querySelectorAll('[data-edit-prop]').forEach(b => {
    b.onclick = () => {
      const p = state.properties.find(x => x.id == b.dataset.editProp);
      editingPropertyId = p.id;
      editPropertyDraft = { name: p.name, address: p.address || '', listingUrl: p.listing_url || '' };
      render();
    };
  });
  document.querySelectorAll('[data-cancel-edit]').forEach(b => {
    b.onclick = () => { editingPropertyId = null; render(); };
  });
  document.querySelectorAll('[id^=ep_]').forEach(el => {
    el.oninput = e => {
      const key = el.id === 'ep_name' ? 'name' : el.id === 'ep_address' ? 'address' : 'listingUrl';
      editPropertyDraft[key] = e.target.value;
    };
  });
  document.querySelectorAll('[data-save-prop]').forEach(b => {
    b.onclick = async () => {
      try {
        const { property } = await api(`/properties/${b.dataset.saveProp}`, { method:'PATCH', body: editPropertyDraft });
        state.properties = state.properties.map(p => p.id === property.id ? property : p);
        editingPropertyId = null;
        render();
      } catch (err) { showToast(err.message); }
    };
  });
  document.querySelectorAll('[data-del-prop]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('Delete this property? Past sign-ins for it are kept, just unlinked from a live listing.')) return;
      try {
        await api(`/properties/${b.dataset.delProp}`, { method:'DELETE' });
        state.properties = state.properties.filter(p => p.id != b.dataset.delProp);
        render();
      } catch (err) { showToast(err.message); }
    };
  });
  document.querySelectorAll('[data-visitors]').forEach(b => {
    b.onclick = () => { visitorsData = null; state.visitorsForPropertyId = Number(b.dataset.visitors); render(); };
  });
  document.querySelectorAll('[data-agents]').forEach(b => {
    b.onclick = () => { agentsData = null; state.agentsForPropertyId = Number(b.dataset.agents); render(); };
  });
}

// ================= PROPERTY VISITORS REPORT =================
let visitorsData = null; // { property, visitors } once loaded

function renderVisitorsModal(){
  const p = state.properties.find(x => x.id === state.visitorsForPropertyId);
  return `
    <div class="overlay center" id="visitorsOverlay">
      <div class="property-modal" style="max-width:520px;max-height:80vh;overflow-y:auto">
        <h3>Visitors \u2014 ${escapeHtml(p ? p.name : '')}</h3>
        <div id="visitorsList">
          ${visitorsData === null ? `<p class="hint">Loading\u2026</p>` :
            visitorsData.visitors.length === 0 ? `<p class="hint">No sign-ins recorded for this property yet.</p>` :
            visitorsData.visitors.map(v => `
              <div class="note" style="margin-bottom:8px">
                <div class="when">${fmtWhen(v.created_at)}</div>
                <strong>${escapeHtml(v.name)}</strong> \u00b7 ${escapeHtml(v.phone)}
                <span class="chip ${statusMeta(v.status).cls}" style="margin-left:6px">${statusMeta(v.status).label}</span>
              </div>
            `).join('')}
        </div>
        <div class="modal-actions">
          <button class="btn secondary" id="visitorsClose" style="width:100%">Close</button>
        </div>
      </div>
    </div>
  `;
}

function attachVisitorsModalHandlers(){
  const overlay = document.getElementById('visitorsOverlay');
  overlay.onclick = e => { if (e.target === overlay) { state.visitorsForPropertyId = null; visitorsData = null; render(); } };
  document.getElementById('visitorsClose').onclick = () => { state.visitorsForPropertyId = null; visitorsData = null; render(); };

  if (visitorsData === null) {
    api(`/properties/${state.visitorsForPropertyId}/visitors`).then(data => {
      visitorsData = data;
      if (state.visitorsForPropertyId) render();
    }).catch(err => showToast(err.message));
  }
}

// ================= PROPERTY AGENT ASSIGNMENT (admin only) =================
let agentsData = null; // { assigned, available } once loaded

function renderAgentsModal(){
  const p = state.properties.find(x => x.id === state.agentsForPropertyId);
  return `
    <div class="overlay center" id="agentsOverlay">
      <div class="property-modal" style="max-width:480px;max-height:80vh;overflow-y:auto">
        <h3>Assign agents \u2014 ${escapeHtml(p ? p.name : '')}</h3>
        <p class="hint">Only assigned agents can see and use this property. Admins can always see every property.</p>
        <div id="agentsList">
          ${agentsData === null ? `<p class="hint">Loading\u2026</p>` : `
            <label style="margin-bottom:8px">Assigned</label>
            <div class="notes-list" style="margin-bottom:16px">
              ${agentsData.assigned.length === 0 ? `<div style="font-size:13px;color:var(--ink-light)">No agents assigned yet.</div>` :
                agentsData.assigned.map(a => `
                  <div class="note" style="display:flex;justify-content:space-between;align-items:center">
                    <span><strong>${escapeHtml(a.name)}</strong> \u00b7 ${escapeHtml(a.email)}</span>
                    <button class="danger-link" data-unassign="${a.id}">Remove</button>
                  </div>
                `).join('')}
            </div>
            <label style="margin-bottom:8px">Available</label>
            <div class="notes-list">
              ${agentsData.available.length === 0 ? `<div style="font-size:13px;color:var(--ink-light)">No other agent logins to assign. Add agents from the Manage Users tab first.</div>` :
                agentsData.available.map(a => `
                  <div class="note" style="display:flex;justify-content:space-between;align-items:center">
                    <span><strong>${escapeHtml(a.name)}</strong> \u00b7 ${escapeHtml(a.email)}</span>
                    <button class="btn secondary" data-assign="${a.id}" style="padding:5px 10px;font-size:12px">Assign</button>
                  </div>
                `).join('')}
            </div>
          `}
        </div>
        <div class="modal-actions">
          <button class="btn secondary" id="agentsClose" style="width:100%">Close</button>
        </div>
      </div>
    </div>
  `;
}

function attachAgentsModalHandlers(){
  const overlay = document.getElementById('agentsOverlay');
  const propId = state.agentsForPropertyId;
  overlay.onclick = e => { if (e.target === overlay) { state.agentsForPropertyId = null; agentsData = null; render(); } };
  document.getElementById('agentsClose').onclick = () => { state.agentsForPropertyId = null; agentsData = null; render(); };

  if (agentsData === null) {
    api(`/properties/${propId}/agents`).then(data => {
      agentsData = data;
      if (state.agentsForPropertyId) render();
    }).catch(err => showToast(err.message));
    return; // handlers below need agentsData to exist — next render() call will attach them
  }

  document.querySelectorAll('[data-assign]').forEach(b => {
    b.onclick = async () => {
      try {
        await api(`/properties/${propId}/agents`, { method:'POST', body:{ userId: Number(b.dataset.assign) } });
        agentsData = null;
        render();
      } catch (err) { showToast(err.message); }
    };
  });
  document.querySelectorAll('[data-unassign]').forEach(b => {
    b.onclick = async () => {
      try {
        await api(`/properties/${propId}/agents/${b.dataset.unassign}`, { method:'DELETE' });
        agentsData = null;
        render();
      } catch (err) { showToast(err.message); }
    };
  });
}

bootstrap();
