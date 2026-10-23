// The game model: board state, selection, timer and scoring, free of any
// rendering. The renderer listens to the events it emits.

import { turtleLayout } from './layout.js';
import { buildNeighbours, isFree, availableMatches } from './rules.js';
import { dealSolvable, reshuffle } from './deal.js';
import { kindsMatch } from './tiles.js';
import { Scorer, TIME_LIMIT_MS, endBonuses } from './scoring.js';
import { mulberry32, randomSeed } from './rng.js';

export const STATE = { READY: 'ready', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };
export const RESULT = { WON: 'won', TIMEOUT: 'timeout', QUIT: 'quit', STUCK: 'stuck' };

export class Game {
  constructor({ seed = randomSeed(), positions = turtleLayout() } = {}) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.positions = positions;
    this.nb = buildNeighbours(positions);
    const deal = dealSolvable(positions, this.nb, this.rng);
    this.kinds = deal.kinds;
    this.solution = deal.solution;
    this.present = positions.map(() => true);
    this.selected = -1;
    this.scorer = new Scorer();
    this.timeLeft = TIME_LIMIT_MS;
    this.timerRunning = false;
    this.state = STATE.READY;
    this.result = null;
    this.tilesLeft = positions.length;
    this.pairsMatched = 0;
    this.shuffles = 0;
    this.hints = 0;
    this.listeners = {};
    this.matches = availableMatches(this.present, this.kinds, this.nb);
  }

  on(event, fn) {
    (this.listeners[event] ||= []).push(fn);
    return this;
  }

  emit(event, data) {
    for (const fn of this.listeners[event] || []) fn(data);
  }

  isFree(i) {
    return isFree(i, this.present, this.nb);
  }

  get matchCount() {
    return this.matches.length;
  }

  /** Handles a tap on tile `i`. Returns what happened for the view and the sounds. */
  tap(i) {
    if (this.state !== STATE.READY && this.state !== STATE.PLAYING) return 'ignored';
    if (!this.present[i]) return 'ignored';
    if (!this.isFree(i)) {
      this.emit('blocked', { tile: i });
      return 'blocked';
    }
    if (this.selected === i) {
      this.selected = -1;
      this.emit('deselect', { tile: i });
      return 'deselect';
    }
    if (this.selected >= 0 && kindsMatch(this.kinds[this.selected], this.kinds[i])) {
      const a = this.selected;
      this.selected = -1;
      this.match(a, i);
      return 'match';
    }
    const previous = this.selected;
    this.selected = i;
    this.emit('select', { tile: i, previous });
    return 'select';
  }

  match(a, b) {
    if (this.state === STATE.READY) {
      this.state = STATE.PLAYING;
      this.timerRunning = true;
      this.emit('start');
    }
    const before = this.tilesLeft;
    this.present[a] = false;
    this.present[b] = false;
    this.tilesLeft -= 2;
    this.pairsMatched += 1;
    const points = this.scorer.match(this.kinds[a], before);
    this.matches = availableMatches(this.present, this.kinds, this.nb);
    this.emit('match', { a, b, points, chain: this.scorer.chain, score: this.scorer.score });
    if (this.tilesLeft === 0) {
      this.finish(RESULT.WON);
    } else if (this.matches.length === 0) {
      this.doReshuffle();
    }
  }

  doReshuffle() {
    const result = reshuffle(this.present, this.kinds, this.nb, this.rng);
    this.kinds = result.kinds;
    this.matches = availableMatches(this.present, this.kinds, this.nb);
    this.scorer.breakChain();
    this.shuffles += 1;
    this.selected = -1;
    this.emit('reshuffle', { matches: this.matches.length, solvable: result.solvable });
    if (this.matches.length === 0) this.finish(RESULT.STUCK);
  }

  /** Returns a matchable pair to show, preferring one that includes the selection. */
  hint() {
    if (this.state !== STATE.READY && this.state !== STATE.PLAYING) return null;
    if (this.matches.length === 0) return null;
    let pair = this.matches.find((p) => p.includes(this.selected));
    if (!pair) pair = this.matches[Math.floor(this.rng() * this.matches.length)];
    this.hints += 1;
    this.scorer.breakChain();
    this.emit('hint', { pair });
    return pair;
  }

  /** Advances the clock; `dt` in milliseconds. */
  tick(dt) {
    if (this.state !== STATE.PLAYING || !this.timerRunning) return;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft === 0) this.finish(RESULT.TIMEOUT);
  }

  pause() {
    if (this.state !== STATE.PLAYING) return false;
    this.state = STATE.PAUSED;
    this.emit('pause');
    return true;
  }

  resume() {
    if (this.state !== STATE.PAUSED) return false;
    this.state = STATE.PLAYING;
    this.emit('resume');
    return true;
  }

  quit() {
    if (this.state === STATE.OVER) return;
    this.finish(RESULT.QUIT);
  }

  finish(result) {
    if (this.state === STATE.OVER) return;
    this.state = STATE.OVER;
    this.result = result;
    this.timerRunning = false;
    const cleared = this.positions.length - this.tilesLeft;
    const bonus = endBonuses(cleared, this.timeLeft, result === RESULT.WON);
    this.summary = {
      result,
      base: this.scorer.score,
      completion: bonus.completion,
      time: bonus.time,
      percent: bonus.percent,
      total: this.scorer.score + bonus.completion + bonus.time,
      timeUsedMs: TIME_LIMIT_MS - this.timeLeft,
      pairs: this.pairsMatched,
    };
    this.emit('over', this.summary);
  }
}
