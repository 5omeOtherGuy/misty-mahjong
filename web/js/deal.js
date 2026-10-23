// Solvable deals by simulated play: starting from the full set of positions,
// repeatedly take two free positions off the board and give both the same
// pair of faces. Playing those pairs in the reverse order clears the board,
// so every deal has at least one solution, and so does a reshuffle whenever
// the remaining positions allow one at all.

import { freeTiles, availableMatches } from './rules.js';
import { fullDeckPairs, groupIntoPairs, shuffled } from './tiles.js';

const MAX_ATTEMPTS = 200;
const FALLBACK_ATTEMPTS = 60;

/**
 * Assigns `pairs` (an array of [kindA, kindB]) to the positions marked in
 * `present`, which must number exactly 2 * pairs.length. Returns the kinds
 * (null for absent positions) and the removal order, or null when the
 * reverse play got stuck. Tiles with something underneath are taken first
 * more often than not, which keeps stacks from stranding a lone tile.
 */
function tryAssign(present, pairs, nb, rng) {
  const kinds = present.map(() => null);
  const remaining = present.slice();
  const queue = shuffled(pairs, rng);
  const order = [];
  const pick = (free) => {
    // Weight by layer so that upper tiles leave early.
    let total = 0;
    const weights = free.map((i) => {
      const w = 1 + 2 * stackHeight(i, remaining, nb);
      total += w;
      return w;
    });
    let r = rng() * total;
    for (let k = 0; k < free.length; k++) {
      r -= weights[k];
      if (r < 0) return free[k];
    }
    return free[free.length - 1];
  };
  for (const [a, b] of queue) {
    const free = freeTiles(remaining, nb);
    if (free.length < 2) return null;
    const i = pick(free);
    const rest = free.filter((f) => f !== i);
    const j = pick(rest);
    kinds[i] = a;
    kinds[j] = b;
    remaining[i] = false;
    remaining[j] = false;
    order.push([i, j]);
  }
  return { kinds, order };
}

function stackHeight(i, present, nb) {
  let h = 0;
  for (let depth = 0; depth < 8; depth++) {
    let below = null;
    for (let j = 0; j < present.length; j++) {
      if (present[j] && nb.above[j].includes(i)) {
        below = j;
        break;
      }
    }
    if (below === null) break;
    h += 1;
    i = below;
  }
  return h;
}

function attemptAssign(present, pairs, nb, rng) {
  const count = present.filter(Boolean).length;
  if (count !== pairs.length * 2) throw new Error(`${count} positions for ${pairs.length} pairs`);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = tryAssign(present, pairs, nb, rng);
    if (result) return result;
  }
  return null;
}

/** A fresh, solvable deal: the kinds per position and one solution (pairs in play order). */
export function dealSolvable(positions, nb, rng) {
  const present = positions.map(() => true);
  const result = attemptAssign(present, fullDeckPairs(rng), nb, rng);
  if (!result) throw new Error('could not build a solvable deal');
  return { kinds: result.kinds, solution: result.order };
}

/**
 * Redistributes the kinds of the tiles still on the board among their own
 * positions so that the rest of the game stays solvable. When the remaining
 * positions cannot be cleared pairwise in any order (for example a lone
 * stack), it falls back to a random arrangement with at least one match
 * whenever one exists. Returns the new kinds and whether a solution exists.
 */
export function reshuffle(present, kinds, nb, rng) {
  const left = [];
  for (let i = 0; i < present.length; i++) if (present[i]) left.push(kinds[i]);
  const pairs = groupIntoPairs(left, rng);
  const result = attemptAssign(present, pairs, nb, rng);
  if (result) {
    return { kinds: kinds.map((k, i) => (present[i] ? result.kinds[i] : k)), solvable: true };
  }
  const slots = [];
  for (let i = 0; i < present.length; i++) if (present[i]) slots.push(i);
  let best = null;
  let bestMatches = -1;
  for (let attempt = 0; attempt < FALLBACK_ATTEMPTS && bestMatches < 1; attempt++) {
    const faces = shuffled(left, rng);
    const candidate = kinds.slice();
    slots.forEach((i, n) => (candidate[i] = faces[n]));
    const matches = availableMatches(present, candidate, nb).length;
    if (matches > bestMatches) {
      bestMatches = matches;
      best = candidate;
    }
  }
  return { kinds: best, solvable: false };
}
