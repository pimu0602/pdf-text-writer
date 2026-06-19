import {
  configurePdfViewer,
  loadPdf,
  setZoom,
  rotateClockwise,
  getScale,
  getPageInfo,
  getAllPageInfo,
  getOriginalPdfBytes,
  getOriginalFileName,
  hasPdf
} from "./pdf-viewer.js";
import {
  configureTextLayer,
  clearTextItems,
  getTextItems,
  getSelectedItem,
  setAddMode,
  isAddMode,
  mountTextLayer,
  updateSelectedItem,
  rotateTextItemsClockwise,
  lockMobileViewport,
  restoreMobileViewport,
  deleteSelectedItem
} from "./text-layer.js";
import { exportPdf } from "./pdf-export.js";

const elements = {
  viewer: document.querySelector("#viewer"),
  workspace: document.querySelector(".workspace"),
  fileInput: document.querySelector("#pdfFileInput"),
  save: document.querySelector("#saveButton"),
  add: document.querySelector("#addTextButton"),
  fontSize: document.querySelector("#fontSizeInput"),
  color: document.querySelector("#fontColorInput"),
  colorValue: document.querySelector("#colorValue"),
  bold: document.querySelector("#boldButton"),
  align: document.querySelector("#alignSelect"),
  remove: document.querySelector("#deleteButton"),
  rotate: document.querySelector("#rotateButton"),
  zoomOut: document.querySelector("#zoomOutButton"),
  zoomIn: document.querySelector("#zoomInButton"),
  zoomValue: document.querySelector("#zoomValue"),
  pageCount: document.querySelector("#pageCount"),
  fileName: document.querySelector("#fileName"),
  status: document.querySelector("#statusMessage"),
  toast: document.querySelector("#toast"),
  mobileAdd: document.querySelector("#mobileAddButton"),
  mobileSize: document.querySelector("#mobileFontSizeInput"),
  mobileSizeControl: document.querySelector(".mobile-size-control"),
  mobileColorLabel: document.querySelector("#mobileColorLabel"),
  mobileColor: document.querySelector("#mobileColorInput"),
  mobileRotate: document.querySelector("#mobileRotateButton"),
  mobileDelete: document.querySelector("#mobileDeleteButton")
};

let toastTimer = null;
let isBusy = false;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2400);
}

function setStatus(message, error = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", error);
}

function updateZoomLabel() {
  elements.zoomValue.value = `${Math.round(getScale() * 100)}%`;
  elements.zoomValue.textContent = elements.zoomValue.value;
}

function syncMode(enabled) {
  elements.add.setAttribute("aria-pressed", String(enabled));
  elements.mobileAdd.setAttribute("aria-pressed", String(enabled));
  if (enabled) setStatus("PDF上の文字を置きたい場所をクリックしてください");
  else if (hasPdf() && !isBusy) setStatus("テキストを選ぶと、内容や見た目を編集できます");
}

function syncSelection(item) {
  const enabled = Boolean(item) && !isBusy;
  elements.fontSize.disabled = !enabled;
  elements.color.disabled = !enabled;
  elements.bold.disabled = !enabled;
  elements.align.disabled = !enabled;
  elements.remove.disabled = !enabled;
  elements.mobileSize.disabled = !enabled;
  elements.mobileSizeControl.setAttribute("aria-disabled", String(!enabled));
  elements.mobileColor.disabled = !enabled;
  elements.mobileColorLabel.setAttribute("aria-disabled", String(!enabled));
  elements.mobileDelete.disabled = !enabled;

  if (!item) return;
  elements.fontSize.value = String(item.fontSize);
  elements.mobileSize.value = String(item.fontSize);
  elements.color.value = item.color;
  elements.mobileColor.value = item.color;
  elements.colorValue.textContent = item.color.toUpperCase();
  elements.mobileColorLabel.querySelector("span").style.background = item.color;
  elements.bold.setAttribute("aria-pressed", String(item.bold));
  elements.align.value = item.align;
}

function setDocumentControls(enabled) {
  elements.save.disabled = !enabled || isBusy;
  elements.add.disabled = !enabled || isBusy;
  elements.zoomIn.disabled = !enabled || isBusy;
  elements.zoomOut.disabled = !enabled || isBusy;
  elements.rotate.disabled = !enabled || isBusy;
  elements.mobileAdd.disabled = !enabled || isBusy;
  elements.mobileRotate.disabled = !enabled || isBusy;
  syncSelection(getSelectedItem());
}

configurePdfViewer(elements.viewer);
configureTextLayer({
  getScale,
  getPageInfo,
  onSelectionChanged: syncSelection,
  onModeChanged: syncMode
});

