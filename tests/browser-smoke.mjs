import { mkdir, readdir, rm } from "node:fs/promises";

const debuggerBase = "http://127.0.0.1:9222";
const downloadPath = "C:/tmp/pdf-text-writer-downloads";

await mkdir(downloadPath, { recursive: true });
for (const file of await readdir(downloadPath)) {
  await rm(`${downloadPath}/${file}`, { force: true });
}

const targets = await fetch(`${debuggerBase}/json/list`).then((response) => response.json());
const target = targets.find((entry) => entry.type === "page" && entry.url.startsWith("http://127.0.0.1:4173/"));
if (!target) throw new Error("PDF Text Writer のブラウザタブが見つかりません。");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", () => reject(new Error("ブラウザへ接続できません。")), { once: true });
});

let nextId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, awaitPromise = true) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

async function waitFor(expression, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`待機中にタイムアウトしました: ${expression}`);
}

await send("Runtime.enable");
await send("Page.enable");
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath, eventsEnabled: true });
await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath });
await send("Page.reload", { ignoreCache: true });
await new Promise((resolve) => setTimeout(resolve, 1000));

await waitFor("Boolean(window.PDFLib && window.pdfjsLib && document.documentElement.dataset.appReady === 'true')");

await evaluate(`(async () => {
  const doc = await PDFLib.PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  page.drawText('Browser smoke test', { x: 56, y: 760, size: 20, font });
  const bytes = await doc.save();
  const file = new File([bytes], 'smoke-sample.pdf', { type: 'application/pdf' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.querySelector('#pdfFileInput');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);

await waitFor("Boolean(document.querySelector('.pdf-page-shell') && !document.querySelector('#addTextButton').disabled)");

await evaluate(`(() => {
  document.querySelector('#addTextButton').click();
  const layer = document.querySelector('.text-edit-layer');
  const rect = layer.getBoundingClientRect();
  layer.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    pointerId: 1,
    clientX: rect.left + 120,
    clientY: rect.top + 180
  }));
  return true;
})()`);

await waitFor("Boolean(document.querySelector('.text-box-content'))");
await evaluate(`(() => {
  const editable = document.querySelector('.text-box-content');
  editable.innerText = '山田太郎';
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '山田太郎' }));
  const size = document.querySelector('#fontSizeInput');
  size.value = '20';
  size.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#fontColorInput').value = '#c94d31';
  document.querySelector('#fontColorInput').dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

await evaluate(`(() => {
  const editable = document.querySelector('.text-box-content');
  const box = editable.closest('.text-box');
  const rect = editable.getBoundingClientRect();
  window.__dragBefore = { left: parseFloat(box.style.left), top: parseFloat(box.style.top) };
  editable.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    pointerId: 21,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: rect.left + 8,
    clientY: rect.top + 8
  }));
  window.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true,
    pointerId: 21,
    pointerType: 'mouse',
    buttons: 1,
    clientX: rect.left + 68,
    clientY: rect.top + 48
  }));
  window.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    pointerId: 21,
    pointerType: 'mouse',
    button: 0,
    clientX: rect.left + 68,
    clientY: rect.top + 48
  }));
  window.__dragAfter = { left: parseFloat(box.style.left), top: parseFloat(box.style.top) };
  return true;
})()`);

await evaluate(`(() => {
  const editable = document.querySelector('.text-box-content');
  const box = editable.closest('.text-box');
  const rect = editable.getBoundingClientRect();
  editable.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    pointerId: 24,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: rect.left + 8,
    clientY: rect.top + 8
  }));
  window.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true,
    pointerId: 24,
    pointerType: 'mouse',
    buttons: 1,
    clientX: rect.left + 38,
    clientY: rect.top + 28
  }));
  window.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true,
    pointerId: 24,
    pointerType: 'mouse',
    buttons: 0,
    clientX: rect.left + 38,
    clientY: rect.top + 28
  }));
  window.__releasedDragPosition = { left: parseFloat(box.style.left), top: parseFloat(box.style.top) };
  window.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true,
    pointerId: 24,
    pointerType: 'mouse',
    buttons: 0,
    clientX: rect.left + 138,
    clientY: rect.top + 128
  }));
  window.__afterReleasedMove = { left: parseFloat(box.style.left), top: parseFloat(box.style.top) };
  return true;
})()`);

