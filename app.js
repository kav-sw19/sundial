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
  FILM_TARGET_SECONDS: 30,   // (legacy — pacing is now per-frame; kept for the README)
  FILM_MIN_FRAME_MS: 60,     // floor if ever computing from a target
  PHOTO_MAX_DIM: 1600,       // longest edge stored (keeps a year well under phone storage)
  JPEG_QUALITY: 0.86,
  ASPECT: 4 / 5,             // portrait frame the film is composed in
};

const DAY_MS = 86400000;
const $ = (sel, el = document) => el.querySelector(sel);
const app = document.getElementById("app");

/* ---------------------------------------------------------------- date utils */
const pad = (n) => String(n).padStart(2, "0");
function keyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayKey() { return keyOf(new Date()); }
function parseKey(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function keyYearAgo() {
  const n = new Date(); const y = n.getFullYear() - 1;
  // handle Feb 29 gracefully
  const probe = new Date(y, n.getMonth(), n.getDate());
  return keyOf(probe);
}
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
async function fetchAmbient() {
  const meta = { moon: moonPhase(new Date()), capturedAt: new Date().toISOString() };
  const pos = await getPosition();
  if (pos) {
    meta.lat = +pos.lat.toFixed(4); meta.lon = +pos.lon.toFixed(4);
    try {
      const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lon}&current=temperature_2m,weather_code&timezone=auto`).then(r => r.json());
      if (w?.current) {
        meta.tempC = Math.round(w.current.temperature_2m);
        const code = w.current.weather_code;
        const [txt, glyph] = WMO[code] || ["", ""];
        meta.weatherText = txt; meta.weatherGlyph = glyph;
      }
    } catch {}
    try {
      const g = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${pos.lat}&longitude=${pos.lon}&localityLanguage=en`).then(r => r.json());
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
    updatePhoto,
    getPhoto: (date) => tx("photos", "readonly", (s) => s.get(date)),
    allPhotos: () => tx("photos", "readonly", (s) => s.getAll()),
    hasPhoto: async (date) => !!(await tx("photos", "readonly", (s) => s.getKey(date))),
    getMeta: (k) => tx("meta", "readonly", (s) => s.get(k)),
    setMeta: (k, v) => tx("meta", "readwrite", (s) => s.put(v, k)),
  };
})();

/* ---------------------------------------------------------------- app state */
const State = {
  app: null, // { onboarded, firstCaptureDate, settings, lastNudgeDate }
  async load() {
    const DEFAULT_SETTINGS = {
      showStrip: true, devPreview: false, notifyTime: "09:00",
      captureSound: false, showGrid: false, accent: "amber", filmLook: "none",
      dateStamp: false, lightLeaks: false,
    };
    this.app = (await DB.getMeta("app")) || {
      onboarded: false, firstCaptureDate: null, lastNudgeDate: null,
      settings: { ...DEFAULT_SETTINGS },
    };
    // migrate defaults (new keys land on older saved state)
    this.app.settings = Object.assign({ ...DEFAULT_SETTINGS }, this.app.settings || {});
    return this.app;
  },
  async save() { await DB.setMeta("app", this.app); },
};

/* film window + reveal math */
function filmRange() {
  const first = State.app.firstCaptureDate ? parseKey(State.app.firstCaptureDate) : new Date();
  if (CONFIG.YEAR_MODE === "calendar") {
    const start = new Date(first.getFullYear(), 0, 1);
    const end = new Date(first.getFullYear(), 11, 31);
    const reveal = new Date(first.getFullYear(), 11, 31, 0, 0, 0); // watchable ON Dec 31
    return { start, end, reveal, total: Math.round((end - start) / DAY_MS) + 1 };
  }
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate());
  const end = addDays(start, 364);
  const reveal = addDays(start, 365); // fully sealed until the 365-day cycle closes
  return { start, end, reveal, total: 365 };
}
function isSealed() {
  if (State.app.settings.devPreview) return false;
  if (!State.app.firstCaptureDate) return true;
  return new Date() < filmRange().reveal;
}

/* build the ordered per-day timeline of the film year */
async function buildTimeline() {
  const { start, total } = filmRange();
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
    const rec = await DB.getPhoto(keyOf(probe));
    if (rec) out.push({ yearsAgo: now.getFullYear() - y, rec });
  }
  return out;
}
function yearsAgoLabel(n) { return n === 1 ? "One year ago today" : `${n} years ago today`; }

