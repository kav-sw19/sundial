/* ============================================================================
   SUNDIAL — one honest photo a day.
   Pure client-side PWA. Photos never leave the device (IndexedDB).
   ============================================================================ */

const CONFIG = {
  // 'rolling'  = a 365-day year that starts on your FIRST photo, reveals 1yr later.
  // 'calendar' = Jan 1 → Dec 31 of the year you start (film seals until Dec 31).
  YEAR_MODE: "rolling",
  FILM_FRAME_MS: 550,        // how long each frame holds — calm, not snapping past
  FILM_CROSSFADE_MS: 300,    // gentle dissolve from one day into the next
  FILM_MIN_FRAME_MS: 60,     // floor for FILM_FRAME_MS
  PHOTO_MAX_DIM: 1600,       // longest edge stored (keeps a year well under phone storage)
  JPEG_QUALITY: 0.86,
  ASPECT: 4 / 5,             // portrait frame the film is composed in
};

const APP_VERSION = "2.0";
const DAY_MS = 86400000;
const $ = (sel, el = document) => el.querySelector(sel);
const app = document.getElementById("app");

/* ---------------------------------------------------------------- date utils */
const pad = (n) => String(n).padStart(2, "0");
function keyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayKey() { return keyOf(new Date()); }
function parseKey(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfDay(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
// whole local days from a to b (DST-safe: both are local midnights, so round)
function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS); }
function nextMidnight() { const d = new Date(); d.setHours(24, 0, 0, 0); return d; }
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function prettyDate(d) { return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; }
function shortDate(d) { return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }

/* ---------------------------------------------------------------- moon phase */
// Local astronomical approximation — no network needed.
function moonPhase(date) {
  const SYNODIC = 29.53058867;
  const known = Date.UTC(2000, 0, 6, 18, 14) / DAY_MS; // known new moon (days)
  const now = date.getTime() / DAY_MS;
  let age = ((now - known) % SYNODIC + SYNODIC) % SYNODIC;
  const frac = age / SYNODIC; // 0..1
  const illum = Math.round((1 - Math.cos(2 * Math.PI * frac)) / 2 * 100);
  const names = [
    [0.03, "New moon", "🌑"], [0.22, "Waxing crescent", "🌒"], [0.28, "First quarter", "🌓"],
    [0.47, "Waxing gibbous", "🌔"], [0.53, "Full moon", "🌕"], [0.72, "Waning gibbous", "🌖"],
    [0.78, "Last quarter", "🌗"], [0.97, "Waning crescent", "🌘"], [1.01, "New moon", "🌑"],
  ];
  const [, name, glyph] = names.find(([t]) => frac < t) || names[names.length - 1];
  return { frac: +frac.toFixed(3), age: +age.toFixed(1), illum, name, glyph };
}

/* ---------------------------------------------------------------- weather map */
const WMO = {
  0: ["Clear", "☀️"], 1: ["Mainly clear", "🌤"], 2: ["Partly cloudy", "⛅️"], 3: ["Overcast", "☁️"],
  45: ["Fog", "🌫"], 48: ["Rime fog", "🌫"], 51: ["Light drizzle", "🌦"], 53: ["Drizzle", "🌦"],
  55: ["Heavy drizzle", "🌧"], 61: ["Light rain", "🌦"], 63: ["Rain", "🌧"], 65: ["Heavy rain", "🌧"],
  66: ["Freezing rain", "🌧"], 67: ["Freezing rain", "🌧"], 71: ["Light snow", "🌨"], 73: ["Snow", "🌨"],
  75: ["Heavy snow", "❄️"], 77: ["Snow grains", "🌨"], 80: ["Showers", "🌦"], 81: ["Showers", "🌧"],
  82: ["Heavy showers", "⛈"], 85: ["Snow showers", "🌨"], 86: ["Snow showers", "❄️"],
  95: ["Thunderstorm", "⛈"], 96: ["Thunderstorm", "⛈"], 99: ["Thunderstorm", "⛈"],
};

