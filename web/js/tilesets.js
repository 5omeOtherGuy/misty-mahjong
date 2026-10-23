// The selectable tile sets: data only. Each set names its material (a
// renderer in render/materials.js), the colours its faces are drawn in and
// the colours the board uses for selection, hints and dimmed tiles. The
// symbols themselves never change: every set shows the traditional 42 faces.

export const DEFAULT_TILESET = 'perlmutt';

/** The classic face colours: ink, vermilion and jade, with gold accents. */
const CLASSIC = {
  ink: '#20334d',
  red: '#b43a2c',
  green: '#2f7a5c',
  gold: '#b48a2e',
  paper: '#f6efdf', // the light inside dots and bamboo joints
  blush: '#c9607a',
  branch: '#5a3a28',
  petal: '#e3879b',
  orchid: '#d9a0c0',
  mum: '#e0a23c',
  mumHeart: '#b86a1e',
  leaf: '#5daa6c',
  sunLight: '#f6c960',
  sunDeep: '#d9772b',
  sunRay: '#d98a2b',
  autumn: '#c9512d',
  autumnVein: '#8a3418',
  snow: '#4e7fb3',
  seasonText: '#7a4a1e',
  flowerWash: 'rgba(201, 96, 122, 0.1)',
  seasonWash: 'rgba(180, 138, 46, 0.13)',
  cornerAlpha: 0.65,
};

export const TILESETS = [
  {
    id: 'perlmutt',
    name: 'Perlmutt',
    material: 'pearl',
    palette: { ...CLASSIC },
    glow: { select: '240, 198, 96', hint: '111, 211, 166' },
    dim: 'rgba(18, 24, 28, 0.22)',
    sheen: 0.9,
  },
  {
    id: 'jade',
    name: 'Jade',
    material: 'jade',
    palette: {
      ...CLASSIC,
      ink: '#1e2f4f',
      red: '#b0301f',
      green: '#1f5a3f',
      paper: '#e4efe0',
      seasonText: '#6a3f16',
      flowerWash: 'rgba(201, 96, 122, 0.08)',
      seasonWash: 'rgba(160, 120, 40, 0.1)',
    },
    glow: { select: '247, 214, 130', hint: '220, 238, 255' },
    dim: 'rgba(14, 30, 22, 0.26)',
    sheen: 0.6,
  },
  {
    id: 'seeglas',
    name: 'Seeglas',
    material: 'seaglass',
    palette: {
      ...CLASSIC,
      ink: '#1a2d52',
      red: '#b2301f',
      green: '#176a45',
      paper: '#e8f6f0',
      seasonText: '#6a3f16',
      flowerWash: 'rgba(201, 96, 122, 0.08)',
      seasonWash: 'rgba(160, 120, 40, 0.1)',
    },
    glow: { select: '250, 214, 128', hint: '240, 250, 255' },
    dim: 'rgba(10, 30, 34, 0.26)',
    sheen: 1,
  },
  {
    id: 'porzellan',
    name: 'Porzellan',
    material: 'porcelain',
    palette: {
      ...CLASSIC,
      ink: '#1f3f8f',
      red: '#bb3526',
      green: '#2a7a4e',
      gold: '#b08a3a',
      paper: '#f8f9f6',
      snow: '#2f5aa8',
    },
    glow: { select: '232, 186, 90', hint: '110, 170, 230' },
    dim: 'rgba(20, 30, 50, 0.22)',
    sheen: 0.75,
  },
  {
    id: 'lack',
    name: 'Schwarzlack',
    material: 'lacquer',
    palette: {
      ...CLASSIC,
      ink: '#9fc6f6',
      red: '#e0583f',
      green: '#7ad0a2',
      gold: '#e2c069',
      paper: '#2a2623',
      blush: '#f0a0b4',
      branch: '#d8b060',
      petal: '#f29ab0',
      orchid: '#e6b6d2',
      mum: '#f0b848',
      mumHeart: '#d8862a',
      leaf: '#86d093',
      sunLight: '#ffd870',
      sunDeep: '#e8903a',
      sunRay: '#f0a040',
      autumn: '#e86a3c',
      autumnVein: '#ffd890',
      snow: '#a8d0ff',
      seasonText: '#f0c878',
      flowerWash: 'rgba(240, 160, 180, 0.07)',
      seasonWash: 'rgba(226, 192, 105, 0.08)',
      cornerAlpha: 0.8,
    },
    glow: { select: '240, 200, 110', hint: '120, 210, 170' },
    dim: 'rgba(22, 20, 18, 0.5)',
    sheen: 1,
  },
];

export function findTileSet(id) {
  return TILESETS.find((s) => s.id === id) || TILESETS.find((s) => s.id === DEFAULT_TILESET);
}
