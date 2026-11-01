import type { LibraryItem, Shape, Workspace } from "./types";
import { newWorkspace } from "./store";
import { uid } from "./ids";

const KEY_INDEX = "vectorease.workspaces";
const KEY_CURRENT = "vectorease.current";
const KEY_WS = (id: string) => `vectorease.ws.${id}`;
const KEY_LIB = "vectorease.library";

export interface WorkspaceMeta {
  id: string;
  name: string;
  updatedAt: number;
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("localStorage write failed", e);
  }
}

/* ---------- workspaces ---------- */

export function listWorkspaces(): WorkspaceMeta[] {
  return readJSON<WorkspaceMeta[]>(KEY_INDEX, []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveWorkspace(ws: Workspace): void {
  writeJSON(KEY_WS(ws.id), ws);
  const idx = listWorkspaces().filter((m) => m.id !== ws.id);
  idx.push({ id: ws.id, name: ws.name, updatedAt: ws.updatedAt });
  writeJSON(KEY_INDEX, idx);
  localStorage.setItem(KEY_CURRENT, ws.id);
}

export function loadWorkspaceById(id: string): Workspace | null {
  const ws = readJSON<Workspace | null>(KEY_WS(id), null);
  return ws && isWorkspace(ws) ? ws : null;
}

export function deleteWorkspace(id: string): void {
  localStorage.removeItem(KEY_WS(id));
  writeJSON(
    KEY_INDEX,
    listWorkspaces().filter((m) => m.id !== id),
  );
}

export function loadCurrentWorkspace(): Workspace {
  const cur = localStorage.getItem(KEY_CURRENT);
  if (cur) {
    const ws = loadWorkspaceById(cur);
    if (ws) return ws;
  }
  const list = listWorkspaces();
  for (const m of list) {
    const ws = loadWorkspaceById(m.id);
    if (ws) return ws;
  }
  const ws = newWorkspace();
  saveWorkspace(ws);
  return ws;
}

export function isWorkspace(x: unknown): x is Workspace {
  if (!x || typeof x !== "object") return false;
  const w = x as Partial<Workspace>;
  return w.version === 1 && typeof w.id === "string" && !!w.doc && Array.isArray(w.doc.shapes) && !!w.view;
}

/* ---------- file export / import ---------- */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFilename(name: string): string {
  return name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "untitled";
}

export function exportWorkspaceFile(ws: Workspace): void {
  const blob = new Blob([JSON.stringify(ws, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${safeFilename(ws.name)}.vectorease.json`);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function importWorkspaceFile(): Promise<Workspace | null> {
  const file = await pickFile(".json,application/json");
  if (!file) return null;
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!isWorkspace(parsed)) throw new Error("Not a VectorEase workspace file.");
  // Give it a fresh id if one with the same id already exists, so imports never clobber.
  if (loadWorkspaceById(parsed.id)) parsed.id = uid("ws");
  return parsed;
}

/* ---------- library ---------- */

export function loadLibrary(): LibraryItem[] {
  return readJSON<LibraryItem[]>(KEY_LIB, []);
}
export function saveLibrary(items: LibraryItem[]): void {
  writeJSON(KEY_LIB, items);
}
export function exportLibraryFile(items: LibraryItem[]): void {
  const blob = new Blob([JSON.stringify({ version: 1, items }, null, 2)], { type: "application/json" });
  downloadBlob(blob, "vectorease-library.json");
}
export async function importLibraryFile(): Promise<LibraryItem[] | null> {
  const file = await pickFile(".json,application/json");
  if (!file) return null;
  const parsed = JSON.parse(await file.text());
  const items: unknown = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(items)) throw new Error("Not a VectorEase library file.");
  return items.filter((it): it is LibraryItem => !!it && typeof it === "object" && Array.isArray((it as LibraryItem).shape?.anchors));
}

export function isShape(x: unknown): x is Shape {
  return !!x && typeof x === "object" && Array.isArray((x as Shape).anchors);
}
