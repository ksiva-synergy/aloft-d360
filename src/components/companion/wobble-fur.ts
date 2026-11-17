/**
 * Painted fur coat for Wobble (Nova / Orbit / Lumi).
 *
 * Hair is painted into offscreen canvases as thousands of tapered, curved strands and shared as image URLs:
 * - geometry (where each hair grows, which way it flows, how it clumps) is built once per shape from a fixed seed;
 * - painting applies the companion colour and lighting once per (shape, colour, resolution), as two images:
 *   the body's coat and the outer fringe, which Wobble animates a beat behind the body so the hair trails motion;
 * - every companion with the same key reuses those images, so a chat full of companions costs one paint and
 *   animation only moves bitmaps.
 * Browser-only. Until a coat is ready (server render, tests, no canvas) Wobble shows its smooth vector body.
 */

export type Rgb = readonly [number, number, number];
type Eye = readonly [number, number, number];

export interface CoatShape {
  /** Geometry cache key, e.g. the character name. */
  name: string;
  /** Absolute `M x y C … Z` outline in the 120×110 viewBox. */
  body: string;
  /** [cx, cy, r] of the left and right eye: hair parts around them and they sit in soft sockets. */
  eyes: readonly [Eye, Eye];
  /** Seed for the deterministic hair layout. */
  seed: number;
}

/** The part of the 120×110 viewBox the coat image covers: the body plus room for the fringe and tuft. */
export const COAT_BOX = { x: -6, y: -6, width: 132, height: 120 } as const;

// Hair layers, painted back to front.
const UNDER = 0, COAT = 1, SHINE = 2, FRINGE = 3, STRAY = 4;
const LAYER_ALPHA = [1, 0.96, 0.32, 0.9, 0.5];
const COUNTS = { under: 6000, coat: 8400, shine: 2400, fringe: 2400, stray: 40, tuft: 7 };
/** Per strand: layer, root x/y, control x/y, tip x/y, root width, shade (0 deep … 1 light). */
const STRIDE = 9;
const SHADES = 32;
/** Clump cell size: hairs in a cell lean toward a shared tip, forming locks. */
const CLUMP_CELL = 2.2;
const WHITE: Rgb = [255, 255, 255];
const INK: Rgb = [32, 24, 63];

interface Geometry {
  strands: Float32Array;
  count: number;
  bounds: { cx: number; cy: number; rx: number; ry: number; bottom: number };
}

// ── math helpers ────────────────────────────────────────────────────────────

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c: Rgb, a: number) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

