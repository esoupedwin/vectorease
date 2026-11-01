import type { Anchor, BBox, Shape, Vec } from "./types";
import { uid } from "./ids";

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const len =(a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec): Vec => {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** A cubic segment in absolute coordinates. */
export interface Segment {
  p0: Vec;
  c1: Vec;
  c2: Vec;
  p3: Vec;
  /** Index of the anchor this segment starts at. */
  from: number;
  /** Index of the anchor this segment ends at. */
  to: number;
  straight: boolean;
}

export function segments(shape: Shape): Segment[] {
  const a = shape.anchors;
  const out: Segment[] = [];
  const n = a.length;
  if (n < 2) return out;
  const count = shape.closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const A = a[i];
    const B = a[(i + 1) % n];
    const straight = !A.hOut && !B.hIn;
    out.push({
      p0: A.p,
      c1: A.hOut ? add(A.p, A.hOut) : A.p,
      c2: B.hIn ? add(B.p, B.hIn) : B.p,
      p3: B.p,
      from: i,
      to: (i + 1) % n,
      straight,
    });
  }
  return out;
}

export function cubicAt(s: Segment, t: number): Vec {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p3.x,
    y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p3.y,
  };
}

/** SVG path data for a shape. */
export function pathD(shape: Shape, precision = 3): string {
  const a = shape.anchors;
  if (a.length === 0) return "";
  const f = (n: number) => String(round(n, precision));
  let d = `M ${f(a[0].p.x)} ${f(a[0].p.y)}`;
  for (const s of segments(shape)) {
    if (s.straight) d += ` L ${f(s.p3.x)} ${f(s.p3.y)}`;
    else d += ` C ${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.p3.x)} ${f(s.p3.y)}`;
  }
  if (shape.closed && a.length > 1) d += " Z";
  return d;
}

