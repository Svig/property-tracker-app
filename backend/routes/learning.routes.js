// Learning Centre API — courses made of video lessons, enrolment, progress.
// Mounted at /api/learning. Every query is scoped to req.user.tenant_id, like
// every other tenant route.
//
// Model in one paragraph: a course has ordered lessons. Videos are LINKS
// (parsed by config/video.js into something safe to show). A course and,
// optionally, each lesson has a minimum level — everyone | agent | admin.
// A lesson can only be MORE restricted than its course, never less. People
// below the level still see the title in the catalogue (with a lock) but are
// never sent the video link. Progress is counted over the lessons a person
// can actually open, so a lesson above their level never holds them back
// from finishing.
//
// Output is camelCase (the convention for new endpoints); the DB is snake_case.
const express = require('express');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { parseVideoUrl, cleanHttpsUrl } = require('../config/video');

const router = express.Router();
router.use(requireAuth); // any logged-in user of the tenant; admin-only routes add requireAdmin

const DEFAULT_NAME = 'Learning Centre';
const NAME_SETTING = 'learning_centre_name';
const STATUSES = ['draft', 'published', 'archived'];
const LEVELS = ['everyone', 'agent', 'admin'];

// ---------------- access levels ----------------
// Mirrors the user-level structure: viewer < agent < admin. (There is no
// 'viewer' login role yet; it is ranked here so adding it later changes nothing.)
const ROLE_RANK = { viewer: 1, agent: 2, admin: 3 };
const LEVEL_RANK = { everyone: 0, agent: 2, admin: 3 };
// An unrecognised level is treated as the MOST restrictive, never as open.
const rankOf = level => (level in LEVEL_RANK ? LEVEL_RANK[level] : LEVEL_RANK.admin);
const levelOfRank = r => (r >= 3 ? 'admin' : r >= 2 ? 'agent' : 'everyone');
const canOpen = (role, rank) => (ROLE_RANK[role] || 0) >= rank;
const lessonRank = (course, lesson) => Math.max(rankOf(course.access_level), lesson.access_level ? rankOf(lesson.access_level) : 0);

const isDuplicate = err => err && (err.code === 'ER_DUP_ENTRY' || err.code === '23505');
async function insertIgnoringDuplicate(sql, params) {
  try { await db.query(sql, params); } catch (err) { if (!isDuplicate(err)) throw err; }
}

// A positive whole number that fits a 32-bit column. (Postgres errors on anything larger
// instead of just not finding it, which would turn "no such course" into a 500.)
function toId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
}

// ---------------- loading + shaping ----------------
async function loadLessons(tenantId, courseId) {
  const cols = 'id, course_id, title, description, video_url, duration_seconds, position, access_level';
  if (courseId) {
    return db.query(`SELECT ${cols} FROM lessons WHERE tenant_id = ? AND course_id = ? ORDER BY position ASC, id ASC`, [tenantId, courseId]);
  }
  return db.query(`SELECT ${cols} FROM lessons WHERE tenant_id = ? ORDER BY course_id ASC, position ASC, id ASC`, [tenantId]);
}

async function loadMyProgress(tenantId, userId, courseId) {
  const rows = courseId
    ? await db.query('SELECT lesson_id FROM lesson_progress WHERE tenant_id = ? AND user_id = ? AND course_id = ?', [tenantId, userId, courseId])
    : await db.query('SELECT lesson_id FROM lesson_progress WHERE tenant_id = ? AND user_id = ?', [tenantId, userId]);
  return new Set(rows.map(r => r.lesson_id));
}