/* ---------------------------------------------------------------- save to Photos (gallery) */
async function saveToGallery(blob, dateKey) {
  const file = new File([blob], `sundial-${dateKey}.jpg`, { type: "image/jpeg" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Sundial" }); return true; }
    catch (e) { if (e.name === "AbortError") return false; }
  }
  // fallback: trigger a download (Safari offers "Save to Files/Photos")
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `sundial-${dateKey}.jpg`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

/* ---------------------------------------------------------------- backup (.zip) */
// A year is precious and lives only on this device. Export bundles every photo
// (as a real .jpg you can browse) plus its caption & ambient metadata into one
// .zip; import restores it on any device. Hand-rolled STORE-method zip — no libs,
// no base64 bloat, and the archive opens in any unzip tool.
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
// files: [{ name: string, data: Uint8Array }] → Blob (application/zip)
function zipWrite(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
  const u16 = (n) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n & 0xffff, true); return b; };
  const push = (b) => { chunks.push(b); offset += b.length; };
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const localOff = offset;
    // local file header
    push(u32(0x04034b50)); push(u16(20)); push(u16(0)); push(u16(0)); push(u16(0)); push(u16(0));
    push(u32(crc)); push(u32(f.data.length)); push(u32(f.data.length));
    push(u16(name.length)); push(u16(0)); push(name); push(f.data);
    // central directory record (buffered, appended after all locals)
    central.push({ name, crc, size: f.data.length, off: localOff });
  }
  const cdStart = offset;
  for (const c of central) {
    push(u32(0x02014b50)); push(u16(20)); push(u16(20)); push(u16(0)); push(u16(0)); push(u16(0)); push(u16(0));
    push(u32(c.crc)); push(u32(c.size)); push(u32(c.size));
    push(u16(c.name.length)); push(u16(0)); push(u16(0)); push(u16(0)); push(u16(0));
    push(u32(0)); push(u32(c.off)); push(c.name);
  }
  const cdSize = offset - cdStart;
  push(u32(0x06054b50)); push(u16(0)); push(u16(0)); push(u16(central.length)); push(u16(central.length));
  push(u32(cdSize)); push(u32(cdStart)); push(u16(0));
  return new Blob(chunks, { type: "application/zip" });
}
// parse a STORE-method zip by scanning local file headers → [{ name, data }]
async function zipRead(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  const dec = new TextDecoder();
  const out = [];
  let p = 0;
  while (p + 4 <= buf.length && dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true);
    const compSize = dv.getUint32(p + 18, true);
    const nameLen = dv.getUint16(p + 26, true);
    const extraLen = dv.getUint16(p + 28, true);
    const nameStart = p + 30;
    const name = dec.decode(buf.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (method !== 0) throw new Error("Unsupported compression in backup");
    out.push({ name, data });
    p = dataStart + compSize;
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
  toast("Bundling your year…", 3000);
  const photos = await DB.allPhotos();
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
  const zip = zipWrite(files);
  const stamp = todayKey();
  const file = new File([zip], `sundial-backup-${stamp}.zip`, { type: "application/zip" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Sundial backup" }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(zip);
  const a = document.createElement("a");
  a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 6000);
}

// restore from a .zip; merges into whatever is already here (fills empty days,
// overwrites matching ones), and pulls the first-capture date back to the earliest.
async function importBackup(file) {
  const entries = await zipRead(file);
  const manEntry = entries.find((e) => e.name === "manifest.json");
  if (!manEntry) throw new Error("Not a Sundial backup (no manifest).");
  const manifest = JSON.parse(new TextDecoder().decode(manEntry.data));
  if (manifest.app !== "sundial") throw new Error("Not a Sundial backup.");
  const byName = new Map(entries.map((e) => [e.name, e]));
  let restored = 0;
  for (const meta of manifest.photos || []) {
    const img = byName.get(`photos/${meta.date}.jpg`);
    if (!img) continue;
    // copy bytes so the record's blob doesn't alias the whole archive buffer
    const blob = new Blob([img.data.slice()], { type: "image/jpeg" });
    const rec = { date: meta.date, blob, caption: meta.caption || "", meta: meta.meta || {}, createdAt: meta.createdAt || null };
    if (meta.audioFile) {
      const a = byName.get(meta.audioFile);
      if (a) { rec.audio = new Blob([a.data.slice()], { type: meta.audioType || "audio/webm" }); rec.audioType = meta.audioType || "audio/webm"; }
    }
    await DB.putPhoto(rec);
    restored++;
  }
  // earliest first-capture wins so the film window covers the whole restored year
  const dates = (manifest.photos || []).map((p) => p.date).filter(Boolean).sort();
  const earliest = dates[0];
  if (earliest && (!State.app.firstCaptureDate || earliest < State.app.firstCaptureDate)) {
    State.app.firstCaptureDate = earliest;
  }
  State.app.onboarded = true;
  await State.save();
  return restored;
}

/* ---------------------------------------------------------------- tiny helpers */
function toast(msg, ms = 2200) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 250); }, ms);
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

/* wire Escape to close any overlay; returns a detach fn to call on close */
function onEscape(cb) {
  const h = (e) => { if (e.key === "Escape") cb(); };
  document.addEventListener("keydown", h);
  return () => document.removeEventListener("keydown", h);
}

/* ================================================================ RENDER ROOT */
let view = "home";
async function render() {
  await State.load();
  if (!State.app.onboarded) return renderOnboarding();
  if (view === "film") return renderFilm();
  return renderHome();
}

/* ---------------------------------------------------------------- ONBOARDING */
function renderOnboarding() {
  app.innerHTML = `
  <div class="screen center stack">
    <div class="boot-sun" style="width:56px;height:56px"></div>
    <h1 style="font-size:30px;margin-top:8px">Sundial</h1>
    <p class="muted" style="max-width:300px">One honest photo a day. No feed. No likes. No do-overs. At the end of the year, your days become a film.</p>
    <div style="width:100%;max-width:360px;margin-top:14px;text-align:left">
      <div class="rule"><div class="r-ico">☀️</div><div><b>One shot a day</b><p>One tap. It can't be retaken, deleted, or replaced. Choose your moment.</p></div></div>
      <div class="rule"><div class="r-ico">⏳</div><div><b>The window closes at midnight</b><p>Miss a day and it becomes a black frame with the date. The gaps stay honest.</p></div></div>
      <div class="rule"><div class="r-ico">🎞️</div><div><b>Sealed until it's done</b><p>You can't rewatch your year until the 365 days close. You're building it blind.</p></div></div>
      <div class="rule"><div class="r-ico">🌘</div><div><b>Quietly remembers</b><p>Weather, city and moon phase ride along with each frame — surfacing only in the film.</p></div></div>
    </div>
    <button class="btn primary block wide" id="start" style="max-width:360px;margin-top:20px">Begin</button>
    <p class="tiny faint" style="max-width:320px">On the next screen your phone will ask for camera & location. Location is only used for the ambient weather/city on each frame and never leaves your device.</p>
  </div>`;
  $("#start").onclick = async () => {
    State.app.onboarded = true;
    await State.save();
    try { await navigator.storage?.persist?.(); } catch {}
    view = "home"; render();
  };
}