/* fetch ambient metadata: weather (Open-Meteo) + city (BigDataCloud) + moon (local) */
async function getPosition() {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => res(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );
  });
}
// fetch JSON with a hard timeout so a flaky connection never hangs the merge
async function fetchJSON(url, ms = 8000) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = ctl && setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function fetchAmbient() {
  const meta = { moon: moonPhase(new Date()), capturedAt: new Date().toISOString() };
  const pos = await getPosition();
  if (pos) {
    meta.lat = +pos.lat.toFixed(4); meta.lon = +pos.lon.toFixed(4);
    try {
      const w = await fetchJSON(`https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lon}&current=temperature_2m,weather_code&timezone=auto`);
      if (w?.current) {
        meta.tempC = Math.round(w.current.temperature_2m);
        const code = w.current.weather_code;
        const [txt, glyph] = WMO[code] || ["", ""];
        meta.weatherText = txt; meta.weatherGlyph = glyph;
      }
    } catch {}
    try {
      const g = await fetchJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${pos.lat}&longitude=${pos.lon}&localityLanguage=en`);
      meta.city = g.city || g.locality || g.principalSubdivision || "";
      meta.country = g.countryName || "";
    } catch {}
  }
  return meta;
}

/* record a short moment of ambient sound and merge it into the day's record.
   Runs in the background after the (instant) photo commit, like fetchAmbient. */
async function recordMoment(dateKey, ms = 3000) {
  if (typeof MediaRecorder === "undefined") return;
  let s;
  try {
    s = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
    const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((res) => { rec.onstop = res; });
    rec.start();
    setTimeout(() => { try { rec.stop(); } catch {} }, ms);
    await stopped;
    if (!chunks.length) return;
    const type = rec.mimeType || mime || "audio/webm";
    const audio = new Blob(chunks, { type });
    await DB.updatePhoto(dateKey, (r) => { r.audio = audio; r.audioType = type; });
  } catch {} finally {
    s?.getTracks().forEach((t) => t.stop());
  }
}

/* ---------------------------------------------------------------- storage (IndexedDB) */
const DB = (() => {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("sundial", 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath: "date" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const req = fn(s);
      // undefined result (a miss) must stay undefined — never fall back to the request object
      t.oncomplete = () => res(req instanceof IDBRequest ? req.result : req);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  // read-modify-write inside ONE transaction. IndexedDB serialises overlapping
  // readwrite transactions, so concurrent updaters (caption + ambient meta)
  // can't clobber each other's fields.
  function updatePhoto(date, mutate) {
    return new Promise((res, rej) => {
      open().then((db) => {
        const t = db.transaction("photos", "readwrite");
        const s = t.objectStore("photos");
        const g = s.get(date);
        g.onsuccess = () => { const rec = g.result; if (rec) { mutate(rec); s.put(rec); } };
        t.oncomplete = () => res(g.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      }).catch(rej);
    });
  }
  return {
    putPhoto: (rec) => tx("photos", "readwrite", (s) => s.put(rec)),
    // insert-only: rejects (ConstraintError) if the day already has a photo, so
    // two tabs racing the shutter can never overwrite a committed shot
    addPhoto: (rec) => tx("photos", "readwrite", (s) => s.add(rec)),
    updatePhoto,
    getPhoto: (date) => tx("photos", "readonly", (s) => s.get(date)),
    allPhotos: () => tx("photos", "readonly", (s) => s.getAll()),
    hasPhoto: async (date) => !!(await tx("photos", "readonly", (s) => s.getKey(date))),
    getMeta: (k) => tx("meta", "readonly", (s) => s.get(k)),
    setMeta: (k, v) => tx("meta", "readwrite", (s) => s.put(v, k)),
  };
})();

/* ---------------------------------------------------------------- app state */
// Loaded once at boot (and after a restore). Everything else mutates this one
// object and saves it, and is never re-read mid-session, or open sheets would hold a
// stale copy and silently lose changes.
const State = {
  app: null, // { onboarded, firstCaptureDate, settings, watched: [cycle,...] }
  async load() {
    const DEFAULT_SETTINGS = {
      showStrip: true, devPreview: false,
      captureSound: false, showGrid: false, accent: "amber", filmLook: "none",
      dateStamp: false, lightLeaks: false, reminder: false,
    };
    this.app = (await DB.getMeta("app")) || {
      onboarded: false, firstCaptureDate: null,
      settings: { ...DEFAULT_SETTINGS },
    };
    // migrate defaults (new keys land on older saved state)
    this.app.settings = Object.assign({ ...DEFAULT_SETTINGS }, this.app.settings || {});
    if (!Array.isArray(this.app.watched)) this.app.watched = [];
    return this.app;
  },
  async save() { await DB.setMeta("app", this.app); },
};

/* film window + reveal math.
   Sundial runs in back-to-back "cycles" (years). Cycle 0 starts on your first
   photo (rolling) or Jan 1 of that year (calendar); each one seals until it
   closes, then becomes a film you can watch while the next year begins. */
function firstDay() {
  return State.app.firstCaptureDate ? parseKey(State.app.firstCaptureDate) : startOfDay();
}
function currentCycle() {
  const first = firstDay();
  if (CONFIG.YEAR_MODE === "calendar") return Math.max(0, new Date().getFullYear() - first.getFullYear());
  return Math.max(0, Math.floor(daysBetween(first, new Date()) / 365));
}
function filmRange(cycle = currentCycle()) {
  const first = firstDay();
  if (CONFIG.YEAR_MODE === "calendar") {
    const y = first.getFullYear() + cycle;
    const start = new Date(y, 0, 1);
    const end = new Date(y, 11, 31);
    const reveal = new Date(y, 11, 31); // watchable ON Dec 31
    return { cycle, start, end, reveal, total: daysBetween(start, end) + 1 };
  }
  const start = addDays(first, cycle * 365);
  const end = addDays(start, 364);
  const reveal = addDays(start, 365); // fully sealed until the 365-day cycle closes
  return { cycle, start, end, reveal, total: 365 };
}
function isSealed(cycle = currentCycle()) {
  if (State.app.settings.devPreview) return false;
  if (!State.app.firstCaptureDate) return true;
  return new Date() < filmRange(cycle).reveal;
}
// every year whose seal has broken, newest first
function revealedCycles() {
  if (!State.app.firstCaptureDate) return [];
  const out = [];
  for (let c = currentCycle(); c >= 0; c--) if (!isSealed(c)) out.push(c);
  return out;
}
// "2025" or "2025\u201326" for a cycle that spans New Year
function cycleLabel(cycle) {
  const { start, end } = filmRange(cycle);
  return start.getFullYear() === end.getFullYear()
    ? `${start.getFullYear()}`
    : `${start.getFullYear()}\u2013${String(end.getFullYear()).slice(-2)}`;
}

/* build the ordered per-day timeline of a film year */
async function buildTimeline(cycle = currentCycle()) {
  const { start, total } = filmRange(cycle);
  const photos = await DB.allPhotos();
  const map = new Map(photos.map((p) => [p.date, p]));
  const today = todayKey();
  const days = [];
  for (let i = 0; i < total; i++) {
    const d = addDays(start, i);
    const k = keyOf(d);
    const rec = map.get(k) || null;
    let status = "future";
    if (rec) status = "shot";
    else if (k < today) status = "missed";
    else if (k === today) status = "today";
    days.push({ date: k, d, rec, status });
  }
  return days;
}

/* every past year's photo for today's date, closest year first */
async function photosOnThisDay() {
  const now = new Date();
  const startYear = State.app.firstCaptureDate ? parseKey(State.app.firstCaptureDate).getFullYear() : now.getFullYear();
  const out = [];
  for (let y = now.getFullYear() - 1; y >= startYear; y--) {
    const probe = new Date(y, now.getMonth(), now.getDate());
    if (probe.getMonth() !== now.getMonth()) continue; // Feb 29 has no twin in common years
    const rec = await DB.getPhoto(keyOf(probe));
    if (rec) out.push({ yearsAgo: now.getFullYear() - y, rec });
  }
  return out;
}
function yearsAgoLabel(n) { return n === 1 ? "One year ago today" : `${n} years ago today`; }

/* ---------------------------------------------------------------- share / download */
// Hand a file to the native share sheet where possible (the only way an iPhone
// PWA can drop something into Photos), else fall back to a plain download.
// Returns "shared", "downloaded", or false when the user dismissed the sheet.
async function shareOrDownload(blob, name, title = "Sundial") {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return "shared"; }
    catch (e) { if (e.name === "AbortError") return false; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
  return "downloaded";
}
async function saveToGallery(blob, dateKey) {
  const how = await shareOrDownload(blob, `sundial-${dateKey}.jpg`);
  if (how === "shared") toast("Choose Save Image to keep a copy in Photos");
  else if (how === "downloaded") toast("Saved a copy to your downloads");
  return how;
}

/* ---------------------------------------------------------------- backup (.zip) */
// A year is precious and lives only on this device. Export bundles every photo
// (as a real .jpg you can browse) plus its caption & ambient metadata into one
// .zip; import restores it on any device. Hand-rolled STORE-method zip (no libs,
// no base64 bloat) that opens in any unzip tool. The reader also accepts
// DEFLATE archives (e.g. a backup that was unzipped and re-zipped on a Mac)
// wherever the browser has DecompressionStream.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// MS-DOS date/time, so unzip tools show real timestamps instead of 1980
function dosStamp(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}
// files: [{ name: string, data: Uint8Array }] -> Blob (application/zip)
function zipWrite(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosStamp();
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
  const u16 = (n) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n & 0xffff, true); return b; };
  const push = (b) => { chunks.push(b); offset += b.length; };
  const UTF8 = 0x0800; // general-purpose flag bit 11: names are UTF-8
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const localOff = offset;
    // local file header
    push(u32(0x04034b50)); push(u16(20)); push(u16(UTF8)); push(u16(0)); push(u16(time)); push(u16(date));
    push(u32(crc)); push(u32(f.data.length)); push(u32(f.data.length));
    push(u16(name.length)); push(u16(0)); push(name); push(f.data);
    central.push({ name, crc, size: f.data.length, off: localOff });
  }
  const cdStart = offset;
  for (const c of central) {
    push(u32(0x02014b50)); push(u16(20)); push(u16(20)); push(u16(UTF8)); push(u16(0)); push(u16(time)); push(u16(date));
    push(u32(c.crc)); push(u32(c.size)); push(u32(c.size));
    push(u16(c.name.length)); push(u16(0)); push(u16(0)); push(u16(0)); push(u16(0));
    push(u32(0)); push(u32(c.off)); push(c.name);
  }
  const cdSize = offset - cdStart;
  push(u32(0x06054b50)); push(u16(0)); push(u16(0)); push(u16(central.length)); push(u16(central.length));
  push(u32(cdSize)); push(u32(cdStart)); push(u16(0));
  return new Blob(chunks, { type: "application/zip" });
}
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") throw new Error("This backup is compressed. Restore the original .zip Sundial made.");
  const ds = new DecompressionStream("deflate-raw");
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}
// parse a zip via its central directory (sizes there are always right, even
// when a tool streamed the archive with data descriptors) -> [{ name, data }]
async function zipRead(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dec = new TextDecoder();
  // find the end-of-central-directory record (it sits within the last 64 KB)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("That file isn't a .zip backup.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("The backup looks damaged.");
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || name.startsWith("__MACOSX/")) continue;
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = await inflateRaw(raw);
    else throw new Error("Unsupported compression in backup.");
    out.push({ name, data });
  }
  return out;
}

// is the device's storage getting tight? returns details when it's worth a nudge
async function checkStorage() {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || !est.quota) return null;
    const usedMB = est.usage / 1048576;
    const freeMB = (est.quota - est.usage) / 1048576;
    const pct = est.usage / est.quota;
    if (pct > 0.85 || freeMB < 60) return { usedMB, freeMB, pct };
    return null;
  } catch { return null; }
}

async function exportBackup() {
  const photos = await DB.allPhotos();
  if (!photos.length) { toast("Nothing to back up yet. Take your first photo."); return false; }
  toast("Bundling your year\u2026", 3000);
  photos.sort((a, b) => (a.date < b.date ? -1 : 1));
  const files = [];
  const manifest = {
    app: "sundial", format: 1, exportedAt: new Date().toISOString(),
    firstCaptureDate: State.app.firstCaptureDate,
    settings: State.app.settings,
    photos: [],
  };
  for (const p of photos) {
    const bytes = new Uint8Array(await p.blob.arrayBuffer());
    files.push({ name: `photos/${p.date}.jpg`, data: bytes });
    const entry = { date: p.date, createdAt: p.createdAt || null, caption: p.caption || "", meta: p.meta || {} };
    if (p.audio) {
      const ext = (p.audioType || "").includes("mp4") ? "m4a" : "webm";
      const aname = `audio/${p.date}.${ext}`;
      files.push({ name: aname, data: new Uint8Array(await p.audio.arrayBuffer()) });
      entry.audioFile = aname; entry.audioType = p.audioType || "audio/webm";
    }
    manifest.photos.push(entry);
  }
  files.unshift({ name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
  const how = await shareOrDownload(zipWrite(files), `sundial-backup-${todayKey()}.zip`, "Sundial backup");
  if (!how) return false;
  State.app.lastBackup = new Date().toISOString();
  await State.save();
  toast(how === "shared" ? "Backup ready. Save it somewhere safe." : "Backup saved to your downloads");
  return true;
}

// restore from a .zip; merges into whatever is already here (fills empty days,
// overwrites matching ones), and pulls the first-capture date back to the earliest.
async function importBackup(file) {
  const entries = await zipRead(file);
  // a re-zipped backup nests everything under a folder; find the manifest anywhere
  const manEntry = entries.find((e) => e.name === "manifest.json" || e.name.endsWith("/manifest.json"));
  if (!manEntry) throw new Error("That isn't a Sundial backup.");
  const prefix = manEntry.name.slice(0, -"manifest.json".length);
  let manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(manEntry.data)); } catch { throw new Error("The backup's index is damaged."); }
  if (manifest.app !== "sundial") throw new Error("That isn't a Sundial backup.");
  const byName = new Map(entries.map((e) => [e.name, e]));
  const valid = (manifest.photos || []).filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m?.date || ""));
  let restored = 0;
  for (const meta of valid) {
    const img = byName.get(`${prefix}photos/${meta.date}.jpg`);
    if (!img) continue;
    // copy bytes so the record's blob doesn't alias the whole archive buffer
    const blob = new Blob([img.data.slice()], { type: "image/jpeg" });
    const rec = { date: meta.date, blob, caption: meta.caption || "", meta: meta.meta || {}, createdAt: meta.createdAt || null };
    if (meta.audioFile) {
      const a = byName.get(prefix + meta.audioFile);
      if (a) { rec.audio = new Blob([a.data.slice()], { type: meta.audioType || "audio/webm" }); rec.audioType = meta.audioType || "audio/webm"; }
    }
    await DB.putPhoto(rec);
    restored++;
  }
  if (!restored) throw new Error("No photos found in that backup.");
  // earliest first-capture wins so the film window covers the whole restored year
  const earliest = valid.map((p) => p.date).sort()[0];
  if (earliest && (!State.app.firstCaptureDate || earliest < State.app.firstCaptureDate)) {
    State.app.firstCaptureDate = earliest;
  }
  State.app.onboarded = true;
  await State.save();
  return restored;
}

/* ---------------------------------------------------------------- tiny helpers */
// One toast at a time, in a single polite live region, so screen readers hear
// it and rapid messages replace each other instead of stacking on one spot.
let toastTimer = null;
function toast(msg, ms = 2600) {
  let host = document.getElementById("toast");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast"; host.className = "toast";
    host.setAttribute("role", "status"); host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  host.textContent = msg;
  host.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => host.classList.remove("show"), ms);
}

// Object URLs for photos shown on a screen. Each re-render revokes the last
// batch, so a long session never accumulates decoded blobs.
const screenUrls = [];
function screenUrl(blob) { const u = URL.createObjectURL(blob); screenUrls.push(u); return u; }
function releaseScreenUrls() { while (screenUrls.length) URL.revokeObjectURL(screenUrls.pop()); }

/* ---------------------------------------------------------------- overlays (a11y) */
// Every overlay (sheet, viewer, camera, player) is a modal: focus moves in,
// Tab stays inside, Escape closes, and focus returns to whatever opened it.
const FOCUSABLE = 'button:not([disabled]):not([hidden]), [href], textarea, input, select, [tabindex]:not([tabindex="-1"])';
const overlayStack = [];
function openOverlay(el, { onClose, initial } = {}) {
  const opener = document.activeElement;
  const entry = { el, onClose, opener };
  overlayStack.push(entry);
  el.setAttribute("aria-modal", "true");
  if (!el.getAttribute("role")) el.setAttribute("role", "dialog");
  app.setAttribute("inert", ""); app.setAttribute("aria-hidden", "true");
  // by default focus the dialog itself: screen readers start at its top and no
  // focus ring flashes on a control the user didn't choose
  if (!initial) el.tabIndex = -1;
  requestAnimationFrame(() => {
    const target = (initial && el.querySelector(initial)) || el;
    target?.focus({ preventScroll: true });
  });
  return () => closeOverlay(entry);
}
function closeOverlay(entry) {
  const i = overlayStack.indexOf(entry);
  if (i < 0) return;
  overlayStack.splice(i, 1);
  if (!overlayStack.length) { app.removeAttribute("inert"); app.removeAttribute("aria-hidden"); }
  if (entry.opener && document.contains(entry.opener)) entry.opener.focus?.({ preventScroll: true });
}
document.addEventListener("keydown", (e) => {
  const top = overlayStack[overlayStack.length - 1];
  if (!top) return;
  if (e.key === "Escape") { e.preventDefault(); top.onClose?.(); return; }
  if (e.key !== "Tab") return;
  const items = [...top.el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1], cur = document.activeElement;
  const outside = cur === top.el || !top.el.contains(cur);
  if (e.shiftKey && (cur === first || outside)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (cur === last || outside)) { e.preventDefault(); first.focus(); }
});

// A bottom sheet: scrim + panel that slides up, closes on scrim tap, Escape,
// or a downward swipe on the panel. Returns { el, sheet, close }.
function openSheet(inner, { label = "Sheet", onClose } = {}) {
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `<div class="sheet" role="dialog" aria-label="${escapeHtml(label)}"><div class="handle" aria-hidden="true"></div>${inner}</div>`;
  document.body.appendChild(bg);
  const sheet = bg.firstElementChild;
  let closed = false, release;
  const close = () => {
    if (closed) return; closed = true;
    release?.();
    bg.classList.add("closing");
    const done = () => { bg.remove(); onClose?.(); };
    sheet.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 400); // reduced motion / no transition fallback
  };
  release = openOverlay(sheet, { onClose: close });
  requestAnimationFrame(() => bg.classList.add("open"));
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  enableSwipeDown(sheet, close);
  return { el: bg, sheet, close };
}

// drag a sheet down to dismiss: tracks the finger 1:1 from where it grabbed,
// and commits on distance OR a quick flick (velocity), else springs back
function enableSwipeDown(sheet, close) {
  let y0 = 0, t0 = 0, dy = 0, dragging = false, id = null;
  sheet.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || id !== null) return;
    if (sheet.scrollTop > 0 || e.target.closest("textarea, input")) return;
    id = e.pointerId; y0 = e.clientY; t0 = performance.now(); dy = 0; dragging = false;
  });
  sheet.addEventListener("pointermove", (e) => {
    if (e.pointerId !== id) return;
    const d = e.clientY - y0;
    if (!dragging) {
      if (d < 10) { if (d < -10) id = null; return; } // hysteresis; upward = scroll
      dragging = true; sheet.setPointerCapture(id); sheet.classList.add("dragging");
    }
    dy = Math.max(0, d - 10);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove("dragging");
    const v = dy / Math.max(1, performance.now() - t0);
    if (dy > sheet.offsetHeight * 0.3 || v > 0.5) close();
    else sheet.style.transform = "";
  };
  sheet.addEventListener("pointerup", end);
  sheet.addEventListener("pointercancel", end);
}

// a calm, in-app confirm (replaces window.confirm, which breaks the mood and
// can't be styled). Resolves true/false.
function confirmSheet({ title, body, ok = "Continue", cancel = "Cancel" }) {
  return new Promise((resolve) => {
    let answer = false;
    const { sheet, close } = openSheet(`
      <h2>${escapeHtml(title)}</h2>
      <p class="muted sheet-body">${escapeHtml(body)}</p>
      <div class="sheet-actions">
        <button class="btn ghost" data-a="no">${escapeHtml(cancel)}</button>
        <button class="btn primary" data-a="yes">${escapeHtml(ok)}</button>
      </div>`, { label: title, onClose: () => resolve(answer) });
    $('[data-a="no"]', sheet).onclick = close;
    $('[data-a="yes"]', sheet).onclick = () => { answer = true; close(); };
  });
}

function svgIcon(name) {
  const p = {
    settings: '<path fill="currentColor" d="M12 8a4 4 0 100 8 4 4 0 000-8zm8.4 4c0-.5 0-1-.1-1.4l2-1.6-2-3.4-2.4 1a7 7 0 00-2.4-1.4l-.4-2.6H10l-.4 2.6a7 7 0 00-2.4 1.4l-2.4-1-2 3.4 2 1.6a7 7 0 000 2.8l-2 1.6 2 3.4 2.4-1a7 7 0 002.4 1.4l.4 2.6h4l.4-2.6a7 7 0 002.4-1.4l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.4z"/>',
    film: '<path fill="currentColor" d="M4 4h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1zm2 2v2h2V6H6zm10 0v2h2V6h-2zM6 10v4h12v-4H6zm0 6v2h2v-2H6zm10 0v2h2v-2h-2z"/>',
    lock: '<path fill="currentColor" d="M6 10V8a6 6 0 1112 0v2h1a1 1 0 011 1v9a1 1 0 01-1 1H5a1 1 0 01-1-1v-9a1 1 0 011-1h1zm2 0h8V8a4 4 0 10-8 0v2z"/>',
    close: '<path fill="currentColor" d="M6.4 5L5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"/>',
    flip: '<path fill="currentColor" d="M12 6V3L8 7l4 4V8a5 5 0 11-5 5H5a7 7 0 107-7z"/>',
    expand: '<path fill="currentColor" d="M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM6 15v3h3v2H4v-5h2zm12 0h2v5h-5v-2h3v-3z"/>',
    edit: '<path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
    grid: '<path fill="none" stroke="currentColor" stroke-width="1.6" d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    sound: '<path fill="currentColor" d="M4 9v6h4l5 5V4L8 9H4zm12.5 3a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4zm-2.5 6.7a7 7 0 000-13.4v2.1a5 5 0 010 9.2v2.1z"/>',
    pause: '<path fill="currentColor" d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
    play: '<path fill="currentColor" d="M8 5.5v13a1 1 0 001.5.86l10.4-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z"/>',
    back: '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/>',
    chevron: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/>',
    look: '<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="currentColor" d="M12 3.8a8.2 8.2 0 010 16.4z" opacity=".55"/>',
    replay: '<path fill="currentColor" d="M12 5V2L7 6l5 4V7a6 6 0 11-6 6H4a8 8 0 108-8z"/>',
    download: '<path fill="currentColor" d="M11 4h2v8.6l3.3-3.3 1.4 1.4L12 16.4l-5.7-5.7 1.4-1.4 3.3 3.3V4zM5 18h14v2H5z"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${p[name] || ""}</svg>`;
}

/* ---------------------------------------------------------------- theme accents */
// The sun/dial hue. Applied as CSS variables so the whole UI (ring, buttons,
// boot sun) recolours together. Default 'amber' matches the base :root theme.
const ACCENTS = {
  amber:  { sun: "#ff9a3d", hot: "#ffd27a", label: "Amber" },
  rose:   { sun: "#ff5d8f", hot: "#ffb0c8", label: "Rose" },
  teal:   { sun: "#22c3a6", hot: "#8ef0dd", label: "Teal" },
  violet: { sun: "#9b7bff", hot: "#cbb8ff", label: "Violet" },
  sky:    { sun: "#3d9dff", hot: "#a8d4ff", label: "Sky" },
};
function applyAccent(key) {
  const a = ACCENTS[key] || ACCENTS.amber;
  const r = document.documentElement.style;
  r.setProperty("--sun", a.sun);
  r.setProperty("--sun-hot", a.hot);
}

/* ---------------------------------------------------------------- film looks */
// A colour grade baked into the shot at capture. It's permanent — like the
// one-shot rule itself, you commit to how the day looks. The preview shows it
// live (WYSIWYG). css = filter string for preview + modern canvas; the pixel
// fallback covers older iOS Safari, which has no canvas ctx.filter.
// grain = ± noise per channel; vignette = corner-darkening strength; halo = highlight bloom
const FILM_LOOKS = {
  none: { label: "None", css: "none", grain: 0, vignette: 0, halo: 0 },
  warm: { label: "Warm", css: "saturate(1.16) contrast(1.05) sepia(.18) brightness(1.02)", grain: 6, vignette: 0.18, halo: 0.14 },
  cool: { label: "Cool", css: "saturate(1.05) contrast(1.06) brightness(1.02) hue-rotate(-10deg)", grain: 5, vignette: 0.18, halo: 0.08 },
  mono: { label: "Mono", css: "grayscale(1) contrast(1.08) brightness(1.04)", grain: 10, vignette: 0.22, halo: 0.10 },
  fade: { label: "Fade", css: "contrast(.9) saturate(.82) brightness(1.09) sepia(.08)", grain: 8, vignette: 0.26, halo: 0.12 },
};
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
let CTX_FILTER_OK = null;
function ctxFilterSupported() {
  if (CTX_FILTER_OK !== null) return CTX_FILTER_OK;
  try {
    const x = document.createElement("canvas").getContext("2d");
    x.filter = "grayscale(1)"; CTX_FILTER_OK = x.filter === "grayscale(1)";
  } catch { CTX_FILTER_OK = false; }
  return CTX_FILTER_OK;
}
function lookCss(key) { const l = FILM_LOOKS[key]; return l && l.css !== "none" ? l.css : ""; }
// per-pixel approximation of each look, for browsers without canvas ctx.filter
function applyLookPixels(ctx, w, h, key) {
  if (key === "none" || !FILM_LOOKS[key]) return;
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (key === "mono") { const l = 0.299 * r + 0.587 * g + 0.114 * b; r = g = b = clamp((l - 128) * 1.08 + 128 + 10); }
    else if (key === "warm") { r = clamp(r * 1.08 + 8); g = clamp(g * 1.02); b = clamp(b * 0.9); }
    else if (key === "cool") { r = clamp(r * 0.92); b = clamp(b * 1.1 + 6); }
    else if (key === "fade") { r = clamp(r * 0.9 + 22); g = clamp(g * 0.9 + 20); b = clamp(b * 0.9 + 16); }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(img, 0, 0);
}

// After the colour grade, add the analog finish: grain → highlight bloom →
// vignette → optional light leak. All on-device; makes a grade read as "film".
function finishGrade(cctx, canvas, lookKey, settings) {
  const look = FILM_LOOKS[lookKey] || FILM_LOOKS.none;
  const w = canvas.width, h = canvas.height;
  // film grain — a fine per-pixel noise
  if (look.grain) {
    const img = cctx.getImageData(0, 0, w, h), d = img.data, amt = look.grain;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * amt * 2;
      d[i] = clamp8(d[i] + n); d[i + 1] = clamp8(d[i + 1] + n); d[i + 2] = clamp8(d[i + 2] + n);
    }
    cctx.putImageData(img, 0, 0);
  }
  // halation / bloom — a blurred, screen-blended copy that lifts the highlights
  if (look.halo && ctxFilterSupported()) {
    const tmp = document.createElement("canvas"); tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext("2d");
    tctx.filter = `brightness(1.6) blur(${Math.max(2, Math.round(Math.max(w, h) * 0.006))}px)`;
    tctx.drawImage(canvas, 0, 0);
    cctx.save(); cctx.globalCompositeOperation = "screen"; cctx.globalAlpha = look.halo;
    cctx.drawImage(tmp, 0, 0); cctx.restore();
  }
  // vignette — soft corner darkening
  if (look.vignette) {
    const g = cctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${look.vignette})`);
    cctx.fillStyle = g; cctx.fillRect(0, 0, w, h);
  }
  // optional light leak — random by nature, like a real over-exposed roll
  if (settings.lightLeaks) drawLightLeak(cctx, w, h);
}

function drawLightLeak(cctx, w, h) {
  const corner = Math.floor(Math.random() * 4);
  const cx = corner % 2 === 0 ? 0 : w, cy = corner < 2 ? 0 : h;
  const rad = Math.max(w, h) * (0.5 + Math.random() * 0.4);
  const hue = 18 + Math.random() * 30; // warm orange → red
  const g = cctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
  g.addColorStop(0, `hsla(${hue}, 100%, 60%, ${(0.2 + Math.random() * 0.14).toFixed(3)})`);
  g.addColorStop(0.5, `hsla(${hue}, 100%, 55%, 0.06)`);
  g.addColorStop(1, "hsla(40, 100%, 50%, 0)");
  cctx.save(); cctx.globalCompositeOperation = "screen"; cctx.fillStyle = g; cctx.fillRect(0, 0, w, h); cctx.restore();
}

// baked-in retro date stamp, bottom-right (the disposable-camera signature)
function drawDateStamp(cctx, w, h, date) {
  const s = `'${String(date.getFullYear()).slice(-2)} ${date.getMonth() + 1} ${pad(date.getDate())}`;
  const size = Math.round(Math.max(w, h) * 0.032);
  const inset = Math.round(size * 0.9);
  cctx.save();
  cctx.font = `700 ${size}px "Courier New", ui-monospace, monospace`;
  cctx.textAlign = "right"; cctx.textBaseline = "alphabetic";
  cctx.shadowColor = "rgba(255,120,0,.85)"; cctx.shadowBlur = size * 0.55;
  cctx.fillStyle = "#ff9a3d";
  cctx.fillText(s, w - inset, h - inset);
  cctx.restore();
}
// the same stamp text for the live preview overlay
function dateStampText(date = new Date()) {
  return `'${String(date.getFullYear()).slice(-2)} ${date.getMonth() + 1} ${pad(date.getDate())}`;
}

/* wrap a string to N canvas lines, ellipsising the overflow */
function wrapText(ctx, text, maxWidth, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur); cur = w;
      if (lines.length === maxLines) break;
    } else { cur = test; }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  // if there was more text than fits, mark the last line with an ellipsis
  const consumed = lines.join(" ").split(/\s+/).length;
  if (consumed < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

/* escape user text before it touches innerHTML (captions) */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* build the ambient one-liner shared by home cards, viewer & film */
function ambientLine(meta) {
  const m = meta || {};
  return [
    m.tempC != null ? `${m.weatherGlyph || ""} ${m.tempC}°`.trim() : (m.weatherText || ""),
    m.city, m.moon ? `${m.moon.glyph} ${m.moon.name}` : "",
  ].filter(Boolean).join("   ·   ");
}

/* persist / amend a caption without disturbing the sealed image or ambient meta */
async function saveCaption(dateKey, text) {
  await DB.updatePhoto(dateKey, (rec) => { rec.caption = (text || "").trim(); });
}

/* a warm time-of-day greeting for the home header */
function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
}