function shapeCourse(course, lessons, done, enrollment, role, adminCounts) {
  const courseOpen = canOpen(role, rankOf(course.access_level));
  const accessible = courseOpen ? lessons.filter(l => canOpen(role, lessonRank(course, l))) : [];
  const doneHere = accessible.filter(l => done.has(l.id));
  const next = accessible.find(l => !done.has(l.id));
  const completed = !!enrollment && accessible.length > 0 && doneHere.length === accessible.length;

  const out = {
    id: course.id,
    title: course.title,
    description: course.description || '',
    category: course.category || '',
    coverUrl: course.cover_url || '',
    accessLevel: course.access_level,
    status: course.status,
    locked: !courseOpen,
    totalLessons: lessons.length,        // every lesson in the course
    lessonCount: accessible.length,      // the ones this person can open (what progress is measured against)
    completedCount: doneHere.length,
    progressPct: accessible.length ? Math.round((doneHere.length * 100) / accessible.length) : 0,
    durationSeconds: accessible.reduce((s, l) => s + (Number(l.duration_seconds) || 0), 0),
    enrolled: !!enrollment,
    enrolledAt: enrollment ? enrollment.enrolled_at : null,
    completed,
    completedAt: completed && enrollment ? enrollment.completed_at || null : null,
    nextLessonId: next ? next.id : null,
    nextLessonTitle: next ? next.title : null,   // "Up next: ..." on the My Learning cards
    createdAt: course.created_at,
    updatedAt: course.updated_at,
  };
  if (role === 'admin' && adminCounts) {
    out.enrolledCount = adminCounts.enrolled;
    out.completedEnrollments = adminCounts.completed;
  }
  return out;
}

function shapeVideo(url) {
  if (!url) return null;
  const v = parseVideoUrl(url);
  if (!v.ok) return null;
  const out = { kind: v.kind, provider: v.provider, url: v.url };
  if (v.embedUrl) out.embedUrl = v.embedUrl;
  return out;
}

function shapeLesson(course, lesson, done, role) {
  const rank = lessonRank(course, lesson);
  const locked = !canOpen(role, rank);
  const out = {
    id: lesson.id,
    title: lesson.title,
    position: lesson.position,
    durationSeconds: lesson.duration_seconds === null || lesson.duration_seconds === undefined ? null : Number(lesson.duration_seconds),
    completed: done.has(lesson.id),
    locked,
    requiredLevel: levelOfRank(rank),
    // A locked lesson only shows its title — no description and, above all, no video link.
    description: locked ? '' : lesson.description || '',
    video: locked ? null : shapeVideo(lesson.video_url),
  };
  if (role === 'admin') {            // the raw values the editor needs
    out.videoUrl = lesson.video_url || '';
    out.ownAccessLevel = lesson.access_level || '';
    out.description = lesson.description || '';
  }
  return out;
}

async function loadCourseRow(req, id) {
  return db.getOne('SELECT * FROM courses WHERE id = ? AND tenant_id = ?', [id, req.user.tenant_id]);
}

async function myEnrollment(req, courseId) {
  return db.getOne(
    'SELECT course_id, enrolled_at, completed_at FROM course_enrollments WHERE tenant_id = ? AND user_id = ? AND course_id = ?',
    [req.user.tenant_id, req.user.id, courseId]
  );
}

// A person may see a course if it is published, or they're an admin, or it's
// archived and they were already enrolled (so finished courses don't vanish).
function canSee(req, course, enrollment) {
  if (req.user.role === 'admin') return true;
  if (course.status === 'published') return true;
  return course.status === 'archived' && !!enrollment;
}

async function summaryFor(req, courseId) {
  const course = await loadCourseRow(req, courseId);
  if (!course) return null;
  const [lessons, done, enrollment] = await Promise.all([
    loadLessons(req.user.tenant_id, courseId),
    loadMyProgress(req.user.tenant_id, req.user.id, courseId),
    myEnrollment(req, courseId),
  ]);
  return shapeCourse(course, lessons, done, enrollment, req.user.role, null);
}

// Keeps course_enrollments.completed_at in step with the progress rows: set the
// first time every openable lesson is done, cleared if that stops being true.
async function syncCompletion(req, courseId) {
  const s = await summaryFor(req, courseId);
  if (!s || !s.enrolled) return s;
  const row = await myEnrollment(req, courseId);
  if (s.completed && !row.completed_at) {
    await db.query('UPDATE course_enrollments SET completed_at = NOW() WHERE tenant_id = ? AND user_id = ? AND course_id = ?', [req.user.tenant_id, req.user.id, courseId]);
  } else if (!s.completed && row.completed_at) {
    await db.query('UPDATE course_enrollments SET completed_at = NULL WHERE tenant_id = ? AND user_id = ? AND course_id = ?', [req.user.tenant_id, req.user.id, courseId]);
  }
  return summaryFor(req, courseId);
}

