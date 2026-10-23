// Persistent settings and the high score, in localStorage.

const KEY = 'mistymahjong.settings';
const SCORE_KEY = 'mistymahjong.highscore';

export const DEFAULTS = {
  music: 0.7,
  effects: 0.8,
  haptics: true,
  markFree: true,
  background: null, // the manifest's first entry
  tileset: null, // tilesets.js DEFAULT_TILESET
  track: null, // the music manifest's first track
};

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable; the game still works for this session.
  }
}

export class Settings {
  constructor() {
    this.values = { ...DEFAULTS, ...(read(KEY) || {}) };
    this.listeners = [];
  }

  get(name) {
    return this.values[name];
  }

  set(name, value) {
    if (this.values[name] === value) return;
    this.values[name] = value;
    write(KEY, this.values);
    for (const fn of this.listeners) fn(name, value);
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  get highScore() {
    const v = read(SCORE_KEY);
    return typeof v === 'number' ? v : 0;
  }

  /** Records a score; returns true when it is a new high score. */
  recordScore(score) {
    if (score > this.highScore) {
      write(SCORE_KEY, score);
      return true;
    }
    return false;
  }
}
