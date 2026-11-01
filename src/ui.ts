import type { Shape, Tool, Anchor } from "./types";
import type { Store } from "./store";
import type { Editor } from "./editor";
import type { Library } from "./library";
import * as G from "./geom";
import {
  deleteWorkspace,
  exportLibraryFile,
  exportWorkspaceFile,
  importLibraryFile,
  importWorkspaceFile,
  listWorkspaces,
  loadWorkspaceById,
  saveWorkspace,
  downloadBlob,
  safeFilename,
} from "./persistence";
import { newWorkspace } from "./store";
import { shapesToSvg } from "./export/svg";
import { copyForOffice, copyText, shapesToPng } from "./export/raster";
import { shapesToPptx } from "./export/pptx";

/* ---------- tiny DOM helper ---------- */

type Child = Node | string | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = String(v);
    else if (k === "style") n.setAttribute("style", String(v));
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k in n && typeof v !== "object") (n as unknown as Record<string, unknown>)[k] = v;
    else n.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

export function toast(text: string, kind: "info" | "error" = "info"): void {
  const host = document.getElementById("toasts")!;
  const t = h("div", { class: `toast ${kind}` }, text);
  host.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, kind === "error" ? 5000 : 2600);
}

/* ---------- main builder ---------- */

export interface UIContext {
  store: Store;
  editor: Editor;
  library: Library;
}

export function buildUI(ctx: UIContext): void {
  buildTopbar(ctx);
  buildToolbar(ctx);
  buildSidebar(ctx);
  buildStatus(ctx);
}

/* ---------- top bar ---------- */

