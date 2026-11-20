(() => {
  const viewport = document.querySelector('[data-testid="preview-viewport"]').getBoundingClientRect();
  const pane = document.querySelector('[data-testid="preview"]').getBoundingClientRect();
  const editor = document.querySelector(".editor-pane").getBoundingClientRect();
  const canvas = document.querySelector('[data-testid="preview-canvas"]');
  const svg = canvas && canvas.querySelector("svg");
  const box = svg && svg.getBoundingClientRect();
  const saveState = (document.querySelector('[data-testid="save-state"]') || {}).textContent || "";
  return {
    hasSvg: Boolean(svg),
    clean: !saveState.includes("Unsaved changes"),
    saveState,
    zoom: (document.querySelector('[data-testid="zoom-value"]') || {}).textContent,
    editorWidth: editor.width,
    previewWidth: pane.width,
    offsetX: box ? box.x + box.width / 2 - (viewport.x + viewport.width / 2) : 999,
    offsetY: box ? box.y + box.height / 2 - (viewport.y + viewport.height / 2) : 999,
    svgFits: box ? box.width <= viewport.width && box.height <= viewport.height : false,
  };
})()
