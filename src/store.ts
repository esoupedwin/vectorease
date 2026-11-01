import type { Doc, Shape, Tool, View, Workspace } from "./types";
import { uid } from "./ids";

export type StoreEvent = "doc" | "selection" | "tool" | "view" | "workspace" | "library";
type Listener = (ev: StoreEvent) => void;

export const DEFAULT_FILL = "#4f7cff";
export const DEFAULT_STROKE = "#1f2a44";

export function newDoc(): Doc {
  return { width: 960, height: 540, background: "#ffffff", shapes: [] };
}

export function newWorkspace(name = "Untitled workspace"): Workspace {
  const now = Date.now();
  return {
    version: 1,
    id: uid("ws"),
    name,
    doc: newDoc(),
    view: { panX: 0, panY: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  };
}

export function newShape(partial: Partial<Shape> = {}): Shape {
  return {
    id: uid("s"),
    name: "Shape",
    anchors: [],
    closed: true,
    fill: DEFAULT_FILL,
    fillOpacity: 1,
    // New shapes are created without an outline; users can add one in the Properties panel.
    stroke: "none",
    strokeWidth: 2,
    strokeOpacity: 1,
    opacity: 1,
    visible: true,
    locked: false,
    ...partial,
  };
}

const MAX_UNDO = 200;

export class Store {
  ws: Workspace;
  tool: Tool = "select";
  /** Selected shape ids. */
  selection = new Set<string>();
  /** Selected anchor ids (node tool). */
  nodeSelection = new Set<string>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<Listener>();
  private dragSnapshot: string | null = null;

  constructor(ws: Workspace) {
    this.ws = ws;
  }

  get doc(): Doc {
    return this.ws.doc;
  }
  get view(): View {
    return this.ws.view;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(ev: StoreEvent): void {
    for (const l of this.listeners) l(ev);
  }

  /* ---------- undo ---------- */

  private snapshot(): string {
    return JSON.stringify(this.ws.doc);
  }
  private restore(json: string): void {
    this.ws.doc = JSON.parse(json);
    const ids = new Set(this.ws.doc.shapes.map((s) => s.id));
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
    const anchorIds = new Set(this.ws.doc.shapes.flatMap((s) => s.anchors.map((a) => a.id)));
    for (const id of [...this.nodeSelection]) if (!anchorIds.has(id)) this.nodeSelection.delete(id);
  }

  /** Perform a mutation as one undoable step. */
  mutate(fn: (doc: Doc) => void): void {
    this.pushUndo(this.snapshot());
    fn(this.ws.doc);
    this.touch();
  }

  private pushUndo(snap: string): void {
    this.undoStack.push(snap);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Start a continuous (drag) mutation. Call `touch()` while dragging, then `endDrag()` or `cancelDrag()`. */
  beginDrag(): void {
    this.dragSnapshot = this.snapshot();
  }
  endDrag(): void {
    if (this.dragSnapshot !== null) {
      if (this.dragSnapshot !== this.snapshot()) this.pushUndo(this.dragSnapshot);
      this.dragSnapshot = null;
    }
    this.touch();
  }
  cancelDrag(): void {
    if (this.dragSnapshot !== null) {
      this.restore(this.dragSnapshot);
      this.dragSnapshot = null;
    }
    this.touch();
  }

  /** Mark the document dirty and notify. */
  touch(): void {
    this.ws.updatedAt = Date.now();
    this.emit("doc");
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  undo(): void {
    const s = this.undoStack.pop();
    if (s === undefined) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
    this.touch();
    this.emit("selection");
  }
  redo(): void {
    const s = this.redoStack.pop();
    if (s === undefined) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
    this.touch();
    this.emit("selection");
  }

  /* ---------- selection ---------- */

  select(ids: Iterable<string>, additive = false): void {
    if (!additive) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.nodeSelection.clear();
    this.emit("selection");
  }
  toggleSelect(id: string): void {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.emit("selection");
  }
  clearSelection(): void {
    this.selection.clear();
    this.nodeSelection.clear();
    this.emit("selection");
  }
  selectNodes(ids: Iterable<string>, additive = false): void {
    if (!additive) this.nodeSelection.clear();
    for (const id of ids) this.nodeSelection.add(id);
    this.emit("selection");
  }
  toggleNode(id: string): void {
    if (this.nodeSelection.has(id)) this.nodeSelection.delete(id);
    else this.nodeSelection.add(id);
    this.emit("selection");
  }

  selectedShapes(): Shape[] {
    return this.ws.doc.shapes.filter((s) => this.selection.has(s.id));
  }
  shapeById(id: string): Shape | undefined {
    return this.ws.doc.shapes.find((s) => s.id === id);
  }

  /* ---------- tool / view ---------- */

  setTool(t: Tool): void {
    if (this.tool === t) return;
    this.tool = t;
    if (t !== "node") this.nodeSelection.clear();
    this.emit("tool");
  }
  setView(partial: Partial<View>): void {
    Object.assign(this.ws.view, partial);
    this.emit("view");
  }

  /* ---------- workspace ---------- */

  loadWorkspace(ws: Workspace): void {
    this.ws = ws;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.selection.clear();
    this.nodeSelection.clear();
    this.emit("workspace");
    this.emit("doc");
    this.emit("selection");
    this.emit("view");
  }
}