function buildTopbar(ctx: UIContext): void {
  const { store, editor } = ctx;
  const bar = document.getElementById("topbar")!;

  const wsSelect = h("select", { class: "ws-select", title: "Switch workspace" });
  const nameInput = h("input", { class: "ws-name", type: "text", title: "Workspace name (click to rename)" });
  const saveState = h("span", { class: "save-state" }, "Saved");

  const refreshWsList = () => {
    wsSelect.replaceChildren();
    for (const m of listWorkspaces()) {
      wsSelect.appendChild(h("option", { value: m.id, selected: m.id === store.ws.id }, m.name));
    }
    nameInput.value = store.ws.name;
  };

  const switchTo = (id: string) => {
    const ws = loadWorkspaceById(id);
    if (!ws) return toast("Workspace could not be loaded.", "error");
    saveWorkspace(store.ws);
    store.loadWorkspace(ws);
    saveWorkspace(ws);
    refreshWsList();
  };

  wsSelect.addEventListener("change", () => switchTo(wsSelect.value));
  nameInput.addEventListener("change", () => {
    store.ws.name = nameInput.value.trim() || "Untitled workspace";
    nameInput.value = store.ws.name;
    store.touch();
    refreshWsList();
  });
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") nameInput.blur();
  });

  const btn = (label: string, title: string, onClick: () => void, cls = "") =>
    h("button", { class: `tb-btn ${cls}`, title, onclick: onClick }, label);

  const undoBtn = btn("↶", "Undo (Ctrl+Z)", () => store.undo());
  const redoBtn = btn("↷", "Redo (Ctrl+Shift+Z)", () => store.redo());
  const zoomLabel = h("button", { class: "tb-btn zoom-label", title: "Reset to 100% (Ctrl+1)", onclick: () => editor.setZoom(1) }, "100%");

  const snapBtn = btn("Snap", "Snap to 10px grid", () => {
    editor.snap = !editor.snap;
    snapBtn.classList.toggle("active", editor.snap);
  });
  const gridBtn = btn("Grid", "Show grid", () => {
    editor.setGrid(!editor.showGrid);
    gridBtn.classList.toggle("active", editor.showGrid);
  }, "active");

  const exportMenu = h(
    "details",
    { class: "menu" },
    h("summary", { class: "tb-btn primary" }, "Export ▾"),
    h(
      "div",
      { class: "menu-items" },
      menuItem("Copy for PowerPoint / Office", "Ctrl+C", () => copyOffice(ctx)),
      menuItem("Copy SVG code", "", () => copySvg(ctx)),
      h("hr"),
      menuItem("Download as PowerPoint (.pptx)", "editable shapes", () => downloadPptx(ctx)),
      menuItem("Download SVG", "", () => downloadSvg(ctx)),
      menuItem("Download PNG (3×)", "", () => downloadPng(ctx)),
    ),
  );
  closeMenuOnClick(exportMenu);

  const wsMenu = h(
    "details",
    { class: "menu" },
    h("summary", { class: "tb-btn" }, "Workspace ▾"),
    h(
      "div",
      { class: "menu-items" },
      menuItem("New workspace", "", () => {
        saveWorkspace(store.ws);
        const ws = newWorkspace(`Workspace ${listWorkspaces().length + 1}`);
        saveWorkspace(ws);
        store.loadWorkspace(ws);
        refreshWsList();
        editor.fitToView();
      }),
      menuItem("Duplicate workspace", "", () => {
        saveWorkspace(store.ws);
        const copy = { ...structuredClone(store.ws), id: newWorkspace().id, name: `${store.ws.name} copy`, createdAt: Date.now(), updatedAt: Date.now() };
        saveWorkspace(copy);
        store.loadWorkspace(copy);
        refreshWsList();
      }),
      menuItem("Delete workspace…", "", () => {
        if (!confirm(`Delete workspace "${store.ws.name}"? This cannot be undone.`)) return;
        deleteWorkspace(store.ws.id);
        const next = listWorkspaces()[0];
        const ws = (next && loadWorkspaceById(next.id)) || newWorkspace();
        saveWorkspace(ws);
        store.loadWorkspace(ws);
        refreshWsList();
        toast("Workspace deleted.");
      }),
      h("hr"),
      menuItem("Save workspace to file", ".vectorease.json", () => exportWorkspaceFile(store.ws)),
      menuItem("Open workspace from file…", "", async () => {
        try {
          const ws = await importWorkspaceFile();
          if (!ws) return;
          saveWorkspace(store.ws);
          store.loadWorkspace(ws);
          saveWorkspace(ws);
          refreshWsList();
          editor.fitToView();
          toast(`Opened "${ws.name}".`);
        } catch (e) {
          toast((e as Error).message, "error");
        }
      }),
    ),
  );
  closeMenuOnClick(wsMenu);

  bar.append(
    h("div", { class: "brand" }, h("span", { class: "logo" }, "◆"), "VectorEase"),
    h("div", { class: "tb-group" }, wsSelect, nameInput, wsMenu, saveState),
    h("div", { class: "tb-spacer" }),
    h("div", { class: "tb-group" }, undoBtn, redoBtn),
    h(
      "div",
      { class: "tb-group" },
      btn("−", "Zoom out (Ctrl+-)", () => editor.zoomAt(0.8)),
      zoomLabel,
      btn("+", "Zoom in (Ctrl+=)", () => editor.zoomAt(1.25)),
      btn("Fit", "Fit artboard (Ctrl+0)", () => editor.fitToView()),
      snapBtn,
      gridBtn,
    ),
    h("div", { class: "tb-group" }, exportMenu),
  );

  // autosave
  let timer: number | undefined;
  let dirty = false;
  const flush = () => {
    if (!dirty) return;
    saveWorkspace(store.ws);
    dirty = false;
    saveState.textContent = "Saved";
    saveState.classList.remove("dirty");
  };
  store.on((ev) => {
    if (ev === "doc" || ev === "view") {
      dirty = true;
      saveState.textContent = "Saving…";
      saveState.classList.add("dirty");
      clearTimeout(timer);
      timer = window.setTimeout(flush, 600);
    }
    if (ev === "doc" || ev === "workspace") {
      undoBtn.disabled = !store.canUndo();
      redoBtn.disabled = !store.canRedo();
    }
    if (ev === "view" || ev === "workspace") zoomLabel.textContent = `${Math.round(store.view.zoom * 100)}%`;
    if (ev === "workspace") refreshWsList();
  });
  window.addEventListener("beforeunload", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());

  refreshWsList();
  undoBtn.disabled = true;
  redoBtn.disabled = true;
}

function menuItem(label: string, hint: string, onClick: () => void): HTMLElement {
  return h("button", { class: "menu-item", onclick: onClick }, h("span", {}, label), hint ? h("span", { class: "hint" }, hint) : null);
}
function closeMenuOnClick(details: HTMLDetailsElement): void {
  details.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".menu-item")) details.open = false;
  });
  document.addEventListener("pointerdown", (e) => {
    if (details.open && !details.contains(e.target as Node)) details.open = false;
  });
}

/* ---------- export actions ---------- */

function exportTargets(ctx: UIContext): Shape[] {
  const sel = ctx.store.selectedShapes().filter((s) => s.visible);
  if (sel.length) return sel;
  return ctx.store.doc.shapes.filter((s) => s.visible);
}

