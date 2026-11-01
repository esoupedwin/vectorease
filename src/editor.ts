import type { Anchor, BBox, Shape, Tool, Vec } from "./types";
import { Store, newShape, DEFAULT_FILL } from "./store";
import * as G from "./geom";
import { pathD } from "./geom";

const SVG_NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  parent?.appendChild(n);
  return n;
}

const HANDLE_R = 4;
const ANCHOR_HALF = 4;
const HIT_PX = 8;
const GRID = 10;
const SCALE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type ScaleHandle = (typeof SCALE_HANDLES)[number];

type Drag =
  | { kind: "pan"; startScreen: Vec; startPan: Vec }
  | { kind: "marquee"; start: Vec; cur: Vec; additive: boolean }
  | { kind: "move"; start: Vec; orig: Map<string, Shape>; moved: boolean }
  | { kind: "scale"; handle: ScaleHandle; origBox: BBox; orig: Map<string, Shape> }
  | { kind: "anchor"; start: Vec; orig: Map<string, Vec>; pull: { shapeId: string; anchorId: string } | null; moved: boolean }
  | { kind: "handle"; shapeId: string; anchorId: string; which: "in" | "out" }
  | { kind: "pen"; shapeId: string; anchorId: string; start: Vec; moved: boolean }
  | { kind: "create"; tool: Tool; start: Vec; cur: Vec; square: boolean };

export interface EditorCallbacks {
  onStatus?: (text: string) => void;
  onToast?: (text: string, kind?: "info" | "error") => void;
}

export class Editor {
  readonly svg: SVGSVGElement;
  private world: SVGGElement;
  private artboard: SVGRectElement;
  private gridRect: SVGRectElement;
  private gridPattern: SVGPatternElement;
  private shapesLayer: SVGGElement;
  private overlay: SVGGElement;
  private drag: Drag | null = null;
  private spaceDown = false;
  private penShapeId: string | null = null;
  private cursorDoc: Vec = { x: 0, y: 0 };
  private hoverSegment: { shapeId: string; seg: number; t: number; p: Vec } | null = null;
  snap = false;
  showGrid = true;
  /** Internal shape clipboard (JSON). */
  private clipboard: Shape[] = [];

  constructor(
    host: HTMLElement,
    public store: Store,
    private cb: EditorCallbacks = {},
  ) {
    this.svg = el("svg", { class: "canvas", tabindex: 0 });
    host.appendChild(this.svg);
    const defs = el("defs", {}, this.svg);
    this.gridPattern = el("pattern", { id: "grid", patternUnits: "userSpaceOnUse", width: GRID, height: GRID }, defs);
    el("path", { d: `M ${GRID} 0 L 0 0 0 ${GRID}`, fill: "none", stroke: "var(--grid-line)", "stroke-width": 1, "vector-effect": "non-scaling-stroke" }, this.gridPattern);
    el("rect", { class: "canvas-bg", width: "100%", height: "100%", fill: "var(--canvas-bg)" }, this.svg);
    this.world = el("g", { class: "world" }, this.svg);
    this.artboard = el("rect", { class: "artboard" }, this.world);
    this.gridRect = el("rect", { class: "grid", fill: "url(#grid)", "pointer-events": "none" }, this.world);
    this.shapesLayer = el("g", { class: "shapes" }, this.world);
    this.overlay = el("g", { class: "overlay" }, this.svg);

    store.on((ev) => {
      if (ev === "doc" || ev === "workspace") this.renderShapes();
      if (ev === "view" || ev === "workspace") this.applyView();
      this.renderOverlay();
      if (ev === "tool") this.onToolChanged();
    });

    this.svg.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.svg.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.svg.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.svg.addEventListener("pointercancel", () => this.cancelDrag());
    this.svg.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    this.svg.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    this.svg.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => this.onKeyDown(e));
    window.addEventListener("keyup", (e) => this.onKeyUp(e));
    new ResizeObserver(() => this.renderOverlay()).observe(host);