// ---------------- validation ----------------
function str(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

// Returns { values } or { error }. `partial` = only validate keys that are present.
function validateCourse(body, partial) {
  const v = {};
  const has = k => body && Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has('title')) {
    const title = str(body.title, 200);
    if (!title) return { error: 'A course needs a title.' };
    v.title = title;
  }
  if (!partial || has('description')) v.description = str(body.description, 5000) || null;
  if (!partial || has('category')) v.category = str(body.category, 80) || null;
  if (!partial || has('coverUrl')) {
    const raw = str(body.coverUrl, 1000);
    if (raw) {
      const url = cleanHttpsUrl(raw);
      if (!url) return { error: 'The cover image must be a valid https:// link.' };
      v.cover_url = url;
    } else v.cover_url = null;
  }
  if (!partial || has('accessLevel')) {
    const level = body.accessLevel || 'everyone';
    if (!LEVELS.includes(level)) return { error: `Access level must be one of: ${LEVELS.join(', ')}.` };
    v.access_level = level;
  }
  if (!partial || has('status')) {
    const status = body.status || 'draft';
    if (!STATUSES.includes(status)) return { error: `Status must be one of: ${STATUSES.join(', ')}.` };
    v.status = status;
  }
  return { values: v };
}

function validateLesson(body, partial) {
  const v = {};
  const has = k => body && Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has('title')) {
    const title = str(body.title, 200);
    if (!title) return { error: 'A lesson needs a title.' };
    v.title = title;
  }
  if (!partial || has('description')) v.description = str(body.description, 5000) || null;
  if (!partial || has('videoUrl')) {
    const raw = str(body.videoUrl, 1100);
    if (raw) {
      const parsed = parseVideoUrl(raw);
      if (!parsed.ok) return { error: parsed.error };
      v.video_url = parsed.url;
    } else v.video_url = null;
  }
  if (!partial || has('durationMinutes')) {
    const raw = body.durationMinutes;
    if (raw === '' || raw === null || raw === undefined) v.duration_seconds = null;
    else {
      const mins = Number(raw);
      if (!Number.isFinite(mins) || mins < 0 || mins > 1440) return { error: 'Duration must be between 0 and 1440 minutes.' };
      v.duration_seconds = Math.round(mins * 60);
    }
  }
  if (!partial || has('accessLevel')) {
    const level = body.accessLevel;
    if (!level || level === 'inherit') v.access_level = null;
    else if (LEVELS.includes(level)) v.access_level = level;
    else return { error: `Access level must be one of: ${LEVELS.join(', ')}, or blank to follow the course.` };
  }
  return { values: v };
}

// ============================================================
// Settings
// ============================================================

// GET /api/learning/config — the section's display name for this tenant
router.get('/config', async (req, res) => {
  const row = await db.getOne('SELECT setting_value FROM tenant_settings WHERE tenant_id = ? AND setting_key = ?', [req.user.tenant_id, NAME_SETTING]);
  res.json({ name: (row && row.setting_value) || DEFAULT_NAME });
});

// PUT /api/learning/config { name } — admin. Blank resets to the default name.
router.put('/config', requireAdmin, async (req, res) => {
  const name = str(req.body && req.body.name, 60);
  if (!name) {
    await db.query('DELETE FROM tenant_settings WHERE tenant_id = ? AND setting_key = ?', [req.user.tenant_id, NAME_SETTING]);
    return res.json({ name: DEFAULT_NAME });
  }
  const existing = await db.getOne('SELECT setting_key FROM tenant_settings WHERE tenant_id = ? AND setting_key = ?', [req.user.tenant_id, NAME_SETTING]);
  if (existing) {
    await db.query('UPDATE tenant_settings SET setting_value = ? WHERE tenant_id = ? AND setting_key = ?', [name, req.user.tenant_id, NAME_SETTING]);
  } else {
    await insertIgnoringDuplicate('INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES (?, ?, ?)', [req.user.tenant_id, NAME_SETTING, name]);
    await db.query('UPDATE tenant_settings SET setting_value = ? WHERE tenant_id = ? AND setting_key = ?', [name, req.user.tenant_id, NAME_SETTING]); // covers a concurrent insert
  }
  res.json({ name });
});

// ============================================================
// Catalogue + course
// ============================================================

