import type { Shape } from "../types";
import { shapesToSvg, visualBBox } from "./svg";

/** Rasterise shapes to a PNG blob. `scale` multiplies document pixels. */
export async function shapesToPng(shapes: Shape[], scale = 2, padding = 8, background?: string): Promise<Blob> {
  const svg = shapesToSvg(shapes, { padding, background });
  const b = visualBBox(shapes.filter((s) => s.visible)) ?? { x: 0, y: 0, w: 1, h: 1 };
  const w = Math.max(1, Math.ceil((b.w + padding * 2) * scale));
  const h = Math.max(1, Math.ceil((b.h + padding * 2) * scale));
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("SVG rasterisation failed"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((bl) => (bl ? res(bl) : rej(new Error("toBlob failed"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/**
 * Put the shapes on the clipboard in the formats Office apps understand:
 *  - image/png   → PowerPoint/Word paste it as a picture
 *  - text/html   → an <img> with the SVG inline as a data URI (Microsoft 365 converts pasted SVG to a vector picture
 *                  that can be "Convert to Shape"d)
 *  - text/plain  → raw SVG markup
 */
export async function copyForOffice(shapes: Shape[]): Promise<"rich" | "png" | "text"> {
  const svg = shapesToSvg(shapes, { padding: 4 });
  const png = await shapesToPng(shapes, 3, 4);
  const svgDataUri = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  const html = `<!DOCTYPE html><html><body><img src="${svgDataUri}" alt="VectorEase shape"/></body></html>`;
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": png,
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([svg], { type: "text/plain" }),
        }),
      ]);
      return "rich";
    } catch {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
        return "png";
      } catch {
        /* fall through */
      }
    }
  }
  await navigator.clipboard.writeText(svg);
  return "text";
}
