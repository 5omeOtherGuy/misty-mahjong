import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, STATE, RESULT } from '../web/js/game.js';
import { Scorer, endBonuses, TIME_LIMIT_MS } from '../web/js/scoring.js';

test('scoring: suit value, tiles left, and a chain within one suit', () => {
  const s = new Scorer();
  assert.equal(s.match(0, 144), 2 * 1 * 144 * 1); // character
  assert.equal(s.match(5, 142), 2 * 1 * 142 * 2); // character again: chain 2
  assert.equal(s.match(9, 140), 2 * 2 * 140 * 1); // dots break the chain
  assert.equal(s.match(40, 138), 2 * 7 * 138 * 1); // season
  assert.equal(s.match(38, 136), 2 * 7 * 136 * 2); // another season: chain 2
  s.breakChain();
  assert.equal(s.match(39, 134), 2 * 7 * 134 * 1);
  assert.equal(s.score, 288 + 568 + 560 + 1932 + 3808 + 1876);
});

test('end bonuses: completion for every cleared tile, time only when won', () => {
  assert.deepEqual(endBonuses(144, 120000, true), { completion: 144 * 144, time: 12000, percent: 100 });
  assert.deepEqual(endBonuses(100, 120000, false), { completion: 14400, time: 0, percent: 69 });
  assert.deepEqual(endBonuses(0, 0, false), { completion: 0, time: 0, percent: 0 });
  assert.equal(endBonuses(144, 1999, true).time, 100, 'whole seconds only');
});

test('timer starts with the first match and stops on pause', () => {
  const g = new Game({ seed: 3 });
  assert.equal(g.state, STATE.READY);
  g.tick(5000);
  assert.equal(g.timeLeft, TIME_LIMIT_MS, 'no time passes before the first match');
  const [a, b] = g.matches[0];
  assert.equal(g.tap(a), 'select');
  g.tick(5000);
  assert.equal(g.timeLeft, TIME_LIMIT_MS, 'selecting does not start the clock');
  assert.equal(g.tap(b), 'match');
  assert.equal(g.state, STATE.PLAYING);
  g.tick(1500);
  assert.equal(g.timeLeft, TIME_LIMIT_MS - 1500);
  assert.ok(g.pause());
  g.tick(100000);
  assert.equal(g.timeLeft, TIME_LIMIT_MS - 1500);
  assert.ok(g.resume());
  g.tick(500);
  assert.equal(g.timeLeft, TIME_LIMIT_MS - 2000);
});

test('running out of time ends the game with a timeout and no time bonus', () => {
  const g = new Game({ seed: 4 });
  const events = [];
  g.on('over', (s) => events.push(s));
  const [a, b] = g.matches[0];
  g.tap(a);
  g.tap(b);
  g.tick(TIME_LIMIT_MS + 1);
  assert.equal(g.state, STATE.OVER);
  assert.equal(g.result, RESULT.TIMEOUT);
  assert.equal(g.timeLeft, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].time, 0);
  assert.equal(events[0].completion, 2 * 144);
  assert.equal(events[0].total, events[0].base + events[0].completion);
  assert.equal(g.tap(g.matches[0]?.[0] ?? 0), 'ignored', 'no taps after the end');
  g.tick(1000);
  assert.equal(g.timeLeft, 0);
});

test('tapping: blocked tiles, deselect, switching selection, matching', () => {
  const g = new Game({ seed: 8 });
  const blocked = g.present.findIndex((p, i) => !g.isFree(i));
  assert.equal(g.tap(blocked), 'blocked');
  assert.equal(g.selected, -1);
  const [a, b] = g.matches[0];
  assert.equal(g.tap(a), 'select');
  assert.equal(g.tap(a), 'deselect');
  assert.equal(g.selected, -1);
  g.tap(a);
  const other = g.present.findIndex((p, i) => i !== a && i !== b && g.isFree(i) && !g.matches.some((m) => m.includes(a) && m.includes(i)));
  assert.equal(g.tap(other), 'select', 'a non-matching free tile moves the selection');
  assert.equal(g.selected, other);
  g.tap(a);
  assert.equal(g.tap(b), 'match');
  assert.equal(g.tilesLeft, 142);
  assert.equal(g.present[a], false);
  assert.equal(g.present[b], false);
});

test('a hint returns a currently matchable pair and breaks the chain', () => {
  const g = new Game({ seed: 9 });
  const [a, b] = g.matches[0];
  g.tap(a);
  g.tap(b);
  assert.equal(g.scorer.chain, 1);
  const pair = g.hint();
  assert.ok(pair);
  assert.ok(g.isFree(pair[0]) && g.isFree(pair[1]));
  assert.equal(g.scorer.chain, 0);
  assert.equal(g.hints, 1);
  // A hint prefers a pair containing the selected tile.
  const [c] = g.matches[0];
  g.tap(c);
  assert.ok(g.hint().includes(c));
});

test('playing every available match clears the board or reshuffles, and the game ends won', () => {
  for (let seed = 20; seed < 26; seed++) {
    const g = new Game({ seed });
    let reshuffles = 0;
    g.on('reshuffle', () => reshuffles++);
    let guard = 0;
    while (g.state !== STATE.OVER && guard++ < 1000) {
      const [a, b] = g.matches[0];
      g.tap(a);
      g.tap(b);
      g.tick(1000);
    }
    assert.equal(g.state, STATE.OVER, `seed ${seed} finished`);
    assert.equal(g.shuffles, reshuffles);
    assert.equal(g.matchCount, 0);
    if (g.result === RESULT.STUCK) {
      // Only a dead end the player built (a lone stack) ends a game unwon.
      assert.ok(g.tilesLeft >= 2 && g.tilesLeft <= 4, `seed ${seed}: stuck with ${g.tilesLeft}`);
      assert.equal(g.summary.time, 0);
      continue;
    }
    assert.equal(g.result, RESULT.WON);
    assert.equal(g.tilesLeft, 0);
    assert.equal(g.summary.percent, 100);
    assert.ok(g.summary.time > 0, 'time bonus for a win');
  }
});

test('reshuffle happens automatically when no match is left and keeps the tile count', () => {
  // Find a seed and a greedy path that gets stuck before the end.
  let found = false;
  for (let seed = 100; seed < 400 && !found; seed++) {
    const g = new Game({ seed });
    let shuffled = 0;
    g.on('reshuffle', (e) => {
      shuffled++;
      assert.ok(e.matches >= 1);
    });
    while (g.state !== STATE.OVER) {
      const pair = g.matches[g.matches.length - 1];
      const before = g.tilesLeft;
      g.tap(pair[0]);
      g.tap(pair[1]);
      assert.equal(g.tilesLeft, before - 2);
    }
    if (shuffled > 0) found = true;
  }
  assert.ok(found, 'at least one seed needed a reshuffle in the first 300');
});

test('quitting ends the game with the partial completion bonus', () => {
  const g = new Game({ seed: 12 });
  const [a, b] = g.matches[0];
  g.tap(a);
  g.tap(b);
  g.quit();
  assert.equal(g.result, RESULT.QUIT);
  assert.equal(g.summary.completion, 288);
  assert.equal(g.summary.time, 0);
});