/* ---------------------------------------------------------------- HOME / TODAY */
let homeTimer = null;
async function renderHome() {
  clearInterval(homeTimer);
  const now = new Date();
  const tKey = todayKey();
  const shotToday = await DB.getPhoto(tKey);
  const onThisDay = State.app.firstCaptureDate ? await photosOnThisDay() : [];
  const { total } = State.app.firstCaptureDate ? filmRange() : { total: 365 };

  app.innerHTML = `
  <div class="screen" id="home">
    <div class="topbar">
      <div class="date">
        <span class="kicker">${greeting(now)}</span>
        <b>${prettyDate(now)}</b>
      </div>
      <div style="display:flex;gap:10px">
        <button class="iconbtn" id="toFilm" aria-label="Film">${svgIcon("film")}</button>
        <button class="iconbtn" id="toSettings" aria-label="Settings">${svgIcon("settings")}</button>
      </div>
    </div>

    <div id="lowstore"></div>
    <div id="ly"></div>
    <div id="core"></div>
    <div id="strip"></div>
  </div>`;

  $("#toFilm").onclick = () => { view = "film"; render(); };
  $("#toSettings").onclick = openSettings;

  // This-day-in-past-years peek: the closest prior year as a big card, older
  // years as a small strip beneath it.
  const ly = $("#ly");
  if (onThisDay.length) {
    const primary = onThisDay[0];
    const rest = onThisDay.slice(1);
    const url = URL.createObjectURL(primary.rec.blob);
    const m = primary.rec.meta || {};
    const bits = [m.weatherGlyph && `${m.weatherGlyph} ${m.tempC != null ? m.tempC + "°" : ""}`, m.city, m.moon?.glyph].filter(Boolean).join("  ·  ");
    ly.innerHTML = `
      <button class="lastyear" id="lyCard" aria-label="View ${escapeHtml(yearsAgoLabel(primary.yearsAgo))}">
        <span class="ly-label">${yearsAgoLabel(primary.yearsAgo)}</span>
        <span class="ly-expand">${svgIcon("expand")}</span>
        <img class="ly-img" src="${url}" alt="Your photo from ${primary.yearsAgo} year(s) ago" />
        <div class="ly-meta">
          ${primary.rec.caption ? `<p class="ly-cap">${escapeHtml(primary.rec.caption)}</p>` : ""}
          ${bits ? `<div class="ly-bits">${bits}</div>` : ""}
        </div>
      </button>
      ${rest.length ? `<div class="ly-more" id="lyMore">${rest.map((o, i) =>
        `<button class="ly-thumb" data-i="${i}" aria-label="View ${escapeHtml(yearsAgoLabel(o.yearsAgo))}"><img src="${URL.createObjectURL(o.rec.blob)}" alt=""/><span>${o.yearsAgo}y</span></button>`).join("")}</div>` : ""}`;
    $("#lyCard").onclick = () => openViewer(primary.rec, { kicker: yearsAgoLabel(primary.yearsAgo).replace(" today", ""), editable: true });
    if (rest.length) $("#lyMore").querySelectorAll(".ly-thumb").forEach((btn) => {
      const o = rest[+btn.dataset.i];
      btn.onclick = () => openViewer(o.rec, { kicker: yearsAgoLabel(o.yearsAgo).replace(" today", ""), editable: true });
    });
  } else if (!shotToday) {
    ly.innerHTML = `<div class="lastyear"><div class="ly-empty"><div><div style="font-size:26px">🌱</div><p class="tiny" style="margin-top:8px">A year from now, today's shot will greet you here.</p></div></div></div>`;
  }

  const core = $("#core");
  if (shotToday) {
    const url = URL.createObjectURL(shotToday.blob);
    core.innerHTML = `
      <div class="done-state">
        <button class="done-thumb-wrap" id="viewToday" aria-label="View today's photo">
          <img class="done-thumb" src="${url}" alt="Today's photo"/>
          <span class="done-expand">${svgIcon("expand")}</span>
        </button>
        <h2 style="font-size:19px">That's today.</h2>
        ${shotToday.caption
          ? `<p class="done-cap">"${escapeHtml(shotToday.caption)}"</p>`
          : ""}
        <p class="muted tiny" style="max-width:280px">${sealMessage()}</p>
        <div style="display:flex;gap:10px;margin-top:6px">
          <button class="btn ghost" id="capBtn">${shotToday.caption ? "Edit caption" : "Add caption"}</button>
          <button class="btn ghost" id="save">Save to Photos</button>
        </div>
      </div>`;
    $("#viewToday").onclick = () => openViewer(shotToday, { kicker: "Today", editable: true });
    $("#capBtn").onclick = () => openViewer(shotToday, { kicker: "Today", editable: true });
    $("#save").onclick = async () => {
      const ok = await saveToGallery(shotToday.blob, shotToday.date);
      if (ok) toast("Sent to the share sheet — tap Save Image");
    };
  } else {
    // shrinking-window ring + shutter
    core.innerHTML = `
      <div class="window" id="win">
        <div class="ring-wrap">
          <svg viewBox="0 0 120 120">
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="var(--sun-hot)"/><stop offset="1" stop-color="var(--sun)"/>
              </linearGradient>
            </defs>
            <circle class="ring-bg" cx="60" cy="60" r="52"/>
            <circle class="ring-fg" id="ringFg" cx="60" cy="60" r="52"/>
            <circle class="ring-tip" id="ringTip" cx="60" cy="8" r="5"/>
          </svg>
          <div class="ring-center">
            <div class="rc-time" id="left">–</div>
            <div class="lbl">left today</div>
          </div>
        </div>
        <p class="muted tiny" id="wintext" style="text-align:center;max-width:280px"></p>
        <button class="shutter" id="shutter">Take today's photo</button>
        <p class="tiny faint">One tap. No retakes.</p>
      </div>`;
    $("#shutter").onclick = () => { haptic(6); openCapture(); };
    tickWindow();
    homeTimer = setInterval(tickWindow, 1000);
  }

  // year strip
  const strip = $("#strip");
  if (State.app.settings.showStrip && State.app.firstCaptureDate) {
    const days = await buildTimeline();
    const shot = days.filter((d) => d.status === "shot").length;
    const missed = days.filter((d) => d.status === "missed").length;
    const dayNum = days.findIndex((d) => d.date === tKey) + 1;
    strip.innerHTML = `
      <div class="strip">
        <div class="strip-head">
          <span class="kicker">Day ${dayNum || "—"} of ${total}</span>
          <span class="tiny faint">${shot} captured · ${missed} missed</span>
        </div>
        <div class="dotgrid">${days.map((d) => `<span class="dot ${d.status === "shot" ? "shot" : d.status === "missed" ? "missed" : ""} ${d.date === tKey ? "today" : ""}"></span>`).join("")}</div>
      </div>`;
  }

  // storage-low nudge — surfaces only when space is tight, points to a backup
  checkStorage().then((w) => {
    const host = $("#lowstore");
    if (!host || !w) return;
    host.innerHTML = `<div class="lowstore"><div><b>Storage is running low</b><p class="tiny">Only ${Math.max(0, Math.round(w.freeMB))} MB free — export a backup so a year is never lost.</p></div><button class="pill" id="lowBackup">Back up</button></div>`;
    $("#lowBackup").onclick = async () => { haptic(6); try { await exportBackup(); } catch { toast("Backup failed — try again."); } };
  });
}

function sealMessage() {
  if (isSealed()) {
    const { reveal } = filmRange();
    const days = Math.max(0, Math.ceil((reveal - new Date()) / DAY_MS));
    return `Sealed. Your film unlocks in ${days} day${days === 1 ? "" : "s"}. See you tomorrow.`;
  }
  return "Your year is complete — the film is ready to watch.";
}

