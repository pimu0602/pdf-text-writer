const JAPANESE_FONT_URL =
  "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@5.2.6/files/noto-sans-jp-japanese-400-normal.woff";

let cachedJapaneseFontBytes = null;

function hexToRgb(hex) {
  const normalized = hex.replace("#", "").trim();
  const value = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized.padEnd(6, "0").slice(0, 6);
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255
  };
}

function needsCustomFont(text) {
  return /[^\u0000-\u00ff]/.test(text);
}

async function fetchJapaneseFont() {
  if (cachedJapaneseFontBytes) return cachedJapaneseFontBytes;
  const response = await fetch(JAPANESE_FONT_URL);
  if (!response.ok) throw new Error("日本語フォントを取得できませんでした。ネットワーク接続を確認してください。");
  cachedJapaneseFontBytes = await response.arrayBuffer();
  return cachedJapaneseFontBytes;
}

function safeTextWidth(font, text, size) {
  try { return font.widthOfTextAtSize(text, size); }
  catch { return text.length * size * 0.55; }
}

export function wrapTextLines(font, text, size, maxWidth) {
  const width = Math.max(size, Number(maxWidth) || size);
  return text.replace(/\r/g, "").split("\n").flatMap((paragraph) => {
    if (!paragraph) return [""];
    const lines = [];
    let current = "";
    for (const character of Array.from(paragraph)) {
      const candidate = current + character;
      if (current && safeTextWidth(font, candidate, size) > width) {
        lines.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
    return lines;
  });
}

function screenPointToPdf(x, y, rotation, pageWidth, pageHeight) {
  switch (rotation) {
    case 90: return { x: y, y: x };
    case 180: return { x: pageWidth - x, y };
    case 270: return { x: pageWidth - y, y: pageHeight - x };
    default: return { x, y: pageHeight - y };
  }
}

export async function exportPdf({ sourceBytes, textItems, pageInfoList = [], fileName, onProgress }) {
  if (!window.PDFLib) throw new Error("PDF保存ライブラリを読み込めませんでした。");
  const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib;
  const pdfDoc = await PDFDocument.load(sourceBytes.slice(0));
  const pages = pdfDoc.getPages();
  const usesJapanese = textItems.some((item) => needsCustomFont(item.text));

  onProgress?.(usesJapanese ? "日本語フォントを準備しています…" : "PDFに文字を書き込んでいます…");

  let customFont = null;
  if (usesJapanese) {
    if (!window.fontkit) throw new Error("日本語フォント処理を初期化できませんでした。");
    pdfDoc.registerFontkit(window.fontkit);
    customFont = await pdfDoc.embedFont(await fetchJapaneseFont(), { subset: true });
  }

  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  pages.forEach((page, pageIndex) => {
    const info = pageInfoList[pageIndex];
    if (info) page.setRotation(degrees(info.rotation));
  });

  for (const item of textItems) {
    const page = pages[item.pageIndex];
    if (!page || !item.text.trim()) continue;

    const font = needsCustomFont(item.text) ? customFont : (item.bold ? boldFont : regularFont);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const rotation = pageInfoList[item.pageIndex]?.rotation ?? page.getRotation().angle ?? 0;
    const displayWidth = rotation % 180 === 0 ? pageWidth : pageHeight;
    const displayHeight = rotation % 180 === 0 ? pageHeight : pageWidth;
    const size = Math.max(6, Number(item.fontSize) || 16);
    const lineHeight = size * 1.32;
    const color = hexToRgb(item.color || "#172033");
    const lines = wrapTextLines(font, item.text, size, item.width);

    lines.forEach((line, lineIndex) => {
      const lineWidth = safeTextWidth(font, line, size);
      let offset = 0;
      if (item.align === "center") offset = (item.width - lineWidth) / 2;
      if (item.align === "right") offset = item.width - lineWidth;
      const screenX = Math.max(0, Math.min(item.x + offset, displayWidth));
      const screenY = item.y + size + (lineIndex * lineHeight);
      if (screenY < -lineHeight || screenY > displayHeight + lineHeight) return;
      const point = screenPointToPdf(screenX, screenY, rotation, pageWidth, pageHeight);
      page.drawText(line, {
        x: point.x,
        y: point.y,
        size,
        font,
        color: rgb(color.r, color.g, color.b),
        rotate: degrees(rotation)
      });
    });
  }

  onProgress?.("ダウンロードを準備しています…");
  const outputBytes = await pdfDoc.save();
  const blob = new Blob([outputBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const baseName = (fileName || "document.pdf").replace(/\.pdf$/i, "");
  const outputFileName = `${baseName}-text.pdf`;
  anchor.href = url;
  anchor.download = outputFileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  const rotations = pages.map((page) => page.getRotation().angle);
  window.dispatchEvent(new CustomEvent("pdf-text-writer:exported", {
    detail: { byteLength: outputBytes.length, fileName: outputFileName, rotations }
  }));
  return { byteLength: outputBytes.length, fileName: outputFileName, rotations };
}