// GET /api/learning/courses — the catalogue as this person sees it: every course
// they're allowed to know about (locked ones included, marked locked), with
// their own enrolment and progress on each.
router.get('/courses', async (req, res) => {
  const { tenant_id: tenantId, id: userId, role } = req.user;
  const [courses, lessons, done, enrollments] = await Promise.all([
    db.query('SELECT * FROM courses WHERE tenant_id = ? ORDER BY created_at DESC, id DESC', [tenantId]),
    loadLessons(tenantId, null),
    loadMyProgress(tenantId, userId, null),
    db.query('SELECT course_id, enrolled_at, completed_at FROM course_enrollments WHERE tenant_id = ? AND user_id = ?', [tenantId, userId]),
  ]);
  const enrollmentByCourse = new Map(enrollments.map(e => [e.course_id, e]));
  const lessonsByCourse = new Map();
  for (const l of lessons) {
    if (!lessonsByCourse.has(l.course_id)) lessonsByCourse.set(l.course_id, []);
    lessonsByCourse.get(l.course_id).push(l);
  }

  let counts = null;
  if (role === 'admin') {
    const rows = await db.query('SELECT course_id, completed_at FROM course_enrollments WHERE tenant_id = ?', [tenantId]);
    counts = new Map();
    for (const r of rows) {
      const c = counts.get(r.course_id) || { enrolled: 0, completed: 0 };
      c.enrolled++;
      if (r.completed_at) c.completed++;
      counts.set(r.course_id, c);
    }
  }

  const shaped = courses
    .filter(c => canSee(req, c, enrollmentByCourse.get(c.id)))
    .map(c => shapeCourse(c, lessonsByCourse.get(c.id) || [], done, enrollmentByCourse.get(c.id), role, counts ? counts.get(c.id) || { enrolled: 0, completed: 0 } : null));
  res.json({ courses: shaped });
});

// GET /api/learning/courses/:id — one course with its lessons. Videos are only
// included for lessons this person is allowed to open.
router.get('/courses/:id', async (req, res) => {
  const id = toId(req.params.id);
  const course = id && (await loadCourseRow(req, id));
  const enrollment = course && (await myEnrollment(req, course.id));
  if (!course || !canSee(req, course, enrollment)) return res.status(404).json({ error: 'Course not found.' });

  const [lessons, done] = await Promise.all([
    loadLessons(req.user.tenant_id, course.id),
    loadMyProgress(req.user.tenant_id, req.user.id, course.id),
  ]);
  res.json({
    course: shapeCourse(course, lessons, done, enrollment, req.user.role, null),
    lessons: lessons.map(l => shapeLesson(course, l, done, req.user.role)),
  });
});

// GET /api/learning/my — everything the "My Learning" page needs in one request:
// the courses this person is enrolled in, each with the lessons they can open
// (done / not done), plus totals. Lessons above their level are left out, like
// everywhere else. A course whose level was raised after they enrolled stays in
// the list, marked locked, but doesn't count towards the totals.
router.get('/my', async (req, res) => {
  const { tenant_id: tenantId, id: userId, role } = req.user;
  const [enrollments, courses, lessons, done] = await Promise.all([
    db.query('SELECT course_id, enrolled_at, completed_at FROM course_enrollments WHERE tenant_id = ? AND user_id = ? ORDER BY enrolled_at DESC, id DESC', [tenantId, userId]),
    db.query('SELECT * FROM courses WHERE tenant_id = ?', [tenantId]),
    loadLessons(tenantId, null),
    loadMyProgress(tenantId, userId, null),
  ]);
  const courseById = new Map(courses.map(c => [c.id, c]));
  const lessonsByCourse = new Map();
  for (const l of lessons) {
    if (!lessonsByCourse.has(l.course_id)) lessonsByCourse.set(l.course_id, []);
    lessonsByCourse.get(l.course_id).push(l);
  }

  const mine = [];
  for (const e of enrollments) {
    const course = courseById.get(e.course_id);
    if (!course || !canSee(req, course, e)) continue;
    const all = lessonsByCourse.get(course.id) || [];
    const shaped = shapeCourse(course, all, done, e, role, null);
    const open = shaped.locked ? [] : all.filter(l => canOpen(role, lessonRank(course, l)));
    mine.push({
      ...shaped,
      lessons: open.map(l => ({
        id: l.id,
        title: l.title,
        durationSeconds: l.duration_seconds === null || l.duration_seconds === undefined ? null : Number(l.duration_seconds),
        completed: done.has(l.id),
      })),
    });
  }

  const live = mine.filter(c => !c.locked);
  res.json({
    stats: {
      enrolled: mine.length,
      completed: live.filter(c => c.completed).length,
      inProgress: live.filter(c => !c.completed).length,
      lessonsDone: live.reduce((n, c) => n + c.completedCount, 0),
      lessonsToDo: live.reduce((n, c) => n + (c.lessonCount - c.completedCount), 0),
    },
    courses: mine,
  });
});

