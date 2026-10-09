// ============================================================
// Contact export + sorting helpers (no DOM, no state — pure functions).
// Loaded before app.js. Also require()-able from Node for testing.
//
//  - splitName()        "Jan van der Merwe" -> { given:'Jan', surname:'van der Merwe' }
//  - buildVCard()       one contact -> one vCard 3.0 string (phone/email/note)
//  - buildFilename()    naming conventions chosen in the export dialog
//  - buildZip()         minimal store-only ZIP writer (no library, no build step)
//  - sortClients()      sort by any field, empty values always last
// ============================================================

// Lower-case words that belong to a surname rather than a given name
// (common in Afrikaans / Dutch / German / Portuguese / French names).
const SURNAME_PARTICLES = new Set([
  'van','von','de','der','den','du','le','la','di','da','dos','das','ter','ten','op','bin','al',"'t",
]);

function splitName(full) {
  const tokens = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { given: '', surname: '' };
  if (tokens.length === 1) return { given: tokens[0], surname: '' };
  let i = tokens.length - 1;                         // last word is always part of the surname
  while (i > 1 && SURNAME_PARTICLES.has(tokens[i - 1].toLowerCase())) i--; // pull in "van", "van der", ...
  return { given: tokens.slice(0, i).join(' '), surname: tokens.slice(i).join(' ') };
}

// ---------------- vCard 3.0 ----------------
// RFC 2426: escape \ ; , and newlines in values; CRLF line endings;
// fold lines longer than 75 octets (continuation lines start with a space).
const vEsc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');

