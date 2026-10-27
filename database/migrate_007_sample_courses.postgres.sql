-- ============================================================
-- Migration 007 - sample Learning Centre courses (MariaDB / MySQL / Postgres)
-- Applied automatically ONCE on the next start. Adds 4 published sample
-- courses to tenant 1 using public YouTube videos (so there is something to
-- enrol in and complete). Lesson lengths are left blank. One course is
-- admins-only to show the restriction. Safe to repeat: rows already there
-- (same course/lesson title) are skipped. Delete the courses from
-- Learning Centre -> Manage whenever you like; they will not come back.
-- ============================================================

INSERT INTO courses (tenant_id, title, description, category, access_level, status, created_by)
SELECT t.id, 'Home Staging Basics', 'Quick, practical videos on getting a home ready to sell. Sample course using public YouTube videos.', 'Sales', 'everyone', 'published', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1)
FROM tenants t
WHERE t.id = 1 AND NOT EXISTS (SELECT 1 FROM courses x WHERE x.tenant_id = 1 AND x.title = 'Home Staging Basics');
INSERT INTO lessons (tenant_id, course_id, title, description, video_url, position)
SELECT c.tenant_id, c.id, 'Budget-friendly staging tips', 'Public YouTube video (sample content).', 'https://www.youtube.com/watch?v=IQoys-QtUPA', 1
FROM courses c
WHERE c.tenant_id = 1 AND c.title = 'Home Staging Basics' AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id AND l.title = 'Budget-friendly staging tips');
INSERT INTO lessons (tenant_id, course_id, title, description, video_url, position)
SELECT c.tenant_id, c.id, '7 staging tips to sell faster', 'Public YouTube video (sample content).', 'https://www.youtube.com/watch?v=7oyeOSyoiMU', 2
FROM courses c
WHERE c.tenant_id = 1 AND c.title = 'Home Staging Basics' AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id AND l.title = '7 staging tips to sell faster');
INSERT INTO lessons (tenant_id, course_id, title, description, video_url, position)
SELECT c.tenant_id, c.id, '10 staging tips to sell fast', 'Public YouTube video (sample content).', 'https://www.youtube.com/watch?v=cMBtBor_WgA', 3
FROM courses c
WHERE c.tenant_id = 1 AND c.title = 'Home Staging Basics' AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id AND l.title = '10 staging tips to sell fast');

INSERT INTO courses (tenant_id, title, description, category, access_level, status, created_by)
SELECT t.id, 'Showing Homes & Open Houses', 'How to show a property and run a good open house. Sample course using public YouTube videos.', 'Sales', 'everyone', 'published', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1)
FROM tenants t
WHERE t.id = 1 AND NOT EXISTS (SELECT 1 FROM courses x WHERE x.tenant_id = 1 AND x.title = 'Showing Homes & Open Houses');
INSERT INTO lessons (tenant_id, course_id, title, description, video_url, position)
SELECT c.tenant_id, c.id, '6 tips for viewing a house', 'Public YouTube video (sample content).', 'https://www.youtube.com/watch?v=GWZfw7dPCjc', 1
FROM courses c
WHERE c.tenant_id = 1 AND c.title = 'Showing Homes & Open Houses' AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id AND l.title = '6 tips for viewing a house');
INSERT INTO lessons (tenant_id, course_id, title, description, video_url, position)
SELECT c.tenant_id, c.id, 'How to host the perfect open house', 'Public YouTube video (sample content).', 'https://www.youtube.com/watch?v=YkYSSqkCG_M', 2
FROM courses c
WHERE c.tenant_id = 1 AND c.title = 'Showing Homes & Open Houses' AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id AND l.title = 'How to host the perfect open house');
INSERT INTO lessons (tenant_id, course_id, title, description, video_url, position)
SELECT c.tenant_id, c.id, 'How to host an open house', 'Public YouTube video (sample content).', 'https://www.youtube.com/watch?v=j00A6fXl_n0', 3
FROM courses c
WHERE c.tenant_id = 1 AND c.title = 'Showing Homes & Open Houses' AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id AND l.title = 'How to host an open house');

INSERT INTO courses (tenant_id, title, description, category, access_level, status, created_by)
SELECT t.id, 'Real Estate Basics', 'Start here if you are new to property. Sample course using public YouTube videos.', 'Foundations', 'everyone', 'published', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1)
FROM tenants t
WHERE t.id = 1 AND NOT EXISTS (SELECT 1 FROM courses x WHERE x.tenant_id = 1 AND x.title = 'Real Estate Basics');
INSERT INTO lessons (tenant_id, course_id, title, description, video_url, position)
SELECT c.tenant_id, c.id, 'Real estate basics - the first step', 'Public YouTube video (sample content).', 'https://www.youtube.com/watch?v=W40UCuWgkac', 1
FROM courses c
WHERE c.tenant_id = 1 AND c.title = 'Real Estate Basics' AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id AND l.title = 'Real estate basics - the first step');
INSERT INTO lessons (tenant_id, course_id, title, description, video_url, position)
SELECT c.tenant_id, c.id, 'Real estate for beginners', 'Public YouTube video (sample content).', 'https://www.youtube.com/watch?v=oTV4IqKllBA', 2
FROM courses c
WHERE c.tenant_id = 1 AND c.title = 'Real Estate Basics' AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id AND l.title = 'Real estate for beginners');

INSERT INTO courses (tenant_id, title, description, category, access_level, status, created_by)
SELECT t.id, 'Property Development Crash Course', 'Admins only - a sample of a restricted, higher-level course.', 'Advanced', 'admin', 'published', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1)
FROM tenants t
WHERE t.id = 1 AND NOT EXISTS (SELECT 1 FROM courses x WHERE x.tenant_id = 1 AND x.title = 'Property Development Crash Course');
INSERT INTO lessons (tenant_id, course_id, title, description, video_url, position)
SELECT c.tenant_id, c.id, 'Real estate development 101', 'Public YouTube video (sample content).', 'https://www.youtube.com/watch?v=nEQw2_rff0U', 1
FROM courses c
WHERE c.tenant_id = 1 AND c.title = 'Property Development Crash Course' AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id AND l.title = 'Real estate development 101');
