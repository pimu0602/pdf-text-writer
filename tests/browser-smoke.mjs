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

const editorState = await evaluate(`(() => ({
  text: document.querySelector('.text-box-content')?.innerText,
  fontSize: document.querySelector('#fontSizeInput')?.value,
  color: document.querySelector('#fontColorInput')?.value,
  saveEnabled: !document.querySelector('#saveButton')?.disabled
}))()`);

if (editorState.text !== "山田太郎" || editorState.fontSize !== "20" || editorState.color !== "#c94d31" || !editorState.saveEnabled) {
  throw new Error(`編集状態が一致しません: ${JSON.stringify(editorState)}`);
}

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
if (!exportMeta || exportMeta.byteLength < 500 || exportMeta.fileName !== "smoke-sample-text.pdf") {
  throw new Error(`PDFバイト列を確認できません: ${JSON.stringify(exportMeta)}`);
}

console.log(JSON.stringify({
  result: "PASS",
  editorState,
  exportMeta,
  download: downloads[0] || "headless-browser-policy-blocked"
}, null, 2));

socket.close();
