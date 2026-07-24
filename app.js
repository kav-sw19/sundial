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
  return {
    putPhoto: (rec) => tx("photos", "readwrite", (s) => s.put(rec)),
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
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${p[name] || ""}</svg>`;
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
        <span class="kicker">Today</span>
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
      <div class="lastyear">
        <span class="ly-label">One year ago today</span>
        <img class="ly-img" src="${url}" alt="Your photo from a year ago" />
        ${bits ? `<div class="ly-meta">${bits}</div>` : ""}
      </div>`;
  } else if (!shotToday) {
    ly.innerHTML = `<div class="lastyear"><div class="ly-empty"><div><div style="font-size:26px">🌱</div><p class="tiny" style="margin-top:8px">A year from now, today's shot will greet you here.</p></div></div></div>`;
  }

  const core = $("#core");
  if (shotToday) {
    const url = URL.createObjectURL(shotToday.blob);
    core.innerHTML = `
      <div class="done-state">
        <img class="done-thumb" src="${url}" alt="Today's photo"/>
        <h2 style="font-size:19px">That's today.</h2>
        <p class="muted tiny" style="max-width:280px">${sealMessage()}</p>
        <div style="display:flex;gap:10px;margin-top:6px">
          <button class="btn ghost" id="save">Save to Photos</button>
        </div>
      </div>`;
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
            <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#ff8a3d"/>
            </linearGradient></defs>
            <circle class="ring-bg" cx="60" cy="60" r="52"/>
            <circle class="ring-fg" id="ringFg" cx="60" cy="60" r="52"/>
          </svg>
          <div class="ring-center"><div class="left" id="left">–</div><div class="lbl">left today</div></div>
        </div>
        <p class="muted tiny" id="wintext" style="text-align:center;max-width:280px"></p>
        <button class="shutter" id="shutter">Take today's photo</button>
        <p class="tiny faint">One tap. No retakes.</p>
      </div>`;
    $("#shutter").onclick = openCapture;
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
  const left = $("#left"), ring = $("#ringFg"), txt = $("#wintext"), win = $("#win");
  if (!left) return;
  const now = new Date();
  const mid = nextMidnight();
  const msLeft = mid - now;
  const hrs = Math.floor(msLeft / 3600000);
  const mins = Math.floor((msLeft % 3600000) / 60000);
  left.textContent = hrs >= 1 ? `${hrs}h` : `${mins}m`;
  const frac = msLeft / DAY_MS; // portion of a full day remaining
  const C = 2 * Math.PI * 52;
  ring.style.strokeDasharray = C;
  ring.style.strokeDashoffset = C * (1 - frac);
  // colour + urgency as the day burns down
  if (hrs < 1) { ring.style.stroke = "var(--danger)"; win.classList.add("urgent"); txt.textContent = `Under an hour before today locks forever — ${mins} min left.`; }
  else if (hrs < 3) { win.classList.add("urgent"); txt.textContent = `The window is closing — ${hrs}h ${mins}m until midnight.`; }
  else if (hrs < 8) { win.classList.remove("urgent"); txt.textContent = `A quiet part of the day. ${hrs} hours left to capture it.`; }
  else { win.classList.remove("urgent"); txt.textContent = `Plenty of day ahead. Wait for the moment that matters.`; }
}

/* ---------------------------------------------------------------- CAPTURE */
let stream = null, facing = "environment";
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
      <button class="shutter-btn" id="snap" aria-label="Capture"></button>
    </div>
    <button class="flip" id="flip" aria-label="Flip camera">${svgIcon("flip")}</button>
    <div class="flash" id="flash"></div>`;
  document.body.appendChild(el);

  $("#cancel").onclick = closeCapture;
  $("#flip").onclick = async () => { facing = facing === "environment" ? "user" : "environment"; await startCam(); };
  $("#snap").onclick = commitShot;
  await startCam();
}

async function startCam() {
  const video = $("#cam");
  if (stream) stream.getTracks().forEach((t) => t.stop());
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 2560 }, height: { ideal: 2560 } },
      audio: false,
    });
    video.srcObject = stream;
  } catch (e) {
    $("#hint").innerHTML = `Camera is blocked.<br><span class="tiny">Enable it in Settings → Safari, then reopen.</span>`;
    $("#snap").disabled = true;
  }
}

