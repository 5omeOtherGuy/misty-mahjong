// Draws the tiles of the current set: the body and the back come from the
// set's material (render/materials.js), the 42 faces are canvas paths and
// brush-font glyphs in the set's palette. The symbols are drawn into a
// transparent layer that the material then composites in its own way
// (inlaid, carved, inside glass, under a glaze, as maki-e), so every set
// shows the same traditional faces. Finished sprites are cached per set,
// kind and size.

import { suitOf, rankOf, SUIT, KIND_COUNT } from '../tiles.js';
import { MATERIALS, roundRect } from './materials.js';
import { TILESETS, findTileSet } from '../tilesets.js';

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const WINDS = ['東', '南', '西', '北'];
const WIND_LETTERS = ['O', 'S', 'W', 'N'];
const FLOWERS = ['梅', '蘭', '菊', '竹'];
const SEASONS = ['春', '夏', '秋', '冬'];

export const BRUSH_FONT = 'NebelBrush';
export const DISPLAY_FONT = 'NebelDisplay';

/** Tile proportions: face w:h and the visible thickness relative to the width. */
export const TILE_ASPECT = 1.3;
export const THICKNESS = 0.11;
const SHADOW_PAD = 0.3;
export const BACK = -1;

const cache = new Map();
let current = TILESETS[0];

/** Selects the set every later sprite is drawn in; drops the old sprites. */
export function setTileSet(set) {
  if (set === current) return;
  current = set;
  cache.clear();
}

export function currentTileSet() {
  return current;
}

/**
 * Returns a canvas with the finished tile for `kind` (or BACK) at face width
 * `w` CSS pixels, rendered at `dpr`. `origin` gives where the face's
 * top-left corner lies in the canvas (CSS px) so the caller can position it.
 * `flat` gives the face plate alone, without thickness and shadow, for the
 * flip animation; `set` overrides the current set, for the picker.
 */
