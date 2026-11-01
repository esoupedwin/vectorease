import type { BBox, Shape } from "../types";
import { pathD, shapeBBox, unionBBox } from "../geom";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function num(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** Markup for one shape as an SVG <path>. */
export function shapeToSvgPath(s: Shape): string {
  const attrs: string[] = [`d="${pathD(s)}"`];
  attrs.push(`fill="${s.fill === "none" ? "none" : s.fill}"`);
  if (s.fill !== "none" && s.fillOpacity < 1) attrs.push(`fill-opacity="${num(s.fillOpacity)}"`);
  if (s.stroke !== "none" && s.strokeWidth > 0) {
    attrs.push(`stroke="${s.stroke}"`, `stroke-width="${num(s.strokeWidth)}"`, `stroke-linejoin="round"`, `stroke-linecap="round"`);
    if (s.strokeOpacity < 1) attrs.push(`stroke-opacity="${num(s.strokeOpacity)}"`);
  }
  if (s.opacity < 1) attrs.push(`opacity="${num(s.opacity)}"`);
  attrs.push(`data-name="${esc(s.name)}"`);
  return `<path ${attrs.join(" ")}/>`;
}

/** Visual bounds including stroke. */
export function visualBBox(shapes: Shape[]): BBox | null {
  return unionBBox(
    shapes.map((s) => {
      const b = shapeBBox(s);
      if (!b) return null;
      const half = s.stroke !== "none" ? s.strokeWidth / 2 : 0;
      return { x: b.x - half, y: b.y - half, w: b.w + half * 2, h: b.h + half * 2 };
    }),
  );
}

export interface SvgOptions {
  /** Padding around the shapes in document units. */
  padding?: number;
  /** Fixed viewBox instead of the shapes' bounds. */
  viewBox?: BBox;
  /** Background rect color (omit for transparent). */
  background?: string;
}

/** A standalone SVG document containing the given shapes. */
export function shapesToSvg(shapes: Shape[], opts: SvgOptions = {}): string {
  const pad = opts.padding ?? 0;
  const visible = shapes.filter((s) => s.visible && s.anchors.length > 0);
  const b = opts.viewBox ?? visualBBox(visible) ?? { x: 0, y: 0, w: 1, h: 1 };
  const vb = { x: b.x - pad, y: b.y - pad, w: Math.max(b.w + pad * 2, 1), h: Math.max(b.h + pad * 2, 1) };
  const body = visible.map(shapeToSvgPath).join("\n  ");
  const bg = opts.background ? `<rect x="${num(vb.x)}" y="${num(vb.y)}" width="${num(vb.w)}" height="${num(vb.h)}" fill="${opts.background}"/>\n  ` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(vb.w)}" height="${num(vb.h)}" viewBox="${num(vb.x)} ${num(vb.y)} ${num(vb.w)} ${num(vb.h)}">\n  ` +
    bg +
    body +
    `\n</svg>`
  );
}

/** Small square thumbnail SVG for library cards. */
export function shapeThumbnail(shape: Shape, size = 96): string {
  const b = visualBBox([shape]) ?? { x: 0, y: 0, w: 1, h: 1 };
  const side = Math.max(b.w, b.h) * 1.15 || 1;
  const cx = b.x + b.w / 2,
    cy = b.y + b.h / 2;
  const vb = { x: cx - side / 2, y: cy - side / 2, w: side, h: side };
  const thumb = { ...shape, visible: true };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${num(vb.x)} ${num(vb.y)} ${num(vb.w)} ${num(vb.h)}">${shapeToSvgPath(thumb)}</svg>`;
}
