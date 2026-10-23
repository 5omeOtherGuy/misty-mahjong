// The board view: lays the tiles out in the area it is given, draws them
// from cached sprites and runs the gentle animations (deal-in, lift on
// selection, blocked wiggle, hint pulse, reshuffle). A matched pair lifts,
// turns over in the air to show its back and glides to the collection
// tray, where the backs stack up over the game. It only draws while
// something moves; an idle board costs nothing.

import { layoutBounds, drawOrder } from '../layout.js';
import { tileSprite, backSprite, shadowSprite, setTileSet, currentTileSet, clearSpriteCache, TILE_ASPECT, THICKNESS } from './tileart.js';

const EASE_OUT = (t) => 1 - Math.pow(1 - t, 3);
const EASE_IN_OUT = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const SMOOTH = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

const FLIGHT_MS = 1150;
const FLIP_STRIPS = 16;

export class BoardView {
  constructor(canvas, fx, { onTap, settings }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fx = fx;
    this.onTap = onTap;
    this.settings = settings;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.area = { x: 0, y: 0, w: canvas.clientWidth, h: canvas.clientHeight };
    this.tray = { x: 0, y: 0, w: 0, h: 0 };
    this.game = null;
    this.tweens = [];
    this.tileState = [];
    this.flights = [];
    this.pile = [];
    this.pileAlpha = 1;
    this.frame = null;
    this.visible = false;
    this.hintPair = null;
    this.mat = 'rgba(18, 26, 24, 0.42)';
    canvas.addEventListener('pointerdown', (e) => this.handlePointer(e));
    settings.onChange((name) => {
      if (name === 'markFree') this.invalidate();
    });
  }

  setArea(area) {
    this.area = area;
    this.layout();
    this.invalidate();
  }

  /** The collection tray, in CSS pixels; the collected backs stack there. */
  setTray(rect) {
    this.tray = rect;
    this.layoutPile();
    this.invalidate();
  }

  setMat(color) {
    this.mat = color;
    this.invalidate();
  }

  /** Switches the tile set; running flights keep their kinds and only change their look. */
  setTileSet(set) {
    setTileSet(set);
    this.invalidate();
  }

  setGame(game, { dealIn = true } = {}) {
    this.game = game;
    this.order = drawOrder(game.positions);
    this.displayKinds = game.kinds.slice();
    this.tileState = game.positions.map(() => ({ lift: 0, alpha: 1, dx: 0, dy: 0, scale: 1, glow: 0, visible: true }));
    this.tweens = [];
    this.flights = [];
    this.pile = [];
    this.pileAlpha = 1;
    this.hintPair = null;
    this.layout();
    if (dealIn) this.dealIn();
    this.invalidate();
  }

  /** Computes the tile size and origin for the current area. */
  layout() {
    if (!this.game) return;
    const b = layoutBounds(this.game.positions);
    const lift = THICKNESS * (b.maxZ + 1);
    const cols = b.width / 2 + lift + 0.5;
    const rows = b.height / 2 + lift / TILE_ASPECT + 0.4;
    const tw = Math.floor(Math.min(this.area.w / cols, this.area.h / (rows * TILE_ASPECT)));
    this.tw = Math.max(8, tw);
    this.th = this.tw * TILE_ASPECT;
    this.d = this.tw * THICKNESS;
    const boardW = (b.width / 2) * this.tw + this.d;
    const boardH = (b.height / 2) * this.th + this.d;
    this.ox = this.area.x + (this.area.w - boardW) / 2 + b.maxZ * this.d - (b.minX / 2) * this.tw;
    this.oy = this.area.y + (this.area.h - boardH) / 2 + b.maxZ * this.d - (b.minY / 2) * this.th;
    this.bounds = b;
    this.layoutPile();
    this.resizeCanvas();
  }

