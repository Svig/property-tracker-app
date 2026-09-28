// ============================================================
// Super Admin console — a separate auth realm and a separate page from
// the tenant app (public/app.js). Deliberately not sharing state or
// localStorage keys with it, aside from the one handoff point:
// "Switch to tenant" writes a tenant-scoped token to 'vr_token' (the key
// app.js reads on load) and redirects to '/'.
// ============================================================

const TIERS = ['free', 'starter', 'pro'];

const state = {
  token: localStorage.getItem('vr_superadmin_token') || null,
  admin: null,
  tenants: [],
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

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch('/api/superadmin' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
  state.admin = null;
  localStorage.removeItem('vr_superadmin_token');
  render();
}

async function bootstrap(){
  if (!state.token) { state.loading = false; return render(); }
  try {
    const { admin } = await api('/auth/me');
    state.admin = admin;
    await loadTenants();
  } catch (e) {
    logout();
  }
  state.loading = false;
  render();
}

async function loadTenants(){
  const { tenants } = await api('/tenants');
  state.tenants = tenants;
}

function escapeHtml(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDate(iso){ return iso ? new Date(iso).toLocaleDateString('en-ZA', { day:'2-digit', month:'short', year:'numeric' }) : '\u2014'; }
function slugify(s){ return (s||'').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

// ---------------- render dispatcher ----------------
function render(){
  document.getElementById('tenantModalOverlay')?.remove();

  if (state.loading) { root.innerHTML = `<div class="loading">Opening the platform console\u2026</div>`; return; }
  if (!state.token || !state.admin) { root.innerHTML = renderLogin(); attachLoginHandlers(); return; }

  root.innerHTML = `
    <header class="sa">
      <div class="brand">
        <span class="mark">Super Admin</span>
        <span class="sub">Viewing Register \u2014 Platform Console</span>
      </div>
      <div class="who">
        <span>${escapeHtml(state.admin.name)}</span>
        <button id="logoutBtn">Log out</button>
      </div>
    </header>
    <main id="main"></main>
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ''}
  `;
  document.getElementById('logoutBtn').onclick = logout;
  document.getElementById('main').innerHTML = renderDashboard();
  attachDashboardHandlers();

  if (dashState.editingTenant || dashState.creatingTenant) {
    document.body.insertAdjacentHTML('beforeend', renderTenantModal());
    attachTenantModalHandlers();
  }
}

// ================= LOGIN =================
function renderLogin(){
  return `
    <div class="login-wrap">
      <div class="deed">
        <h2>Super Admin</h2>
        <p>Platform console \u2014 manages tenants, not tenant data.</p>
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
      const { token, admin } = await api('/auth/login', { method:'POST', body:{ email, password } });
      state.token = token; state.admin = admin; state.authError = null;
      localStorage.setItem('vr_superadmin_token', token);
      state.loading = true; render();
      await loadTenants();
      state.loading = false;
      render();
    } catch (err) {
      state.authError = err.message;
      render();
    }
  };
}

// ================= DASHBOARD =================
const dashState = { editingTenant: null, creatingTenant: false };

function renderDashboard(){
  return `
    <div class="toolbar">
      <div style="flex:1"></div>
      <button class="btn brass" id="newTenantBtn">+ New Tenant</button>
    </div>
    <div class="list-col">
      ${state.tenants.length === 0 ? `<div class="card empty"><div class="mark">No tenants yet</div><div>Create the first one to get started.</div></div>` :
        state.tenants.map(t => `
          <div class="card tenant-card">
            <div class="top">
              <div>
                <div class="t-name">${escapeHtml(t.name)} ${!t.is_active ? '<span class="chip lost" style="margin-left:6px">inactive</span>' : ''}</div>
                <div class="t-meta">/${escapeHtml(t.slug)} \u00b7 ${t.user_count} user${t.user_count==1?'':'s'} \u00b7 ${t.client_count} client${t.client_count==1?'':'s'} \u00b7 created ${fmtDate(t.created_at)}</div>
              </div>
              <span class="tier-badge">${escapeHtml(t.subscription_tier)}</span>
            </div>
            <div class="t-meta" style="margin-top:8px">
              ${t.primary_color ? `<span class="swatch" style="background:${escapeHtml(t.primary_color)}"></span>` : ''}
              ${t.brass_color ? `<span class="swatch" style="background:${escapeHtml(t.brass_color)}"></span>` : ''}
              ${t.app_name ? escapeHtml(t.app_name) : ''}
              ${t.allowed_email_domain ? ` \u00b7 restricted to @${escapeHtml(t.allowed_email_domain)}` : ''}
            </div>
            <div class="t-actions">
              <button class="btn brass" data-switch="${t.id}" style="padding:8px 14px;font-size:12.5px">Switch to Tenant</button>
              <button class="btn secondary" data-edit-tenant="${t.id}" style="padding:8px 14px;font-size:12.5px">Edit</button>
              <button class="danger-link" data-del-tenant="${t.id}">Delete</button>
            </div>
          </div>
        `).join('')}
    </div>
  `;
}

function attachDashboardHandlers(){
  document.getElementById('newTenantBtn').onclick = () => { dashState.creatingTenant = true; render(); };

  document.querySelectorAll('[data-edit-tenant]').forEach(b => {
    b.onclick = () => { dashState.editingTenant = state.tenants.find(t => t.id == b.dataset.editTenant); render(); };
  });

  document.querySelectorAll('[data-del-tenant]').forEach(b => {
    b.onclick = async () => {
      const t = state.tenants.find(x => x.id == b.dataset.delTenant);
      const typed = prompt(`This permanently deletes "${t.name}" and every user, client, and property in it. This cannot be undone.\n\nType the tenant's slug ("${t.slug}") to confirm:`);
      if (typed !== t.slug) { if (typed !== null) showToast('Slug didn\u2019t match \u2014 nothing was deleted.'); return; }
      try {
        await api(`/tenants/${t.id}`, { method:'DELETE' });
        state.tenants = state.tenants.filter(x => x.id !== t.id);
        render();
        showToast('Tenant deleted.');
      } catch (err) { showToast(err.message); }
    };
  });

  document.querySelectorAll('[data-switch]').forEach(b => {
    b.onclick = async () => {
      try {
        const { token, tenantName } = await api(`/tenants/${b.dataset.switch}/impersonate`, { method:'POST' });
        localStorage.setItem('vr_token', token);
        showToast(`Switching to ${tenantName}\u2026`);
        setTimeout(() => { window.location.href = '/'; }, 400);
      } catch (err) { showToast(err.message); }
    };
  });
}