function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = ''; let curBytes = 0; let limit = 75;
  for (const ch of line) {                            // iterate by code point so we never split a multi-byte char
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) { out.push(cur); cur = ''; curBytes = 0; limit = 74; } // continuation lines lose 1 byte to the leading space
    cur += ch; curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function buildVCard(client, { fmtDate } = {}) {
  const { given, surname } = splitName(client.name);
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${vEsc(surname)};${vEsc(given)};;;`,
    `FN:${vEsc((client.name || '').trim())}`,
  ];
  if (client.phone && client.phone.trim()) lines.push(`TEL;TYPE=CELL:${vEsc(client.phone.trim())}`);
  if (client.email && client.email.trim()) lines.push(`EMAIL;TYPE=INTERNET:${vEsc(client.email.trim())}`);

  // A short, non-sensitive note so the contact still makes sense on the phone.
  // (Budget / financing / lead status are deliberately NOT exported.)
  const noteParts = [];
  if (client.property) noteParts.push(`Viewed: ${client.property}`);
  const when = client.viewing_date || client.created_at;
  if (when && fmtDate) noteParts.push(`on ${fmtDate(when)}`);
  if (noteParts.length) lines.push(`NOTE:${vEsc(noteParts.join(' '))}`);

  lines.push('END:VCARD');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// ---------------- filename conventions ----------------
const NAMING_OPTIONS = [
  { k: 'name_surname',          label: 'Name + Surname' },
  { k: 'name_surname_property', label: 'Name + Surname + Property viewed' },
  { k: 'name_surname_custom',   label: 'Name + Surname + Custom text' },
];

// Keep letters/numbers (any language) and join the rest with a separator;
// strips characters that are illegal in filenames on Windows/macOS/Android.
const cleanToken = (s, sep) =>
  String(s ?? '').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, sep).replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '');

function buildFilename(client, convention, customText) {
  const { given, surname } = splitName(client.name);
  const parts = [cleanToken(given, '_'), cleanToken(surname, '_')];
  if (convention === 'name_surname_property') parts.push(cleanToken(client.property, '-'));
  if (convention === 'name_surname_custom')   parts.push(cleanToken(customText, '-'));
  const base = parts.filter(Boolean).join('_') || 'contact';
  return base.slice(0, 120) + '.vcf';
}

// Make every filename in a batch unique: a.vcf, a_2.vcf, a_3.vcf ...
function uniqueFilenames(names) {
  const seen = new Map();
  return names.map(n => {
    const key = n.toLowerCase();
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    return count === 1 ? n : n.replace(/\.vcf$/i, `_${count}.vcf`);
  });
}

// ---------------- minimal ZIP writer (STORE, no compression) ----------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// files: [{ name: 'a.vcf', data: Uint8Array }]  ->  Uint8Array parts (wrap in a Blob in the browser)
function buildZipParts(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data), size = f.data.length;

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); // 0x0800 = filenames are UTF-8
    lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, nameBytes.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), nameBytes, f.data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, nameBytes.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameBytes);

    offset += 30 + nameBytes.length + size;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return [...chunks, ...central, new Uint8Array(end.buffer)];
}

// ---------------- sorting ----------------
const SORT_FIELDS = [
  { k: 'name',         label: 'Name' },
  { k: 'surname',      label: 'Surname' },
  { k: 'phone',        label: 'Phone' },
  { k: 'email',        label: 'Email' },
  { k: 'property',     label: 'Property' },
  { k: 'status',       label: 'Status' },
  { k: 'budget',       label: 'Budget' },
  { k: 'financing',    label: 'Financing' },
  { k: 'timeline',     label: 'Timeline' },
  { k: 'source',       label: 'Source' },
  { k: 'viewing_date', label: 'Viewing date' },
  { k: 'created_at',   label: 'Signed in' },
];

// Digits only, with SA "+27 82.." / "2782.." treated as "082.." so both formats match.
// Used as a SORT key and to spot repeat sign-ins by the same person; never written to the card.
function phoneKey(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('27')) d = '0' + d.slice(2);
  return d;
}

// Repeat sign-ins by the same phone number -> keep only the most recent one. No-phone rows are never merged.
function dedupeByPhone(rows) {
  const best = new Map();
  rows.forEach(c => {
    const k = phoneKey(c.phone); if (!k) return;
    const cur = best.get(k);
    if (!cur || new Date(c.created_at) > new Date(cur.created_at)) best.set(k, c);
  });
  return rows.filter(c => { const k = phoneKey(c.phone); return !k || best.get(k) === c; });
}

// Returns a string, number, or null (null = empty, always sorted last).
function sortValue(c, key, statusOrder) {
  const v = (x) => (x === undefined || x === null || String(x).trim() === '') ? null : x;
  switch (key) {
    case 'surname': { const s = splitName(c.name).surname || splitName(c.name).given; return v(s ? `${s} ${splitName(c.name).given}` : null); }
    case 'phone':   return phoneKey(c.phone) || null;
    case 'status':  { const i = (statusOrder || []).indexOf(c.status); return i === -1 ? null : i; } // pipeline order, not alphabetical
    case 'budget':  { const first = String(c.budget || '').split(/[\u2013-]/)[0].replace(/\D/g, ''); return first ? Number(first) : null; }
    case 'viewing_date':
    case 'created_at': { const t = c[key] ? new Date(c[key]).getTime() : NaN; return Number.isNaN(t) ? null : t; }
    default: return v(c[key]);
  }
}

function sortClients(list, key, dir, statusOrder) {
  const mult = dir === 'desc' ? -1 : 1;
  return list
    .map((c, i) => ({ c, i, val: sortValue(c, key, statusOrder) }))
    .sort((a, b) => {
      if (a.val === null && b.val === null) return a.i - b.i;
      if (a.val === null) return 1;                    // empties last, whichever direction
      if (b.val === null) return -1;
      const r = (typeof a.val === 'number' && typeof b.val === 'number')
        ? a.val - b.val
        : String(a.val).localeCompare(String(b.val), 'en-ZA', { numeric: true, sensitivity: 'base' });
      return r !== 0 ? r * mult : a.i - b.i;           // stable
    })
    .map(x => x.c);
}

if (typeof module !== 'undefined') {
  module.exports = { phoneKey, dedupeByPhone, splitName, buildVCard, buildFilename, uniqueFilenames, buildZipParts, crc32, sortClients, sortValue, NAMING_OPTIONS, SORT_FIELDS };
}