/* a light haptic tick on meaningful taps (Android; a no-op on iOS Safari) */
function haptic(ms = 8) { try { navigator.vibrate?.(ms); } catch {} }

/* ================================================================ RENDER ROOT */
let view = "home", lastView = null;
async function render() {
  clearInterval(homeTimer);
  releaseScreenUrls();
  // the entrance fade plays only when the screen actually changes, never on a
  // same-screen refresh (toggles, returning to the app, closing the viewer)
  const entering = view !== lastView;
  lastView = State.app.onboarded ? view : "onboarding";
  if (!State.app.onboarded) renderOnboarding();
  else if (view === "film") await renderFilm();
  else await renderHome();
  if (entering) app.querySelector(".screen")?.classList.add("enter");
}
function go(next) { view = next; render(); window.scrollTo(0, 0); }

/* ---------------------------------------------------------------- ONBOARDING */
function renderOnboarding() {
  app.innerHTML = `
  <div class="screen onboarding">
    <div class="ob-hero">
      <div class="boot-sun lg" aria-hidden="true"></div>
      <h1>Sundial</h1>
      <p class="muted lede">One honest photo a day. No feed, no likes, no do-overs. At the end of the year, your days become a film.</p>
    </div>
    <ul class="rules">
      <li class="rule"><span class="r-ico" aria-hidden="true">☀️</span><div><b>One shot a day</b><p>One tap. It can't be retaken, deleted or replaced. Choose your moment.</p></div></li>
      <li class="rule"><span class="r-ico" aria-hidden="true">⏳</span><div><b>The window closes at midnight</b><p>Miss a day and it becomes a black frame with the date. The gaps stay honest.</p></div></li>
      <li class="rule"><span class="r-ico" aria-hidden="true">🎞️</span><div><b>Sealed until it's done</b><p>You can't rewatch your year until all 365 days close. You're building it blind.</p></div></li>
      <li class="rule"><span class="r-ico" aria-hidden="true">🌘</span><div><b>Quietly remembers</b><p>Weather, city and moon phase ride along with each frame, surfacing only in the film.</p></div></li>
    </ul>
    <div class="ob-actions">
      <button class="btn primary block" id="start">Begin</button>
      <button class="btn quiet block" id="obRestore">I have a backup</button>
      <p class="tiny faint ob-note">Your phone will ask for camera and location when you take your first photo. Location only adds the weather and city to each frame. Photos never leave this device.</p>
    </div>
  </div>`;
  const begin = async () => {
    State.app.onboarded = true;
    await State.save();
    try { await navigator.storage?.persist?.(); } catch {}
    go("home");
  };
  $("#start").onclick = begin;
  $("#obRestore").onclick = () => pickBackup(() => go("home"));
}

/* ---------------------------------------------------------------- HOME / TODAY */
let homeTimer = null, renderedDay = null;
// re-render when the date rolls over while the app sits open (midnight)
function checkRollover() { if (renderedDay && todayKey() !== renderedDay && !overlayStack.length) render(); }

