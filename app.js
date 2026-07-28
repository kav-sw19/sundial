/* ============================================================================
   SUNDIAL — one honest photo a day.
   Pure client-side PWA. Photos never leave the device (IndexedDB).
   ============================================================================ */

const CONFIG = {
  // 'rolling'  = a 365-day year that starts on your FIRST photo, reveals 1yr later.
  // 'calendar' = Jan 1 → Dec 31 of the year you start (film seals until Dec 31).
  YEAR_MODE: "rolling",
  FILM_TARGET_SECONDS: 30,   // whole-year film runtime
  FILM_MIN_FRAME_MS: 60,     // never faster than this per frame
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
    this.app = (await DB.getMeta("app")) || {
      onboarded: false, firstCaptureDate: null, lastNudgeDate: null,
      settings: { showStrip: true, devPreview: false, notifyTime: "09:00" },
    };
    // migrate defaults
    this.app.settings = Object.assign({ showStrip: true, devPreview: false, notifyTime: "09:00" }, this.app.settings || {});
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
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${p[name] || ""}</svg>`;
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
  const lastYear = await DB.getPhoto(keyYearAgo());
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

    <div id="ly"></div>
    <div id="core"></div>
    <div id="strip"></div>
  </div>`;

  $("#toFilm").onclick = () => { view = "film"; render(); };
  $("#toSettings").onclick = openSettings;

  // This-day-last-year peek
  const ly = $("#ly");
  if (lastYear) {
    const url = URL.createObjectURL(lastYear.blob);
    const m = lastYear.meta || {};
    const bits = [m.weatherGlyph && `${m.weatherGlyph} ${m.tempC != null ? m.tempC + "°" : ""}`, m.city, m.moon?.glyph].filter(Boolean).join("  ·  ");
    ly.innerHTML = `
      <button class="lastyear" id="lyCard" aria-label="View last year's photo">
        <span class="ly-label">One year ago today</span>
        <span class="ly-expand">${svgIcon("expand")}</span>
        <img class="ly-img" src="${url}" alt="Your photo from a year ago" />
        <div class="ly-meta">
          ${lastYear.caption ? `<p class="ly-cap">${escapeHtml(lastYear.caption)}</p>` : ""}
          ${bits ? `<div class="ly-bits">${bits}</div>` : ""}
        </div>
      </button>`;
    $("#lyCard").onclick = () => openViewer(lastYear, { kicker: "One year ago", editable: true });
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
                <stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#ff8a3d"/>
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
    <div class="cap-top">
      <button class="x" id="cancel">${svgIcon("close")}</button>
      <span class="tiny" style="color:#fff;opacity:.8">One shot · no retake</span>
      <span style="width:40px"></span>
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
  // mirror the front camera so the saved frame matches the mirrored preview
  if (facing === "user") { cctx.translate(canvas.width, 0); cctx.scale(-1, 1); }
  cctx.drawImage(video, 0, 0, canvas.width, canvas.height);

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
      ${bits ? `<div class="v-meta">${bits}</div>` : ""}
      <div class="v-cap" id="vCap"></div>
    </div>`;
  document.body.appendChild(el);

  let offEsc;
  const close = () => { offEsc?.(); el.classList.add("out"); setTimeout(() => { el.remove(); URL.revokeObjectURL(url); }, 180); render(); };
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
    </div>`);
  bindBack();
  $("#play").onclick = playFilm;
}

function shellBack(inner) {
  return `<div class="screen"><div class="topbar"><button class="iconbtn" id="back">${svgIcon("close")}</button><span class="kicker">Film</span><span style="width:42px"></span></div>${inner}</div>`;
}
function bindBack() { const b = $("#back"); if (b) b.onclick = () => { view = "home"; render(); }; }

