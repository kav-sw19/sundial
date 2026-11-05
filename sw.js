// Sundial service worker — offline app shell. Photos live in IndexedDB, never here.
const CACHE = "sundial-v11";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  // Precache the shell but DON'T auto-activate: a new worker waits until the
  // page tells it to take over (via the SKIP_WAITING message below), so the
  // update surfaces as a "Reload" prompt instead of a silent swap.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

// The page posts this when the user taps "Reload" on the update banner.
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // Only the app shell is ours to cache. Weather and city lookups go straight
  // to the network (always live, failing soft in the app).
  if (url.origin !== self.location.origin) return;
  // App shell: cache-first, fall back to network, refresh the cache behind it.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      const net = fetch(e.request).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(() =>
        // offline and not cached: a navigation still gets the app shell
        cached || (e.request.mode === "navigate" ? caches.match("./index.html") : Response.error())
      );
      return cached || net;
    })
  );
});

// Serverless daily reminder (Chrome/Android). Fires ~once a day; nudges only if
// today hasn't been captured yet. Reads the photos store directly — no network.
function hasShotToday() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const r = indexedDB.open("sundial", 1);
      // never create the database from here: if it doesn't exist yet, an empty
      // v1 DB would stop the app's own upgrade from ever creating its stores
      r.onupgradeneeded = () => { try { r.transaction.abort(); } catch {} finish(false); };
      r.onsuccess = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains("photos")) return finish(false);
        const d = new Date();
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const g = db.transaction("photos", "readonly").objectStore("photos").getKey(key);
        g.onsuccess = () => { finish(!!g.result); db.close(); };
        g.onerror = () => { finish(false); db.close(); };
      };
      r.onerror = () => finish(false);
    } catch { finish(false); }
  });
}
self.addEventListener("periodicsync", (e) => {
  if (e.tag !== "daily-nudge") return;
  e.waitUntil((async () => {
    if (await hasShotToday()) return; // already captured — stay quiet
    return self.registration.showNotification("Sundial", {
      body: "One shot for today, before the window closes.",
      icon: "./icons/icon-192.png", badge: "./icons/icon-192.png", tag: "daily-nudge",
    });
  })());
});

// Tapping the reminder focuses an open Sundial window, or opens one.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow("./?source=notif");
    })
  );
});