/** Exact bounding box of the cubic path (extrema via derivative roots). */
export function shapeBBox(shape: Shape): BBox | null {
  const a = shape.anchors;
  if (a.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const take = (p: Vec) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  };
  take(a[0].p);
  for (const s of segments(shape)) {
    take(s.p0);
    take(s.p3);
    if (s.straight) continue;
    for (const axis of ["x", "y"] as const) {
      const p0 = s.p0[axis],
        p1 = s.c1[axis],
        p2 = s.c2[axis],
        p3 = s.p3[axis];
      // derivative: A t^2 + B t + C
      const A = -p0 + 3 * p1 - 3 * p2 + p3;
      const B = 2 * (p0 - 2 * p1 + p2);
      const C = p1 - p0;
      const roots: number[] = [];
      if (Math.abs(A) < 1e-12) {
        if (Math.abs(B) > 1e-12) roots.push(-C / B);
      } else {
        const disc = B * B - 4 * A * C;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          roots.push((-B + sq) / (2 * A), (-B - sq) / (2 * A));
        }
      }
      for (const t of roots) if (t > 0 && t < 1) take(cubicAt(s, t));
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionBBox(boxes: (BBox | null)[]): BBox | null {
  let r: BBox | null = null;
  for (const b of boxes) {
    if (!b) continue;
    if (!r) r = { ...b };
    else {
      const x = Math.min(r.x, b.x),
        y = Math.min(r.y, b.y);
      const x2 = Math.max(r.x + r.w, b.x + b.w),
        y2 = Math.max(r.y + r.h, b.y + b.h);
      r = { x, y, w: x2 - x, h: y2 - y };
    }
  }
  return r;
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function bboxContains(outer: BBox, inner: BBox): boolean {
  return (
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
  );
}

/** Nearest point on a segment to `pt`, via coarse sampling + refinement. Returns t and distance. */
export function nearestOnSegment(s: Segment, pt: Vec): { t: number; d: number; p: Vec } {
  let bestT = 0,
    bestD = Infinity;
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const d = dist(cubicAt(s, t), pt);
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  let step = 1 / N;
  for (let k = 0; k < 20; k++) {
    step /= 2;
    for (const t of [bestT - step, bestT + step]) {
      if (t < 0 || t > 1) continue;
      const d = dist(cubicAt(s, t), pt);
      if (d < bestD) {
        bestD = d;
        bestT = t;
      }
    }
  }
  return { t: bestT, d: bestD, p: cubicAt(s, bestT) };
}

/** Insert an anchor on segment `segIndex` at parameter t (de Casteljau split). Mutates shape. */
export function insertAnchorOnSegment(shape: Shape, segIndex: number, t: number): Anchor {
  const segs = segments(shape);
  const s = segs[segIndex];
  const A = shape.anchors[s.from];
  const B = shape.anchors[s.to];
  if (s.straight) {
    const p = lerp(A.p, B.p, t);
    const na: Anchor = { id: uid("a"), p, hIn: null, hOut: null, kind: "corner" };
    shape.anchors.splice(s.from + 1, 0, na);
    return na;
  }
  const p01 = lerp(s.p0, s.c1, t),
    p12 = lerp(s.c1, s.c2, t),
    p23 = lerp(s.c2, s.p3, t);
  const p012 = lerp(p01, p12, t),
    p123 = lerp(p12, p23, t);
  const mid = lerp(p012, p123, t);
  A.hOut = sub(p01, A.p);
  B.hIn = sub(p23, B.p);
  const na: Anchor = { id: uid("a"), p: mid, hIn: sub(p012, mid), hOut: sub(p123, mid), kind: "smooth" };
  shape.anchors.splice(s.from + 1, 0, na);
  return na;
}

export type Matrix = [number, number, number, number, number, number];

/** Apply an affine transform [a b c d e f] to every anchor and handle. */
export function transformShape(shape: Shape, m: Matrix): void {
  const [a, b, c, d, e, f] = m;
  const tp = (p: Vec): Vec => ({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f });
  const tv = (p: Vec): Vec => ({ x: a * p.x + c * p.y, y: b * p.x + d * p.y });
  for (const an of shape.anchors) {
    an.p = tp(an.p);
    if (an.hIn) an.hIn = tv(an.hIn);
    if (an.hOut) an.hOut = tv(an.hOut);
  }
}

export function translateShape(shape: Shape, dx: number, dy: number): void {
  for (const an of shape.anchors) an.p = { x: an.p.x + dx, y: an.p.y + dy };
}

/** Scale/translate shape so the box `from` maps onto `to`. */
export function fitShapeToBox(shape: Shape, from: BBox, to: BBox): void {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  transformShape(shape, [sx, 0, 0, sy, to.x - from.x * sx, to.y - from.y * sy]);
}

export function rotateShape(shape: Shape, deg: number, center: Vec): void {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r),
    sin = Math.sin(r);
  transformShape(shape, [
    cos,
    sin,
    -sin,
    cos,
    center.x - cos * center.x + sin * center.y,
    center.y - sin * center.x - cos * center.y,
  ]);
}

/** Reverse path direction (swap in/out handles). */
export function reverseShape(shape: Shape): void {
  shape.anchors.reverse();
  for (const an of shape.anchors) {
    const t = an.hIn;
    an.hIn = an.hOut;
    an.hOut = t;
  }
}

/* ---------- primitive builders ---------- */

const K = 0.5522847498; // circle kappa

export function makeAnchor(p: Vec, hIn: Vec | null = null, hOut: Vec | null = null, kind: Anchor["kind"] = "corner"): Anchor {
  return { id: uid("a"), p, hIn, hOut, kind };
}

export function rectAnchors(b: BBox): Anchor[] {
  return [
    makeAnchor(v(b.x, b.y)),
    makeAnchor(v(b.x + b.w, b.y)),
    makeAnchor(v(b.x + b.w, b.y + b.h)),
    makeAnchor(v(b.x, b.y + b.h)),
  ];
}

export function ellipseAnchors(b: BBox): Anchor[] {
  const cx = b.x + b.w / 2,
    cy = b.y + b.h / 2,
    rx = b.w / 2,
    ry = b.h / 2;
  const kx = rx * K,
    ky = ry * K;
  return [
    makeAnchor(v(cx, cy - ry), v(-kx, 0), v(kx, 0), "symmetric"),
    makeAnchor(v(cx + rx, cy), v(0, -ky), v(0, ky), "symmetric"),
    makeAnchor(v(cx, cy + ry), v(kx, 0), v(-kx, 0), "symmetric"),
    makeAnchor(v(cx - rx, cy), v(0, ky), v(0, -ky), "symmetric"),
  ];
}

export function polygonAnchors(b: BBox, sides: number): Anchor[] {
  const cx = b.x + b.w / 2,
    cy = b.y + b.h / 2,
    rx = b.w / 2,
    ry = b.h / 2;
  const out: Anchor[] = [];
  for (let i = 0; i < sides; i++) {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    out.push(makeAnchor(v(cx + rx * Math.cos(ang), cy + ry * Math.sin(ang))));
  }
  return out;
}

export function starAnchors(b: BBox, points: number, inner = 0.5): Anchor[] {
  const cx = b.x + b.w / 2,
    cy = b.y + b.h / 2,
    rx = b.w / 2,
    ry = b.h / 2;
  const out: Anchor[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 1 : inner;
    const ang = -Math.PI / 2 + (i * Math.PI) / points;
    out.push(makeAnchor(v(cx + rx * r * Math.cos(ang), cy + ry * r * Math.sin(ang))));
  }
  return out;
}

/** Convert anchor to smooth with auto-generated handles based on neighbours. */
export function autoSmoothAnchor(shape: Shape, index: number): void {
  const a = shape.anchors;
  const n = a.length;
  const cur = a[index];
  const prev = shape.closed || index > 0 ? a[(index - 1 + n) % n] : null;
  const next = shape.closed || index < n - 1 ? a[(index + 1) % n] : null;
  if (!prev && !next) return;
  const dir = norm(sub(next ? next.p : cur.p, prev ? prev.p : cur.p));
  const dPrev = prev ? dist(prev.p, cur.p) : 0;
  const dNext = next ? dist(next.p, cur.p) : 0;
  cur.hIn = prev ? mul(dir, -dPrev / 3) : null;
  cur.hOut = next ? mul(dir, dNext / 3) : null;
  cur.kind = "smooth";
}

export function cloneShape(s: Shape, newIds = true): Shape {
  const c: Shape = JSON.parse(JSON.stringify(s));
  if (newIds) {
    c.id = uid("s");
    for (const an of c.anchors) an.id = uid("a");
  }
  return c;
}