const editorState = await evaluate(`(() => ({
  text: document.querySelector('.text-box-content')?.innerText,
  fontSize: document.querySelector('#fontSizeInput')?.value,
  color: document.querySelector('#fontColorInput')?.value,
  saveEnabled: !document.querySelector('#saveButton')?.disabled,
  movedByDirectDrag: window.__dragAfter.left > window.__dragBefore.left &&
    window.__dragAfter.top > window.__dragBefore.top,
  stopsWhenMouseReleased: window.__releasedDragPosition.left === window.__afterReleasedMove.left &&
    window.__releasedDragPosition.top === window.__afterReleasedMove.top
}))()`);

if (editorState.text !== "山田太郎" || editorState.fontSize !== "20" || editorState.color !== "#c94d31" ||
    !editorState.saveEnabled || !editorState.movedByDirectDrag || !editorState.stopsWhenMouseReleased) {
  throw new Error(`編集状態が一致しません: ${JSON.stringify(editorState)}`);
}

await send("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true
});
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
const mobileScrollState = await evaluate(`(() => {
  const layer = document.querySelector('.text-edit-layer');
  const viewer = document.querySelector('.viewer');
  return {
    layerTouchAction: getComputedStyle(layer).touchAction,
    viewerOverflowY: getComputedStyle(viewer).overflowY
  };
})()`);
if (!mobileScrollState.layerTouchAction.includes('pan-y') || mobileScrollState.viewerOverflowY !== 'auto') {
  throw new Error(`Mobile scrolling is disabled: ${JSON.stringify(mobileScrollState)}`);
}
const viewportLocked = await evaluate(`(() => {
  const editable = document.querySelector('.text-box-content');
  editable.blur();
  editable.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    pointerId: 22,
    pointerType: 'touch',
    button: 0,
    clientX: 100,
    clientY: 100
  }));
  editable.focus();
  return document.querySelector('meta[name="viewport"]').content.includes('maximum-scale=1');
})()`);
await evaluate("document.querySelector('.text-box-content').blur(); true");
await new Promise((resolve) => setTimeout(resolve, 450));
const viewportRestored = await evaluate(
  "!document.querySelector('meta[name=\"viewport\"]').content.includes('maximum-scale=1')"
);
const mobileSizeState = await evaluate(`(() => {
  const input = document.querySelector('#mobileFontSizeInput');
  input.value = '28';
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return {
    mobile: input.value,
    desktop: document.querySelector('#fontSizeInput').value
  };
})()`);
const mobileColorState = await evaluate(`(() => {
  const meta = document.querySelector('meta[name="viewport"]');
  const label = document.querySelector('#mobileColorLabel');
  const input = document.querySelector('#mobileColorInput');
  label.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    pointerId: 23,
    pointerType: 'touch',
    button: 0,
    clientX: 180,
    clientY: 780
  }));
  input.focus();
  const locked = meta.content.includes('maximum-scale=1');
  input.value = '#ff8a95';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
  return {
    hasNativeColorInput: input.type === 'color',
    locked,
    selected: input.value
  };
})()`);
await new Promise((resolve) => setTimeout(resolve, 450));
mobileColorState.restored = await evaluate(
  "!document.querySelector('meta[name=\"viewport\"]').content.includes('maximum-scale=1')"
);
if (!viewportLocked || !viewportRestored || mobileSizeState.mobile !== "28" || mobileSizeState.desktop !== "28" ||
    !mobileColorState.hasNativeColorInput || !mobileColorState.locked || !mobileColorState.restored ||
    mobileColorState.selected !== "#ff8a95") {
  throw new Error(`モバイル操作の検証に失敗しました: ${JSON.stringify({ viewportLocked, viewportRestored, mobileSizeState, mobileColorState })}`);
}

