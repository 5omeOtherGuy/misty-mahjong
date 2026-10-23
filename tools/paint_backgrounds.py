#!/usr/bin/env python3
"""Paint the selectable backgrounds of Misty Mahjong in an East Asian ink-wash style.

Everything is procedural (numpy, Pillow, scipy) and seeded, so a run always
produces the same images. Usage:

    python3 tools/paint_backgrounds.py            # paint all scenes
    python3 tools/paint_backgrounds.py mondnacht  # paint only the named scenes

Each scene is written to web/assets/backgrounds/<id>.jpg (2560x1600) and
<id>_thumb.jpg (320x200); index.json is rebuilt from every scene file present.

Model: the canvas holds RGB reflectance. Transparent pigment is glazed on
multiplicatively (c *= T ** density, Beer-Lambert), opaque body colour (mist,
moon light, blossoms, crane feathers) is mixed in. Washes get granulation from
the paper texture and darker wet edges; brush strokes are drawn as polygons
plus individual bristles that break up as the brush runs dry.
"""

import json
import os
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

W, H = 2560, 1600
THUMB = (320, 200)
OUT = Path(__file__).resolve().parent.parent / 'web' / 'assets' / 'backgrounds'

# Transmittance of one unit of pigment density, per RGB channel.
INK = (0.37, 0.365, 0.38)
INK_WARM = (0.42, 0.385, 0.36)
INK_COOL = (0.37, 0.39, 0.44)
INDIGO = (0.44, 0.54, 0.76)
PRUSSIAN = (0.40, 0.50, 0.62)
BLUEGREY = (0.60, 0.65, 0.73)
SEPIA = (0.80, 0.68, 0.52)
JADE = (0.66, 0.80, 0.71)
JADE_DEEP = (0.50, 0.66, 0.58)
OCHRE = (0.94, 0.80, 0.56)
ROSE = (0.93, 0.76, 0.74)
PAPER = (0.935, 0.90, 0.815)
VERMILION = (0.70, 0.24, 0.17)

CALM_X, CALM_Y = 0.36, 0.31  # half-extents of the area the tiles cover


# ---------------------------------------------------------------- basics

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def resize(a, w, h, resample=Image.BICUBIC):
    img = Image.fromarray(np.ascontiguousarray(a, dtype=np.float32))
    return np.asarray(img.resize((int(w), int(h)), resample), dtype=np.float32)


def blur(a, s):
    """Gaussian blur; large radii go through a downsampled copy."""
    if s <= 0:
        return a
    if s <= 6:
        return ndi.gaussian_filter(a, s, mode='reflect')
    h, w = a.shape
    f = s / 3.0
    small = resize(a, max(2, round(w / f)), max(2, round(h / f)), Image.BILINEAR)
    small = ndi.gaussian_filter(small, 2.6, mode='reflect')
    return resize(small, w, h)


def rows():
    return np.arange(H, dtype=np.float32)[:, None]


def cols():
    return np.arange(W, dtype=np.float32)[None, :]


def value_noise(rng, cell, shape=(H, W), aspect=(1.0, 1.0)):
    h, w = shape
    cy, cx = max(cell * aspect[0], 1.0), max(cell * aspect[1], 1.0)
    gh, gw = int(h / cy) + 4, int(w / cx) + 4
    g = rng.standard_normal((gh, gw)).astype(np.float32)
    big = resize(g, gw * cx, gh * cy)
    oy = int(rng.integers(0, int(cy) + 1))
    ox = int(rng.integers(0, int(cx) + 1))
    return big[oy:oy + h, ox:ox + w]


def fbm(rng, cell, octaves=4, pers=0.5, shape=(H, W), aspect=(1.0, 1.0)):
    tot = np.zeros(shape, np.float32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        c = cell / (2 ** o)
        if c < 1.5:
            break
        tot += amp * value_noise(rng, c, shape, aspect)
        norm += amp * amp
        amp *= pers
    tot /= np.sqrt(norm) * 0.8  # bicubic value noise has std ~0.8
    return tot


def noise1(rng, n, cell, octaves=4, pers=0.5):
    x = np.arange(n, dtype=np.float64)
    tot = np.zeros(n)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        c = max(cell / (2 ** o), 1.5)
        k = int(n / c) + 6
        v = rng.standard_normal(k)
        xs = x / c + rng.random()
        i0 = np.floor(xs).astype(int)
        t = xs - i0
        p0, p1, p2, p3 = v[i0], v[i0 + 1], v[i0 + 2], v[i0 + 3]
        tot += amp * 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                            + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
        norm += amp * amp
        amp *= pers
    return tot / np.sqrt(norm) / 0.75


def spline(pts, per=14):
    p = np.asarray(pts, np.float64)
    if len(p) < 3:
        t = np.linspace(0, 1, per * 2)[:, None]
        return p[0] + (p[-1] - p[0]) * t
    p = np.vstack([2 * p[0] - p[1], p, 2 * p[-1] - p[-2]])
    t = np.linspace(0, 1, per, endpoint=False)[:, None]
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        out.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t ** 2
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(p[-2][None])
    return np.vstack(out)


def resample(path, step):
    d = np.sqrt((np.diff(path, axis=0) ** 2).sum(1))
    s = np.concatenate([[0.0], np.cumsum(d)])
    n = max(2, int(s[-1] / step) + 1)
    si = np.linspace(0, s[-1], n)
    return np.stack([np.interp(si, s, path[:, 0]), np.interp(si, s, path[:, 1])], 1)


def calm_weight():
    """1 where the tiles sit, fading to 0 towards the edges."""
    x = np.abs((np.arange(W, dtype=np.float32) + 0.5) / W - 0.5) / CALM_X
    y = np.abs((np.arange(H, dtype=np.float32) + 0.5) / H - 0.5) / CALM_Y
    r = (x[None, :] ** 4 + y[:, None] ** 4) ** 0.25
    return 1.0 - smoothstep(0.78, 1.18, r)


# ---------------------------------------------------------------- canvas

class Canvas:
    def __init__(self, rng, paper=PAPER):
        self.rng = rng
        wn = rng.standard_normal((H, W)).astype(np.float32)
        f1 = ndi.gaussian_filter(wn, (0.7, 3.5))
        wn = rng.standard_normal((H, W)).astype(np.float32)
        f2 = ndi.gaussian_filter(wn, (3.5, 0.7))
        fib = f1 / f1.std() + 0.6 * f2 / f2.std()
        img = Image.new('F', (W, H), 0.0)
        dr = ImageDraw.Draw(img)
        for _ in range(3200):  # long loose fibres
            x, y = rng.uniform(0, W), rng.uniform(0, H)
            a = rng.uniform(0, np.pi)
            ln = rng.uniform(15, 110)
            bend = rng.uniform(-0.5, 0.5)
            pts = []
            for t in np.linspace(0, 1, 6):
                aa = a + bend * t
                pts += [x + np.cos(aa) * ln * t, y + np.sin(aa) * ln * t]
            dr.line(pts, fill=float(rng.choice([-1.0, 1.0]) * rng.uniform(0.6, 1.6)), width=1)
        fib += ndi.gaussian_filter(np.asarray(img), 0.7) * 2.0
        fib /= fib.std()
        grain = ndi.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), 1.0)
        grain /= grain.std()
        self.fib = fib
        self.grain = grain
        # granulation: pigment settles in the valleys of the paper
        g = 0.35 * grain + 0.3 * fib + 0.8 * fbm(rng, 7, 2) + 0.35 * fbm(rng, 30, 2)
        self.G = np.clip(g / g.std(), -2.5, 2.5)
        self.c = np.empty((H, W, 3), np.float32)
        mott = 1.0 + 0.018 * fbm(rng, 280, 4)
        for k in range(3):
            self.c[..., k] = paper[k] * mott
        # vertical strips of the texture field used for mountain strokes
        st = ndi.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), (7, 1.6))
        st /= st.std()
        self.streaks = st * 0.45 + fbm(rng, 34, 3) * 0.75

    def glaze(self, d, pigment):
        for k in range(3):
            self.c[..., k] *= np.exp(-d * np.float32(-np.log(pigment[k])))

    def body(self, a, color):
        for k in range(3):
            self.c[..., k] += (np.float32(color[k]) - self.c[..., k]) * a


def wash(cv, mask, pigment, density, gran=0.3, edge=0.5, edge_sigma=5.0, bleed=1.5, cap=0.5):
    """A transparent wash: soft bleed, granulation and a darker drying edge."""
    m = blur(mask, bleed) if bleed else mask
    d = m * np.float32(density)
    if edge:
        e = np.clip(m - blur(m, edge_sigma), 0, None) * m
        d += np.float32(density * edge * 2.0) * e
    if gran:
        d += gran * cv.G * np.minimum(d, cap)
        np.maximum(d, 0, out=d)
    cv.glaze(d, pigment)


def mist(cv, y0, h, color, alpha, rng, wisp=1.0, cell=420, x_amp=None):
    """Horizontal band of drifting mist, painted as soft body colour."""
    n = fbm(rng, cell, 4, aspect=(0.3, 1.0))
    n2 = fbm(rng, cell * 0.5, 3, aspect=(0.4, 1.0))
    yd = (rows() - y0 - n * h * 0.45 * wisp) / h
    a = np.exp(-2.2 * yd * yd) * np.clip(0.78 + 0.32 * n2, 0, 1.3)
    if x_amp is not None:
        a *= x_amp[None, :]
    cv.body(np.clip(a * alpha, 0, 1), color)


def sky(cv, top_d, bottom_d, y1, pigment, rng, cloud=0.25, hole=None, y0=0.0):
    t = smoothstep(y0 * H, y1 * H, rows())
    d = top_d + (bottom_d - top_d) * t
    d = d * (1.0 + cloud * fbm(rng, 520, 5, aspect=(0.45, 1.0)))
    d = np.broadcast_to(d, (H, W)).astype(np.float32)
    if hole is not None:
        d = d * hole
    wash(cv, d, pigment, 1.0, gran=0.07, edge=0.0, bleed=0)


# ---------------------------------------------------------------- strokes

class Layer:
    """Coverage of one ink tone; overlapping marks build up like glazes."""

    def __init__(self):
        self.a = np.zeros((H, W), np.float32)

    def put(self, x0, y0, patch):
        h, w = patch.shape
        X0, Y0, X1, Y1 = max(x0, 0), max(y0, 0), min(x0 + w, W), min(y0 + h, H)
        if X1 <= X0 or Y1 <= Y0:
            return
        p = patch[Y0 - y0:Y1 - y0, X0 - x0:X1 - x0]
        s = self.a[Y0:Y1, X0:X1]
        s += p - s * p