// ============================================================
// Enrolment + progress (any logged-in user, for courses they can open)
// ============================================================

async function openableCourse(req, res) {
  const id = toId(req.params.id);
  const course = id && (await loadCourseRow(req, id));
  const enrollment = course && (await myEnrollment(req, course.id));
  if (!course || !canSee(req, course, enrollment)) { res.status(404).json({ error: 'Course not found.' }); return null; }
  if (!canOpen(req.user.role, rankOf(course.access_level))) {
    res.status(403).json({ error: `This course needs ${levelOfRank(rankOf(course.access_level))} access.` });
    return null;
  }
  return course;
}

// POST /api/learning/courses/:id/enroll
router.post('/courses/:id/enroll', async (req, res) => {
  const course = await openableCourse(req, res);
  if (!course) return;
  await insertIgnoringDuplicate('INSERT INTO course_enrollments (tenant_id, course_id, user_id) VALUES (?, ?, ?)', [req.user.tenant_id, course.id, req.user.id]);
  res.status(201).json({ course: await syncCompletion(req, course.id) });
});

// DELETE /api/learning/courses/:id/enroll — leaves the course; completed lessons are kept
router.delete('/courses/:id/enroll', async (req, res) => {
  const id = toId(req.params.id);
  const course = id && (await loadCourseRow(req, id));
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  await db.query('DELETE FROM course_enrollments WHERE tenant_id = ? AND user_id = ? AND course_id = ?', [req.user.tenant_id, req.user.id, course.id]);
  res.json({ course: await summaryFor(req, course.id) });
});

async function openableLesson(req, res) {
  const id = toId(req.params.id);
  const lesson = id && (await db.getOne('SELECT id, course_id, access_level FROM lessons WHERE id = ? AND tenant_id = ?', [id, req.user.tenant_id]));
  const course = lesson && (await loadCourseRow(req, lesson.course_id));
  const enrollment = course && (await myEnrollment(req, course.id));
  if (!lesson || !course || !canSee(req, course, enrollment)) { res.status(404).json({ error: 'Lesson not found.' }); return null; }
  const rank = lessonRank(course, lesson);
  if (!canOpen(req.user.role, rank)) {
    res.status(403).json({ error: `This lesson needs ${levelOfRank(rank)} access.` });
    return null;
  }
  return { lesson, course };
}

// POST /api/learning/lessons/:id/complete — marks it done (and enrols you if you weren't)
router.post('/lessons/:id/complete', async (req, res) => {
  const found = await openableLesson(req, res);
  if (!found) return;
  const { lesson, course } = found;
  await insertIgnoringDuplicate('INSERT INTO lesson_progress (tenant_id, course_id, lesson_id, user_id) VALUES (?, ?, ?, ?)', [req.user.tenant_id, course.id, lesson.id, req.user.id]);
  await insertIgnoringDuplicate('INSERT INTO course_enrollments (tenant_id, course_id, user_id) VALUES (?, ?, ?)', [req.user.tenant_id, course.id, req.user.id]);
  res.json({ course: await syncCompletion(req, course.id) });
});

// DELETE /api/learning/lessons/:id/complete — marks it not done
router.delete('/lessons/:id/complete', async (req, res) => {
  const found = await openableLesson(req, res);
  if (!found) return;
  await db.query('DELETE FROM lesson_progress WHERE tenant_id = ? AND user_id = ? AND lesson_id = ?', [req.user.tenant_id, req.user.id, found.lesson.id]);
  res.json({ course: await syncCompletion(req, found.course.id) });
});

// ============================================================
// Admin: courses
// ============================================================

// POST /api/learning/courses
router.post('/courses', requireAdmin, async (req, res) => {
  const { values, error } = validateCourse(req.body || {}, false);
  if (error) return res.status(400).json({ error });
  const id = await db.insert(
    'INSERT INTO courses (tenant_id, title, description, category, cover_url, access_level, status, created_by) VALUES (?,?,?,?,?,?,?,?)',
    [req.user.tenant_id, values.title, values.description, values.category, values.cover_url, values.access_level, values.status, req.user.id]
  );
  res.status(201).json({ course: await summaryFor(req, id) });
});

