const textItems = [];
let selectedId = null;
let addMode = false;
let getScale = () => 1;
let getPageInfo = () => null;
let onSelectionChanged = () => {};
let onModeChanged = () => {};
let onItemsChanged = () => {};
const viewportMeta = document.querySelector('meta[name="viewport"]');
const defaultViewportContent = viewportMeta?.getAttribute("content") || "width=device-width, initial-scale=1";
let mobileViewportLocked = false;
let viewportRestoreTimer = null;

export function configureTextLayer(options) {
  getScale = options.getScale;
  getPageInfo = options.getPageInfo;
  onSelectionChanged = options.onSelectionChanged || onSelectionChanged;
  onModeChanged = options.onModeChanged || onModeChanged;
  onItemsChanged = options.onItemsChanged || onItemsChanged;
}

export function clearTextItems() {
  textItems.length = 0;
  selectedId = null;
  addMode = false;
  onSelectionChanged(null);
  onModeChanged(false);
  onItemsChanged(textItems);
}

export function getTextItems() {
  return textItems.map((item) => ({ ...item }));
}

export function getSelectedItem() {
  const item = textItems.find((entry) => entry.id === selectedId);
  return item ? { ...item } : null;
}

export function setAddMode(enabled) {
  addMode = Boolean(enabled);
  document.querySelectorAll(".text-edit-layer").forEach((layer) => {
    layer.classList.toggle("add-mode", addMode);
  });
  onModeChanged(addMode);
}

export function isAddMode() { return addMode; }

export function mountTextLayer(layer, pageIndex) {
  layer.classList.toggle("add-mode", addMode);
  layer.addEventListener("pointerdown", (event) => {
    if (event.target !== layer || !addMode) return;
    const rect = layer.getBoundingClientRect();
    const scale = getScale();
    const page = getPageInfo(pageIndex);
    if (!page) return;

    const x = Math.max(0, Math.min((event.clientX - rect.left) / scale, page.pdfWidth - 40));
    const y = Math.max(0, Math.min((event.clientY - rect.top) / scale, page.pdfHeight - 20));
    const item = {
      id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      pageIndex,
      text: "テキストを入力",
      x,
      y,
      width: Math.min(180, Math.max(90, page.pdfWidth - x)),
      fontSize: 16,
      color: "#172033",
      bold: false,
      align: "left"
    };
    textItems.push(item);
    selectedId = item.id;
    setAddMode(false);
    renderPageItems(layer, pageIndex);
    onSelectionChanged({ ...item });
    onItemsChanged(textItems);

    requestAnimationFrame(() => {
      const editable = layer.querySelector(`[data-item-id="${item.id}"] .text-box-content`);
      if (!editable) return;
      editable.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editable);
      selection.removeAllRanges();
      selection.addRange(range);
    });
  });

  renderPageItems(layer, pageIndex);
}

function renderPageItems(layer, pageIndex) {
  layer.querySelectorAll(".text-box").forEach((element) => element.remove());
  textItems.filter((item) => item.pageIndex === pageIndex).forEach((item) => {
    layer.append(createTextBox(item));
  });
}

function createTextBox(item) {
  const scale = getScale();
  const box = document.createElement("div");
  box.className = `text-box${item.id === selectedId ? " selected" : ""}`;
  box.dataset.itemId = item.id;
  box.style.left = `${item.x * scale}px`;
  box.style.top = `${item.y * scale}px`;
  box.style.width = `${item.width * scale}px`;
  box.style.fontSize = `${item.fontSize * scale}px`;
  box.style.color = item.color;
  box.style.fontWeight = item.bold ? "700" : "400";
  box.style.textAlign = item.align;

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "drag-handle";
  handle.textContent = "移動";
  handle.setAttribute("aria-label", "テキストを移動");

  const editable = document.createElement("div");
  editable.className = "text-box-content";
  editable.contentEditable = "true";
  editable.spellcheck = false;
  editable.setAttribute("role", "textbox");
  editable.setAttribute("aria-label", "追記テキスト");
  editable.textContent = item.text;

  box.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    selectItem(item.id);
    if (event.pointerType === "mouse" && event.button === 0 && !event.target.closest(".drag-handle")) {
      startDirectDragging(event, item, box, editable);
    }
  });
  editable.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse") lockMobileViewport();
  });
  editable.addEventListener("focus", lockMobileViewport);
  editable.addEventListener("blur", restoreMobileViewport);
  editable.addEventListener("input", () => {
    item.text = editable.innerText.replace(/\r/g, "");
    onItemsChanged(textItems);
  });
  editable.addEventListener("keydown", (event) => {
    if (event.key === "Escape") editable.blur();
  });
  handle.addEventListener("pointerdown", (event) => startDragging(event, item, box));

  box.append(handle, editable);
  return box;
}