def patch_for(pts, pad):
    pts = np.asarray(pts)
    x0 = int(np.floor(pts[:, 0].min())) - pad
    y0 = int(np.floor(pts[:, 1].min())) - pad
    x1 = int(np.ceil(pts[:, 0].max())) + pad
    y1 = int(np.ceil(pts[:, 1].max())) + pad
    img = Image.new('F', (max(1, x1 - x0), max(1, y1 - y0)), 0.0)
    return img, ImageDraw.Draw(img), x0, y0


def stroke(L, pts, width, rng, ink=0.9, dry=0.0, taper=(0.12, 0.3), press=None, wobble=0.15,
           smooth=True, bristle=2.2, minw=0.08, dry_base=0.2):
    path = spline(pts) if smooth and len(pts) > 2 else np.asarray(pts, np.float64)
    path = resample(path, 1.6)
    if not smooth and len(path) > 12:  # keep angular joints, but round them off a little
        path = ndi.gaussian_filter1d(path, 5.0, axis=0, mode='nearest')
    n = len(path)
    if n < 3:
        return
    s = np.linspace(0.0, 1.0, n)
    prof = minw + (1 - minw) * smoothstep(0, taper[0] + 1e-6, s) * (1 - smoothstep(1 - taper[1] - 1e-6, 1, s))
    if press is not None:
        prof = prof * press(s)
    if wobble:
        prof = prof * (1 + wobble * noise1(rng, n, max(n / 6, 4), 3))
    w = np.maximum(width * prof, 0.7)
    tg = np.gradient(path, axis=0)
    tg /= np.linalg.norm(tg, axis=1, keepdims=True) + 1e-9
    nm = np.stack([-tg[:, 1], tg[:, 0]], 1)
    img, dr, x0, y0 = patch_for(path, int(w.max()) + 4)
    off = np.array([x0, y0], np.float64)
    body = ink * (1 - dry)
    if body > 0.004:
        lft = path + nm * w[:, None] / 2 - off
        rgt = path - nm * w[:, None] / 2 - off
        dr.polygon(np.vstack([lft, rgt[::-1]]).ravel().tolist(), fill=float(body))
    patch = np.asarray(img)
    if dry > 0:
        img2 = Image.new('F', img.size, 0.0)
        d2 = ImageDraw.Draw(img2)
        nb = max(3, int(width / bristle))
        lw = max(1, int(round(width / nb * 1.5)))
        for k in range(nb):
            u = ((k + 0.5) / nb) * 2 - 1 + rng.uniform(-0.4, 0.4) / nb
            pk = path + nm * (u * w / 2)[:, None] - off
            nz = noise1(rng, n, rng.uniform(5, 28), 3)
            thr = dry * (dry_base + 0.8 * s + 0.45 * u * u)
            val = np.clip(0.5 + 3.0 * (0.55 + 0.32 * nz - thr), 0, 1) * ink
            q = np.round(val * 10) / 10
            i = 0
            while i < n - 1:
                j = i
                while j < n - 2 and q[j + 1] == q[i]:
                    j += 1
                if q[i] > 0.01:
                    d2.line(pk[i:j + 2].ravel().tolist(), fill=float(q[i]), width=lw)
                i = j + 1
        patch = np.maximum(patch, np.asarray(img2))
    L.put(x0, y0, patch)


def blob(L, cx, cy, rx, ry, rng, ink=0.8, rot=0.0, jag=0.18, npts=18):
    """An irregular dab of the brush tip."""
    a = np.linspace(0, 2 * np.pi, npts, endpoint=False) + rng.uniform(0, 1)
    r = 1 + jag * rng.standard_normal(npts)
    r = (r + np.roll(r, 1) + np.roll(r, -1)) / 3
    x = np.cos(a) * rx * r
    y = np.sin(a) * ry * r
    cr, sr = np.cos(rot), np.sin(rot)
    pts = np.stack([cx + x * cr - y * sr, cy + x * sr + y * cr], 1)
    img, dr, x0, y0 = patch_for(pts, 3)
    dr.polygon((pts - [x0, y0]).ravel().tolist(), fill=float(ink))
    L.put(x0, y0, np.asarray(img))


def leaf(L, x, y, ang, length, width, ink, curve=0.0, rng=None):
    """A slender pointed leaf (bamboo, reed) pressed down and lifted off."""
    t = np.linspace(0, 1, 24)
    prof = np.sin(np.pi * np.clip(t, 0, 1) ** 0.75) * (1 - 0.35 * t)
    dx, dy = np.cos(ang), np.sin(ang)
    nx, ny = -dy, dx
    bend = curve * length * t * t
    sx = x + dx * length * t + nx * bend
    sy = y + dy * length * t + ny * bend
    hw = width * 0.5 * prof
    pts = np.vstack([np.stack([sx + nx * hw, sy + ny * hw], 1),
                     np.stack([sx - nx * hw, sy - ny * hw], 1)[::-1]])
    img, dr, x0, y0 = patch_for(pts, 3)
    dr.polygon((pts - [x0, y0]).ravel().tolist(), fill=float(ink))
    L.put(x0, y0, np.asarray(img))


def apply_ink(cv, L, pigment, strength, bleed=0.8, halo=0.45, edge=0.35, gran=0.3, soften=0.0):
    m = np.minimum(L.a, 1.0)
    if soften:
        m = blur(m, soften)
    if halo:
        m = np.maximum(m, blur(m, 3.0) * halo)  # pigment creeping along wet fibres
    wash(cv, m, pigment, strength, gran=gran, edge=edge, edge_sigma=2.5, bleed=bleed)


def apply_body(cv, L, color, opacity, soften=0.8, texture=0.12):
    a = blur(np.minimum(L.a, 1.0), soften) * opacity
    if texture:
        a *= np.clip(1 - texture * cv.G * 0.5, 0, 1)
    cv.body(a, color)


# ---------------------------------------------------------------- landscape parts

def ridge_line(rng, base, peaks, rough=0.02, cell=520, pers=0.58, satellites=3):
    """1-D ridge (pixel row per column): each peak is a massif of uneven bumps
    (asymmetric flanks, a few lower shoulders), plus fractal roughness."""
    x = np.arange(W, dtype=np.float64) / W
    r = np.full(W, base * H)
    bumps = []
    for px, py, wd in peaks:
        bumps.append((px, py, wd, rng.uniform(0.7, 1.3), rng.uniform(1.3, 2.2)))
        for _ in range(satellites):
            f = rng.uniform(0.35, 0.8)
            bumps.append((px + rng.choice([-1, 1]) * wd * rng.uniform(0.5, 1.5), py + (base - py) * f * 0.6,
                          wd * rng.uniform(0.3, 0.7), rng.uniform(0.6, 1.6), rng.uniform(1.2, 2.4)))
    for px, py, wd, asym, ex in bumps:
        w_side = np.where(x < px, wd * asym, wd / asym)
        bump = np.exp(-np.abs((x - px) / w_side) ** ex)
        r = np.minimum(r, (base - (base - py) * bump) * H)
    r += noise1(rng, W, cell, 7, pers) * rough * H
    r += noise1(rng, W, cell / 6, 4, 0.5) * rough * 0.35 * H
    return r


def mountain(cv, ridge, pigment, rng, d_top=1.0, d_body=0.2, fall=120.0, mist_y=None, mist_h=120.0,
             tex=0.5, subridges=2, blur_s=0.0, edge=0.5, gran=0.35):
    yy = rows()
    dd = yy - ridge[None, :].astype(np.float32)
    inside = smoothstep(-1.0, 1.5, dd)
    dens = d_top * np.exp(-np.maximum(dd, 0) / fall) + d_body
    for _ in range(subridges):
        off = rng.uniform(0.25, 1.4) * fall
        r2 = ridge + off + np.abs(noise1(rng, W, rng.uniform(150, 400), 6, 0.6)) * fall * 1.1
        r2 = np.maximum(r2, ridge + 4)
        d2 = yy - r2[None, :].astype(np.float32)
        k = rng.uniform(0.35, 0.65)
        span = (0.5 + 0.5 * noise1(rng, W, 350, 3)).clip(0, 1).astype(np.float32)[None, :]
        dens += d_top * k * span * np.exp(-np.maximum(d2, 0) / (fall * 0.6)) * smoothstep(-1, 2, d2)
    if tex:
        idx = np.clip(dd, 0, H - 1).astype(np.int32)
        T = np.take_along_axis(cv.streaks, idx, axis=0)
        near = np.exp(-np.maximum(dd, 0) / (fall * 2.5))
        T = tex * T * (0.4 + 0.6 * near)
    else:
        T = 0.0
    fade = 1.0
    if mist_y is not None:
        nx = noise1(rng, W, 420, 5).astype(np.float32)[None, :] * mist_h * 0.55
        n2 = fbm(rng, 260, 3, aspect=(0.35, 1.0)) * mist_h * 0.3
        fade = 1.0 - smoothstep(-mist_h * 0.5, mist_h * 0.5, yy - mist_y - nx - n2)
        T = T * fade * fade
    dens *= np.clip(1.0 + T, 0.2, None)
    m = inside * fade
    if blur_s:
        m = blur(m, blur_s)
        dens = blur(dens, blur_s)
    d = dens * m
    if edge:
        e = np.clip(inside - blur(inside, 4.0), 0, None) * inside
        d += d_top * edge * 2.0 * e * (fade if np.ndim(fade) else 1.0)
    if gran:
        d += gran * cv.G * np.minimum(d, 0.75)
        np.maximum(d, 0, out=d)
    cv.glaze(d, pigment)


def ridge_trees(L, ridge, rng, xs, size, ink=0.8, depth=6):
    """Small far trees standing on a ridge, built from stacked dabs."""
    for x in xs:
        xi = int(np.clip(x, 0, W - 1))
        base = ridge[xi] + depth * rng.uniform(0.3, 1.0)
        s = size * rng.uniform(0.6, 1.2)
        stroke(L, [(x, base + 2), (x + rng.uniform(-2, 2), base - s)], max(1.2, s * 0.06), rng,
               ink=ink, taper=(0.0, 0.4), wobble=0.05)
        tiers = rng.integers(3, 6)
        for k in range(tiers):
            t = (k + 1) / (tiers + 1)
            wv = s * 0.38 * (1.1 - t) + 2
            blob(L, x + rng.uniform(-1.5, 1.5), base - s * t, wv, max(1.5, s * 0.07), rng,
                 ink=ink * rng.uniform(0.8, 1.0), rot=rng.uniform(-0.2, 0.2))


