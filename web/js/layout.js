// The classic 144-tile "turtle" layout, derived from its traditional
// description: five layers of 87, 36, 16, 4 and 1 tiles.
//
// Positions are in half-tile units: a tile at (x, y, z) covers x..x+2 and
// y..y+2 on layer z. Using half units lets the side tiles and the crown sit
// between rows and columns, exactly as the classic layout does.

/** Row widths of the ground layer (number of tiles per row, left to right). */
const GROUND_ROWS = [
  [1, 12], // row 0: columns 1..12
  [3, 10],
  [2, 11],
  [1, 12],
  [1, 12],
  [2, 11],
  [3, 10],
  [1, 12],
];

function block(layer, firstCol, lastCol, firstRow, lastRow) {
  const out = [];
  for (let r = firstRow; r <= lastRow; r++) {
    for (let c = firstCol; c <= lastCol; c++) {
      out.push({ x: c * 2, y: r * 2, z: layer });
    }
  }
  return out;
}

export function turtleLayout() {
  const positions = [];
  GROUND_ROWS.forEach(([first, last], row) => {
    positions.push(...block(0, first, last, row, row));
  });
  // The three side tiles sit between rows 3 and 4.
  positions.push({ x: 0, y: 7, z: 0 }, { x: 26, y: 7, z: 0 }, { x: 28, y: 7, z: 0 });
  positions.push(...block(1, 4, 9, 1, 6));
  positions.push(...block(2, 5, 8, 2, 5));
  positions.push(...block(3, 6, 7, 3, 4));
  // The crown sits between the four tiles of layer 3.
  positions.push({ x: 13, y: 7, z: 4 });
  return positions;
}

/** Bounding box of a layout in half-tile units. */
export function layoutBounds(positions) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = 0;
  for (const p of positions) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + 2);
    maxY = Math.max(maxY, p.y + 2);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, minY, maxX, maxY, maxZ, width: maxX - minX, height: maxY - minY };
}

/**
 * Draw order: lower layers first; within a layer left to right, then top to
 * bottom. A tile's visible thickness extends right and down from its face,
 * so the tile to its right and the tile below must be drawn after it. For
 * half-offset tiles (the side tiles) this is only true with columns as the
 * primary key, which is why x comes before y.
 */
export function drawOrder(positions) {
  return positions
    .map((p, i) => i)
    .sort((a, b) => {
      const p = positions[a], q = positions[b];
      return p.z - q.z || p.x - q.x || p.y - q.y;
    });
}
