// Sound: a sample-accurate music loop and short effects through Web Audio.
// Each music track is decoded once and looped by the audio thread between
// exact sample positions, so the loop has no gap whatever the container
// padding. Everything fades rather than cuts, a change of track too.

// Lists the selectable tracks, the first being the default: id, German name,
// file and exact loop length.
const MUSIC_MANIFEST = 'assets/audio/music.json';
const EFFECTS = {
  select: 'assets/audio/select.ogg',
  match: 'assets/audio/match.ogg',
  // One file per chain level (2 to 6): each climbs a step of the scale, so a
  // chain stays in the music's key instead of being sped up.
  chain2: 'assets/audio/chain2.ogg',
  chain3: 'assets/audio/chain3.ogg',
  chain4: 'assets/audio/chain4.ogg',
  chain5: 'assets/audio/chain5.ogg',
  chain6: 'assets/audio/chain6.ogg',
  blocked: 'assets/audio/blocked.ogg',
  hint: 'assets/audio/hint.ogg',
  shuffle: 'assets/audio/shuffle.ogg',
  tap: 'assets/audio/tap.ogg',
  win: 'assets/audio/win.ogg',
  over: 'assets/audio/over.ogg',
  warning: 'assets/audio/warning.ogg',
};

export class Audio {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.buffers = {};
    this.tracks = [];
    this.trackBuffers = {};
    this.music = null;
    this.ready = null;
    this.suspendedByApp = false;
    settings.onChange((name, value) => {
      if (name === 'music' && this.musicGain) this.musicGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.05);
      if (name === 'effects' && this.fxGain) this.fxGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.05);
      if (name === 'track') this.startMusic();
    });
  }

  /** The chosen track, or the manifest's first. */
  get track() {
    return this.tracks.find((t) => t.id === this.settings.get('track')) || this.tracks[0];
  }

  /** Creates the context; call from a user gesture or app start (the WebView allows autoplay). */
  init() {
    if (this.ready) return this.ready;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      this.ready = Promise.resolve(false);
      return this.ready;
    }
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.settings.get('music');
    this.musicGain.connect(this.master);
    this.duckGain = this.ctx.createGain();
    this.duckGain.connect(this.musicGain);
    this.fxGain = this.ctx.createGain();
    this.fxGain.gain.value = this.settings.get('effects');
    this.fxGain.connect(this.master);
    // Only the chosen track is decoded up front; another one when it is chosen.
    const music = fetch(MUSIC_MANIFEST)
      .then((r) => r.json())
      .then((m) => {
        this.tracks = m.tracks;
        return this.loadTrack(this.track);
      })
      .catch(() => null);
    const loads = Object.entries(EFFECTS).map(([name, url]) =>
      this.decode(url)
        .then((buffer) => (this.buffers[name] = buffer))
        .catch(() => null),
    );
    this.ready = Promise.all([music, ...loads]).then(() => true);
    return this.ready;
  }

  decode(url) {
    return fetch(url)
      .then((r) => r.arrayBuffer())
      .then((data) => this.ctx.decodeAudioData(data));
  }

  loadTrack(track) {
    if (!track) return Promise.resolve(null);
    this.trackBuffers[track.id] ||= this.decode(track.file).catch(() => null);
    return this.trackBuffers[track.id];
  }

  /** Starts the chosen track, or crossfades to it when another one plays. */
  async startMusic() {
    await this.init();
    const track = this.track;
    if (!this.ctx || !track || this.music?.track === track) return;
    const buffer = await this.loadTrack(track);
    // The choice may have changed again while the track was decoding.
    if (!buffer || track !== this.track || this.music?.track === track) return;
    const now = this.ctx.currentTime;
    if (this.music) {
      const { src, fade } = this.music;
      fade.gain.cancelScheduledValues(now);
      fade.gain.setValueAtTime(fade.gain.value, now);
      fade.gain.linearRampToValueAtTime(0, now + 1.5);
      src.stop(now + 1.6);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = 0;
    // The composition's exact length is stored in the manifest; it is shorter
    // than the decoded buffer when the encoder padded the end.
    src.loopEnd = Math.min(buffer.duration, track.loopSeconds || buffer.duration);
    const fade = this.ctx.createGain();
    fade.gain.setValueAtTime(0, now);
    fade.gain.linearRampToValueAtTime(1, now + 2.5);
    src.connect(fade).connect(this.duckGain);
    src.start();
    this.music = { track, src, fade };
  }

  /** Lowers the music during a pause or the end screen. */
  duckMusic(level, seconds = 0.6) {
    if (!this.duckGain) return;
    this.duckGain.gain.setTargetAtTime(level, this.ctx.currentTime, seconds / 3);
  }

  play(name, { volume = 1 } = {}) {
    if (!this.ctx || !this.buffers[name]) return;
    if (this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.fxGain);
    src.start();
  }

  /** The app went to the background: silence everything without losing the loop position. */
  suspend() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.suspendedByApp = true;
    this.ctx.suspend();
  }

  /** Resumes the context; the WebView sometimes needs a second try after a return from the background. */
  resume() {
    if (!this.ctx) return;
    this.suspendedByApp = false;
    const attempt = (n) => {
      if (!this.ctx || this.suspendedByApp || this.ctx.state === 'running' || this.ctx.state === 'closed') return;
      this.ctx.resume().catch(() => null);
      if (n < 6) setTimeout(() => attempt(n + 1), 250 * (n + 1));
    };
    attempt(0);
  }

  /** Call from any user gesture: wakes a context the browser kept suspended. */
  unlock() {
    if (this.ctx && !this.suspendedByApp && this.ctx.state === 'suspended') this.ctx.resume().catch(() => null);
  }
}