// PATCH /api/learning/courses/:id
router.patch('/courses/:id', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  const course = id && (await loadCourseRow(req, id));
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  const { values, error } = validateCourse(req.body || {}, true);
  if (error) return res.status(400).json({ error });
  const keys = Object.keys(values);
  if (keys.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
  await db.query(`UPDATE courses SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ? AND tenant_id = ?`, [...keys.map(k => values[k]), id, req.user.tenant_id]);
  res.json({ course: await summaryFor(req, id) });
});

// DELETE /api/learning/courses/:id — also removes its lessons, enrolments and progress
router.delete('/courses/:id', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Course not found.' });
  await db.query('DELETE FROM courses WHERE id = ? AND tenant_id = ?', [id, req.user.tenant_id]);
  res.json({ ok: true });
});

// ============================================================
// Admin: lessons
// ============================================================

// POST /api/learning/courses/:id/lessons — appended to the end of the course
router.post('/courses/:id/lessons', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  const course = id && (await loadCourseRow(req, id));
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  const { values, error } = validateLesson(req.body || {}, false);
  if (error) return res.status(400).json({ error });
  const max = await db.getOne('SELECT COALESCE(MAX(position), 0) AS m FROM lessons WHERE tenant_id = ? AND course_id = ?', [req.user.tenant_id, id]);
  const lessonId = await db.insert(
    'INSERT INTO lessons (tenant_id, course_id, title, description, video_url, duration_seconds, position, access_level) VALUES (?,?,?,?,?,?,?,?)',
    [req.user.tenant_id, id, values.title, values.description, values.video_url, values.duration_seconds, Number(max.m) + 1, values.access_level]
  );
  const row = await db.getOne('SELECT id, course_id, title, description, video_url, duration_seconds, position, access_level FROM lessons WHERE id = ? AND tenant_id = ?', [lessonId, req.user.tenant_id]);
  res.status(201).json({ lesson: shapeLesson(course, row, new Set(), req.user.role) });
});

// PATCH /api/learning/lessons/:id
router.patch('/lessons/:id', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  const lesson = id && (await db.getOne('SELECT id, course_id FROM lessons WHERE id = ? AND tenant_id = ?', [id, req.user.tenant_id]));
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  const { values, error } = validateLesson(req.body || {}, true);
  if (error) return res.status(400).json({ error });
  const keys = Object.keys(values);
  if (keys.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
  await db.query(`UPDATE lessons SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ? AND tenant_id = ?`, [...keys.map(k => values[k]), id, req.user.tenant_id]);
  const course = await loadCourseRow(req, lesson.course_id);
  const row = await db.getOne('SELECT id, course_id, title, description, video_url, duration_seconds, position, access_level FROM lessons WHERE id = ? AND tenant_id = ?', [id, req.user.tenant_id]);
  res.json({ lesson: shapeLesson(course, row, new Set(), req.user.role) });
});

// DELETE /api/learning/lessons/:id
router.delete('/lessons/:id', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Lesson not found.' });
  await db.query('DELETE FROM lessons WHERE id = ? AND tenant_id = ?', [id, req.user.tenant_id]);
  res.json({ ok: true });
});

// POST /api/learning/courses/:id/lessons/reorder { order: [lessonId, ...] } — must list every lesson once
router.post('/courses/:id/lessons/reorder', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  const course = id && (await loadCourseRow(req, id));
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  const order = Array.isArray(req.body && req.body.order) ? req.body.order.map(Number) : null;
  const existing = (await loadLessons(req.user.tenant_id, id)).map(l => l.id);
  const valid = order && order.length === existing.length && new Set(order).size === order.length && order.every(x => existing.includes(x));
  if (!valid) return res.status(400).json({ error: 'The new order must list every lesson in the course exactly once.' });
  await db.transaction(async tx => {
    for (let i = 0; i < order.length; i++) {
      await tx.query('UPDATE lessons SET position = ? WHERE id = ? AND course_id = ? AND tenant_id = ?', [i + 1, order[i], id, req.user.tenant_id]);
    }
  });
  res.json({ ok: true });
});

module.exports = router;