def moss(L, ridge, rng, x0, x1, n, size, depth=40.0, ink=0.9):
    """Moss dots (dian): small horizontal dabs scattered along a crest."""
    for _ in range(n):
        x = rng.uniform(x0, x1) * W
        y = ridge[int(np.clip(x, 0, W - 1))] + rng.exponential(depth) + 2
        sz = size * rng.uniform(0.5, 1.2)
        blob(L, x, y, sz, sz * rng.uniform(0.45, 0.7), rng, ink=ink * rng.uniform(0.7, 1.0),
             rot=rng.normal(0, 0.25), jag=0.25, npts=10)


def needle_pad(L, cx, cy, w, h, rng, ink=0.85, ang=0.0, density=1.0):
    """A pine needle cluster: fans of short strokes along a little spine."""
    n = int((w * h) ** 0.5 * 1.3 * density) + 10
    ca, sa = np.cos(ang), np.sin(ang)
    pts = []
    segs = []
    for _ in range(n):
        u = rng.uniform(-0.5, 0.5) * w
        bx, by = cx + u * ca, cy + u * sa
        a = -np.pi / 2 + ang + rng.normal(0, 0.75)
        if rng.random() < 0.18:
            a += np.pi
        ln = h * rng.uniform(0.45, 1.0) * (1 - 0.6 * abs(u) / w)
        ex, ey = bx + np.cos(a) * ln, by + np.sin(a) * ln
        segs.append((bx, by, ex, ey))
        pts += [(bx, by), (ex, ey)]
    img, dr, x0, y0 = patch_for(pts, 3)
    for bx, by, ex, ey in segs:
        dr.line([bx - x0, by - y0, ex - x0, ey - y0], fill=float(ink * rng.uniform(0.55, 1.0)),
                width=int(rng.choice([1, 1, 2])))
    L.put(x0, y0, np.asarray(img))


def pine(trunk, needles, mass, root, height, lean, rng, scale=1.0, spread=1.0, side=1):
    """A shan-shui pine: dry trunk, crooked branches, needle pads with a wash under them."""
    ctrl = []
    ph, kink = rng.uniform(0, 6), rng.uniform(0.3, 0.7)
    for i in range(8):
        t = i / 7
        x = root[0] + lean * height * t ** 1.2 + np.sin(t * 6 + ph) * height * 0.05
        x += np.sign(lean or 1) * -height * 0.06 * smoothstep(kink - 0.1, kink + 0.1, t)
        y = root[1] - height * t + rng.normal(0, height * 0.01)
        ctrl.append((x, y))
    w0 = height * 0.055 * scale
    stroke(trunk, ctrl, w0, rng, ink=0.95, dry=0.5, taper=(0.0, 0.25), press=lambda s: 1 - 0.65 * s,
           wobble=0.12, bristle=1.8)
    path = resample(spline(ctrl), 4.0)
    # bark plates
    for _ in range(int(height / 18)):
        i = int(rng.uniform(0.05, 0.75) * len(path))
        x, y = path[i]
        wv = w0 * (1 - 0.65 * i / len(path))
        stroke(trunk, [(x - wv * 0.35, y), (x, y - wv * 0.18), (x + wv * 0.35, y + wv * 0.05)],
               max(1.5, wv * 0.12), rng, ink=0.9, taper=(0.2, 0.3))
    # branches with needle pads
    nbr = int(rng.integers(6, 9))
    for b in range(nbr):
        t = 0.38 + 0.6 * b / (nbr - 1) + rng.uniform(-0.03, 0.03)
        i = min(len(path) - 1, int(t * len(path)))
        x, y = path[i]
        sd = side if b % 2 == 0 else -side
        if rng.random() < 0.25:
            sd = -sd
        ln = height * (0.42 * (1 - t) + 0.12) * spread * rng.uniform(0.8, 1.2)
        droop = rng.uniform(-0.12, 0.15)
        pts = [(x, y)]
        for k in range(1, 4):
            f = k / 3
            pts.append((x + sd * ln * f, y - ln * droop * f + ln * 0.18 * f * f + rng.normal(0, ln * 0.04)))
        bw = w0 * (1 - 0.6 * t) * 0.45
        stroke(trunk, pts, bw, rng, ink=0.92, dry=0.45, taper=(0.0, 0.5), press=lambda s: 1 - 0.6 * s)
        # pads along the branch
        npad = int(rng.integers(2, 4))
        for k in range(npad):
            f = 0.5 + 0.5 * (k + 1) / npad
            px = x + sd * ln * f + rng.normal(0, ln * 0.06)
            py = y - ln * droop * f + ln * 0.18 * f * f - height * 0.015
            pw = height * rng.uniform(0.11, 0.17) * scale
            ph = pw * rng.uniform(0.32, 0.45)
            needle_pad(needles, px, py, pw, ph, rng, ang=rng.uniform(-0.15, 0.15))
            blob(mass, px, py - ph * 0.3, pw * 0.55, ph * 0.6, rng, ink=0.7, rot=rng.uniform(-0.2, 0.2))
    # crown
    x, y = path[-1]
    for _ in range(3):
        pw = height * rng.uniform(0.10, 0.15) * scale
        px, py = x + rng.normal(0, pw * 0.4), y + rng.normal(0, pw * 0.15)
        needle_pad(needles, px, py, pw, pw * 0.4, rng)
        blob(mass, px, py - pw * 0.12, pw * 0.55, pw * 0.25, rng, ink=0.7)


def bamboo(culm, leaves, rng, x, y_bottom, y_top, width, lean=0.0, nodes=150, leaf_n=0,
           leaf_len=150, leaf_ink=0.9, ink=0.85):
    """One culm drawn segment by segment with dark nodes, plus leaf clusters."""
    total = y_bottom - y_top
    y = y_bottom
    seg_pts = []
    while y > y_top:
        seg = nodes * rng.uniform(0.8, 1.15) * (0.75 + 0.5 * (y - y_top) / total)
        y2 = max(y_top, y - seg)
        xa = x + lean * (y_bottom - y)
        xb = x + lean * (y_bottom - y2)
        stroke(culm, [(xa, y - 3), ((xa + xb) / 2 + rng.normal(0, 1), (y + y2) / 2), (xb, y2 + 3)],
               width, rng, ink=ink * rng.uniform(0.85, 1.0), dry=0.12, taper=(0.04, 0.04), minw=0.75,
               wobble=0.05, bristle=2.5)
        # node: a short dark stroke curving across
        stroke(culm, [(xb - width * 0.62, y2 + 2), (xb, y2 - 1.5), (xb + width * 0.62, y2 + 2)],
               max(2.0, width * 0.16), rng, ink=min(1.0, ink * 1.15), taper=(0.3, 0.3))
        seg_pts.append((xb, y2))
        y = y2
    for _ in range(leaf_n):
        if not seg_pts:
            break
        nx, ny = seg_pts[int(rng.integers(0, len(seg_pts)))]
        cluster(leaves, nx, ny, rng, leaf_len, leaf_ink)


def cluster(leaves, x, y, rng, length, ink, down=True):
    k = int(rng.integers(3, 6))
    base = np.pi / 2 if down else -np.pi / 2
    side = rng.choice([-1, 1])
    base += side * rng.uniform(0.3, 0.9)
    for j in range(k):
        a = base + (j - (k - 1) / 2) * rng.uniform(0.22, 0.38)
        ln = length * rng.uniform(0.6, 1.1)
        leaf(leaves, x + rng.normal(0, 3), y + rng.normal(0, 3), a, ln, ln * rng.uniform(0.09, 0.12),
             ink * rng.uniform(0.75, 1.0), curve=rng.uniform(-0.15, 0.15))


def reed(stems, blades, plumes, rng, x, y_bottom, height, lean, ink=0.85, plume=True):
    pts = []
    for i in range(5):
        t = i / 4
        pts.append((x + lean * height * t * t + rng.normal(0, 2), y_bottom - height * t))
    stroke(stems, pts, rng.uniform(2.5, 4.5), rng, ink=ink, taper=(0.0, 0.3), wobble=0.08)
    path = resample(spline(pts), 3.0)
    for _ in range(int(rng.integers(2, 5))):
        i = int(rng.uniform(0.05, 0.6) * len(path))
        bx, by = path[i]
        sd = rng.choice([-1, 1])
        a = -np.pi / 2 + sd * rng.uniform(0.2, 0.7)
        ln = height * rng.uniform(0.25, 0.5)
        leaf(blades, bx, by, a, ln, rng.uniform(7, 13), ink * rng.uniform(0.7, 1.0),
             curve=sd * rng.uniform(0.25, 0.6))
    if plume:
        tx, ty = path[-1]
        a0 = np.arctan2(path[-1][1] - path[-8][1], path[-1][0] - path[-8][0])
        for _ in range(int(rng.integers(26, 40))):
            f = rng.uniform(0, 1)
            px = tx + np.cos(a0) * f * height * 0.11 + rng.normal(0, 4)
            py = ty + np.sin(a0) * f * height * 0.11 + rng.normal(0, 4)
            aa = a0 + rng.normal(0.9 * rng.choice([-1, 1]), 0.3)
            ln = rng.uniform(10, 26) * (1 - 0.5 * f)
            stroke(plumes, [(px, py), (px + np.cos(aa) * ln, py + np.sin(aa) * ln)], rng.uniform(2, 4),
                   rng, ink=rng.uniform(0.5, 0.9), taper=(0.1, 0.6), wobble=0.1)


