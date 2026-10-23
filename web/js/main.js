// The app: screens, the HUD, and the wiring between the game model, the
// board view, the effects, the sounds and the settings.

import { Game, STATE, RESULT } from './game.js';
import { BoardView } from './render/board.js';
import { Effects } from './render/fx.js';
import { tileSprite, backSprite, BRUSH_FONT, DISPLAY_FONT } from './render/tileart.js';
import { TILESETS, findTileSet } from './tilesets.js';
import { Audio } from './audio.js';
import { Settings } from './settings.js';
import { loadBackgrounds, preload } from './backgrounds.js';
import { T, LANGUAGES, setLanguage, formatTime, formatNumber } from './i18n.js';
import { TIME_LIMIT_MS } from './scoring.js';

const $ = (id) => document.getElementById(id);

class App {
  constructor() {
    this.settings = new Settings();
    this.audio = new Audio(this.settings);
    this.fx = new Effects($('fx'));
    this.view = new BoardView($('board'), $('fx'), {
      settings: this.settings,
      onTap: (i) => this.onTap(i),
    });
    this.game = null;
    this.screen = null;
    this.lastTick = 0;
    this.warned = false;
    this.busy = 0;
    this.bgLayer = 0;
  }

  async start() {
    this.applyLanguage();
    await this.loadFonts();
    this.backgrounds = await loadBackgrounds();
    this.applyBackground(this.settings.get('background') || this.backgrounds[0]?.id, { instant: true });
    this.applyTileSet(this.settings.get('tileset'));
    await this.loadLogo();
    this.buildBackgroundPicker();
    this.buildTileSetPicker();
    this.bindUi();
    this.bindSettings();
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
    // The Android shell announces its pause and resume; visibilitychange
    // covers browsers. A window blur alone is not a reason to pause (the
    // system bars appearing in immersive mode blur the page briefly), but a
    // focus is a safe moment to make sure the sound is back.
    document.addEventListener('visibilitychange', () => this.onVisibility());
    document.addEventListener('app-pause', () => this.onVisibility(true));
    document.addEventListener('app-resume', () => this.onVisibility(false));
    window.addEventListener('focus', () => this.onVisibility(false));
    document.addEventListener('pointerdown', () => this.audio.unlock(), { capture: true });
    this.fx.setAmbient(true);
    this.showTitle();
    this.audio.init().then(() => {
      this.buildTrackPicker();
      this.audio.startMusic();
    });
  }

  applyLanguage() {
    const language = setLanguage(this.settings.get('language'));
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = T[el.dataset.i18n];
    for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', T[el.dataset.i18nAria]);
    const select = $('set-language');
    const automatic = select.querySelector('option[value=""]');
    if (automatic) automatic.textContent = T.automatic;
    select.value = this.settings.get('language') || '';
    const hs = this.settings.highScore;
    $('title-highscore').textContent = hs > 0 ? `${T.highScore}: ${formatNumber(hs)}` : T.noHighScore;
    // Refresh labels without rebuilding pickers or losing their scroll/focus.
    for (const el of document.querySelectorAll('#set-picker .thumb, #bg-picker .thumb')) {
      el.querySelector('span').textContent = T[el.dataset.id] || el.querySelector('span').textContent;
    }
    for (const el of document.querySelectorAll('#set-track .choice')) el.textContent = T[el.dataset.id] || el.textContent;
    this.updateHud();
    if (this.game?.summary) this.updateEnd(this.game.summary);
    if (this.backgrounds) this.handleResize();
  }

  async loadFonts() {
    const faces = [
      new FontFace(BRUSH_FONT, 'url(assets/fonts/brush.woff2)'),
      new FontFace(DISPLAY_FONT, 'url(assets/fonts/display.woff2)', { weight: '300 700' }),
      new FontFace('NebelText', 'url(assets/fonts/text.woff2)', { weight: '200 900' }),
    ];
    await Promise.all(faces.map((f) => f.load().then((loaded) => document.fonts.add(loaded)).catch(() => null)));
  }

  async loadLogo() {
    try {
      const svg = await (await fetch('assets/logo.svg')).text();
      $('logo').innerHTML = svg;
    } catch {
      // The wordmark alone still identifies the game.
    }
  }

  // ---- layout -----------------------------------------------------------

