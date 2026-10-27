// ============================================================
// Learning Centre UI. Loaded BEFORE app.js (see index.html) and shares its
// globals — state, api, render, escapeHtml, showToast — which are only used
// when these functions run, never while this file loads.
//
// Layout:  My learning | Catalogue | Manage (admins)   and, on top of any of
// them, a course page (video player + lesson checklist).
//
// One rule shapes the code: a re-render must never restart a playing video.
// So the course page is built once, and everything that changes while you
// watch (ticking a lesson, enrolling, picking another lesson) updates only the
// panels around the player — never the player itself.
//
// The server (routes/learning.routes.js) decides what each person may open and
// never sends the video link of a locked lesson; this file only displays what
// it is given. Every dynamic value goes through escapeHtml().
// ============================================================

const LC_DEFAULT_NAME = 'Learning Centre';
let learnEpoch = 0; // bumped on logout so a slow response can't land in the next person's session

function learnInitial() {
  return {
    tab: 'my',                 // my | catalogue | manage
    loaded: false, loading: false, error: null,
    courses: [],               // the catalogue, as this person sees it
    my: null,                  // { stats, courses } for "My learning"
    myStale: false,            // true after progress changes; refreshed when My learning is shown
    refreshing: false,
    courseId: null,            // set = the course page is showing
    detail: null,              // { course, lessons }
    detailError: null,
    lessonId: null,
    q: '', filter: 'all', category: '',
    modal: null,               // { type: 'course' | 'lesson', data } while a form is open
    nameDraft: null,
  };
}
const learn = learnInitial();

// Called on logout (shared devices): forget everything about the previous person.
function resetLearning() {
  learnEpoch++;
  Object.assign(learn, learnInitial());
}

