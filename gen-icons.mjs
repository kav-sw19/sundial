// Dependency-free PNG icon generator for Sundial.
// Draws a dark dial face with a warm sun disc + gnomon. Emits maskable-safe PNGs.
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "icons");
fs.mkdirSync(OUT, { recursive: true });

const BG = [14, 17, 22];        // near-black navy
const RING = [42, 48, 60];      // dial ring
const SUN_HOT = [255, 214, 122]; // core
const SUN_EDGE = [255, 138, 61]; // rim
const GNOMON = [232, 236, 244];

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }

function drawIcon(S) {
  const buf = Buffer.alloc(S * S * 4);
  const cx = S * 0.5, cy = S * 0.46;
  const sunR = S * 0.24;
  const ringR = S * 0.36, ringW = S * 0.018;
  const put = (x, y, r, g, b, a = 255) => {
    const i = (y * S + x) * 4;
    // simple alpha-over onto existing
    const ea = buf[i + 3] / 255, sa = a / 255;
    const oa = sa + ea * (1 - sa);
    if (oa <= 0) return;
    buf[i]     = (r * sa + buf[i]     * ea * (1 - sa)) / oa;
    buf[i + 1] = (g * sa + buf[i + 1] * ea * (1 - sa)) / oa;
    buf[i + 2] = (b * sa + buf[i + 2] * ea * (1 - sa)) / oa;
    buf[i + 3] = oa * 255;
  };
  // background full-bleed (maskable safe)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    // subtle vertical gradient
    const t = y / S;
    buf[i] = lerp(BG[0], BG[0] + 6, t);
    buf[i + 1] = lerp(BG[1], BG[1] + 7, t);
    buf[i + 2] = lerp(BG[2], BG[2] + 10, t);
    buf[i + 3] = 255;
  }
  // dial ring (thin, cool)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    const edge = Math.abs(d - ringR);
    if (edge < ringW) {
      const a = (1 - edge / ringW) * 180;
      put(x, y, RING[0] + 30, RING[1] + 34, RING[2] + 42, a);
    }
  }
  // dial tick marks (12 around ring, hour marks)
  for (let k = 0; k < 12; k++) {
    const ang = (k / 12) * Math.PI * 2 - Math.PI / 2;
    const long = k % 3 === 0;
    const r0 = ringR - (long ? S * 0.05 : S * 0.03), r1 = ringR - S * 0.008;
    for (let r = r0; r <= r1; r += 0.5) {
      const x = Math.round(cx + Math.cos(ang) * r);
      const y = Math.round(cy + Math.sin(ang) * r);
      if (x >= 0 && y >= 0 && x < S && y < S) put(x, y, 120, 130, 150, 200);
    }
  }
  // sun disc with radial gradient + soft glow
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d < sunR) {
      const t = Math.min(1, d / sunR);
      const c = mix(SUN_HOT, SUN_EDGE, Math.pow(t, 1.3));
      put(x, y, c[0], c[1], c[2], 255);
    } else if (d < sunR + S * 0.06) {
      const g = 1 - (d - sunR) / (S * 0.06);
      put(x, y, SUN_EDGE[0], SUN_EDGE[1], SUN_EDGE[2], g * g * 120);
    }
  }
  // gnomon: shadow line from center to lower-right rim
  const gAng = Math.PI * 0.28;
  for (let r = 0; r < ringR - S * 0.02; r += 0.4) {
    const w = Math.max(1, S * 0.012 * (1 - r / ringR));
    const bx = cx + Math.cos(gAng) * r, by = cy + Math.sin(gAng) * r;
    for (let o = -w; o <= w; o += 0.6) {
      const x = Math.round(bx + Math.cos(gAng + Math.PI / 2) * o);
      const y = Math.round(by + Math.sin(gAng + Math.PI / 2) * o);
      if (x >= 0 && y >= 0 && x < S && y < S) put(x, y, GNOMON[0], GNOMON[1], GNOMON[2], 235);
    }
  }
  return buf;
}

function encodePNG(S, rgba) {
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunks = [];
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const crcTable = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

for (const S of [180, 192, 512]) {
  const png = encodePNG(S, drawIcon(S));
  fs.writeFileSync(path.join(OUT, `icon-${S}.png`), png);
  console.log("wrote icons/icon-" + S + ".png (" + png.length + " bytes)");
}
console.log("done");
