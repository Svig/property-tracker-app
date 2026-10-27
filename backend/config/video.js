// Turns a pasted video link into something the browser can safely show.
//
// Videos "sit anywhere": the Learning Centre only stores a link. This decides,
// from the link alone, HOW it can be shown:
//
//   kind 'embed'  a known provider whose official player we put in an <iframe>
//                 (YouTube, Vimeo, Loom, Google Drive). We never use the pasted
//                 URL as the iframe source — we rebuild a fixed embed URL from
//                 the video ID we extracted, so what ends up in the iframe is
//                 always <known host>/<validated id>, nothing else.
//   kind 'file'   a direct video file (.mp4 .webm .ogg .ogv .mov .m4v) on any
//                 https site — played in the browser's own <video> player.
//   kind 'link'   anything else — shown as an "open video" link in a new tab.
//
// Safety rules (admins paste these, but the result is shown to every learner):
//   - https only (rejects javascript:, data:, http:, file:, ...)
//   - no credentials in the URL (https://youtube.com@evil.com/ is rejected)
//   - provider hosts are matched EXACTLY, never by "contains" — so
//     youtube.com.evil.com or evil.com/?youtube.com are just plain links
//
// To support a new provider: add a branch in parseVideoUrl() and a test.

const MAX_URL_LENGTH = 1000; // matches lessons.video_url / courses.cover_url

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
const LOOM_HOSTS = new Set(['loom.com', 'www.loom.com']);
const DRIVE_HOSTS = new Set(['drive.google.com']);
const FILE_EXTENSIONS = /\.(mp4|webm|ogg|ogv|mov|m4v)$/i;

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{5,12}$/;
const VIMEO_HASH = /^[A-Za-z0-9]{6,20}$/;
const LOOM_ID = /^[a-f0-9]{32}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;

// Parses and validates a plain https URL. Returns a URL object or null.
function parseHttps(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > MAX_URL_LENGTH || /\s/.test(raw)) return null;
  let u;
  try { u = new URL(raw); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  return u;
}

function cleanHost(u) {
  return u.hostname.toLowerCase().replace(/\.$/, '');
}

function parseVideoUrl(input) {
  const u = parseHttps(input);
  if (!u) return { ok: false, error: 'Enter a valid https:// video link.' };
  const host = cleanHost(u);
  const parts = u.pathname.split('/').filter(Boolean);
  const url = input.trim();
  const embed = (provider, embedUrl) => ({ ok: true, kind: 'embed', provider, embedUrl, url });

  // ---- YouTube ----
  if (host === 'youtu.be') {
    if (parts[0] && YT_ID.test(parts[0])) return embed('youtube', `https://www.youtube-nocookie.com/embed/${parts[0]}?rel=0`);
  } else if (YOUTUBE_HOSTS.has(host)) {
    let id = null;
    if (parts[0] === 'watch') id = u.searchParams.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) id = parts[1];
    if (id && YT_ID.test(id)) return embed('youtube', `https://www.youtube-nocookie.com/embed/${id}?rel=0`);
  }

  // ---- Vimeo ----  vimeo.com/123456789   vimeo.com/123456789/<hash> (unlisted)   player.vimeo.com/video/123456789
  if (VIMEO_HOSTS.has(host)) {
    const idIndex = parts[0] === 'video' ? 1 : 0;
    const id = parts[idIndex];
    if (id && VIMEO_ID.test(id)) {
      const hash = parts[idIndex + 1] || u.searchParams.get('h');
      const query = hash && VIMEO_HASH.test(hash) ? `?h=${hash}` : '';
      return embed('vimeo', `https://player.vimeo.com/video/${id}${query}`);
    }
  }

  // ---- Loom ----  loom.com/share/<id>   loom.com/embed/<id>
  if (LOOM_HOSTS.has(host) && ['share', 'embed'].includes(parts[0]) && parts[1] && LOOM_ID.test(parts[1])) {
    return embed('loom', `https://www.loom.com/embed/${parts[1]}`);
  }

  // ---- Google Drive ----  drive.google.com/file/d/<id>/view
  if (DRIVE_HOSTS.has(host) && parts[0] === 'file' && parts[1] === 'd' && parts[2] && DRIVE_ID.test(parts[2])) {
    return embed('gdrive', `https://drive.google.com/file/d/${parts[2]}/preview`);
  }

  // ---- a direct video file ----
  if (FILE_EXTENSIONS.test(u.pathname)) return { ok: true, kind: 'file', provider: 'file', url };

  // ---- anything else: opens in a new tab ----
  return { ok: true, kind: 'link', provider: 'link', url };
}

// For fields that are just "an https link" (e.g. a course cover image).
// Returns the trimmed URL, or null if it isn't a plain https URL.
function cleanHttpsUrl(input) {
  const u = parseHttps(input);
  return u ? input.trim() : null;
}

module.exports = { parseVideoUrl, cleanHttpsUrl, MAX_URL_LENGTH };
