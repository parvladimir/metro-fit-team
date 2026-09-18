// One-off script to (re)generate the app icon PNGs from a single hand-authored
// SVG design. Not part of the app's runtime — run manually with:
//   node scripts/generate-app-icon.mjs
// whenever the icon design changes. Requires `sharp` (devDependency).
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BG_DARK = '#04141A';
const BG_DARK_2 = '#08262C';
const BRAND = '#00D7F5';
const BRAND_DIM = '#00A6C2';

// Progress-ring + activity-pulse mark — deliberately reuses the app's own
// visual vocabulary (the dashboard's ProgressRing motif and the bottom nav's
// pulse-line Activity icon) so the home-screen icon reads as unmistakably
// "this app" rather than a generic fitness glyph. `scale` shrinks the
// foreground for the maskable variant, which needs everything inside the
// ~80% safe-zone circle since adaptive-icon masks can crop aggressively.
function buildIconSvg({ scale = 1 } = {}) {
  const cx = 256;
  const cy = 256;
  const ringR = 170 * scale;
  const ringStroke = 30 * scale;
  // Ring sweeps ~290° starting at the top, leaving a gap at bottom-right —
  // same "in-progress" language as the in-app ring, not a closed circle.
  const startAngle = -125;
  const endAngle = 165;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const ringStart = { x: cx + ringR * Math.cos(toRad(startAngle)), y: cy + ringR * Math.sin(toRad(startAngle)) };
  const ringEnd = { x: cx + ringR * Math.cos(toRad(endAngle)), y: cy + ringR * Math.sin(toRad(endAngle)) };
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  // Bold activity/pulse line, echoing BottomNav's ActivityIcon, scaled up.
  const pulseScale = 1.55 * scale;
  const pulsePoints = [
    [-58, 10], [-34, 10], [-20, -34], [4, 46], [20, -6], [30, 10], [58, 10],
  ].map(([x, y]) => [cx + x * pulseScale, cy + y * pulseScale]);
  const pulsePath = `M ${pulsePoints.map((p) => p.join(' ')).join(' L ')}`;

  return `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="${BG_DARK_2}"/>
      <stop offset="100%" stop-color="${BG_DARK}"/>
    </radialGradient>
    <linearGradient id="ring" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${BRAND}"/>
      <stop offset="100%" stop-color="${BRAND_DIM}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <path d="M ${ringStart.x.toFixed(2)} ${ringStart.y.toFixed(2)} A ${ringR.toFixed(2)} ${ringR.toFixed(2)} 0 ${largeArc} 1 ${ringEnd.x.toFixed(2)} ${ringEnd.y.toFixed(2)}"
    fill="none" stroke="url(#ring)" stroke-width="${ringStroke.toFixed(2)}" stroke-linecap="round"/>
  <circle cx="${ringEnd.x.toFixed(2)}" cy="${ringEnd.y.toFixed(2)}" r="${(ringStroke * 0.62).toFixed(2)}" fill="${BRAND}"/>
  <path d="${pulsePath}" fill="none" stroke="${BRAND}" stroke-width="${(20 * scale).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

const outDir = path.resolve(import.meta.dirname, '../public/icons');
await mkdir(outDir, { recursive: true });

const full = buildIconSvg({ scale: 1 });
const maskable = buildIconSvg({ scale: 0.72 });

async function render(svg, size, outPath, { flatten = false } = {}) {
  let img = sharp(Buffer.from(svg)).resize(size, size);
  if (flatten) img = img.flatten({ background: BG_DARK });
  await img.png().toFile(outPath);
  console.log('wrote', outPath);
}

await render(full, 512, path.join(outDir, 'icon-512.png'));
await render(full, 192, path.join(outDir, 'icon-192.png'));
await render(maskable, 512, path.join(outDir, 'icon-maskable-512.png'));
await render(full, 180, path.join(outDir, 'apple-touch-icon.png'), { flatten: true });
await render(full, 32, path.resolve(import.meta.dirname, '../public/favicon.png'));

// Also emit a plain SVG source next to the icons for future edits.
await writeFile(path.join(outDir, 'icon-source.svg'), full, 'utf-8');
console.log('done');
