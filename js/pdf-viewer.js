const PDFJS_VERSION = "3.11.174";

let pdfDocument = null;
let originalPdfBytes = null;
let originalFileName = "document.pdf";
let currentScale = 1;
let pageInfo = [];
let pageRotations = [];
let viewerElement = null;
let renderLayerCallback = null;
let activeRenderId = 0;

export function configurePdfViewer(viewer) {
  viewerElement = viewer;
  if (!window.pdfjsLib) {
    throw new Error("PDF表示ライブラリを読み込めませんでした。インターネット接続を確認してください。");
  }
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
}

export async function loadPdf(arrayBuffer, fileName, onRenderLayer) {
  if (!viewerElement) throw new Error("PDFビューアーが初期化されていません。");

  renderLayerCallback = onRenderLayer;
  originalFileName = fileName || "document.pdf";
  originalPdfBytes = arrayBuffer.slice(0);

  const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) });
  pdfDocument = await loadingTask.promise;
  pageRotations = Array(pdfDocument.numPages).fill(0);

  const firstPage = await pdfDocument.getPage(1);
  const baseViewport = firstPage.getViewport({ scale: 1 });
  const usableWidth = Math.max(280, viewerElement.clientWidth - (window.innerWidth <= 760 ? 28 : 90));
  currentScale = Math.min(1.35, Math.max(0.45, usableWidth / baseViewport.width));

  await renderPdfPages();
  return { pageCount: pdfDocument.numPages, scale: currentScale };
}

export async function renderPdfPages() {
  if (!pdfDocument || !viewerElement) return;
  const renderId = ++activeRenderId;
  viewerElement.innerHTML = '<div class="loading-overlay"><span>PDFを表示しています…</span></div>';

  const pagesRoot = document.createElement("div");
  pagesRoot.className = "pdf-pages";
  const nextPageInfo = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    if (renderId !== activeRenderId) return;

    const page = await pdfDocument.getPage(pageNumber);
    const rotationDelta = pageRotations[pageNumber - 1] || 0;
    const rotation = ((page.rotate + rotationDelta) % 360 + 360) % 360;
    const baseViewport = page.getViewport({ scale: 1, rotation });
    const viewport = page.getViewport({ scale: currentScale, rotation });
    const rawWidth = Math.abs(page.view[2] - page.view[0]);
    const rawHeight = Math.abs(page.view[3] - page.view[1]);
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);

    const shell = document.createElement("article");
    shell.className = "pdf-page-shell";
    shell.dataset.pageIndex = String(pageNumber - 1);
    shell.style.width = `${viewport.width}px`;
    shell.style.height = `${viewport.height}px`;

    const label = document.createElement("span");
    label.className = "page-label";
    label.textContent = `PAGE ${pageNumber}`;

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const layer = document.createElement("div");
    layer.className = "text-edit-layer";
    layer.dataset.pageIndex = String(pageNumber - 1);
    layer.style.width = `${viewport.width}px`;
    layer.style.height = `${viewport.height}px`;

    shell.append(label, canvas, layer);
    pagesRoot.append(shell);

    const context = canvas.getContext("2d", { alpha: false });
    await page.render({
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
    }).promise;

    nextPageInfo.push({
      pageIndex: pageNumber - 1,
      pdfWidth: baseViewport.width,
      pdfHeight: baseViewport.height,
      rawWidth,
      rawHeight,
      rotation,
      rotationDelta,
      displayedWidth: viewport.width,
      displayedHeight: viewport.height
    });
  }

  if (renderId !== activeRenderId) return;
  pageInfo = nextPageInfo;
  viewerElement.replaceChildren(pagesRoot);
  pagesRoot.querySelectorAll(".text-edit-layer").forEach((layer) => {
    renderLayerCallback?.(layer, Number(layer.dataset.pageIndex));
  });
}

export async function setZoom(nextScale) {
  currentScale = Math.min(2.5, Math.max(0.4, nextScale));
  await renderPdfPages();
  return currentScale;
}

export async function rotateClockwise() {
  if (!pdfDocument) return;
  pageRotations = pageRotations.map((rotation) => (rotation + 90) % 360);
  await renderPdfPages();
}

export function getScale() { return currentScale; }
export function getPageInfo(pageIndex) { return pageInfo[pageIndex] || null; }
export function getAllPageInfo() { return pageInfo.map((info) => ({ ...info })); }
export function getOriginalPdfBytes() { return originalPdfBytes?.slice(0) || null; }
export function getOriginalFileName() { return originalFileName; }
export function hasPdf() { return Boolean(pdfDocument); }
