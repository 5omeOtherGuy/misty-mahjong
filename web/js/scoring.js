// Scoring: a pair is worth its suit value times the number of tiles still on
// the board before the match, doubled, and multiplied by a chain that grows
// while consecutive matches stay in the same suit. Rarer tiles pay more.

import { SUIT, suitOf } from './tiles.js';

export const SUIT_VALUE = {
  [SUIT.CHARACTER]: 1,
  [SUIT.DOT]: 2,
  [SUIT.BAMBOO]: 3,
  [SUIT.WIND]: 4,
  [SUIT.DRAGON]: 5,
  [SUIT.FLOWER]: 6,
  [SUIT.SEASON]: 7,
};

export const TOTAL_TILES = 144;
export const TIME_LIMIT_MS = 10 * 60 * 1000;
export const POINTS_PER_SPARE_SECOND = 100;

export class Scorer {
  constructor() {
    this.score = 0;
    this.chain = 0;
    this.lastSuit = null;
  }

  /** Scores a match of `kind` with `tilesBefore` tiles on the board; returns the points. */
  match(kind, tilesBefore) {
    const suit = suitOf(kind);
    this.chain = suit === this.lastSuit ? this.chain + 1 : 1;
    this.lastSuit = suit;
    const points = 2 * SUIT_VALUE[suit] * tilesBefore * this.chain;
    this.score += points;
    return points;
  }

  /** A reshuffle or hint breaks the chain. */
  breakChain() {
    this.chain = 0;
    this.lastSuit = null;
  }
}

/** Bonuses at the end: completion for tiles cleared, time only for a cleared board. */
export function endBonuses(tilesCleared, timeLeftMs, won) {
  const completion = tilesCleared * TOTAL_TILES;
  const time = won ? Math.floor(timeLeftMs / 1000) * POINTS_PER_SPARE_SECOND : 0;
  return { completion, time, percent: Math.round((100 * tilesCleared) / TOTAL_TILES) };
}
