// The five tile materials. Each renderer paints the tile body (plate, sides
// and shadow), composites the symbol layer onto it in the material's own way
// (inlaid, carved, floating inside glass, painted under a glaze, drawn in
// gold on lacquer), adds the finish (gloss, frost, iridescence) and draws the
// back. Everything is procedural: gradients, seeded noise and canvas paths,
// so the sets cost no image bytes and stay crisp at every size.
//
// Geometry passed to every renderer: { w, h, d, r } for the face width and
// height, the visible thickness and the corner radius, plus the set and its
// palette `p`. Light comes from the top left.

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ---- seeded textures ------------------------------------------------------

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noiseCache = new Map();

/**
 * A tileable grey value-noise texture: `cells` lattice points across `size`
 * pixels, three octaves. Drawn scaled up it gives soft clouds, drawn at
 * size it gives a fine grain.
 */
function noise(seed, size = 128, cells = 8) {
  const key = `${seed}:${size}:${cells}`;
  let c = noiseCache.get(key);
  if (c) return c;
  const rng = mulberry(seed);
  const octaves = [];
  for (let o = 0; o < 3; o++) {
    const n = cells << o;
    const grid = new Float32Array(n * n);
    for (let i = 0; i < grid.length; i++) grid[i] = rng();
    octaves.push({ n, grid });
  }
  c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.55, sum = 0;
      for (const { n, grid } of octaves) {
        const fx = (x / size) * n, fy = (y / size) * n;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = smooth(fx - x0), ty = smooth(fy - y0);
        const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
        const a = grid[y0 * n + x0], b = grid[y0 * n + x1];
        const cc = grid[y1 * n + x0], dd = grid[y1 * n + x1];
        v += amp * ((a + (b - a) * tx) * (1 - ty) + (cc + (dd - cc) * tx) * ty);
        sum += amp;
        amp *= 0.5;
      }
      const g = Math.round((v / sum) * 255);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  noiseCache.set(key, c);
  return c;
}

/** Draws noise clipped to the plate: `scale` 1 is fine grain, 4 soft clouds. */
function grain(ctx, g, { seed = 1, alpha = 0.1, scale = 1, mode = 'overlay', offset = 0 } = {}) {
  const n = noise(seed);
  ctx.save();
  roundRect(ctx, 0, 0, g.w, g.h, g.r);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = mode;
  const src = n.width / (scale * 1.3);
  const sx = (offset * 37) % Math.max(1, n.width - src);
  ctx.drawImage(n, sx, 0, src, Math.min(n.height, src * (g.h / g.w)), 0, 0, g.w, g.h);
  ctx.restore();
}