function tickWindow() {
  const left = $("#left"), ring = $("#ringFg"), tip = $("#ringTip"), txt = $("#wintext"), win = $("#win");
  if (!left) return;
  const now = new Date();
  const mid = nextMidnight();
  const msLeft = mid - now;
  const hrs = Math.floor(msLeft / 3600000);
  const mins = Math.floor((msLeft % 3600000) / 60000);
  const secs = Math.floor((msLeft % 60000) / 1000);

  // adaptive, live readout — seconds surface only in the final hour so it feels
  // calm through the day and quietly urgent as the window closes.
  left.textContent = hrs >= 1 ? `${hrs}h ${pad(mins)}m` : mins >= 1 ? `${mins}m ${pad(secs)}s` : `${secs}s`;

  // arc FILLS as the day elapses — like the sun tracking across the sky
  const elapsed = Math.min(1, Math.max(0, (DAY_MS - msLeft) / DAY_MS));
  const R = 52, C = 2 * Math.PI * R;
  ring.style.strokeDasharray = C;
  ring.style.strokeDashoffset = C * (1 - elapsed);

  // sun marker rides the leading edge of the filled arc (the shadow tip of the dial)
  const a = 2 * Math.PI * elapsed;
  if (tip) { tip.setAttribute("cx", (60 + R * Math.cos(a)).toFixed(2)); tip.setAttribute("cy", (60 + R * Math.sin(a)).toFixed(2)); }

  // layered urgency: calm → urgent (<3h) → critical (<1h)
  win.classList.toggle("urgent", hrs < 3);
  win.classList.toggle("critical", hrs < 1);
  ring.style.stroke = hrs < 1 ? "var(--danger)" : "url(#g)";
  if (hrs < 1) txt.textContent = `Under an hour before today locks forever — ${mins}m ${pad(secs)}s left.`;
  else if (hrs < 3) txt.textContent = `The window is closing — ${hrs}h ${pad(mins)}m until midnight.`;
  else if (hrs < 8) txt.textContent = `A quiet part of the day. ${hrs} hours left to capture it.`;
  else txt.textContent = `Plenty of day ahead. Wait for the moment that matters.`;
}

/* ---------------------------------------------------------------- CAPTURE */
let stream = null, facing = "environment", currentLens = "1", backLenses = {}, capturing = false;
async function openCapture() {
  // guard: never allow a second shot
  if (await DB.hasPhoto(todayKey())) { toast("You've already captured today."); render(); return; }

  const el = document.createElement("div");
  el.className = "capture"; el.id = "capture";
  el.innerHTML = `
    <video id="cam" autoplay muted playsinline></video>
    <div class="cap-grid" id="capGrid" ${State.app.settings.showGrid ? "" : "hidden"}><i></i><i></i><i></i><i></i></div>
    <div class="cap-datestamp" id="capStamp" ${State.app.settings.dateStamp ? "" : "hidden"}>${dateStampText()}</div>
    <div class="cap-top">
      <button class="x" id="cancel">${svgIcon("close")}</button>
      <span class="tiny" style="color:#fff;opacity:.8">One shot · no retake</span>
      <button class="x ${State.app.settings.showGrid ? "on" : ""}" id="gridToggle" aria-label="Framing grid" aria-pressed="${State.app.settings.showGrid}">${svgIcon("grid")}</button>
    </div>
    <div class="cap-hint" id="hint">Frame it. When you tap, it's kept.</div>
    <div class="cap-controls">
      <p class="cap-warn">This becomes your photo for<br>${prettyDate(new Date())}</p>
      <div class="lens-row" id="lensRow" hidden></div>
      <div class="cap-actionbar">
        <span class="cap-slot"></span>
        <button class="shutter-btn" id="snap" aria-label="Capture"></button>
        <button class="flip-btn" id="flip" aria-label="Flip camera">${svgIcon("flip")}</button>
      </div>
    </div>
    <div class="flash" id="flash"></div>`;
  document.body.appendChild(el);

  // start fresh each session: rear camera at 1× until we learn the lenses
  facing = "environment"; currentLens = "1"; backLenses = {}; capturing = false;

  $("#cancel").onclick = closeCapture;
  $("#gridToggle").onclick = async () => {
    const on = !State.app.settings.showGrid;
    State.app.settings.showGrid = on;
    $("#capGrid").hidden = !on;
    const g = $("#gridToggle"); g.classList.toggle("on", on); g.setAttribute("aria-pressed", on);
    haptic(6); await State.save();
  };
  $("#flip").onclick = async () => {
    facing = facing === "environment" ? "user" : "environment";
    currentLens = "1"; // zoom is a rear-camera notion; reset on flip
    haptic(6);
    await startCam();
  };
  $("#snap").onclick = commitShot;
  await startCam();
}

async function startCam() {
  const video = $("#cam");
  if (stream) stream.getTracks().forEach((t) => t.stop());
  const base = { width: { ideal: 2560 }, height: { ideal: 2560 } };
  // prefer the exact lens (e.g. the ultra-wide for 0.5×) when we know it
  const deviceId = facing === "environment" ? backLenses[currentLens] : null;
  const primary = deviceId
    ? { video: { deviceId: { exact: deviceId }, ...base }, audio: false }
    : { video: { facingMode: { ideal: facing }, ...base }, audio: false };
  try {
    stream = await navigator.mediaDevices.getUserMedia(primary);
    video.srcObject = stream;
  } catch (e) {
    // a stale deviceId (lens no longer available) — fall back to facingMode
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, ...base }, audio: false });
      video.srcObject = stream;
    } catch (e2) {
      $("#hint").innerHTML = `Camera is blocked.<br><span class="tiny">Enable it in Settings → Safari, then reopen.</span>`;
      $("#snap").disabled = true;
      return;
    }
  }
  // mirror the front camera so the preview reads like a mirror
  video.classList.toggle("mirror", facing === "user");
  // live look preview (WYSIWYG) — the same grade is baked in at capture
  video.style.filter = lookCss(State.app.settings.filmLook);
  await discoverLenses();
  updateLensUI();
}

