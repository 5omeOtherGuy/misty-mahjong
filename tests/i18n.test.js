import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES, T, resolveLanguage, setLanguage, formatNumber, formatTime } from '../web/js/i18n.js';
import en from '../web/js/locales/en.js';
import { TILESETS } from '../web/js/tilesets.js';

test('device preferences match regions and Chinese scripts before falling back to English', () => {
  for (const [preferences, expected] of [
    [['sv-SE', 'fr-CA', 'de-DE'], 'fr'],
    [['pt-BR'], 'pt'], [['EN-gb'], 'en'],
    [['zh-TW'], 'zh-Hant'], [['zh-HK'], 'zh-Hant'], [['zh-MO'], 'zh-Hant'],
    [['zh-CN'], 'zh-Hans'], [['zh-SG'], 'zh-Hans'], [['zh'], 'zh-Hans'],
    [['zh-Hans-TW'], 'zh-Hans'], [['zh-Hant-CN'], 'zh-Hant'],
    [['sv-SE'], 'en'], [[], 'en'], [['constructor'], 'en'],
  ]) assert.equal(resolveLanguage(preferences), expected, preferences.join(', '));
});

test('manual selection overrides the device and automatic selection restores it', () => {
  assert.equal(setLanguage('ja', ['de-DE']), 'ja');
  assert.equal(T.play, '遊ぶ');
  assert.equal(setLanguage(null, ['de-DE']), 'de');
  assert.equal(T.play, 'Spielen');
  assert.equal(formatNumber(1234567), '1.234.567');
  assert.equal(setLanguage('en', ['de-DE']), 'en');
  assert.equal(formatNumber(1234567), '1,234,567');
  assert.equal(setLanguage('unsupported', ['de-DE']), 'en');
  assert.equal(T.play, 'Play');
  assert.equal(formatTime(599001), '10:00');
  assert.equal(formatTime(61000), '1:01');
});

test('every offered language fully translates the UI and selectable assets', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const backgrounds = JSON.parse(await readFile(new URL('../web/assets/backgrounds/index.json', import.meta.url)));
  const music = JSON.parse(await readFile(new URL('../web/assets/audio/music.json', import.meta.url)));
  const used = [...html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)].map((m) => m[1]);
  used.push(...[...TILESETS, ...backgrounds, ...music.tracks].map((item) => item.id));
  for (const id of Object.keys(LANGUAGES)) {
    const { default: catalog } = await import(`../web/js/locales/${id}.js`);
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(en).sort(), id);
    for (const key of new Set([...Object.keys(en), ...used])) {
      assert.equal(typeof catalog[key], 'string', `${id}: ${key}`);
      assert.ok(catalog[key].trim(), `${id}: ${key} is empty`);
    }
  }
});