async function commitShot() {
  const video = $("#cam"), snap = $("#snap");
  if (!video?.videoWidth) return;
  snap.disabled = true;

  // grab the exact frame at native resolution
  const vw = video.videoWidth, vh = video.videoHeight;
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, CONFIG.PHOTO_MAX_DIM / Math.max(vw, vh));
  canvas.width = Math.round(vw * scale); canvas.height = Math.round(vh * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);

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

  // ambient metadata resolves in the background and updates the record
  fetchAmbient().then(async (meta) => {
    const fresh = await DB.getPhoto(dateKey);
    if (fresh) { fresh.meta = Object.assign(fresh.meta || {}, meta); await DB.putPhoto(fresh); }
  }).catch(() => {});

  // done panel over the frozen frame
  const panel = document.createElement("div");
  panel.className = "commit";
  panel.innerHTML = `
    <p class="warn">Kept. This is <b>${prettyDate(new Date())}</b>.<br><span class="tiny" style="opacity:.8">Sealed into your year. No retakes.</span></p>
    <div class="row">
      <button class="btn ghost" id="gallery">Save to Photos</button>
      <button class="btn primary" id="done">Done</button>
    </div>`;
  $("#capture").appendChild(panel);
  $("#gallery").onclick = async () => { const ok = await saveToGallery(blob, dateKey); if (ok) toast("Tap Save Image in the share sheet"); };
  $("#done").onclick = () => { closeCapture(); render(); };
}

function closeCapture() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  $("#capture")?.remove();
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
  $("#pClose").onclick = () => { stopPlay = true; el.remove(); };

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
    // subtle ambient overlays
    if (overlayAlpha > 0.02) {
      const m = day.rec?.meta || {};
      ctx.textAlign = "left";
      ctx.globalAlpha = overlayAlpha;
      const grd = ctx.createLinearGradient(0, H - 220, 0, H);
      grd.addColorStop(0, "rgba(0,0,0,0)"); grd.addColorStop(1, "rgba(0,0,0,.55)");
      if (bmp) { ctx.fillStyle = grd; ctx.fillRect(0, H - 220, W, 220); }
      ctx.fillStyle = "rgba(255,255,255,.92)";
      ctx.font = "600 34px -apple-system, system-ui, sans-serif";
      ctx.fillText(`${day.d.getDate()} ${MONTHS[day.d.getMonth()]}`, 46, H - 116);
      const line = [
        m.tempC != null ? `${m.weatherGlyph || ""} ${m.tempC}°` : (m.weatherText || ""),
        m.city, m.moon ? `${m.moon.glyph} ${m.moon.name}` : "",
      ].filter(Boolean).join("   ·   ");
      if (line) { ctx.font = "500 26px -apple-system, system-ui, sans-serif"; ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.fillText(line, 46, H - 70); }
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
        <button class="pill ${s.showStrip ? "on" : ""}" id="strip">${s.showStrip ? "On" : "Off"}</button>
      </div>
      <div class="settings-row">
        <div><div class="lbl">Preview the film early</div><div class="sub">Breaks the seal — for testing only</div></div>
        <button class="pill ${s.devPreview ? "on" : ""}" id="dev">${s.devPreview ? "On" : "Off"}</button>
      </div>
      <div class="settings-row" style="border:none">
        <div><div class="lbl faint tiny">Year mode</div><div class="sub">${CONFIG.YEAR_MODE === "rolling" ? "365 days from your first photo" : "Calendar year · reveals Dec 31"}</div></div>
      </div>
      <button class="btn ghost block" id="close" style="margin-top:18px">Close</button>
      <p class="tiny faint" style="text-align:center;margin-top:14px">Made to be watched once, at the end.</p>
    </div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.onclick = (e) => { if (e.target === bg) close(); };
  $("#close", bg).onclick = close;
  $("#strip", bg).onclick = async () => { s.showStrip = !s.showStrip; await State.save(); close(); render(); };
  $("#dev", bg).onclick = async () => { s.devPreview = !s.devPreview; await State.save(); toast(s.devPreview ? "Seal broken (preview on)" : "Seal restored"); close(); render(); };
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

/* ---------------------------------------------------------------- boot */
async function boot() {
  await State.load();
  await render();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  // refresh when returning to the app (new day, window shrank, etc.)
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("#capture") && !$("#player")) render(); });
}
boot();