const mobileRotationBefore = await evaluate(`(() => {
  const page = document.querySelector('.pdf-page-shell');
  const viewer = document.querySelector('.viewer');
  return {
    width: parseFloat(page.style.width),
    height: parseFloat(page.style.height),
    viewerWidth: viewer.clientWidth,
    buttonCount: document.querySelector('.mobile-toolbar').children.length,
    buttonEnabled: !document.querySelector('#mobileRotateButton').disabled
  };
})()`);
await evaluate("document.querySelector('#mobileRotateButton').click(); true");
await waitFor("document.querySelector('#statusMessage')?.textContent === 'PDFを右へ90度回転しました'");
const mobileRotationAfter = await evaluate(`(() => {
  const page = document.querySelector('.pdf-page-shell');
  return {
    width: parseFloat(page.style.width),
    height: parseFloat(page.style.height),
    text: document.querySelector('.text-box-content')?.innerText
  };
})()`);
const mobileRotationPassed = mobileRotationBefore.buttonCount === 5 && mobileRotationBefore.buttonEnabled &&
  mobileRotationAfter.width <= mobileRotationBefore.viewerWidth - 20 &&
  mobileRotationAfter.width > mobileRotationAfter.height && mobileRotationAfter.text === '山田太郎';
if (!mobileRotationPassed) {
  throw new Error(`スマホ版PDF回転の検証に失敗しました: ${JSON.stringify({ mobileRotationBefore, mobileRotationAfter })}`);
}
await send("Emulation.setTouchEmulationEnabled", { enabled: false });
await send("Emulation.setDeviceMetricsOverride", {
  width: 1200,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false
});

const rotationBefore = await evaluate(`(() => {
  const page = document.querySelector('.pdf-page-shell');
  return { width: parseFloat(page.style.width), height: parseFloat(page.style.height) };
})()`);
await evaluate("document.querySelector('#rotateButton').click(); true");
await waitFor("document.querySelector('#statusMessage')?.textContent === 'PDFを右へ90度回転しました'");
const rotationAfter = await evaluate(`(() => {
  const page = document.querySelector('.pdf-page-shell');
  return {
    width: parseFloat(page.style.width),
    height: parseFloat(page.style.height),
    text: document.querySelector('.text-box-content')?.innerText
  };
})()`);
const rotationPassed = Math.abs(rotationAfter.width - rotationBefore.height) < 1 &&
  Math.abs(rotationAfter.height - rotationBefore.width) < 1 && rotationAfter.text === '山田太郎';
if (!rotationPassed) {
  throw new Error(`PDF回転の検証に失敗しました: ${JSON.stringify({ rotationBefore, rotationAfter })}`);
}
await send("Emulation.clearDeviceMetricsOverride");

await evaluate(`(() => {
  window.__pdfTextWriterExport = null;
  window.addEventListener('pdf-text-writer:exported', (event) => {
    window.__pdfTextWriterExport = event.detail;
  }, { once: true });
  document.querySelector('#saveButton').click();
  return true;
})()`);
try {
  await waitFor("document.querySelector('#statusMessage')?.textContent === 'PDFを保存しました'", 60000);
} catch (error) {
  const saveState = await evaluate(`(() => ({
    status: document.querySelector('#statusMessage')?.textContent,
    statusIsError: document.querySelector('#statusMessage')?.classList.contains('error'),
    toast: document.querySelector('#toast')?.textContent,
    saveDisabled: document.querySelector('#saveButton')?.disabled
  }))()`);
  throw new Error(`${error.message} / ${JSON.stringify(saveState)}`);
}

let downloads = [];
for (let attempt = 0; attempt < 40; attempt += 1) {
  downloads = (await readdir(downloadPath)).filter((name) => name.endsWith(".pdf"));
  if (downloads.length) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
const exportMeta = await evaluate("window.__pdfTextWriterExport");
if (!exportMeta || exportMeta.byteLength < 500 || exportMeta.fileName !== "smoke-sample-text.pdf" ||
    exportMeta.rotations?.[0] !== 180) {
  throw new Error(`PDFバイト列を確認できません: ${JSON.stringify(exportMeta)}`);
}

console.log(JSON.stringify({
  result: "PASS",
  editorState,
  mobileScrollState,
  mobileSizeState,
  mobileColorState,
  mobileRotationPassed,
  rotationPassed,
  exportMeta,
  download: downloads[0] || "headless-browser-policy-blocked"
}, null, 2));

socket.close();
