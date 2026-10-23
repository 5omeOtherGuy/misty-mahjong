// The selectable backgrounds come from assets/backgrounds/index.json, so the
// set can change without touching the code. Each entry names its image, a
// thumbnail and the colours the UI tints itself with.

const MANIFEST = 'assets/backgrounds/index.json';

export async function loadBackgrounds() {
  const r = await fetch(MANIFEST);
  const list = await r.json();
  return list.map((b) => ({
    id: b.id,
    name: b.name,
    file: `assets/backgrounds/${b.file}`,
    thumb: `assets/backgrounds/${b.thumb}`,
    mat: b.mat || 'rgba(18, 26, 24, 0.42)',
    accent: b.accent || '#c9a45c',
  }));
}

/** Preloads an image; resolves when it is decoded. */
export function preload(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