/** Small LCG so the coat is identical on every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function hash(i: number, j: number, seed: number) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 2D value noise in 0…1 (used to swirl the hair direction). */
function valueNoise(rand: () => number) {
  const n = 32, grid = Float32Array.from({ length: n * n }, () => rand());
  const at = (i: number, j: number) => grid[(j & (n - 1)) * n + (i & (n - 1))];
  return (x: number, y: number) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** Flattens an absolute `M x y C … Z` path (Wobble's SHAPES format) into a polygon. */
function flatten(d: string): [number, number][] {
  const n = (d.match(/-?[\d.]+/g) ?? []).map(Number);
  let x = n[0], y = n[1];
  const pts: [number, number][] = [];
  for (let i = 2; i + 5 < n.length; i += 6) {
    const [ax, ay, bx, by, ex, ey] = n.slice(i, i + 6);
    for (let k = 0; k < 24; k++) {
      const t = k / 24, u = 1 - t;
      pts.push([
        u * u * u * x + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * ex,
        u * u * u * y + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * ey,
      ]);
    }
    x = ex; y = ey;
  }
  return pts;
}

function inside(poly: [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// ── geometry: where each hair grows (colour-independent, once per shape) ────

const geometries = new Map<string, Geometry>();

function geometry(shape: CoatShape): Geometry {
  const cached = geometries.get(shape.name);
  if (cached) return cached;

  const poly = flatten(shape.body);
  const rand = rng(shape.seed);
  const noise = valueNoise(rand);
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, rx = (maxX - minX) / 2, ry = (maxY - minY) / 2;

  // Outward normals along the outline, and cumulative length for even sampling of the fringe.
  const normals = poly.map((p, i) => {
    const a = poly[(i + poly.length - 1) % poly.length], b = poly[(i + 1) % poly.length];
    let nx = b[1] - a[1], ny = a[0] - b[0];
    const m = Math.hypot(nx, ny) || 1;
    nx /= m; ny /= m;
    return inside(poly, p[0] + nx * 0.6, p[1] + ny * 0.6) ? [-nx, -ny] : [nx, ny];
  });
  const cumulative: number[] = [0];
  for (let i = 1; i <= poly.length; i++) {
    const a = poly[i - 1], b = poly[i % poly.length];
    cumulative.push(cumulative[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const perimeter = cumulative[poly.length];
  /** A random point on the outline with its outward normal. */
  const onOutline = (): [number, number, number, number] => {
    const target = rand() * perimeter;
    let lo = 0, hi = poly.length;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cumulative[mid] <= target) lo = mid; else hi = mid; }
    const t = (target - cumulative[lo]) / ((cumulative[lo + 1] - cumulative[lo]) || 1);
    const a = poly[lo], b = poly[(lo + 1) % poly.length], na = normals[lo], nb = normals[(lo + 1) % poly.length];
    let nx = na[0] + (nb[0] - na[0]) * t, ny = na[1] + (nb[1] - na[1]) * t;
    const m = Math.hypot(nx, ny) || 1;
    nx /= m; ny /= m;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, nx, ny];
  };
  // Inside spans per thin horizontal row, so uniform sampling needs no point-in-polygon tests.
  const ROW = 0.25, rows: { y: number; spans: number[]; width: number }[] = [];
  let area = 0;
  for (let y = minY + ROW / 2; y < maxY; y += ROW) {
    const xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + (xj - xi) * (y - yi) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    let width = 0;
    for (let k = 0; k + 1 < xs.length; k += 2) width += xs[k + 1] - xs[k];
    if (width > 0) { area += width; rows.push({ y, spans: xs, width: area }); }
  }
  const anywhere = (): [number, number] => {
    const target = rand() * area;
    let lo = 0, hi = rows.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].width < target) lo = mid + 1; else hi = mid; }
    const { y, spans } = rows[lo];
    let pick = rand() * spans.reduce((w, x, k) => (k % 2 ? w + x - spans[k - 1] : w), 0);
    for (let k = 0; k + 1 < spans.length; k += 2) {
      const span = spans[k + 1] - spans[k];
      if (pick <= span) return [spans[k] + pick, y + (rand() - 0.5) * ROW];
      pick -= span;
    }
    return [spans[0], y];
  };

  // Treat the body as a dome lit from the upper left and front.
  const lm = Math.hypot(-0.45, -0.72, 0.53), LX = -0.45 / lm, LY = -0.72 / lm, LZ = 0.53 / lm;
  /** 0 (in shadow) … 1 (fully lit). */
  const light = (x: number, y: number) => {
    const nx = (x - cx) / rx, ny = (y - cy) / ry, nz = Math.sqrt(1 - Math.min(1, nx * nx + ny * ny));
    const d = (nx * LX + ny * LY + nz * LZ) / (Math.hypot(nx, ny, nz) || 1);
    return clamp01((d + 0.45) / 1.45 * (1 - 0.28 * smooth(0.15, 1, ny)));
  };
  /** Hair pointing at the viewer looks shorter: 0.35 in the middle of the face … 1 at the silhouette. */
  const facing = (x: number, y: number) => 0.35 + 0.65 * Math.min(1, Math.hypot((x - cx) / rx, (y - cy) / ry));
  /** Distance outside the nearest eye's edge (negative under the eye). */
  const eyeGap = (x: number, y: number) => {
    let gap = Infinity;
    for (const [ex, ey, er] of shape.eyes) gap = Math.min(gap, Math.hypot(x - ex, y - ey) - er);
    return gap;
  };

  // Hair grows outward from a point a little below the centre, hangs slightly, swirls, and parts around the eyes.
  const gx = cx, gy = cy + ry * 0.12;
  const flow = (x: number, y: number): [number, number] => {
    let dx = x - gx, dy = y - gy, m = Math.hypot(dx, dy) || 1;
    dx /= m; dy = dy / m + 0.28;
    m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
    // Local whorls break up the radial combing without randomising each fibre.
    const a = (noise(x * 0.075, y * 0.075) - 0.5) * 1.5
      + (noise(x * 0.3, y * 0.3) - 0.5) * 1.1;
    const c = Math.cos(a), s = Math.sin(a);
    [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
    for (const [ex, ey, er] of shape.eyes) {
      const ux = x - ex, uy = y - ey, d = Math.hypot(ux, uy) || 1;
      const w = 1 - smooth(er + 0.5, er + 5, d);
      if (w > 0) {
        dx += (ux / d - dx) * w; dy += (uy / d - dy) * w;
        m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
      }
    }
    return [dx, dy];
  };
  /** Where a hair of length `len` rooted at (x, y) is pulled by its clump. */
  const clumpTip = (x: number, y: number, len: number): [number, number] => {
    const i = Math.floor(x / CLUMP_CELL), j = Math.floor(y / CLUMP_CELL);
    const kx = (i + 0.2 + 0.6 * hash(i, j, shape.seed)) * CLUMP_CELL;
    const ky = (j + 0.2 + 0.6 * hash(j, i, shape.seed + 1)) * CLUMP_CELL;
    const [dx, dy] = flow(kx, ky);
    return [kx + dx * len + (x - kx) * 0.35, ky + dy * len + (y - ky) * 0.35];
  };

  const out: number[] = [];
  const grow = (layer: number, x: number, y: number, len: number, width: number, shade: number,
    { clump = 0, curl = 0, dir }: { clump?: number; curl?: number; dir?: [number, number] } = {}) => {
    const [dx, dy] = dir ?? flow(x, y);
    let tx = x + dx * len, ty = y + dy * len;
    if (clump > 0) {
      const [kx, ky] = clumpTip(x, y, len);
      tx += (kx - tx) * clump; ty += (ky - ty) * clump;
    }
    const sx = tx - x, sy = ty - y, sl = Math.hypot(sx, sy) || 1;
    // Control point: bent sideways by `curl`, and drooping a little under its own weight.
    const qx = (x + tx) / 2 - (sy / sl) * curl * len, qy = (y + ty) / 2 + (sx / sl) * curl * len + len * 0.12;
    out.push(layer, x, y, qx, qy, tx, ty, width, clamp01(shade));
  };
  // Neighbouring hairs share length and shade, giving locks a readable form.
  const lock = (x: number, y: number) => noise(x * 0.24, y * 0.24);
  // Close-cropped facial pile blends into the longer side and outline fur.
  const facePile = (x: number, y: number) => 0.48 + 0.52 * smooth(0.35, 0.95,
    Math.hypot((x - cx) / rx, (y - cy) / ry));
  const jitter = (amount: number) => (rand() - 0.5) * amount;

  for (let n = 0; n < COUNTS.under; n++) {
    const [x, y] = anywhere();
    grow(UNDER, x, y, (1.6 + rand() * 1.4) * facing(x, y), 0.85, 0.1 + 0.4 * light(x, y) + jitter(0.1),
      { clump: 0.25, curl: jitter(0.3) });
  }
  for (let n = 0; n < COUNTS.coat; n++) {
    const [x, y] = anywhere();
    const tuft = lock(x, y);
    grow(COAT, x, y, (2.2 + tuft * 2 + rand() * 0.8) * facing(x, y) * facePile(x, y), 0.28 + tuft * 0.14,
      // Nearby roots share a subtle shadow; raised tuft tips catch more light.
      0.26 + 0.5 * light(x, y) - (1 - tuft) ** 2 * 0.16 + jitter(0.05),
      { clump: (0.3 + rand() * 0.2) * facePile(x, y), curl: (tuft - 0.5) * 0.9 });
  }
  // Extra short pile fills the face without increasing the long silhouette fringe.
  for (let n = 0; n < 2800; n++) {
    const [x, y] = anywhere();
    if (facePile(x, y) > 0.75 || eyeGap(x, y) < 0) continue;
    grow(COAT, x, y, 0.65 + rand() * 0.7, 0.25,
      0.3 + 0.5 * light(x, y) + jitter(0.08), { clump: 0.12, curl: jitter(0.2) });
  }
  for (let n = 0; n < COUNTS.shine;) {
    const [x, y] = anywhere();
    const lit = light(x, y);
    if (rand() > 0.15 + 0.85 * lit ** 1.6 || eyeGap(x, y) < 0.5) continue;
    n++;
    grow(SHINE, x, y, (1.3 + rand() * 1.4) * facing(x, y) * facePile(x, y), 0.25, 0.7 + 0.3 * lit + jitter(0.12),
      { clump: 0.7 * facePile(x, y), curl: (lock(x, y) - 0.5) * 0.3 });
  }
  // Fringe: rooted just inside the outline and combed outward, so the silhouette is soft and hairy.
  for (let n = 0; n < COUNTS.fringe; n++) {
    const [px, py, nx, ny] = onOutline();
    const depth = 0.2 + rand() * 2.6, x = px - nx * depth, y = py - ny * depth;
    const [fx, fy] = flow(x, y), a = jitter(0.5), c = Math.cos(a), s = Math.sin(a);
    let dx = nx * 0.7 + fx * 0.3, dy = ny * 0.7 + fy * 0.3;
    const m = Math.hypot(dx, dy) || 1;
    dx /= m; dy /= m;
    grow(FRINGE, x, y, 2.5 + rand() * 2.8, 0.32, 0.45 + 0.5 * light(x, y) + jitter(0.16),
      { clump: 0.3, curl: jitter(0.4), dir: [dx * c - dy * s, dx * s + dy * c] });
  }
  // Tuft: a few longer hairs sticking up from the crown.
  const crown = poly.reduce((a, p) => (p[1] < a[1] ? p : a));
  for (let k = 0; k < COUNTS.tuft; k++) {
    const a = -0.6 + (1.2 * k) / (COUNTS.tuft - 1) + jitter(0.15);
    grow(FRINGE, crown[0] + a * 2.2, crown[1] + 1.5, 6 + rand() * 3, 0.55, 0.72,
      { curl: (a < 0 ? -1 : 1) * (0.12 + rand() * 0.1), dir: [Math.sin(a), -Math.cos(a)] });
  }
  // Strays: a few long, fine flyaways.
  for (let n = 0; n < COUNTS.stray; n++) {
    const [px, py, nx, ny] = onOutline();
    const depth = 0.5 + rand(), a = jitter(1.2), c = Math.cos(a), s = Math.sin(a);
    grow(STRAY, px - nx * depth, py - ny * depth, 7 + rand() * 4.5, 0.16, 0.8,
      { curl: jitter(0.6), dir: [nx * c - ny * s, nx * s + ny * c] });
  }

  const result: Geometry = {
    strands: Float32Array.from(out),
    count: out.length / STRIDE,
    bounds: { cx, cy, rx, ry, bottom: maxY },
  };
  geometries.set(shape.name, result);
  return result;
}

// ── painting (once per shape × colour × resolution) ─────────────────────────

/** Deep shade (0) → base colour → colour-preserving highlights (1), as CSS colours. */
function palette(rgb: Rgb): string[] {
  const stops: [number, Rgb][] = [
    [0, mix(mix(rgb, INK, 0.3), WHITE, 0.15)],
    [0.3, mix(rgb, WHITE, 0.24)],
    [0.55, mix(rgb, WHITE, 0.42)],
    [0.8, mix(rgb, WHITE, 0.56)],
    [1, mix(rgb, WHITE, 0.72)],
  ];
  return Array.from({ length: SHADES }, (_, i) => {
    const t = i / (SHADES - 1);
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [ta, a] = stops[k], [tb, b] = stops[k + 1];
    return rgba(mix(a, b, (t - ta) / (tb - ta)), 1);
  });
}

/** A tapered, curved hair: full width at the root, a point at the tip. */
function addStrand(path: Path2D, s: Float32Array, o: number) {
  const x0 = s[o + 1], y0 = s[o + 2], qx = s[o + 3], qy = s[o + 4], x1 = s[o + 5], y1 = s[o + 6], w = s[o + 7] / 2;
  const tx = qx - x0, ty = qy - y0, m = Math.hypot(tx, ty) || 1, nx = (-ty / m) * w, ny = (tx / m) * w;
  path.moveTo(x0 + nx, y0 + ny);
  path.quadraticCurveTo(qx + nx * 0.5, qy + ny * 0.5, x1, y1);
  path.quadraticCurveTo(qx - nx * 0.5, qy - ny * 0.5, x0 - nx, y0 - ny);
  path.closePath();
}

function canvas(width: number, height: number) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  return c;
}

/**
 * Paints two images: the body's coat, and the outer fringe (combed-out hair, flyaways, crown tuft). They are
 * separate so Wobble can let the fringe trail the body's motion.
 */
function paint(shape: CoatShape, rgb: Rgb, scale: number): { core: HTMLCanvasElement; fringe: HTMLCanvasElement } | null {
  const g = geometry(shape);
  const width = Math.ceil(COAT_BOX.width * scale), height = Math.ceil(COAT_BOX.height * scale);
  const core = canvas(width, height), fringe = canvas(width, height);
  const ctx = core.getContext('2d'), fringeCtx = fringe.getContext('2d');
  if (!ctx || !fringeCtx) return null;
  const toBox = (c: CanvasRenderingContext2D) => c.setTransform(scale, 0, 0, scale, -COAT_BOX.x * scale, -COAT_BOX.y * scale);
  // Safari before 18 has no ctx.filter: the coat is simply a little crisper there.
  const canBlur = typeof ctx.filter === 'string';
  const shades = palette(rgb);
  const deep = mix(mix(rgb, INK, 0.5), WHITE, 0.05);
  const { cx, cy, rx, ry, bottom } = g.bounds;
  toBox(ctx);
  toBox(fringeCtx);

  // Skin under the hair, so gaps between strands read as deeper fur rather than background.
  const skin = ctx.createRadialGradient(cx - rx * 0.35, cy - ry * 0.45, 0, cx, cy, Math.max(rx, ry) * 1.15);
  skin.addColorStop(0, shades[18]);
  skin.addColorStop(1, shades[6]);
  ctx.fillStyle = skin;
  if (canBlur) ctx.filter = `blur(${0.8 * scale}px)`;
  ctx.fill(new Path2D(shape.body));
  if (canBlur) ctx.filter = 'none';

  // Undercoat goes to its own layer so it can be softened as a whole.
  const underCtx = canBlur ? canvas(width, height).getContext('2d') : null;
  for (let layer = UNDER; layer <= STRAY; layer++) {
    const target = layer >= FRINGE ? fringeCtx : layer === UNDER && underCtx ? underCtx : ctx;
    if (target === underCtx) toBox(target);
    // One path per shade keeps this to a few dozen fills for the dense coat.
    const byShade: (Path2D | null)[] = new Array(SHADES).fill(null);
    for (let i = 0; i < g.count; i++) {
      const o = i * STRIDE;
      if (g.strands[o] !== layer) continue;
      const k = Math.round(g.strands[o + 8] * (SHADES - 1));
      addStrand(byShade[k] ??= new Path2D(), g.strands, o);
    }
    target.globalAlpha = LAYER_ALPHA[layer];
    byShade.forEach((path, k) => {
      if (!path) return;
      target.fillStyle = shades[k];
      target.fill(path);
    });
    if (target === underCtx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.filter = `blur(${0.3 * scale}px)`;
      ctx.drawImage(target.canvas, 0, 0);
      ctx.restore();
    }
  }

  // Lighting passes that only touch hair already painted, applied to both images so they match.
  for (const c of [ctx, fringeCtx]) {
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-atop';
    const wash = (gradient: CanvasGradient) => {
      c.fillStyle = gradient;
      c.fillRect(COAT_BOX.x, COAT_BOX.y, COAT_BOX.width, COAT_BOX.height);
    };
    const underside = c.createLinearGradient(0, cy, 0, bottom + 6);
    underside.addColorStop(0, rgba(deep, 0));
    underside.addColorStop(1, rgba(deep, 0.38));
    wash(underside);
    const sheenX = cx - rx * 0.3, sheenY = cy - ry * 0.45;
    const sheen = c.createRadialGradient(sheenX, sheenY, 0, sheenX, sheenY, Math.max(rx, ry) * 0.75);
    sheen.addColorStop(0, rgba(mix(rgb, WHITE, 0.65), 0.12));
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    wash(sheen);
    c.globalCompositeOperation = 'source-over';
  }
  return { core, fringe };
}

function imageUrl(painted: HTMLCanvasElement): Promise<string | null> {
  return new Promise(resolve => {
    if (typeof painted.toBlob !== 'function') { resolve(painted.toDataURL('image/png')); return; }
    painted.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : null), 'image/png');
  });
}