function lockMobileViewport() {
  const isMobile = window.matchMedia("(max-width: 760px)").matches &&
    window.matchMedia("(pointer: coarse)").matches;
  if (!isMobile || !viewportMeta) return;
  clearTimeout(viewportRestoreTimer);
  viewportMeta.setAttribute(
    "content",
    "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
  );
  mobileViewportLocked = true;
}

function restoreMobileViewport() {
  if (!mobileViewportLocked || !viewportMeta) return;
  clearTimeout(viewportRestoreTimer);
  viewportMeta.setAttribute(
    "content",
    "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"
  );
  viewportRestoreTimer = window.setTimeout(() => {
    viewportMeta.setAttribute("content", defaultViewportContent);
    mobileViewportLocked = false;
  }, 320);
}

function startDirectDragging(event, item, box, editable) {
  const startX = event.clientX;
  const startY = event.clientY;
  const originX = item.x;
  const originY = item.y;
  const page = getPageInfo(item.pageIndex);
  const pointerId = event.pointerId;
  let dragging = false;

  const move = (moveEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    const deltaX = moveEvent.clientX - startX;
    const deltaY = moveEvent.clientY - startY;
    if (!dragging && Math.hypot(deltaX, deltaY) < 4) return;

    if (!dragging) {
      dragging = true;
      box.classList.add("dragging");
      editable.contentEditable = "false";
      window.getSelection()?.removeAllRanges();
    }

    moveEvent.preventDefault();
    const scale = getScale();
    item.x = Math.max(0, Math.min(originX + deltaX / scale, page.pdfWidth - item.width));
    item.y = Math.max(0, Math.min(originY + deltaY / scale, page.pdfHeight - item.fontSize * 1.4));
    box.style.left = `${item.x * scale}px`;
    box.style.top = `${item.y * scale}px`;
  };

  const end = (endEvent) => {
    if (endEvent.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);

    if (!dragging) return;
    endEvent.preventDefault();
    box.classList.remove("dragging");
    editable.contentEditable = "true";
    onSelectionChanged({ ...item });
    onItemsChanged(textItems);
  };

  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

function startDragging(event, item, box) {
  event.preventDefault();
  event.stopPropagation();
  selectItem(item.id);
  const startX = event.clientX;
  const startY = event.clientY;
  const originX = item.x;
  const originY = item.y;
  const page = getPageInfo(item.pageIndex);
  const pointerId = event.pointerId;
  event.currentTarget.setPointerCapture(pointerId);

  const move = (moveEvent) => {
    const scale = getScale();
    item.x = Math.max(0, Math.min(originX + (moveEvent.clientX - startX) / scale, page.pdfWidth - item.width));
    item.y = Math.max(0, Math.min(originY + (moveEvent.clientY - startY) / scale, page.pdfHeight - item.fontSize * 1.4));
    box.style.left = `${item.x * scale}px`;
    box.style.top = `${item.y * scale}px`;
  };
  const end = () => {
    event.currentTarget.removeEventListener("pointermove", move);
    event.currentTarget.removeEventListener("pointerup", end);
    event.currentTarget.removeEventListener("pointercancel", end);
    onSelectionChanged({ ...item });
    onItemsChanged(textItems);
  };

  event.currentTarget.addEventListener("pointermove", move);
  event.currentTarget.addEventListener("pointerup", end);
  event.currentTarget.addEventListener("pointercancel", end);
}

export function selectItem(id) {
  selectedId = textItems.some((item) => item.id === id) ? id : null;
  document.querySelectorAll(".text-box").forEach((box) => {
    box.classList.toggle("selected", box.dataset.itemId === selectedId);
  });
  onSelectionChanged(getSelectedItem());
}

export function updateSelectedItem(patch) {
  const item = textItems.find((entry) => entry.id === selectedId);
  if (!item) return;
  Object.assign(item, patch);
  const layer = document.querySelector(`.text-edit-layer[data-page-index="${item.pageIndex}"]`);
  if (layer) renderPageItems(layer, item.pageIndex);
  onSelectionChanged({ ...item });
  onItemsChanged(textItems);
}

export function deleteSelectedItem() {
  const index = textItems.findIndex((item) => item.id === selectedId);
  if (index < 0) return false;
  const [removed] = textItems.splice(index, 1);
  selectedId = null;
  const layer = document.querySelector(`.text-edit-layer[data-page-index="${removed.pageIndex}"]`);
  if (layer) renderPageItems(layer, removed.pageIndex);
  onSelectionChanged(null);
  onItemsChanged(textItems);
  return true;
}