def blossom(petals, centres, stamens, x, y, r, rng, open_=True):
    if not open_:
        blob(petals, x, y, r * 0.4, r * 0.42, rng, ink=1.0, jag=0.08)
        blob(centres, x + rng.normal(0, r * 0.08), y + r * 0.33, r * 0.18, r * 0.13, rng, ink=0.9)
        return
    rot = rng.uniform(0, 2 * np.pi)
    sq = rng.uniform(0.55, 1.0)
    tilt = rng.uniform(0, np.pi)
    ct, st_ = np.cos(tilt), np.sin(tilt)
    for k in range(5):
        a = rot + k * 2 * np.pi / 5 + rng.normal(0, 0.08)
        ox, oy = np.cos(a) * r * 0.52, np.sin(a) * r * 0.52 * sq
        ox, oy = ox * ct - oy * st_, ox * st_ + oy * ct
        blob(petals, x + ox, y + oy, r * 0.5, r * 0.5 * (0.75 + 0.25 * sq), rng, ink=1.0, jag=0.07,
             rot=a)
    blob(centres, x, y, r * 0.12, r * 0.12, rng, ink=0.9, npts=10)
    for _ in range(int(rng.integers(5, 8))):
        a = rng.uniform(0, 2 * np.pi)
        ln = r * rng.uniform(0.3, 0.5)
        ex, ey = x + np.cos(a) * ln, y + np.sin(a) * ln * sq
        stroke(stamens, [(x, y), (ex, ey)], 1.0, rng, ink=0.7, taper=(0.1, 0.1), wobble=0)
        blob(stamens, ex, ey, 1.3, 1.3, rng, ink=0.85, jag=0.05, npts=8)


def seal(cv, x, y, w, h, rng):
    """A small square vermilion seal with carved, glyph-like white lines."""
    yy, xx = rows(), cols()
    a = ((xx > x) & (xx < x + w) & (yy > y) & (yy < y + h)).astype(np.float32)
    carve = Image.new('F', (W, H), 0.0)
    dr = ImageDraw.Draw(carve)
    for col in range(2):
        cx0 = x + w * (0.12 + 0.44 * col)
        for _ in range(4):
            if rng.random() < 0.6:
                yy0 = y + h * rng.uniform(0.12, 0.85)
                dr.line([cx0, yy0, cx0 + w * 0.32, yy0 + rng.uniform(-2, 2)], fill=1.0, width=3)
            else:
                xx0 = cx0 + w * rng.uniform(0.0, 0.32)
                yy0 = y + h * rng.uniform(0.1, 0.5)
                dr.line([xx0, yy0, xx0, yy0 + h * rng.uniform(0.2, 0.4)], fill=1.0, width=3)
    m = a * (1 - np.asarray(carve)) * np.clip(0.85 + 0.25 * cv.G, 0, 1)
    cv.body(blur(m, 0.8) * 0.78, VERMILION)


def moon_hole(cx, cy, r, glow):
    d = np.sqrt((cols() - cx) ** 2 + (rows() - cy) ** 2)
    disc = 1 - smoothstep(r - 2.0, r + 2.0, d)
    halo = np.exp(-(d / glow) ** 2)
    return disc, halo


def stars(cv, rng, n, region, avoid, color=(0.92, 0.92, 0.86)):
    L = Layer()
    big = Layer()
    calm = calm_weight()
    placed = 0
    while placed < n:
        x = rng.uniform(region[0], region[1]) * W
        y = rng.uniform(region[2], region[3]) * H
        if calm[int(y), int(x)] > 0.15 or avoid(x, y):
            continue
        r = rng.uniform(0.9, 1.8)
        tgt = big if rng.random() < 0.12 else L
        blob(tgt, x, y, r * (1.8 if tgt is big else 1), r * (1.8 if tgt is big else 1), rng,
             ink=rng.uniform(0.35, 1.0), jag=0.05, npts=10)
        placed += 1
    cv.body(blur(L.a, 0.7) * 0.9, color)
    glow = blur(big.a, 4.0)
    cv.body(np.clip(blur(big.a, 0.9) * 0.95 + glow * 0.5, 0, 1), color)


def reflect(cv, y_w, rng, depth=None, blur_y=6.0, ripple=6.0, strength=0.75, tint=(0.8, 0.85, 0.95)):
    """Mirror everything above the waterline into the water, blurred and rippled."""
    depth = depth or (H - y_w)
    src = cv.c[y_w - depth:y_w][::-1].copy()
    k = np.arange(depth, dtype=np.float32)
    dist = (k / depth)[:, None]
    phase = noise1(rng, depth, 14, 3)[:, None] * 2.0
    xx = np.arange(W, dtype=np.float32)[None, :]
    dx = ripple * (0.3 + 1.7 * dist) * np.sin(xx / (60 + 40 * dist) + phase) \
        + ripple * 0.6 * noise1(rng, depth, 6, 2)[:, None] * (0.3 + dist)
    xs = np.clip(xx + dx, 0, W - 1.001)
    x0 = np.floor(xs).astype(np.int32)
    fx = (xs - x0)[..., None]
    rr = np.arange(depth)[:, None]
    out = src[rr, x0] * (1 - fx) + src[rr, x0 + 1] * fx
    for c in range(3):
        out[..., c] = ndi.gaussian_filter1d(out[..., c], blur_y, axis=0)
        out[..., c] = ndi.gaussian_filter1d(out[..., c], 1.5, axis=1)
    out *= np.asarray(tint, np.float32)
    a = (strength * (1 - 0.35 * dist))[..., None]
    region = cv.c[y_w:y_w + depth]
    region += (out - region) * a


# ---------------------------------------------------------------- finishing

def finish(cv, rng, calm_detail=0.45, calm_tone=0.12, vignette=0.16, paper_tex=1.0):
    calm = calm_weight()
    c = cv.c
    lo = np.stack([blur(c[..., k], 18) for k in range(3)], -1)
    c += (lo - c) * (calm * calm_detail)[..., None]
    centre = c[int(H * 0.2):int(H * 0.8), int(W * 0.15):int(W * 0.85)].reshape(-1, 3).mean(0)
    c += (centre - c) * (calm * calm_tone)[..., None]
    x = (np.arange(W, dtype=np.float32) + 0.5) / W - 0.5
    y = (np.arange(H, dtype=np.float32) + 0.5) / H - 0.5
    r = np.sqrt((x[None, :] / 0.5) ** 2 + (y[:, None] / 0.5) ** 2)
    vig = 1 - vignette * smoothstep(0.6, 1.45, r)
    tex = 1 + paper_tex * (0.016 * cv.fib + 0.008 * cv.grain)
    c *= (vig * tex)[..., None]
    c += 0.06 * (1.0 - np.clip(c, 0, 1)) ** 4  # ink on paper never reaches pure black
    c8 = c * 255.0 + (rng.random((H, W, 1), dtype=np.float32) + rng.random((H, W, 1), dtype=np.float32) - 1.0)
    return np.clip(np.round(c8), 14, 246).astype(np.uint8)


# ---------------------------------------------------------------- scenes

