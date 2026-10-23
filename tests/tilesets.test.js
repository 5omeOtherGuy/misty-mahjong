import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILESETS, DEFAULT_TILESET, findTileSet } from '../web/js/tilesets.js';
import { DEFAULTS } from '../web/js/settings.js';

test('five selectable sets with unique ids, German names and a material each', () => {
  assert.equal(TILESETS.length, 5);
  assert.equal(new Set(TILESETS.map((s) => s.id)).size, 5);
  assert.equal(new Set(TILESETS.map((s) => s.name)).size, 5);
  for (const s of TILESETS) {
    assert.match(s.material, /^(pearl|jade|seaglass|porcelain|lacquer)$/);
    for (const key of ['ink', 'red', 'green', 'gold', 'paper']) assert.ok(s.palette[key], `${s.id} palette ${key}`);
    assert.ok(s.glow.select && s.glow.hint && s.dim, `${s.id} board colours`);
  }
});

test('an unknown or missing setting falls back to the default set', () => {
  assert.equal(DEFAULTS.tileset, null, 'the setting is unset until the player picks');
  assert.equal(findTileSet(null).id, DEFAULT_TILESET);
  assert.equal(findTileSet('elfenbein').id, DEFAULT_TILESET);
  assert.equal(findTileSet('jade').id, 'jade');
});
