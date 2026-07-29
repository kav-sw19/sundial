<div align="center">

# Sundial ☀️

**One honest photo a day.**

A camera app that only lets you take one photo a day. That's it! One shot, no do-overs. Once you tap the shutter, that's your picture for the day. You can't retake it, you can't delete it, and you can't take a second one.

The idea is that because you only get one, you actually stop and think about it. Instead of snapping 40 near-identical photos you'll never look at, you capture the one thing that mattered that day: your coffee, your kid, the sky, a mess on the floor, whatever it was.

Then at the end of the year, the app stitches all 365 photos together into a short film, one quick frame per day, so you can watch your whole year play back in about half a minute.

It's the opposite of a normal camera or Instagram. There's no feed, no likes, no endless scrolling. Just one honest picture a day, and a little movie of your life at the end of it.

*No feed. No likes. No scrolling. Just your year, one honest frame at a time.*

**▶️ Try it: https://kav-sw19.github.io/sundial/** — open on your phone and add it to your home screen.

</div>

---

## Contents

- [What it is](#what-it-is)
- [The rules (and why they matter)](#the-rules-and-why-they-matter)
- [Get it on your phone](#get-it-on-your-phone) · [iPhone](#iphone) · [Android](#android)
- [The daily reminder](#the-daily-reminder)
- [How a day works](#how-a-day-works)
- [The film & the seal](#the-film--the-seal)
- [Your data & privacy](#your-data--privacy)
- [Make it your own (deploy your own copy)](#make-it-your-own-deploy-your-own-copy)
- [Customize it](#customize-it)
- [Troubleshooting & FAQ](#troubleshooting--faq)
- [How it's built](#how-its-built)

---

## What it is

Sundial is a camera that only lets you take **one photo a day**. That's the whole idea. Because you
only get one shot, you stop and *choose* — the coffee, the kid, the sky, the mess on the floor,
whatever actually mattered today — instead of firing off 40 near-identical photos you'll never look
at again.

You can't retake it. You can't delete it. You can't take a second one. And you can't rewatch your
year until it's done — you're building a time capsule **blind**. On the final day, your 365 frames
(gaps and all) play back as a short film of your life.

It's a **web app** you add to your phone's home screen. There's no app store, no account, no server,
and **nothing to pay for, ever**. Every photo lives only on your own phone.

---

## The rules (and why they matter)

| Rule | What happens | Why |
|---|---|---|
| ☀️ **One shot a day** | One tap commits your photo instantly. No retake, no delete, no second shot. | Scarcity makes you *choose the moment* instead of hoarding photos. |
| ⏳ **The window shrinks** | A ring on the home screen empties as the day burns down. At **midnight the day locks forever.** | Creates a small daily ritual: *"Have I taken it yet?"* |
| ◼️ **Misses stay honest** | A skipped day becomes a **black frame with its date** in your film. | The gaps are part of the story. Guilt and honesty as features, not something hidden. |
| 🎞️ **The year is sealed** | You can't browse this year's shots or watch the film until the 365 days close. | You build it blind — the reveal is the payoff. |
| 🕐 **This day, last year** | Before you shoot, you see the same date one year ago. | A single gentle look back, and the app's daily nudge. |
| 🌘 **It quietly remembers** | Weather, city, and moon phase are logged with each frame and surface only as subtle overlays in the film. | Ambient memory — never a dashboard, never stats to chase. |

---

## Get it on your phone

Sundial installs straight from the web — no app store. **You don't even have to deploy anything of
your own to use it:** just open the link below and add it to your home screen. Your photos are stored
privately on *your* device, so it's genuinely yours even on the shared link. (Prefer full control?
See [Make it your own](#make-it-your-own-deploy-your-own-copy).)

**Open this on your phone:** https://kav-sw19.github.io/sundial/

### iPhone
1. Open the link in **Safari** (it must be Safari, not Chrome, for install to work).
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Open **Sundial** from the new home-screen icon and tap **Begin**.
4. The first time you take a photo it asks for **Camera** and **Location** — allow both.

### Android
1. Open the link in **Chrome**.
2. Tap the **⋮** menu → **Install app** (or **Add to Home screen**), then confirm.
3. Open Sundial from the icon and tap **Begin**; allow **Camera** and **Location** when asked.

> **Why "add to home screen" matters:** launching from the installed icon is what makes Sundial run
> full-screen, work offline, and store your photos durably. Using it in a normal browser tab works,
> but the browser may clear its storage — don't trust a year to a tab.

---

## The daily reminder

Sundial sends a single gentle nudge each day to take your shot (and to peek at last year's).

- **Android:** the app can schedule this itself — just allow notifications when asked.
- **iPhone:** Apple doesn't let a web app wake itself on a timer, so you set up a free one-time
  automation using the built-in **Shortcuts** app. In Sundial, go to **⚙️ Settings → Daily reminder →
  Set up** for the exact steps, or:
  1. Open **Shortcuts** → **Automation** → **+** → **Create Personal Automation** → **Time of Day**.
  2. Pick a time (e.g. 9:00 AM), **Daily**, **Run Immediately** (turn off *Ask Before Running*).
  3. Add action **Show Notification** → e.g. *"One shot for today — before it's gone."*
  4. Add action **Open App** → choose **Sundial**. Save.

---

## How a day works

1. **A nudge arrives** (or you just open the app out of habit).
2. **You see one year ago today** — the same date's photo from last year, with its weather, city, and
   moon. (Empty for your first year — it fills in as you go.)
3. **The ring shows how much day is left.** Early on it's calm; as midnight nears it turns urgent.
4. **You take your shot** when the moment feels right. Tap the shutter **once** — that's it. It's
   saved instantly, no confirm screen, no retake.
5. **Optionally tap "Save to Photos"** to also drop a copy into your phone's gallery.
6. **You're done for the day.** If midnight passes and you never shot, that day becomes a black frame.

---

## The film & the seal

Your film is **sealed** — you cannot watch it, or browse individual shots, until your year completes.
That's the point: you're building it blind.

- **When does it unlock?** By default, 365 days after your **first** photo. (Start in July, reveal
  next July.) You can switch this to a calendar year that reveals on **Dec 31** — see
  [Customize it](#customize-it).
- **What's in it?** Every day of the year, one frame each, ~30 seconds total. Missed days appear as
  **black frames with the date** — honest gaps. Weather, city, and moon phase fade in subtly over each
  frame.
- **Watching it early (for testing):** **⚙️ Settings → Preview the film early** breaks the seal so you
  can check it works. Turn it back off to reseal.
- **Saving the film:** after it plays (once unlocked), a **Save film** button renders it to a video
  you can keep or share.

---

## Your data & privacy

- **Your photos never leave your phone.** They're stored in the browser's on-device database
  (IndexedDB). There is no server and no account — nothing is ever uploaded.
- **The only network calls** are, at the moment you take a photo: **weather** (open-meteo.com) and
  **city name** (bigdatacloud.net), looked up from your coordinates. Moon phase is calculated on your
  device. Offline? The photo still saves; it just skips weather/city.
- **A year is precious and it's local-only — back it up.** Two ways: tap **Save to Photos** after each
  shot so there's a copy in your gallery, and use **⚙️ Settings → Back up your year** to save *everything*
  (photos, captions, ambient data, and any sound) into one `.zip`. Move that file somewhere safe; on a
  new phone, **Settings → Restore from a backup** brings the whole year back. And **don't** clear the
  site's data or delete the home-screen icon, or the in-app photos are gone.

---

## Make it your own (deploy your own copy)

You can use the shared link forever, but hosting your own copy means you fully control it (and it can
never disappear on you). All three options below are **free**.

### Option A — Fork on GitHub + free Pages *(most permanent)*
1. Click **Fork** at the top of this repo (make a free GitHub account first if needed).
2. In your fork: **Settings → Pages → Build and deployment → Source: *Deploy from a branch* →
   `main` / `/ (root)` → Save.**
3. Wait ~1 minute. Your app is live at `https://<your-username>.github.io/sundial/`.
4. Open that URL on your phone and [add it to your home screen](#get-it-on-your-phone).

### Option B — Netlify Drop *(fastest, no GitHub)*
1. Download this repo as a ZIP (green **Code** button → **Download ZIP**) and unzip it.
2. Go to **[app.netlify.com/drop](https://app.netlify.com/drop)** and drag the unzipped folder onto
   the page. You instantly get an `https://…netlify.app` URL.
3. *(Make a free Netlify account to keep the URL from expiring.)*

### Option C — Run it on your computer *(to try or tinker)*
```sh
git clone https://github.com/kav-sw19/sundial.git
cd sundial
python3 -m http.server 8788
# open http://localhost:8788 in a browser
```
Layout, capture, and the film preview all work on desktop `localhost`. (Phone install and the camera
need a real `https://` address, i.e. Option A or B.)

> **No build step, no dependencies.** It's plain HTML/CSS/JavaScript. To change something, edit the
> files and re-deploy (or just refresh, locally). The one generated part — the app icons — can be
> rebuilt with `node gen-icons.mjs`.

---

## Customize it

Everything tweakable lives at the top of **`app.js`**:

```js
const CONFIG = {
  YEAR_MODE: "rolling",    // "rolling" = 365 days from your FIRST photo.
                           // "calendar" = Jan 1 → Dec 31; film reveals on Dec 31.
  FILM_FRAME_MS: 550,      // how long each frame holds in the film (calm, not snappy)
  FILM_CROSSFADE_MS: 300,  // gentle dissolve from one day into the next
  PHOTO_MAX_DIM: 1600,     // longest stored edge in px (quality vs. storage)
  JPEG_QUALITY: 0.86,      // 0–1
  ASPECT: 4 / 5,           // the portrait frame the film is composed in
};
```

Other easy touches: colours and type live in **`styles.css`** (the `:root` variables at the top);
the onboarding copy and the six rules are in the `renderOnboarding()` function in **`app.js`**.

After editing, re-deploy (push to your fork, or re-drop on Netlify). If a change doesn't appear on
your phone, it's the offline cache — fully close and reopen the app, and bump the `CACHE` name in
**`sw.js`** (e.g. `sundial-v2`) to force an update.

---

## Troubleshooting & FAQ

**"Add to Home Screen" isn't showing (iPhone).** You must be in **Safari**, not Chrome or an
in-app browser. Open the URL directly in Safari.

**The camera is black or blocked.** Grant camera access: iPhone **Settings → Safari → Camera → Allow**
(or **Settings → Sundial**), then reopen. On Android, Chrome will prompt — tap **Allow**.

**No weather or city on my frames.** That needs location + internet at the moment of capture. If you
denied location or were offline, the photo still saves — just without those overlays.

**Can I really not retake a bad photo?** No. That's the entire point of Sundial. Choose your moment.

**I missed a day. Can I backfill it?** No. It becomes a black frame with the date. The gaps are the
honest record of your year.

**Will I lose my photos?** Only if you clear the site's website data, delete the home-screen icon, or
your phone aggressively reclaims storage. Keep the icon installed and use **Save to Photos** as a
backup.

**Can two people share one deployment?** Yes — data is per-device, so everyone who installs the same
URL gets their own private, separate year on their own phone.

**Is my year visible to anyone?** No. A public *code* repo (if you fork) contains only the app's
source. Your photos are never in it and never uploaded anywhere.

---

## How it's built

A dependency-free Progressive Web App (PWA):

- **`index.html`** — app shell.
- **`app.js`** — all logic: capture, the one-a-day rules, storage, ambient metadata, the film player,
  and the seal. Photos are kept in **IndexedDB**; settings in a small metadata store.
- **`styles.css`** — the dark, filmic UI.
- **`sw.js`** — a service worker that caches the app shell so it works offline.
- **`manifest.webmanifest`** — makes it installable and full-screen.
- **`icons/`** — app icons, generated by **`gen-icons.mjs`** (pure Node, no libraries).

Free services used at capture time: **[Open-Meteo](https://open-meteo.com)** (weather) and
**[BigDataCloud](https://www.bigdatacloud.com)** (reverse-geocoding to a city name). Moon phase is
computed locally.

---

## License

[MIT](LICENSE) — do whatever you like with it: use it, fork it, modify it, share it. No warranty.
If you fork it, feel free to put your own name on your copy.

---

<div align="center">

*Made to be watched once, at the end.* 🌇

Use it, fork it, make it yours.

</div>