  /**
   * The tray holds a grid of small stacks; the n-th collected tile lands on
   * cell n modulo the cell count, one thickness higher each round. Cells are
   * filled left to right, top to bottom, so the stacks overlap correctly.
   */
  layoutPile() {
    const t = this.tray;
    const tw = this.tw || 34;
    // A tray taller than wide (beside the board) holds at least two columns.
    const across = t.h > t.w ? t.w / 2.45 : t.w / 1.15;
    const pw = Math.max(9, Math.min(tw * 0.58, across, t.h / (TILE_ASPECT * 1.15)));
    const ph = pw * TILE_ASPECT;
    const gapX = pw * 1.14, gapY = ph * 1.12;
    const cols = Math.max(1, Math.floor((t.w - pw * 0.2) / gapX));
    const rows = Math.max(1, Math.floor((t.h - ph * 0.2) / gapY));
    const ox = t.x + (t.w - cols * gapX) / 2 + pw * 0.12;
    const oy = t.y + (t.h - rows * gapY) / 2 + ph * 0.1;
    this.pileGrid = { pw, ph, pd: pw * THICKNESS, cols, rows, gapX, gapY, ox, oy, cells: cols * rows };
  }

  pileSlot(n) {
    const g = this.pileGrid;
    const cell = n % g.cells, level = Math.floor(n / g.cells);
    const col = cell % g.cols, row = Math.floor(cell / g.cols);
    return { cell, level, x: g.ox + col * g.gapX - level * g.pd, y: g.oy + row * g.gapY - level * g.pd };
  }

  resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr) || dpr !== this.dpr) {
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      clearSpriteCache();
    }
  }

  /** Top-left of the face of tile i in CSS pixels. */
  tilePos(i) {
    const p = this.game.positions[i];
    return { x: this.ox + (p.x / 2) * this.tw - p.z * this.d, y: this.oy + (p.y / 2) * this.th - p.z * this.d };
  }

  hitTest(px, py) {
    const game = this.game;
    if (!game) return -1;
    for (let k = this.order.length - 1; k >= 0; k--) {
      const i = this.order[k];
      if (!game.present[i] || !this.tileState[i].visible) continue;
      const { x, y } = this.tilePos(i);
      if (px >= x && px <= x + this.tw + this.d * 0.5 && py >= y && py <= y + this.th + this.d * 0.5) return i;
    }
    return -1;
  }

  handlePointer(e) {
    if (!this.visible || !this.game) return;
    const rect = this.canvas.getBoundingClientRect();
    const i = this.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (i >= 0) this.onTap(i, e);
  }

  // ---- animations -------------------------------------------------------

  tween(target, props, duration, { ease = EASE_OUT, delay = 0, onDone } = {}) {
    const from = {};
    for (const k of Object.keys(props)) from[k] = target[k];
    this.tweens.push({ target, from, to: props, duration, ease, start: performance.now() + delay, onDone });
    this.invalidate();
  }

  cancelTweens(target, keys) {
    this.tweens = this.tweens.filter((t) => !(t.target === target && (!keys || keys.some((k) => k in t.to))));
  }

  dealIn() {
    this.order.forEach((i, n) => {
      const s = this.tileState[i];
      s.alpha = 0;
      s.dy = this.th * 0.5;
      this.tween(s, { alpha: 1, dy: 0 }, 420, { delay: n * 5 + 60 });
    });
  }

  select(i) {
    const s = this.tileState[i];
    this.cancelTweens(s, ['lift', 'glow']);
    this.tween(s, { lift: 1, glow: 1 }, 160);
  }

  deselect(i) {
    const s = this.tileState[i];
    this.cancelTweens(s, ['lift', 'glow']);
    this.tween(s, { lift: 0, glow: 0 }, 220);
  }

  blocked(i) {
    const s = this.tileState[i];
    this.cancelTweens(s, ['dx']);
    s.dx = 0;
    const amp = this.tw * 0.06;
    const steps = [amp, -amp, amp * 0.6, -amp * 0.4, 0];
    steps.forEach((dx, n) => this.tween(s, { dx }, 55, { delay: n * 55, ease: EASE_IN_OUT }));
  }

  /**
   * Both tiles rise and glow briefly, then take off: each turns over in the
   * air and glides to its slot in the tray. Resolves when both have landed.
   * The board stays playable throughout.
   */
  match(a, b, { onParticles } = {}) {
    this.hintPair = null;
    const slots = [this.pileSlot(this.pile.length + this.flights.length), this.pileSlot(this.pile.length + this.flights.length + 1)];
    const takeOff = 170;
    return new Promise((resolve) => {
      [a, b].forEach((i, n) => {
        const s = this.tileState[i];
        this.cancelTweens(s);
        this.tween(s, { lift: 1.3, glow: 1.4, scale: 1.06 }, takeOff, { ease: EASE_OUT });
        const pos = this.tilePos(i);
        const liftPx = 1.3 * this.d * 0.9;
        const flight = {
          kind: this.displayKinds[i],
          from: { x: pos.x + this.tw / 2 - liftPx, y: pos.y + this.th / 2 - liftPx },
          to: slots[n],
          start: performance.now() + takeOff + n * 110,
          duration: FLIGHT_MS,
          seat: this.pile.length + this.flights.length,
          onDone: n === 1 ? resolve : undefined,
          tile: i,
          landed: false,
        };
        // The pair leaves the board the moment it takes off.
        setTimeout(() => {
          s.visible = false;
          s.glow = 0;
          s.lift = 0;
          this.cancelTweens(s);
          this.invalidate();
        }, takeOff + n * 110);
        this.flights.push(flight);
      });
      if (onParticles) {
        const pa = this.tilePos(a), pb = this.tilePos(b);
        setTimeout(() => onParticles(
          { x: pa.x + this.tw / 2, y: pa.y + this.th / 2 },
          { x: pb.x + this.tw / 2, y: pb.y + this.th / 2 },
          this.tw,
        ), takeOff - 30);
      }
      this.invalidate();
    });
  }

  /** Resolves once no tile is in the air. */
  whenSettled() {
    if (!this.flights.length) return Promise.resolve();
    return new Promise((resolve) => this.settleWaiters = [...(this.settleWaiters || []), resolve]);
  }

  /** The collected pile rises in a slow wave, for a cleared board. */
  celebratePile() {
    const waves = this.pile.map((entry, n) => new Promise((resolve) => {
      entry.lift = 0;
      this.tween(entry, { lift: 1 }, 420, { delay: n * 14, ease: EASE_IN_OUT });
      this.tween(entry, { lift: 0 }, 640, { delay: n * 14 + 420, ease: EASE_IN_OUT, onDone: resolve });
    }));
    return Promise.all(waves);
  }

  hint(pair) {
    this.hintPair = { pair, start: performance.now() };
    this.invalidate();
  }

  /** Fades the tiles out, lets the caller swap the kinds, and fades them back in. */
  async reshuffle(newKinds) {
    const present = this.game.present;
    const visible = this.order.filter((i) => present[i]);
    await Promise.all(visible.map((i, n) => new Promise((resolve) => {
      const s = this.tileState[i];
      this.cancelTweens(s);
      this.tween(s, { alpha: 0, dy: -this.th * 0.15 }, 320, { delay: n * 2, onDone: resolve });
    })));
    this.displayKinds = newKinds.slice();
    const center = { x: this.ox + (this.bounds.width / 4) * this.tw, y: this.oy + (this.bounds.height / 4) * this.th };
    await Promise.all(visible.map((i) => new Promise((resolve) => {
      const s = this.tileState[i];
      const p = this.tilePos(i);
      const dist = Math.hypot(p.x - center.x, p.y - center.y);
      s.dy = this.th * 0.25;
      this.tween(s, { alpha: 1, dy: 0, lift: 0, glow: 0 }, 480, { delay: dist * 0.6, onDone: resolve });
    })));
  }

  /** Fades everything out, the pile included, for leaving the game. */
  fadeOut() {
    this.flights = [];
    this.tween(this, { pileAlpha: 0 }, 360);
    return Promise.all(this.order.map((i) => new Promise((resolve) => {
      const s = this.tileState[i];
      this.cancelTweens(s);
      this.tween(s, { alpha: 0, dy: this.th * 0.3 }, 360, { onDone: resolve });
    })));
  }

  // ---- drawing ----------------------------------------------------------

  invalidate() {
    if (this.frame === null) this.frame = requestAnimationFrame((t) => this.render(t));
  }

  step(now) {
    let active = false;
    const done = [];
    for (const t of this.tweens) {
      if (now < t.start) {
        active = true;
        continue;
      }
      const p = Math.min(1, (now - t.start) / t.duration);
      const e = t.ease(p);
      for (const k of Object.keys(t.to)) t.target[k] = t.from[k] + (t.to[k] - t.from[k]) * e;
      if (p >= 1) done.push(t);
      else active = true;
    }
    if (done.length) {
      this.tweens = this.tweens.filter((t) => !done.includes(t));
      for (const t of done) t.onDone && t.onDone();
    }
    if (this.hintPair) {
      if (now - this.hintPair.start > 2600) this.hintPair = null;
      else active = true;
    }
    if (this.flights.length) {
      active = true;
      const landed = this.flights.filter((f) => now >= f.start + f.duration);
      if (landed.length) {
        this.flights = this.flights.filter((f) => !landed.includes(f));
        for (const f of landed) {
          this.pile.push({ seat: f.seat, lift: 0 });
          f.onDone && f.onDone();
        }
        if (!this.flights.length && this.settleWaiters) {
          const waiters = this.settleWaiters;
          this.settleWaiters = null;
          waiters.forEach((w) => w());
        }
      }
    }
    return active;
  }

  render(now) {
    this.frame = null;
    if (!this.visible) return;
    const active = this.step(now);
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    if (this.game) {
      this.drawMat(ctx);
      this.drawTiles(ctx, now);
      this.drawPile(ctx);
      this.drawFlights(ctx, now);
    }
    if (active) this.invalidate();
  }

  drawMat(ctx) {
    const b = this.bounds;
    const x = this.ox - this.tw * 0.55 - b.maxZ * this.d;
    const y = this.oy - this.th * 0.4 - b.maxZ * this.d;
    const w = (b.width / 2) * this.tw + this.tw * 1.1 + b.maxZ * this.d + this.d;
    const h = (b.height / 2) * this.th + this.th * 0.8 + b.maxZ * this.d + this.d;
    const g = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.25, x + w / 2, y + h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, this.mat);
    g.addColorStop(1, 'rgba(18, 26, 24, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - w * 0.3, y - h * 0.3, w * 1.6, h * 1.6);
  }

  drawTiles(ctx, now) {
    const game = this.game;
    const markFree = this.settings.get('markFree');
    const hint = this.hintPair;
    const hintPulse = hint ? 0.55 + 0.45 * Math.sin((now - hint.start) / 180) : 0;
    const glowColors = currentTileSet().glow;
    for (const i of this.order) {
      const s = this.tileState[i];
      if (!s.visible || s.alpha <= 0) continue;
      if (!game.present[i] && s.glow <= 0 && s.lift <= 0) continue;
      const free = game.isFree(i);
      const sprite = tileSprite(this.displayKinds[i], this.tw, this.dpr, { dim: markFree && !free && game.present[i] });
      const pos = this.tilePos(i);
      const liftPx = s.lift * this.d * 0.9;
      const x = pos.x + s.dx - liftPx;
      const y = pos.y + s.dy - liftPx;
      const cx = x + this.tw / 2, cy = y + this.th / 2;
      ctx.save();
      ctx.globalAlpha = s.alpha;
      ctx.translate(cx, cy);
      ctx.scale(s.scale, s.scale);
      ctx.translate(-cx, -cy);
      const isHint = hint && hint.pair.includes(i);
      if (s.glow > 0 || isHint) {
        const strength = Math.max(s.glow, isHint ? hintPulse : 0);
        this.drawGlow(ctx, x, y, strength, isHint && s.glow <= 0 ? glowColors.hint : glowColors.select);
      }
      ctx.drawImage(sprite.canvas, x - sprite.origin, y - sprite.origin, sprite.canvas.width / this.dpr, sprite.canvas.height / this.dpr);
      if (s.glow > 0 || isHint) {
        const hinting = isHint && s.glow <= 0;
        const strength = Math.min(1, hinting ? hintPulse : s.glow);
        const rgb = hinting ? glowColors.hint : glowColors.select;
        ctx.globalAlpha = s.alpha * strength * 0.16;
        ctx.fillStyle = `rgb(${rgb})`;
        roundRectPath(ctx, x, y, this.tw, this.th, this.tw * 0.13);
        ctx.fill();
        ctx.globalAlpha = s.alpha * strength * 0.95;
        ctx.strokeStyle = `rgb(${rgb})`;
        ctx.lineWidth = this.tw * 0.055;
        roundRectPath(ctx, x + this.tw * 0.01, y + this.tw * 0.01, this.tw * 0.98, this.th - this.tw * 0.02, this.tw * 0.12);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawGlow(ctx, x, y, strength, rgb) {
    const color = `rgba(${rgb}, ${Math.min(1, strength)})`;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = this.tw * (0.5 + 0.4 * strength);
    ctx.fillStyle = color;
    roundRectPath(ctx, x - this.tw * 0.04, y - this.tw * 0.04, this.tw * 1.08 + this.d, this.th * 1.06 + this.d, this.tw * 0.16);
    ctx.fill();
    ctx.restore();
  }

  drawPile(ctx) {
    if (!this.pile.length || this.pileAlpha <= 0) return;
    const g = this.pileGrid;
    const sprite = backSprite(g.pw, this.dpr);
    const scale = sprite.canvas.width / this.dpr;
    ctx.save();
    ctx.globalAlpha = this.pileAlpha;
    // Lower stacks first, then by cell so the thickness overlaps correctly.
    const order = this.pile.slice().sort((p, q) => (p.seat % g.cells) - (q.seat % g.cells) || p.seat - q.seat);
    for (const entry of order) {
      const slot = this.pileSlot(entry.seat);
      const rise = entry.lift * g.pd * 2.5;
      ctx.drawImage(sprite.canvas, slot.x - sprite.origin - rise, slot.y - sprite.origin - rise, scale, sprite.canvas.height / this.dpr);
      if (entry.lift > 0) {
        ctx.globalAlpha = this.pileAlpha * entry.lift * 0.35;
        ctx.fillStyle = `rgb(${currentTileSet().glow.select})`;
        roundRectPath(ctx, slot.x - rise, slot.y - rise, g.pw, g.ph, g.pw * 0.13);
        ctx.fill();
        ctx.globalAlpha = this.pileAlpha;
      }
    }
    ctx.restore();
  }

  drawFlights(ctx, now) {
    const set = currentTileSet();
    const g = this.pileGrid;
    for (const f of this.flights) {
      const t = clamp01((now - f.start) / f.duration);
      if (now < f.start) continue;
      const e = SMOOTH(t);
      // A gentle arc: up and over, towards the tray.
      const to = { x: f.to.x + g.pw / 2, y: f.to.y + g.ph / 2 };
      const ctrl = { x: (f.from.x + to.x) / 2, y: Math.min(f.from.y, to.y) - this.th * 0.9 };
      const x = (1 - e) * (1 - e) * f.from.x + 2 * (1 - e) * e * ctrl.x + e * e * to.x;
      const y = (1 - e) * (1 - e) * f.from.y + 2 * (1 - e) * e * ctrl.y + e * e * to.y;
      const alt = Math.sin(Math.PI * e);
      const size = this.tw * 1.06 + (g.pw - this.tw * 1.06) * SMOOTH(clamp01((t - 0.25) / 0.75));
      const w = size * (1 + alt * 0.1);
      const theta = Math.PI * SMOOTH(clamp01((t - 0.04) / 0.62));
      // Shadow on the ground, drifting away with the altitude.
      const sh = shadowSprite(this.tw, this.dpr);
      ctx.save();
      ctx.globalAlpha = 0.5 - alt * 0.3;
      const spread = (w / this.tw) * (1 + alt * 0.35);
      const shw = (sh.canvas.width / this.dpr) * spread, shh = (sh.canvas.height / this.dpr) * spread;
      ctx.drawImage(sh.canvas, x - shw / 2 + w * 0.06 + alt * w * 0.25, y - shh / 2 + w * 0.1 + alt * w * 0.4, shw, shh);
      ctx.restore();
      this.drawFlipped(ctx, f.kind, x, y, w, theta, set);
    }
  }

  /**
   * A tile turned by `theta` about its vertical axis under a simple
   * perspective: the sprite is drawn in vertical strips, each scaled to its
   * projected width and height, which gives the trapezoid of a real turn.
   * Past 90 degrees the back shows, the right way round: its left edge is
   * the face's right edge. The sprites come from the cache at the board's
   * tile size and are scaled on the way.
   */
  drawFlipped(ctx, kind, cx, cy, w, theta, set) {
    const h = w * TILE_ASPECT;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    const focal = w * 2.8;
    const showBack = cos < 0;
    const sprite = showBack ? backSprite(this.tw, this.dpr, { flat: true }) : tileSprite(kind, this.tw, this.dpr, { flat: true });
    const src = sprite.canvas;
    const project = (u) => {
      const X = (u - 0.5) * w;
      const z = X * sin;
      const s = focal / (focal + z);
      return { x: cx + X * cos * s, s };
    };
    // The side turned towards the viewer shows its thickness.
    const d = w * THICKNESS * Math.abs(sin);
    if (d > 0.3) {
      const near = sin > 0 ? project(0) : project(1);
      const dir = sin > 0 ? -1 : 1;
      ctx.fillStyle = set.material === 'lacquer' ? '#64211a' : set.material === 'pearl' ? '#262a36' : set.material === 'jade' ? '#4d8a66' : set.material === 'seaglass' ? '#7cc4b6' : '#d9e0dd';
      const hh = h * near.s;
      ctx.fillRect(Math.min(near.x, near.x + dir * d), cy - hh / 2, d, hh);
    }
    const strips = FLIP_STRIPS;
    const sw = src.width / strips;
    for (let k = 0; k < strips; k++) {
      const a = project(k / strips), b = project((k + 1) / strips);
      const left = Math.min(a.x, b.x), width = Math.abs(b.x - a.x);
      if (width < 0.05) continue;
      const s = (a.s + b.s) / 2;
      const hh = h * s;
      const sx = showBack ? src.width - (k + 1) * sw : k * sw;
      ctx.drawImage(src, sx, 0, sw, src.height, left - 0.25, cy - hh / 2, width + 0.5, hh);
    }
    // Lighting: the face darkens as it turns from the light, and a sheen
    // sweeps across near the edge-on moment.
    const pa = project(0), pb = project(1);
    const x0 = Math.min(pa.x, pb.x), x1 = Math.max(pa.x, pb.x);
    const h0 = h * (pa.x < pb.x ? pa.s : pb.s), h1 = h * (pa.x < pb.x ? pb.s : pa.s);
    ctx.beginPath();
    ctx.moveTo(x0, cy - h0 / 2);
    ctx.lineTo(x1, cy - h1 / 2);
    ctx.lineTo(x1, cy + h1 / 2);
    ctx.lineTo(x0, cy + h0 / 2);
    ctx.closePath();
    const shade = 0.3 * (1 - Math.abs(cos));
    ctx.fillStyle = `rgba(10, 14, 18, ${shade})`;
    ctx.fill();
    const sheen = set.sheen * Math.pow(Math.abs(sin), 3) * 0.45;
    if (sheen > 0.01) {
      const grad = ctx.createLinearGradient(x0, cy - h / 2, x1, cy + h / 2);
      const at = 0.5 - cos * 0.3;
      grad.addColorStop(clamp01(at - 0.25), 'rgba(255,255,255,0)');
      grad.addColorStop(clamp01(at), `rgba(255,255,255,${sheen})`);
      grad.addColorStop(clamp01(at + 0.25), 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fill();
    }
  }
}

export function roundRectPath(ctx, x, y, w, h, r) {
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