  handleResize() {
    const w = window.innerWidth, h = window.innerHeight;
    const wide = w / h >= 1.6;
    document.body.classList.toggle('wide', wide);
    document.body.classList.toggle('tall', !wide);
    this.fx.resize();
    this.view.resizeCanvas();
    this.updateArea();
  }

  updateArea() {
    const r = $('stage').getBoundingClientRect();
    const margin = Math.min(r.width, r.height) * 0.03;
    this.view.setArea({ x: r.left + margin, y: r.top + margin, w: r.width - 2 * margin, h: r.height - 2 * margin });
    const c = $('collect').getBoundingClientRect();
    this.view.setTray({ x: c.left, y: c.top, w: c.width, h: c.height });
  }

  // ---- screens ----------------------------------------------------------

  show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === id);
    this.screen = id;
  }

  showTitle() {
    this.view.visible = false;
    $('game-layer').classList.add('hidden');
    const hs = this.settings.highScore;
    $('title-highscore').textContent = hs > 0 ? `${T.highScore}: ${formatNumber(hs)}` : T.noHighScore;
    this.audio.duckMusic(1);
    this.show('title');
    this.view.invalidate();
  }

  newGame() {
    this.game = new Game();
    this.warned = false;
    this.bindGame(this.game);
    this.show(null);
    $('game-layer').classList.remove('hidden');
    this.updateArea();
    this.view.visible = true;
    // The tap that closed the previous screen must not land on the fresh board.
    this.inputGraceUntil = performance.now() + 700;
    this.view.setGame(this.game);
    this.updateHud();
    this.audio.duckMusic(1);
    this.audio.play('shuffle', { volume: 0.7 });
    this.lastTick = performance.now();
    this.loopToken = (this.loopToken || 0) + 1;
    this.loop(this.loopToken);
  }

  bindGame(game) {
    game.on('select', ({ tile, previous }) => {
      if (previous >= 0) this.view.deselect(previous);
      this.view.select(tile);
      this.audio.play('select');
      this.haptic(8);
    });
    game.on('deselect', ({ tile }) => {
      this.view.deselect(tile);
      this.audio.play('tap', { volume: 0.6 });
    });
    game.on('blocked', ({ tile }) => {
      this.view.blocked(tile);
      this.audio.play('blocked', { volume: 0.7 });
      this.haptic([12, 30, 12]);
    });
    game.on('start', () => this.updateHud());
    game.on('match', ({ a, b, points, chain }) => this.onMatch(a, b, points, chain));
    game.on('reshuffle', ({ matches }) => this.onReshuffle(matches));
    game.on('hint', ({ pair }) => {
      this.view.hint(pair);
      this.audio.play('hint', { volume: 0.8 });
    });
    game.on('over', (summary) => this.onGameOver(summary));
  }

  onTap(i) {
    if (!this.game || this.busy) return;
    if (this.screen || performance.now() < this.inputGraceUntil) return;
    this.game.tap(i);
  }

  onMatch(a, b, points, chain) {
    const chained = chain >= 2;
    this.audio.play(chained ? `chain${Math.min(6, chain)}` : 'match');
    this.haptic(chained ? [10, 40, 16] : 14);
    // The pair flies to the tray on its own; the board stays playable.
    this.view.match(a, b, {
      onParticles: (pa, pb, size) => {
        this.fx.burst(pa, size, chained ? 5 : 3);
        this.fx.burst(pb, size, chained ? 5 : 3);
        const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 - size * 0.2 };
        this.fx.label(mid, `+${formatNumber(points)}`, {
          sub: chained ? `${T.chain} ×${formatNumber(chain)}` : null,
          size: Math.max(18, size * 0.42),
          color: chained ? '#f3d78a' : '#f7efd9',
        });
      },
    });
    this.updateHud();
  }

  async onReshuffle(matches) {
    this.busy++;
    this.toast(T.shuffling, 2800);
    await new Promise((r) => setTimeout(r, 700));
    this.audio.play('shuffle');
    await this.view.reshuffle(this.game.kinds);
    this.busy--;
    this.updateHud();
    void matches;
  }

  async onGameOver(summary) {
    this.updateHud();
    const won = summary.result === RESULT.WON;
    const record = this.settings.recordScore(summary.total);
    this.audio.duckMusic(0.35, 1.2);
    // Let the last pair land; on a cleared board the full pile takes a bow.
    await this.view.whenSettled();
    if (won) await this.view.celebratePile();
    await new Promise((r) => setTimeout(r, won ? 500 : 400));
    this.audio.play(won ? 'win' : 'over');
    $('end-record').classList.toggle('hidden', !record);
    this.updateEnd(summary);
    this.show('end');
    if (won) this.fx.celebrate();
  }

  updateEnd(summary) {
    $('end-title').textContent = {
      [RESULT.WON]: T.endWon,
      [RESULT.TIMEOUT]: T.endTimeout,
      [RESULT.QUIT]: T.endQuit,
      [RESULT.STUCK]: T.endStuck,
    }[summary.result];
    $('end-base').textContent = formatNumber(summary.base);
    $('end-completion-label').textContent = `${T.completion} · ${formatNumber(summary.percent)} %`;
    $('end-completion').textContent = formatNumber(summary.completion);
    $('end-time').textContent = formatNumber(summary.time);
    $('end-total').textContent = formatNumber(summary.total);
    $('end-highscore').textContent = `${T.highScore}: ${formatNumber(this.settings.highScore)}`;
  }

  // ---- loop and HUD -----------------------------------------------------

  loop(token) {
    if (!this.game || token !== this.loopToken) return;
    const now = performance.now();
    const dt = Math.min(1000, now - this.lastTick);
    this.lastTick = now;
    if (this.game.state === STATE.PLAYING) {
      this.game.tick(dt);
      this.updateTime();
    }
    if (this.game.state !== STATE.OVER) requestAnimationFrame(() => this.loop(token));
  }

  updateTime() {
    const left = this.game.timeLeft;
    const text = formatTime(left);
    const el = $('hud-time');
    if (el.textContent !== text) el.textContent = text;
    const urgent = left <= 30000 && this.game.state !== STATE.OVER;
    el.parentElement.classList.toggle('urgent', urgent);
    if (urgent && !this.warned) {
      this.warned = true;
      this.audio.play('warning', { volume: 0.7 });
      this.toast(T.timeRunningOut, 2200);
    }
  }

  updateHud() {
    const g = this.game;
    if (!g) return;
    $('hud-score').textContent = formatNumber(g.scorer.score);
    $('hud-pairs').textContent = formatNumber(g.matchCount);
    $('hud-tiles').textContent = formatNumber(g.tilesLeft);
    this.updateTime();
    $('btn-hint').disabled = g.state === STATE.OVER;
  }

  toast(text, ms) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  haptic(pattern) {
    if (!this.settings.get('haptics') || !navigator.vibrate) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      // Not available on this device.
    }
  }

  // ---- pause and visibility ---------------------------------------------

  pause() {
    if (!this.game) return;
    if (this.game.state === STATE.PLAYING) this.game.pause();
    this.audio.duckMusic(0.4);
    this.show('pause');
  }

  resume() {
    if (!this.game) return;
    this.game.resume();
    this.lastTick = performance.now();
    this.inputGraceUntil = performance.now() + 350;
    this.audio.duckMusic(1);
    this.show(null);
  }

  onVisibility(blurred = false) {
    const hidden = document.hidden || blurred;
    if (hidden) {
      if (this.game && this.game.state === STATE.PLAYING) this.pause();
      this.audio.suspend();
      this.fx.setAmbient(false);
    } else if (!document.hidden) {
      this.audio.resume();
      this.fx.setAmbient(true);
      this.lastTick = performance.now();
      this.view.invalidate();
    }
  }

  // ---- UI wiring --------------------------------------------------------

  bindUi() {
    const click = (id, fn) => $(id).addEventListener('click', () => {
      this.audio.play('tap', { volume: 0.5 });
      fn();
    });
    click('btn-play', () => this.newGame());
    click('btn-settings', () => this.openSettings('title'));
    click('btn-help', () => this.openHelp('title'));
    click('btn-hint', () => {
      if (this.busy || this.screen) return;
      this.game && this.game.hint();
    });
    click('btn-pause', () => this.pause());
    click('btn-resume', () => this.resume());
    click('btn-pause-settings', () => this.openSettings('pause'));
    click('btn-pause-help', () => this.openHelp('pause'));
    click('btn-pause-new', () => this.restart());
    click('btn-pause-quit', () => this.show('confirm'));
    click('btn-confirm-no', () => this.show('pause'));
    click('btn-confirm-yes', () => {
      this.show(null);
      this.game.quit();
    });
    click('btn-settings-close', () => this.closeOverlay());
    click('btn-help-close', () => this.closeOverlay());
    click('btn-end-again', () => this.restart());
    click('btn-end-title', () => this.leaveToTitle());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'h' && this.game && !this.screen) this.game.hint();
      if (e.key === 'Escape' || e.key === 'p') {
        if (!this.screen && this.game) this.pause();
        else if (this.screen === 'pause') this.resume();
      }
    });
  }

  dropGame() {
    if (this.game) this.game.listeners = {};
    this.game = null;
  }

  async restart() {
    this.show(null);
    this.dropGame();
    await this.view.fadeOut();
    this.newGame();
  }

  async leaveToTitle() {
    this.show(null);
    this.dropGame();
    await this.view.fadeOut();
    this.showTitle();
  }

  openSettings(from) {
    this.returnTo = from;
    this.show('settings');
  }

  openHelp(from) {
    this.returnTo = from;
    this.renderHelpTiles();
    this.show('help');
  }

  closeOverlay() {
    this.show(this.returnTo === 'pause' ? 'pause' : 'title');
  }

  bindSettings() {
    const s = this.settings;
    const language = $('set-language');
    language.add(new Option(T.automatic, ''));
    for (const [id, name] of Object.entries(LANGUAGES)) {
      const option = new Option(name, id);
      option.lang = id;
      language.add(option);
    }
    language.value = s.get('language') || '';
    language.addEventListener('change', () => s.set('language', language.value || null));
    s.onChange((name) => {
      if (name === 'language') this.applyLanguage();
    });
    window.addEventListener('languagechange', () => {
      if (!s.get('language')) this.applyLanguage();
    });
    const music = $('set-music'), effects = $('set-effects');
    const haptics = $('set-haptics'), markFree = $('set-markfree');
    music.value = s.get('music');
    effects.value = s.get('effects');
    haptics.checked = s.get('haptics');
    markFree.checked = s.get('markFree');
    music.addEventListener('input', () => s.set('music', Number(music.value)));
    effects.addEventListener('input', () => s.set('effects', Number(effects.value)));
    effects.addEventListener('change', () => this.audio.play('match', { volume: 0.8 }));
    haptics.addEventListener('change', () => {
      s.set('haptics', haptics.checked);
      if (haptics.checked) this.haptic(14);
    });
    markFree.addEventListener('change', () => s.set('markFree', markFree.checked));
  }

  /** One button per music track; choosing one crossfades to it. */
  buildTrackPicker() {
    const picker = $('set-track');
    picker.innerHTML = '';
    for (const track of this.audio.tracks) {
      const b = document.createElement('button');
      b.className = 'choice';
      b.dataset.id = track.id;
      b.textContent = T[track.id] || track.name;
      b.addEventListener('click', () => {
        this.audio.play('tap', { volume: 0.5 });
        this.settings.set('track', track.id);
        this.markTrack();
      });
      picker.appendChild(b);
    }
    this.markTrack();
  }

  markTrack() {
    const current = this.audio.track?.id;
    for (const b of document.querySelectorAll('#set-track .choice')) b.classList.toggle('selected', b.dataset.id === current);
  }

  buildBackgroundPicker() {
    const picker = $('bg-picker');
    picker.innerHTML = '';
    for (const bg of this.backgrounds) {
      const b = document.createElement('button');
      b.className = 'thumb';
      b.dataset.id = bg.id;
      b.innerHTML = `<img alt="" src="${bg.thumb}"><span></span>`;
      b.querySelector('span').textContent = T[bg.id] || bg.name;
      b.addEventListener('click', () => {
        this.audio.play('tap', { volume: 0.5 });
        this.settings.set('background', bg.id);
        this.applyBackground(bg.id);
      });
      picker.appendChild(b);
    }
    this.markBackground();
  }

  markBackground() {
    const current = this.currentBackground?.id;
    for (const b of document.querySelectorAll('#bg-picker .thumb')) b.classList.toggle('selected', b.dataset.id === current);
  }

  /** One face and one back per set, drawn with the set's own renderer. */
  buildTileSetPicker() {
    const picker = $('set-picker');
    picker.innerHTML = '';
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const set of TILESETS) {
      const b = document.createElement('button');
      b.className = 'thumb';
      b.dataset.id = set.id;
      const c = document.createElement('canvas');
      const cw = 128, ch = 80, tw = 38;
      c.width = cw * dpr;
      c.height = ch * dpr;
      const ctx = c.getContext('2d');
      ctx.scale(dpr, dpr);
      const face = tileSprite(9, tw, dpr, { set: set.id });
      const back = backSprite(tw, dpr, { set: set.id });
      ctx.drawImage(back.canvas, cw / 2 + tw * 0.12 - back.origin, (ch - back.h) / 2 - back.origin - 2, back.canvas.width / dpr, back.canvas.height / dpr);
      ctx.drawImage(face.canvas, cw / 2 - tw * 1.1 - face.origin, (ch - face.h) / 2 - face.origin - 2, face.canvas.width / dpr, face.canvas.height / dpr);
      const label = document.createElement('span');
      label.textContent = T[set.id] || set.name;
      b.append(c, label);
      b.addEventListener('click', () => {
        this.audio.play('tap', { volume: 0.5 });
        this.settings.set('tileset', set.id);
        this.applyTileSet(set.id);
      });
      picker.appendChild(b);
    }
    this.markTileSet();
  }

  markTileSet() {
    const current = this.currentTileSet?.id;
    for (const b of document.querySelectorAll('#set-picker .thumb')) b.classList.toggle('selected', b.dataset.id === current);
  }

  /** Switches the set at once, also mid-game: the board redraws from the new sprites. */
  applyTileSet(id) {
    const set = findTileSet(id);
    if (set === this.currentTileSet) return;
    this.currentTileSet = set;
    this.markTileSet();
    this.view.setTileSet(set);
    if (this.screen === 'help') this.renderHelpTiles();
  }

  async applyBackground(id, { instant = false } = {}) {
    const bg = this.backgrounds.find((b) => b.id === id) || this.backgrounds[0];
    if (!bg || bg === this.currentBackground) return;
    this.currentBackground = bg;
    this.markBackground();
    this.view.setMat(bg.mat);
    document.documentElement.style.setProperty('--gold', bg.accent);
    const img = await preload(bg.file);
    if (!img || this.currentBackground !== bg) return;
    const layers = [$('bg-a'), $('bg-b')];
    const next = layers[(this.bgLayer + 1) % 2];
    const prev = layers[this.bgLayer];
    next.style.backgroundImage = `url("${bg.file}")`;
    if (instant) next.style.transition = 'none';
    next.classList.add('show');
    prev.classList.remove('show');
    if (instant) requestAnimationFrame(() => (next.style.transition = ''));
    this.bgLayer = (this.bgLayer + 1) % 2;
  }

  renderHelpTiles() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const c of document.querySelectorAll('.help-tiles')) {
      const cw = c.clientWidth || 96, ch = c.clientHeight || 70;
      c.width = cw * dpr;
      c.height = ch * dpr;
      const ctx = c.getContext('2d');
      ctx.scale(dpr, dpr);
      const tw = ch * 0.5;
      const spec = c.dataset.tiles;
      if (spec === 'free') {
        // Three tiles in a row, the middle one covered: only the ends are free.
        const kinds = [0, 20, 9, 13];
        const xs = [cw / 2 - tw * 1.55, cw / 2 - tw * 0.5, cw / 2 + tw * 0.55];
        kinds.slice(0, 3).forEach((k, n) => {
          const sp = tileSprite(k, tw, dpr, { dim: n === 1 });
          ctx.drawImage(sp.canvas, xs[n] - sp.origin, ch * 0.2 - sp.origin, sp.canvas.width / dpr, sp.canvas.height / dpr);
        });
        const sp = tileSprite(kinds[3], tw, dpr);
        ctx.drawImage(sp.canvas, cw / 2 - tw * 0.5 - sp.origin - sp.d, ch * 0.2 - sp.origin - sp.d, sp.canvas.width / dpr, sp.canvas.height / dpr);
      } else {
        const kinds = spec.split(',').map(Number);
        kinds.forEach((k, n) => {
          const sp = tileSprite(k, tw, dpr);
          const x = cw / 2 + (n - (kinds.length - 1) / 2) * tw * 1.25 - tw / 2;
          ctx.drawImage(sp.canvas, x - sp.origin, ch * 0.2 - sp.origin, sp.canvas.width / dpr, sp.canvas.height / dpr);
        });
      }
    }
  }
}

const app = new App();
window.mistyMahjong = app;
app.start();
void TIME_LIMIT_MS;
