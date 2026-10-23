// Free-tile rules on a board of positions (see layout.js) with a `present`
// mask. A tile is free when nothing lies on it and its left or right side is
// open on its own layer. Partial overlaps count, since tiles sit on half
// positions.

import { kindsMatch } from './tiles.js';

function overlaps(a, b) {
  return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
}

/** Precomputes, for each position, which positions cover it and which flank it. */
export function buildNeighbours(positions) {
  const above = positions.map(() => []);
  const left = positions.map(() => []);
  const right = positions.map(() => []);
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    for (let j = 0; j < positions.length; j++) {
      if (i === j) continue;
      const q = positions[j];
      if (q.z === p.z + 1 && overlaps(p, q)) above[i].push(j);
      if (q.z === p.z && Math.abs(q.y - p.y) < 2) {
        if (q.x === p.x - 2) left[i].push(j);
        else if (q.x === p.x + 2) right[i].push(j);
      }
    }
  }
  return { above, left, right };
}

export function isFree(i, present, nb) {
  if (!present[i]) return false;
  for (const j of nb.above[i]) if (present[j]) return false;
  const leftOpen = nb.left[i].every((j) => !present[j]);
  if (leftOpen) return true;
  return nb.right[i].every((j) => !present[j]);
}

export function freeTiles(present, nb) {
  const out = [];
  for (let i = 0; i < present.length; i++) if (isFree(i, present, nb)) out.push(i);
  return out;
}

/** All matchable pairs among the free tiles, each pair once, as [i, j] with i < j. */
export function availableMatches(present, kinds, nb) {
  const free = freeTiles(present, nb);
  const pairs = [];
  for (let a = 0; a < free.length; a++) {
    for (let b = a + 1; b < free.length; b++) {
      if (kindsMatch(kinds[free[a]], kinds[free[b]])) pairs.push([free[a], free[b]]);
    }
  }
  return pairs;
}