/* enumerate the rear lenses once permission is granted so 0.5× can map to the
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

/* draw the lens pills — only meaningful when a 0.5× (ultra-wide) lens exists */
function updateLensUI() {
  const row = $("#lensRow");
  if (!row) return;
  const show = facing === "environment" && !!backLenses["0.5"];
  row.hidden = !show;
  if (!show) { row.innerHTML = ""; return; }
  const opts = [["0.5", "0.5×"], ["1", "1×"]];
  row.innerHTML = opts.map(([z, l]) => `<button class="lens-pill ${currentLens === z ? "on" : ""}" data-z="${z}">${l}</button>`).join("");
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
  // camera may still be warming up (e.g. just after a lens flip) — wait for a frame
  if (!video.videoWidth) {
    await new Promise((res) => {
      let done = false; const fin = () => { if (!done) { done = true; res(); } };
      video.addEventListener("loadeddata", fin, { once: true });
      setTimeout(fin, 1200);
    });
    if (!video.videoWidth) return; // still nothing — bail quietly, shutter stays live
  }
  capturing = true;
  snap.disabled = true;
  haptic(16);

  // grab the exact frame at native resolution
  const vw = video.videoWidth, vh = video.videoHeight;
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, CONFIG.PHOTO_MAX_DIM / Math.max(vw, vh));
  canvas.width = Math.round(vw * scale); canvas.height = Math.round(vh * scale);
  const cctx = canvas.getContext("2d");
  // bake in the chosen film look — via canvas filter where supported, else pixels
  const look = State.app.settings.filmLook || "none";
  const useCtxFilter = look !== "none" && ctxFilterSupported();
  if (useCtxFilter) cctx.filter = lookCss(look);
  // mirror the front camera so the saved frame matches the mirrored preview
  if (facing === "user") { cctx.translate(canvas.width, 0); cctx.scale(-1, 1); }
  cctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  cctx.filter = "none";
  cctx.setTransform(1, 0, 0, 1, 0, 0); // drop any mirror so effects & stamp draw upright
  if (look !== "none" && !useCtxFilter) applyLookPixels(cctx, canvas.width, canvas.height, look);
  // analog finish (grain/bloom/vignette/leak) then the retro date stamp — all baked in
  finishGrade(cctx, canvas, look, State.app.settings);
  if (State.app.settings.dateStamp) drawDateStamp(cctx, canvas.width, canvas.height, new Date());

  // flash + freeze the frame in place
  $("#flash").classList.add("go");
  const frozen = document.createElement("canvas");
  frozen.className = "frozen"; frozen.width = canvas.width; frozen.height = canvas.height;
  frozen.getContext("2d").drawImage(canvas, 0, 0);
  $("#capture").insertBefore(frozen, $("#capture").firstChild);
  video.style.display = "none";
  if (stream) stream.getTracks().forEach((t) => t.stop());

  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", CONFIG.JPEG_QUALITY));
  const dateKey = todayKey();

  // commit immediately — no confirm, no retake. This is the whole point.
  const rec = { date: dateKey, blob, meta: { moon: moonPhase(new Date()) }, createdAt: new Date().toISOString() };
  await DB.putPhoto(rec);
  if (!State.app.firstCaptureDate) { State.app.firstCaptureDate = dateKey; await State.save(); }

  // ambient metadata resolves in the background and merges into the record
  fetchAmbient().then((meta) =>
    DB.updatePhoto(dateKey, (rec) => { rec.meta = Object.assign(rec.meta || {}, meta); })
  ).catch(() => {});

  // optional: capture a few seconds of the moment's sound (viewer playback only)
  if (State.app.settings.captureSound) recordMoment(dateKey).catch(() => {});

  // done panel over the frozen frame
  const panel = document.createElement("div");
  panel.className = "commit";
  panel.innerHTML = `
    <p class="warn">Kept. This is <b>${prettyDate(new Date())}</b>.<br><span class="tiny" style="opacity:.8">Sealed into your year. No retakes.</span></p>
    <textarea class="commit-cap" id="commitCap" maxlength="180" rows="2" placeholder="Add a caption (optional)…"></textarea>
    <div class="row">
      <button class="btn ghost" id="gallery">Save to Photos</button>
      <button class="btn primary" id="done">Done</button>
    </div>`;
  $("#capture").appendChild(panel);
  $("#gallery").onclick = async () => { const ok = await saveToGallery(blob, dateKey); if (ok) toast("Tap Save Image in the share sheet"); };
  $("#done").onclick = async () => {
    const text = $("#commitCap")?.value.trim();
    if (text) await saveCaption(dateKey, text);
    closeCapture(); render();
  };
}

function closeCapture() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  capturing = false;
  $("#capture")?.remove();
  renderUpdateBanner();
}

