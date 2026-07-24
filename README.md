# Sundial ☀️

**One honest photo a day.** One tap — no retakes, no deletes, no second shot. Miss a day and it
becomes a black frame with the date. At the end of a 365-day cycle the app stitches every frame into
a ~30-second film you watch **once**. No feed, no likes, no scrolling.

It's a self-contained web app (PWA). Everything — every photo — lives **on your phone only**. There's
no server, no account, and nothing to pay for, ever.

---

## Get it on your iPhone (do this once)

The app just needs to live at an `https://` address so your phone can install it. Two free ways —
pick one:

### Option A — GitHub Pages (permanent, recommended)
1. Make a free account at [github.com](https://github.com) if you don't have one.
2. Create a new **public** repo, e.g. `sundial`.
3. Upload every file in this folder (`index.html`, `app.js`, `styles.css`, `sw.js`,
   `manifest.webmanifest`, and the `icons/` folder). Keep the structure — icons stay in `icons/`.
4. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / root → Save**.
5. Wait ~1 minute. Your app is at `https://<your-username>.github.io/sundial/`.

### Option B — Netlify Drop (fastest, no account needed to start)
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag this whole folder onto the page. It gives you an `https://…netlify.app` URL instantly.
   *(Make a free Netlify account to keep the URL from expiring.)*

### Then: Add to Home Screen
1. Open your URL in **Safari** on your iPhone.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open Sundial from the new home-screen icon. Tap **Begin**.
4. The first time you take a photo it'll ask for **Camera** and **Location** — allow both.
   *(Location is only for the weather/city/moon on each frame. It never leaves your phone.)*

> Installing from the home-screen icon matters — that's what makes it run full-screen, work offline,
> and store your photos durably.

---

## The daily reminder (one-time Shortcut)

iPhone won't let a web app wake itself on a schedule, so the gentle daily nudge uses Apple's built-in
**Shortcuts** app — free, no account. In the app: **Settings (gear) → Daily reminder → Set up** shows
these same steps:

1. Open **Shortcuts** → **Automation** tab → **+** → **Create Personal Automation** → **Time of Day**.
2. Choose your time (e.g. **09:00**), **Daily**, and **Run Immediately** (turn off "Ask Before Running").
3. **New Blank Automation** → add action **Show Notification** → text like
   *"One shot for today — before it's gone."*
4. Add action **Open App** → pick **Sundial**.
5. Save. Each morning it pings you and opens straight to *this day last year*.

---

## The rules (why it feels different)

| | |
|---|---|
| ☀️ **One shot** | One tap commits it instantly. No retake, no delete, no second photo that day. |
| ⏳ **The window shrinks** | A ring on the home screen empties as the day burns down. At **midnight** today locks forever. |
| ◼️ **Misses stay honest** | A skipped day becomes a **black frame with its date** in your film. The gaps are the point. |
| 🎞️ **Sealed** | You can't browse this year's shots or watch the film until the 365 days close. You build it blind. |
| 🕐 **This day last year** | Before you shoot, you see the same date one year ago — your only peek back. |
| 🌘 **Ambient memory** | Weather, city and moon phase ride quietly with each frame and surface only in the film. |

---

## Your data & privacy

- Photos are stored in your browser's **IndexedDB** on the phone. Nothing is uploaded, anywhere.
- The only network calls are **weather** (open-meteo.com) and **city name** (bigdatacloud.net) at the
  moment of capture, using your coordinates. Moon phase is computed on-device. If you're offline, the
  photo still saves and simply skips the weather/city.
- **Back up occasionally:** since it's local-only, a year is precious. Use **Save to Photos** after
  each shot (it also drops the JPEG into your iPhone gallery), or periodically export the site's
  storage. Don't "Clear Website Data" for this app or delete it from the Home Screen — that erases the
  photos.

---

## Tweak it (all in `app.js`, top of file)

```js
const CONFIG = {
  YEAR_MODE: "rolling",   // "rolling" = 365 days from your 1st photo.
                          // "calendar" = Jan 1→Dec 31, film reveals on Dec 31.
  FILM_TARGET_SECONDS: 30, // whole-year film runtime
  PHOTO_MAX_DIM: 1600,     // longest stored edge (storage vs. quality)
  JPEG_QUALITY: 0.86,
  ASPECT: 4 / 5,           // portrait frame the film is composed in
};
```

**Want to see the film before your year is up?** Settings → *Preview the film early* breaks the seal
(for testing only). Turn it back off to reseal.

---

## Test locally on your Mac first (optional)

```sh
cd Sundial
python3 -m http.server 8788
# open http://localhost:8788 in Safari/Chrome
```
Camera and install only work over `https://` on the phone — but the layout, capture, and film preview
all work on desktop `localhost`.

---

Made to be watched once, at the end. 🌇