/** The tinted copy of a transparent layer, for carved shadows and halos. */
function tinted(layer, color) {
  const c = document.createElement('canvas');
  c.width = layer.width;
  c.height = layer.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(layer, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

// ---- shared body parts -----------------------------------------------------

function shadow(ctx, g, { alpha = 0.45, blur = 0.22 } = {}) {
  ctx.save();
  ctx.shadowColor = `rgba(12, 18, 16, ${alpha})`;
  ctx.shadowBlur = g.w * blur;
  ctx.shadowOffsetX = g.w * 0.06;
  ctx.shadowOffsetY = g.w * 0.1;
  ctx.fillStyle = '#5a5a5a';
  roundRect(ctx, g.d, g.d, g.w, g.h, g.r);
  ctx.fill();
  ctx.restore();
}

/**
 * The two visible sides: a body block behind the face, with the right side
 * shaded darker than the bottom. `layers` lists [stop, colour] pairs down
 * the side, so a two-layer tile shows its top material over its back.
 */
function sides(ctx, g, layers, { rightShade = 0.16 } = {}) {
  const grad = ctx.createLinearGradient(0, 0, 0, g.h + g.d);
  for (const [stop, color] of layers) grad.addColorStop(stop, color);
  ctx.fillStyle = grad;
  roundRect(ctx, g.d, g.d, g.w, g.h, g.r);
  ctx.fill();
  ctx.fillStyle = `rgba(20, 16, 10, ${rightShade})`;
  ctx.beginPath();
  ctx.moveTo(g.w, g.r);
  ctx.lineTo(g.w + g.d, g.r + g.d);
  ctx.lineTo(g.w + g.d, g.h + g.d - g.r);
  ctx.lineTo(g.w, g.h - g.r);
  ctx.closePath();
  ctx.fill();
}

function plate(ctx, g, stops) {
  const grad = ctx.createLinearGradient(0, 0, g.w * 0.4, g.h);
  for (const [stop, color] of stops) grad.addColorStop(stop, color);
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, g.w, g.h, g.r);
  ctx.fill();
}

/** A bevel around the face: light top-left, shaded bottom-right. */
function bevel(ctx, g, light = 0.9, dark = 0.28, width = 0.06, darkColor = '90,70,30') {
  ctx.save();
  roundRect(ctx, 0, 0, g.w, g.h, g.r);
  ctx.clip();
  const b = ctx.createLinearGradient(0, 0, g.w, g.h);
  b.addColorStop(0, `rgba(255,255,255,${light})`);
  b.addColorStop(0.3, 'rgba(255,255,255,0)');
  b.addColorStop(0.75, `rgba(${darkColor},0)`);
  b.addColorStop(1, `rgba(${darkColor},${dark})`);
  ctx.strokeStyle = b;
  ctx.lineWidth = g.w * width;
  roundRect(ctx, 0, 0, g.w, g.h, g.r);
  ctx.stroke();
  ctx.restore();
}

/** A soft specular band across the face, the sign of a polished surface. */
function gloss(ctx, g, { alpha = 0.3, at = 0.22, width = 0.16, angle = 0.9 } = {}) {
  ctx.save();
  roundRect(ctx, 0, 0, g.w, g.h, g.r);
  ctx.clip();
  const dx = Math.cos(angle) * g.w, dy = Math.sin(angle) * g.h;
  const grad = ctx.createLinearGradient(0, 0, dx * 1.6, dy * 1.6);
  grad.addColorStop(Math.max(0, at - width), 'rgba(255,255,255,0)');
  grad.addColorStop(at, `rgba(255,255,255,${alpha})`);
  grad.addColorStop(Math.min(1, at + width), 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, g.w, g.h);
  ctx.restore();
}

/** A small bright reflection in the top-left corner. */
function sparkle(ctx, g, alpha = 0.5, size = 0.16) {
  ctx.save();
  roundRect(ctx, 0, 0, g.w, g.h, g.r);
  ctx.clip();
  const x = g.w * 0.17, y = g.w * 0.14;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, g.w * size);
  grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, g.w, g.h);
  ctx.restore();
}

/** Darkens the rim of the plate, for depth in translucent materials. */
function vignette(ctx, g, color, alpha) {
  ctx.save();
  roundRect(ctx, 0, 0, g.w, g.h, g.r);
  ctx.clip();
  const grad = ctx.createRadialGradient(g.w / 2, g.h / 2, g.w * 0.3, g.w / 2, g.h / 2, g.h * 0.72);
  grad.addColorStop(0, `rgba(${color},0)`);
  grad.addColorStop(1, `rgba(${color},${alpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, g.w, g.h);
  ctx.restore();
}

function innerFrame(ctx, g, color, width = 0.014, inset = 0.045) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.6, g.w * width);
  roundRect(ctx, g.w * inset, g.w * inset, g.w - g.w * inset * 2, g.h - g.w * inset * 2, g.r * 0.7);
  ctx.stroke();
}

function layerAt(ctx, layer, g, dx, dy, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(layer, g.w * dx, g.w * dy, g.w, g.h);
  ctx.restore();
}

// ---- pearl: mother-of-pearl on dark lacquer ---------------------------------

function pearlSheen(ctx, g, strength) {
  ctx.save();
  roundRect(ctx, 0, 0, g.w, g.h, g.r);
  ctx.clip();
  // Curved bands of rose, mint, lavender and gold, the way nacre splits light.
  const bands = [
    ['255, 170, 190', 0.15, 0.1], ['170, 235, 215', 0.42, 0.55], ['190, 180, 245', 0.7, 0.3], ['255, 228, 170', 0.95, 0.8],
  ];
  bands.forEach(([rgb, at, cy], i) => {
    const cx = g.w * (-0.6 + i * 0.35), cyy = g.h * cy;
    const r0 = g.w * (0.6 + at * 0.8), r1 = r0 + g.w * 0.42;
    const grad = ctx.createRadialGradient(cx, cyy, r0, cx, cyy, r1);
    grad.addColorStop(0, `rgba(${rgb},0)`);
    grad.addColorStop(0.5, `rgba(${rgb},${strength})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, g.w, g.h);
  });
  ctx.restore();
}