    this.renderShapes();
    this.applyView();
    this.renderOverlay();
  }

  /* ---------- coordinates ---------- */

  toDoc(sx: number, sy: number): Vec {
    const v = this.store.view;
    return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
  }
  toScreen(p: Vec): Vec {
    const v = this.store.view;
    return { x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY };
  }
  private eventPos(e: MouseEvent): Vec {
    const r = this.svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private eventDoc(e: MouseEvent): Vec {
    const s = this.eventPos(e);
    return this.toDoc(s.x, s.y);
  }
  private snapPt(p: Vec): Vec {
    if (!this.snap) return p;
    return { x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID };
  }

  /* ---------- view ---------- */

  private applyView(): void {
    const v = this.store.view;
    this.world.setAttribute("transform", `translate(${v.panX} ${v.panY}) scale(${v.zoom})`);
    const d = this.store.doc;
    for (const r of [this.artboard, this.gridRect]) {
      r.setAttribute("x", "0");
      r.setAttribute("y", "0");
      r.setAttribute("width", String(d.width));
      r.setAttribute("height", String(d.height));
    }
    this.artboard.setAttribute("fill", d.background);
    this.gridRect.style.display = this.showGrid && v.zoom >= 0.5 ? "" : "none";
    this.svg.classList.toggle("tool-pan", this.spaceDown);
  }

  setGrid(on: boolean): void {
    this.showGrid = on;
    this.applyView();
  }

  zoomAt(factor: number, screen?: Vec): void {
    const v = this.store.view;
    const r = this.svg.getBoundingClientRect();
    const c = screen ?? { x: r.width / 2, y: r.height / 2 };
    const zoom = Math.min(32, Math.max(0.05, v.zoom * factor));
    const k = zoom / v.zoom;
    this.store.setView({ zoom, panX: c.x - (c.x - v.panX) * k, panY: c.y - (c.y - v.panY) * k });
  }
  setZoom(zoom: number): void {
    this.zoomAt(zoom / this.store.view.zoom);
  }
  fitToView(box?: BBox): void {
    const r = this.svg.getBoundingClientRect();
    const d = this.store.doc;
    const b = box ?? { x: 0, y: 0, w: d.width, h: d.height };
    const pad = 40;
    const zoom = Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h);
    const z = Math.min(32, Math.max(0.05, zoom));
    this.store.setView({
      zoom: z,
      panX: (r.width - b.w * z) / 2 - b.x * z,
      panY: (r.height - b.h * z) / 2 - b.y * z,
    });
  }
  viewportCenterDoc(): Vec {
    const r = this.svg.getBoundingClientRect();
    return this.toDoc(r.width / 2, r.height / 2);
  }

  /* ---------- rendering ---------- */

  private renderShapes(): void {
    this.shapesLayer.replaceChildren();
    this.applyView();
    const zoom = this.store.view.zoom;
    for (const s of this.store.doc.shapes) {
      if (!s.visible || s.anchors.length === 0) continue;
      const g = el("g", { "data-id": s.id, class: "shape" + (s.locked ? " locked" : "") }, this.shapesLayer);
      const d = pathD(s);
      el(
        "path",
        {
          d,
          fill: s.fill,
          "fill-opacity": s.fillOpacity,
          stroke: s.stroke,
          "stroke-width": s.strokeWidth,
          "stroke-opacity": s.strokeOpacity,
          opacity: s.opacity,
          "stroke-linejoin": "round",
          "stroke-linecap": "round",
          "pointer-events": "none",
        },
        g,
      );
      // Invisible, generous hit area.
      el(
        "path",
        {
          d,
          class: "hit",
          fill: s.fill === "none" ? "none" : "transparent",
          stroke: "transparent",
          "stroke-width": Math.max(s.strokeWidth, HIT_PX / zoom),
          "pointer-events": s.locked ? "none" : "visiblePainted",
        },
        g,
      );
    }
  }

  private renderOverlay(): void {
    const ov = this.overlay;
    ov.replaceChildren();
    const st = this.store;
    const tool = st.tool;
    const sel = st.selectedShapes();

    if (tool === "select" || tool === "node" || tool === "pen") {
      // thin outline of selected shapes
      for (const s of sel) {
        if (!s.visible) continue;
        el("path", { d: this.screenPathD(s), class: "sel-outline" }, ov);
      }
    }

    if (tool === "select" && sel.length > 0 && !(this.drag && this.drag.kind === "move")) {
      const b = G.unionBBox(sel.map(G.shapeBBox));
      if (b) {
        const a = this.toScreen({ x: b.x, y: b.y });
        const c = this.toScreen({ x: b.x + b.w, y: b.y + b.h });
        el("rect", { x: a.x, y: a.y, width: c.x - a.x, height: c.y - a.y, class: "sel-box" }, ov);
        const locked = sel.some((s) => s.locked);
        if (!locked) {
          for (const h of SCALE_HANDLES) {
            const p = this.scaleHandlePos(h, a, c);
            el("rect", { x: p.x - ANCHOR_HALF, y: p.y - ANCHOR_HALF, width: ANCHOR_HALF * 2, height: ANCHOR_HALF * 2, class: `scale-handle h-${h}`, "data-role": "scale", "data-handle": h }, ov);
          }
        }
      }
    }

    if (tool === "node" || tool === "pen") {
      for (const s of sel) this.renderNodes(s, ov);
      if (tool === "node" && this.hoverSegment && !this.drag) {
        const p = this.toScreen(this.hoverSegment.p);
        el("circle", { cx: p.x, cy: p.y, r: 4, class: "insert-hint" }, ov);
      }
    }

    if (tool === "pen" && this.penShapeId) {
      const s = st.shapeById(this.penShapeId);
      if (s && s.anchors.length > 0 && !this.drag) {
        const last = s.anchors[s.anchors.length - 1];
        const from = last.hOut ? G.add(last.p, last.hOut) : last.p;
        const a = this.toScreen(last.p);
        const b = this.toScreen(this.cursorDoc);
        if (last.hOut) {
          const c1 = this.toScreen(from);
          el("path", { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${b.x} ${b.y} ${b.x} ${b.y}`, class: "pen-preview" }, ov);
        } else el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "pen-preview" }, ov);
      }
    }

    if (this.drag?.kind === "marquee") {
      const d = this.drag;
      const a = this.toScreen(d.start),
        b = this.toScreen(d.cur);
      el("rect", { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y), class: "marquee" }, ov);
    }

    if (this.drag?.kind === "create") {
      const d = this.drag;
      const box = this.createBox(d);
      const tmp = this.buildPrimitive(d.tool, box);
      if (tmp) el("path", { d: this.screenPathD(tmp), class: "create-preview" }, ov);
    }
  }

  private scaleHandlePos(h: ScaleHandle, a: Vec, c: Vec): Vec {
    const mx = (a.x + c.x) / 2,
      my = (a.y + c.y) / 2;
    switch (h) {
      case "nw": return { x: a.x, y: a.y };
      case "n": return { x: mx, y: a.y };
      case "ne": return { x: c.x, y: a.y };
      case "e": return { x: c.x, y: my };
      case "se": return { x: c.x, y: c.y };
      case "s": return { x: mx, y: c.y };
      case "sw": return { x: a.x, y: c.y };
      case "w": return { x: a.x, y: my };
    }
  }

  private screenPathD(s: Shape): string {
    const v = this.store.view;
    const t: Shape = { ...s, anchors: s.anchors.map((a) => ({ ...a, p: this.toScreen(a.p), hIn: a.hIn ? G.mul(a.hIn, v.zoom) : null, hOut: a.hOut ? G.mul(a.hOut, v.zoom) : null })) };
    return pathD(t, 2);
  }

  private renderNodes(s: Shape, ov: SVGGElement): void {
    const st = this.store;
    const n = s.anchors.length;
    const showHandlesFor = new Set<number>();
    s.anchors.forEach((a, i) => {
      if (st.nodeSelection.has(a.id)) {
        showHandlesFor.add(i);
        showHandlesFor.add((i + 1) % n);
        showHandlesFor.add((i - 1 + n) % n);
      }
    });
    const isPen = st.tool === "pen";
    s.anchors.forEach((a, i) => {
      const p = this.toScreen(a.p);
      const selected = st.nodeSelection.has(a.id);
      // Edit-shape mode shows every Bézier handle; the pen only shows handles near the active point.
      if (!isPen || showHandlesFor.has(i) || i === n - 1) {
        for (const which of ["in", "out"] as const) {
          let h = which === "in" ? a.hIn : a.hOut;
          // Like PowerPoint: a selected point on a straight edge still offers a handle lying along that edge.
          let virtual = false;
          if (!h && selected && !isPen) {
            h = this.virtualHandle(s, i, which);
            virtual = !!h;
          }
          if (!h) continue;
          const hp = this.toScreen(G.add(a.p, h));
          el("line", { x1: p.x, y1: p.y, x2: hp.x, y2: hp.y, class: "handle-line" }, ov);
          el("circle", {
            cx: hp.x,
            cy: hp.y,
            r: HANDLE_R,
            class: "handle" + (virtual ? " virtual" : ""),
            "data-role": "handle",
            "data-shape": s.id,
            "data-anchor": a.id,
            "data-which": which,
            "data-virtual": virtual ? "1" : "0",
          }, ov);
        }
      }
      el("rect", {
        x: p.x - ANCHOR_HALF,
        y: p.y - ANCHOR_HALF,
        width: ANCHOR_HALF * 2,
        height: ANCHOR_HALF * 2,
        class: "anchor" + (selected ? " selected" : "") + (a.kind !== "corner" ? " smooth" : ""),
        "data-role": "anchor",
        "data-shape": s.id,
        "data-anchor": a.id,
      }, ov);
    });
  }

  /** Handle for an anchor that has none: one third of the way along the straight edge to its neighbour. */
  private virtualHandle(s: Shape, i: number, which: "in" | "out"): Vec | null {
    const n = s.anchors.length;
    if (n < 2) return null;
    let j = which === "in" ? i - 1 : i + 1;
    if (j < 0 || j >= n) {
      if (!s.closed) return null;
      j = (j + n) % n;
    }
    const h = G.mul(G.sub(s.anchors[j].p, s.anchors[i].p), 1 / 3);
    return G.len(h) > 1e-6 ? h : null;
  }

  /* ---------- pointer ---------- */

  private roleTarget(e: Event): { role: string; el: Element } | null {
    const t = (e.target as Element | null)?.closest?.("[data-role]");
    return t ? { role: t.getAttribute("data-role")!, el: t } : null;
  }
  private shapeTarget(e: Event): Shape | null {
    const t = (e.target as Element | null)?.closest?.("[data-id]");
    const id = t?.getAttribute("data-id");
    return id ? (this.store.shapeById(id) ?? null) : null;
  }

  private onPointerDown(e: PointerEvent): void {
    this.svg.focus({ preventScroll: true });
    const screen = this.eventPos(e);
    const doc = this.eventDoc(e);
    const st = this.store;

    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      this.drag = { kind: "pan", startScreen: screen, startPan: { x: st.view.panX, y: st.view.panY } };
      this.svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    this.svg.setPointerCapture(e.pointerId);

    const tool = st.tool;
    const role = this.roleTarget(e);

    if (tool === "select") {
      if (role?.role === "scale") {
        const sel = st.selectedShapes();
        const box = G.unionBBox(sel.map(G.shapeBBox));
        if (box) {
          st.beginDrag();
          this.drag = { kind: "scale", handle: role.el.getAttribute("data-handle") as ScaleHandle, origBox: box, orig: new Map(sel.map((s) => [s.id, G.cloneShape(s, false)])) };
        }
        return;
      }
      const shape = this.shapeTarget(e);
      if (shape && !shape.locked) {
        if (e.shiftKey) st.toggleSelect(shape.id);
        else if (!st.selection.has(shape.id)) st.select([shape.id]);
        const sel = st.selectedShapes().filter((s) => !s.locked);
        st.beginDrag();
        this.drag = { kind: "move", start: this.snapPt(doc), orig: new Map(sel.map((s) => [s.id, G.cloneShape(s, false)])), moved: false };
        return;
      }
      this.drag = { kind: "marquee", start: doc, cur: doc, additive: e.shiftKey };
      if (!e.shiftKey) st.clearSelection();
      return;
    }

    if (tool === "node") {
      if (role?.role === "anchor") {
        const anchorId = role.el.getAttribute("data-anchor")!;
        const shapeId = role.el.getAttribute("data-shape")!;
        if (e.shiftKey) st.toggleNode(anchorId);
        else if (!st.nodeSelection.has(anchorId)) st.selectNodes([anchorId]);
        const orig = new Map<string, Vec>();
        for (const s of st.selectedShapes()) for (const a of s.anchors) if (st.nodeSelection.has(a.id)) orig.set(a.id, { ...a.p });
        st.beginDrag();
        this.drag = { kind: "anchor", start: this.snapPt(doc), orig, pull: e.altKey ? { shapeId, anchorId } : null, moved: false };
        return;
      }
      if (role?.role === "handle") {
        const shapeId = role.el.getAttribute("data-shape")!;
        const anchorId = role.el.getAttribute("data-anchor")!;
        const which = role.el.getAttribute("data-which") as "in" | "out";
        st.beginDrag();
        if (role.el.getAttribute("data-virtual") === "1") {
          // Turn the virtual handle into a real one; the edge looks unchanged until it is dragged.
          const s = st.shapeById(shapeId);
          const i = s ? s.anchors.findIndex((a) => a.id === anchorId) : -1;
          const vh = s && i >= 0 ? this.virtualHandle(s, i, which) : null;
          if (s && vh) {
            s.anchors[i][which === "in" ? "hIn" : "hOut"] = vh;
            s.anchors[i].kind = "corner";
          }
        }
        this.drag = { kind: "handle", shapeId, anchorId, which };
        return;
      }
      const shape = this.shapeTarget(e);
      if (shape && !shape.locked) {
        if (st.selection.has(shape.id) && this.hoverSegment && this.hoverSegment.shapeId === shape.id) {
          // click on a segment of an already-selected shape → insert anchor there
          const hs = this.hoverSegment;
          let newId = "";
          st.mutate(() => {
            newId = G.insertAnchorOnSegment(shape, hs.seg, hs.t).id;
          });
          st.selectNodes([newId]);
          this.hoverSegment = null;
          st.beginDrag();
          this.drag = { kind: "anchor", start: this.snapPt(doc), orig: new Map([[newId, { ...shape.anchors.find((a) => a.id === newId)!.p }]]), pull: null, moved: false };
          return;
        }
        if (e.shiftKey) st.toggleSelect(shape.id);
        else st.select([shape.id]);
        return;
      }
      if (st.nodeSelection.size > 0 && !e.shiftKey) st.selectNodes([]);
      this.drag = { kind: "marquee", start: doc, cur: doc, additive: e.shiftKey };
      return;
    }

    if (tool === "pen") {
      this.penClick(doc, e);
      return;
    }

    if (tool === "rect" || tool === "ellipse" || tool === "polygon" || tool === "star") {
      const p = this.snapPt(doc);
      this.drag = { kind: "create", tool, start: p, cur: p, square: e.shiftKey };
      this.renderOverlay();
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const screen = this.eventPos(e);
    const doc = this.eventDoc(e);
    this.cursorDoc = doc;
    this.cb.onStatus?.(`x ${Math.round(doc.x)}  y ${Math.round(doc.y)}`);
    const st = this.store;
    const d = this.drag;

    if (!d) {
      if (st.tool === "node") this.updateHoverSegment(e, doc);
      if (st.tool === "pen") this.renderOverlay();
      return;
    }

    switch (d.kind) {
      case "pan":
        st.setView({ panX: d.startPan.x + screen.x - d.startScreen.x, panY: d.startPan.y + screen.y - d.startScreen.y });
        break;
      case "marquee":
        d.cur = doc;
        this.renderOverlay();
        break;
      case "move": {
        const p = this.snapPt(doc);
        let dx = p.x - d.start.x,
          dy = p.y - d.start.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (dx !== 0 || dy !== 0) d.moved = true;
        for (const s of st.doc.shapes) {
          const o = d.orig.get(s.id);
          if (!o) continue;
          s.anchors = o.anchors.map((a) => ({ ...a, p: { x: a.p.x + dx, y: a.p.y + dy } }));
        }
        st.touch();
        break;
      }
      case "scale": {
        const nb = this.scaledBox(d.origBox, d.handle, this.snapPt(doc), e.shiftKey, e.altKey);
        for (const s of st.doc.shapes) {
          const o = d.orig.get(s.id);
          if (!o) continue;
          s.anchors = o.anchors.map((a) => ({ ...a, p: { ...a.p }, hIn: a.hIn && { ...a.hIn }, hOut: a.hOut && { ...a.hOut } }));
          G.fitShapeToBox(s, d.origBox, nb);
        }
        st.touch();
        break;
      }
      case "anchor": {
        const p = this.snapPt(doc);
        const dx = p.x - d.start.x,
          dy = p.y - d.start.y;
        if (dx !== 0 || dy !== 0) d.moved = true;
        if (d.pull) {
          const s = st.shapeById(d.pull.shapeId);
          const a = s?.anchors.find((x) => x.id === d.pull!.anchorId);
          if (a) {
            const h = { x: doc.x - a.p.x, y: doc.y - a.p.y };
            a.hOut = h;
            a.hIn = G.mul(h, -1);
            a.kind = "symmetric";
          }
        } else {
          for (const s of st.doc.shapes)
            for (const a of s.anchors) {
              const o = d.orig.get(a.id);
              if (o) a.p = { x: o.x + dx, y: o.y + dy };
            }
        }
        st.touch();
        break;
      }
      case "handle":
        this.applyHandleDrag(d, doc, e.shiftKey, e.altKey);
        break;
      case "pen": {
        const s = st.shapeById(d.shapeId);
        const a = s?.anchors.find((x) => x.id === d.anchorId);
        if (!a) break;
        const h = G.sub(doc, a.p);
        if (G.len(h) > 2 / st.view.zoom) {
          d.moved = true;
          a.hOut = h;
          a.hIn = G.mul(h, -1);
          a.kind = "symmetric";
          st.touch();
        }
        break;
      }
      case "create":
        d.cur = this.snapPt(doc);
        d.square = e.shiftKey;
        this.renderOverlay();
        break;
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const st = this.store;
    const doc = this.eventDoc(e);

    switch (d.kind) {
      case "pan":
        break;
      case "marquee": {
        const box = this.rectFrom(d.start, doc);
        if (st.tool === "node") {
          const ids: string[] = [];
          for (const s of st.selectedShapes()) for (const a of s.anchors) if (a.p.x >= box.x && a.p.x <= box.x + box.w && a.p.y >= box.y && a.p.y <= box.y + box.h) ids.push(a.id);
          st.selectNodes(ids, d.additive);
        } else {
          const ids = st.doc.shapes.filter((s) => s.visible && !s.locked).filter((s) => {
            const b = G.shapeBBox(s);
            return b && G.bboxIntersects(b, box);
          }).map((s) => s.id);
          if (ids.length || !d.additive) st.select(ids, d.additive);
        }
        break;
      }
      case "move":
      case "scale":
      case "handle":
        st.endDrag();
        break;
      case "anchor":
        st.endDrag();
        break;
      case "pen":
        st.endDrag();
        break;
      case "create": {
        const box = this.createBox(d);
        if (box.w < 2 && box.h < 2) {
          // click without drag: default-size primitive centred on click
          box.x -= 40;
          box.y -= 40;
          box.w = 80;
          box.h = 80;
        }
        const s = this.buildPrimitive(d.tool, box);
        if (s) {
          st.mutate((doc) => doc.shapes.push(s));
          st.select([s.id]);
        }
        break;
      }
    }
    this.renderOverlay();
  }

  private cancelDrag(): void {
    if (!this.drag) return;
    const k = this.drag.kind;
    this.drag = null;
    if (k === "move" || k === "scale" || k === "anchor" || k === "handle" || k === "pen") this.store.cancelDrag();
    this.renderOverlay();
  }

  private onDoubleClick(e: MouseEvent): void {
    const st = this.store;
    const role = this.roleTarget(e);
    if (st.tool === "node" && role?.role === "anchor") {
      const shape = st.shapeById(role.el.getAttribute("data-shape")!);
      const idx = shape?.anchors.findIndex((a) => a.id === role.el.getAttribute("data-anchor")) ?? -1;
      if (shape && idx >= 0) {
        st.mutate(() => {
          const a = shape.anchors[idx];
          if (a.hIn || a.hOut) {
            a.hIn = null;
            a.hOut = null;
            a.kind = "corner";
          } else G.autoSmoothAnchor(shape, idx);
        });
      }
      return;
    }
    if (st.tool === "select") {
      const shape = this.shapeTarget(e);
      if (shape && !shape.locked) {
        st.select([shape.id]);
        st.setTool("node");
      }
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const screen = this.eventPos(e);
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.0015);
      this.zoomAt(factor, screen);
    } else {
      const v = this.store.view;
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      const dy = e.shiftKey ? 0 : e.deltaY;
      this.store.setView({ panX: v.panX - dx, panY: v.panY - dy });
    }
  }

  /* ---------- helpers for drags ---------- */

  private rectFrom(a: Vec, b: Vec): BBox {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  }

  private createBox(d: Extract<Drag, { kind: "create" }>): BBox {
    let { x: cx, y: cy } = d.cur;
    if (d.square) {
      const dx = cx - d.start.x,
        dy = cy - d.start.y;
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      cx = d.start.x + Math.sign(dx || 1) * m;
      cy = d.start.y + Math.sign(dy || 1) * m;
    }
    return this.rectFrom(d.start, { x: cx, y: cy });
  }

  private buildPrimitive(tool: Tool, box: BBox): Shape | null {
    const count = this.store.doc.shapes.length + 1;
    switch (tool) {
      case "rect": return newShape({ name: `Rectangle ${count}`, anchors: G.rectAnchors(box) });
      case "ellipse": return newShape({ name: `Ellipse ${count}`, anchors: G.ellipseAnchors(box) });
      case "polygon": return newShape({ name: `Polygon ${count}`, anchors: G.polygonAnchors(box, this.polygonSides) });
      case "star": return newShape({ name: `Star ${count}`, anchors: G.starAnchors(box, this.starPoints, this.starInner) });
      default: return null;
    }
  }
  polygonSides = 6;
  starPoints = 5;
  starInner = 0.5;

  private scaledBox(ob: BBox, h: ScaleHandle, p: Vec, keepAspect: boolean, fromCenter: boolean): BBox {
    let x1 = ob.x, y1 = ob.y, x2 = ob.x + ob.w, y2 = ob.y + ob.h;
    const cx = ob.x + ob.w / 2, cy = ob.y + ob.h / 2;
    if (h.includes("w")) x1 = p.x;
    if (h.includes("e")) x2 = p.x;
    if (h.includes("n")) y1 = p.y;
    if (h.includes("s")) y2 = p.y;
    if (fromCenter) {
      if (h.includes("w")) x2 = 2 * cx - x1;
      if (h.includes("e")) x1 = 2 * cx - x2;
      if (h.includes("n")) y2 = 2 * cy - y1;
      if (h.includes("s")) y1 = 2 * cy - y2;
    }
    let w = x2 - x1, hh = y2 - y1;
    if (keepAspect && ob.w > 0 && ob.h > 0) {
      const ratio = ob.w / ob.h;
      const isCorner = h.length === 2;
      if (isCorner) {
        if (Math.abs(w) / ob.w > Math.abs(hh) / ob.h) hh = Math.sign(hh || 1) * Math.abs(w) / ratio;
        else w = Math.sign(w || 1) * Math.abs(hh) * ratio;
      } else if (h === "n" || h === "s") w = Math.sign(w || 1) * Math.abs(hh) * ratio;
      else hh = Math.sign(hh || 1) * Math.abs(w) / ratio;
      // re-anchor the fixed side
      if (fromCenter) {
        x1 = cx - w / 2; y1 = cy - hh / 2;
      } else {
        if (h.includes("w")) x1 = x2 - w; else if (h.includes("e")) x2 = x1 + w; else { x1 = cx - w / 2; }
        if (h.includes("n")) y1 = y2 - hh; else if (h.includes("s")) y2 = y1 + hh; else { y1 = cy - hh / 2; }
      }
      x2 = x1 + w; y2 = y1 + hh;
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  /**
   * Move the dragged handle to the cursor. With Shift held, the handle is locked to the line
   * opposite its sibling handle (so the two stay aligned) and only its length follows the cursor.
   */
  private applyHandleDrag(d: Extract<Drag, { kind: "handle" }>, doc: Vec, shift: boolean, alt: boolean): void {
    const s = this.store.shapeById(d.shapeId);
    const i = s ? s.anchors.findIndex((x) => x.id === d.anchorId) : -1;
    if (!s || i < 0) return;
    const a = s.anchors[i];
    const h = G.sub(this.snapPt(doc), a.p);
    if (shift) {
      const otherWhich = d.which === "in" ? "out" : "in";
      const sibling = a[otherWhich === "in" ? "hIn" : "hOut"] ?? this.virtualHandle(s, i, otherWhich);
      if (sibling && G.len(sibling) > 1e-6) {
        const dir = G.norm(G.mul(sibling, -1));
        const length = Math.max(G.dot(h, dir), 0.5 / this.store.view.zoom);
        a[d.which === "in" ? "hIn" : "hOut"] = G.mul(dir, length);
        this.store.touch();
        return;
      }
    }
    this.moveHandle(a, d.which, h, alt);
    this.store.touch();
  }

  private moveHandle(a: Anchor, which: "in" | "out", h: Vec, independent: boolean): void {
    const other = which === "in" ? "hOut" : "hIn";
    const own = which === "in" ? "hIn" : "hOut";
    a[own] = h;
    if (independent) {
      a.kind = "corner";
      return;
    }
    if (a.kind === "symmetric") a[other] = G.mul(h, -1);
    else if (a.kind === "smooth" && a[other]) a[other] = G.mul(G.norm(h), -G.len(a[other]!));
  }

  private updateHoverSegment(e: PointerEvent, doc: Vec): void {
    const prev = this.hoverSegment;
    this.hoverSegment = null;
    const role = this.roleTarget(e);
    if (!role) {
      const shape = this.shapeTarget(e);
      if (shape && this.store.selection.has(shape.id)) {
        const tol = HIT_PX / this.store.view.zoom;
        let best: { shapeId: string; seg: number; t: number; p: Vec } | null = null;
        let bestD = Infinity;
        const segs = G.segments(shape);
        for (let i = 0; i < segs.length; i++) {
          const r = G.nearestOnSegment(segs[i], doc);
          if (r.d <= tol && r.d < bestD) {
            bestD = r.d;
            best = { shapeId: shape.id, seg: i, t: r.t, p: r.p };
          }
        }
        // don't offer insertion on top of an existing anchor
        if (best !== null) {
          const bp = best.p;
          this.hoverSegment = shape.anchors.some((a) => G.dist(a.p, bp) < tol) ? null : best;
        }
      }
    }
    if (prev !== this.hoverSegment) this.renderOverlay();
  }

  /* ---------- pen ---------- */

  private penClick(doc: Vec, e: PointerEvent): void {
    const st = this.store;
    const p = this.snapPt(doc);
    let shape = this.penShapeId ? st.shapeById(this.penShapeId) : undefined;
    if (shape && shape.anchors.length >= 2) {
      const first = shape.anchors[0];
      if (G.dist(this.toScreen(first.p), this.toScreen(doc)) <= HIT_PX) {
        st.mutate(() => {
          shape!.closed = true;
          if (shape!.fill === "none") shape!.fill = DEFAULT_FILL;
        });
        this.finishPen();
        return;
      }
    }
    if (!shape) {
      const count = st.doc.shapes.length + 1;
      shape = newShape({ name: `Path ${count}`, closed: false, anchors: [] });
      const s = shape;
      st.mutate((d) => d.shapes.push(s));
      this.penShapeId = s.id;
      st.select([s.id]);
    }
    const a = G.makeAnchor(p);
    const target = shape;
    st.beginDrag();
    target.anchors.push(a);
    st.selectNodes([a.id]);
    st.touch();
    this.drag = { kind: "pen", shapeId: target.id, anchorId: a.id, start: p, moved: false };
    void e;
  }

  finishPen(): void {
    if (!this.penShapeId) return;
    const st = this.store;
    const s = st.shapeById(this.penShapeId);
    this.penShapeId = null;
    if (s && s.anchors.length < 2) st.mutate((d) => (d.shapes = d.shapes.filter((x) => x.id !== s.id)));
    st.selectNodes([]);
    this.renderOverlay();
  }

  private onToolChanged(): void {
    if (this.store.tool !== "pen") this.finishPen();
    this.hoverSegment = null;
    this.svg.dataset.tool = this.store.tool;
  }

  /* ---------- editing commands (used by UI too) ---------- */

  deleteSelection(): void {
    const st = this.store;
    if (st.tool === "node" && st.nodeSelection.size > 0) {
      const ids = new Set(st.nodeSelection);
      st.mutate((d) => {
        for (const s of d.shapes) s.anchors = s.anchors.filter((a) => !ids.has(a.id));
        d.shapes = d.shapes.filter((s) => s.anchors.length >= 2 || !st.selection.has(s.id));
      });
      st.selectNodes([]);
      return;
    }
    if (st.selection.size === 0) return;
    const ids = new Set(st.selection);
    st.mutate((d) => (d.shapes = d.shapes.filter((s) => !ids.has(s.id) || s.locked)));
    st.clearSelection();
  }

  duplicateSelection(offset = 16): Shape[] {
    const st = this.store;
    const sel = st.selectedShapes();
    if (!sel.length) return [];
    const copies = sel.map((s) => {
      const c = G.cloneShape(s);
      c.name = `${s.name} copy`;
      G.translateShape(c, offset, offset);
      return c;
    });
    st.mutate((d) => d.shapes.push(...copies));
    st.select(copies.map((c) => c.id));
    return copies;
  }

  copySelectionInternal(): Shape[] {
    this.clipboard = this.store.selectedShapes().map((s) => G.cloneShape(s, false));
    return this.clipboard;
  }

  pasteInternal(at?: Vec): void {
    if (!this.clipboard.length) return;
    const st = this.store;
    const copies = this.clipboard.map((s) => G.cloneShape(s));
    if (at) {
      const b = G.unionBBox(copies.map(G.shapeBBox));
      if (b) for (const c of copies) G.translateShape(c, at.x - (b.x + b.w / 2), at.y - (b.y + b.h / 2));
    } else for (const c of copies) G.translateShape(c, 16, 16);
    st.mutate((d) => d.shapes.push(...copies));
    st.select(copies.map((c) => c.id));
    st.setTool("select");
  }

  insertShape(shape: Shape, at?: Vec): Shape {
    const st = this.store;
    const c = G.cloneShape(shape);
    const b = G.shapeBBox(c);
    const target = at ?? this.viewportCenterDoc();
    if (b) G.translateShape(c, target.x - (b.x + b.w / 2), target.y - (b.y + b.h / 2));
    st.mutate((d) => d.shapes.push(c));
    st.select([c.id]);
    st.setTool("select");
    return c;
  }

  nudge(dx: number, dy: number): void {
    const st = this.store;
    if (st.tool === "node" && st.nodeSelection.size) {
      st.mutate((d) => {
        for (const s of d.shapes) for (const a of s.anchors) if (st.nodeSelection.has(a.id)) a.p = { x: a.p.x + dx, y: a.p.y + dy };
      });
    } else if (st.selection.size) {
      st.mutate((d) => {
        for (const s of d.shapes) if (st.selection.has(s.id) && !s.locked) G.translateShape(s, dx, dy);
      });
    }
  }

  selectAll(): void {
    const st = this.store;
    if (st.tool === "node") {
      st.selectNodes(st.selectedShapes().flatMap((s) => s.anchors.map((a) => a.id)));
    } else st.select(st.doc.shapes.filter((s) => s.visible && !s.locked).map((s) => s.id));
  }

  /* ---------- keyboard ---------- */

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.isTyping(e)) return;
    const st = this.store;
    const mod = e.ctrlKey || e.metaKey;

    // Pressing Shift mid-drag snaps the handle into alignment immediately, without waiting for a mouse move.
    if (e.key === "Shift" && this.drag?.kind === "handle") this.applyHandleDrag(this.drag, this.cursorDoc, true, e.altKey);

    if (e.code === "Space" && !e.repeat) {
      this.spaceDown = true;
      this.applyView();
      e.preventDefault();
      return;
    }
    if (mod && e.key.toLowerCase() === "z") {
      e.shiftKey ? st.redo() : st.undo();
      e.preventDefault();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      st.redo();
      e.preventDefault();
      return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      this.selectAll();
      e.preventDefault();
      return;
    }
    if (mod && e.key.toLowerCase() === "d") {
      this.duplicateSelection();
      e.preventDefault();
      return;
    }
    if (mod && e.key === "0") {
      this.fitToView();
      e.preventDefault();
      return;
    }
    if (mod && e.key === "1") {
      this.setZoom(1);
      e.preventDefault();
      return;
    }
    if (mod && (e.key === "=" || e.key === "+")) {
      this.zoomAt(1.25);
      e.preventDefault();
      return;
    }
    if (mod && e.key === "-") {
      this.zoomAt(0.8);
      e.preventDefault();
      return;
    }
    if (mod) return; // Ctrl+C / Ctrl+V are handled by the document copy/paste events in main.ts

    switch (e.key) {
      case "v": case "V": st.setTool("select"); break;
      case "a": case "A": st.setTool("node"); break;
      case "p": case "P": st.setTool("pen"); break;
      case "r": case "R": st.setTool("rect"); break;
      case "e": case "E": st.setTool("ellipse"); break;
      case "g": case "G": st.setTool("polygon"); break;
      case "s": case "S": st.setTool("star"); break;
      case "Delete": case "Backspace": this.deleteSelection(); e.preventDefault(); break;
      case "Escape":
        if (this.drag) this.cancelDrag();
        else if (this.penShapeId) this.finishPen();
        else if (st.nodeSelection.size) st.selectNodes([]);
        else st.clearSelection();
        break;
      case "Enter":
        if (this.penShapeId) this.finishPen();
        break;
      case "ArrowLeft": this.nudge(e.shiftKey ? -10 : -1, 0); e.preventDefault(); break;
      case "ArrowRight": this.nudge(e.shiftKey ? 10 : 1, 0); e.preventDefault(); break;
      case "ArrowUp": this.nudge(0, e.shiftKey ? -10 : -1); e.preventDefault(); break;
      case "ArrowDown": this.nudge(0, e.shiftKey ? 10 : 1); e.preventDefault(); break;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key === "Shift" && this.drag?.kind === "handle") this.applyHandleDrag(this.drag, this.cursorDoc, false, e.altKey);
    if (e.code === "Space") {
      this.spaceDown = false;
      this.applyView();
    }
  }
}
