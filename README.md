# VectorEase

A browser-based workspace for creating, editing and organising 2D vector shapes, with first-class export to PowerPoint.

- **Bézier editing**: anchors with in/out handles; corner, smooth and symmetric anchor types; insert/delete anchors; pull handles out of corners.
- **Tools**: select/move/scale, anchor editing, pen, rectangle, ellipse, polygon, star.
- **Shape library**: save any shape, insert it by click or drag-and-drop, rename/replace/delete, import/export the library as JSON.
- **Workspaces**: every shape and setting autosaves to the browser; create, switch, duplicate and delete workspaces; save/open them as `.vectorease.json` files.
- **PowerPoint / Office**:
  - **Ctrl+C** (or Export → *Copy for PowerPoint / Office*) puts the selection on the clipboard as PNG, HTML (with inline SVG) and SVG text. Paste into PowerPoint with Ctrl+V.
  - **Export → Download as PowerPoint (.pptx)** writes a real slide where every shape is a native PowerPoint *freeform* (DrawingML `custGeom`). Open it, copy the shapes into any deck, and edit them with *Edit Points*. Fill, stroke, opacity and curve geometry are preserved.
  - SVG and PNG downloads are also available.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static bundle in dist/
```

No backend is required. Data lives in `localStorage`; use *Workspace → Save workspace to file* for backups or to move between machines.

## Shortcuts

| Key | Action |
| --- | --- |
| V / A / P | Select · Edit anchors · Pen |
| R / E / G / S | Rectangle · Ellipse · Polygon · Star |
| Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+D | Copy for Office · Paste · Cut · Duplicate |
| Ctrl+Z / Ctrl+Shift+Z | Undo / Redo |
| Delete | Delete shapes (or selected anchors in the anchor tool) |
| Arrows (+Shift) | Nudge 1 px (10 px) |
| Space+drag, middle mouse | Pan |
| Ctrl+wheel, Ctrl+0, Ctrl+1 | Zoom · Fit · 100% |
| Esc / Enter | Finish pen path, clear selection |

Anchor tool: drag anchors and handles; **Alt+drag a handle** breaks symmetry; **Alt+drag an anchor** pulls new handles out; **double-click an anchor** toggles corner/smooth; **click a segment** of a selected shape to insert an anchor.

## Structure

```
src/
  types.ts        data model (Shape, Anchor, Workspace, LibraryItem)
  geom.ts         Bézier math: path data, bounds, split, transforms, primitives
  store.ts        document state, selection, undo/redo
  editor.ts       SVG canvas, tools and pointer/keyboard interaction
  ui.ts           top bar, tool palette, properties/layers/library panels
  library.ts      shape library model
  persistence.ts  localStorage workspaces + library, file import/export
  export/svg.ts   SVG serialisation and thumbnails
  export/raster.ts PNG rendering and clipboard writing
  export/pptx.ts  .pptx writer with native freeform shapes
```