const pearl = {
  body(ctx, g, flat) {
    if (!flat) {
      shadow(ctx, g);
      // A thin layer of nacre over a dark lacquer back.
      sides(ctx, g, [[0, '#f4f1ea'], [0.2, '#e4dfd2'], [0.22, '#3a3f4e'], [0.6, '#262a36'], [1, '#171a22']]);
    }
    plate(ctx, g, [[0, '#fdfcf9'], [0.5, '#f5f3ee'], [1, '#ebe8e1']]);
    pearlSheen(ctx, g, 0.2);
    grain(ctx, g, { seed: 11, alpha: 0.09, scale: 3, mode: 'soft-light' });
    grain(ctx, g, { seed: 12, alpha: 0.05, scale: 1 });
  },
  symbols(ctx, layer, g) {
    layerAt(ctx, tinted(layer, 'rgba(40, 30, 20, 0.22)'), g, 0.008, 0.01);
    layerAt(ctx, layer, g, 0, 0);
  },
  finish(ctx, g) {
    gloss(ctx, g, { alpha: 0.28, at: 0.2, width: 0.14 });
    bevel(ctx, g, 0.95, 0.22);
    innerFrame(ctx, g, 'rgba(90, 80, 70, 0.16)');
  },
  back(ctx, g, flat) {
    if (!flat) {
      shadow(ctx, g);
      sides(ctx, g, [[0, '#2b3040'], [0.5, '#1f232e'], [1, '#14171e']]);
    }
    plate(ctx, g, [[0, '#262b3a'], [0.5, '#1b1f2b'], [1, '#12141c']]);
    grain(ctx, g, { seed: 13, alpha: 0.08, scale: 2, mode: 'soft-light' });
    // Inlaid nacre: a crescent moon and a scatter of small stars.
    ctx.save();
    roundRect(ctx, 0, 0, g.w, g.h, g.r);
    ctx.clip();
    const cx = g.w * 0.5, cy = g.h * 0.44, mr = g.w * 0.24;
    ctx.beginPath();
    ctx.arc(cx, cy, mr, 0, Math.PI * 2);
    ctx.arc(cx + mr * 0.42, cy - mr * 0.3, mr * 0.86, 0, Math.PI * 2, true);
    const moon = ctx.createLinearGradient(cx - mr, cy - mr, cx + mr, cy + mr);
    moon.addColorStop(0, '#fbf7ee');
    moon.addColorStop(0.5, '#e8ecf0');
    moon.addColorStop(1, '#d6d2d8');
    ctx.fillStyle = moon;
    ctx.fill();
    ctx.globalCompositeOperation = 'source-atop';
    pearlSheen(ctx, g, 0.5);
    ctx.globalCompositeOperation = 'source-over';
    for (const [x, y, s] of [[0.2, 0.2, 1], [0.78, 0.3, 0.7], [0.3, 0.78, 0.8], [0.72, 0.8, 1], [0.84, 0.6, 0.5]]) {
      ctx.beginPath();
      ctx.arc(g.w * x, g.h * y, g.w * 0.02 * s, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(236, 232, 240, 0.9)';
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(220, 214, 224, 0.5)';
    ctx.lineWidth = Math.max(0.6, g.w * 0.012);
    roundRect(ctx, g.w * 0.07, g.w * 0.07, g.w - g.w * 0.14, g.h - g.w * 0.14, g.r * 0.6);
    ctx.stroke();
    gloss(ctx, g, { alpha: 0.14, at: 0.24, width: 0.18 });
    bevel(ctx, g, 0.35, 0.3, 0.05, '0,0,0');
  },
};

// ---- jade: pale polished stone with deeper veins ----------------------------

function jadeStone(ctx, g, stops, seed) {
  plate(ctx, g, stops);
  grain(ctx, g, { seed, alpha: 0.45, scale: 4, mode: 'soft-light' });
  grain(ctx, g, { seed: seed + 1, alpha: 0.22, scale: 2.2, mode: 'overlay', offset: 3 });
  // A few translucent veins deeper in the stone.
  ctx.save();
  roundRect(ctx, 0, 0, g.w, g.h, g.r);
  ctx.clip();
  ctx.strokeStyle = 'rgba(40, 100, 70, 0.16)';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(40, 100, 70, 0.5)';
  ctx.shadowBlur = g.w * 0.04;
  const rng = mulberry(seed * 7);
  for (let i = 0; i < 3; i++) {
    ctx.lineWidth = g.w * (0.012 + rng() * 0.02);
    const y0 = g.h * (0.15 + rng() * 0.7);
    ctx.beginPath();
    ctx.moveTo(-g.w * 0.1, y0);
    ctx.bezierCurveTo(g.w * 0.3, y0 + g.h * (rng() - 0.5) * 0.5, g.w * 0.6, y0 + g.h * (rng() - 0.5) * 0.5, g.w * 1.1, y0 + g.h * (rng() - 0.5) * 0.4);
    ctx.stroke();
  }
  ctx.restore();
  vignette(ctx, g, '30, 80, 55', 0.3);
}

const jade = {
  body(ctx, g, flat) {
    if (!flat) {
      shadow(ctx, g, { alpha: 0.42 });
      sides(ctx, g, [[0, '#8fc3a0'], [0.4, '#5f9a76'], [1, '#35624a']], { rightShade: 0.2 });
    }
    jadeStone(ctx, g, [[0, '#e3f0df'], [0.5, '#c2dcc2'], [1, '#a4c6a8']], 21);
  },
  symbols(ctx, layer, g) {
    // Carved into the stone and filled with pigment: a light rim where the
    // cut catches the light, a shadow where it falls away.
    layerAt(ctx, tinted(layer, 'rgba(255, 255, 255, 0.7)'), g, -0.007, -0.007);
    layerAt(ctx, tinted(layer, 'rgba(10, 40, 25, 0.5)'), g, 0.01, 0.012);
    layerAt(ctx, layer, g, 0, 0, 0.96);
  },
  finish(ctx, g) {
    sparkle(ctx, g, 0.4, 0.3);
    gloss(ctx, g, { alpha: 0.16, at: 0.3, width: 0.2 });
    bevel(ctx, g, 0.8, 0.3, 0.06, '20,60,40');
  },
  back(ctx, g, flat) {
    if (!flat) {
      shadow(ctx, g, { alpha: 0.42 });
      sides(ctx, g, [[0, '#7cb08c'], [0.4, '#4f8a66'], [1, '#2c553f']], { rightShade: 0.2 });
    }
    jadeStone(ctx, g, [[0, '#9ccaa8'], [0.5, '#6fa882'], [1, '#4d8663']], 23);
    // A carved lattice of linked rings, an old and anonymous pattern.
    ctx.save();
    roundRect(ctx, g.w * 0.09, g.w * 0.09, g.w - g.w * 0.18, g.h - g.w * 0.18, g.r * 0.5);
    ctx.clip();
    const step = g.w * 0.2, rad = step * 0.5;
    const rings = (color, dx, dy, lw) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      for (let y = -1; y < g.h / step + 1; y++) {
        for (let x = -1; x < g.w / step + 1; x++) {
          ctx.beginPath();
          ctx.arc(g.w * 0.5 + x * step + dx, g.h * 0.5 + y * step + dy, rad, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(g.w * 0.5 + (x + 0.5) * step + dx, g.h * 0.5 + (y + 0.5) * step + dy, rad, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    };
    rings('rgba(255,255,255,0.35)', -g.w * 0.006, -g.w * 0.006, g.w * 0.012);
    rings('rgba(15, 50, 30, 0.45)', g.w * 0.006, g.w * 0.006, g.w * 0.012);
    rings('rgba(30, 80, 50, 0.4)', 0, 0, g.w * 0.008);
    ctx.restore();
    ctx.strokeStyle = 'rgba(15, 50, 30, 0.35)';
    ctx.lineWidth = g.w * 0.014;
    roundRect(ctx, g.w * 0.09, g.w * 0.09, g.w - g.w * 0.18, g.h - g.w * 0.18, g.r * 0.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    roundRect(ctx, g.w * 0.08, g.w * 0.08, g.w - g.w * 0.18, g.h - g.w * 0.18, g.r * 0.5);
    ctx.stroke();
    sparkle(ctx, g, 0.3, 0.3);
    gloss(ctx, g, { alpha: 0.14, at: 0.3, width: 0.2 });
    bevel(ctx, g, 0.7, 0.3, 0.06, '20,60,40');
  },
};

// ---- sea glass: frosted aqua glass with the symbols inside ------------------

function glassPlate(ctx, g, seed) {
  plate(ctx, g, [[0, '#c4ebe2'], [0.5, '#9bd4c8'], [1, '#7fbfb2']]);
  // Light trapped in the glass: brighter in the middle, deeper at the rim.
  ctx.save();
  roundRect(ctx, 0, 0, g.w, g.h, g.r);
  ctx.clip();
  const core = ctx.createRadialGradient(g.w * 0.45, g.h * 0.42, 0, g.w * 0.5, g.h * 0.5, g.h * 0.6);
  core.addColorStop(0, 'rgba(255,255,255,0.32)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, g.w, g.h);
  ctx.restore();
  grain(ctx, g, { seed, alpha: 0.28, scale: 1, mode: 'overlay' });
  grain(ctx, g, { seed: seed + 1, alpha: 0.18, scale: 3, mode: 'soft-light', offset: 2 });
  vignette(ctx, g, '20, 90, 85', 0.32);
  // A few tiny bubbles.
  ctx.save();
  roundRect(ctx, 0, 0, g.w, g.h, g.r);
  ctx.clip();
  const rng = mulberry(seed * 3);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = Math.max(0.5, g.w * 0.008);
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(g.w * rng(), g.h * rng(), g.w * (0.008 + rng() * 0.012), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function glassSurface(ctx, g) {
  // The frosted, worn rim and the reflections on the surface above the motif.
  ctx.save();
  roundRect(ctx, 0, 0, g.w, g.h, g.r);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = g.w * 0.07;
  ctx.shadowColor = 'rgba(255,255,255,0.6)';
  ctx.shadowBlur = g.w * 0.05;
  roundRect(ctx, 0, 0, g.w, g.h, g.r);
  ctx.stroke();
  ctx.restore();
  gloss(ctx, g, { alpha: 0.2, at: 0.18, width: 0.12, angle: 0.8 });
  gloss(ctx, g, { alpha: 0.08, at: 0.62, width: 0.08, angle: 0.8 });
  sparkle(ctx, g, 0.55, 0.14);
  bevel(ctx, g, 0.7, 0.22, 0.05, '10,60,60');
}

const seaglass = {
  body(ctx, g, flat) {
    if (!flat) {
      shadow(ctx, g, { alpha: 0.4 });
      // Light passes through the sides: they glow lighter than the face rim.
      sides(ctx, g, [[0, '#b7e6dc'], [0.5, '#86c9bc'], [1, '#5ea596']], { rightShade: 0.12 });
    }
    glassPlate(ctx, g, 31);
  },
  symbols(ctx, layer, g) {
    // The motif sits inside the glass: a soft pale halo around it (light
    // scattering in the frost), a faint refracted echo below, then the
    // symbol itself, still crisp.
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.filter = `blur(${Math.max(0.6, g.w * 0.02)}px)`;
    ctx.drawImage(tinted(layer, 'rgba(255,255,255,0.9)'), -g.w * 0.004, -g.w * 0.004, g.w * 1.008, g.h * 1.008);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.filter = `blur(${Math.max(0.5, g.w * 0.012)}px)`;
    ctx.drawImage(tinted(layer, 'rgba(10, 40, 50, 1)'), g.w * 0.016, g.w * 0.022, g.w, g.h);
    ctx.restore();
    layerAt(ctx, layer, g, 0, 0, 0.94);
  },
  finish(ctx, g) {
    glassSurface(ctx, g);
  },
  back(ctx, g, flat) {
    if (!flat) {
      shadow(ctx, g, { alpha: 0.4 });
      sides(ctx, g, [[0, '#b7e6dc'], [0.5, '#86c9bc'], [1, '#5ea596']], { rightShade: 0.12 });
    }
    glassPlate(ctx, g, 33);
    // Sand-blasted into the back: a pebble above three ripples.
    ctx.save();
    roundRect(ctx, 0, 0, g.w, g.h, g.r);
    ctx.clip();
    ctx.lineCap = 'round';
    const etch = (dx, dy, color, lw) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      for (let i = 0; i < 3; i++) {
        const rr = g.w * (0.18 + i * 0.13);
        ctx.beginPath();
        ctx.arc(g.w * 0.5 + dx, g.h * 0.78 + dy, rr, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(g.w * 0.5 + dx, g.h * 0.3 + dy, g.w * 0.085, 0, Math.PI * 2);
      ctx.stroke();
    };
    etch(g.w * 0.008, g.w * 0.01, 'rgba(15, 70, 70, 0.35)', g.w * 0.03);
    ctx.shadowColor = 'rgba(255,255,255,0.8)';
    ctx.shadowBlur = g.w * 0.02;
    etch(0, 0, 'rgba(255,255,255,0.7)', g.w * 0.03);
    ctx.restore();
    glassSurface(ctx, g);
  },
};

// ---- porcelain: white glaze with cobalt rings and enamel colours ------------

const COBALT = '#2a4a9a';

function glaze(ctx, g) {
  gloss(ctx, g, { alpha: 0.32, at: 0.2, width: 0.14 });
  gloss(ctx, g, { alpha: 0.1, at: 0.75, width: 0.1 });
  sparkle(ctx, g, 0.45, 0.2);
  bevel(ctx, g, 0.95, 0.2, 0.06, '60,80,110');
}

function porcelainPlate(ctx, g) {
  plate(ctx, g, [[0, '#fcfdfb'], [0.5, '#f4f7f4'], [1, '#e9eeec']]);
  grain(ctx, g, { seed: 41, alpha: 0.05, scale: 2, mode: 'soft-light' });
  // The glaze pools faintly blue towards the rim.
  vignette(ctx, g, '90, 120, 170', 0.14);
}

function cobaltRings(ctx, g) {
  ctx.strokeStyle = 'rgba(42, 74, 154, 0.9)';
  ctx.lineWidth = Math.max(0.7, g.w * 0.018);
  roundRect(ctx, g.w * 0.06, g.w * 0.06, g.w - g.w * 0.12, g.h - g.w * 0.12, g.r * 0.65);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(42, 74, 154, 0.55)';
  ctx.lineWidth = Math.max(0.5, g.w * 0.01);
  roundRect(ctx, g.w * 0.1, g.w * 0.1, g.w - g.w * 0.2, g.h - g.w * 0.2, g.r * 0.5);
  ctx.stroke();
}

const porcelain = {
  body(ctx, g, flat) {
    if (!flat) {
      shadow(ctx, g, { alpha: 0.4 });
      sides(ctx, g, [[0, '#f1f4f2'], [0.5, '#d9e0dd'], [1, '#b9c3c0']], { rightShade: 0.14 });
    }
    porcelainPlate(ctx, g);
    cobaltRings(ctx, g);
  },
  symbols(ctx, layer, g) {
    // Pigment under the glaze pools slightly darker at one edge.
    layerAt(ctx, tinted(layer, 'rgba(20, 30, 60, 0.18)'), g, 0.006, 0.008);
    layerAt(ctx, layer, g, 0, 0);
  },
  finish(ctx, g) {
    glaze(ctx, g);
  },
  back(ctx, g, flat) {
    if (!flat) {
      shadow(ctx, g, { alpha: 0.4 });
      sides(ctx, g, [[0, '#f1f4f2'], [0.5, '#d9e0dd'], [1, '#b9c3c0']], { rightShade: 0.14 });
    }
    porcelainPlate(ctx, g);
    cobaltRings(ctx, g);
    // A cobalt medallion: a blossom in a double ring, four dots around it.
    ctx.save();
    ctx.translate(g.w / 2, g.h / 2);
    ctx.strokeStyle = COBALT;
    ctx.fillStyle = COBALT;
    ctx.lineWidth = Math.max(0.7, g.w * 0.02);
    ctx.beginPath();
    ctx.arc(0, 0, g.w * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(0.5, g.w * 0.01);
    ctx.beginPath();
    ctx.arc(0, 0, g.w * 0.26, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.rotate((i / 5) * Math.PI * 2);
      ctx.beginPath();
      ctx.ellipse(0, -g.w * 0.12, g.w * 0.065, g.w * 0.1, 0, 0, Math.PI * 2);
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, g.w * 0.045, 0, Math.PI * 2);
    ctx.fillStyle = '#fbfcfa';
    ctx.fill();
    ctx.fillStyle = COBALT;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * g.w * 0.4, Math.sin(a) * g.w * 0.46, g.w * 0.025, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    glaze(ctx, g);
  },
};

// ---- lacquer: black urushi with gold, red lacquer sides ---------------------

function lacquerPlate(ctx, g, seed, flakes) {
  plate(ctx, g, [[0, '#2a2724'], [0.5, '#1b1917'], [1, '#131110']]);
  grain(ctx, g, { seed, alpha: 0.1, scale: 3, mode: 'soft-light' });
  // Nashiji: gold flakes sprinkled under the clear coat.
  ctx.save();
  roundRect(ctx, 0, 0, g.w, g.h, g.r);
  ctx.clip();
  const rng = mulberry(seed * 5);
  for (let i = 0; i < flakes; i++) {
    const x = g.w * rng(), y = g.h * rng(), s = g.w * (0.004 + rng() * 0.008);
    ctx.fillStyle = `rgba(232, 196, 118, ${0.12 + rng() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(x, y, s * 1.6, s, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function lacquerGloss(ctx, g) {
  gloss(ctx, g, { alpha: 0.17, at: 0.22, width: 0.2 });
  gloss(ctx, g, { alpha: 0.06, at: 0.7, width: 0.1 });
  sparkle(ctx, g, 0.28, 0.22);
  bevel(ctx, g, 0.5, 0.5, 0.05, '0,0,0');
}

function goldFrame(ctx, g) {
  ctx.strokeStyle = 'rgba(226, 192, 105, 0.85)';
  ctx.lineWidth = Math.max(0.6, g.w * 0.014);
  roundRect(ctx, g.w * 0.055, g.w * 0.055, g.w - g.w * 0.11, g.h - g.w * 0.11, g.r * 0.65);
  ctx.stroke();
}

const lacquer = {
  body(ctx, g, flat) {
    if (!flat) {
      shadow(ctx, g, { alpha: 0.5 });
      sides(ctx, g, [[0, '#8a3222'], [0.5, '#64211a'], [1, '#3e1410']], { rightShade: 0.2 });
    }
    lacquerPlate(ctx, g, 51, 70);
    goldFrame(ctx, g);
  },
  symbols(ctx, layer, g) {
    // Maki-e: the colours glow faintly, as sprinkled powder under lacquer.
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.filter = `blur(${Math.max(0.8, g.w * 0.03)}px)`;
    ctx.drawImage(layer, 0, 0, g.w, g.h);
    ctx.restore();
    layerAt(ctx, layer, g, 0, 0);
  },
  finish(ctx, g) {
    lacquerGloss(ctx, g);
  },
  back(ctx, g, flat) {
    if (!flat) {
      shadow(ctx, g, { alpha: 0.5 });
      sides(ctx, g, [[0, '#8a3222'], [0.5, '#64211a'], [1, '#3e1410']], { rightShade: 0.2 });
    }
    lacquerPlate(ctx, g, 53, 160);
    goldFrame(ctx, g);
    // Gold maki-e: a full moon over two quiet waves.
    ctx.save();
    roundRect(ctx, g.w * 0.08, g.w * 0.08, g.w - g.w * 0.16, g.h - g.w * 0.16, g.r * 0.5);
    ctx.clip();
    const mx = g.w * 0.6, my = g.h * 0.36, mr = g.w * 0.2;
    const moon = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, 0, mx, my, mr);
    moon.addColorStop(0, '#f6dc96');
    moon.addColorStop(0.7, '#d8ae58');
    moon.addColorStop(1, '#b88a3a');
    ctx.fillStyle = moon;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(226, 192, 105, 0.9)';
    ctx.lineWidth = g.w * 0.028;
    ctx.lineCap = 'round';
    for (const [y, amp] of [[0.7, 0.05], [0.82, 0.04]]) {
      ctx.beginPath();
      ctx.moveTo(g.w * 0.1, g.h * y);
      for (let k = 0; k < 3; k++) {
        const x0 = g.w * (0.1 + k * 0.27);
        ctx.quadraticCurveTo(x0 + g.w * 0.07, g.h * (y - amp), x0 + g.w * 0.135, g.h * y);
        ctx.quadraticCurveTo(x0 + g.w * 0.2, g.h * (y + amp), x0 + g.w * 0.27, g.h * y);
      }
      ctx.stroke();
    }
    ctx.restore();
    lacquerGloss(ctx, g);
  },
};

export const MATERIALS = { pearl, jade, seaglass, porcelain, lacquer };
