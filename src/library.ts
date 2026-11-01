import type { LibraryItem, Shape } from "./types";
import { uid } from "./ids";
import { cloneShape, shapeBBox, translateShape } from "./geom";
import { loadLibrary, saveLibrary } from "./persistence";
import { shapeThumbnail } from "./export/svg";

export class Library {
  items: LibraryItem[] = loadLibrary();
  private listeners = new Set<() => void>();

  on(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed(): void {
    saveLibrary(this.items);
    for (const l of this.listeners) l();
  }

  add(shape: Shape, name?: string): LibraryItem {
    // Store shapes normalised to the origin so insertion is position independent.
    const s = cloneShape(shape, false);
    const b = shapeBBox(s);
    if (b) translateShape(s, -b.x, -b.y);
    s.visible = true;
    s.locked = false;
    const item: LibraryItem = { id: uid("lib"), name: name ?? shape.name, shape: s, thumb: shapeThumbnail(s), createdAt: Date.now() };
    this.items.unshift(item);
    this.changed();
    return item;
  }
  remove(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
    this.changed();
  }
  rename(id: string, name: string): void {
    const it = this.items.find((i) => i.id === id);
    if (it) {
      it.name = name;
      this.changed();
    }
  }
  /** Replace the stored shape of an item with a new one (keeps name). */
  update(id: string, shape: Shape): void {
    const it = this.items.find((i) => i.id === id);
    if (!it) return;
    const s = cloneShape(shape, false);
    const b = shapeBBox(s);
    if (b) translateShape(s, -b.x, -b.y);
    it.shape = s;
    it.thumb = shapeThumbnail(s);
    this.changed();
  }
  merge(items: LibraryItem[]): number {
    const existing = new Set(this.items.map((i) => i.id));
    let n = 0;
    for (const it of items) {
      if (existing.has(it.id)) continue;
      this.items.push({ ...it, thumb: it.thumb || shapeThumbnail(it.shape) });
      n++;
    }
    this.changed();
    return n;
  }
  get(id: string): LibraryItem | undefined {
    return this.items.find((i) => i.id === id);
  }
}
