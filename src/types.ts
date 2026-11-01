export interface Vec {
  x: number;
  y: number;
}

/** How an anchor's two handles relate to each other. */
export type AnchorKind = "corner" | "smooth" | "symmetric";

export interface Anchor {
  id: string;
  /** Anchor position in document coordinates. */
  p: Vec;
  /** Incoming handle, relative to `p`. null = no handle (straight segment ends here). */
  hIn: Vec | null;
  /** Outgoing handle, relative to `p`. null = no handle (straight segment starts here). */
  hOut: Vec | null;
  kind: AnchorKind;
}

export interface Shape {
  id: string;
  name: string;
  anchors: Anchor[];
  closed: boolean;
  fill: string; // hex or "none"
  fillOpacity: number; // 0..1
  stroke: string; // hex or "none"
  strokeWidth: number;
  strokeOpacity: number; // 0..1
  opacity: number; // 0..1
  visible: boolean;
  locked: boolean;
}

export interface Doc {
  width: number;
  height: number;
  background: string;
  shapes: Shape[];
}

export interface View {
  panX: number;
  panY: number;
  zoom: number;
}

export interface Workspace {
  version: 1;
  id: string;
  name: string;
  doc: Doc;
  view: View;
  createdAt: number;
  updatedAt: number;
}

export interface LibraryItem {
  id: string;
  name: string;
  shape: Shape;
  thumb: string; // svg markup
  createdAt: number;
}

export type Tool = "select" | "node" | "pen" | "rect" | "ellipse" | "polygon" | "star";

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