/* ---------------------------------------------------------------- FULL-SCREEN VIEWER */
// Opens a single photo full-bleed with its date, ambient meta and caption.
// `opts.editable` (default true) lets the caption be added or amended in place.
// `opts.kicker` overrides the small label above the date (e.g. "One year ago").
function openViewer(rec, opts = {}) {
  if (!rec || !rec.blob) return;
  const editable = opts.editable !== false;
  const d = parseKey(rec.date);
  const url = URL.createObjectURL(rec.blob);
  const bits = ambientLine(rec.meta);

  const el = document.createElement("div");
  el.className = "viewer"; el.id = "viewer";
  el.innerHTML = `
    <img class="v-img" src="${url}" alt="Your photo from ${escapeHtml(shortDate(d))}" />
    <div class="v-top">
      <button class="iconbtn glass" id="vClose" aria-label="Close">${svgIcon("close")}</button>
      <div class="v-date"><span class="kicker">${escapeHtml(opts.kicker || "Captured")}</span><b>${prettyDate(d)}</b></div>
      <span style="width:42px"></span>
    </div>
    <div class="v-bottom">
      ${rec.audio ? `<button class="v-sound" id="vSound" aria-label="Play the moment's sound"><span class="vs-ico">${svgIcon("sound")}</span><span class="vs-txt">Play the moment</span></button>` : ""}
      ${bits ? `<div class="v-meta">${bits}</div>` : ""}
      <div class="v-cap" id="vCap"></div>
    </div>`;
  document.body.appendChild(el);

  // the moment's ambient sound — plays in full here (never in the montage film)
  let audioEl = null, audioUrl = null;
  if (rec.audio) {
    const btn = $("#vSound", el);
    audioUrl = URL.createObjectURL(rec.audio);
    audioEl = new Audio(audioUrl);
    const setIcon = (playing) => { btn.querySelector(".vs-ico").innerHTML = svgIcon(playing ? "pause" : "sound"); btn.querySelector(".vs-txt").textContent = playing ? "Playing…" : "Play the moment"; };
    audioEl.onended = () => setIcon(false);
    btn.onclick = (e) => {
      e.stopPropagation();
      if (audioEl.paused) { audioEl.play().then(() => setIcon(true)).catch(() => {}); }
      else { audioEl.pause(); setIcon(false); }
    };
  }

  let offEsc;
  const close = () => {
    offEsc?.();
    if (audioEl) { audioEl.pause(); audioEl.src = ""; }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    el.classList.add("out"); setTimeout(() => { el.remove(); URL.revokeObjectURL(url); }, 180); render();
  };
  offEsc = onEscape(close);
  $("#vClose", el).onclick = close;
  el.addEventListener("click", (e) => { if (e.target === el || e.target.classList.contains("v-img")) close(); });

  renderCaption($("#vCap", el), rec, editable);
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
        <textarea class="cap-input" maxlength="180" rows="2" placeholder="A word about today…">${escapeHtml(rec.caption || "")}</textarea>
        <div class="cap-actions">
          <button class="btn ghost sm" data-act="cancel">Cancel</button>
          <button class="btn primary sm" data-act="save">Save</button>
        </div>
      </div>`;
    const ta = host.querySelector(".cap-input");
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    host.querySelector('[data-act="cancel"]').onclick = () => { renderCaption(host, rec, editable); };
    host.querySelector('[data-act="save"]').onclick = async () => {
      const text = ta.value.trim();
      await saveCaption(rec.date, text);
      rec.caption = text;
      haptic(6);
      toast(text ? "Caption saved" : "Caption cleared");
      renderCaption(host, rec, editable);
    };
  }
  showRead();
}

/* ---------------------------------------------------------------- FILM / SEALED */
function renderFilm() {
  clearInterval(homeTimer);
  if (!State.app.firstCaptureDate) {
    app.innerHTML = shellBack(`
      <div class="sealed">
        <div class="lock-ring">${svgIcon("lock")}</div>
        <h2>Nothing to seal yet</h2>
        <p class="muted" style="max-width:280px">Take your first photo. Your film begins the day you do.</p>
        <button class="btn primary" id="go">Take today's photo</button>
      </div>`);
    $("#go").onclick = () => { view = "home"; render().then(openCapture); };
    bindBack();
    return;
  }

  if (isSealed()) {
    const { reveal, total } = filmRange();
    app.innerHTML = shellBack(`
      <div class="sealed">
        <div class="lock-ring">${svgIcon("lock")}</div>
        <span class="kicker">The sealed year</span>
        <div id="cd" class="countdown">—<small>until your film unlocks</small></div>
        <p class="muted" style="max-width:300px">A time capsule you're building blind. It reveals on <b>${shortDate(reveal)}</b> — all ${total} frames, gaps and all, in one sitting.</p>
      </div>`);
    bindBack();
    const cd = $("#cd");
    const tickCd = () => {
      const ms = reveal - new Date();
      if (ms <= 0) { render(); return; }
      const d = Math.floor(ms / DAY_MS), h = Math.floor((ms % DAY_MS) / 3600000), m = Math.floor((ms % 3600000) / 60000);
      cd.innerHTML = `${d}<span style="font-size:20px;color:var(--ink-dim)">d</span> ${pad(h)}<span style="font-size:20px;color:var(--ink-dim)">h</span> ${pad(m)}<span style="font-size:20px;color:var(--ink-dim)">m</span><small>until your film unlocks</small>`;
    };
    tickCd(); homeTimer = setInterval(tickCd, 30000);
    return;
  }

  // unlocked
  app.innerHTML = shellBack(`
    <div class="sealed">
      <div class="boot-sun" style="width:52px;height:52px"></div>
      <span class="kicker">Your year</span>
      <h2 style="font-size:24px">It's time.</h2>
      <p class="muted" style="max-width:300px">${filmRange().total} days, one frame each. The black frames are the days you missed — they belong here too.</p>
      <button class="btn primary wide" id="play">▶  Watch your film</button>
      <button class="btn ghost wide" id="poster" style="margin-top:10px">Save a poster of the year</button>
    </div>`);
  bindBack();
  $("#play").onclick = playFilm;
  $("#poster").onclick = async () => { const days = await buildTimeline(); await exportPoster(days); };
}

/* one-image contact sheet of the whole year — every day as a tile, missed days
   left dark. A keepsake you can print. */
async function exportPoster(days) {
  toast("Composing your poster…", 3000);
  const cw = 150, ch = Math.round(cw / CONFIG.ASPECT), gap = 5;
  const cols = Math.max(1, Math.ceil(Math.sqrt(days.length * CONFIG.ASPECT)));
  const rows = Math.ceil(days.length / cols);
  const padX = 70, padTop = 190, padBot = 96;
  const W = padX * 2 + cols * cw + (cols - 1) * gap;
  const H = padTop + rows * ch + (rows - 1) * gap + padBot;
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0e1116"; ctx.fillRect(0, 0, W, H);

  const { start, end } = filmRange();
  const yr = start.getFullYear() === end.getFullYear() ? `${start.getFullYear()}` : `${start.getFullYear()}–${end.getFullYear()}`;
  const shot = days.filter((d) => d.rec).length;
  ctx.textAlign = "left";
  ctx.fillStyle = "#f4c46b"; ctx.font = "600 62px -apple-system, system-ui, sans-serif";
  ctx.fillText("Sundial", padX, 96);
  ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = "400 30px -apple-system, system-ui, sans-serif";
  ctx.fillText(`${yr} · ${shot} of ${days.length} days`, padX, 142);

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
  const file = new File([blob], `sundial-poster-${start.getFullYear()}.jpg`, { type: "image/jpeg" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "My Sundial year" }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 6000);
}

function shellBack(inner) {
  return `<div class="screen"><div class="topbar"><button class="iconbtn" id="back">${svgIcon("close")}</button><span class="kicker">Film</span><span style="width:42px"></span></div>${inner}</div>`;
}
function bindBack() { const b = $("#back"); if (b) b.onclick = () => { view = "home"; render(); }; }

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

// paint the whole stage at time tMs into the film; returns the current day index
function paintFilm(ctx, W, H, days, bitmaps, tMs, frameMs, xfade) {
  const idx = Math.min(days.length - 1, Math.floor(tMs / frameMs));
  const into = tMs - idx * frameMs;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);

  const drawDay = (k, alpha) => {
    if (k < 0 || k >= days.length || alpha <= 0) return;
    ctx.globalAlpha = alpha;
    const bmp = bitmaps[k];
    if (bmp) {
      const r = Math.max(W / bmp.width, H / bmp.height);
      const dw = bmp.width * r, dh = bmp.height * r;
      ctx.drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      drawBlackText(ctx, W, H, days[k]);
    }
    ctx.globalAlpha = 1;
  };

  // crossfade: near the end of a frame, the next day fades UP underneath while
  // the current day fades OUT on top of it.
  const remaining = frameMs - into;
  const fading = idx < days.length - 1 && remaining < xfade;
  if (fading) {
    const a = 1 - remaining / xfade; // 0 → 1 across the dissolve
    drawDay(idx + 1, 1);             // incoming day, full
    drawDay(idx, 1 - a);            // outgoing day dissolves away
  } else {
    drawDay(idx, 1);
  }

  // overlay for the settled frame: fades in over first 35%, out over last 25%
  if (!fading) {
    const local = into / frameMs;
    const oa = Math.max(0, Math.min(1, local / 0.35) * Math.min(1, (1 - local) / 0.25));
    paintOverlay(ctx, W, H, days[idx], oa, !!bitmaps[idx]);
  }
  return idx;
}

async function playFilm() {
  clearInterval(homeTimer);
  const days = await buildTimeline();
  const W = 1080, H = Math.round(W / CONFIG.ASPECT);
  const frameMs = Math.max(CONFIG.FILM_MIN_FRAME_MS, CONFIG.FILM_FRAME_MS);
  const xfade = Math.min(CONFIG.FILM_CROSSFADE_MS, frameMs * 0.9);
  const totalMs = frameMs * days.length;

  const el = document.createElement("div");
  el.className = "player"; el.id = "player";
  el.innerHTML = `
    <canvas id="stage" width="${W}" height="${H}"></canvas>
    <div class="p-top"><button class="iconbtn" id="pClose">${svgIcon("close")}</button><span style="width:42px"></span></div>
    <div class="p-bar"><div class="p-progress"><i id="pFill"></i></div>
      <div class="p-controls"><button class="btn ghost" id="pReplay" style="display:none">Replay</button><button class="btn ghost" id="pSave" style="display:none">Save film</button></div>
    </div>`;
  document.body.appendChild(el);
  const canvas = $("#stage"), ctx = canvas.getContext("2d");
  $("#pClose").onclick = () => { stopPlay = true; el.remove(); renderUpdateBanner(); };

  // preload images (decode blobs to bitmaps)
  const bitmaps = await Promise.all(days.map(async (d) => {
    if (!d.rec) return null;
    try { return await createImageBitmap(d.rec.blob); } catch { return null; }
  }));

  let stopPlay = false, start = performance.now();
  const fill = $("#pFill");
  function loop(now) {
    if (stopPlay) return;
    const t = now - start;
    const idx = paintFilm(ctx, W, H, days, bitmaps, Math.min(t, totalMs - 1), frameMs, xfade);
    fill.style.width = `${Math.min(100, (t / totalMs) * 100)}%`;
    if (t >= totalMs) return endPlay();
    requestAnimationFrame(loop);
  }
  function endPlay() {
    // settle on the last day mid-frame so its overlay rests at full opacity
    paintFilm(ctx, W, H, days, bitmaps, (days.length - 1) * frameMs + frameMs * 0.5, frameMs, xfade);
    fill.style.width = "100%";
    $("#pReplay").style.display = ""; $("#pReplay").onclick = () => { start = performance.now(); $("#pReplay").style.display = "none"; $("#pSave").style.display = "none"; requestAnimationFrame(loop); };
    const saveBtn = $("#pSave");
    if (typeof MediaRecorder !== "undefined") {
      saveBtn.style.display = ""; saveBtn.onclick = () => exportFilm(days, bitmaps, frameMs, xfade, W, H);
    }
  }
  requestAnimationFrame(loop);
}

/* best-effort film export → share sheet / download (post-reveal only) */
// If video rendering can't run (or silently produces nothing — a known iOS
// installed-PWA MediaRecorder bug on warm launches), fall back to the poster so
// the payoff is never lost.
async function exportFilm(days, bitmaps, frameMs, xfade, W, H) {
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const mime = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported?.(m));
  // pre-flight: no recorder, no capture stream, or no encodable mime → poster
  if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function" || !mime) {
    toast("This device can't render video — saving a poster instead.", 3500);
    return exportPoster(days);
  }

  let fellBack = false;
  const fallback = (msg) => {
    if (fellBack) return; fellBack = true;
    toast(msg || "Couldn't render the film here — saving a poster instead. Reopening the app fresh (or Android) renders the video.", 4500);
    exportPoster(days);
  };

  let rec, stream;
  try {
    stream = canvas.captureStream(30);
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  } catch { return fallback(); }

  toast("Rendering film…", 3000);
  const chunks = [];
  const totalMs = frameMs * days.length;
  let watchdog = null, finished = false;
  const stopTracks = () => { try { stream.getTracks().forEach((t) => t.stop()); } catch {} };

  rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
  rec.onerror = () => { clearTimeout(watchdog); stopTracks(); fallback(); };
  rec.onstop = async () => {
    clearTimeout(watchdog); stopTracks();
    const size = chunks.reduce((n, c) => n + c.size, 0);
    if (!size) return fallback(); // recorder produced nothing — the iOS warm-launch failure
    const blob = new Blob(chunks, { type: mime });
    const ext = mime.includes("mp4") ? "mp4" : "webm";
    const file = new File([blob], `sundial-year.${ext}`, { type: mime });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: "My Sundial year" }); return; } catch (e) { if (e.name === "AbortError") return; } }
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  try { rec.start(); } catch { stopTracks(); return fallback(); }
  // watchdog: if it hasn't finished well past the expected runtime, bail to poster
  watchdog = setTimeout(() => { if (!finished) { try { rec.state !== "inactive" && rec.stop(); } catch { fallback(); } } }, totalMs + 8000);

  // drive the same painter in real time so the recorder captures the crossfades
  const t0 = performance.now();
  const step = () => {
    if (fellBack) return;
    const t = performance.now() - t0;
    if (t >= totalMs) { finished = true; paintFilm(ctx, W, H, days, bitmaps, totalMs - 1, frameMs, xfade); try { rec.state !== "inactive" && rec.stop(); } catch { fallback(); } return; }
    paintFilm(ctx, W, H, days, bitmaps, t, frameMs, xfade);
    requestAnimationFrame(step);
  };
  step();
}

/* ---------------------------------------------------------------- SETTINGS SHEET */
async function openSettings() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const used = est ? (est.usage / 1048576).toFixed(1) : "?";
  const s = State.app.settings;
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `
    <div class="sheet" role="dialog" aria-label="Settings">
      <div class="handle"></div>
      <h2>Sundial</h2>
      <p class="muted tiny" style="margin-bottom:12px">Everything lives on this phone. ${used} MB used.</p>

      <div class="settings-row">
        <div><div class="lbl">Daily reminder</div><div class="sub">A gentle nudge to take today's shot</div></div>
        <button class="pill" id="notif">Set up</button>
      </div>
      <div class="settings-row">
        <div><div class="lbl">Back up your year</div><div class="sub">Save every photo &amp; caption to one .zip file</div></div>
        <button class="pill" id="backup">Export</button>
      </div>
      <div class="settings-row">
        <div><div class="lbl">Restore from a backup</div><div class="sub">Bring a saved .zip onto this device</div></div>
        <button class="pill" id="restore">Import</button>
      </div>
      <div class="settings-row">
        <div><div class="lbl">Show the year strip</div><div class="sub">Dots for shot & missed days on the home screen</div></div>
        <button class="switch ${s.showStrip ? "on" : ""}" role="switch" aria-checked="${s.showStrip}" aria-label="Show the year strip" id="setStrip"><span class="knob"></span></button>
      </div>
      <div class="settings-row">
        <div><div class="lbl">Capture the moment's sound</div><div class="sub">A few seconds of audio, played back in the viewer</div></div>
        <button class="switch ${s.captureSound ? "on" : ""}" role="switch" aria-checked="${s.captureSound}" aria-label="Capture the moment's sound" id="setSound"><span class="knob"></span></button>
      </div>
      <div class="settings-row">
        <div><div class="lbl">Accent</div><div class="sub">The colour of the sun &amp; dial</div></div>
        <div class="accent-row" id="accentRow">${Object.entries(ACCENTS).map(([k, a]) => `<button class="swatch ${s.accent === k ? "on" : ""}" data-k="${k}" aria-label="${a.label}" style="background:linear-gradient(180deg, ${a.hot}, ${a.sun})"></button>`).join("")}</div>
      </div>
      <div class="settings-row" style="flex-wrap:wrap;gap:10px">
        <div><div class="lbl">Film look</div><div class="sub">A colour grade baked into each shot — permanent</div></div>
        <div class="look-row" id="lookRow">${Object.entries(FILM_LOOKS).map(([k, l]) => `<button class="look-pill ${s.filmLook === k ? "on" : ""}" data-k="${k}">${l.label}</button>`).join("")}</div>
      </div>
      <div class="settings-row">
        <div><div class="lbl">Date stamp</div><div class="sub">A retro amber date burned into the corner</div></div>
        <button class="switch ${s.dateStamp ? "on" : ""}" role="switch" aria-checked="${s.dateStamp}" aria-label="Date stamp" id="setStamp"><span class="knob"></span></button>
      </div>
      <div class="settings-row">
        <div><div class="lbl">Light leaks</div><div class="sub">A random warm flare, like an over-exposed roll</div></div>
        <button class="switch ${s.lightLeaks ? "on" : ""}" role="switch" aria-checked="${s.lightLeaks}" aria-label="Light leaks" id="setLeaks"><span class="knob"></span></button>
      </div>
      <div class="settings-row">
        <div><div class="lbl">Preview the film early</div><div class="sub">Breaks the seal — for testing only</div></div>
        <button class="switch ${s.devPreview ? "on" : ""}" role="switch" aria-checked="${s.devPreview}" aria-label="Preview the film early" id="setDev"><span class="knob"></span></button>
      </div>
      <div class="settings-row" style="border:none">
        <div><div class="lbl faint tiny">Year mode</div><div class="sub">${CONFIG.YEAR_MODE === "rolling" ? "365 days from your first photo" : "Calendar year · reveals Dec 31"}</div></div>
      </div>
      <button class="btn ghost block" id="close" style="margin-top:18px">Close</button>
      <p class="tiny faint" style="text-align:center;margin-top:14px">Made to be watched once, at the end.</p>
    </div>`;
  document.body.appendChild(bg);
  let offEsc;
  const close = () => { offEsc?.(); bg.remove(); };
  offEsc = onEscape(close);
  bg.onclick = (e) => { if (e.target === bg) close(); };
  $("#close", bg).onclick = close;
  // toggles flip in place (the sheet stays open) and re-render home behind it
  const flip = (btn, on) => { btn.classList.toggle("on", on); btn.setAttribute("aria-checked", on); haptic(6); };
  $("#setStrip", bg).onclick = async () => { s.showStrip = !s.showStrip; flip($("#setStrip", bg), s.showStrip); await State.save(); render(); };
  $("#setSound", bg).onclick = async () => {
    s.captureSound = !s.captureSound; flip($("#setSound", bg), s.captureSound);
    if (s.captureSound) toast("The next shot will keep a moment of sound.");
    await State.save();
  };
  $("#accentRow", bg).querySelectorAll(".swatch").forEach((sw) => {
    sw.onclick = async () => {
      s.accent = sw.dataset.k;
      $("#accentRow", bg).querySelectorAll(".swatch").forEach((o) => o.classList.toggle("on", o === sw));
      applyAccent(s.accent); haptic(6); await State.save(); render();
    };
  });
  $("#lookRow", bg).querySelectorAll(".look-pill").forEach((pill) => {
    pill.onclick = async () => {
      s.filmLook = pill.dataset.k;
      $("#lookRow", bg).querySelectorAll(".look-pill").forEach((o) => o.classList.toggle("on", o === pill));
      haptic(6); await State.save();
    };
  });
  $("#setStamp", bg).onclick = async () => { s.dateStamp = !s.dateStamp; flip($("#setStamp", bg), s.dateStamp); await State.save(); };
  $("#setLeaks", bg).onclick = async () => { s.lightLeaks = !s.lightLeaks; flip($("#setLeaks", bg), s.lightLeaks); await State.save(); };
  $("#setDev", bg).onclick = async () => { s.devPreview = !s.devPreview; flip($("#setDev", bg), s.devPreview); toast(s.devPreview ? "Seal broken (preview on)" : "Seal restored"); await State.save(); render(); };
  $("#backup", bg).onclick = async () => {
    haptic(6);
    try { await exportBackup(); } catch (e) { toast("Backup failed — please try again."); }
  };
  $("#restore", bg).onclick = () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".zip,application/zip";
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;
      if (!confirm("Restore this backup? It fills in any missing days and overwrites days that match.")) return;
      toast("Restoring…", 4000);
      try {
        const n = await importBackup(file);
        haptic(12);
        close();
        toast(`Restored ${n} photo${n === 1 ? "" : "s"}.`);
        render();
      } catch (e) { toast(e.message || "That file isn't a valid backup."); }
    };
    inp.click();
  };
  $("#notif", bg).onclick = async () => {
    let scheduled = false;
    if ("Notification" in window) {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        scheduled = await registerDailyNudge(); // serverless daily reminder on Android
        try { new Notification("Sundial", { body: scheduled ? "You'll get one gentle nudge a day." : "Reminders on. For a daily alarm on iPhone, add the Shortcut — see below." }); } catch {}
      }
    }
    close();
    if (scheduled) toast("Daily reminder is on.");
    else showNotifHelp(); // iOS can't self-schedule — walk the Shortcuts recipe
  };
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

function showNotifHelp() {
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `
    <div class="sheet">
      <div class="handle"></div>
      <h2>The daily nudge</h2>
      <p class="muted tiny" style="margin-bottom:14px">iPhone can't wake a web app on a timer, so use the built-in Shortcuts app once — free, no account.</p>
      <ol class="steps">
        <li>Open <b>Shortcuts</b> → <b>Automation</b> → <b>+</b> → <b>Time of Day</b>.</li>
        <li>Pick your time (e.g. <code class="inline">${State.app.settings.notifyTime}</code>), <b>Daily</b>, then <b>Run Immediately</b>.</li>
        <li>Add action <b>Show Notification</b>: “One shot for today — before it's gone.”</li>
        <li>Add action <b>Open App</b> → choose <b>Sundial</b> (your home-screen icon).</li>
        <li>Done. Each morning it pings you and opens straight to last year's shot.</li>
      </ol>
      <button class="btn primary block" id="ok" style="margin-top:16px">Got it</button>
    </div>`;
  document.body.appendChild(bg);
  bg.onclick = (e) => { if (e.target === bg) bg.remove(); };
  $("#ok", bg).onclick = () => bg.remove();
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
  b.innerHTML = `<span>A new version is ready.</span><button class="ub-btn">Reload</button>`;
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
  await State.load();
  applyAccent(State.app.settings.accent);
  await render();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then((reg) => {
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
  // refresh when returning to the app (new day, window shrank, etc.)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !$("#capture") && !$("#player")) { render(); renderUpdateBanner(); }
  });
}
boot();