// ================= CREATE / EDIT TENANT MODAL =================
let tenantForm = {};

function blankTenantForm(){
  return { name:'', slug:'', appName:'', primaryColor:'', brassColor:'', logoUrl:'', allowedEmailDomain:'', subscriptionTier:'free', adminName:'', adminEmail:'', adminPassword:'' };
}

function renderTenantModal(){
  const isEdit = !!dashState.editingTenant;
  if (isEdit && (!tenantForm.__forId || tenantForm.__forId !== dashState.editingTenant.id)) {
    const t = dashState.editingTenant;
    tenantForm = {
      __forId: t.id, name: t.name, slug: t.slug, appName: t.app_name || '', primaryColor: t.primary_color || '',
      brassColor: t.brass_color || '', logoUrl: t.logo_url || '', allowedEmailDomain: t.allowed_email_domain || '',
      subscriptionTier: t.subscription_tier || 'free', isActive: !!t.is_active,
    };
  } else if (!isEdit && !tenantForm.__blank) {
    tenantForm = { ...blankTenantForm(), __blank: true };
  }

  return `
    <div class="overlay center" id="tenantModalOverlay">
      <div class="property-modal" style="max-width:520px;max-height:88vh;overflow-y:auto">
        <h3>${isEdit ? 'Edit tenant' : 'New tenant'}</h3>
        <form id="tenantForm">
          <div class="grid2">
            <div class="field"><label>Tenant name</label>
              <input type="text" id="tf_name" value="${escapeHtml(tenantForm.name)}" placeholder="Acme Realty" required></div>
            <div class="field"><label>Slug</label>
              <input type="text" id="tf_slug" value="${escapeHtml(tenantForm.slug)}" placeholder="acme-realty" required></div>
          </div>
          <div class="field"><label>App display name (optional)</label>
            <input type="text" id="tf_appName" value="${escapeHtml(tenantForm.appName)}" placeholder="Defaults to tenant name"></div>
          <div class="grid2">
            <div class="field"><label>Primary color</label>
              <input type="text" id="tf_primaryColor" value="${escapeHtml(tenantForm.primaryColor)}" placeholder="#1C2B3A"></div>
            <div class="field"><label>Accent color</label>
              <input type="text" id="tf_brassColor" value="${escapeHtml(tenantForm.brassColor)}" placeholder="#AD8A4E"></div>
          </div>
          <div class="field"><label>Logo URL (optional)</label>
            <input type="text" id="tf_logoUrl" value="${escapeHtml(tenantForm.logoUrl)}" placeholder="https://..."></div>
          <div class="field"><label>Restrict new users to email domain (optional, not yet enforced)</label>
            <input type="text" id="tf_allowedEmailDomain" value="${escapeHtml(tenantForm.allowedEmailDomain)}" placeholder="acmerealty.co.za"></div>
          <div class="field"><label>Subscription tier</label>
            <select id="tf_subscriptionTier">
              ${TIERS.map(t => `<option value="${t}" ${tenantForm.subscriptionTier===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>

          ${isEdit ? `
          <div class="field">
            <label>Status</label>
            <div class="radio-row">
              <label class="opt ${tenantForm.isActive?'selected':''}" data-active-opt="true">Active</label>
              <label class="opt ${!tenantForm.isActive?'selected':''}" data-active-opt="false">Inactive</label>
            </div>
          </div>
          ` : `
          <div class="card" style="padding:16px;margin:18px 0;background:var(--paper)">
            <label style="margin-bottom:10px">First admin for this tenant</label>
            <div class="field"><label>Name</label><input type="text" id="tf_adminName" required></div>
            <div class="field"><label>Email</label><input type="email" id="tf_adminEmail" required></div>
            <div class="field" style="margin-bottom:0"><label>Temporary password</label><input type="password" id="tf_adminPassword" minlength="8" required></div>
          </div>
          `}

          <div class="modal-actions">
            <button type="button" class="btn secondary" id="tenantModalCancel">Cancel</button>
            <button type="submit" class="btn brass">${isEdit ? 'Save changes' : 'Create tenant'}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function attachTenantModalHandlers(){
  const overlay = document.getElementById('tenantModalOverlay');
  const close = () => { dashState.editingTenant = null; dashState.creatingTenant = false; tenantForm = {}; render(); };
  overlay.onclick = e => { if (e.target === overlay) close(); };
  document.getElementById('tenantModalCancel').onclick = close;

  const bind = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.oninput = e => { tenantForm[key] = e.target.value; };
  };
  bind('tf_name','name'); bind('tf_slug','slug'); bind('tf_appName','appName');
  bind('tf_primaryColor','primaryColor'); bind('tf_brassColor','brassColor'); bind('tf_logoUrl','logoUrl');
  bind('tf_allowedEmailDomain','allowedEmailDomain');
  bind('tf_adminName','adminName'); bind('tf_adminEmail','adminEmail'); bind('tf_adminPassword','adminPassword');

  const nameEl = document.getElementById('tf_name');
  const slugEl = document.getElementById('tf_slug');
  if (nameEl && !dashState.editingTenant) {
    nameEl.oninput = e => { tenantForm.name = e.target.value; if (!tenantForm.__slugTouched) { tenantForm.slug = slugify(e.target.value); slugEl.value = tenantForm.slug; } };
    slugEl.oninput = e => { tenantForm.slug = e.target.value; tenantForm.__slugTouched = true; };
  }

  const tierEl = document.getElementById('tf_subscriptionTier');
  if (tierEl) tierEl.onchange = e => { tenantForm.subscriptionTier = e.target.value; };

  document.querySelectorAll('[data-active-opt]').forEach(el => {
    el.onclick = () => { tenantForm.isActive = el.dataset.activeOpt === 'true'; render(); };
  });

  document.getElementById('tenantForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      if (dashState.editingTenant) {
        const { tenant } = await api(`/tenants/${dashState.editingTenant.id}`, { method:'PATCH', body: tenantForm });
        state.tenants = state.tenants.map(t => t.id === tenant.id ? tenant : t);
        showToast('Tenant updated.');
      } else {
        const { tenant } = await api('/tenants', { method:'POST', body: tenantForm });
        state.tenants.push(tenant);
        showToast('Tenant created.');
      }
      close();
    } catch (err) { showToast(err.message); }
  };
}

bootstrap();