export function tileSprite(kind, w, dpr, options = {}) {
  const set = options.set ? findTileSet(options.set) : current;
  const key = `${set.id}:${kind}:${Math.round(w * dpr)}:${options.dim ? 'd' : ''}${options.flat ? 'f' : ''}`;
  let hit = cache.get(key);
  if (hit) return hit;
  const h = w * TILE_ASPECT;
  const d = options.flat ? 0 : w * THICKNESS;
  const pad = options.flat ? 0 : w * SHADOW_PAD;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((w + d + pad * 2) * dpr);
  canvas.height = Math.ceil((h + d + pad * 2) * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.translate(pad, pad);
  const g = { w, h, d: w * THICKNESS, r: w * 0.13, set, p: set.palette };
  const material = MATERIALS[set.material];
  if (kind === BACK) {
    material.back(ctx, g, options.flat);
  } else {
    material.body(ctx, g, options.flat);
    material.symbols(ctx, faceLayer(kind, w, h, dpr, set.palette), g);
    material.finish(ctx, g);
  }
  if (options.dim) {
    roundRect(ctx, 0, 0, w + d, h + d, g.r);
    ctx.fillStyle = set.dim;
    ctx.fill();
  }
  hit = { canvas, origin: pad, w, h, d };
  cache.set(key, hit);
  return hit;
}

export function backSprite(w, dpr, options = {}) {
  return tileSprite(BACK, w, dpr, options);
}

/** A soft shadow the size of a face, for tiles in flight. */
export function shadowSprite(w, dpr) {
  const key = `shadow:${Math.round(w * dpr)}`;
  let hit = cache.get(key);
  if (hit) return hit;
  const h = w * TILE_ASPECT, pad = w * 0.35;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((w + pad * 2) * dpr);
  canvas.height = Math.ceil((h + pad * 2) * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.shadowColor = 'rgba(10, 16, 14, 0.5)';
  ctx.shadowBlur = w * 0.3;
  ctx.fillStyle = 'rgba(10, 16, 14, 0.4)';
  roundRect(ctx, pad, pad, w, h, w * 0.13);
  ctx.fill();
  hit = { canvas, origin: pad, w, h };
  cache.set(key, hit);
  return hit;
}

export function clearSpriteCache() {
  cache.clear();
}

/** Every face of the set, for checks and previews. */
export function allKinds() {
  return Array.from({ length: KIND_COUNT }, (_, k) => k);
}

function faceLayer(kind, w, h, dpr, palette) {
  const layer = document.createElement('canvas');
  layer.width = Math.ceil(w * dpr);
  layer.height = Math.ceil(h * dpr);
  const ctx = layer.getContext('2d');
  ctx.scale(dpr, dpr);
  drawFace(ctx, kind, w, h, palette);
  return layer;
}

export function drawFace(ctx, kind, w, h, p = current.palette) {
  const suit = suitOf(kind);
  const rank = rankOf(kind);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  switch (suit) {
    case SUIT.CHARACTER:
      drawCharacter(ctx, rank, w, h, p);
      break;
    case SUIT.DOT:
      drawDots(ctx, rank, w, h, p);
      break;
    case SUIT.BAMBOO:
      drawBamboo(ctx, rank, w, h, p);
      break;
    case SUIT.WIND:
      drawWind(ctx, rank, w, h, p);
      break;
    case SUIT.DRAGON:
      drawDragon(ctx, rank, w, h, p);
      break;
    case SUIT.FLOWER:
      drawFlower(ctx, rank, w, h, p);
      break;
    case SUIT.SEASON:
      drawSeason(ctx, rank, w, h, p);
      break;
  }
  ctx.restore();
}

function glyph(ctx, text, x, y, size, color, font = BRUSH_FONT) {
  ctx.font = `${size}px "${font}", serif`;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawCharacter(ctx, rank, w, h, p) {
  glyph(ctx, NUMERALS[rank - 1], w / 2, h * 0.3, w * 0.46, p.ink);
  glyph(ctx, '萬', w / 2, h * 0.7, w * 0.5, p.red);
}

const DOT_LAYOUTS = {
  1: [[1, 1]],
  2: [[1, 0.35], [1, 1.65]],
  3: [[0.3, 0.3], [1, 1], [1.7, 1.7]],
  4: [[0.4, 0.4], [1.6, 0.4], [0.4, 1.6], [1.6, 1.6]],
  5: [[0.35, 0.35], [1.65, 0.35], [1, 1], [0.35, 1.65], [1.65, 1.65]],
  6: [[0.45, 0.2], [1.55, 0.2], [0.45, 1], [1.55, 1], [0.45, 1.8], [1.55, 1.8]],
  7: [[0.3, 0.1], [1, 0.4], [1.7, 0.7], [0.45, 1.25], [1.55, 1.25], [0.45, 1.9], [1.55, 1.9]],
  8: [[0.45, 0.1], [1.55, 0.1], [0.45, 0.7], [1.55, 0.7], [0.45, 1.3], [1.55, 1.3], [0.45, 1.9], [1.55, 1.9]],
  9: [[0.25, 0.25], [1, 0.25], [1.75, 0.25], [0.25, 1], [1, 1], [1.75, 1], [0.25, 1.75], [1, 1.75], [1.75, 1.75]],
};

function drawDots(ctx, rank, w, h, p) {
  const layout = DOT_LAYOUTS[rank];
  const colors = [p.green, p.red, p.ink];
  const radius = rank === 1 ? w * 0.3 : rank <= 4 ? w * 0.16 : w * 0.12;
  const cx = w / 2, cy = h / 2;
  const span = rank === 1 ? 0 : rank <= 4 ? w * 0.26 : w * 0.3;
  layout.forEach(([gx, gy], i) => {
    const x = cx + (gx - 1) * span;
    const y = cy + (gy - 1) * span * (rank >= 6 ? 1.15 : 1);
    const color = rank === 1 ? p.green : colors[(i + rank) % 3];
    dot(ctx, x, y, radius, color, rank === 1, p);
  });
}

function dot(ctx, x, y, r, color, big, p) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = p.paper;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = big ? p.red : color;
  ctx.fill();
  if (big) {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.82, 0, Math.PI * 2);
    ctx.strokeStyle = p.red;
    ctx.lineWidth = r * 0.07;
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 1.22, y + Math.sin(a) * r * 1.22, r * 0.09, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? p.ink : p.green;
      ctx.fill();
    }
  }
}

