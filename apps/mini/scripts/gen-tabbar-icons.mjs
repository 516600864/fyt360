/**
 * 生成 custom-tab-bar 图标（1:1 复刻 mini-01 设计稿底部菜单）。
 * 4 个业务图标 ×2 态（灰线性 / 白填充激活）+ FAB 金光四角星。
 * 用法：NODE_OPTIONS= node scripts/gen-tabbar-icons.mjs（需 workspace 里有 sharp）
 * 幂等：每次全量重写 custom-tab-bar-src/icons/*.png
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'custom-tab-bar-src', 'icons');
mkdirSync(outDir, { recursive: true });

const sharpPath = join(
  process.env.SHARP_WORKSPACE ?? 'C:/Users/ducun/.workbuddy/binaries/node/workspace',
  'node_modules', 'sharp', 'dist', 'index.cjs'
);
const { default: sharp } = await import(pathToFileURL(sharpPath).href);

const GRAY = '#4A4146';
const PINK = '#E8336D';

/** 48 viewBox 线性图标（描边 3.6 圆头） */
const svgHomeLine = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <path d="M7 23.5 L24 7.5 L41 23.5" fill="none" stroke="${GRAY}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M11.5 20.5 V40 H36.5 V20.5" fill="none" stroke="${GRAY}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const svgHomeFill = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <path d="M24 6.5 L42.5 23.5 H37.5 V40 H27.5 V30.5 H20.5 V40 H10.5 V23.5 H5.5 Z" fill="#FFFFFF"/>
</svg>`;

const svgGridLine = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" stroke="${GRAY}" stroke-width="3.6" stroke-linejoin="round">
  <rect x="7" y="7" width="15" height="15" rx="4.5"/>
  <rect x="26" y="7" width="15" height="15" rx="4.5"/>
  <rect x="7" y="26" width="15" height="15" rx="4.5"/>
  <rect x="26" y="26" width="15" height="15" rx="4.5"/>
</svg>`;

const svgGridFill = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="#FFFFFF">
  <rect x="7" y="7" width="15" height="15" rx="4.5"/>
  <rect x="26" y="7" width="15" height="15" rx="4.5"/>
  <rect x="7" y="26" width="15" height="15" rx="4.5"/>
  <rect x="26" y="26" width="15" height="15" rx="4.5"/>
</svg>`;

const svgRightsLine = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <path d="M13 6.5 H35 V41.5 L31.4 38.7 L27.8 41.5 L24.2 38.7 L20.6 41.5 L17 38.7 L13 41.5 Z" fill="none" stroke="${GRAY}" stroke-width="3.6" stroke-linejoin="round"/>
  <path d="M19 16.5 H29 M19 24 H26" fill="none" stroke="${GRAY}" stroke-width="3.6" stroke-linecap="round"/>
</svg>`;

const svgRightsFill = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <path d="M13 6.5 H35 V41.5 L31.4 38.7 L27.8 41.5 L24.2 38.7 L20.6 41.5 L17 38.7 L13 41.5 Z" fill="#FFFFFF"/>
  <path d="M19 16.5 H29 M19 24 H26" fill="none" stroke="${PINK}" stroke-width="3.6" stroke-linecap="round"/>
</svg>`;

const svgMineLine = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" stroke="${GRAY}" stroke-width="3.6" stroke-linecap="round">
  <circle cx="24" cy="15.5" r="6.8"/>
  <path d="M11 39.5 C11 31.5 16.6 26.5 24 26.5 C31.4 26.5 37 31.5 37 39.5"/>
</svg>`;

const svgMineFill = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="#FFFFFF">
  <circle cx="24" cy="15" r="7"/>
  <path d="M11.5 40 C11.5 32.5 17 27.5 24 27.5 C31 27.5 36.5 32.5 36.5 40 Z"/>
</svg>`;

/** FAB 金光四角星（大星 + 右上小星） */
const svgSparkle = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <path d="M23 9 Q25.4 20.6 37 23 Q25.4 25.4 23 37 Q20.6 25.4 9 23 Q20.6 20.6 23 9 Z" fill="#FFC53D"/>
  <path d="M23 14.5 Q24.4 21.4 31.5 23 Q24.4 24.6 23 31.5 Q21.6 24.6 14.5 23 Q21.6 21.4 23 14.5 Z" fill="#FFE08A"/>
  <path d="M37.5 8.5 Q38.4 12.9 42.5 14 Q38.4 15.1 37.5 19.5 Q36.6 15.1 32.5 14 Q36.6 12.9 37.5 8.5 Z" fill="#FFAA1D"/>
</svg>`;

const jobs = [
  ['home.png', svgHomeLine],
  ['home-active.png', svgHomeFill],
  ['life.png', svgGridLine],
  ['life-active.png', svgGridFill],
  ['rights.png', svgRightsLine],
  ['rights-active.png', svgRightsFill],
  ['mine.png', svgMineLine],
  ['mine-active.png', svgMineFill],
  ['sparkle.png', svgSparkle],
];

for (const [name, svg] of jobs) {
  const png = await sharp(Buffer.from(svg), { density: 300 }).resize(96, 96).png().toBuffer();
  writeFileSync(join(outDir, name), png);
  console.log('[gen-tabbar-icons]', name, png.length, 'bytes');
}
console.log('[gen-tabbar-icons] done →', outDir);
