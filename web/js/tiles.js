// Tile kinds. Ids 0..41:
//   0..8   characters (wan) 1..9
//   9..17  dots (circles) 1..9
//   18..26 bamboo 1..9
//   27..30 winds east, south, west, north
//   31..33 dragons red, green, white
//   34..37 flowers plum, orchid, chrysanthemum, bamboo
//   38..41 seasons spring, summer, autumn, winter

export const SUIT = {
  CHARACTER: 'character',
  DOT: 'dot',
  BAMBOO: 'bamboo',
  WIND: 'wind',
  DRAGON: 'dragon',
  FLOWER: 'flower',
  SEASON: 'season',
};

export const KIND_COUNT = 42;

export function suitOf(kind) {
  if (kind < 9) return SUIT.CHARACTER;
  if (kind < 18) return SUIT.DOT;
  if (kind < 27) return SUIT.BAMBOO;
  if (kind < 31) return SUIT.WIND;
  if (kind < 34) return SUIT.DRAGON;
  if (kind < 38) return SUIT.FLOWER;
  return SUIT.SEASON;
}

/** 1-based rank within the suit (number for suits, index for honours). */
export function rankOf(kind) {
  if (kind < 9) return kind + 1;
  if (kind < 18) return kind - 8;
  if (kind < 27) return kind - 17;
  if (kind < 31) return kind - 26;
  if (kind < 34) return kind - 30;
  if (kind < 38) return kind - 33;
  return kind - 37;
}

/** Any flower matches any flower, any season any season; others must be identical. */
export function kindsMatch(a, b) {
  if (a === b) return true;
  const sa = suitOf(a);
  return (sa === SUIT.FLOWER || sa === SUIT.SEASON) && sa === suitOf(b);
}

/**
 * The full set of 144 tiles, grouped into 72 matching pairs. Regular kinds
 * come in four copies (two pairs); the four flowers and the four seasons form
 * two pairs each with distinct faces.
 */
export function fullDeckPairs(rng) {
  const pairs = [];
  for (let kind = 0; kind < 34; kind++) pairs.push([kind, kind], [kind, kind]);
  const flowers = shuffled([34, 35, 36, 37], rng);
  const seasons = shuffled([38, 39, 40, 41], rng);
  pairs.push([flowers[0], flowers[1]], [flowers[2], flowers[3]]);
  pairs.push([seasons[0], seasons[1]], [seasons[2], seasons[3]]);
  return pairs;
}

/**
 * Groups an arbitrary multiset of kinds into matching pairs. Every count of a
 * regular kind must be even, and the flower and season counts must be even.
 */
export function groupIntoPairs(kinds, rng) {
  const regular = new Map();
  const flowers = [], seasons = [];
  for (const k of kinds) {
    const s = suitOf(k);
    if (s === SUIT.FLOWER) flowers.push(k);
    else if (s === SUIT.SEASON) seasons.push(k);
    else regular.set(k, (regular.get(k) || 0) + 1);
  }
  const pairs = [];
  for (const [k, n] of regular) {
    if (n % 2) throw new Error(`odd count for kind ${k}`);
    for (let i = 0; i < n / 2; i++) pairs.push([k, k]);
  }
  for (const group of [flowers, seasons]) {
    if (group.length % 2) throw new Error('odd flower or season count');
    const g = shuffled(group, rng);
    for (let i = 0; i < g.length; i += 2) pairs.push([g[i], g[i + 1]]);
  }
  return pairs;
}

export function shuffled(array, rng) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