const BAMBOO_LAYOUTS = {
  2: [[1, 0.4], [1, 1.6]],
  3: [[1, 0.35], [0.4, 1.65], [1.6, 1.65]],
  4: [[0.45, 0.45], [1.55, 0.45], [0.45, 1.55], [1.55, 1.55]],
  5: [[0.35, 0.35], [1.65, 0.35], [1, 1], [0.35, 1.65], [1.65, 1.65]],
  6: [[0.3, 0.45], [1, 0.45], [1.7, 0.45], [0.3, 1.55], [1, 1.55], [1.7, 1.55]],
  7: [[1, 0.2], [0.3, 1], [1, 1], [1.7, 1], [0.3, 1.8], [1, 1.8], [1.7, 1.8]],
  8: [[0.3, 0.25], [1, 0.25], [1.7, 0.25], [0.6, 1], [1.4, 1], [0.3, 1.75], [1, 1.75], [1.7, 1.75]],
  9: [[0.3, 0.25], [1, 0.25], [1.7, 0.25], [0.3, 1], [1, 1], [1.7, 1], [0.3, 1.75], [1, 1.75], [1.7, 1.75]],
};

function drawBamboo(ctx, rank, w, h, p) {
  if (rank === 1) {
    drawBird(ctx, w, h, p);
    return;
  }
  const layout = BAMBOO_LAYOUTS[rank];
  const rows = Math.max(...layout.map((q) => q[1]));
  const stalkH = rank <= 3 ? h * 0.36 : rank <= 5 ? h * 0.3 : h * 0.24;
  const stalkW = rank <= 3 ? w * 0.16 : rank <= 5 ? w * 0.14 : w * 0.11;
  const spanX = w * 0.29;
  const spanY = (h * 0.72 - stalkH) / Math.max(1, rows - (rank === 2 ? 0.4 : 0.2));
  const cx = w / 2, cy = h / 2;
  layout.forEach(([gx, gy], i) => {
    const x = cx + (gx - 1) * spanX;
    const y = cy + (gy - 1) * spanY * (rank === 2 ? 0.95 : 0.78);
    const color = rank === 9 ? [p.green, p.red, p.ink][i % 3] : rank >= 7 && i === 0 ? p.red : p.green;
    stalk(ctx, x, y, stalkW, stalkH, color, p);
  });
}

function stalk(ctx, x, y, sw, sh, color, p) {
  ctx.fillStyle = color;
  roundRect(ctx, x - sw / 2, y - sh / 2, sw, sh, sw * 0.3);
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = p.paper;
  const gap = sh * 0.06;
  for (const f of [0.33, 0.66]) {
    ctx.fillRect(x - sw / 2 - sw * 0.08, y - sh / 2 + sh * f - gap / 2, sw * 1.16, gap);
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x - sw * 0.35, y - sh / 2 + sh * 0.08, sw * 0.18, sh * 0.2);
}

