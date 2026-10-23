// Particles and floating labels on a canvas above the board: a few petals
// on each match, a score label, and an occasional drifting petal while the
// game idles. Everything is small, slow and translucent.

import { DISPLAY_FONT } from './tileart.js';

const PETAL_COLORS = ['rgba(232, 166, 182,', 'rgba(244, 206, 214,', 'rgba(218, 140, 160,', 'rgba(255, 236, 214,'];

export class Effects {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.labels = [];
    this.ambient = false;
    this.nextAmbient = 0;
    this.frame = null;
    this.last = 0;
    this.dpr = 1;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(this.canvas.clientWidth * this.dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * this.dpr);
  }

  setAmbient(on) {
    this.ambient = on;
    if (on) this.start();
  }

  start() {
    if (this.frame === null) {
      this.last = performance.now();
      this.frame = requestAnimationFrame((t) => this.render(t));
    }
  }

  /** Petals and a soft light bloom at a match. */
  burst(p, size, count = 7) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = size * (0.6 + Math.random() * 1.2);
      this.particles.push({
        x: p.x, y: p.y,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - size * 0.8,
        life: 0, ttl: 900 + Math.random() * 500,
        size: size * (0.08 + Math.random() * 0.09),
        rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 4,
        color: PETAL_COLORS[i % PETAL_COLORS.length], drag: 2.2,
      });
    }
    this.particles.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0, ttl: 480, bloom: true, size: size * 0.9, drag: 0 });
    this.start();
  }

  label(p, text, { color = '#f7efd9', sub = null, size = 22 } = {}) {
    this.labels.push({ x: p.x, y: p.y, text, sub, color, size, life: 0, ttl: 1300 });
    this.start();
  }

  /** A slow shower of petals across the whole screen, for a cleared board. */
  celebrate() {
    const w = this.canvas.clientWidth;
    for (let i = 0; i < 46; i++) {
      setTimeout(() => {
        const size = 5 + Math.random() * 7;
        this.particles.push({
          x: Math.random() * w, y: -24,
          vx: (Math.random() - 0.5) * 30, vy: 40 + Math.random() * 40,
          life: 0, ttl: 14000, size, rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 2,
          color: PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)], drag: 0,
          sway: Math.random() * Math.PI * 2, alpha: 0.55,
        });
        this.start();
      }, i * 70 + Math.random() * 60);
    }
  }

  spawnAmbient() {
    const w = this.canvas.clientWidth;
    const size = 4 + Math.random() * 5;
    this.particles.push({
      x: Math.random() * w, y: -20,
      vx: (Math.random() - 0.5) * 12, vy: 22 + Math.random() * 16,
      life: 0, ttl: 16000, size, rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 1.2,
      color: PETAL_COLORS[Math.floor(Math.random() * 3)], drag: 0, sway: Math.random() * Math.PI * 2, alpha: 0.32,
    });
  }

  render(now) {
    this.frame = null;
    const dt = Math.min(50, now - this.last) / 1000;
    this.last = now;
    const ctx = this.ctx;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (this.ambient && now > this.nextAmbient) {
      this.spawnAmbient();
      this.nextAmbient = now + 3500 + Math.random() * 5000;
    }

    this.particles = this.particles.filter((p) => {
      p.life += dt * 1000;
      if (p.life > p.ttl) return false;
      const t = p.life / p.ttl;
      if (p.bloom) {
        const r = p.size * (0.5 + t);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, `rgba(255, 244, 214, ${0.45 * (1 - t)})`);
        g.addColorStop(1, 'rgba(255, 244, 214, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
        return true;
      }
      p.vx -= p.vx * p.drag * dt;
      p.vy -= p.vy * p.drag * dt;
      if (p.drag) p.vy += p.size * 6 * dt;
      p.x += p.vx * dt + (p.sway !== undefined ? Math.sin(now / 900 + p.sway) * 18 * dt : 0);
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      const alpha = (p.alpha ?? 0.9) * (t < 0.1 ? t / 0.1 : 1 - Math.pow(Math.max(0, (t - 0.6) / 0.4), 2));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color + alpha + ')';
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return p.y < h + 30;
    });

    this.labels = this.labels.filter((l) => {
      l.life += dt * 1000;
      if (l.life > l.ttl) return false;
      const t = l.life / l.ttl;
      const y = l.y - 46 * (1 - Math.pow(1 - t, 2));
      const alpha = t < 0.12 ? t / 0.12 : 1 - Math.pow(Math.max(0, (t - 0.55) / 0.45), 1.5);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(10, 14, 12, 0.7)';
      ctx.shadowBlur = 8;
      ctx.font = `600 ${l.size}px "${DISPLAY_FONT}", serif`;
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, l.x, y);
      if (l.sub) {
        ctx.font = `500 ${l.size * 0.62}px "${DISPLAY_FONT}", serif`;
        ctx.fillStyle = '#e8c472';
        ctx.fillText(l.sub, l.x, y + l.size * 0.85);
      }
      ctx.restore();
      return true;
    });

    if (this.particles.length || this.labels.length || this.ambient) this.start();
  }
}