// the most recent revealed year the user hasn't watched yet, if any
function unwatchedFilm() {
  return revealedCycles().find((c) => !State.app.watched.includes(c) && !State.app.settings.devPreview) ?? null;
}

async function renderHome() {
  const now = new Date();
  const tKey = todayKey();
  renderedDay = tKey;
  const shotToday = await DB.getPhoto(tKey);
  const onThisDay = State.app.firstCaptureDate ? await photosOnThisDay() : [];
  const ready = unwatchedFilm();

  app.innerHTML = `
  <div class="screen" id="home">
    <header class="topbar">
      <div class="date">
        <span class="kicker">${greeting(now)}</span>
        <h1>${prettyDate(now)}</h1>
      </div>
      <div class="topbar-actions">
        <button class="iconbtn ${ready != null ? "badge" : ""}" id="toFilm" aria-label="Your film${ready != null ? " (ready to watch)" : ""}">${svgIcon("film")}</button>
        <button class="iconbtn" id="toSettings" aria-label="Settings">${svgIcon("settings")}</button>
      </div>
    </header>
    <main class="home-main">
      ${ready != null ? `<button class="ready-banner" id="readyBanner">
          <span class="boot-sun sm" aria-hidden="true"></span>
          <span><b>Your ${cycleLabel(ready)} film is ready</b><span class="tiny">Every day of the year, in one sitting.</span></span>
          <span class="rb-go" aria-hidden="true">${svgIcon("chevron")}</span>
        </button>` : ""}
      <div id="lowstore"></div>
      <div id="ly"></div>
      <div id="core"></div>
      <div id="strip"></div>
    </main>
  </div>`;

  $("#toFilm").onclick = () => go("film");
  $("#toSettings").onclick = openSettings;
  if (ready != null) $("#readyBanner").onclick = () => go("film");

  // This-day-in-past-years peek: the closest prior year as a big card, older
  // years as a small strip beneath it.
  const ly = $("#ly");
  if (onThisDay.length) {
    const primary = onThisDay[0];
    const rest = onThisDay.slice(1);
    const m = primary.rec.meta || {};
    const bits = [m.weatherGlyph && `${m.weatherGlyph} ${m.tempC != null ? m.tempC + "°" : ""}`, m.city, m.moon?.glyph].filter(Boolean).join("  ·  ");
    ly.innerHTML = `
      <button class="lastyear" id="lyCard" aria-label="Open your photo from ${escapeHtml(yearsAgoLabel(primary.yearsAgo).toLowerCase())}">
        <span class="ly-label">${yearsAgoLabel(primary.yearsAgo)}</span>
        <span class="ly-expand" aria-hidden="true">${svgIcon("expand")}</span>
        <img class="ly-img" src="${screenUrl(primary.rec.blob)}" alt="" />
        <span class="ly-meta">
          ${primary.rec.caption ? `<span class="ly-cap">${escapeHtml(primary.rec.caption)}</span>` : ""}
          ${bits ? `<span class="ly-bits">${bits}</span>` : ""}
        </span>
      </button>
      ${rest.length ? `<div class="ly-more" id="lyMore">${rest.map((o, i) =>
        `<button class="ly-thumb" data-i="${i}" aria-label="Open your photo from ${escapeHtml(yearsAgoLabel(o.yearsAgo).toLowerCase())}"><img src="${screenUrl(o.rec.blob)}" alt=""/><span>${o.yearsAgo}y</span></button>`).join("")}</div>` : ""}`;
    $("#lyCard").onclick = () => openViewer(primary.rec, { kicker: yearsAgoLabel(primary.yearsAgo).replace(" today", "") });
    if (rest.length) $("#lyMore").querySelectorAll(".ly-thumb").forEach((btn) => {
      const o = rest[+btn.dataset.i];
      btn.onclick = () => openViewer(o.rec, { kicker: yearsAgoLabel(o.yearsAgo).replace(" today", "") });
    });
  } else if (!shotToday) {
    ly.innerHTML = `<div class="lastyear empty"><div class="ly-empty"><span aria-hidden="true">🌱</span><p>A year from now, today's shot will greet you here.</p></div></div>`;
  }

  const core = $("#core");
  if (shotToday) {
    core.innerHTML = `
      <section class="done-state" aria-label="Today's photo">
        <button class="done-thumb-wrap" id="viewToday" aria-label="Open today's photo">
          <img class="done-thumb" src="${screenUrl(shotToday.blob)}" alt=""/>
          <span class="done-expand" aria-hidden="true">${svgIcon("expand")}</span>
        </button>
        <h2>That's today.</h2>
        ${shotToday.caption ? `<p class="done-cap">“${escapeHtml(shotToday.caption)}”</p>` : ""}
        <p class="muted tiny done-seal">${sealMessage()}</p>
        <div class="done-actions">
          <button class="btn ghost" id="capBtn">${svgIcon("edit")}${shotToday.caption ? "Edit caption" : "Add caption"}</button>
          <button class="btn ghost" id="save">${svgIcon("download")}Save to Photos</button>
        </div>
      </section>`;
    const openToday = (editNow) => openViewer(shotToday, { kicker: "Today", editNow });
    $("#viewToday").onclick = () => openToday(false);
    $("#capBtn").onclick = () => openToday(true);
    $("#save").onclick = () => saveToGallery(shotToday.blob, shotToday.date);
    homeTimer = setInterval(checkRollover, 20000);
  } else {
    // the daily dial: fills as the day elapses, sun marker rides the edge
    core.innerHTML = `
      <section class="window" id="win" aria-label="Today's window">
        <div class="ring-wrap">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="var(--sun-hot)"/><stop offset="1" stop-color="var(--sun)"/>
              </linearGradient>
            </defs>
            <circle class="ring-bg" cx="60" cy="60" r="52"/>
            <circle class="ring-fg" id="ringFg" cx="60" cy="60" r="52" pathLength="1000"/>
            <g class="ring-tip-g" id="ringTipG"><circle class="ring-tip" cx="112" cy="60" r="5"/></g>
          </svg>
          <div class="ring-center" role="timer" aria-live="off">
            <div class="rc-time" id="left">–</div>
            <div class="lbl">left today</div>
          </div>
        </div>
        <p class="muted tiny win-text" id="wintext"></p>
        <button class="shutter" id="shutter">Take today's photo</button>
        <p class="tiny faint">One tap. No retakes.</p>
      </section>`;
    $("#shutter").onclick = () => { haptic(6); openCapture(); };
    tickWindow();
    // enable the dial's easing only after the first paint, so it doesn't sweep
    // in from empty every time the screen renders
    requestAnimationFrame(() => requestAnimationFrame(() => $("#win")?.classList.add("live")));
    homeTimer = setInterval(tickWindow, 1000);
  }

  // year strip: dots only, no images, so the year stays sealed
  const strip = $("#strip");
  if (State.app.settings.showStrip && State.app.firstCaptureDate) {
    const { total, cycle } = filmRange();
    const days = await buildTimeline(cycle);
    const shot = days.filter((d) => d.status === "shot").length;
    const missed = days.filter((d) => d.status === "missed").length;
    const dayNum = days.findIndex((d) => d.date === tKey) + 1;
    strip.innerHTML = `
      <section class="strip" aria-label="Your year so far">
        <div class="strip-head">
          <span class="kicker">${cycle > 0 ? `Year ${cycle + 1} · ` : ""}Day ${dayNum || "—"} of ${total}</span>
          <span class="tiny faint">${shot} captured · ${missed} missed</span>
        </div>
        <div class="dotgrid" role="img" aria-label="${shot} days captured, ${missed} missed, ${Math.max(0, total - dayNum)} to go">${days.map((d) => `<span class="dot ${d.status === "shot" ? "shot" : d.status === "missed" ? "missed" : ""} ${d.date === tKey ? "today" : ""}"></span>`).join("")}</div>
      </section>`;
  }

  // storage-low nudge: surfaces only when space is tight, points to a backup
  checkStorage().then((w) => {
    const host = $("#lowstore");
    if (!host || !w) return;
    host.innerHTML = `<div class="lowstore" role="alert"><div><b>Storage is running low</b><p class="tiny">Only ${Math.max(0, Math.round(w.freeMB))} MB free. Back up so a year is never lost.</p></div><button class="pill" id="lowBackup">Back up</button></div>`;
    $("#lowBackup").onclick = async () => { haptic(6); try { await exportBackup(); } catch { toast("Backup failed. Please try again."); } };
  });
}

function sealMessage() {
  const ready = unwatchedFilm();
  if (ready != null) return `Your ${cycleLabel(ready)} film is ready to watch.`;
  if (isSealed()) {
    const { reveal } = filmRange();
    const days = Math.max(0, daysBetween(new Date(), reveal));
    return `Sealed. Your film unlocks in ${days} day${days === 1 ? "" : "s"}. See you tomorrow.`;
  }
  return "Your year is complete. The film is ready to watch.";
}

function tickWindow() {
  const left = $("#left"), ring = $("#ringFg"), tipG = $("#ringTipG"), txt = $("#wintext"), win = $("#win");
  if (!left) return;
  if (todayKey() !== renderedDay) { checkRollover(); return; }
  const now = new Date();
  const msLeft = nextMidnight() - now;
  const hrs = Math.floor(msLeft / 3600000);
  const mins = Math.floor((msLeft % 3600000) / 60000);
  const secs = Math.floor((msLeft % 60000) / 1000);

  // adaptive, live readout: seconds surface only in the final hour so it feels
  // calm through the day and quietly urgent as the window closes.
  left.textContent = hrs >= 1 ? `${hrs}h ${pad(mins)}m` : mins >= 1 ? `${mins}m ${pad(secs)}s` : `${secs}s`;
  left.parentElement.setAttribute("aria-label", hrs >= 1 ? `${hrs} hours ${mins} minutes left today` : `${mins} minutes left today`);

  // arc FILLS as the day elapses, like the sun tracking across the sky
  const elapsed = Math.min(1, Math.max(0, (DAY_MS - msLeft) / DAY_MS));
  ring.style.strokeDasharray = "1000";
  ring.style.strokeDashoffset = String(1000 * (1 - elapsed));
  // the sun marker rides the leading edge; rotating a group keeps it on the arc
  tipG.style.transform = `rotate(${(elapsed * 360).toFixed(3)}deg)`;

  // layered urgency: calm, urgent (<3h), critical (<1h)
  win.classList.toggle("urgent", hrs < 3);
  win.classList.toggle("critical", hrs < 1);
  if (hrs < 1) txt.textContent = `Under an hour before today locks for good.`;
  else if (hrs < 3) txt.textContent = `The window is closing. ${hrs}h ${pad(mins)}m until midnight.`;
  else if (hrs < 8) txt.textContent = `A quiet part of the day. ${hrs} hours left to capture it.`;
  else txt.textContent = `Plenty of day ahead. Wait for the moment that matters.`;
}