// ── public API ──────────────────────────────────────────────────────────────

/** Image URLs for one painted coat: the body's hair, and the fringe that trails the body's motion. */
export interface Coat { core: string; fringe: string }

const MAX_COATS = 24;
const coats = new Map<string, Coat>();
const pending = new Map<string, Promise<Coat | null>>();

/** Device pixels per viewBox unit for a companion `size` CSS px wide, rounded up to a half step. */
export function coatScale(size: number): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return Math.max(1, Math.min(6, Math.ceil((size * dpr) / 120 * 2) / 2));
}

export function coatKey(shape: CoatShape, rgb: Rgb, scale: number) {
  return `${shape.name}|${rgb.map(Math.round).join(',')}|${scale}`;
}

/** The coat's image URLs if it has already been painted. */
export function cachedCoat(key: string): Coat | null {
  return coats.get(key) ?? null;
}

/** Paints (or joins the in-flight paint of) a coat; resolves to its image URLs, or null without canvas support. */
export function loadCoat(shape: CoatShape, rgb: Rgb, scale: number): Promise<Coat | null> {
  const key = coatKey(shape, rgb, scale);
  const ready = coats.get(key);
  if (ready) return Promise.resolve(ready);
  let job = pending.get(key);
  if (!job) {
    job = new Promise<void>(resolve => setTimeout(resolve, 0))
      .then(async () => {
        const painted = paint(shape, rgb, scale);
        if (!painted) return null;
        const [core, fringe] = await Promise.all([imageUrl(painted.core), imageUrl(painted.fringe)]);
        return core && fringe ? { core, fringe } : null;
      })
      .then(coat => {
        if (coat) {
          coats.set(key, coat);
          if (coats.size > MAX_COATS) {
            const [oldKey, old] = coats.entries().next().value as [string, Coat];
            coats.delete(oldKey);
            for (const url of [old.core, old.fringe]) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
          }
        }
        return coat;
      })
      .catch(() => null)
      .finally(() => { pending.delete(key); });
    pending.set(key, job);
  }
  return job;
}

const resolved = new Map<string, Rgb>();
let probe: CanvasRenderingContext2D | null | undefined;

/** Any CSS colour string (hex, rgb(), oklch(), color-mix(), …) → sRGB bytes; `fallback` if it can't be read. */
export function resolveRgb(color: string, fallback: Rgb = [139, 123, 255]): Rgb {
  const value = color.trim();
  if (!value) return fallback;
  const known = resolved.get(value);
  if (known) return known;
  let rgb: Rgb = fallback;
  const hex = /^#([\da-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    rgb = [n >> 16, (n >> 8) & 255, n & 255];
  } else {
    if (probe === undefined) {
      const c = canvas(1, 1);
      probe = c.getContext('2d', { willReadFrequently: true });
    }
    if (probe) {
      probe.fillStyle = '#010203';
      probe.fillStyle = value;
      if (probe.fillStyle !== '#010203') {
        probe.clearRect(0, 0, 1, 1);
        probe.fillRect(0, 0, 1, 1);
        const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
        rgb = [r, g, b];
      }
    }
  }
  resolved.set(value, rgb);
  return rgb;
}
