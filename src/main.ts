import "./style.css";
import { Store } from "./store";
import { Editor } from "./editor";
import { Library } from "./library";
import { loadCurrentWorkspace, saveWorkspace } from "./persistence";
import { buildUI, copyOffice, toast } from "./ui";

const store = new Store(loadCurrentWorkspace());
const library = new Library();
const host = document.getElementById("canvas-host")!;
const editor = new Editor(host, store, { onToast: toast });

buildUI({ store, editor, library });

// Fit the artboard on first load if the view was never set.
if (store.view.zoom === 1 && store.view.panX === 0 && store.view.panY === 0) editor.fitToView();

/* System clipboard integration: Ctrl+C puts the selection on the OS clipboard in Office-friendly
   formats (and in the internal clipboard); Ctrl+V pastes the internal copy; Ctrl+X cuts. */
function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}
window.addEventListener("keydown", (e) => {
  if (typing(e) || !(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === "c") {
    if (store.selection.size === 0) return;
    e.preventDefault();
    editor.copySelectionInternal();
    void copyOffice({ store, editor, library });
  } else if (k === "x") {
    if (store.selection.size === 0) return;
    e.preventDefault();
    editor.copySelectionInternal();
    void copyOffice({ store, editor, library }).then(() => editor.deleteSelection());
  } else if (k === "v") {
    e.preventDefault();
    editor.pasteInternal();
  }
});

window.addEventListener("beforeunload", () => saveWorkspace(store.ws));