elements.fileInput.addEventListener("change", async () => {
  const file = elements.fileInput.files?.[0];
  if (!file) return;
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showToast("PDFファイルを選択してください");
    return;
  }

  isBusy = true;
  clearTextItems();
  setDocumentControls(false);
  elements.fileName.textContent = file.name;
  elements.viewer.innerHTML = '<div class="loading-overlay"><span>PDFを読み込んでいます…</span></div>';
  setStatus("PDFを読み込んでいます…");

  try {
    const result = await loadPdf(await file.arrayBuffer(), file.name, mountTextLayer);
    elements.workspace.classList.add("has-pdf");
    elements.pageCount.textContent = `${result.pageCount}ページ`;
    updateZoomLabel();
    setStatus("「テキストを追加」を押して、PDF上をクリックしてください");
    showToast("PDFを読み込みました");
  } catch (error) {
    console.error(error);
    elements.workspace.classList.remove("has-pdf");
    elements.pageCount.textContent = "読込エラー";
    elements.viewer.innerHTML = `<div class="empty-state"><h2>PDFを開けませんでした</h2><p>破損またはパスワード保護されていないか確認してください。</p></div>`;
    setStatus(error.message || "PDFを読み込めませんでした", true);
  } finally {
    isBusy = false;
    setDocumentControls(hasPdf());
    elements.fileInput.value = "";
  }
});

function toggleAddMode() {
  if (!hasPdf() || isBusy) return;
  setAddMode(!isAddMode());
}
elements.add.addEventListener("click", toggleAddMode);
elements.mobileAdd.addEventListener("click", toggleAddMode);

function updateFontSize(value) {
  const size = Math.min(120, Math.max(6, Number(value) || 16));
  elements.fontSize.value = String(size);
  elements.mobileSize.value = String(size);
  updateSelectedItem({ fontSize: size });
}
elements.fontSize.addEventListener("change", () => updateFontSize(elements.fontSize.value));
elements.mobileSize.addEventListener("change", () => updateFontSize(elements.mobileSize.value));

function updateColor(value) {
  elements.color.value = value;
  elements.mobileColor.value = value;
  elements.colorValue.textContent = value.toUpperCase();
  elements.mobileColorLabel.querySelector("span").style.background = value;
  updateSelectedItem({ color: value });
}
elements.color.addEventListener("input", () => updateColor(elements.color.value));
elements.mobileColor.addEventListener("input", () => {
  updateColor(elements.mobileColor.value);
  restoreMobileViewport();
});
elements.mobileColor.addEventListener("change", restoreMobileViewport);
elements.mobileColor.addEventListener("blur", restoreMobileViewport);
elements.mobileColor.addEventListener("focus", lockMobileViewport);
elements.mobileColorLabel.addEventListener("pointerdown", lockMobileViewport);
window.addEventListener("focus", restoreMobileViewport);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) restoreMobileViewport();
});

elements.bold.addEventListener("click", () => {
  const item = getSelectedItem();
  if (item) updateSelectedItem({ bold: !item.bold });
});
elements.align.addEventListener("change", () => updateSelectedItem({ align: elements.align.value }));

function removeSelected() {
  if (deleteSelectedItem()) showToast("テキストを削除しました");
}
elements.remove.addEventListener("click", removeSelected);
elements.mobileDelete.addEventListener("click", removeSelected);

async function changeZoom(delta) {
  if (isBusy || !hasPdf()) return;
  isBusy = true;
  setDocumentControls(false);
  setStatus("表示サイズを変更しています…");
  try {
    await setZoom(getScale() + delta);
    updateZoomLabel();
    setStatus("表示サイズを変更しました");
  } finally {
    isBusy = false;
    setDocumentControls(true);
  }
}
elements.zoomIn.addEventListener("click", () => changeZoom(0.15));
elements.zoomOut.addEventListener("click", () => changeZoom(-0.15));

async function rotatePdf() {
  if (isBusy || !hasPdf()) return;
  isBusy = true;
  setDocumentControls(false);
  setStatus("PDFを右へ90度回転しています…");
  try {
    rotateTextItemsClockwise(getAllPageInfo());
    await rotateClockwise();
    setStatus("PDFを右へ90度回転しました");
    showToast("全ページを右へ90度回転しました");
  } finally {
    isBusy = false;
    setDocumentControls(true);
  }
}
elements.rotate.addEventListener("click", rotatePdf);
elements.mobileRotate.addEventListener("click", rotatePdf);

elements.save.addEventListener("click", async () => {
  if (isBusy || !hasPdf()) return;
  isBusy = true;
  setDocumentControls(false);
  try {
    await exportPdf({
      sourceBytes: getOriginalPdfBytes(),
      textItems: getTextItems(),
      pageInfoList: getAllPageInfo(),
      fileName: getOriginalFileName(),
      onProgress: setStatus
    });
    setStatus("PDFを保存しました");
    showToast("透かしなしのPDFを保存しました");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "PDFを保存できませんでした", true);
    showToast("PDFを保存できませんでした");
  } finally {
    isBusy = false;
    setDocumentControls(true);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  const active = document.activeElement;
  const isEditing = active?.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(active?.tagName);
  if (!isEditing && getSelectedItem()) {
    event.preventDefault();
    removeSelected();
  }
});

document.documentElement.dataset.appReady = "true";
