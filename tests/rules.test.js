import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turtleLayout, layoutBounds } from '../web/js/layout.js';
import { buildNeighbours, isFree, freeTiles, availableMatches } from '../web/js/rules.js';
import { kindsMatch, suitOf, rankOf, SUIT, groupIntoPairs, fullDeckPairs } from '../web/js/tiles.js';
import { mulberry32 } from '../web/js/rng.js';

const positions = turtleLayout();
const nb = buildNeighbours(positions);
const at = (x, y, z) => positions.findIndex((p) => p.x === x && p.y === y && p.z === z);

test('turtle layout has 144 tiles in five layers and no duplicates', () => {
  assert.equal(positions.length, 144);
  const perLayer = [0, 1, 2, 3, 4].map((z) => positions.filter((p) => p.z === z).length);
  assert.deepEqual(perLayer, [87, 36, 16, 4, 1]);
  const keys = new Set(positions.map((p) => `${p.x},${p.y},${p.z}`));
  assert.equal(keys.size, 144);
  const b = layoutBounds(positions);
  assert.deepEqual([b.width, b.height, b.maxZ], [30, 16, 4]);
});

test('every raised tile rests on tiles below it', () => {
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (p.z === 0) continue;
    const support = positions.some(
      (q) => q.z === p.z - 1 && Math.abs(q.x - p.x) < 2 && Math.abs(q.y - p.y) < 2,
    );
    assert.ok(support, `tile ${i} at ${p.x},${p.y},${p.z} floats`);
  }
});

test('free tiles on a full board: row ends, side tiles and the crown', () => {
  const all = positions.map(() => true);
  const free = freeTiles(all, nb);
  // The ground layer has 8 rows with two open ends each, but the row ends
  // beside the side tiles (rows 3 and 4) are blocked by them on one side and
  // the row ends under layer 1 are not covered, so count explicitly:
  assert.ok(free.includes(at(0, 7, 0)), 'left side tile');
  assert.ok(free.includes(at(28, 7, 0)), 'outer right side tile');
  assert.ok(!free.includes(at(26, 7, 0)), 'inner right side tile is flanked on both sides');
  assert.ok(free.includes(at(13, 7, 4)), 'crown');
  assert.ok(!free.includes(at(12, 6, 3)), 'layer 3 tiles are under the crown');
  assert.ok(!free.includes(at(2, 0, 0)) === false, 'top-left corner is free');
  assert.ok(!free.includes(at(4, 0, 0)), 'second tile in a row is flanked');
  // Rows 3 and 4 (y = 6, 8): the left end at x = 2 touches the side tile at x = 0, y = 7.
  assert.ok(!free.includes(at(2, 6, 0)), 'left end of row 3 is blocked by the side tile');
  assert.ok(free.includes(at(24, 0, 0)), 'top-right corner is free');
  assert.ok(!free.includes(at(24, 6, 0)), 'right end of row 3 is blocked by the inner side tile');
});

test('a tile becomes free once a flanking tile or the covering tile is gone', () => {
  const present = positions.map(() => true);
  const i = at(4, 0, 0);
  assert.equal(isFree(i, present, nb), false);
  present[at(2, 0, 0)] = false;
  assert.equal(isFree(i, present, nb), true);

  const under = at(12, 6, 3);
  assert.equal(isFree(under, present, nb), false);
  present[at(13, 7, 4)] = false;
  assert.equal(isFree(under, present, nb), true, 'free after the crown leaves: its left side is open');
});

test('half-offset tiles block all tiles they partially cover or flank', () => {
  const present = positions.map(() => true);
  // The crown at (13,7,4) covers all four layer-3 tiles at (12,6) (14,6) (12,8) (14,8).
  for (const [x, y] of [[12, 6], [14, 6], [12, 8], [14, 8]]) {
    assert.ok(nb.above[at(x, y, 3)].includes(at(13, 7, 4)));
  }
  // The left side tile at (0,7,0) flanks both (2,6,0) and (2,8,0).
  assert.ok(nb.left[at(2, 6, 0)].includes(at(0, 7, 0)));
  assert.ok(nb.left[at(2, 8, 0)].includes(at(0, 7, 0)));
  // A tile is not its own neighbour and a removed tile frees nothing else wrongly.
  present[at(0, 7, 0)] = false;
  assert.equal(isFree(at(2, 6, 0), present, nb), true);
  assert.equal(isFree(at(2, 8, 0), present, nb), true);
});

test('matching: identical kinds, any flower with any flower, any season with any season', () => {
  assert.ok(kindsMatch(0, 0));
  assert.ok(!kindsMatch(0, 1));
  assert.ok(kindsMatch(34, 37));
  assert.ok(kindsMatch(38, 41));
  assert.ok(!kindsMatch(34, 38), 'a flower does not match a season');
  assert.ok(!kindsMatch(27, 28), 'different winds do not match');
  assert.ok(!kindsMatch(31, 33), 'different dragons do not match');
});

test('suits and ranks', () => {
  assert.equal(suitOf(0), SUIT.CHARACTER);
  assert.equal(suitOf(8), SUIT.CHARACTER);
  assert.equal(suitOf(9), SUIT.DOT);
  assert.equal(suitOf(26), SUIT.BAMBOO);
  assert.equal(suitOf(30), SUIT.WIND);
  assert.equal(suitOf(33), SUIT.DRAGON);
  assert.equal(suitOf(37), SUIT.FLOWER);
  assert.equal(suitOf(41), SUIT.SEASON);
  assert.equal(rankOf(8), 9);
  assert.equal(rankOf(9), 1);
  assert.equal(rankOf(30), 4);
  assert.equal(rankOf(41), 4);
});

test('full deck has 72 pairs covering four of every kind', () => {
  const pairs = fullDeckPairs(mulberry32(1));
  assert.equal(pairs.length, 72);
  const counts = new Map();
  for (const [a, b] of pairs) {
    assert.ok(kindsMatch(a, b));
    counts.set(a, (counts.get(a) || 0) + 1);
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  for (let k = 0; k < 34; k++) assert.equal(counts.get(k), 4);
  for (let k = 34; k < 42; k++) assert.equal(counts.get(k), 1);
});

test('grouping leftover kinds into pairs pairs flowers with each other', () => {
  const pairs = groupIntoPairs([3, 3, 34, 36, 40, 39, 3, 3], mulberry32(2));
  assert.equal(pairs.length, 4);
  for (const [a, b] of pairs) assert.ok(kindsMatch(a, b));
  assert.throws(() => groupIntoPairs([3], mulberry32(2)));
  assert.throws(() => groupIntoPairs([34, 38], mulberry32(2)));
});

test('availableMatches counts each free pair once', () => {
  const present = positions.map(() => true);
  const kinds = positions.map(() => 0);
  const free = freeTiles(present, nb);
  const n = free.length;
  assert.equal(availableMatches(present, kinds, nb).length, (n * (n - 1)) / 2);
});