function drawBird(ctx, w, h, p) {
  // A small sparrow on a bamboo shoot, the classic one-bamboo.
  const cx = w / 2, cy = h * 0.5;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = p.green;
  ctx.lineWidth = w * 0.06;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-w * 0.05, h * 0.36);
  ctx.quadraticCurveTo(-w * 0.1, h * 0.1, w * 0.02, -h * 0.02);
  ctx.stroke();
  for (const [lx, ly, a] of [[-0.06, 0.22, -0.9], [0.0, 0.1, 0.8], [-0.07, 0.3, 0.6]]) {
    ctx.save();
    ctx.translate(w * lx, h * ly);
    ctx.rotate(a);
    ctx.fillStyle = p.green;
    ctx.beginPath();
    ctx.ellipse(w * 0.11, 0, w * 0.14, w * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = p.ink;
  ctx.beginPath();
  ctx.ellipse(w * 0.04, -h * 0.1, w * 0.24, w * 0.16, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(w * 0.22, -h * 0.25, w * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.gold;
  ctx.beginPath();
  ctx.moveTo(w * 0.31, -h * 0.26);
  ctx.lineTo(w * 0.42, -h * 0.235);
  ctx.lineTo(w * 0.31, -h * 0.215);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = p.ink;
  ctx.beginPath();
  ctx.moveTo(-w * 0.14, -h * 0.03);
  ctx.lineTo(-w * 0.4, -h * 0.17);
  ctx.lineTo(-w * 0.36, -h * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = p.red;
  ctx.beginPath();
  ctx.ellipse(w * 0.08, -h * 0.04, w * 0.13, w * 0.09, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.paper;
  ctx.beginPath();
  ctx.arc(w * 0.25, -h * 0.27, w * 0.025, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWind(ctx, rank, w, h, p) {
  glyph(ctx, WINDS[rank - 1], w / 2, h * 0.53, w * 0.66, p.ink);
  ctx.save();
  ctx.globalAlpha = p.cornerAlpha;
  ctx.font = `600 ${w * 0.2}px "${DISPLAY_FONT}", serif`;
  ctx.fillStyle = p.ink;
  ctx.textAlign = 'left';
  ctx.fillText(WIND_LETTERS[rank - 1], w * 0.1, h * 0.14);
  ctx.restore();
}

function drawDragon(ctx, rank, w, h, p) {
  if (rank === 1) glyph(ctx, '中', w / 2, h * 0.52, w * 0.7, p.red);
  else if (rank === 2) glyph(ctx, '發', w / 2, h * 0.52, w * 0.68, p.green);
  else {
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = w * 0.045;
    roundRect(ctx, w * 0.2, h * 0.2, w * 0.6, h * 0.6, w * 0.04);
    ctx.stroke();
    ctx.lineWidth = w * 0.02;
    roundRect(ctx, w * 0.29, h * 0.27, w * 0.42, h * 0.46, w * 0.02);
    ctx.stroke();
  }
}

function wash(ctx, w, h, color) {
  ctx.save();
  roundRect(ctx, w * 0.07, w * 0.07, w - w * 0.14, h - w * 0.14, w * 0.09);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function cornerNumber(ctx, n, w, h, color) {
  ctx.font = `600 ${w * 0.2}px "${DISPLAY_FONT}", serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.fillText(String(n), w * 0.11, h * 0.14);
  ctx.textAlign = 'center';
}

function drawFlower(ctx, rank, w, h, p) {
  wash(ctx, w, h, p.flowerWash);
  cornerNumber(ctx, rank, w, h, p.blush);
  const motif = [plum, orchid, chrysanthemum, bambooMotif][rank - 1];
  ctx.save();
  ctx.translate(w / 2, h * 0.38);
  motif(ctx, w, p);
  ctx.restore();
  glyph(ctx, FLOWERS[rank - 1], w / 2, h * 0.78, w * 0.3, p.ink);
}

function drawSeason(ctx, rank, w, h, p) {
  wash(ctx, w, h, p.seasonWash);
  cornerNumber(ctx, rank, w, h, p.gold);
  const motif = [sprout, sun, leaf, snowflake][rank - 1];
  ctx.save();
  ctx.translate(w / 2, h * 0.38);
  motif(ctx, w, p);
  ctx.restore();
  glyph(ctx, SEASONS[rank - 1], w / 2, h * 0.78, w * 0.3, p.seasonText);
}

function plum(ctx, w, p) {
  ctx.strokeStyle = p.branch;
  ctx.lineWidth = w * 0.04;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-w * 0.3, w * 0.22);
  ctx.quadraticCurveTo(-w * 0.05, w * 0.05, w * 0.3, -w * 0.18);
  ctx.stroke();
  for (const [x, y, s] of [[0.02, -0.02, 1], [-0.2, 0.12, 0.7], [0.22, -0.2, 0.55]]) {
    ctx.save();
    ctx.translate(w * x, w * y);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * w * 0.085 * s, Math.sin(a) * w * 0.085 * s, w * 0.07 * s, 0, Math.PI * 2);
      ctx.fillStyle = p.petal;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.04 * s, 0, Math.PI * 2);
    ctx.fillStyle = p.gold;
    ctx.fill();
    ctx.restore();
  }
}

function orchid(ctx, w, p) {
  ctx.strokeStyle = p.green;
  ctx.lineWidth = w * 0.045;
  ctx.lineCap = 'round';
  for (const [dx, cx, ty] of [[-0.02, -0.3, -0.3], [0.02, 0.28, -0.28], [0.0, -0.12, -0.36]]) {
    ctx.beginPath();
    ctx.moveTo(w * dx, w * 0.28);
    ctx.quadraticCurveTo(w * cx * 0.4, w * 0.05, w * cx, w * ty);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(w * 0.1, -w * 0.08);
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i / 3) * Math.PI * 2 - Math.PI / 2);
    ctx.fillStyle = p.orchid;
    ctx.beginPath();
    ctx.ellipse(w * 0.07, 0, w * 0.085, w * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = p.red;
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.03, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function chrysanthemum(ctx, w, p) {
  ctx.fillStyle = p.mum;
  for (let i = 0; i < 14; i++) {
    ctx.save();
    ctx.rotate((i / 14) * Math.PI * 2);
    ctx.beginPath();
    ctx.ellipse(w * 0.15, 0, w * 0.13, w * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = p.mumHeart;
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = p.green;
  ctx.lineWidth = w * 0.04;
  ctx.beginPath();
  ctx.moveTo(0, w * 0.1);
  ctx.lineTo(-w * 0.04, w * 0.34);
  ctx.stroke();
}

function bambooMotif(ctx, w, p) {
  for (const x of [-0.12, 0.1]) {
    stalk(ctx, w * x, 0, w * 0.1, w * 0.6, p.green, p);
  }
  ctx.fillStyle = p.green;
  for (const [x, y, a] of [[-0.12, -0.2, -0.9], [0.1, -0.05, 0.7], [0.1, 0.18, -0.6]]) {
    ctx.save();
    ctx.translate(w * x, w * y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(w * 0.14, 0, w * 0.15, w * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function sprout(ctx, w, p) {
  ctx.strokeStyle = p.green;
  ctx.lineWidth = w * 0.05;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, w * 0.32);
  ctx.quadraticCurveTo(w * 0.02, w * 0.05, 0, -w * 0.15);
  ctx.stroke();
  ctx.fillStyle = p.leaf;
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(0, -w * 0.08);
    ctx.rotate(s * 0.9);
    ctx.beginPath();
    ctx.ellipse(w * 0.16 * s, 0, w * 0.17, w * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = p.petal;
  ctx.beginPath();
  ctx.arc(0, -w * 0.2, w * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

function sun(ctx, w, p) {
  ctx.strokeStyle = p.sunRay;
  ctx.lineWidth = w * 0.04;
  ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * w * 0.22, Math.sin(a) * w * 0.22);
    ctx.lineTo(Math.cos(a) * w * (i % 2 ? 0.3 : 0.34), Math.sin(a) * w * (i % 2 ? 0.3 : 0.34));
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(-w * 0.05, -w * 0.05, 0, 0, 0, w * 0.17);
  g.addColorStop(0, p.sunLight);
  g.addColorStop(1, p.sunDeep);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.17, 0, Math.PI * 2);
  ctx.fill();
}

function leaf(ctx, w, p) {
  ctx.save();
  ctx.rotate(0.5);
  ctx.fillStyle = p.autumn;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    const a2 = a + Math.PI / 5;
    ctx.lineTo(Math.cos(a) * w * 0.3, Math.sin(a) * w * 0.3);
    ctx.lineTo(Math.cos(a2) * w * 0.12, Math.sin(a2) * w * 0.12);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = p.autumnVein;
  ctx.lineWidth = w * 0.025;
  ctx.beginPath();
  ctx.moveTo(0, w * 0.1);
  ctx.lineTo(0, -w * 0.27);
  ctx.moveTo(0, w * 0.1);
  ctx.lineTo(0, w * 0.34);
  ctx.stroke();
  ctx.restore();
}

function snowflake(ctx, w, p) {
  ctx.strokeStyle = p.snow;
  ctx.lineWidth = w * 0.035;
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.rotate((i / 6) * Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -w * 0.3);
    ctx.moveTo(0, -w * 0.18);
    ctx.lineTo(w * 0.08, -w * 0.25);
    ctx.moveTo(0, -w * 0.18);
    ctx.lineTo(-w * 0.08, -w * 0.25);
    ctx.stroke();
    ctx.restore();
  }
}