/* ---------------------------------------------------------------- CAPTURE */
// The viewfinder is the same 4:5 frame the film, poster and home cards use, and
// the shot is cropped to exactly what it shows (WYSIWYG, grade included).
let stream = null, facing = "environment", currentLens = "1", backLenses = {}, capturing = false, committed = false;
let releaseCapture = null;
async function openCapture() {
  // guard: never allow a second shot
  if (await DB.hasPhoto(todayKey())) { toast("Today already has its photo."); render(); return; }
  const s = State.app.settings;

  const el = document.createElement("div");
  el.className = "capture"; el.id = "capture";
  el.setAttribute("aria-label", "Camera");
  el.innerHTML = `
    <div class="cap-top">
      <button class="x" id="cancel" aria-label="Close camera">${svgIcon("close")}</button>
      <span class="cap-title">One shot · no retake</span>
      <button class="x ${s.showGrid ? "on" : ""}" id="gridToggle" aria-label="Framing grid" aria-pressed="${s.showGrid}">${svgIcon("grid")}</button>
    </div>
    <div class="cap-stage">
      <div class="cap-frame" id="frame">
        <video id="cam" autoplay muted playsinline aria-hidden="true"></video>
        <div class="cap-vignette" id="capVig" aria-hidden="true"></div>
        <div class="cap-grid" id="capGrid" ${s.showGrid ? "" : "hidden"} aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="cap-datestamp" id="capStamp" ${s.dateStamp ? "" : "hidden"} aria-hidden="true">${dateStampText()}</div>
        <div class="cap-hint" id="hint" role="status">Waking the camera…</div>
      </div>
    </div>
    <div class="cap-controls">
      <p class="cap-warn">This becomes your photo for <b>${prettyDate(new Date())}</b></p>
      <div class="cap-pickers">
        <div class="look-strip" id="lookStrip" role="radiogroup" aria-label="Film look" hidden>${Object.entries(FILM_LOOKS).map(([k, l]) =>
          `<button class="look-chip ${s.filmLook === k ? "on" : ""}" role="radio" aria-checked="${s.filmLook === k}" data-k="${k}">${l.label}</button>`).join("")}</div>
        <div class="lens-row" id="lensRow" hidden></div>
      </div>
      <div class="cap-actionbar">
        <button class="look-btn ${s.filmLook !== "none" ? "on" : ""}" id="lookBtn" aria-expanded="false" aria-controls="lookStrip" aria-label="Film look: ${FILM_LOOKS[s.filmLook]?.label || "None"}">${svgIcon("look")}<span id="lookName">${s.filmLook === "none" ? "Look" : FILM_LOOKS[s.filmLook].label}</span></button>
        <button class="shutter-btn" id="snap" aria-label="Take the photo. This can't be undone." disabled></button>
        <button class="flip-btn" id="flip" aria-label="Switch camera">${svgIcon("flip")}</button>
      </div>
    </div>
    <div class="flash" id="flash" aria-hidden="true"></div>`;
  document.body.appendChild(el);
  releaseCapture = openOverlay(el, { onClose: () => { if (!capturing) closeCapture(); } });

  // start fresh each session: rear camera at 1x until we learn the lenses
  facing = "environment"; currentLens = "1"; backLenses = {}; capturing = false; committed = false;
  applyLookPreview();

  $("#cancel").onclick = closeCapture;
  $("#gridToggle").onclick = async () => {
    const on = !s.showGrid;
    s.showGrid = on;
    $("#capGrid").hidden = !on;
    const g = $("#gridToggle"); g.classList.toggle("on", on); g.setAttribute("aria-pressed", on);
    haptic(6); await State.save();
  };
  $("#lookBtn").onclick = () => {
    const strip = $("#lookStrip"), open = strip.hidden;
    strip.hidden = !open;
    $("#lookBtn").setAttribute("aria-expanded", open);
    haptic(6);
  };
  $("#lookStrip").querySelectorAll(".look-chip").forEach((chip) => {
    chip.onclick = async () => {
      s.filmLook = chip.dataset.k;
      $("#lookStrip").querySelectorAll(".look-chip").forEach((o) => { o.classList.toggle("on", o === chip); o.setAttribute("aria-checked", o === chip); });
      const label = FILM_LOOKS[s.filmLook].label;
      $("#lookName").textContent = s.filmLook === "none" ? "Look" : label;
      $("#lookBtn").classList.toggle("on", s.filmLook !== "none");
      $("#lookBtn").setAttribute("aria-label", `Film look: ${label}`);
      applyLookPreview(); haptic(6); await State.save();
    };
  });
  $("#flip").onclick = async () => {
    facing = facing === "environment" ? "user" : "environment";
    currentLens = "1"; // zoom is a rear-camera notion; reset on flip
    haptic(6);
    await startCam();
  };
  $("#snap").onclick = commitShot;
  await startCam();
}

// live preview of the chosen grade: the colour filter on the video plus the
// vignette as an overlay (grain and bloom only exist in the saved frame)
function applyLookPreview() {
  const key = State.app.settings.filmLook;
  const video = $("#cam"), vig = $("#capVig");
  if (video) video.style.filter = lookCss(key);
  if (vig) vig.style.opacity = String((FILM_LOOKS[key]?.vignette || 0) * 2.6);
}

async function startCam() {
  const video = $("#cam"), hint = $("#hint"), snap = $("#snap");
  if (!video) return;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  snap.disabled = true;
  if (!navigator.mediaDevices?.getUserMedia) return camBlocked("This browser can't open the camera. Open Sundial in Safari or Chrome over https.");
  const base = { width: { ideal: 2560 }, height: { ideal: 2560 } };
  // prefer the exact lens (e.g. the ultra-wide for 0.5x) when we know it
  const deviceId = facing === "environment" ? backLenses[currentLens] : null;
  const primary = deviceId
    ? { video: { deviceId: { exact: deviceId }, ...base }, audio: false }
    : { video: { facingMode: { ideal: facing }, ...base }, audio: false };
  try {
    stream = await navigator.mediaDevices.getUserMedia(primary);
  } catch {
    // a stale deviceId (lens no longer available): fall back to facingMode
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, ...base }, audio: false });
    } catch (e2) {
      return camBlocked(e2?.name === "NotAllowedError"
        ? "Camera access is off. Allow it for this site in your browser's settings, then try again."
        : "The camera couldn't start. Close other apps using it, then try again.");
    }
  }
  if (!$("#cam")) { stream.getTracks().forEach((t) => t.stop()); return; } // closed while waiting
  video.srcObject = stream;
  // if the OS takes the camera away (app backgrounded, a call), offer a restart
  stream.getVideoTracks()[0]?.addEventListener("ended", () => { if ($("#capture") && !committed) camBlocked("The camera stopped.", "Restart camera"); });
  // mirror the front camera so the preview reads like a mirror
  video.classList.toggle("mirror", facing === "user");
  applyLookPreview();
  hint.hidden = true; hint.textContent = "";
  snap.disabled = false;
  await discoverLenses();
  updateLensUI();
}

function camBlocked(msg, cta = "Try again") {
  const hint = $("#hint");
  if (!hint) return;
  hint.hidden = false;
  hint.innerHTML = `<span>${escapeHtml(msg)}</span><button class="btn sm glass-btn" id="camRetry">${cta}</button>`;
  $("#snap").disabled = true;
  $("#camRetry").onclick = () => { hint.textContent = "Waking the camera…"; startCam(); };
}

/* enumerate the rear lenses once permission is granted so 0.5x can map to the
   ultra-wide camera. Labels are only populated after getUserMedia succeeds. */
async function discoverLenses() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    const back = devs.filter((d) => /back|rear|environment/i.test(d.label));
    const pool = back.length ? back : devs;
    const ultra = pool.find((d) => /ultra|0\.5|wide angle/i.test(d.label));
    const main = pool.find((d) => /back camera|wide/i.test(d.label) && !/ultra|tele/i.test(d.label));
    const next = {};
    if (ultra) next["0.5"] = ultra.deviceId;
    next["1"] = (main || back[0] || {}).deviceId || backLenses["1"] || null;
    backLenses = next;
  } catch {}
}

/* draw the lens pills, only meaningful when a 0.5x (ultra-wide) lens exists */
function updateLensUI() {
  const row = $("#lensRow");
  if (!row) return;
  const show = facing === "environment" && !!backLenses["0.5"];
  row.hidden = !show;
  if (!show) { row.innerHTML = ""; return; }
  const opts = [["0.5", "0.5×"], ["1", "1×"]];
  row.innerHTML = opts.map(([z, l]) => `<button class="lens-pill ${currentLens === z ? "on" : ""}" data-z="${z}" aria-pressed="${currentLens === z}" aria-label="${l} zoom">${l}</button>`).join("");
  row.querySelectorAll(".lens-pill").forEach((btn) => {
    btn.onclick = async () => {
      if (currentLens === btn.dataset.z) return;
      currentLens = btn.dataset.z; haptic(6); await startCam();
    };
  });
}

async function commitShot() {
  const video = $("#cam"), snap = $("#snap");
  if (!video || capturing) return;
  // camera may still be warming up (e.g. just after a lens flip): wait for a frame
  if (!video.videoWidth) {
    await new Promise((res) => {
      let done = false; const fin = () => { if (!done) { done = true; res(); } };
      video.addEventListener("loadeddata", fin, { once: true });
      setTimeout(fin, 1200);
    });
    if (!video.videoWidth) return; // still nothing: bail quietly, shutter stays live
  }
  capturing = true;
  snap.disabled = true;
  haptic(16);

  // crop the centre 4:5 of the native frame, exactly what the viewfinder shows
  const vw = video.videoWidth, vh = video.videoHeight;
  let cw = vw, ch = vh;
  if (vw / vh > CONFIG.ASPECT) cw = Math.round(vh * CONFIG.ASPECT); else ch = Math.round(vw / CONFIG.ASPECT);
  const sx = Math.round((vw - cw) / 2), sy = Math.round((vh - ch) / 2);
  const scale = Math.min(1, CONFIG.PHOTO_MAX_DIM / Math.max(cw, ch));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cw * scale); canvas.height = Math.round(ch * scale);
  const cctx = canvas.getContext("2d");
  // bake in the chosen film look: via canvas filter where supported, else pixels
  const look = State.app.settings.filmLook || "none";
  const useCtxFilter = look !== "none" && ctxFilterSupported();
  if (useCtxFilter) cctx.filter = lookCss(look);
  // mirror the front camera so the saved frame matches the mirrored preview
  if (facing === "user") { cctx.translate(canvas.width, 0); cctx.scale(-1, 1); }
  cctx.drawImage(video, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
  cctx.filter = "none";
  cctx.setTransform(1, 0, 0, 1, 0, 0); // drop any mirror so effects & stamp draw upright
  if (look !== "none" && !useCtxFilter) applyLookPixels(cctx, canvas.width, canvas.height, look);
  // analog finish (grain/bloom/vignette/leak) then the retro date stamp, all baked in
  finishGrade(cctx, canvas, look, State.app.settings);
  if (State.app.settings.dateStamp) drawDateStamp(cctx, canvas.width, canvas.height, new Date());

  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", CONFIG.JPEG_QUALITY));
  if (!blob) {
    capturing = false; snap.disabled = false;
    toast("Couldn't save that frame. Please try again.");
    return;
  }
  const dateKey = todayKey();

  // commit immediately: no confirm, no retake. This is the whole point.
  const rec = { date: dateKey, blob, meta: { moon: moonPhase(new Date()) }, createdAt: new Date().toISOString() };
  try {
    await DB.addPhoto(rec);
  } catch (e) {
    capturing = false;
    closeCapture();
    toast(e?.name === "ConstraintError" ? "Today already has its photo." : "Couldn't save the photo. Is storage full?");
    render();
    return;
  }
  committed = true;
  if (!State.app.firstCaptureDate) { State.app.firstCaptureDate = dateKey; await State.save(); }

  // flash, then freeze the frame in place
  $("#flash").classList.add("go");
  const frozen = document.createElement("canvas");
  frozen.className = "frozen"; frozen.width = canvas.width; frozen.height = canvas.height;
  frozen.getContext("2d").drawImage(canvas, 0, 0);
  $("#frame").appendChild(frozen);
  video.style.visibility = "hidden";
  if (stream) stream.getTracks().forEach((t) => t.stop());

  // ambient metadata resolves in the background and merges into the record
  fetchAmbient().then((meta) =>
    DB.updatePhoto(dateKey, (r) => { r.meta = Object.assign(r.meta || {}, meta); })
  ).catch(() => {});

  // optional: capture a few seconds of the moment's sound (viewer playback only)
  if (State.app.settings.captureSound) recordMoment(dateKey).catch(() => {});

  // done panel over the frozen frame
  const panel = document.createElement("div");
  panel.className = "commit";
  panel.innerHTML = `
    <p class="warn" role="status">Kept. This is <b>${prettyDate(new Date())}</b>.<br><span class="tiny">Sealed into your year.</span></p>
    <label class="sr-only" for="commitCap">Caption</label>
    <textarea class="commit-cap" id="commitCap" maxlength="180" rows="2" placeholder="Add a caption (optional)" enterkeyhint="done"></textarea>
    <div class="row">
      <button class="btn ghost on-dark" id="gallery">${svgIcon("download")}Save to Photos</button>
      <button class="btn primary" id="done">Done</button>
    </div>`;
  $("#capture").appendChild(panel);
  $("#capture").classList.add("committed");
  const finish = async () => {
    const text = $("#commitCap")?.value.trim();
    if (text) await saveCaption(dateKey, text);
    closeCapture(); // re-renders home, since the day is now taken
  };
  $("#gallery").onclick = () => saveToGallery(blob, dateKey);
  $("#done").onclick = finish;
  $("#commitCap").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finish(); } });
  // swap the overlay's Escape so it saves the caption rather than discarding it
  overlayStack[overlayStack.length - 1].onClose = finish;
  $("#done").focus({ preventScroll: true });
}

function closeCapture() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  capturing = false;
  const el = $("#capture");
  releaseCapture?.(); releaseCapture = null;
  el?.remove();
  if (committed) { committed = false; render(); }
  renderUpdateBanner();
}