export async function copyOffice(ctx: UIContext): Promise<void> {
  const shapes = exportTargets(ctx);
  if (!shapes.length) return toast("Nothing to copy.", "error");
  try {
    const mode = await copyForOffice(shapes);
    const what = ctx.store.selection.size ? `${shapes.length} selected shape${shapes.length > 1 ? "s" : ""}` : "all shapes";
    if (mode === "rich") toast(`Copied ${what}. Paste into PowerPoint (Ctrl+V). For editable points use Export → Download .pptx.`);
    else if (mode === "png") toast(`Copied ${what} as PNG.`);
    else toast(`Copied ${what} as SVG text (this browser does not allow image clipboard writes).`);
  } catch (e) {
    toast(`Copy failed: ${(e as Error).message}`, "error");
  }
}

async function copySvg(ctx: UIContext): Promise<void> {
  const shapes = exportTargets(ctx);
  if (!shapes.length) return toast("Nothing to copy.", "error");
  await copyText(shapesToSvg(shapes, { padding: 4 }));
  toast("SVG markup copied.");
}

function downloadSvg(ctx: UIContext): void {
  const shapes = exportTargets(ctx);
  if (!shapes.length) return toast("Nothing to export.", "error");
  const onlySel = ctx.store.selection.size > 0;
  const d = ctx.store.doc;
  const svg = onlySel ? shapesToSvg(shapes, { padding: 4 }) : shapesToSvg(shapes, { viewBox: { x: 0, y: 0, w: d.width, h: d.height } });
  downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${safeFilename(ctx.store.ws.name)}.svg`);
}

async function downloadPng(ctx: UIContext): Promise<void> {
  const shapes = exportTargets(ctx);
  if (!shapes.length) return toast("Nothing to export.", "error");
  try {
    const png = await shapesToPng(shapes, 3, 8);
    downloadBlob(png, `${safeFilename(ctx.store.ws.name)}.png`);
  } catch (e) {
    toast((e as Error).message, "error");
  }
}

async function downloadPptx(ctx: UIContext): Promise<void> {
  const shapes = exportTargets(ctx);
  if (!shapes.length) return toast("Nothing to export.", "error");
  try {
    const blob = await shapesToPptx(shapes, ctx.store.ws.name);
    downloadBlob(blob, `${safeFilename(ctx.store.ws.name)}.pptx`);
    toast("PowerPoint file downloaded. Open it, select the shapes and copy them into your deck; right-click → Edit Points to tweak.");
  } catch (e) {
    toast(`PPTX export failed: ${(e as Error).message}`, "error");
  }
}

/* ---------- left toolbar ---------- */

const TOOLS: { tool: Tool; label: string; key: string; icon: string }[] = [
  { tool: "select", label: "Select / Move", key: "V", icon: "⬉" },
  { tool: "node", label: "Edit anchors & handles", key: "A", icon: "⬡" },
  { tool: "pen", label: "Pen (click: corner, drag: curve, click first point: close)", key: "P", icon: "✒" },
  { tool: "rect", label: "Rectangle (Shift: square)", key: "R", icon: "▭" },
  { tool: "ellipse", label: "Ellipse (Shift: circle)", key: "E", icon: "◯" },
  { tool: "polygon", label: "Polygon", key: "G", icon: "⬠" },
  { tool: "star", label: "Star", key: "S", icon: "★" },
];

function buildToolbar(ctx: UIContext): void {
  const { store } = ctx;
  const bar = document.getElementById("toolbar")!;
  const buttons = new Map<Tool, HTMLButtonElement>();
  for (const t of TOOLS) {
    const b = h("button", { class: "tool-btn", title: `${t.label}  [${t.key}]`, onclick: () => store.setTool(t.tool) }, h("span", { class: "icon" }, t.icon), h("span", { class: "key" }, t.key));
    buttons.set(t.tool, b);
    bar.appendChild(b);
  }
  const sync = () => buttons.forEach((b, t) => b.classList.toggle("active", t === store.tool));
  store.on((ev) => ev === "tool" && sync());
  sync();
}

/* ---------- status bar ---------- */

function buildStatus(ctx: UIContext): void {
  const bar = document.getElementById("statusbar")!;
  const pos = h("span", { class: "status-pos" }, "");
  const hint = h("span", { class: "status-hint" }, "");
  const count = h("span", { class: "status-count" }, "");
  bar.append(pos, hint, h("span", { class: "tb-spacer" }), count);
  ctx.editor["cb"].onStatus = (t) => (pos.textContent = t);
  const hints: Record<Tool, string> = {
    select: "Drag to move · handles scale (Shift: keep ratio, Alt: from centre) · double-click shape to edit anchors · Space+drag to pan · Ctrl+wheel zoom",
    node: "Drag anchors/handles · Shift+drag handle keeps it aligned with its sibling · Alt+drag anchor pulls out handles · Alt+drag handle breaks symmetry · double-click anchor toggles smooth/corner · click a segment to insert an anchor · Delete removes anchors",
    pen: "Click adds a corner · click-drag adds a curve point · click the first point to close · Enter/Esc finishes an open path",
    rect: "Drag to draw · Shift keeps it square · click for a default size",
    ellipse: "Drag to draw · Shift keeps it circular",
    polygon: "Drag to draw · sides set in the Properties panel",
    star: "Drag to draw · points and inner radius set in the Properties panel",
  };
  const sync = () => {
    hint.textContent = hints[ctx.store.tool];
    const n = ctx.store.doc.shapes.length;
    const s = ctx.store.selection.size;
    count.textContent = `${n} shape${n === 1 ? "" : "s"}${s ? ` · ${s} selected` : ""}${ctx.store.nodeSelection.size ? ` · ${ctx.store.nodeSelection.size} anchors` : ""}`;
  };
  ctx.store.on(sync);
  sync();
}

/* ---------- sidebar ---------- */

function buildSidebar(ctx: UIContext): void {
  const side = document.getElementById("sidebar")!;
  const props = h("section", { class: "panel panel-props" });
  const layers = h("section", { class: "panel panel-layers" });
  const lib = h("section", { class: "panel panel-library" });
  side.append(props, layers, lib);
  buildPropertiesPanel(ctx, props);
  buildLayersPanel(ctx, layers);
  buildLibraryPanel(ctx, lib);
}

/* ----- properties ----- */

interface Field {
  label: string;
  kind: "text" | "number" | "color" | "checkbox" | "range" | "select";
  get: () => string | number | boolean;
  set: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  /** Pair with the next field on one row. */
  half?: boolean;
  /** Commit on input (live) rather than on change. */
  live?: boolean;
}

function buildPropertiesPanel(ctx: UIContext, root: HTMLElement): void {
  const { store, editor, library } = ctx;
  let key = "";
  const inputs: { field: Field; input: HTMLInputElement | HTMLSelectElement }[] = [];

  const render = () => {
    const sel = store.selectedShapes();
    const nodeSel = [...store.nodeSelection];
    const newKey = `${store.tool}|${[...store.selection].join(",")}|${nodeSel.join(",")}`;
    if (newKey === key) {
      // just refresh values
      for (const { field, input } of inputs) {
        if (document.activeElement === input) continue;
        const v = field.get();
        if (field.kind === "checkbox") (input as HTMLInputElement).checked = !!v;
        else input.value = String(v);
      }
      return;
    }
    key = newKey;
    inputs.length = 0;
    root.replaceChildren();

    if (store.tool === "node" && nodeSel.length > 0) renderAnchorProps(sel, nodeSel);
    else if (sel.length > 0) renderShapeProps(sel);
    else renderDocProps();
  };

  const section = (title: string, ...children: Child[]) => h("div", { class: "fields" }, h("h3", {}, title), ...children);

  const addFields = (fields: Field[]): HTMLElement[] => {
    const rows: HTMLElement[] = [];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const make = (field: Field) => {
        let input: HTMLInputElement | HTMLSelectElement;
        if (field.kind === "select") {
          input = h("select", {});
          for (const o of field.options ?? []) input.appendChild(h("option", { value: o.value }, o.label));
          input.value = String(field.get());
        } else {
          input = h("input", { type: field.kind === "checkbox" ? "checkbox" : field.kind === "range" ? "range" : field.kind === "color" ? "color" : field.kind, min: field.min, max: field.max, step: field.step });
          if (field.kind === "checkbox") input.checked = !!field.get();
          else input.value = String(field.get());
        }
        const commit = () => field.set(field.kind === "checkbox" ? String((input as HTMLInputElement).checked) : input.value);
        input.addEventListener("change", commit);
        if (field.live || field.kind === "range" || field.kind === "color") input.addEventListener("input", commit);
        inputs.push({ field, input });
        return h("label", { class: `field ${field.kind}` }, h("span", {}, field.label), input);
      };
      if (f.half && fields[i + 1]) {
        rows.push(h("div", { class: "row" }, make(f), make(fields[i + 1])));
        i++;
      } else rows.push(make(f));
    }
    return rows;
  };

  const mutateSel = (fn: (s: Shape) => void) => store.mutate((d) => d.shapes.forEach((s) => store.selection.has(s.id) && fn(s)));
  const num = (v: string, fallback: number) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : fallback);

  function renderShapeProps(sel: Shape[]) {
    const first = sel[0];
    const box = () => G.unionBBox(sel.map(G.shapeBBox)) ?? { x: 0, y: 0, w: 0, h: 0 };
    const resize = (nb: { x?: number; y?: number; w?: number; h?: number }) => {
      const b = box();
      const target = { x: nb.x ?? b.x, y: nb.y ?? b.y, w: Math.max(0.01, nb.w ?? b.w), h: Math.max(0.01, nb.h ?? b.h) };
      mutateSel((s) => G.fitShapeToBox(s, b, target));
    };
    const fmt = (n: number) => String(Math.round(n * 100) / 100);

    const appearance: Field[] = [
      { label: "Name", kind: "text", get: () => (sel.length === 1 ? first.name : `${sel.length} shapes`), set: (v) => sel.length === 1 && mutateSel((s) => (s.name = v)) },
      { label: "Fill", kind: "color", get: () => (first.fill === "none" ? "#ffffff" : first.fill), set: (v) => mutateSel((s) => (s.fill = v)), half: true },
      { label: "No fill", kind: "checkbox", get: () => first.fill === "none", set: (v) => mutateSel((s) => (s.fill = v === "true" ? "none" : s.fill === "none" ? "#4f7cff" : s.fill)) },
      { label: "Fill opacity", kind: "range", min: 0, max: 1, step: 0.01, get: () => first.fillOpacity, set: (v) => mutateSel((s) => (s.fillOpacity = num(v, 1))) },
      { label: "Stroke", kind: "color", get: () => (first.stroke === "none" ? "#000000" : first.stroke), set: (v) => mutateSel((s) => (s.stroke = v)), half: true },
      { label: "No stroke", kind: "checkbox", get: () => first.stroke === "none", set: (v) => mutateSel((s) => (s.stroke = v === "true" ? "none" : s.stroke === "none" ? "#1f2a44" : s.stroke)) },
      { label: "Stroke width", kind: "number", min: 0, step: 0.5, get: () => first.strokeWidth, set: (v) => mutateSel((s) => (s.strokeWidth = Math.max(0, num(v, 1)))), half: true },
      { label: "Stroke opacity", kind: "number", min: 0, max: 1, step: 0.05, get: () => first.strokeOpacity, set: (v) => mutateSel((s) => (s.strokeOpacity = Math.min(1, Math.max(0, num(v, 1))))) },
      { label: "Opacity", kind: "range", min: 0, max: 1, step: 0.01, get: () => first.opacity, set: (v) => mutateSel((s) => (s.opacity = num(v, 1))) },
      { label: "Closed path", kind: "checkbox", get: () => first.closed, set: (v) => mutateSel((s) => (s.closed = v === "true")) },
    ];
    const geometry: Field[] = [
      { label: "X", kind: "number", step: 1, get: () => fmt(box().x), set: (v) => resize({ x: num(v, box().x) }), half: true },
      { label: "Y", kind: "number", step: 1, get: () => fmt(box().y), set: (v) => resize({ y: num(v, box().y) }) },
      { label: "Width", kind: "number", step: 1, min: 0.01, get: () => fmt(box().w), set: (v) => resize({ w: num(v, box().w) }), half: true },
      { label: "Height", kind: "number", step: 1, min: 0.01, get: () => fmt(box().h), set: (v) => resize({ h: num(v, box().h) }) },
    ];

    const rotateInput = h("input", { type: "number", value: "15", step: "1", style: "width:64px" });
    const rotate = (sign: number) => {
      const b = box();
      const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      mutateSel((s) => G.rotateShape(s, sign * num(rotateInput.value, 15), c));
    };
    const flip = (axis: "x" | "y") => {
      const b = box();
      mutateSel((s) => G.transformShape(s, axis === "x" ? [-1, 0, 0, 1, 2 * b.x + b.w, 0] : [1, 0, 0, -1, 0, 2 * b.y + b.h]));
    };

    const nodeCount = sel.reduce((n, s) => n + s.anchors.length, 0);

    root.append(
      h(
        "div",
        { class: "row btns top-action" },
        h("button", { class: "primary", title: "Edit anchors and Bézier handles [A]", onclick: () => store.setTool("node") }, "⬡ Edit points"),
      ),
      section("Shape", ...addFields(appearance)),
      section("Position & size", ...addFields(geometry)),
      section(
        "Transform",
        h("div", { class: "row btns" }, h("button", { onclick: () => rotate(-1), title: "Rotate counter-clockwise" }, "↺"), rotateInput, h("span", { class: "unit" }, "°"), h("button", { onclick: () => rotate(1), title: "Rotate clockwise" }, "↻")),
        h("div", { class: "row btns" }, h("button", { onclick: () => flip("x") }, "Flip H"), h("button", { onclick: () => flip("y") }, "Flip V"), h("button", { onclick: () => mutateSel(G.reverseShape), title: "Reverse path direction" }, "Reverse")),
      ),
      section(
        "Actions",
        h(
          "div",
          { class: "row btns" },
          h("button", { class: "primary", onclick: () => { for (const s of sel) library.add(s); toast(`${sel.length > 1 ? sel.length + " shapes" : `"${first.name}"`} added to library.`); } }, "＋ Add to library"),
        ),
        h(
          "div",
          { class: "row btns" },
          h("button", { onclick: () => editor.duplicateSelection() }, "Duplicate"),
          h("button", { class: "danger", onclick: () => editor.deleteSelection() }, "Delete"),
        ),
        h("p", { class: "muted" }, `${sel.length} shape${sel.length > 1 ? "s" : ""}, ${nodeCount} anchor${nodeCount === 1 ? "" : "s"}`),
      ),
    );
  }

  function renderAnchorProps(sel: Shape[], nodeIds: string[]) {
    const pairs: { s: Shape; a: Anchor; i: number }[] = [];
    for (const s of sel) s.anchors.forEach((a, i) => nodeIds.includes(a.id) && pairs.push({ s, a, i }));
    if (!pairs.length) return renderShapeProps(sel);
    const first = pairs[0].a;
    const mutateAnchors = (fn: (a: Anchor, s: Shape, i: number) => void) =>
      store.mutate((d) => {
        for (const s of d.shapes) s.anchors.forEach((a, i) => nodeIds.includes(a.id) && fn(a, s, i));
      });
    const fmt = (n: number) => String(Math.round(n * 100) / 100);
    const fields: Field[] = [
      {
        label: "Kind",
        kind: "select",
        options: [
          { value: "corner", label: "Corner (independent handles)" },
          { value: "smooth", label: "Smooth (aligned handles)" },
          { value: "symmetric", label: "Symmetric (mirrored handles)" },
        ],
        get: () => first.kind,
        set: (v) =>
          mutateAnchors((a) => {
            a.kind = v as Anchor["kind"];
            if (a.kind !== "corner" && a.hIn && a.hOut) {
              const dir = G.norm(G.sub(a.hOut, a.hIn));
              const lo = a.kind === "symmetric" ? (G.len(a.hOut) + G.len(a.hIn)) / 2 : G.len(a.hOut);
              const li = a.kind === "symmetric" ? lo : G.len(a.hIn);
              a.hOut = G.mul(dir, lo);
              a.hIn = G.mul(dir, -li);
            }
          }),
      },
      { label: "X", kind: "number", step: 1, get: () => fmt(first.p.x), set: (v) => pairs.length === 1 && mutateAnchors((a) => (a.p = { ...a.p, x: num(v, a.p.x) })), half: true },
      { label: "Y", kind: "number", step: 1, get: () => fmt(first.p.y), set: (v) => pairs.length === 1 && mutateAnchors((a) => (a.p = { ...a.p, y: num(v, a.p.y) })) },
    ];
    root.append(
      section(`Anchor${pairs.length > 1 ? `s (${pairs.length})` : ""}`, ...addFields(fields)),
      section(
        "Handles",
        h(
          "div",
          { class: "row btns" },
          h("button", { onclick: () => mutateAnchors((_a, s, i) => G.autoSmoothAnchor(s, i)) }, "Smooth"),
          h("button", { onclick: () => mutateAnchors((a) => { a.hIn = null; a.hOut = null; a.kind = "corner"; }) }, "Remove handles"),
        ),
        h(
          "div",
          { class: "row btns" },
          h("button", { class: "danger", onclick: () => editor.deleteSelection() }, "Delete anchor"),
          h("button", { onclick: () => store.selectNodes([]) }, "Back to shape"),
        ),
        h("p", { class: "muted" }, "Tip: Alt+drag a handle to break symmetry; Alt+drag an anchor to pull new handles out; double-click an anchor to toggle corner/smooth."),
      ),
    );
  }

  function renderDocProps() {
    const d = store.doc;
    const fields: Field[] = [
      { label: "Artboard width", kind: "number", min: 1, step: 1, get: () => d.width, set: (v) => store.mutate((doc) => (doc.width = Math.max(1, num(v, doc.width)))), half: true },
      { label: "Height", kind: "number", min: 1, step: 1, get: () => d.height, set: (v) => store.mutate((doc) => (doc.height = Math.max(1, num(v, doc.height)))) },
      { label: "Background", kind: "color", get: () => d.background, set: (v) => store.mutate((doc) => (doc.background = v)) },
    ];
    const polyFields: Field[] = [
      { label: "Polygon sides", kind: "number", min: 3, max: 64, step: 1, get: () => editor.polygonSides, set: (v) => (editor.polygonSides = Math.max(3, Math.round(num(v, 6)))), half: true },
      { label: "Star points", kind: "number", min: 3, max: 64, step: 1, get: () => editor.starPoints, set: (v) => (editor.starPoints = Math.max(3, Math.round(num(v, 5)))) },
      { label: "Star inner radius", kind: "range", min: 0.1, max: 0.95, step: 0.01, get: () => editor.starInner, set: (v) => (editor.starInner = num(v, 0.5)) },
    ];
    root.append(
      section("Artboard", ...addFields(fields), h("p", { class: "muted" }, "Select a shape to edit its properties. The artboard is just a guide: exports crop to the shapes.")),
      section("Primitive options", ...addFields(polyFields)),
      section(
        "Shortcuts",
        h("ul", { class: "shortcuts" },
          h("li", {}, h("kbd", {}, "V"), " select ", h("kbd", {}, "A"), " anchors ", h("kbd", {}, "P"), " pen"),
          h("li", {}, h("kbd", {}, "R"), " rect ", h("kbd", {}, "E"), " ellipse ", h("kbd", {}, "G"), " polygon ", h("kbd", {}, "S"), " star"),
          h("li", {}, h("kbd", {}, "Ctrl+C"), " copy for PowerPoint · ", h("kbd", {}, "Ctrl+V"), " paste"),
          h("li", {}, h("kbd", {}, "Ctrl+D"), " duplicate · ", h("kbd", {}, "Del"), " delete"),
          h("li", {}, h("kbd", {}, "Space"), "+drag pan · ", h("kbd", {}, "Ctrl"), "+wheel zoom"),
        ),
      ),
    );
  }

  store.on((ev) => (ev === "doc" || ev === "selection" || ev === "tool" || ev === "workspace") && render());
  render();
}

/* ----- layers ----- */

function buildLayersPanel(ctx: UIContext, root: HTMLElement): void {
  const { store, editor } = ctx;
  const list = h("div", { class: "layer-list" });
  const move = (dir: "up" | "down" | "top" | "bottom") => {
    const ids = store.selection;
    if (!ids.size) return;
    store.mutate((d) => {
      const sel = d.shapes.filter((s) => ids.has(s.id));
      const rest = d.shapes.filter((s) => !ids.has(s.id));
      if (dir === "top") d.shapes = [...rest, ...sel];
      else if (dir === "bottom") d.shapes = [...sel, ...rest];
      else {
        const arr = [...d.shapes];
        const idx = arr.map((s, i) => (ids.has(s.id) ? i : -1)).filter((i) => i >= 0);
        if (dir === "up") for (const i of idx.reverse()) if (i + 1 < arr.length && !ids.has(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
        if (dir === "down") for (const i of idx) if (i - 1 >= 0 && !ids.has(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
        d.shapes = arr;
      }
    });
  };
  root.append(
    h("div", { class: "panel-head" }, h("h3", {}, "Layers"),
      h("div", { class: "btns small" },
        h("button", { title: "Bring to front", onclick: () => move("top") }, "⤒"),
        h("button", { title: "Bring forward", onclick: () => move("up") }, "↑"),
        h("button", { title: "Send backward", onclick: () => move("down") }, "↓"),
        h("button", { title: "Send to back", onclick: () => move("bottom") }, "⤓"),
      )),
    list,
  );

  const render = () => {
    list.replaceChildren();
    const shapes = [...store.doc.shapes].reverse();
    if (!shapes.length) list.appendChild(h("p", { class: "muted" }, "No shapes yet. Draw with the pen or a primitive tool."));
    for (const s of shapes) {
      const name = h("span", { class: "layer-name", title: "Double-click to rename" }, s.name);
      name.addEventListener("dblclick", () => {
        const input = h("input", { type: "text", value: s.name, class: "rename" });
        name.replaceWith(input);
        input.focus();
        input.select();
        const done = () => store.mutate(() => (s.name = input.value.trim() || s.name));
        input.addEventListener("blur", done);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); if (e.key === "Escape") { input.value = s.name; input.blur(); } });
      });
      const row = h("div", { class: "layer" + (store.selection.has(s.id) ? " selected" : "") + (s.visible ? "" : " hidden") },
        h("button", { class: "icon-btn", title: s.visible ? "Hide" : "Show", onclick: (e: Event) => { e.stopPropagation(); store.mutate(() => (s.visible = !s.visible)); } }, s.visible ? "👁" : "◌"),
        h("button", { class: "icon-btn", title: s.locked ? "Unlock" : "Lock", onclick: (e: Event) => { e.stopPropagation(); store.mutate(() => (s.locked = !s.locked)); } }, s.locked ? "🔒" : "🔓"),
        h("span", { class: "swatch", style: `background:${s.fill === "none" ? "transparent" : s.fill}; border-color:${s.stroke === "none" ? "#8884" : s.stroke}` }),
        name,
        h("span", { class: "muted small" }, `${s.anchors.length}`),
      );
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        if (e.shiftKey) store.toggleSelect(s.id);
        else store.select([s.id]);
        if (store.tool !== "node" && store.tool !== "select") store.setTool("select");
      });
      row.addEventListener("dblclick", (e) => {
        if ((e.target as HTMLElement).closest(".layer-name")) return;
        const b = G.shapeBBox(s);
        if (b) editor.fitToView({ x: b.x - 20, y: b.y - 20, w: b.w + 40, h: b.h + 40 });
      });
      list.appendChild(row);
    }
  };
  store.on((ev) => (ev === "doc" || ev === "selection" || ev === "workspace") && render());
  render();
}

/* ----- library ----- */

function buildLibraryPanel(ctx: UIContext, root: HTMLElement): void {
  const { store, editor, library } = ctx;
  const grid = h("div", { class: "lib-grid" });
  const search = h("input", { type: "search", placeholder: "Search library…", class: "lib-search" });
  search.addEventListener("input", () => render());

  const libMenu = h("details", { class: "menu right" },
    h("summary", { class: "tb-btn" }, "⋯"),
    h("div", { class: "menu-items" },
      menuItem("Add selected shape(s)", "", () => {
        const sel = store.selectedShapes();
        if (!sel.length) return toast("Select a shape first.", "error");
        for (const s of sel) library.add(s);
        toast(`Added ${sel.length} to library.`);
      }),
      menuItem("Export library to file", "", () => exportLibraryFile(library.items)),
      menuItem("Import library from file…", "", async () => {
        try {
          const items = await importLibraryFile();
          if (!items) return;
          toast(`Imported ${library.merge(items)} new item(s).`);
        } catch (e) {
          toast((e as Error).message, "error");
        }
      }),
    ));
  closeMenuOnClick(libMenu);

  root.append(
    h("div", { class: "panel-head" }, h("h3", {}, "Library"), libMenu),
    search,
    grid,
  );

  const render = () => {
    grid.replaceChildren();
    const q = search.value.trim().toLowerCase();
    const items = library.items.filter((i) => !q || i.name.toLowerCase().includes(q));
    if (!items.length) {
      grid.appendChild(h("p", { class: "muted" }, library.items.length ? "No matches." : "Empty. Select a shape and click “Add to library”, or drag items from here onto the canvas later."));
      return;
    }
    for (const it of items) {
      const thumb = h("div", { class: "thumb" });
      thumb.innerHTML = it.thumb;
      const card = h("div", { class: "lib-card", draggable: true, title: "Click to insert · drag onto canvas" },
        thumb,
        h("div", { class: "lib-name" }, it.name),
        h("div", { class: "lib-actions" },
          h("button", { class: "icon-btn", title: "Rename", onclick: (e: Event) => { e.stopPropagation(); const n = prompt("Rename library item", it.name); if (n && n.trim()) library.rename(it.id, n.trim()); } }, "✎"),
          h("button", { class: "icon-btn", title: "Replace with selected shape", onclick: (e: Event) => { e.stopPropagation(); const s = store.selectedShapes()[0]; if (!s) return toast("Select a shape first.", "error"); library.update(it.id, s); toast("Library item updated."); } }, "⟳"),
          h("button", { class: "icon-btn danger", title: "Delete from library", onclick: (e: Event) => { e.stopPropagation(); if (confirm(`Delete "${it.name}" from the library?`)) library.remove(it.id); } }, "✕"),
        ),
      );
      card.addEventListener("click", () => {
        const s = editor.insertShape({ ...it.shape, name: it.name });
        toast(`Inserted "${s.name}".`);
      });
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData("application/x-vectorease-lib", it.id);
        e.dataTransfer!.effectAllowed = "copy";
      });
      grid.appendChild(card);
    }
  };
  library.on(render);
  render();

  // drop onto canvas
  const svg = editor.svg;
  svg.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("application/x-vectorease-lib")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });
  svg.addEventListener("drop", (e) => {
    const id = e.dataTransfer?.getData("application/x-vectorease-lib");
    const it = id && library.get(id);
    if (!it) return;
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    editor.insertShape({ ...it.shape, name: it.name }, editor.toDoc(e.clientX - r.left, e.clientY - r.top));
  });
}
