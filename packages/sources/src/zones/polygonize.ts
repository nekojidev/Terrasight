export type Pt = [number, number];

export interface PolygonRings {
  /** Outer ring, closed, counter-clockwise with y up (x = column, y = height - row). */
  outer: Pt[];
  holes: Pt[][];
}

/** Signed area, positive for counter-clockwise rings (y up). */
export function ringArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j]![0] + ring[i]![0]) * (ring[i]![1] - ring[j]![1]);
  return a / 2;
}

function inRing(x: number, y: number, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Exact outline of the cells of one class: cell edges between a class cell and a non-class cell are linked into
 * rings. Output coordinates are lattice corners (col, h - row), y up, so a polygon's area in cells equals the
 * number of cells it covers. Outer rings are counter-clockwise, holes clockwise.
 */
export function polygonize(cls: Uint8Array, w: number, h: number, code: number): PolygonRings[] {
  const W = w + 1;
  const is = (r: number, c: number) => r >= 0 && c >= 0 && r < h && c < w && cls[r * w + c] === code;
  // Directed edges in (col, row-down) space with the class on the right-hand side.
  const out = new Map<number, number[]>(); // from-vertex -> to-vertices
  const add = (c0: number, r0: number, c1: number, r1: number) => {
    const from = r0 * W + c0;
    const list = out.get(from);
    if (list) list.push(r1 * W + c1);
    else out.set(from, [r1 * W + c1]);
  };
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      if (cls[r * w + c] !== code) continue;
      if (!is(r - 1, c)) add(c, r, c + 1, r); // top, heading east
      if (!is(r, c + 1)) add(c + 1, r, c + 1, r + 1); // right, heading south
      if (!is(r + 1, c)) add(c + 1, r + 1, c, r + 1); // bottom, heading west
      if (!is(r, c - 1)) add(c, r + 1, c, r); // left, heading north
    }
  const rings: Pt[][] = [];
  for (const [start, firsts] of out) {
    while (firsts.length) {
      const ring: number[] = [start];
      let from = start;
      let to = firsts.pop()!;
      for (;;) {
        ring.push(to);
        if (to === start) break;
        const next = out.get(to);
        if (!next || !next.length) throw new Error("open outline");
        let pick = 0;
        if (next.length > 1) {
          // Two ways out of a pinch vertex: take the right-most turn so rings stay separate.
          const dx = (to % W) - (from % W);
          const dy = Math.floor(to / W) - Math.floor(from / W);
          let bestScore = -Infinity;
          next.forEach((cand, k) => {
            const ex = (cand % W) - (to % W);
            const ey = Math.floor(cand / W) - Math.floor(to / W);
            const score = dx * ey - dy * ex; // y-down: positive = right turn
            if (score > bestScore) {
              bestScore = score;
              pick = k;
            }
          });
        }
        const [n] = next.splice(pick, 1);
        from = to;
        to = n!;
      }
      const pts: Pt[] = ring.slice(0, -1).map((v) => [v % W, h - Math.floor(v / W)]);
      const clean: Pt[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[(i + pts.length - 1) % pts.length]!;
        const b = pts[i]!;
        const d = pts[(i + 1) % pts.length]!;
        if ((b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]) !== 0) clean.push(b);
      }
      clean.push(clean[0]!);
      // Traced with the class on the right (clockwise in the picture); reverse so outer rings run counter-clockwise.
      rings.push(clean.reverse());
    }
  }
  const outers: Array<{ ring: Pt[]; area: number; holes: Pt[][] }> = [];
  const holes: Pt[][] = [];
  for (const ring of rings) {
    const a = ringArea(ring);
    if (a > 0) outers.push({ ring, area: a, holes: [] });
    else holes.push(ring);
  }
  for (const hole of holes) {
    // A point just inside the void, i.e. to the right of the hole's first edge (class is on the left).
    const [a, b] = [hole[0]!, hole[1]!];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const px = (a[0] + b[0]) / 2 + ((b[1] - a[1]) / len) * 0.25;
    const py = (a[1] + b[1]) / 2 - ((b[0] - a[0]) / len) * 0.25;
    let host: (typeof outers)[number] | null = null;
    for (const o of outers) if (inRing(px, py, o.ring) && (!host || o.area < host.area)) host = o;
    host?.holes.push(hole);
  }
  return outers.map((o) => ({ outer: o.ring, holes: o.holes }));
}

/** Area in cells of a polygon (outer minus holes). */
export function polygonCells(p: PolygonRings): number {
  return Math.abs(ringArea(p.outer)) - p.holes.reduce((s, hole) => s + Math.abs(ringArea(hole)), 0);
}