/* ---------------------------------------------------------------- FULL-SCREEN VIEWER */
// Opens a single photo full-bleed with its date, ambient meta and caption.
// Tap the photo to hide or show the chrome, like Photos. The caption can be
// added or amended in place. `opts.kicker` is the small label above the date;
// `opts.editNow` opens straight into caption editing.
function openViewer(rec, opts = {}) {
  if (!rec || !rec.blob) return;
  const d = parseKey(rec.date);
  const url = URL.createObjectURL(rec.blob);
  const bits = ambientLine(rec.meta);
  const startCaption = rec.caption || "";

  const el = document.createElement("div");
  el.className = "viewer"; el.id = "viewer";
  el.setAttribute("aria-label", `Photo from ${prettyDate(d)}`);
  el.innerHTML = `
    <img class="v-img" src="${url}" alt="${escapeHtml(rec.caption || `Your photo from ${shortDate(d)}`)}" />
    <div class="v-top">
      <button class="iconbtn glass" id="vClose" aria-label="Close">${svgIcon("close")}</button>
      <div class="v-date"><span class="kicker">${escapeHtml(opts.kicker || "Captured")}</span><b>${prettyDate(d)}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ""}</b></div>
      <button class="iconbtn glass" id="vSave" aria-label="Save to Photos">${svgIcon("download")}</button>
    </div>
    <div class="v-bottom">
      ${rec.audio ? `<button class="v-sound" id="vSound" aria-label="Play the moment's sound"><span class="vs-ico" aria-hidden="true">${svgIcon("sound")}</span><span class="vs-txt">Play the moment</span></button>` : ""}
      ${bits ? `<div class="v-meta">${bits}</div>` : ""}
      <div class="v-cap" id="vCap"></div>
    </div>`;
  document.body.appendChild(el);

  // the moment's ambient sound: plays in full here (never in the montage film)
  let audioEl = null, audioUrl = null;
  if (rec.audio) {
    const btn = $("#vSound", el);
    audioUrl = URL.createObjectURL(rec.audio);
    audioEl = new Audio(audioUrl);
    const setIcon = (playing) => {
      btn.querySelector(".vs-ico").innerHTML = svgIcon(playing ? "pause" : "sound");
      btn.querySelector(".vs-txt").textContent = playing ? "Playing…" : "Play the moment";
      btn.setAttribute("aria-label", playing ? "Pause the moment's sound" : "Play the moment's sound");
    };
    audioEl.onended = () => setIcon(false);
    btn.onclick = (e) => {
      e.stopPropagation();
      if (audioEl.paused) { audioEl.play().then(() => setIcon(true)).catch(() => {}); }
      else { audioEl.pause(); setIcon(false); }
    };
  }

  let closed = false, release;
  const close = () => {
    if (closed) return; closed = true;
    release?.();
    if (audioEl) { audioEl.pause(); audioEl.src = ""; }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    el.classList.add("out");
    setTimeout(() => { el.remove(); URL.revokeObjectURL(url); }, 180);
    // only refresh the screen behind if something it shows actually changed
    if ((rec.caption || "") !== startCaption) render();
  };
  release = openOverlay(el, { onClose: close });
  $("#vClose", el).onclick = close;
  $("#vSave", el).onclick = () => saveToGallery(rec.blob, rec.date);
  $(".v-img", el).onclick = () => el.classList.toggle("bare");

  renderCaption($("#vCap", el), rec, true);
  if (opts.editNow) $("#vCap", el).querySelector(".cap-pencil, .cap-add")?.click();
}

// Caption sub-component: a read view with a pencil, and an inline edit view.
function renderCaption(host, rec, editable) {
  const cap = rec.caption || "";
  function showRead() {
    if (!cap && !editable) { host.innerHTML = ""; return; }
    host.innerHTML = cap
      ? `<div class="cap-read"><p class="cap-text">${escapeHtml(cap)}</p>${editable ? `<button class="cap-pencil" aria-label="Edit caption">${svgIcon("edit")}</button>` : ""}</div>`
      : `<button class="cap-add">${svgIcon("edit")} Add a caption</button>`;
    if (editable) {
      const trigger = host.querySelector(".cap-pencil") || host.querySelector(".cap-add");
      if (trigger) trigger.onclick = showEdit;
    }
  }
  function showEdit() {
    host.innerHTML = `
      <div class="cap-edit">
        <label class="sr-only" for="capInput">Caption</label>
        <textarea class="cap-input" id="capInput" maxlength="180" rows="2" placeholder="A word about the day…" enterkeyhint="done">${escapeHtml(rec.caption || "")}</textarea>
        <div class="cap-actions">
          <span class="cap-count tiny" aria-hidden="true"></span>
          <button class="btn ghost sm on-dark" data-act="cancel">Cancel</button>
          <button class="btn primary sm" data-act="save">Save</button>
        </div>
      </div>`;
    const ta = host.querySelector(".cap-input"), count = host.querySelector(".cap-count");
    const upd = () => { count.textContent = `${ta.value.length}/180`; };
    upd(); ta.addEventListener("input", upd);
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    const save = async () => {
      const text = ta.value.trim();
      await saveCaption(rec.date, text);
      rec.caption = text;
      haptic(6);
      toast(text ? "Caption saved" : "Caption cleared");
      renderCaption(host, rec, editable);
      host.querySelector(".cap-pencil, .cap-add")?.focus();
    };
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); renderCaption(host, rec, editable); }
    });
    host.querySelector('[data-act="cancel"]').onclick = () => renderCaption(host, rec, editable);
    host.querySelector('[data-act="save"]').onclick = save;
  }
  showRead();
}

/* ---------------------------------------------------------------- FILM / SEALED */
async function renderFilm() {
  if (!State.app.firstCaptureDate) {
    app.innerHTML = shellBack(`
      <div class="sealed">
        <div class="lock-ring" aria-hidden="true">${svgIcon("lock")}</div>
        <h2>Nothing to seal yet</h2>
        <p class="muted measure">Take your first photo. Your film begins the day you do.</p>
        <button class="btn primary wide" id="go">Take today's photo</button>
      </div>`);
    $("#go").onclick = async () => { view = "home"; await render(); openCapture(); };
    bindBack();
    return;
  }

  // per-year counts from one read
  const photos = await DB.allPhotos();
  const keys = new Set(photos.map((p) => p.date));
  const countIn = (c) => {
    const { start, end } = filmRange(c);
    const a = keyOf(start), b = keyOf(end);
    let n = 0; for (const k of keys) if (k >= a && k <= b) n++;
    return n;
  };
  const films = revealedCycles();
  const cur = currentCycle();
  const curSealed = isSealed(cur);

  const filmCard = (c, hero) => {
    const { total } = filmRange(c);
    const n = countIn(c);
    const fresh = !State.app.watched.includes(c);
    return `
      <article class="film-card ${hero ? "hero" : ""}" aria-label="${cycleLabel(c)} film">
        ${hero ? `<div class="boot-sun" aria-hidden="true"></div>` : ""}
        <div class="fc-text">
          <span class="kicker">${fresh && hero ? "Unsealed" : "Your year"}</span>
          <h2>${cycleLabel(c)}</h2>
          <p class="muted">${n} of ${total} days captured${hero ? ". The black frames are the days you missed. They belong here too." : ""}</p>
        </div>
        <div class="fc-actions">
          <button class="btn primary ${hero ? "wide" : "sm"}" data-play="${c}">${svgIcon("play")}${hero ? "Watch your film" : "Watch"}</button>
          <button class="btn ghost ${hero ? "wide" : "sm"}" data-poster="${c}">${hero ? "Save a poster of the year" : "Poster"}</button>
        </div>
      </article>`;
  };

  const sealedBlock = curSealed ? (() => {
    const { reveal, total } = filmRange(cur);
    return `
      <section class="sealed ${films.length ? "compact" : ""}" aria-label="This year, sealed">
        <div class="lock-ring" aria-hidden="true">${svgIcon("lock")}</div>
        <span class="kicker">${films.length ? "This year, sealed" : "The sealed year"}</span>
        <div id="cd" class="countdown" role="timer" aria-live="off">—<small>until your film unlocks</small></div>
        <p class="muted measure">A time capsule you're building blind. It reveals on <b>${shortDate(reveal)}</b>: all ${total} frames, gaps and all, in one sitting.</p>
      </section>`;
  })() : "";

  app.innerHTML = shellBack(`
    <div class="film-screen">
      ${films.length ? filmCard(films[0], true) : ""}
      ${films.length > 1 ? `<h3 class="kicker section-k">Earlier years</h3><div class="film-list">${films.slice(1).map((c) => filmCard(c, false)).join("")}</div>` : ""}
      ${sealedBlock}
    </div>`);
  bindBack();
  app.querySelectorAll("[data-play]").forEach((b) => { b.onclick = () => playFilm(+b.dataset.play); });
  app.querySelectorAll("[data-poster]").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try { await exportPoster(+b.dataset.poster); } catch { toast("Couldn't make the poster. Please try again."); }
      b.disabled = false;
    };
  });

  if (curSealed) {
    const { reveal } = filmRange(cur);
    const cd = $("#cd");
    const unit = (u) => `<span class="cd-unit">${u}</span>`;
    const tickCd = () => {
      if (!document.contains(cd)) return;
      const ms = reveal - new Date();
      if (ms <= 0) { render(); return; }
      const d = Math.floor(ms / DAY_MS), h = Math.floor((ms % DAY_MS) / 3600000), m = Math.floor((ms % 3600000) / 60000);
      cd.innerHTML = `${d}${unit("d")} ${pad(h)}${unit("h")} ${pad(m)}${unit("m")}<small>until your film unlocks</small>`;
      cd.setAttribute("aria-label", `${d} days, ${h} hours and ${m} minutes until your film unlocks`);
    };
    tickCd(); homeTimer = setInterval(tickCd, 30000);
  }
}

/* one-image contact sheet of a whole year: every day as a tile, missed days
   left dark. A keepsake you can print. */
async function exportPoster(cycle = currentCycle()) {
  toast("Composing your poster…", 4000);
  const days = await buildTimeline(cycle);
  const cw = 150, ch = Math.round(cw / CONFIG.ASPECT), gap = 5;
  const cols = Math.max(1, Math.ceil(Math.sqrt(days.length * CONFIG.ASPECT)));
  const rows = Math.ceil(days.length / cols);
  const padX = 70, padTop = 190, padBot = 96;
  const W = padX * 2 + cols * cw + (cols - 1) * gap;
  const H = padTop + rows * ch + (rows - 1) * gap + padBot;
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0e1116"; ctx.fillRect(0, 0, W, H);

  const shot = days.filter((d) => d.rec).length;
  const sunHot = getComputedStyle(document.documentElement).getPropertyValue("--sun-hot").trim() || "#ffd27a";
  ctx.textAlign = "left";
  ctx.fillStyle = sunHot; ctx.font = "600 62px -apple-system, system-ui, sans-serif";
  ctx.fillText("Sundial", padX, 96);
  ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = "400 30px -apple-system, system-ui, sans-serif";
  ctx.fillText(`${cycleLabel(cycle)} · ${shot} of ${days.length} days`, padX, 142);

  for (let i = 0; i < days.length; i++) {
    const x = padX + (i % cols) * (cw + gap);
    const y = padTop + Math.floor(i / cols) * (ch + gap);
    ctx.fillStyle = "#171b22"; ctx.fillRect(x, y, cw, ch);
    const d = days[i];
    if (d.rec) {
      try {
        const bmp = await createImageBitmap(d.rec.blob);
        const r = Math.max(cw / bmp.width, ch / bmp.height);
        const dw = bmp.width * r, dh = bmp.height * r;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, cw, ch); ctx.clip();
        ctx.drawImage(bmp, x + (cw - dw) / 2, y + (ch - dh) / 2, dw, dh);
        ctx.restore();
        bmp.close?.();
      } catch {}
    }
  }
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,.4)"; ctx.font = "400 26px -apple-system, system-ui, sans-serif";
  ctx.fillText("Made to be watched once, at the end.", W / 2, H - 44);

  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!blob) throw new Error("poster encode failed");
  const how = await shareOrDownload(blob, `sundial-poster-${cycleLabel(cycle)}.jpg`, "My Sundial year");
  if (how === "downloaded") toast("Poster saved to your downloads");
}

function shellBack(inner) {
  return `<div class="screen"><header class="topbar"><button class="iconbtn" id="back" aria-label="Back to today">${svgIcon("back")}</button><h1 class="topbar-title">Your film</h1><span class="topbar-spacer"></span></header><main class="grow col">${inner}</main></div>`;
}
function bindBack() { const b = $("#back"); if (b) b.onclick = () => go("home"); }

/* ---------------------------------------------------------------- FILM PLAYER */
// The film is a slow montage: each day holds for FILM_FRAME_MS and dissolves
// into the next over FILM_CROSSFADE_MS, so it breathes instead of snapping past.
// Both live playback and the exported video share the same painter below.

function drawBlackText(ctx, W, H, day) {
  // a missed day — just its date, small & honest
  ctx.fillStyle = "rgba(255,255,255,.28)";
  ctx.font = "500 30px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(shortDate(day.d), W / 2, H / 2);
}