const lcIsAdmin = () => state.user && state.user.role === 'admin';
const lcName = () => state.learningName || LC_DEFAULT_NAME;
const lcPlural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Re-render the page, unless a form is open (that would wipe what's being typed).
const lcRerender = () => { if (state.view === 'learning' && !learn.modal) render(); };

// ---------------- small formatters ----------------
function lcDuration(sec) {
  const s = Number(sec) || 0;
  if (s <= 0) return '';
  const m = Math.round(s / 60);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
function lcLevelLabel(level) { return level === 'admin' ? 'Admins only' : level === 'agent' ? 'Agents & admins' : ''; }
const LC_PROVIDERS = { youtube: 'YouTube', vimeo: 'Vimeo', loom: 'Loom', gdrive: 'Google Drive', file: 'Video file', link: 'External link' };

function lcCover(course, extra = '') {
  const letters = (course.title || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return `<div class="lc-cover cv${course.id % 4} ${extra}"><span class="lc-initials">${escapeHtml(letters)}</span>${course.coverUrl ? `<img src="${escapeHtml(course.coverUrl)}" alt="" loading="lazy" data-cover>` : ''}</div>`;
}
// A broken cover link just removes the <img>, revealing the coloured placeholder underneath.
function lcAttachCovers(scope) {
  scope.querySelectorAll('img[data-cover]').forEach(img => {
    const drop = () => img.remove();
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) drop();
    else img.addEventListener('error', drop, { once: true });
  });
}
const lcBar = pct => `<div class="lc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>`;

// ---------------- loading ----------------
async function loadLearning() {
  const epoch = learnEpoch;
  learn.loading = true; learn.error = null;
  try {
    const [c, m] = await Promise.all([api('/learning/courses'), api('/learning/my')]);
    if (epoch !== learnEpoch) return;
    learn.courses = c.courses; learn.my = m; learn.myStale = false; learn.loaded = true;
  } catch (err) {
    if (epoch !== learnEpoch) return;
    learn.error = err.message;
  }
  learn.loading = false;
  lcRerender();
}

async function refreshMy() {
  if (learn.refreshing) return;
  const epoch = learnEpoch;
  learn.refreshing = true;
  try {
    const m = await api('/learning/my');
    if (epoch !== learnEpoch) return;
    learn.my = m; learn.myStale = false;
    learn.refreshing = false;
    if (!learn.courseId && learn.tab === 'my') lcRerender();
  } catch (err) { /* keep the old numbers; the next visit tries again */ }
  if (epoch === learnEpoch) learn.refreshing = false;
}

async function openCourse(id, wantedLessonId) {
  const epoch = learnEpoch;
  learn.courseId = id; learn.detail = null; learn.detailError = null; learn.lessonId = null;
  lcRerender();
  try {
    const d = await api(`/learning/courses/${id}`);
    if (epoch !== learnEpoch || learn.courseId !== id) return;
    learn.detail = d;
    lcCarryCounts(d.course);
    const open = d.lessons.filter(l => !l.locked);
    const wanted = wantedLessonId && open.find(l => l.id === wantedLessonId);
    const next = d.course.nextLessonId && open.find(l => l.id === d.course.nextLessonId);
    learn.lessonId = (wanted || next || open[0] || d.lessons[0] || {}).id || null;
  } catch (err) {
    if (epoch !== learnEpoch) return;
    learn.detailError = err.message;
  }
  lcRerender();
}

function closeCourse() {
  learn.courseId = null; learn.detail = null; learn.lessonId = null;
  lcRerender();   // My learning refreshes itself if progress changed while the course was open
}

// Pull a fresh copy of the open course (after an admin edit) without losing the lesson being watched.
async function reloadDetail() {
  const epoch = learnEpoch, id = learn.courseId;
  if (!id) return;
  try {
    const d = await api(`/learning/courses/${id}`);
    if (epoch !== learnEpoch || learn.courseId !== id) return;
    const keep = learn.lessonId;
    learn.detail = d;
    lcCarryCounts(d.course);
    learn.lessonId = d.lessons.some(l => l.id === keep) ? keep : ((d.lessons.find(l => !l.locked) || d.lessons[0] || {}).id || null);
    lcRerender();
  } catch (err) { showToast(err.message); }
}

// The single-course endpoint has no admin enrolment counts; borrow them from the catalogue entry.
function lcCarryCounts(course) {
  const listed = learn.courses.find(x => x.id === course.id);
  if (listed && listed.enrolledCount !== undefined) { course.enrolledCount = listed.enrolledCount; course.completedEnrollments = listed.completedEnrollments; }
}

// Merge a returned course summary into the catalogue + the open course page.
function lcApplyCourse(summary) {
  const i = learn.courses.findIndex(c => c.id === summary.id);
  if (i >= 0) learn.courses[i] = { ...learn.courses[i], ...summary };
  if (learn.detail && learn.detail.course.id === summary.id) learn.detail.course = { ...learn.detail.course, ...summary };
  learn.myStale = true;
}

// ---------------- learner actions ----------------
async function lcToggleComplete(lessonId) {
  const l = learn.detail.lessons.find(x => x.id === lessonId);
  if (!l || l.locked) return;
  try {
    const { course } = await api(`/learning/lessons/${lessonId}/complete`, { method: l.completed ? 'DELETE' : 'POST' });
    l.completed = !l.completed;
    lcApplyCourse(course);
    lcRefreshCoursePanels();
    if (course.completed && l.completed) showToast(`Course complete – well done!`);
    else if (l.completed) showToast(`Lesson done · ${lcPlural(course.lessonCount - course.completedCount, 'lesson')} to go`);
  } catch (err) { showToast(err.message); }
}

async function lcEnroll(courseId) {
  try {
    const { course } = await api(`/learning/courses/${courseId}/enroll`, { method: 'POST' });
    lcApplyCourse(course); lcRefreshCoursePanels();
    showToast('Enrolled – your progress is now tracked');
  } catch (err) { showToast(err.message); }
}

async function lcLeave(courseId) {
  if (!confirm('Leave this course? Your completed lessons are kept if you rejoin later.')) return;
  try {
    const { course } = await api(`/learning/courses/${courseId}/enroll`, { method: 'DELETE' });
    lcApplyCourse(course); lcRefreshCoursePanels();
    showToast('You have left the course');
  } catch (err) { showToast(err.message); }
}

function lcSelectLesson(id) {
  const l = learn.detail && learn.detail.lessons.find(x => x.id === id);
  if (!l) return;
  learn.lessonId = id;
  const player = document.getElementById('lcPlayer');
  if (player) player.innerHTML = lcPlayerInner();   // the only place the video is (re)built
  lcRefreshCoursePanels();
  if (player && player.scrollIntoView) player.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function lcAdjacent(dir) {
  const open = learn.detail.lessons.filter(l => !l.locked);
  const i = open.findIndex(l => l.id === learn.lessonId);
  return open[i + dir] || null;
}

// ---------------- admin actions ----------------
async function lcSaveName() {
  const name = (learn.nameDraft !== null ? learn.nameDraft : lcName()).trim();
  try {
    const r = await api('/learning/config', { method: 'PUT', body: { name } });
    state.learningName = r.name; learn.nameDraft = null;
    showToast(name ? 'Name saved' : 'Name reset to the default');
    render();
  } catch (err) { showToast(err.message); }
}

async function lcSetStatus(courseId, status) {
  try {
    const { course } = await api(`/learning/courses/${courseId}`, { method: 'PATCH', body: { status } });
    lcApplyCourse(course);
    showToast(status === 'published' ? 'Published – learners can now see it' : status === 'archived' ? 'Archived' : 'Moved back to draft');
    lcRerender(); if (learn.courseId) lcRefreshCoursePanels();
  } catch (err) { showToast(err.message); }
}

async function lcDeleteCourse(courseId) {
  const c = learn.courses.find(x => x.id === courseId) || (learn.detail && learn.detail.course);
  if (!confirm(`Delete "${c ? c.title : 'this course'}"?\n\nThis also removes its lessons and everyone's progress. It cannot be undone.`)) return;
  try {
    await api(`/learning/courses/${courseId}`, { method: 'DELETE' });
    learn.courseId = null; learn.detail = null; showToast('Course deleted');
    await loadLearning();
  } catch (err) { showToast(err.message); }
}

async function lcDeleteLesson(lessonId) {
  const l = learn.detail.lessons.find(x => x.id === lessonId);
  if (!confirm(`Delete the lesson "${l ? l.title : ''}"?\n\nEveryone's progress on it is removed.`)) return;
  try {
    await api(`/learning/lessons/${lessonId}`, { method: 'DELETE' });
    showToast('Lesson deleted');
    await reloadDetail(); loadLearning();
  } catch (err) { showToast(err.message); }
}

async function lcMoveLesson(lessonId, dir) {
  const ids = learn.detail.lessons.map(l => l.id);
  const i = ids.indexOf(lessonId), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  try {
    await api(`/learning/courses/${learn.courseId}/lessons/reorder`, { method: 'POST', body: { order: ids } });
    const byId = new Map(learn.detail.lessons.map(l => [l.id, l]));
    learn.detail.lessons = ids.map(id => byId.get(id));
    lcRefreshCoursePanels();
  } catch (err) { showToast(err.message); }
}

// ============================================================
// Rendering
// ============================================================
function renderLearning() {
  if (!learn.loaded && !learn.loading && !learn.error) loadLearning();   // first visit
  if (learn.tab === 'my' && learn.myStale && !learn.courseId && !learn.loading) refreshMy();

  const tabs = [['my', 'My learning'], ['catalogue', 'Catalogue']].concat(lcIsAdmin() ? [['manage', 'Manage']] : []);
  let body;
  if (learn.courseId) body = lcCoursePage();
  else if (learn.error) body = `<div class="card empty"><div class="mark">Couldn't load ${escapeHtml(lcName())}</div><div>${escapeHtml(learn.error)}</div><p><button class="btn secondary" data-act="retry">Try again</button></p></div>`;
  else if (!learn.loaded) body = `<div class="loading">Loading…</div>`;
  else body = learn.tab === 'catalogue' ? lcCatalogue() : learn.tab === 'manage' && lcIsAdmin() ? lcManage() : lcMyLearning();

  return `
    <div class="learn" id="learnRoot">
      <div class="learn-head">
        <h2>${escapeHtml(lcName())}</h2>
        ${learn.courseId ? '' : `<div class="learn-tabs">${tabs.map(([k, label]) => `<button data-act="tab" data-tab="${k}" class="${learn.tab === k ? 'active' : ''}">${label}</button>`).join('')}</div>`}
      </div>
      ${body}
    </div>`;
}

// ---------------- My learning ----------------
function lcMyLearning() {
  const my = learn.my || { stats: {}, courses: [] };
  const s = my.stats;
  const live = my.courses.filter(c => !c.locked);
  const inProgress = live.filter(c => !c.completed);
  const done = live.filter(c => c.completed);
  const locked = my.courses.filter(c => c.locked);

  if (my.courses.length === 0) {
    return `<div class="card empty"><div class="mark">Nothing started yet</div><div>Pick a course from the catalogue to begin. Your progress will show up here.</div><p><button class="btn brass" data-act="tab" data-tab="catalogue">Browse the catalogue</button></p></div>`;
  }

  const stat = (n, label) => `<div class="card stat"><div class="num">${n || 0}</div><div class="lbl">${label}</div></div>`;
  const continueCards = inProgress.map(c => `
    <div class="card lc-continue" data-act="open-course" data-id="${c.id}" tabindex="0" role="button">
      ${lcCover(c, 'sm')}
      <div class="lc-continue-body">
        <div class="lc-title">${escapeHtml(c.title)}</div>
        ${lcBar(c.progressPct)}
        <div class="lc-meta">${c.completedCount} of ${lcPlural(c.lessonCount, 'lesson')} · ${c.progressPct}%</div>
        ${c.nextLessonTitle ? `<div class="lc-next">Up next: <strong>${escapeHtml(c.nextLessonTitle)}</strong></div>` : ''}
      </div>
      <button class="btn brass small" data-act="open-course" data-id="${c.id}" data-lesson="${c.nextLessonId || ''}">${c.completedCount ? 'Continue' : 'Start'}</button>
    </div>`).join('');

  const todo = inProgress.map(c => ({ c, items: c.lessons.filter(l => !l.completed) })).filter(x => x.items.length);
  const todoHtml = todo.map(({ c, items }) => `
    <div class="lc-group">
      <div class="lc-group-title">${escapeHtml(c.title)}</div>
      ${items.slice(0, 5).map(l => `<button class="lc-row" data-act="open-course" data-id="${c.id}" data-lesson="${l.id}"><span class="lc-dot"></span><span class="lc-row-title">${escapeHtml(l.title)}</span><span class="lc-row-meta">${lcDuration(l.durationSeconds)}</span></button>`).join('')}
      ${items.length > 5 ? `<button class="lc-more" data-act="open-course" data-id="${c.id}">+ ${items.length - 5} more in this course</button>` : ''}
    </div>`).join('');

  const doneLessons = live.map(c => ({ c, items: c.lessons.filter(l => l.completed) })).filter(x => x.items.length);
  const doneHtml = doneLessons.map(({ c, items }) => `
    <div class="lc-group">
      <div class="lc-group-title">${escapeHtml(c.title)}${c.completed ? ' <span class="chip won">Course complete</span>' : ''}</div>
      ${items.map(l => `<button class="lc-row done" data-act="open-course" data-id="${c.id}" data-lesson="${l.id}"><span class="lc-check">✓</span><span class="lc-row-title">${escapeHtml(l.title)}</span><span class="lc-row-meta">${lcDuration(l.durationSeconds)}</span></button>`).join('')}
    </div>`).join('');

  return `
    <div class="stats">
      ${stat(s.enrolled, 'Enrolled courses')}${stat(s.inProgress, 'In progress')}${stat(s.completed, 'Completed')}${stat(s.lessonsToDo, 'Lessons to go')}
    </div>
    ${inProgress.length ? `<h3 class="lc-h">Continue learning</h3><div class="lc-continue-list">${continueCards}</div>` : ''}
    ${todo.length ? `<h3 class="lc-h">To do <span class="lc-count">${s.lessonsToDo}</span></h3><div class="card lc-panel">${todoHtml}</div>` : ''}
    ${done.length ? `<h3 class="lc-h">Completed courses <span class="lc-count">${done.length}</span></h3><div class="lc-grid">${done.map(lcCourseCard).join('')}</div>` : ''}
    ${doneLessons.length ? `<details class="card lc-panel lc-details"><summary>Completed lessons <span class="lc-count">${s.lessonsDone}</span></summary>${doneHtml}</details>` : ''}
    ${locked.length ? `<h3 class="lc-h">No longer available to you</h3><div class="card lc-panel lc-muted">${locked.map(c => `<div class="lc-row static"><span class="lc-row-title">${escapeHtml(c.title)}</span><span class="lc-row-meta">Now ${escapeHtml(lcLevelLabel(c.accessLevel).toLowerCase())}</span></div>`).join('')}<div class="lc-note">Your progress is kept if your access returns.</div></div>` : ''}`;
}

// ---------------- Catalogue ----------------
function lcCourseCard(c) {
  const chips = [
    c.category ? `<span class="chip lc-cat">${escapeHtml(c.category)}</span>` : '',
    c.accessLevel !== 'everyone' ? `<span class="chip lc-level">${escapeHtml(lcLevelLabel(c.accessLevel))}</span>` : '',
    lcIsAdmin() && c.status !== 'published' ? `<span class="chip lc-${c.status}">${c.status}</span>` : '',
  ].join('');
  let foot;
  if (c.locked) foot = `<div class="lc-lockline">🔒 ${escapeHtml(lcLevelLabel(c.accessLevel))}</div>`;
  else if (c.completed) foot = `<div class="lc-doneline">✓ Completed</div>`;
  else if (c.enrolled) foot = `${lcBar(c.progressPct)}<div class="lc-meta">${c.completedCount} of ${lcPlural(c.lessonCount, 'lesson')} · ${c.progressPct}%</div>`;
  else foot = `<div class="lc-meta">Not started</div>`;
  const dur = lcDuration(c.durationSeconds);
  return `
    <div class="card lc-card ${c.locked ? 'locked' : ''}" data-act="open-course" data-id="${c.id}" tabindex="0" role="button">
      ${lcCover(c)}
      <div class="lc-card-body">
        <div class="lc-chips">${chips}</div>
        <div class="lc-title">${escapeHtml(c.title)}</div>
        ${c.description ? `<div class="lc-desc">${escapeHtml(c.description)}</div>` : ''}
        <div class="lc-meta">${lcPlural(c.locked ? c.totalLessons : c.lessonCount, 'lesson')}${dur ? ' · ' + dur : ''}</div>
      </div>
      <div class="lc-card-foot">${foot}</div>
    </div>`;
}

function lcFilteredCourses() {
  const q = learn.q.trim().toLowerCase();
  return learn.courses.filter(c => {
    if (learn.category && c.category !== learn.category) return false;
    if (learn.filter === 'enrolled' && !(c.enrolled && !c.completed)) return false;
    if (learn.filter === 'new' && (c.enrolled || c.locked)) return false;
    if (learn.filter === 'completed' && !c.completed) return false;
    if (learn.filter === 'locked' && !c.locked) return false;
    return !q || [c.title, c.description, c.category].some(t => (t || '').toLowerCase().includes(q));
  });
}
function lcGridInner() {
  const list = lcFilteredCourses();
  if (learn.courses.length === 0) return `<div class="card empty" style="grid-column:1/-1"><div class="mark">No courses yet</div><div>${lcIsAdmin() ? 'Create the first one from the Manage tab.' : 'Courses your agency publishes will appear here.'}</div></div>`;
  if (list.length === 0) return `<div class="card empty" style="grid-column:1/-1"><div class="mark">No courses match</div><div>Try a different search or filter.</div></div>`;
  return list.map(lcCourseCard).join('');
}
function lcCatalogue() {
  const cats = [...new Set(learn.courses.map(c => c.category).filter(Boolean))].sort();
  const opt = (v, label, cur) => `<option value="${escapeHtml(v)}" ${cur === v ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  return `
    <div class="toolbar">
      <input type="text" id="lcSearch" placeholder="Search courses…" value="${escapeHtml(learn.q)}">
      <select id="lcFilter" aria-label="Filter">
        ${opt('all', 'All courses', learn.filter)}${opt('enrolled', 'In progress', learn.filter)}${opt('new', 'Not started', learn.filter)}${opt('completed', 'Completed', learn.filter)}${opt('locked', 'Locked', learn.filter)}
      </select>
      ${cats.length ? `<select id="lcCategory" aria-label="Category">${opt('', 'All categories', learn.category)}${cats.map(c => opt(c, c, learn.category)).join('')}</select>` : ''}
    </div>
    <div class="lc-grid" id="lcGrid">${lcGridInner()}</div>`;
}

// ---------------- Manage (admin) ----------------
function lcManage() {
  const draft = learn.nameDraft !== null ? learn.nameDraft : lcName();
  const rows = learn.courses.map(c => `
    <div class="lc-manage-row">
      <div class="lc-manage-main">
        <div class="lc-title">${escapeHtml(c.title)} <span class="chip lc-${c.status}">${c.status}</span>${c.accessLevel !== 'everyone' ? ` <span class="chip lc-level">${escapeHtml(lcLevelLabel(c.accessLevel))}</span>` : ''}</div>
        <div class="lc-meta">${lcPlural(c.totalLessons, 'lesson')} · ${c.enrolledCount || 0} enrolled · ${c.completedEnrollments || 0} completed</div>
      </div>
      <div class="lc-manage-actions">
        <button class="btn secondary small" data-act="open-course" data-id="${c.id}">Open</button>
        <button class="btn secondary small" data-act="edit-course" data-id="${c.id}">Edit</button>
        ${c.status === 'published'
          ? `<button class="btn secondary small" data-act="set-status" data-id="${c.id}" data-status="draft">Unpublish</button>`
          : `<button class="btn brass small" data-act="set-status" data-id="${c.id}" data-status="published">Publish</button>`}
      </div>
    </div>`).join('');
  return `
    <div class="card lc-panel">
      <div class="lc-group-title">Section name</div>
      <p class="hint">What your agency calls this area. It appears in the menu for everyone. Leave it blank to use “${LC_DEFAULT_NAME}”.</p>
      <div class="lc-name-row"><input type="text" id="lcName" maxlength="60" value="${escapeHtml(draft)}" placeholder="${LC_DEFAULT_NAME}"><button class="btn brass" data-act="save-name">Save name</button></div>
    </div>
    <div class="lc-manage-head"><h3 class="lc-h" style="margin:0">Courses</h3><button class="btn brass" data-act="new-course">+ New course</button></div>
    <div class="card lc-panel">${rows || '<div class="lc-note">No courses yet — create your first one.</div>'}</div>`;
}

// ---------------- Course page ----------------
function lcCoursePage() {
  if (learn.detailError) return `<button class="lc-back" data-act="back">← Back</button><div class="card empty"><div class="mark">Couldn't open this course</div><div>${escapeHtml(learn.detailError)}</div></div>`;
  if (!learn.detail) return `<button class="lc-back" data-act="back">← Back</button><div class="loading">Loading course…</div>`;
  return `
    <button class="lc-back" data-act="back">← Back to ${learn.tab === 'catalogue' ? 'the catalogue' : learn.tab === 'manage' ? 'Manage' : 'My learning'}</button>
    <div class="card lc-hero" id="lcHero">${lcHeroInner()}</div>
    <div class="lc-body">
      <div class="lc-main">
        <div id="lcPlayer">${lcPlayerInner()}</div>
        <div class="card lc-lesson" id="lcLesson">${lcLessonInner()}</div>
      </div>
      <aside class="card lc-list" id="lcList">${lcListInner()}</aside>
    </div>`;
}

function lcHeroInner() {
  const { course: c } = learn.detail;
  const dur = lcDuration(c.durationSeconds);
  const admin = lcIsAdmin();
  let progress = '', action = '';
  if (c.locked) {
    action = `<div class="lc-lockline">🔒 ${escapeHtml(lcLevelLabel(c.accessLevel))}</div>`;
  } else if (c.enrolled) {
    progress = `${lcBar(c.progressPct)}<div class="lc-meta">${c.completed ? '✓ Course complete' : `${c.completedCount} of ${lcPlural(c.lessonCount, 'lesson')} done · ${c.progressPct}%`}</div>`;
    action = `<button class="link-btn" data-act="leave" data-id="${c.id}">Leave course</button>`;
  } else {
    progress = `<div class="lc-meta">Enrol to track your progress.</div>`;
    action = `<button class="btn brass" data-act="enroll" data-id="${c.id}">Enrol</button>`;
  }
  return `
    ${lcCover(c, 'md')}
    <div class="lc-hero-main">
      <div class="lc-chips">
        ${c.category ? `<span class="chip lc-cat">${escapeHtml(c.category)}</span>` : ''}
        ${c.accessLevel !== 'everyone' ? `<span class="chip lc-level">${escapeHtml(lcLevelLabel(c.accessLevel))}</span>` : ''}
        ${admin && c.status !== 'published' ? `<span class="chip lc-${c.status}">${c.status}</span>` : ''}
      </div>
      <h3 class="lc-hero-title">${escapeHtml(c.title)}</h3>
      ${c.description ? `<p class="lc-hero-desc">${escapeHtml(c.description)}</p>` : ''}
      <div class="lc-meta">${lcPlural(c.locked ? c.totalLessons : c.lessonCount, 'lesson')}${dur ? ' · ' + dur : ''}${admin && c.enrolledCount !== undefined ? ` · ${c.enrolledCount} enrolled, ${c.completedEnrollments} completed` : ''}</div>
    </div>
    <div class="lc-hero-side">
      ${progress}${action}
      ${admin ? `<div class="lc-admin-actions">
        <button class="btn secondary small" data-act="edit-course" data-id="${c.id}">Edit course</button>
        ${c.status === 'published' ? `<button class="btn secondary small" data-act="set-status" data-id="${c.id}" data-status="draft">Unpublish</button>` : `<button class="btn brass small" data-act="set-status" data-id="${c.id}" data-status="published">Publish</button>`}
        <button class="danger-link" data-act="delete-course" data-id="${c.id}">Delete</button>
      </div>` : ''}
    </div>`;
}

function lcCurrentLesson() {
  return learn.detail && learn.detail.lessons.find(l => l.id === learn.lessonId) || null;
}

function lcPlayerInner() {
  const { course } = learn.detail;
  const l = lcCurrentLesson();
  if (course.locked || (l && l.locked)) {
    const level = course.locked ? course.accessLevel : l.requiredLevel;
    return `<div class="lc-player lc-locked"><div><div class="lc-lock-icon">🔒</div><div>${escapeHtml(lcLevelLabel(level) || 'Restricted')}</div><div class="lc-meta" style="color:inherit;opacity:.8">This content isn't available at your access level.</div></div></div>`;
  }
  if (!l) return `<div class="lc-player lc-locked"><div>${lcIsAdmin() ? 'Add a lesson to get started.' : 'No lessons have been added yet.'}</div></div>`;
  const v = l.video;
  if (!v) return `<div class="lc-player lc-locked"><div>No video for this lesson yet.${lcIsAdmin() ? '<div class="lc-meta" style="color:inherit;opacity:.8">Edit the lesson to add a link.</div>' : ''}</div></div>`;
  if (v.kind === 'embed') return `<div class="lc-player"><iframe src="${escapeHtml(v.embedUrl)}" title="${escapeHtml(l.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe></div>`;
  if (v.kind === 'file') return `<div class="lc-player"><video controls preload="metadata" playsinline src="${escapeHtml(v.url)}"></video></div>`;
  return `<div class="lc-player lc-locked"><div><div>This video opens on another site.</div><p><a class="btn brass" href="${escapeHtml(v.url)}" target="_blank" rel="noopener noreferrer">Open video ↗</a></p></div></div>`;
}

function lcLessonInner() {
  const { course } = learn.detail;
  const l = lcCurrentLesson();
  if (!l) return `<div class="lc-meta">Nothing to show yet.</div>`;
  const prev = lcAdjacent(-1), next = lcAdjacent(1);
  const dur = lcDuration(l.durationSeconds);
  const canTick = !course.locked && !l.locked;
  return `
    <div class="lc-lesson-head">
      <div><div class="lc-lesson-title">${escapeHtml(l.title)}</div><div class="lc-meta">${[dur, l.requiredLevel !== 'everyone' ? lcLevelLabel(l.requiredLevel) : ''].filter(Boolean).join(' · ')}</div></div>
      ${canTick ? `<button class="btn ${l.completed ? 'secondary' : 'brass'}" data-act="toggle-complete" data-id="${l.id}">${l.completed ? '✓ Completed – undo' : 'Mark as complete'}</button>` : ''}
    </div>
    ${l.description ? `<p class="lc-lesson-desc">${escapeHtml(l.description)}</p>` : ''}
    <div class="lc-lesson-nav">
      <button class="btn secondary small" data-act="prev-lesson" ${prev ? '' : 'disabled'}>← Previous</button>
      <button class="btn ${l.completed ? 'brass' : 'secondary'} small" data-act="next-lesson" ${next ? '' : 'disabled'}>Next lesson →</button>
    </div>`;
}

function lcListInner() {
  const { course, lessons } = learn.detail;
  const admin = lcIsAdmin();
  const done = lessons.filter(l => l.completed).length;
  const items = lessons.map((l, i) => {
    const icon = l.locked ? '🔒' : l.completed ? '✓' : String(i + 1);
    const cls = ['lc-li', l.id === learn.lessonId ? 'current' : '', l.completed ? 'done' : '', l.locked ? 'locked' : ''].filter(Boolean).join(' ');
    const provider = admin ? ` · ${l.video ? LC_PROVIDERS[l.video.provider] || 'Link' : (l.videoUrl ? 'Link' : 'No video')}` : '';
    return `
      <div class="${cls}">
        <button class="lc-li-main" data-act="select-lesson" data-id="${l.id}">
          <span class="lc-li-icon">${icon}</span>
          <span class="lc-li-text"><span class="lc-li-title">${escapeHtml(l.title)}</span><span class="lc-li-meta">${[lcDuration(l.durationSeconds), l.locked ? lcLevelLabel(l.requiredLevel) : ''].filter(Boolean).join(' · ')}${escapeHtml(provider)}</span></span>
        </button>
        ${admin ? `<span class="lc-li-admin">
          <button class="lc-mini" title="Move up" data-act="move-lesson" data-id="${l.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="lc-mini" title="Move down" data-act="move-lesson" data-id="${l.id}" data-dir="1" ${i === lessons.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="lc-mini" data-act="edit-lesson" data-id="${l.id}">Edit</button>
          <button class="lc-mini danger" data-act="delete-lesson" data-id="${l.id}">×</button>
        </span>` : ''}
      </div>`;
  }).join('');
  return `
    <div class="lc-list-head"><span>Lessons</span><span class="lc-meta">${course.locked ? lcPlural(lessons.length, 'lesson') : `${done} of ${lessons.length} done`}</span></div>
    <div class="lc-li-wrap">${items || '<div class="lc-note">No lessons yet.</div>'}</div>
    ${admin ? `<div class="lc-list-foot"><button class="btn secondary small" data-act="new-lesson">+ Add lesson</button></div>` : ''}`;
}

// Re-draw everything on the course page EXCEPT the video player.
function lcRefreshCoursePanels() {
  if (!learn.detail) return;
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set('lcHero', lcHeroInner());
  set('lcLesson', lcLessonInner());
  set('lcList', lcListInner());
  const root = document.getElementById('learnRoot');
  if (root) lcAttachCovers(root);
}

// ============================================================
// Forms (admin)
// ============================================================
function lcOpenCourseForm(id) {
  const c = id ? (learn.courses.find(x => x.id === id) || (learn.detail && learn.detail.course)) : null;
  learn.modal = { type: 'course', data: c ? { id: c.id, title: c.title, description: c.description, category: c.category, coverUrl: c.coverUrl, accessLevel: c.accessLevel, status: c.status } : { title: '', description: '', category: '', coverUrl: '', accessLevel: 'everyone', status: 'draft' } };
  render();
}
function lcOpenLessonForm(id) {
  const l = id ? learn.detail.lessons.find(x => x.id === id) : null;
  learn.modal = { type: 'lesson', data: l
    ? { id: l.id, title: l.title, description: l.description, videoUrl: l.videoUrl || '', durationMinutes: l.durationSeconds ? Math.round(l.durationSeconds / 6) / 10 : '', accessLevel: l.ownAccessLevel || '' }
    : { title: '', description: '', videoUrl: '', durationMinutes: '', accessLevel: '' } };
  render();
}

function renderLearningModal() {
  const m = learn.modal; if (!m) return '';
  const d = m.data, isNew = !d.id;
  const sel = (id, value, options) => `<select id="${id}">${options.map(([v, label]) => `<option value="${v}" ${value === v ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  const levels = [['everyone', 'Everyone'], ['agent', 'Agents & admins'], ['admin', 'Admins only']];
  const body = m.type === 'course' ? `
      <div class="field"><label for="lmTitle">Title</label><input type="text" id="lmTitle" maxlength="200" value="${escapeHtml(d.title)}" required></div>
      <div class="field"><label for="lmDesc">Description</label><textarea id="lmDesc" rows="3" maxlength="5000">${escapeHtml(d.description)}</textarea></div>
      <div class="grid2">
        <div class="field"><label for="lmCat">Category</label><input type="text" id="lmCat" maxlength="80" value="${escapeHtml(d.category)}" placeholder="e.g. Sales"></div>
        <div class="field"><label for="lmLevel">Who can open it</label>${sel('lmLevel', d.accessLevel, levels)}</div>
      </div>
      <div class="field"><label for="lmCover">Cover image link (optional)</label><input type="text" id="lmCover" maxlength="1000" value="${escapeHtml(d.coverUrl)}" placeholder="https://…"></div>
      <div class="field"><label for="lmStatus">Status</label>${sel('lmStatus', d.status, [['draft', 'Draft – only admins can see it'], ['published', 'Published – visible to learners'], ['archived', 'Archived – hidden, except from people already enrolled']])}</div>`
    : `
      <div class="field"><label for="lmTitle">Lesson title</label><input type="text" id="lmTitle" maxlength="200" value="${escapeHtml(d.title)}" required></div>
      <div class="field"><label for="lmVideo">Video link</label><input type="text" id="lmVideo" maxlength="1000" value="${escapeHtml(d.videoUrl)}" placeholder="https://…"><div class="lc-meta" style="margin-top:4px">YouTube, Vimeo, Loom or Google Drive plays right here. A direct .mp4 link plays too. Any other link opens in a new tab.</div></div>
      <div class="field"><label for="lmDesc">Notes (optional)</label><textarea id="lmDesc" rows="3" maxlength="5000">${escapeHtml(d.description)}</textarea></div>
      <div class="grid2">
        <div class="field"><label for="lmMins">Length in minutes (optional)</label><input type="text" id="lmMins" inputmode="decimal" value="${escapeHtml(d.durationMinutes)}" placeholder="e.g. 12"></div>
        <div class="field"><label for="lmLevel">Who can open it</label>${sel('lmLevel', d.accessLevel, [['', 'Same as the course']].concat(levels))}</div>
      </div>`;
  return `
    <div class="overlay center" id="learnOverlay">
      <form class="property-modal lc-modal" id="learnForm" novalidate>
        <div class="drawer-head"><h3>${m.type === 'course' ? (isNew ? 'New course' : 'Edit course') : (isNew ? 'Add lesson' : 'Edit lesson')}</h3><button type="button" class="closeX" data-modal="close" aria-label="Close">&times;</button></div>
        ${body}
        <div class="error-text" id="lcModalError"></div>
        <div class="modal-actions"><button type="button" class="btn secondary" data-modal="close">Cancel</button><button type="submit" class="btn brass" id="lmSave">${isNew ? 'Create' : 'Save'}</button></div>
      </form>
    </div>`;
}

function attachLearningModal() {
  const close = () => { learn.modal = null; render(); };
  const overlay = document.getElementById('learnOverlay');
  overlay.querySelectorAll('[data-modal=close]').forEach(b => b.onclick = close);
  overlay.onmousedown = e => { if (e.target === overlay) close(); };
  const first = document.getElementById('lmTitle'); if (first) first.focus();

  document.getElementById('learnForm').onsubmit = async e => {
    e.preventDefault();
    const m = learn.modal, v = id => (document.getElementById(id) || {}).value || '';
    const err = document.getElementById('lcModalError'), btn = document.getElementById('lmSave');
    err.textContent = ''; btn.disabled = true;
    try {
      if (m.type === 'course') {
        const body = { title: v('lmTitle'), description: v('lmDesc'), category: v('lmCat'), coverUrl: v('lmCover'), accessLevel: v('lmLevel'), status: v('lmStatus') };
        if (m.data.id) await api(`/learning/courses/${m.data.id}`, { method: 'PATCH', body });
        else await api('/learning/courses', { method: 'POST', body });
      } else {
        const body = { title: v('lmTitle'), videoUrl: v('lmVideo'), description: v('lmDesc'), durationMinutes: v('lmMins').trim(), accessLevel: v('lmLevel') };
        if (m.data.id) await api(`/learning/lessons/${m.data.id}`, { method: 'PATCH', body });
        else await api(`/learning/courses/${learn.courseId}/lessons`, { method: 'POST', body });
      }
      const wasLesson = m.type === 'lesson', wasNew = !m.data.id;
      learn.modal = null;
      showToast(wasLesson ? (wasNew ? 'Lesson added' : 'Lesson saved') : (wasNew ? 'Course created' : 'Course saved'));
      await loadLearning();
      if (learn.courseId) await reloadDetail();
      render();
    } catch (ex) {
      err.textContent = ex.message; btn.disabled = false;
    }
  };
}

// ============================================================
// Event wiring — one delegated set of handlers on the learning root
// ============================================================
function attachLearningHandlers() {
  const root = document.getElementById('learnRoot');
  if (!root) return;
  lcAttachCovers(root);

  const act = el => {
    const id = Number(el.dataset.id);
    switch (el.dataset.act) {
      case 'tab': learn.tab = el.dataset.tab; render(); break;
      case 'retry': learn.error = null; loadLearning(); render(); break;
      case 'open-course': openCourse(id, Number(el.dataset.lesson) || undefined); break;
      case 'back': closeCourse(); break;
      case 'select-lesson': lcSelectLesson(id); break;
      case 'toggle-complete': lcToggleComplete(id); break;
      case 'prev-lesson': { const l = lcAdjacent(-1); if (l) lcSelectLesson(l.id); break; }
      case 'next-lesson': { const l = lcAdjacent(1); if (l) lcSelectLesson(l.id); break; }
      case 'enroll': lcEnroll(id); break;
      case 'leave': lcLeave(id); break;
      case 'save-name': lcSaveName(); break;
      case 'new-course': lcOpenCourseForm(null); break;
      case 'edit-course': lcOpenCourseForm(id); break;
      case 'delete-course': lcDeleteCourse(id); break;
      case 'set-status': lcSetStatus(id, el.dataset.status); break;
      case 'new-lesson': lcOpenLessonForm(null); break;
      case 'edit-lesson': lcOpenLessonForm(id); break;
      case 'delete-lesson': lcDeleteLesson(id); break;
      case 'move-lesson': lcMoveLesson(id, Number(el.dataset.dir)); break;
    }
  };

  root.onclick = e => {
    // The innermost [data-act] wins, so a button inside a clickable card does its own job.
    const el = e.target.closest('[data-act]');
    if (el && root.contains(el) && !el.disabled) act(el);
  };
  root.onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('[data-act][role=button]');
    if (el && e.target === el) { e.preventDefault(); act(el); }
  };
  root.oninput = e => {
    if (e.target.id === 'lcSearch') { learn.q = e.target.value; lcRedrawGrid(); }
    else if (e.target.id === 'lcName') learn.nameDraft = e.target.value;
  };
  root.onchange = e => {
    if (e.target.id === 'lcFilter') { learn.filter = e.target.value; lcRedrawGrid(); }
    else if (e.target.id === 'lcCategory') { learn.category = e.target.value; lcRedrawGrid(); }
  };
}

// The catalogue grid redraws on its own so the search box keeps focus while you type.
function lcRedrawGrid() {
  const grid = document.getElementById('lcGrid');
  if (!grid) return;
  grid.innerHTML = lcGridInner();
  lcAttachCovers(grid);
}