def spray(twigs, leaves, rng, x, y, side, length, leaf_len, ink):
    """A bamboo twig growing out of a node, with leaf clusters hanging from it."""
    pts = [(x, y), (x + side * length * 0.5, y - length * rng.uniform(0.05, 0.2)),
           (x + side * length, y - length * rng.uniform(-0.05, 0.1))]
    stroke(twigs, pts, rng.uniform(2.5, 4.0), rng, ink=0.85, taper=(0.0, 0.5), wobble=0.1)
    path = resample(spline(pts), 30)
    for p in path[max(1, len(path) // 3):]:
        if rng.random() < 0.45:
            cluster(leaves, p[0], p[1], rng, leaf_len, ink)
    cluster(leaves, path[-1][0], path[-1][1], rng, leaf_len, ink)


def closed_spline(pts, per=12):
    p = np.asarray(pts, np.float64)
    n = len(p)
    t = np.linspace(0, 1, per, endpoint=False)[:, None]
    out = []
    for i in range(n):
        p0, p1, p2, p3 = p[i - 1], p[i], p[(i + 1) % n], p[(i + 2) % n]
        out.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t ** 2
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    return np.vstack(out)


def fill(L, pts, ink=1.0):
    pts = np.asarray(pts)
    img, dr, x0, y0 = patch_for(pts, 3)
    dr.polygon((pts - [x0, y0]).ravel().tolist(), fill=float(ink))
    L.put(x0, y0, np.asarray(img))


def paint_nebelberge(rng):
    cv = Canvas(rng)
    cv.glaze(np.float32(0.42) * (1 + 0.2 * fbm(rng, 600, 3)), SEPIA)
    cv.glaze(np.full((H, W), 0.42, np.float32), INK_COOL)
    sky(cv, 1.05, 0.15, 0.58, INDIGO, rng, cloud=0.35)
    MIST = (0.62, 0.64, 0.62)

    r1 = ridge_line(rng, 0.52, [(0.28, 0.33, 0.09), (0.47, 0.37, 0.07), (0.66, 0.30, 0.10)], rough=0.012)
    mountain(cv, r1, BLUEGREY, rng, d_top=0.75, d_body=0.15, fall=80, mist_y=0.47 * H, mist_h=0.09 * H,
             tex=0.35, subridges=1, blur_s=2.0, edge=0.3)
    mist(cv, 0.50 * H, 0.06 * H, MIST, 0.45, rng)

    r2 = ridge_line(rng, 0.64, [(0.06, 0.13, 0.08), (0.17, 0.25, 0.06), (0.88, 0.15, 0.08),
                                (0.97, 0.22, 0.05), (0.62, 0.43, 0.05)], rough=0.022)
    mountain(cv, r2, INK_COOL, rng, d_top=1.2, d_body=0.22, fall=150, mist_y=0.62 * H, mist_h=0.13 * H,
             tex=0.65, subridges=3, blur_s=0.8)
    far_trees = Layer()
    for cx in (0.06, 0.17, 0.88):
        xs = (cx + rng.normal(0, 0.025, 9)) * W
        ridge_trees(far_trees, r2, rng, xs, 26, ink=0.85)
    apply_ink(cv, far_trees, INK_COOL, 0.9, bleed=0.9, edge=0.2)
    mist(cv, 0.66 * H, 0.08 * H, MIST, 0.55, rng)

    r3 = ridge_line(rng, 1.0, [(0.01, 0.50, 0.10), (0.13, 0.60, 0.07), (0.96, 0.53, 0.09),
                               (0.83, 0.66, 0.06)], rough=0.016)
    mountain(cv, r3, INK_WARM, rng, d_top=1.45, d_body=0.3, fall=120, mist_y=0.82 * H, mist_h=0.1 * H,
             tex=0.7, subridges=2, blur_s=0.5)
    mid_trees = Layer()
    for cx in (0.03, 0.13, 0.95, 0.83):
        xs = (cx + rng.normal(0, 0.02, 7)) * W
        ridge_trees(mid_trees, r3, rng, xs, 40, ink=0.9)
    moss(mid_trees, r3, rng, 0.0, 0.2, 90, 7, depth=50)
    moss(mid_trees, r3, rng, 0.8, 1.0, 90, 7, depth=50)
    apply_ink(cv, mid_trees, INK_WARM, 1.1, bleed=0.7, edge=0.25)
    mist(cv, 0.86 * H, 0.06 * H, MIST, 0.45, rng)

    r4 = ridge_line(rng, 1.1, [(0.0, 0.70, 0.13), (0.11, 0.79, 0.06), (1.0, 0.73, 0.12), (0.9, 0.84, 0.05)],
                    rough=0.012, cell=300)
    mountain(cv, r4, INK, rng, d_top=1.9, d_body=0.55, fall=90, tex=0.8, subridges=2, edge=0.7)
    crest = Layer()
    for x0, x1 in ((0.0, 0.2), (0.82, 1.0)):
        xs = np.linspace(x0, x1, 14) * W
        pts = [(x, r4[int(min(x, W - 1))] + 2) for x in xs]
        stroke(crest, pts, 9, rng, ink=0.95, dry=0.6, taper=(0.05, 0.3))
        moss(crest, r4, rng, x0, x1, 70, 9, depth=35)
    trunk, needles, mass = Layer(), Layer(), Layer()
    pine(trunk, needles, mass, (0.105 * W, 0.80 * H), 0.42 * H, 0.15, rng, side=1)
    pine(trunk, needles, mass, (0.905 * W, 0.84 * H), 0.30 * H, -0.18, rng, side=-1, spread=0.9)
    pine(trunk, needles, mass, (0.065 * W, 0.83 * H), 0.24 * H, -0.05, rng, side=1, spread=0.8)
    apply_ink(cv, mass, JADE_DEEP, 0.9, bleed=2.5, halo=0.3, edge=0.6, gran=0.5)
    apply_ink(cv, mass, INK_COOL, 0.45, bleed=3.0, halo=0, edge=0.3)
    apply_ink(cv, trunk, INK, 1.9, bleed=0.6)
    apply_ink(cv, crest, INK, 1.3, bleed=0.6)
    apply_ink(cv, needles, INK, 1.5, bleed=0.5, halo=0.3, edge=0.2)
    seal(cv, 0.905 * W, 0.255 * H, 40, 54, rng)
    return finish(cv, rng, calm_detail=0.4, calm_tone=0.08)


def paint_pflaumenbluete(rng):
    cv = Canvas(rng)
    mx, my, mr = 0.885 * W, 0.25 * H, 86
    disc, halo = moon_hole(mx, my, mr, 420)
    hole = (1 - 0.94 * disc) * (1 - 0.5 * halo)
    cv.glaze(np.float32(0.3) * hole, SEPIA)
    sky(cv, 1.55, 1.1, 1.0, INDIGO, rng, cloud=0.18, hole=hole)
    sky(cv, 0.4, 0.6, 1.0, INK_COOL, rng, cloud=0.25, hole=hole)
    cv.glaze(disc * np.clip(0.08 + 0.07 * fbm(rng, 30, 3), 0, None), BLUEGREY)
    r = ridge_line(rng, 0.9, [(0.3, 0.80, 0.15), (0.7, 0.78, 0.2)], rough=0.01)
    mountain(cv, r, INDIGO, rng, d_top=0.6, d_body=0.25, fall=100, mist_y=0.9 * H, mist_h=0.08 * H,
             tex=0.12, subridges=1, blur_s=4.0, edge=0.2, gran=0.15)
    mist(cv, 0.86 * H, 0.07 * H, (0.30, 0.34, 0.44), 0.35, rng)

    trunk, bark, twigs, petals, centres, stamens = Layer(), Layer(), Layer(), Layer(), Layer(), Layer()
    calm = calm_weight()

    def ok(x, y):
        return 0 <= x < W and 0 <= y < H and calm[int(y), int(x)] < 0.45

    def limb(pts, width, press, end=0.45):
        stroke(trunk, pts, width, rng, ink=0.85, taper=(0.0, end), press=press, wobble=0.2, smooth=False)
        stroke(bark, pts, width * 1.05, rng, ink=1.0, dry=0.85, taper=(0.0, end), press=press, wobble=0.25,
               smooth=False, bristle=1.7, dry_base=0.55)

    def up(a):  # plum twigs reach up and out, never hang
        return np.arctan2(min(np.sin(a), 0.15), np.cos(a))

    main = [(-0.02 * W, 1.02 * H), (0.04 * W, 0.86 * H), (0.03 * W, 0.72 * H), (0.075 * W, 0.58 * H),
            (0.06 * W, 0.44 * H), (0.10 * W, 0.31 * H)]
    limb(main, 66, lambda s: 1 - 0.5 * s, end=0.04)
    stroke(bark, [(0.0, 0.9 * H), (0.05 * W, 0.80 * H), (0.045 * W, 0.66 * H)], 18, rng, ink=0.9, dry=0.7)
    upper = [(0.10 * W, 0.31 * H), (0.13 * W, 0.235 * H), (0.21 * W, 0.195 * H), (0.30 * W, 0.18 * H),
             (0.40 * W, 0.172 * H), (0.48 * W, 0.176 * H)]
    limb(upper, 30, lambda s: 1 - 0.6 * s)
    side = [(0.06 * W, 0.68 * H), (0.11 * W, 0.74 * H), (0.17 * W, 0.84 * H), (0.22 * W, 0.86 * H)]
    limb(side, 22, lambda s: 1 - 0.6 * s)
    tips = []

    def twig(x, y, ang, ln, w, depth=0):
        pts = [(x, y)]
        cx, cy = x, y
        segs = int(rng.integers(2, 4))
        ang = up(ang)
        for _ in range(segs):
            ang = up(ang + rng.normal(0, 0.25))
            cx += np.cos(ang) * ln / segs
            cy += np.sin(ang) * ln / segs
            pts.append((cx, cy))
        stroke(twigs, pts, w, rng, ink=0.93, dry=0.3, taper=(0.0, 0.6), smooth=False, wobble=0.1)
        path = np.asarray(pts)
        for p in resample(path, 28)[1:]:
            tips.append((p[0], p[1]))
        if depth < 2 and ln > 70:
            for _ in range(int(rng.integers(1, 3))):
                i = int(rng.uniform(0.3, 0.8) * (len(path) - 1))
                bx, by = path[i] + (path[min(i + 1, len(path) - 1)] - path[i]) * 0.5
                twig(bx, by, ang + rng.choice([-1, 1]) * rng.uniform(0.5, 1.0), ln * rng.uniform(0.45, 0.65),
                     max(2.0, w * 0.6), depth + 1)

    twig(0.48 * W, 0.176 * H, -0.1, 0.22 * W, 9)  # the long whip reaching toward the moon
    twig(0.40 * W, 0.172 * H, -1.0, 150, 7)
    twig(0.30 * W, 0.18 * H, -0.6, 170, 8)
    twig(0.21 * W, 0.195 * H, -1.3, 150, 8)
    twig(0.13 * W, 0.235 * H, -2.0, 160, 8)
    twig(0.075 * W, 0.58 * H, -0.4, 230, 10)
    twig(0.06 * W, 0.44 * H, -2.5, 150, 8)
    twig(0.22 * W, 0.86 * H, -0.4, 230, 9)
    twig(0.17 * W, 0.84 * H, -1.3, 170, 7)
    twig(0.04 * W, 0.80 * H, -0.25, 150, 8)
    twig(0.09 * W, 0.36 * H, -0.1, 200, 9)
    for x, y in tips + [tuple(p) for p in resample(np.asarray(upper), 60)[3:]]:
        if not ok(x, y) or rng.random() < 0.3:
            continue
        for _ in range(int(rng.integers(1, 3))):
            bx, by = x + rng.normal(0, 12), y + rng.normal(0, 10)
            if ok(bx, by):
                blossom(petals, centres, stamens, bx, by, rng.uniform(12, 20), rng, open_=rng.random() < 0.7)

    apply_ink(cv, trunk, INK_WARM, 0.75, bleed=1.2, halo=0.35, edge=0.9, gran=0.5)
    apply_ink(cv, bark, INK, 1.9, bleed=0.5, halo=0.2, edge=0.2)
    apply_ink(cv, twigs, INK, 1.8, bleed=0.6, halo=0.3)
    pm = np.minimum(petals.a, 1)
    pet = blur(pm, 0.9)
    shade = np.clip(0.8 + 0.2 * fbm(rng, 18, 2), 0.5, 1.0)
    cv.body(pet * 0.86 * shade, (0.91, 0.87, 0.87))
    cv.body(pet * 0.45 * blur(pm, 7), (0.88, 0.64, 0.70))
    cv.glaze(np.clip(pet - blur(pm, 2.2), 0, None) * 0.9, ROSE)
    apply_ink(cv, centres, OCHRE, 1.4, bleed=0.5, halo=0, edge=0)
    apply_ink(cv, stamens, INK_WARM, 0.75, bleed=0.4, halo=0, edge=0, gran=0)
    return finish(cv, rng, calm_detail=0.45, calm_tone=0.1, vignette=0.2)


def paint_bambushain(rng):
    cv = Canvas(rng)
    cv.glaze(np.full((H, W), 0.3, np.float32), SEPIA)
    sky(cv, 1.1, 0.75, 1.0, JADE_DEEP, rng, cloud=0.2)
    glow = np.exp(-(((cols() / W - 0.5) / 0.45) ** 2 + ((rows() / H - 0.42) / 0.5) ** 2))
    cv.glaze(np.float32(0.95) * (1 - 0.7 * glow), INK_COOL)
    MIST = (0.55, 0.62, 0.57)

    far = Layer()
    for x in np.linspace(-0.02, 1.02, 34) * W:
        x += rng.normal(0, 25)
        bamboo(far, far, rng, x, 1.05 * H, -0.05 * H, rng.uniform(7, 12), lean=rng.normal(0, 0.02),
               nodes=170, ink=0.6)
    apply_ink(cv, far, JADE_DEEP, 0.36, bleed=3.5, halo=0, edge=0.2)
    mist(cv, 0.45 * H, 0.22 * H, MIST, 0.55, rng)
    mist(cv, 0.8 * H, 0.12 * H, MIST, 0.35, rng)

    mid_c, mid_t, mid_l = Layer(), Layer(), Layer()
    xs = list(np.linspace(0.0, 0.22, 6)) + list(np.linspace(0.78, 1.0, 6)) + [0.3, 0.7]
    for x in xs:
        x = (x + rng.normal(0, 0.012)) * W
        ln = rng.normal(0, 0.03)
        bamboo(mid_c, mid_c, rng, x, 1.05 * H, -0.05 * H, rng.uniform(13, 20), lean=ln, nodes=165, ink=0.8)
        if 0.25 * W < x < 0.75 * W:
            continue
        for _ in range(int(rng.integers(2, 4))):
            y = rng.uniform(0.02, 0.6) * H
            sd = 1 if x < W / 2 else -1
            spray(mid_t, mid_l, rng, x + ln * (1.05 * H - y), y, sd if rng.random() < 0.7 else -sd,
                  rng.uniform(100, 220), 110, 0.85)
    apply_ink(cv, mid_c, JADE_DEEP, 0.85, bleed=1.6, halo=0.2, edge=0.6)
    apply_ink(cv, mid_t, JADE_DEEP, 0.8, bleed=1.4, halo=0.2)
    apply_ink(cv, mid_l, JADE_DEEP, 0.85, bleed=1.6, halo=0.2, edge=0.3)
    mist(cv, 0.55 * H, 0.18 * H, MIST, 0.4, rng)

    near_c, twigs, dark, pale = Layer(), Layer(), Layer(), Layer()
    culms = [(0.035, 40, -0.01), (0.105, 32, 0.015), (0.155, 22, -0.02), (0.87, 36, 0.01),
             (0.935, 44, -0.015), (0.985, 26, 0.0)]
    for x, wd, ln in culms:
        bamboo(near_c, near_c, rng, x * W, 1.05 * H, -0.05 * H, wd, lean=ln, nodes=190, ink=0.9)
    for x, wd, ln in culms:
        sd = 1 if x < 0.5 else -1
        for k in range(int(rng.integers(3, 6))):
            y = rng.uniform(-0.02, 0.75) * H
            if k == 0:
                y = rng.uniform(0.0, 0.1) * H
            length = rng.uniform(140, 300) * (1.8 if y < 0.12 * H else 1.0)
            spray(twigs, dark if rng.random() < 0.55 else pale, rng, x * W + ln * (1.05 * H - y), y,
                  sd if rng.random() < 0.75 else -sd, length, 170, 1.0)
    for _ in range(14):  # young leaves at the bottom corners
        x = rng.choice([rng.uniform(0.0, 0.2), rng.uniform(0.8, 1.0)]) * W
        cluster(pale, x, rng.uniform(0.92, 1.0) * H, rng, 150, 0.9, down=False)
    apply_ink(cv, near_c, INK_COOL, 0.95, bleed=0.8, halo=0.3, edge=0.9)
    apply_ink(cv, near_c, JADE_DEEP, 0.6, bleed=1.2, halo=0, edge=0)
    apply_ink(cv, twigs, INK_COOL, 1.2, bleed=0.6, halo=0.2)
    apply_ink(cv, pale, JADE_DEEP, 0.75, bleed=1.0, halo=0.3, edge=0.6)
    apply_ink(cv, pale, INK_COOL, 0.6, bleed=1.0, halo=0, edge=0.3)
    apply_ink(cv, dark, INK_COOL, 1.4, bleed=0.7, halo=0.3, edge=0.5)
    return finish(cv, rng, calm_detail=0.45, calm_tone=0.1)


def paint_stiller_see(rng):
    cv = Canvas(rng)
    yw = int(0.52 * H)
    cv.glaze(np.full((H, W), 0.25, np.float32), SEPIA)
    # dusk: warm low sky, indigo above
    t = smoothstep(0.0, 0.5 * H, rows())
    cv.glaze(np.broadcast_to((1 - t) * 1.3 + 0.2, (H, W)).astype(np.float32)
             * (1 + 0.25 * fbm(rng, 500, 4, aspect=(0.4, 1))), INDIGO)
    warm = np.exp(-(((cols() / W - 0.62) / 0.5) ** 2 + ((rows() / H - 0.47) / 0.14) ** 2))
    cv.glaze(np.float32(0.9) * warm, OCHRE)
    cv.glaze(np.float32(0.5) * warm, ROSE)
    cv.glaze(np.full((H, W), 0.32, np.float32), INK_COOL)
    MIST = (0.58, 0.55, 0.54)

    r1 = ridge_line(rng, 0.47, [(0.18, 0.27, 0.12), (0.42, 0.33, 0.08), (0.62, 0.36, 0.1), (0.85, 0.26, 0.11)],
                    rough=0.012)
    mountain(cv, r1, BLUEGREY, rng, d_top=0.8, d_body=0.25, fall=90, mist_y=0.46 * H, mist_h=0.07 * H,
             tex=0.4, subridges=2, blur_s=1.8, edge=0.3)
    mist(cv, 0.47 * H, 0.04 * H, MIST, 0.4, rng)
    r2 = ridge_line(rng, 0.53, [(0.0, 0.25, 0.1), (0.1, 0.33, 0.06), (0.95, 0.30, 0.08), (0.86, 0.40, 0.05)],
                    rough=0.016)
    mountain(cv, r2, INK_COOL, rng, d_top=1.35, d_body=0.35, fall=110, mist_y=0.505 * H, mist_h=0.05 * H,
             tex=0.65, subridges=2, blur_s=0.6)
    # promontory with pavilion on the left
    r3 = ridge_line(rng, 0.56, [(0.04, 0.42, 0.07), (0.14, 0.47, 0.035)], rough=0.008, cell=200)
    r3[int(0.2 * W):] = H
    mountain(cv, r3, INK, rng, d_top=1.7, d_body=0.6, fall=60, mist_y=0.535 * H, mist_h=0.025 * H, tex=0.8,
             subridges=1, edge=0.7)
    ink = Layer()
    px, py, s = 0.13 * W, r3[int(0.13 * W)] + 6, 150
    _pavilion(ink, px, py, s, rng)
    trunk, needles, mass = Layer(), Layer(), Layer()
    pine(trunk, needles, mass, (0.07 * W, r3[int(0.07 * W)] + 10), 0.2 * H, 0.12, rng, side=1, spread=0.8)
    apply_ink(cv, mass, JADE_DEEP, 0.8, bleed=2.0, halo=0.3, edge=0.5)
    apply_ink(cv, trunk, INK, 1.8, bleed=0.6)
    apply_ink(cv, needles, INK, 1.4, bleed=0.5)
    apply_ink(cv, ink, INK, 1.9, bleed=0.6, halo=0.2)
    # the lake: base tone, reflection, then surface light
    lake = smoothstep(yw - 2, yw + 3, rows()) * np.ones((1, W), np.float32)
    cv.glaze(lake * np.float32(0.25), INK_COOL)
    reflect(cv, yw, rng, blur_y=11, ripple=6, strength=0.72, tint=(0.82, 0.86, 0.95))
    dd = (rows() - yw) / (H - yw)
    cv.glaze(lake * (0.15 + 0.9 * np.clip(dd, 0, 1) ** 1.3).astype(np.float32), PRUSSIAN)
    glint = Layer()
    for _ in range(90):
        y = yw + (rng.random() ** 1.6) * (H - yw) * 0.9 + 6
        x = rng.uniform(0.05, 0.95) * W
        ln = rng.uniform(40, 240) * (0.6 + (y - yw) / (H - yw))
        stroke(glint, [(x, y), (x + ln, y + rng.normal(0, 1))], rng.uniform(1.5, 3.5), rng, ink=rng.uniform(0.3, 0.8),
               taper=(0.4, 0.4), wobble=0.3)
    apply_body(cv, glint, (0.80, 0.72, 0.62), 0.22, soften=1.5, texture=0)
    mist(cv, yw + 4, 0.025 * H, MIST, 0.35, rng, wisp=0.6)
    # boat with a fisherman at the lower right
    boat = Layer()
    _boat(boat, 0.79 * W, 0.83 * H, 170, rng)
    apply_ink(cv, boat, INK, 1.9, bleed=0.6, halo=0.2)
    refl = Layer()  # the boat mirrored about its waterline, fading with depth
    refl.a = np.roll(boat.a[::-1], int(2 * 0.83 * H) - H + 10, axis=0)
    refl.a[:int(0.83 * H)] = 0
    refl.a = ndi.gaussian_filter1d(refl.a, 5, axis=0) * np.clip(1 - (rows() - 0.83 * H) / 120, 0, 1)
    apply_ink(cv, refl, INK_COOL, 0.8, bleed=1.5, halo=0, edge=0)
    rip = Layer()
    for k in range(6):
        y = 0.83 * H + 12 + k * 9
        x = 0.79 * W + rng.normal(0, 30)
        ln = 160 + k * 40
        stroke(rip, [(x - ln / 2, y), (x + ln / 2, y + rng.normal(0, 1))], 2.2, rng, ink=0.6, taper=(0.3, 0.3))
    apply_ink(cv, rip, INK_COOL, 0.6, bleed=0.7)
    seal(cv, 0.09 * W, 0.20 * H, 38, 50, rng)
    return finish(cv, rng, calm_detail=0.35, calm_tone=0.08)


def _pavilion(L, px, py, s, rng):
    stroke(L, [(px - 0.5 * s, py), (px + 0.5 * s, py)], 0.07 * s, rng, ink=0.95, dry=0.3, taper=(0.05, 0.05))
    for x in (-0.36, -0.12, 0.12, 0.36):
        stroke(L, [(px + x * s, py), (px + x * s + rng.normal(0, 1), py - 0.45 * s)], 0.035 * s, rng, ink=0.95,
               taper=(0.02, 0.02), minw=0.8, wobble=0.05)
    stroke(L, [(px - 0.38 * s, py - 0.14 * s), (px + 0.38 * s, py - 0.14 * s)], 0.02 * s, rng, ink=0.8,
           taper=(0.1, 0.1))
    stroke(L, [(px - 0.4 * s, py - 0.45 * s), (px + 0.4 * s, py - 0.45 * s)], 0.03 * s, rng, ink=0.9,
           taper=(0.05, 0.05))
    t = np.linspace(0, 1, 40)
    eave_x = px + (t - 0.5) * 1.3 * s
    eave_y = py - 0.47 * s - 0.09 * s * (np.abs(t - 0.5) * 2) ** 3
    roof_l = np.stack([px - 0.65 * s + (0.65 * s) * t, py - 0.56 * s - 0.33 * s * t ** 1.7], 1)
    roof_r = np.stack([px + (0.65 * s) * t, py - 0.89 * s + 0.33 * s * t ** 0.59], 1)
    poly = np.vstack([np.stack([eave_x, eave_y], 1), roof_r[::-1], roof_l[::-1]])
    img, dr, x0, y0 = patch_for(poly, 4)
    dr.polygon((poly - [x0, y0]).ravel().tolist(), fill=0.8)
    L.put(x0, y0, np.asarray(img))
    stroke(L, np.stack([eave_x, eave_y + 2], 1)[::3].tolist(), 0.035 * s, rng, ink=1.0, taper=(0.05, 0.05))
    stroke(L, [(px, py - 0.89 * s), (px, py - 1.0 * s)], 0.03 * s, rng, ink=0.95, taper=(0.0, 0.5))


def _boat(L, cx, cy, s, rng):
    t = np.linspace(0, 1, 40)
    top = np.stack([cx + (t - 0.5) * s, cy - 0.06 * s * (np.abs(t - 0.5) * 2) ** 2.5 - 0.02 * s], 1)
    bot = np.stack([cx + (t - 0.5) * 0.86 * s, cy + 0.07 * s * np.sin(np.pi * t)], 1)
    poly = np.vstack([top, bot[::-1]])
    img, dr, x0, y0 = patch_for(poly, 4)
    dr.polygon((poly - [x0, y0]).ravel().tolist(), fill=0.85)
    L.put(x0, y0, np.asarray(img))
    stroke(L, top[::4].tolist(), 0.03 * s, rng, ink=1.0, dry=0.3, taper=(0.1, 0.1))
    # seated figure with a straw hat
    fx, fy = cx + 0.12 * s, cy - 0.04 * s
    blob(L, fx, fy - 0.08 * s, 0.05 * s, 0.07 * s, rng, ink=0.9)
    hat = [(fx - 0.11 * s, fy - 0.13 * s), (fx, fy - 0.22 * s), (fx + 0.11 * s, fy - 0.13 * s)]
    img, dr, x0, y0 = patch_for(hat, 3)
    dr.polygon((np.asarray(hat) - [x0, y0]).ravel().tolist(), fill=0.9)
    L.put(x0, y0, np.asarray(img))
    stroke(L, [(fx - 0.02 * s, fy - 0.1 * s), (cx - 0.55 * s, cy - 0.5 * s)], 3.0, rng, ink=0.8, taper=(0.1, 0.6))


def _crane_standing(white, shade, dark, red, fx, fy, s, rng, d=1):
    """Red-crowned crane standing on one leg; d=1 faces left."""
    def P(x, y):
        return (fx + d * x * s, fy + y * s)

    def Ps(pts):
        return [P(x, y) for x, y in pts]
    stroke(dark, Ps([(-0.01, -0.49), (0.015, -0.27), (-0.005, 0.0)]), 0.012 * s, rng, ink=0.7, taper=(0.0, 0.05),
           minw=0.7, wobble=0.05)
    stroke(dark, Ps([(0.04, -0.49), (0.085, -0.34), (0.03, -0.27), (-0.01, -0.255)]), 0.011 * s, rng, ink=0.65,
           taper=(0.0, 0.2), minw=0.6, wobble=0.05)
    stroke(dark, Ps([(-0.005, 0.0), (-0.09, 0.006)]), 0.008 * s, rng, ink=0.6, taper=(0.0, 0.5))
    stroke(dark, Ps([(-0.005, 0.0), (0.06, 0.005)]), 0.008 * s, rng, ink=0.55, taper=(0.0, 0.5))
    body = closed_spline(Ps([(-0.20, -0.60), (-0.12, -0.675), (0.02, -0.695), (0.15, -0.665), (0.27, -0.575),
                             (0.20, -0.525), (0.04, -0.485), (-0.12, -0.505)]))
    fill(white, body)
    fill(shade, closed_spline(Ps([(-0.16, -0.54), (0.0, -0.575), (0.2, -0.57), (0.24, -0.54), (0.04, -0.487),
                                  (-0.13, -0.505)])), 0.9)
    for k in range(6):  # folded wing feathers
        y0 = -0.655 + 0.022 * k
        stroke(shade, Ps([(-0.06 + 0.02 * k, y0), (0.08, y0 + 0.012), (0.2 + 0.01 * k, y0 + 0.05)]), 0.012 * s, rng,
               ink=0.7, dry=0.3, taper=(0.3, 0.5))
    stroke(dark, Ps([(-0.12, -0.676), (0.02, -0.697), (0.15, -0.667), (0.25, -0.59)]), 0.006 * s, rng, ink=0.3,
           dry=0.5, taper=(0.3, 0.3))
    neck = [(-0.165, -0.64), (-0.225, -0.725), (-0.25, -0.82), (-0.215, -0.915), (-0.225, -0.972)]
    stroke(white, Ps([(x + 0.018, y + 0.01) for x, y in neck[:4]]), 0.05 * s, rng, ink=1.0, taper=(0.1, 0.4))
    stroke(dark, Ps([(x - 0.006, y) for x, y in neck]), 0.034 * s, rng, ink=0.95, dry=0.25, taper=(0.2, 0.0),
           minw=0.55, bristle=1.6)
    blob(dark, *P(-0.232, -0.985), 0.032 * s, 0.021 * s, rng, ink=0.95, jag=0.05)
    blob(red, *P(-0.228, -1.0), 0.014 * s, 0.009 * s, rng, ink=1.0, jag=0.05)
    stroke(dark, Ps([(-0.258, -0.985), (-0.365, -0.962)]), 0.012 * s, rng, ink=0.55, taper=(0.0, 0.85))
    for k in range(5):
        stroke(dark, Ps([(0.10, -0.645 + 0.012 * k), (0.22, -0.60 + 0.012 * k),
                         (0.30 + 0.012 * k, -0.50 + 0.014 * k)]), 0.05 * s, rng, ink=0.95, dry=0.45,
               taper=(0.1, 0.6), bristle=1.8)
    stroke(dark, Ps([(-0.17, -0.55), (-0.02, -0.488), (0.16, -0.515)]), 0.005 * s, rng, ink=0.35,
           taper=(0.3, 0.3))


def _crane_flying(white, shade, dark, red, cx, cy, s, rng, d=1):
    """Crane in flight, wings raised; d=1 flies to the right."""
    def P(x, y):
        return (cx + d * x * s, cy + y * s)

    def Ps(pts):
        return [P(x, y) for x, y in pts]
    fill(white, closed_spline(Ps([(0.17, -0.012), (0.08, -0.04), (-0.06, -0.042), (-0.18, -0.012),
                                  (-0.06, 0.035), (0.08, 0.03)])))
    wings = (([(0.07, -0.03), (0.05, -0.22), (-0.03, -0.42), (-0.10, -0.56)],
              [(-0.10, -0.56), (-0.17, -0.44), (-0.175, -0.24), (-0.10, -0.035)], -1, 0.95, white),
             ([(0.06, 0.025), (0.03, 0.15), (-0.04, 0.27), (-0.09, 0.33)],
              [(-0.09, 0.33), (-0.145, 0.25), (-0.145, 0.12), (-0.08, 0.03)], 1, 0.75, shade))
    for lead, trail, sgn, ink, lay in wings:
        poly = np.vstack([spline(lead), spline(trail)])
        fill(white, Ps(poly))
        if lay is shade:
            fill(shade, Ps(poly), 0.6)
        tr = spline(trail)
        for k in range(11):
            x, y = tr[int(k / 11 * (len(tr) - 1) * 0.9)]
            ln = rng.uniform(0.09, 0.13) * (1.1 - 0.4 * k / 11)
            dx, dy = -1.0, 0.3 * sgn
            nrm = np.hypot(dx, dy)
            stroke(dark, Ps([(x + 0.02, y), (x + dx / nrm * ln, y + dy / nrm * ln)]), 0.04 * s, rng, ink=ink,
                   dry=0.35, taper=(0.05, 0.55), bristle=1.6)
        tip = lead[-1]
        for k in range(4):
            a = np.arctan2(tip[1] - lead[-2][1], tip[0] - lead[-2][0]) + (k - 1.5) * 0.18
            ln = rng.uniform(0.07, 0.1)
            stroke(dark, Ps([(tip[0] - np.cos(a) * 0.04, tip[1] - np.sin(a) * 0.04),
                             (tip[0] + np.cos(a) * ln, tip[1] + np.sin(a) * ln)]), 0.03 * s, rng, ink=ink * 0.9,
                   dry=0.3, taper=(0.05, 0.6))
        stroke(dark, Ps(spline(lead)[::4]), 0.005 * s, rng, ink=0.3, taper=(0.2, 0.3))
    stroke(dark, Ps([(0.15, -0.012), (0.30, -0.03), (0.42, -0.04)]), 0.018 * s, rng, ink=0.95, taper=(0.0, 0.1),
           minw=0.6)
    blob(dark, *P(0.43, -0.042), 0.019 * s, 0.013 * s, rng, ink=0.95, jag=0.05)
    blob(red, *P(0.43, -0.053), 0.008 * s, 0.006 * s, rng, ink=1.0, jag=0.05)
    stroke(dark, Ps([(0.445, -0.04), (0.53, -0.033)]), 0.006 * s, rng, ink=0.55, taper=(0.0, 0.8))
    for k in (0, 1):
        stroke(dark, Ps([(-0.14, 0.012 + 0.01 * k), (-0.47, 0.035 + 0.02 * k)]), 0.006 * s, rng, ink=0.6,
               taper=(0.1, 0.3))
    stroke(dark, Ps([(-0.13, -0.02), (-0.2, -0.01), (-0.25, 0.0)]), 0.032 * s, rng, ink=0.85, dry=0.4)


def paint_kranichmorgen(rng):
    cv = Canvas(rng)
    cv.glaze(np.full((H, W), 0.18, np.float32), SEPIA)
    t = smoothstep(0.0, 0.62 * H, rows())
    cv.glaze(np.broadcast_to((1 - t) * 0.72 + 0.12, (H, W)).astype(np.float32)
             * (1 + 0.2 * fbm(rng, 520, 4, aspect=(0.45, 1))), BLUEGREY)
    warm = np.exp(-(((cols() / W - 0.6) / 0.55) ** 2 + ((rows() / H - 0.58) / 0.22) ** 2))
    cv.glaze(np.float32(0.7) * warm, OCHRE)
    cv.glaze(np.float32(0.45) * warm, ROSE)
    cv.glaze(np.full((H, W), 0.25, np.float32) * (1 - 0.3 * warm), INK_WARM)
    MIST = (0.74, 0.70, 0.63)
    r1 = ridge_line(rng, 0.66, [(0.25, 0.53, 0.12), (0.55, 0.58, 0.1), (0.85, 0.52, 0.12)], rough=0.01)
    mountain(cv, r1, BLUEGREY, rng, d_top=0.55, d_body=0.2, fall=70, mist_y=0.64 * H, mist_h=0.06 * H, tex=0.3,
             subridges=1, blur_s=2.5, edge=0.2)
    mist(cv, 0.66 * H, 0.05 * H, MIST, 0.5, rng)
    yw = int(0.68 * H)
    lake = smoothstep(yw - 2, yw + 3, rows()) * np.ones((1, W), np.float32)
    reflect(cv, yw, rng, blur_y=9, ripple=4, strength=0.6, tint=(0.88, 0.88, 0.92))
    dd = np.clip((rows() - yw) / (H - yw), 0, 1)
    cv.glaze(lake * (0.1 + 0.6 * dd).astype(np.float32), INK_COOL)
    glint = Layer()
    for _ in range(60):
        y = yw + rng.random() * (H - yw) * 0.8 + 5
        x = rng.uniform(0.15, 0.85) * W
        ln = rng.uniform(40, 200)
        stroke(glint, [(x, y), (x + ln, y + rng.normal(0, 1))], rng.uniform(1.5, 3), rng, ink=rng.uniform(0.3, 0.8),
               taper=(0.4, 0.4))
    apply_body(cv, glint, (0.88, 0.82, 0.70), 0.25, soften=1.5, texture=0)
    far = Layer()
    for x in np.concatenate([rng.uniform(0.0, 0.3, 50), rng.uniform(0.7, 1.0, 50)]) * W:
        reed(far, far, far, rng, x, 0.8 * H + rng.uniform(0, 0.05) * H, rng.uniform(0.12, 0.22) * H,
             rng.normal(0, 0.15), ink=0.8, plume=rng.random() < 0.5)
    apply_ink(cv, far, INK_WARM, 0.55, bleed=2.0, halo=0, edge=0.2)
    mist(cv, 0.83 * H, 0.05 * H, MIST, 0.35, rng)

    def reeds(xs, hmin, hmax):
        stems, blades, plumes = Layer(), Layer(), Layer()
        for x in xs * W:
            side = -1 if x < W / 2 else 1
            reed(stems, blades, plumes, rng, x, 1.03 * H, rng.uniform(hmin, hmax) * H,
                 side * rng.uniform(0.0, 0.25), ink=0.9)
        apply_ink(cv, blades, INK_WARM, 1.1, bleed=0.8, halo=0.3, edge=0.4)
        apply_ink(cv, stems, INK_WARM, 1.25, bleed=0.6)
        apply_ink(cv, plumes, SEPIA, 1.6, bleed=1.2, halo=0.3, edge=0.2)
        apply_ink(cv, plumes, INK_WARM, 0.5, bleed=1.5, halo=0, edge=0)

    reeds(np.concatenate([rng.uniform(-0.02, 0.2, 22), rng.uniform(0.8, 1.02, 26)]), 0.34, 0.55)
    white, shade, dark, red = Layer(), Layer(), Layer(), Layer()
    _crane_standing(white, shade, dark, red, 0.125 * W, 0.9 * H, 440, rng, d=1)
    _crane_flying(white, shade, dark, red, 0.80 * W, 0.215 * H, 340, rng, d=-1)
    wa = blur(np.minimum(white.a, 1), 1.4)
    cv.body(wa * 0.92 * np.clip(1 - 0.06 * cv.G, 0, 1), (0.94, 0.92, 0.87))
    cv.glaze(blur(np.minimum(shade.a, 1), 3.0) * wa * 0.75 + wa * 0.08 * np.clip(cv.G, 0, None), BLUEGREY)
    apply_ink(cv, dark, INK, 2.0, bleed=0.5, halo=0.25, edge=0.3)
    cv.body(blur(np.minimum(red.a, 1), 0.8) * 0.85, VERMILION)
    reeds(np.concatenate([rng.uniform(0.02, 0.07, 3), rng.uniform(0.16, 0.22, 3)]), 0.12, 0.2)
    return finish(cv, rng, calm_detail=0.35, calm_tone=0.08, vignette=0.14)


def paint_mondnacht(rng):
    cv = Canvas(rng)
    mx, my, mr = 0.14 * W, 0.255 * H, 80
    disc, halo = moon_hole(mx, my, mr, 520)
    hole = (1 - 0.95 * disc) * (1 - 0.55 * halo)
    cv.glaze(np.float32(0.3) * hole, SEPIA)
    sky(cv, 1.8, 1.2, 0.9, PRUSSIAN, rng, cloud=0.18, hole=hole)
    sky(cv, 0.5, 0.3, 0.9, INDIGO, rng, cloud=0.25, hole=hole)
    cv.glaze(disc * np.clip(0.1 + 0.08 * fbm(rng, 26, 3), 0, None), BLUEGREY)

    def near_moon(x, y):
        return (x - mx) ** 2 + (y - my) ** 2 < 260 ** 2

    stars(cv, rng, 70, (0.0, 1.0, 0.03, 0.6), near_moon)
    MIST = (0.36, 0.42, 0.52)
    r1 = ridge_line(rng, 0.66, [(0.35, 0.47, 0.1), (0.58, 0.50, 0.12), (0.78, 0.40, 0.08)], rough=0.012)
    mountain(cv, r1, PRUSSIAN, rng, d_top=0.75, d_body=0.25, fall=90, mist_y=0.62 * H, mist_h=0.08 * H,
             tex=0.35, subridges=1, blur_s=2.0, edge=0.3)
    mist(cv, 0.64 * H, 0.06 * H, MIST, 0.4, rng)
    r2 = ridge_line(rng, 1.0, [(0.88, 0.20, 0.07), (0.97, 0.28, 0.05), (0.76, 0.45, 0.05), (0.03, 0.55, 0.08),
                                (0.2, 0.62, 0.06)], rough=0.022)
    mountain(cv, r2, INK_COOL, rng, d_top=1.3, d_body=0.35, fall=140, mist_y=0.74 * H, mist_h=0.12 * H,
             tex=0.6, subridges=3, blur_s=0.7)
    mist(cv, 0.77 * H, 0.07 * H, MIST, 0.45, rng)
    r3 = ridge_line(rng, 1.05, [(0.0, 0.78, 0.15), (0.12, 0.84, 0.07), (1.0, 0.72, 0.12), (0.86, 0.82, 0.07)],
                    rough=0.012, cell=300)
    mountain(cv, r3, INK, rng, d_top=1.6, d_body=0.6, fall=90, tex=0.7, subridges=2, edge=0.6)
    trees = Layer()
    ridge_trees(trees, r3, rng, (0.87 + rng.normal(0, 0.03, 10)) * W, 55, ink=0.95)
    ridge_trees(trees, r3, rng, (0.07 + rng.normal(0, 0.03, 8)) * W, 45, ink=0.95)
    apply_ink(cv, trees, INK, 1.6, bleed=0.6)
    # moonlight catching the mist near the moon side
    xamp = np.exp(-((np.arange(W) / W - 0.2) / 0.5) ** 2).astype(np.float32)
    mist(cv, 0.52 * H, 0.05 * H, (0.55, 0.60, 0.68), 0.18, rng, x_amp=xamp)
    return finish(cv, rng, calm_detail=0.45, calm_tone=0.1, vignette=0.22)


SCENES = [
    # id, name, painter, seed, accent
    ('nebelberge', 'Nebelberge', paint_nebelberge, 11, '#c9a45c'),
    ('pflaumenbluete', 'Pflaumenblüte', paint_pflaumenbluete, 23, '#d9b56e'),
    ('bambushain', 'Bambushain', paint_bambushain, 37, '#cdb062'),
    ('stiller_see', 'Stiller See', paint_stiller_see, 41, '#d4a35a'),
    ('kranichmorgen', 'Kranichmorgen', paint_kranichmorgen, 53, '#b8873e'),
    ('mondnacht', 'Mondnacht', paint_mondnacht, 67, '#d6b878'),
]


def luma(a):
    a = a.astype(np.float32) / 255.0
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def centre(a):
    return a[int(H * 0.19):int(H * 0.81), int(W * 0.14):int(W * 0.86)]


def render(spec):
    sid, _, painter, seed, _ = spec
    t0 = time.time()
    img = painter(np.random.default_rng(seed))
    im = Image.fromarray(img, 'RGB')
    path = OUT / f'{sid}.jpg'
    for q in (85, 83, 81, 79, 76):
        im.save(path, quality=q, optimize=True, progressive=True, subsampling='4:2:0')
        if path.stat().st_size < 450_000:
            break
    im.resize(THUMB, Image.LANCZOS).save(OUT / f'{sid}_thumb.jpg', quality=85, optimize=True)
    return sid, time.time() - t0, q


def main():
    wanted = set(sys.argv[1:])
    specs = [s for s in SCENES if not wanted or s[0] in wanted]
    if wanted - {s[0] for s in SCENES}:
        sys.exit(f'unknown scene: {sorted(wanted - {s[0] for s in SCENES})}')
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    with Pool(min(len(specs), max(1, (os.cpu_count() or 2) - 1))) as pool:
        for sid, dt, q in pool.imap_unordered(render, specs):
            print(f'painted {sid:15s} {dt:6.1f} s  (JPEG quality {q})', flush=True)
    manifest = []
    for sid, name, _, _, accent in SCENES:
        path = OUT / f'{sid}.jpg'
        if not path.exists():
            continue
        a = np.asarray(Image.open(path).convert('RGB'))
        mc = centre(a).reshape(-1, 3).astype(np.float32).mean(0)
        mat = np.clip(mc * 0.34, 8, 60).round().astype(int)
        manifest.append({'id': sid, 'name': name, 'file': f'{sid}.jpg', 'thumb': f'{sid}_thumb.jpg',
                         'mat': f'rgba({mat[0]}, {mat[1]}, {mat[2]}, 0.42)', 'accent': accent})
        lum = luma(a)
        print(f'{sid:15s} luma mean {lum.mean():.3f}  centre {centre(lum).mean():.3f}  '
              f'centre std {centre(lum).std():.3f}  {path.stat().st_size / 1000:.0f} KB', flush=True)
    for old in ('placeholder.jpg', 'placeholder_thumb.jpg'):
        if (OUT / old).exists():
            (OUT / old).unlink()
    (OUT / 'index.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'wrote {len(manifest)} backgrounds to {OUT} in {time.time() - t0:.0f} s')


if __name__ == '__main__':
    main()