// subtle ambient overlays — date, caption & metadata, stacked bottom-up
function paintOverlay(ctx, W, H, day, overlayAlpha, hasImage) {
  if (overlayAlpha <= 0.02) return;
  const PAD = 46;
  const caption = (day.rec?.caption || "").trim();
  const line = ambientLine(day.rec?.meta);
  ctx.textAlign = "left";
  ctx.font = "500 32px -apple-system, system-ui, sans-serif";
  const capLines = caption ? wrapText(ctx, caption, W - PAD * 2, 3) : [];

  const blockH = 40 /*date*/ + (capLines.length ? 14 + capLines.length * 42 : 0) + (line ? 44 : 0);
  const gradH = blockH + 90;
  ctx.globalAlpha = overlayAlpha;
  if (hasImage) {
    const grd = ctx.createLinearGradient(0, H - gradH, 0, H);
    grd.addColorStop(0, "rgba(0,0,0,0)"); grd.addColorStop(1, "rgba(0,0,0,.62)");
    ctx.fillStyle = grd; ctx.fillRect(0, H - gradH, W, gradH);
  }

  let baseline = H - 58;
  if (line) {
    ctx.font = "500 26px -apple-system, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.82)";
    ctx.fillText(line, PAD, baseline);
    baseline -= 44;
  }
  if (capLines.length) {
    ctx.font = "500 32px -apple-system, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.96)";
    for (let k = capLines.length - 1; k >= 0; k--) { ctx.fillText(capLines[k], PAD, baseline); baseline -= 42; }
    baseline -= 14;
  }
  ctx.font = "600 34px -apple-system, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.fillText(`${day.d.getDate()} ${MONTHS[day.d.getMonth()]}`, PAD, baseline);
  ctx.globalAlpha = 1;
}

// Decoding a whole year of photos up front would hold hundreds of full-size
// bitmaps in memory (gigabytes on a phone). Instead keep a small rolling
// window: decode a few seconds ahead, close frames once they've played.
function frameCache(days) {
  const cache = new Map(); // idx -> ImageBitmap | null (no photo) | Promise (decoding)
  const want = (i) => {
    if (i < 0 || i >= days.length || cache.has(i)) return;
    const rec = days[i].rec;
    if (!rec) { cache.set(i, null); return; }
    const p = createImageBitmap(rec.blob)
      .then((b) => { if (cache.get(i) === p) cache.set(i, b); else b.close?.(); })
      .catch(() => { if (cache.get(i) === p) cache.set(i, null); });
    cache.set(i, p);
  };
  return {
    // undefined = still decoding; null = no photo that day
    get(i) { const v = cache.get(i); return v instanceof Promise ? undefined : v; },
    prefetch(i, ahead = 14) {
      for (let k = i; k <= i + ahead; k++) want(k);
      for (const [k, v] of cache) if (k < i - 1 || k > i + ahead + 2) { if (v && v.close) v.close(); cache.delete(k); }
    },
    async ready(i, ahead = 14) {
      this.prefetch(i, ahead);
      await Promise.all([...cache.values()].filter((v) => v instanceof Promise));
    },
    clear() { for (const v of cache.values()) if (v && v.close) v.close(); cache.clear(); },
  };
}

// paint the whole stage at time tMs into the film; returns the current day index
function paintFilm(ctx, W, H, days, frames, tMs, frameMs, xfade) {
  const idx = Math.min(days.length - 1, Math.floor(tMs / frameMs));
  const into = tMs - idx * frameMs;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);

  const drawDay = (k, alpha) => {
    if (k < 0 || k >= days.length || alpha <= 0) return;
    ctx.globalAlpha = alpha;
    const bmp = frames.get(k);
    if (bmp) {
      const r = Math.max(W / bmp.width, H / bmp.height);
      const dw = bmp.width * r, dh = bmp.height * r;
      ctx.drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else if (!days[k].rec) {
      drawBlackText(ctx, W, H, days[k]);
    }
    ctx.globalAlpha = 1;
  };

  // crossfade: near the end of a frame, the next day fades UP underneath while
  // the current day fades OUT on top of it.
  const remaining = frameMs - into;
  const fading = idx < days.length - 1 && remaining < xfade;
  if (fading) {
    const a = 1 - remaining / xfade; // 0 -> 1 across the dissolve
    drawDay(idx + 1, 1);             // incoming day, full
    drawDay(idx, 1 - a);             // outgoing day dissolves away
  } else {
    drawDay(idx, 1);
  }

  // overlay for the settled frame: fades in over first 35%, out over last 25%
  if (!fading) {
    const local = into / frameMs;
    const oa = Math.max(0, Math.min(1, local / 0.35) * Math.min(1, (1 - local) / 0.25));
    paintOverlay(ctx, W, H, days[idx], oa, !!frames.get(idx));
  }
  return idx;
}

async function playFilm(cycle = currentCycle()) {
  const W = 1080, H = Math.round(W / CONFIG.ASPECT);
  const frameMs = Math.max(CONFIG.FILM_MIN_FRAME_MS, CONFIG.FILM_FRAME_MS);
  const xfade = Math.min(CONFIG.FILM_CROSSFADE_MS, frameMs * 0.9);

  const el = document.createElement("div");
  el.className = "player"; el.id = "player";
  el.setAttribute("aria-label", `Your ${cycleLabel(cycle)} film`);
  el.innerHTML = `
    <canvas id="stage" width="${W}" height="${H}" tabindex="0" role="img" aria-label="Your film is playing. Press space to pause."></canvas>
    <div class="p-top"><button class="iconbtn glass" id="pClose" aria-label="Close film">${svgIcon("close")}</button><span class="p-title">${cycleLabel(cycle)}</span><span class="topbar-spacer"></span></div>
    <div class="p-status" id="pStatus" role="status"><span class="boot-sun sm" aria-hidden="true"></span>Developing your film…</div>
    <div class="p-paused" id="pPaused" aria-hidden="true">${svgIcon("pause")}</div>
    <div class="p-bar">
      <div class="p-progress" aria-hidden="true"><i id="pFill"></i></div>
      <div class="p-controls" id="pControls" hidden>
        <button class="btn ghost on-dark" id="pReplay">${svgIcon("replay")}Replay</button>
        <button class="btn primary" id="pSave">${svgIcon("download")}Save film</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  const canvas = $("#stage", el), ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);

  let stopped = false, paused = false, ended = false, exporting = false, release;
  const days = await buildTimeline(cycle);
  const frames = frameCache(days);
  const totalMs = frameMs * days.length;
  const close = async () => {
    if (exporting && !(await confirmSheet({ title: "Stop rendering?", body: "Your film hasn't finished rendering. Closing now throws away the progress.", ok: "Stop", cancel: "Keep rendering" }))) return;
    if (stopped) return;
    stopped = true; exportCancel?.();
    release?.(); frames.clear(); el.remove(); render(); renderUpdateBanner();
  };
  let exportCancel = null;
  release = openOverlay(el, { onClose: close, initial: "#stage" });
  $("#pClose", el).onclick = close;

  const fill = $("#pFill", el), status = $("#pStatus", el), controls = $("#pControls", el), pausedEl = $("#pPaused", el);
  await frames.ready(0);
  if (stopped) return;
  status.hidden = true;

  let t = 0, last = performance.now();
  function loop(now) {
    if (stopped || paused || ended) return;
    const dt = now - last; last = now;
    // buffering: hold the clock if the next photo hasn't decoded yet
    const idx = Math.min(days.length - 1, Math.floor(t / frameMs));
    const nextIdx = Math.min(days.length - 1, idx + 1);
    const waiting = (days[idx].rec && frames.get(idx) === undefined) || (days[nextIdx].rec && frames.get(nextIdx) === undefined && frameMs - (t % frameMs) < xfade);
    if (!waiting) t += dt;
    frames.prefetch(idx);
    paintFilm(ctx, W, H, days, frames, Math.min(t, totalMs - 1), frameMs, xfade);
    fill.style.transform = `scaleX(${Math.min(1, t / totalMs)})`;
    if (t >= totalMs) return endPlay();
    requestAnimationFrame(loop);
  }
  async function endPlay() {
    ended = true;
    // settle on the last day mid-frame so its overlay rests at full opacity
    paintFilm(ctx, W, H, days, frames, (days.length - 1) * frameMs + frameMs * 0.5, frameMs, xfade);
    fill.style.transform = "scaleX(1)";
    controls.hidden = false;
    $("#pReplay", el).focus({ preventScroll: true });
    if (!State.app.watched.includes(cycle)) { State.app.watched.push(cycle); await State.save(); }
  }
  const togglePause = () => {
    if (ended || exporting) return;
    paused = !paused;
    pausedEl.classList.toggle("show", paused);
    if (!paused) { last = performance.now(); requestAnimationFrame(loop); }
  };
  canvas.onclick = togglePause;
  el.addEventListener("keydown", (e) => {
    if (e.key === " " && !e.target.closest("button")) { e.preventDefault(); togglePause(); }
  });
  $("#pReplay", el).onclick = async () => {
    controls.hidden = true; ended = false; t = 0;
    frames.clear(); await frames.ready(0);
    last = performance.now(); requestAnimationFrame(loop);
  };
  $("#pSave", el).onclick = async () => {
    exporting = true; controls.hidden = true;
    canvas.setAttribute("aria-label", "Rendering your film");
    const res = await exportFilm({ canvas, ctx, days, frames, frameMs, xfade, W, H, cycle, status, fill,
      onCancel: (fn) => { exportCancel = fn; }, isStopped: () => stopped });
    exporting = false; exportCancel = null;
    if (stopped) return;
    status.hidden = true; controls.hidden = false;
    endPlay();
    if (res === "fallback") exportPoster(cycle).catch(() => {});
  };
  last = performance.now();
  requestAnimationFrame(loop);
}

/* best-effort film export -> share sheet / download (post-reveal only).
   Re-plays the film on the visible stage in real time and records that canvas,
   so the user watches it render. If video can't be made here (no recorder, or
   the known iOS installed-PWA bug where MediaRecorder produces nothing), it
   resolves "fallback" and the caller saves the poster instead. */
async function exportFilm({ canvas, ctx, days, frames, frameMs, xfade, W, H, cycle, status, fill, onCancel, isStopped }) {
  const mime = typeof MediaRecorder !== "undefined"
    ? ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported?.(m))
    : null;
  if (!mime || typeof canvas.captureStream !== "function") {
    toast("This device can't render video, so here's a poster instead.", 3500);
    return "fallback";
  }
  let rec, stream;
  try {
    stream = canvas.captureStream(30);
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  } catch { toast("Couldn't render the film here, so here's a poster instead.", 3500); return "fallback"; }

  const totalMs = frameMs * days.length;
  const chunks = [];
  let cancelled = false;
  status.hidden = false;
  status.innerHTML = `<span class="boot-sun sm" aria-hidden="true"></span><span id="pPct">Rendering your film… 0%</span><button class="btn sm ghost on-dark" id="pCancel">Cancel</button>`;
  const pct = $("#pPct", status);
  const stopTracks = () => { try { stream.getTracks().forEach((t) => t.stop()); } catch {} };
  const cancel = () => { cancelled = true; try { rec.state !== "inactive" && rec.stop(); } catch {} };
  onCancel(cancel);
  $("#pCancel", status).onclick = cancel;

  const done = new Promise((resolve) => {
    rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
    rec.onerror = () => resolve("error");
    rec.onstop = () => resolve("stopped");
  });
  frames.clear(); await frames.ready(0);
  try { rec.start(1000); } catch { stopTracks(); toast("Couldn't render the film here, so here's a poster instead.", 3500); return "fallback"; }

  // drive the same painter in real time so the recorder captures the crossfades
  let t = 0, last = performance.now();
  const watchdog = setTimeout(cancel, totalMs * 2 + 15000);
  await new Promise((resolve) => {
    const step = (now) => {
      if (cancelled || isStopped()) return resolve();
      const dt = now - last; last = now;
      const idx = Math.min(days.length - 1, Math.floor(t / frameMs));
      if (!(days[idx].rec && frames.get(idx) === undefined)) t += dt;
      frames.prefetch(idx);
      paintFilm(ctx, W, H, days, frames, Math.min(t, totalMs - 1), frameMs, xfade);
      fill.style.transform = `scaleX(${Math.min(1, t / totalMs)})`;
      pct.textContent = `Rendering your film… ${Math.min(99, Math.floor((t / totalMs) * 100))}%`;
      if (t >= totalMs) { try { rec.stop(); } catch {} return resolve(); }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  const how = await done;
  clearTimeout(watchdog); stopTracks();
  if (cancelled || isStopped()) { toast("Rendering stopped."); return "cancelled"; }
  const size = chunks.reduce((n, c) => n + c.size, 0);
  if (how === "error" || !size) {
    toast("Couldn't render the film here, so here's a poster instead. Reopening the app fresh usually fixes it.", 5000);
    return "fallback";
  }
  status.innerHTML = `<span class="boot-sun sm" aria-hidden="true"></span>Film ready`;
  const blob = new Blob(chunks, { type: mime.split(";")[0] });
  const ext = mime.includes("mp4") ? "mp4" : "webm";
  const res = await shareOrDownload(blob, `sundial-${cycleLabel(cycle)}.${ext}`, "My Sundial year");
  if (res === "downloaded") toast("Film saved to your downloads");
  return "ok";
}

/* ---------------------------------------------------------------- SETTINGS SHEET */
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function relDays(iso) {
  if (!iso) return null;
  const n = daysBetween(new Date(iso), new Date());
  return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
}

async function openSettings() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const used = est ? `${(est.usage / 1048576).toFixed(1)} MB used` : "";
  const s = State.app.settings;
  const lastB = relDays(State.app.lastBackup);
  const stale = !State.app.lastBackup || daysBetween(new Date(State.app.lastBackup), new Date()) > 30;
  const hasPhotos = !!State.app.firstCaptureDate;

  const sw = (id, on, label, sub) => `
    <div class="settings-row">
      <label for="${id}" class="sr-text"><span class="lbl" id="${id}L">${label}</span><span class="sub" id="${id}D">${sub}</span></label>
      <button class="switch ${on ? "on" : ""}" role="switch" aria-checked="${on}" aria-labelledby="${id}L" aria-describedby="${id}D" id="${id}"><span class="knob"></span></button>
    </div>`;
  const act = (id, label, sub, cta, extra = "") => `
    <div class="settings-row">
      <div class="sr-text"><span class="lbl" id="${id}L">${label}</span><span class="sub ${extra}" id="${id}D">${sub}</span></div>
      <button class="pill" id="${id}" aria-describedby="${id}L ${id}D">${cta}</button>
    </div>`;

  const { sheet, close } = openSheet(`
    <div class="sheet-head">
      <h2>Settings</h2>
      <p class="muted tiny">Everything lives on this phone${used ? ` · ${used}` : ""}.</p>
    </div>

    <h3 class="group-k">Daily ritual</h3>
    <div class="group">
      ${act("notif", "Daily reminder", s.reminder ? "On. One gentle nudge a day if you haven't shot yet." : "A gentle nudge to take today's shot", s.reminder ? "Turn off" : "Set up")}
    </div>

    <h3 class="group-k">Keep it safe</h3>
    <div class="group">
      ${act("backup", "Back up your year", lastB ? `Last backup ${lastB}` : hasPhotos ? "Never backed up. Your photos live only here." : "Every photo &amp; caption in one .zip", "Export", hasPhotos && stale ? "warn" : "")}
      ${act("restore", "Restore from a backup", "Bring a saved .zip onto this device", "Import")}
    </div>

    <h3 class="group-k">Camera</h3>
    <div class="group">
      <div class="settings-row stacked">
        <div class="sr-text"><span class="lbl" id="lookL">Film look</span><span class="sub">A colour grade baked into each shot. Permanent, like the shot.</span></div>
        <div class="look-row" id="lookRow" role="radiogroup" aria-labelledby="lookL">${Object.entries(FILM_LOOKS).map(([k, l]) => `<button class="look-pill ${s.filmLook === k ? "on" : ""}" role="radio" aria-checked="${s.filmLook === k}" data-k="${k}">${l.label}</button>`).join("")}</div>
      </div>
      ${sw("setStamp", s.dateStamp, "Date stamp", "A retro amber date burned into the corner")}
      ${sw("setLeaks", s.lightLeaks, "Light leaks", "A random warm flare, like an over-exposed roll")}
      ${sw("setSound", s.captureSound, "Capture the moment's sound", "Three seconds of audio, played back in the viewer")}
    </div>

    <h3 class="group-k">Home</h3>
    <div class="group">
      ${sw("setStrip", s.showStrip, "Show the year strip", "Dots for shot and missed days")}
      <div class="settings-row">
        <div class="sr-text"><span class="lbl" id="accL">Accent</span><span class="sub">The colour of the sun and dial</span></div>
        <div class="accent-row" id="accentRow" role="radiogroup" aria-labelledby="accL">${Object.entries(ACCENTS).map(([k, a]) => `<button class="swatch ${s.accent === k ? "on" : ""}" role="radio" aria-checked="${s.accent === k}" data-k="${k}" aria-label="${a.label}" style="--sw-a:${a.hot};--sw-b:${a.sun}"></button>`).join("")}</div>
      </div>
    </div>

    <h3 class="group-k">Advanced</h3>
    <div class="group">
      ${sw("setDev", s.devPreview, "Preview the film early", "Breaks the seal. For testing only.")}
      <div class="settings-row">
        <div class="sr-text"><span class="lbl">Year mode</span><span class="sub">${CONFIG.YEAR_MODE === "rolling" ? "365 days from your first photo" : "Calendar year, reveals on 31 Dec"}</span></div>
      </div>
    </div>

    <button class="btn ghost block" id="close">Done</button>
    <p class="tiny faint sheet-foot">Sundial ${APP_VERSION} · Made to be watched once, at the end.</p>`, { label: "Settings" });

  const $s = (sel) => $(sel, sheet);
  $s("#close").onclick = close;
  // toggles flip in place (the sheet stays open)
  const bindSwitch = (id, key, after) => {
    const btn = $s(`#${id}`);
    btn.onclick = async () => {
      s[key] = !s[key];
      btn.classList.toggle("on", s[key]); btn.setAttribute("aria-checked", s[key]);
      haptic(6); await State.save(); after?.(s[key]);
    };
  };
  bindSwitch("setStrip", "showStrip", () => render());
  bindSwitch("setSound", "captureSound", (on) => { if (on) toast("Your next shot will keep a moment of sound."); });
  bindSwitch("setStamp", "dateStamp");
  bindSwitch("setLeaks", "lightLeaks");
  bindSwitch("setDev", "devPreview", (on) => { toast(on ? "Seal broken (preview on)" : "Seal restored"); render(); });

  const radio = (rowSel, key, after) => {
    const row = $s(rowSel);
    row.querySelectorAll("[data-k]").forEach((b) => {
      b.onclick = async () => {
        s[key] = b.dataset.k;
        row.querySelectorAll("[data-k]").forEach((o) => { o.classList.toggle("on", o === b); o.setAttribute("aria-checked", o === b); });
        haptic(6); await State.save(); after?.();
      };
    });
  };
  radio("#accentRow", "accent", () => applyAccent(s.accent));
  radio("#lookRow", "filmLook");

  $s("#backup").onclick = async (e) => {
    haptic(6);
    const b = e.currentTarget; b.disabled = true;
    try {
      if (await exportBackup()) $s("#backupD").textContent = "Last backup today";
      $s("#backupD").classList.remove("warn");
    } catch { toast("Backup failed. Please try again."); }
    b.disabled = false;
  };
  $s("#restore").onclick = () => pickBackup(() => { close(); render(); });
  $s("#notif").onclick = async () => {
    if (s.reminder) {
      await unregisterDailyNudge();
      s.reminder = false; await State.save();
      close(); toast("Daily reminder is off.");
      return;
    }
    let scheduled = false;
    if (!IS_IOS && "Notification" in window) {
      const perm = await Notification.requestPermission().catch(() => "denied");
      if (perm === "granted") scheduled = await registerDailyNudge();
      else if (perm === "denied") { close(); toast("Notifications are blocked for this site in your browser settings."); return; }
    }
    close();
    if (scheduled) {
      s.reminder = true; await State.save();
      toast("Daily reminder is on.");
      try { (await navigator.serviceWorker.ready).showNotification("Sundial", { body: "You'll get one gentle nudge a day.", icon: "icons/icon-192.png", tag: "daily-nudge" }); } catch {}
    } else showNotifHelp();
  };
}

