import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turtleLayout } from '../web/js/layout.js';
import { buildNeighbours, availableMatches, isFree } from '../web/js/rules.js';
import { dealSolvable, reshuffle } from '../web/js/deal.js';
import { kindsMatch } from '../web/js/tiles.js';
import { mulberry32 } from '../web/js/rng.js';

const positions = turtleLayout();
const nb = buildNeighbours(positions);

/** Plays the given pair choice rule until no match is left; returns the present mask. */
function playUntilStuck(kinds, choose) {
  const present = positions.map(() => true);
  for (;;) {
    const matches = availableMatches(present, kinds, nb);
    if (matches.length === 0) return present;
    const [a, b] = choose(matches);
    present[a] = false;
    present[b] = false;
  }
}

test('a deal uses the full set of tiles', () => {
  const { kinds } = dealSolvable(positions, nb, mulberry32(7));
  assert.equal(kinds.length, 144);
  const counts = new Map();
  for (const k of kinds) counts.set(k, (counts.get(k) || 0) + 1);
  for (let k = 0; k < 34; k++) assert.equal(counts.get(k), 4, `kind ${k}`);
  for (let k = 34; k < 42; k++) assert.equal(counts.get(k), 1, `kind ${k}`);
});

test('deals are deterministic for a seed and differ between seeds', () => {
  const a = dealSolvable(positions, nb, mulberry32(42));
  const b = dealSolvable(positions, nb, mulberry32(42));
  const c = dealSolvable(positions, nb, mulberry32(43));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.kinds, c.kinds);
});

test('the returned solution clears every deal with free, matching pairs', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const { kinds, solution } = dealSolvable(positions, nb, mulberry32(seed));
    const present = positions.map(() => true);
    assert.equal(solution.length, 72);
    for (const [a, b] of solution) {
      assert.ok(isFree(a, present, nb), `seed ${seed}: tile ${a} is free when its turn comes`);
      assert.ok(isFree(b, present, nb), `seed ${seed}: tile ${b} is free when its turn comes`);
      assert.ok(kindsMatch(kinds[a], kinds[b]), `seed ${seed}: the pair matches`);
      present[a] = false;
      present[b] = false;
    }
    assert.ok(present.every((p) => !p), `seed ${seed}: board empty`);
  }
});

test('greedy play clears most of a solvable deal on average', () => {
  let cleared = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const { kinds } = dealSolvable(positions, nb, mulberry32(seed));
    const rng = mulberry32(seed + 1000);
    const present = playUntilStuck(kinds, (m) => m[Math.floor(rng() * m.length)]);
    cleared += 144 - present.filter(Boolean).length;
  }
  assert.ok(cleared / 30 > 100, `average cleared ${cleared / 30}`);
});

test('reshuffle keeps the tiles on the board, their kinds, and gives a solvable rest', () => {
  let fallbacks = 0;
  let stuckStates = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { kinds } = dealSolvable(positions, nb, mulberry32(seed));
    const present = playUntilStuck(kinds, (m) => m[m.length - 1]);
    if (!present.some(Boolean)) continue;
    stuckStates++;
    const before = kinds.filter((k, i) => present[i]).sort((a, b) => a - b);
    const { kinds: after, solvable } = reshuffle(present, kinds, nb, mulberry32(seed + 500));
    const afterKinds = after.filter((k, i) => present[i]).sort((a, b) => a - b);
    assert.deepEqual(afterKinds, before, 'the multiset of kinds is unchanged');
    for (let i = 0; i < kinds.length; i++) if (!present[i]) assert.equal(after[i], kinds[i]);
    if (solvable) {
      // A solvable arrangement must at least offer a move.
      assert.ok(availableMatches(present, after, nb).length >= 1, `seed ${seed}: a move exists`);
    } else {
      fallbacks++;
    }
  }
  assert.ok(stuckStates > 10, `greedy play got stuck ${stuckStates} times`);
  assert.ok(fallbacks <= stuckStates / 5, `${fallbacks} of ${stuckStates} reshuffles needed the fallback`);
});

test('a position set that cannot be cleared pairwise falls back to a random arrangement', () => {
  // One tile on top of another and a third beside them: the top one and the
  // side one can leave together, which strands the bottom one.
  const small = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 4, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }];
  const smallNb = buildNeighbours(small);
  const { kinds, solvable } = reshuffle([true, true, true, true], [3, 3, 5, 5], smallNb, mulberry32(1));
  assert.equal(solvable, true, 'top + side first, then bottom + far side');
  assert.ok(availableMatches([true, true, true, true], kinds, smallNb).length >= 1);

  const stack = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }];
  const stackNb = buildNeighbours(stack);
  const r = reshuffle([true, true], [3, 3], stackNb, mulberry32(1));
  assert.equal(r.solvable, false);
  assert.deepEqual(r.kinds, [3, 3]);
  assert.equal(availableMatches([true, true], r.kinds, stackNb).length, 0, 'no move exists at all');
});

test('reshuffle never pairs a flower with a season', () => {
  const { kinds } = dealSolvable(positions, nb, mulberry32(11));
  const present = positions.map((_, i) => kinds[i] >= 34 || i % 7 === 0);
  const counts = new Map();
  present.forEach((p, i) => p && kinds[i] < 34 && counts.set(kinds[i], (counts.get(kinds[i]) || 0) + 1));
  present.forEach((p, i) => {
    if (p && kinds[i] < 34 && counts.get(kinds[i]) % 2 === 1) {
      present[i] = false;
      counts.set(kinds[i], counts.get(kinds[i]) - 1);
    }
  });
  const { kinds: after } = reshuffle(present, kinds, nb, mulberry32(12));
  for (const [a, b] of availableMatches(present, after, nb)) assert.ok(kindsMatch(after[a], after[b]));
});