/* ---------------------------------------------------------------- FILM PLAYER */
async function playFilm() {
  clearInterval(homeTimer);
  const days = await buildTimeline();
  const W = 1080, H = Math.round(W / CONFIG.ASPECT);
  const frameMs = Math.max(CONFIG.FILM_MIN_FRAME_MS, Math.round((CONFIG.FILM_TARGET_SECONDS * 1000) / days.length));

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

  let i = 0, stopPlay = false, start = performance.now();
  function drawFrame(idx, overlayAlpha) {
    const day = days[idx], bmp = bitmaps[idx];
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    if (bmp) {
      // cover-fit
      const r = Math.max(W / bmp.width, H / bmp.height);
      const dw = bmp.width * r, dh = bmp.height * r;
      ctx.drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      // black frame — just the date, small & honest
      ctx.fillStyle = "rgba(255,255,255,.28)";
      ctx.font = "500 30px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(shortDate(day.d), W / 2, H / 2);
    }
    // subtle ambient overlays — date, caption & metadata, stacked bottom-up
    if (overlayAlpha > 0.02) {
      const PAD = 46;
      const caption = (day.rec?.caption || "").trim();
      const line = ambientLine(day.rec?.meta);
      ctx.textAlign = "left";
      ctx.font = "500 32px -apple-system, system-ui, sans-serif";
      const capLines = caption ? wrapText(ctx, caption, W - PAD * 2, 3) : [];

      // measure the block height so the gradient always fits it
      const blockH = 40 /*date*/ + (capLines.length ? 14 + capLines.length * 42 : 0) + (line ? 44 : 0);
      const gradH = blockH + 90;
      ctx.globalAlpha = overlayAlpha;
      if (bmp) {
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
  }

  const fill = $("#pFill");
  function loop(now) {
    if (stopPlay) return;
    const idx = Math.min(days.length - 1, Math.floor((now - start) / frameMs));
    // overlay fades in over first 35% of each frame, out over last 25%
    const local = ((now - start) % frameMs) / frameMs;
    const a = Math.min(1, local / 0.35) * Math.min(1, (1 - local) / 0.25);
    drawFrame(idx, Math.max(0, a));
    fill.style.width = `${((now - start) / (frameMs * days.length)) * 100}%`;
    if (idx >= days.length - 1 && local > 0.98) return endPlay();
    requestAnimationFrame(loop);
  }
  function endPlay() {
    drawFrame(days.length - 1, 1);
    $("#pReplay").style.display = ""; $("#pReplay").onclick = () => { start = performance.now(); $("#pReplay").style.display = "none"; $("#pSave").style.display = "none"; requestAnimationFrame(loop); };
    const saveBtn = $("#pSave");
    if (typeof MediaRecorder !== "undefined") {
      saveBtn.style.display = ""; saveBtn.onclick = () => exportFilm(days, bitmaps, frameMs, W, H);
    }
  }
  requestAnimationFrame(loop);
}

/* best-effort film export → share sheet / download (post-reveal only) */
async function exportFilm(days, bitmaps, frameMs, W, H) {
  toast("Rendering film…", 3000);
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const stream = canvas.captureStream(30);
  const mime = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported?.(m)) || "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = async () => {
    const blob = new Blob(chunks, { type: mime });
    const ext = mime.includes("mp4") ? "mp4" : "webm";
    const file = new File([blob], `sundial-year.${ext}`, { type: mime });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: "My Sundial year" }); return; } catch {} }
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  rec.start();
  // render each frame in real time so the recorder captures it
  let idx = 0;
  const step = () => {
    if (idx >= days.length) { rec.stop(); return; }
    const day = days[idx], bmp = bitmaps[idx];
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    if (bmp) { const r = Math.max(W / bmp.width, H / bmp.height); ctx.drawImage(bmp, (W - bmp.width * r) / 2, (H - bmp.height * r) / 2, bmp.width * r, bmp.height * r); }
    else { ctx.fillStyle = "rgba(255,255,255,.28)"; ctx.font = "500 30px system-ui"; ctx.textAlign = "center"; ctx.fillText(shortDate(day.d), W / 2, H / 2); }
    idx++;
    setTimeout(step, frameMs);
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
        <div><div class="lbl">Show the year strip</div><div class="sub">Dots for shot & missed days on the home screen</div></div>
        <button class="switch ${s.showStrip ? "on" : ""}" role="switch" aria-checked="${s.showStrip}" aria-label="Show the year strip" id="setStrip"><span class="knob"></span></button>
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
  $("#setDev", bg).onclick = async () => { s.devPreview = !s.devPreview; flip($("#setDev", bg), s.devPreview); toast(s.devPreview ? "Seal broken (preview on)" : "Seal restored"); await State.save(); render(); };
  $("#notif", bg).onclick = async () => {
    if ("Notification" in window) {
      const perm = await Notification.requestPermission();
      if (perm === "granted") { try { new Notification("Sundial", { body: "You'll be reminded here. For a daily alarm, add the Shortcut — see the README." }); } catch {} }
    }
    close();
    showNotifHelp();
  };
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