// pick a .zip, confirm, restore, then call done()
function pickBackup(done) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".zip,application/zip";
  inp.onchange = async () => {
    const file = inp.files?.[0];
    if (!file) return;
    const ok = await confirmSheet({
      title: "Restore this backup?",
      body: "It fills in any missing days and replaces days that match. Nothing else on this phone is removed.",
      ok: "Restore",
    });
    if (!ok) return;
    toast("Restoring…", 8000);
    try {
      const n = await importBackup(file);
      haptic(12);
      toast(`Restored ${n} photo${n === 1 ? "" : "s"}.`);
      done?.();
    } catch (e) { toast(e?.message || "That file isn't a valid backup."); }
  };
  inp.click();
}

// Serverless daily reminder. On Chrome/Android an installed PWA can register a
// Periodic Background Sync that fires the nudge with no server. iOS has no such
// API, so it returns false and we fall back to the Shortcuts recipe.
async function registerDailyNudge() {
  try {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    if (!("periodicSync" in reg)) return false;
    const status = await navigator.permissions?.query?.({ name: "periodic-background-sync" }).catch(() => null);
    if (status && status.state === "denied") return false;
    await reg.periodicSync.register("daily-nudge", { minInterval: 20 * 3600 * 1000 }); // ~once a day
    return true;
  } catch { return false; }
}
async function unregisterDailyNudge() {
  try { const reg = await navigator.serviceWorker.ready; await reg.periodicSync?.unregister("daily-nudge"); } catch {}
}

function showNotifHelp() {
  const body = IS_IOS ? `
      <p class="muted sheet-body">iPhone can't wake a web app on a timer, so set it up once in the built-in Shortcuts app. It's free and needs no account.</p>
      <ol class="steps">
        <li>Open <b>Shortcuts</b>, tap <b>Automation</b>, then <b>+</b> and choose <b>Time of Day</b>.</li>
        <li>Pick your time (9:00 is a good start), <b>Daily</b>, and <b>Run Immediately</b>.</li>
        <li>Add the action <b>Show Notification</b>: “One shot for today, before it's gone.”</li>
        <li>Add the action <b>Open App</b> and choose <b>Sundial</b>.</li>
        <li>Done. Each day it pings you and opens straight to last year's shot.</li>
      </ol>` : `
      <p class="muted sheet-body">This browser can't schedule a reminder on its own yet. For a daily nudge:</p>
      <ol class="steps">
        <li><b>Install Sundial</b> from your browser menu (Install app / Add to Home screen), then try again from the installed app. Chrome on Android supports it.</li>
        <li>Or set a daily alarm or calendar reminder that says “Sundial”.</li>
      </ol>`;
  const { sheet, close } = openSheet(`<h2>The daily nudge</h2>${body}<button class="btn primary block" id="ok">Got it</button>`, { label: "The daily nudge" });
  $("#ok", sheet).onclick = close;
}

/* ---------------------------------------------------------------- update banner */
// Surfaces a waiting service worker as a tap-to-reload prompt. We hold the
// worker aside and only render the banner when the camera/film aren't open,
// so an update never covers the shutter mid-shot.
let pendingWorker = null;
function offerUpdate(worker) { pendingWorker = worker; renderUpdateBanner(); }
function renderUpdateBanner() {
  if (!pendingWorker || document.getElementById("updateBanner")) return;
  if ($("#capture") || $("#player")) return; // wait until the overlay closes
  const b = document.createElement("div");
  b.className = "update-banner"; b.id = "updateBanner";
  b.setAttribute("role", "status");
  b.innerHTML = `<span>A new version of Sundial is ready.</span><button class="ub-btn">Reload</button>`;
  document.body.appendChild(b);
  b.querySelector(".ub-btn").onclick = () => {
    b.querySelector(".ub-btn").textContent = "Updating…";
    updateAccepted = true;
    pendingWorker.postMessage({ type: "SKIP_WAITING" }); // → controllerchange → reload
  };
}
let updateAccepted = false;

/* ---------------------------------------------------------------- boot */
async function boot() {
  try {
    await State.load();
  } catch {
    // IndexedDB unavailable (private browsing in some browsers, storage disabled)
    app.innerHTML = `
      <div class="screen enter center">
        <div class="boot-sun lg" aria-hidden="true"></div>
        <h1>Sundial can't save here</h1>
        <p class="muted measure">This browser is blocking on-device storage, which Sundial needs to keep your photos. Leave private browsing, or open it in Safari or Chrome.</p>
      </div>`;
    return;
  }
  applyAccent(State.app.settings.accent);
  await render();
  let swReg = null;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      swReg = reg;
      // an update that finished installing on a previous visit
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) offerUpdate(nw);
        });
      });
    }).catch(() => {});
    // once the worker the user accepted takes control, load its fresh assets
    // (guarded so the first-visit clients.claim() doesn't trigger a reload)
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!updateAccepted || refreshing) return; refreshing = true; location.reload();
    });
  }
  // refresh when returning to the app (new day, the window shrank, etc.) and
  // look for an update, since an installed PWA can stay alive for days
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    swReg?.update?.().catch(() => {});
    if (!overlayStack.length) { render(); renderUpdateBanner(); }
  });
}
boot();
