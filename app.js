const documentCanvas = document.getElementById("documentCanvas");
const signatureCanvas = document.getElementById("signatureCanvas");
const documentInput = document.getElementById("documentInput");
const documentName = document.getElementById("documentName");
const inkColor = document.getElementById("inkColor");
const inkSize = document.getElementById("inkSize");
const signerName = document.getElementById("signerName");
const signDate = document.getElementById("signDate");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const clearBtn = document.getElementById("clearBtn");
const fitBtn = document.getElementById("fitBtn");
const openSignaturePadBtn = document.getElementById("openSignaturePadBtn");
const downloadSignatureBtn = document.getElementById("downloadSignatureBtn");
const saveSignatureBtn = document.getElementById("saveSignatureBtn");
const applySavedSignatureBtn = document.getElementById("applySavedSignatureBtn");
const downloadDocumentBtn = document.getElementById("downloadDocumentBtn");
const signatureGuide = document.getElementById("signatureGuide");
const signatureMoveHandle = document.getElementById("signatureMoveHandle");
const strokeStatus = document.getElementById("strokeStatus");
const pageControls = document.getElementById("pageControls");
const pageIndicator = document.getElementById("pageIndicator");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const documentStage = document.querySelector(".document-stage");
const signaturePadModal = document.getElementById("signaturePadModal");
const signaturePadCanvas = document.getElementById("signaturePadCanvas");
const padClearBtn = document.getElementById("padClearBtn");
const padCancelBtn = document.getElementById("padCancelBtn");
const padApplyBtn = document.getElementById("padApplyBtn");

const docCtx = documentCanvas.getContext("2d");
const signCtx = signatureCanvas.getContext("2d");
const padCtx = signaturePadCanvas.getContext("2d");
const SAVED_SIGNATURE_KEY = "inkline.savedSignature.v1";

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const state = {
  drawing: false,
  lastPoint: null,
  strokes: [],
  redo: [],
  currentStroke: null,
  documentImage: null,
  mode: "blank",
  documentFileName: "signed-document.png",
  ratio: window.devicePixelRatio || 1,
  pdfBytes: null,
  pdfDoc: null,
  pdfPage: 1,
  pdfPageCount: 0,
  pdfSignatures: new Map(),
  pdfRedos: new Map(),
  renderTask: null,
  pageDrawBox: null,
  signatureBox: {
    x: 0.52,
    y: 0.78,
    width: 0.4,
    height: 0.12,
  },
  movingSignatureBox: false,
  signatureBoxDrag: null,
  savedSignature: loadSavedSignature(),
  padDrawing: false,
  padStrokes: [],
  padCurrentStroke: null,
  padLastPoint: null,
};

function setInitialDate() {
  const today = new Date();
  const local = new Date(today.getTime() - today.getTimezoneOffset() * 60000);
  signDate.value = local.toISOString().slice(0, 10);
}

function canvasPoint(event) {
  const rect = signatureCanvas.getBoundingClientRect();
  const point = event.touches ? event.touches[0] : event;
  return {
    x: (point.clientX - rect.left) / rect.width,
    y: (point.clientY - rect.top) / rect.height,
    pressure: point.pressure || 0.5,
  };
}

function padPoint(event) {
  const rect = signaturePadCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
    pressure: event.pressure || 0.5,
  };
}

function distanceBetween(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function stabilizePoint(previous, point, amount = 0.38) {
  if (!previous) return point;
  return {
    x: previous.x + (point.x - previous.x) * amount,
    y: previous.y + (point.y - previous.y) * amount,
    pressure: point.pressure,
  };
}

function cloneInk(strokes) {
  return strokes.map((stroke) => ({
    color: stroke.color,
    size: stroke.size,
    points: stroke.points.map((point) => ({ ...point })),
  }));
}

function templateFromStrokes(strokes) {
  const bounds = signatureBounds(strokes);
  if (!bounds) return null;

  const width = Math.max(0.001, bounds.maxX - bounds.minX);
  const height = Math.max(0.001, bounds.maxY - bounds.minY);
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    aspect: width / height,
    strokes: strokes.map((stroke) => ({
      color: stroke.color,
      size: stroke.size,
      points: stroke.points.map((point) => ({
        x: (point.x - bounds.minX) / width,
        y: (point.y - bounds.minY) / height,
      })),
    })),
  };
}

function placeSignatureTemplate(template) {
  if (!template) return;

  const box = state.signatureBox;
  const padX = box.width * 0.1;
  const padY = box.height * 0.22;
  const maxWidth = Math.max(0.01, box.width - padX * 2);
  const maxHeight = Math.max(0.01, box.height - padY * 2);
  const containerAspect = maxWidth / maxHeight;
  const signatureAspect = Math.max(0.1, template.aspect || 2.8);
  let drawWidth = maxWidth;
  let drawHeight = maxHeight;

  if (signatureAspect > containerAspect) {
    drawHeight = drawWidth / signatureAspect;
  } else {
    drawWidth = drawHeight * signatureAspect;
  }

  const startX = box.x + (box.width - drawWidth) / 2;
  const startY = box.y + (box.height - drawHeight) / 2;
  state.strokes = template.strokes.map((stroke) => ({
    color: stroke.color,
    size: stroke.size,
    points: stroke.points.map((point) => ({
      x: startX + point.x * drawWidth,
      y: startY + point.y * drawHeight,
    })),
  }));
  state.redo = [];
  saveCurrentPageInk();
  redrawSignature();
}

function loadSavedSignature() {
  try {
    const raw = localStorage.getItem(SAVED_SIGNATURE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.strokes) || !parsed.strokes.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveReusableSignature() {
  const savedSignature = templateFromStrokes(state.strokes);
  if (!savedSignature) return;
  localStorage.setItem(SAVED_SIGNATURE_KEY, JSON.stringify(savedSignature));
  state.savedSignature = savedSignature;
  updateButtons();
}

function applySavedSignature() {
  placeSignatureTemplate(state.savedSignature);
}

function currentPageKey() {
  return `page-${state.pdfPage}`;
}

function saveCurrentPageInk() {
  if (state.mode !== "pdf") return;
  state.pdfSignatures.set(currentPageKey(), cloneInk(state.strokes));
  state.pdfRedos.set(currentPageKey(), cloneInk(state.redo));
}

function loadCurrentPageInk() {
  if (state.mode !== "pdf") return;
  state.strokes = cloneInk(state.pdfSignatures.get(currentPageKey()) || []);
  state.redo = cloneInk(state.pdfRedos.get(currentPageKey()) || []);
}

function setStageAspect(width, height) {
  documentStage.style.setProperty("--stage-aspect", `${width} / ${height}`);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function positionSignatureGuide() {
  const box = state.signatureBox;
  signatureGuide.style.left = `${box.x * 100}%`;
  signatureGuide.style.top = `${box.y * 100}%`;
  signatureGuide.style.width = `${box.width * 100}%`;
  signatureGuide.style.height = `${box.height * 100}%`;
}

function resizeCanvases() {
  const rect = signatureCanvas.parentElement.getBoundingClientRect();
  const width = Math.max(360, Math.floor(rect.width));
  const height = Math.max(480, Math.floor(rect.height));
  const ratio = window.devicePixelRatio || 1;
  state.ratio = ratio;

  for (const canvas of [documentCanvas, signatureCanvas]) {
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  for (const ctx of [docCtx, signCtx]) {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  drawDocument();
  redrawSignature();
  positionSignatureGuide();
}

function drawBlankDocument(width, height) {
  state.pageDrawBox = { x: 0, y: 0, width, height };
  docCtx.fillStyle = "#fffdf8";
  docCtx.fillRect(0, 0, width, height);
  docCtx.strokeStyle = "#d8cebd";
  docCtx.lineWidth = 1;

  docCtx.fillStyle = "#101820";
  docCtx.font = "700 26px Georgia, serif";
  docCtx.fillText("签署文件", 42, 58);

  docCtx.fillStyle = "#736f66";
  docCtx.font = "14px Avenir Next, sans-serif";
  docCtx.fillText("上传图片或 PDF 后可在原文件上签字，也可以直接使用空白页。", 42, 88);

  for (let i = 0; i < 10; i += 1) {
    const y = 140 + i * 46;
    docCtx.beginPath();
    docCtx.moveTo(42, y);
    docCtx.lineTo(width - 42, y);
    docCtx.stroke();
  }
}

async function renderPdfPage() {
  if (!state.pdfDoc) return;
  const page = await state.pdfDoc.getPage(state.pdfPage);
  const width = documentCanvas.width / state.ratio;
  const height = documentCanvas.height / state.ratio;
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(width / baseViewport.width, height / baseViewport.height);
  const viewport = page.getViewport({ scale: scale * state.ratio });
  const drawWidth = viewport.width / state.ratio;
  const drawHeight = viewport.height / state.ratio;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;

  state.pageDrawBox = { x, y, width: drawWidth, height: drawHeight };
  docCtx.setTransform(state.ratio, 0, 0, state.ratio, 0, 0);
  docCtx.fillStyle = "#fffdf8";
  docCtx.fillRect(0, 0, width, height);

  const renderCanvas = document.createElement("canvas");
  renderCanvas.width = Math.ceil(viewport.width);
  renderCanvas.height = Math.ceil(viewport.height);
  const renderCtx = renderCanvas.getContext("2d");

  if (state.renderTask) {
    state.renderTask.cancel();
  }

  state.renderTask = page.render({ canvasContext: renderCtx, viewport });

  try {
    await state.renderTask.promise;
    docCtx.drawImage(renderCanvas, x, y, drawWidth, drawHeight);
  } catch (error) {
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);
    }
  } finally {
    state.renderTask = null;
  }
}

function drawDocument() {
  const width = documentCanvas.width / state.ratio;
  const height = documentCanvas.height / state.ratio;
  docCtx.clearRect(0, 0, width, height);

  if (state.mode === "pdf") {
    renderPdfPage();
    return;
  }

  if (!state.documentImage) {
    drawBlankDocument(width, height);
    return;
  }

  docCtx.fillStyle = "#fffdf8";
  docCtx.fillRect(0, 0, width, height);

  const image = state.documentImage;
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  state.pageDrawBox = { x, y, width: drawWidth, height: drawHeight };
  docCtx.drawImage(image, x, y, drawWidth, drawHeight);
}

function strokeLine(points, context = signCtx) {
  if (points.length < 2) return;
  context.strokeStyle = points[0].color;
  context.lineWidth = points[0].size;
  context.lineCap = "round";
  context.lineJoin = "round";

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i += 1) {
    const midpoint = {
      x: (points[i].x + points[i + 1].x) / 2,
      y: (points[i].y + points[i + 1].y) / 2,
    };
    context.quadraticCurveTo(points[i].x, points[i].y, midpoint.x, midpoint.y);
  }
  const last = points[points.length - 1];
  context.lineTo(last.x, last.y);
  context.stroke();
}

function redrawSignature() {
  const width = signatureCanvas.width / state.ratio;
  const height = signatureCanvas.height / state.ratio;
  signCtx.clearRect(0, 0, width, height);

  for (const stroke of state.strokes) {
    const denormalized = stroke.points.map((point) => ({
      x: point.x * width,
      y: point.y * height,
      color: stroke.color,
      size: stroke.size,
    }));
    strokeLine(denormalized);
  }

  updateButtons();
}

function anyPdfPageHasInk() {
  if (state.mode !== "pdf") return false;
  saveCurrentPageInk();
  return [...state.pdfSignatures.values()].some((strokes) => strokes.length > 0);
}

function updateButtons() {
  const hasInk = state.strokes.length > 0;
  const hasActiveInk = Boolean(state.currentStroke && state.currentStroke.points.length > 1);
  const hasVisibleInk = hasInk || hasActiveInk;
  const hasAnyInk = state.mode === "pdf" ? anyPdfPageHasInk() : hasInk;
  undoBtn.disabled = !hasInk;
  redoBtn.disabled = state.redo.length === 0;
  clearBtn.disabled = !hasInk;
  downloadSignatureBtn.disabled = !hasInk;
  saveSignatureBtn.disabled = !hasInk;
  applySavedSignatureBtn.disabled = !state.savedSignature;
  strokeStatus.textContent = hasVisibleInk ? "已签字" : "未签字";
  strokeStatus.classList.toggle("signed", hasVisibleInk);
  signatureGuide.classList.toggle("has-ink", hasVisibleInk);
  downloadDocumentBtn.textContent = state.mode === "pdf" ? "导出 PDF" : "导出签署稿";
  downloadDocumentBtn.disabled = state.mode === "pdf" && !window.PDFLib;
  pageControls.classList.toggle("hidden", state.mode !== "pdf");
  pageIndicator.textContent = `${state.pdfPage} / ${Math.max(state.pdfPageCount, 1)}`;
  prevPageBtn.disabled = state.mode !== "pdf" || state.pdfPage <= 1;
  nextPageBtn.disabled = state.mode !== "pdf" || state.pdfPage >= state.pdfPageCount;
  if (state.mode === "pdf" && hasAnyInk && !hasInk) {
    strokeStatus.textContent = "本页未签";
  }
}

function beginStroke(event) {
  if (event.target === signatureMoveHandle) return;
  event.preventDefault();
  const point = canvasPoint(event);
  signatureCanvas.setPointerCapture(event.pointerId);
  state.drawing = true;
  state.redo = [];
  state.currentStroke = {
    color: inkColor.value,
    size: Number(inkSize.value),
    points: [point],
  };
  state.lastPoint = point;
}

function beginMoveSignatureBox(event) {
  event.preventDefault();
  event.stopPropagation();
  const rect = documentStage.getBoundingClientRect();
  state.movingSignatureBox = true;
  state.signatureBoxDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    stageWidth: rect.width,
    stageHeight: rect.height,
    boxX: state.signatureBox.x,
    boxY: state.signatureBox.y,
    startStrokes: cloneInk(state.strokes),
    startRedo: cloneInk(state.redo),
  };
  signatureMoveHandle.setPointerCapture(event.pointerId);
}

function moveSignatureBox(event) {
  if (!state.movingSignatureBox || !state.signatureBoxDrag) return;
  event.preventDefault();
  event.stopPropagation();
  const drag = state.signatureBoxDrag;
  const rawDx = (event.clientX - drag.startX) / drag.stageWidth;
  const rawDy = (event.clientY - drag.startY) / drag.stageHeight;
  let dx = clamp(rawDx, -drag.boxX, 1 - state.signatureBox.width - drag.boxX);
  let dy = clamp(rawDy, -drag.boxY, 1 - state.signatureBox.height - drag.boxY);
  const bounds = signatureBounds(drag.startStrokes);

  if (bounds) {
    dx = clamp(dx, -bounds.minX, 1 - bounds.maxX);
    dy = clamp(dy, -bounds.minY, 1 - bounds.maxY);
    state.strokes = drag.startStrokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({
        ...point,
        x: point.x + dx,
        y: point.y + dy,
      })),
    }));
    state.redo = drag.startRedo.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({
        ...point,
        x: point.x + dx,
        y: point.y + dy,
      })),
    }));
    redrawSignature();
  }

  state.signatureBox.x = drag.boxX + dx;
  state.signatureBox.y = drag.boxY + dy;
  positionSignatureGuide();
}

function endMoveSignatureBox(event) {
  if (!state.movingSignatureBox) return;
  event.preventDefault();
  event.stopPropagation();
  state.movingSignatureBox = false;
  state.signatureBoxDrag = null;
  saveCurrentPageInk();
  if (signatureMoveHandle.hasPointerCapture(event.pointerId)) {
    signatureMoveHandle.releasePointerCapture(event.pointerId);
  }
}

function moveStroke(event) {
  if (!state.drawing || !state.currentStroke) return;
  event.preventDefault();

  const point = stabilizePoint(state.lastPoint, canvasPoint(event), 0.42);
  if (distanceBetween(state.lastPoint, point) < 0.002) return;
  const rect = signatureCanvas.getBoundingClientRect();
  const segment = [
    {
      x: state.lastPoint.x * rect.width,
      y: state.lastPoint.y * rect.height,
      color: state.currentStroke.color,
      size: state.currentStroke.size,
    },
    {
      x: point.x * rect.width,
      y: point.y * rect.height,
      color: state.currentStroke.color,
      size: state.currentStroke.size,
    },
  ];
  strokeLine(segment);

  state.currentStroke.points.push(point);
  state.lastPoint = point;
  updateButtons();
}

function endStroke(event) {
  if (!state.drawing || !state.currentStroke) return;
  event.preventDefault();
  state.drawing = false;
  if (signatureCanvas.hasPointerCapture(event.pointerId)) {
    signatureCanvas.releasePointerCapture(event.pointerId);
  }

  if (state.currentStroke.points.length > 1) {
    state.strokes.push(state.currentStroke);
    saveCurrentPageInk();
  }

  state.currentStroke = null;
  state.lastPoint = null;
  redrawSignature();
}

function clearSignature() {
  state.strokes = [];
  state.redo = [];
  saveCurrentPageInk();
  redrawSignature();
}

function undo() {
  const stroke = state.strokes.pop();
  if (stroke) state.redo.push(stroke);
  saveCurrentPageInk();
  redrawSignature();
}

function redo() {
  const stroke = state.redo.pop();
  if (stroke) state.strokes.push(stroke);
  saveCurrentPageInk();
  redrawSignature();
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = URL.createObjectURL(blob);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 3000);
}

function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, filename);
  }, "image/png");
}

function signatureBounds(strokes = state.strokes) {
  if (!strokes.length) return null;
  const xs = [];
  const ys = [];
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      xs.push(point.x);
      ys.push(point.y);
    }
  }
  return {
    minX: Math.max(0, Math.min(...xs) - 0.03),
    minY: Math.max(0, Math.min(...ys) - 0.03),
    maxX: Math.min(1, Math.max(...xs) + 0.03),
    maxY: Math.min(1, Math.max(...ys) + 0.03),
  };
}

function drawStrokesToCanvas(target, strokes, bounds = null) {
  const ctx = target.getContext("2d");
  const width = target.width;
  const height = target.height;
  ctx.clearRect(0, 0, width, height);

  const offsetX = bounds ? bounds.minX : 0;
  const offsetY = bounds ? bounds.minY : 0;
  const scaleX = bounds ? 1 / (bounds.maxX - bounds.minX) : 1;
  const scaleY = bounds ? 1 / (bounds.maxY - bounds.minY) : 1;

  for (const stroke of strokes) {
    const denormalized = stroke.points.map((point) => ({
      x: (point.x - offsetX) * scaleX * width,
      y: (point.y - offsetY) * scaleY * height,
      color: stroke.color,
      size: stroke.size * state.ratio,
    }));
    strokeLine(denormalized, ctx);
  }
}

function exportSignature() {
  const bounds = signatureBounds();
  if (!bounds) return;

  const width = signatureCanvas.width / state.ratio;
  const height = signatureCanvas.height / state.ratio;
  const crop = document.createElement("canvas");
  crop.width = Math.max(1, Math.floor((bounds.maxX - bounds.minX) * width * state.ratio));
  crop.height = Math.max(1, Math.floor((bounds.maxY - bounds.minY) * height * state.ratio));
  drawStrokesToCanvas(crop, state.strokes, bounds);
  downloadCanvas(crop, "signature.png");
}

function resizeSignaturePad() {
  const rect = signaturePadCanvas.parentElement.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  signaturePadCanvas.width = Math.max(1, Math.floor(rect.width * ratio));
  signaturePadCanvas.height = Math.max(1, Math.floor(rect.height * ratio));
  signaturePadCanvas.style.width = `${Math.floor(rect.width)}px`;
  signaturePadCanvas.style.height = `${Math.floor(rect.height)}px`;
  padCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  redrawSignaturePad();
}

function templateToPadStrokes(template) {
  if (!template) return [];
  const rect = signaturePadCanvas.parentElement.getBoundingClientRect();
  const padAspect = rect.width / rect.height;
  const signatureAspect = Math.max(0.1, template.aspect || 2.8);
  let drawWidth = 0.78;
  let drawHeight = 0.56;

  if (signatureAspect > padAspect) {
    drawHeight = (drawWidth * padAspect) / signatureAspect;
  } else {
    drawWidth = (drawHeight * signatureAspect) / padAspect;
  }

  const startX = (1 - drawWidth) / 2;
  const startY = (1 - drawHeight) / 2;
  return template.strokes.map((stroke) => ({
    color: stroke.color,
    size: stroke.size,
    points: stroke.points.map((point) => ({
      x: startX + point.x * drawWidth,
      y: startY + point.y * drawHeight,
    })),
  }));
}

function redrawSignaturePad() {
  const ratio = window.devicePixelRatio || 1;
  const width = signaturePadCanvas.width / ratio;
  const height = signaturePadCanvas.height / ratio;
  padCtx.clearRect(0, 0, width, height);

  for (const stroke of state.padStrokes) {
    const denormalized = stroke.points.map((point) => ({
      x: point.x * width,
      y: point.y * height,
      color: stroke.color,
      size: stroke.size,
    }));
    strokeLine(denormalized, padCtx);
  }

  padClearBtn.disabled = state.padStrokes.length === 0;
  padApplyBtn.disabled = state.padStrokes.length === 0;
}

function openSignaturePad() {
  signaturePadModal.hidden = false;
  resizeSignaturePad();
  state.padStrokes = templateToPadStrokes(templateFromStrokes(state.strokes));
  state.padCurrentStroke = null;
  state.padLastPoint = null;
  state.padDrawing = false;
  redrawSignaturePad();
}

function closeSignaturePad() {
  signaturePadModal.hidden = true;
  state.padDrawing = false;
  state.padCurrentStroke = null;
  state.padLastPoint = null;
}

function beginPadStroke(event) {
  event.preventDefault();
  signaturePadCanvas.setPointerCapture(event.pointerId);
  const point = padPoint(event);
  state.padDrawing = true;
  state.padCurrentStroke = {
    color: inkColor.value,
    size: Number(inkSize.value),
    points: [point],
  };
  state.padLastPoint = point;
}

function movePadStroke(event) {
  if (!state.padDrawing || !state.padCurrentStroke) return;
  event.preventDefault();

  const point = stabilizePoint(state.padLastPoint, padPoint(event), 0.36);
  if (distanceBetween(state.padLastPoint, point) < 0.0015) return;

  const rect = signaturePadCanvas.getBoundingClientRect();
  strokeLine(
    [
      {
        x: state.padLastPoint.x * rect.width,
        y: state.padLastPoint.y * rect.height,
        color: state.padCurrentStroke.color,
        size: state.padCurrentStroke.size,
      },
      {
        x: point.x * rect.width,
        y: point.y * rect.height,
        color: state.padCurrentStroke.color,
        size: state.padCurrentStroke.size,
      },
    ],
    padCtx
  );

  state.padCurrentStroke.points.push(point);
  state.padLastPoint = point;
  padClearBtn.disabled = false;
  padApplyBtn.disabled = false;
}

function endPadStroke(event) {
  if (!state.padDrawing || !state.padCurrentStroke) return;
  event.preventDefault();
  state.padDrawing = false;
  if (signaturePadCanvas.hasPointerCapture(event.pointerId)) {
    signaturePadCanvas.releasePointerCapture(event.pointerId);
  }

  if (state.padCurrentStroke.points.length > 1) {
    state.padStrokes.push(state.padCurrentStroke);
  }

  state.padCurrentStroke = null;
  state.padLastPoint = null;
  redrawSignaturePad();
}

function clearSignaturePad() {
  state.padStrokes = [];
  state.padCurrentStroke = null;
  state.padLastPoint = null;
  redrawSignaturePad();
}

function applySignaturePad() {
  const template = templateFromStrokes(state.padStrokes);
  if (!template) return;
  placeSignatureTemplate(template);
  closeSignaturePad();
}

function drawSignerInfo(ctx, width, height, ratio = 1) {
  const name = signerName.value.trim();
  const date = signDate.value;
  if (!name && !date) return;

  ctx.save();
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = "rgba(255, 253, 248, 0.88)";
  ctx.strokeStyle = "rgba(16, 24, 32, 0.18)";
  ctx.lineWidth = 1;
  const boxWidth = Math.min(360, width - 48);
  const boxHeight = 64;
  const x = width - boxWidth - 28;
  const y = height - boxHeight - 28;
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.strokeRect(x, y, boxWidth, boxHeight);
  ctx.fillStyle = "#101820";
  ctx.font = "700 15px Avenir Next, sans-serif";
  ctx.fillText(name ? `签署人：${name}` : "签署人：", x + 16, y + 26);
  ctx.fillStyle = "#736f66";
  ctx.font = "13px Avenir Next, sans-serif";
  ctx.fillText(date ? `日期：${date}` : "日期：", x + 16, y + 48);
  ctx.restore();
}

function exportImageDocument() {
  const output = document.createElement("canvas");
  output.width = documentCanvas.width;
  output.height = documentCanvas.height;
  const ctx = output.getContext("2d");

  ctx.drawImage(documentCanvas, 0, 0);
  ctx.drawImage(signatureCanvas, 0, 0);
  drawSignerInfo(ctx, output.width / state.ratio, output.height / state.ratio, state.ratio);
  downloadCanvas(output, state.documentFileName);
}

async function exportPdfDocument() {
  if (!state.pdfBytes || !window.PDFLib) return;
  saveCurrentPageInk();
  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.load(state.pdfBytes.slice(0));
  const pages = pdfDoc.getPages();
  const stageWidth = signatureCanvas.width / state.ratio;
  const stageHeight = signatureCanvas.height / state.ratio;

  for (let index = 0; index < pages.length; index += 1) {
    const strokes = state.pdfSignatures.get(`page-${index + 1}`) || [];
    if (!strokes.length) continue;

    const page = pages[index];
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const pageAspect = pageWidth / pageHeight;
    const stageAspect = stageWidth / stageHeight;
    let boxWidth = stageWidth;
    let boxHeight = stageHeight;
    let boxX = 0;
    let boxY = 0;

    if (pageAspect > stageAspect) {
      boxWidth = stageWidth;
      boxHeight = stageWidth / pageAspect;
      boxY = (stageHeight - boxHeight) / 2;
    } else {
      boxHeight = stageHeight;
      boxWidth = stageHeight * pageAspect;
      boxX = (stageWidth - boxWidth) / 2;
    }

    const overlay = document.createElement("canvas");
    overlay.width = Math.max(1, Math.floor(boxWidth * state.ratio));
    overlay.height = Math.max(1, Math.floor(boxHeight * state.ratio));
    const overlayCtx = overlay.getContext("2d");
    overlayCtx.setTransform(state.ratio, 0, 0, state.ratio, 0, 0);

    for (const stroke of strokes) {
      const denormalized = stroke.points.map((point) => ({
        x: point.x * stageWidth - boxX,
        y: point.y * stageHeight - boxY,
        color: stroke.color,
        size: stroke.size,
      }));
      strokeLine(denormalized, overlayCtx);
    }

    const pngBytes = await new Promise((resolve) => overlay.toBlob(resolve, "image/png"));
    if (!pngBytes) continue;

    const image = await pdfDoc.embedPng(await pngBytes.arrayBuffer());
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });
  }

  const pdfBytes = await pdfDoc.save();
  downloadBlob(new Blob([pdfBytes], { type: "application/pdf" }), state.documentFileName);
}

function exportDocument() {
  if (state.mode === "pdf") {
    exportPdfDocument();
    return;
  }
  exportImageDocument();
}

function resetDocumentState(mode) {
  state.mode = mode;
  state.strokes = [];
  state.redo = [];
  state.currentStroke = null;
  state.documentImage = null;
  state.pdfBytes = null;
  state.pdfDoc = null;
  state.pdfPage = 1;
  state.pdfPageCount = 0;
  state.pdfSignatures = new Map();
  state.pdfRedos = new Map();
}

function loadImageDocument(file) {
  resetDocumentState("image");
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      state.documentImage = image;
      state.documentFileName = `${file.name.replace(/\.[^.]+$/, "")}-signed.png`;
      documentName.textContent = file.name;
      setStageAspect(image.width, image.height);
      resizeCanvases();
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}

async function loadPdfDocument(file) {
  if (!window.pdfjsLib || !window.PDFLib) {
    alert("PDF 组件加载失败，请检查网络后刷新页面。");
    return;
  }

  resetDocumentState("pdf");
  const bytes = await file.arrayBuffer();
  state.pdfBytes = bytes;
  state.pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  state.pdfPageCount = state.pdfDoc.numPages;
  state.documentFileName = `${file.name.replace(/\.[^.]+$/, "")}-signed.pdf`;
  documentName.textContent = file.name;

  const page = await state.pdfDoc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  setStageAspect(viewport.width, viewport.height);
  resizeCanvases();
}

function loadDocument(file) {
  if (!file) return;
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    loadPdfDocument(file);
    return;
  }
  loadImageDocument(file);
}

async function goToPdfPage(nextPage) {
  if (nextPage < 1 || nextPage > state.pdfPageCount || nextPage === state.pdfPage) return;
  saveCurrentPageInk();
  state.pdfPage = nextPage;
  loadCurrentPageInk();
  await renderPdfPage();
  redrawSignature();
}

function syncSwatches() {
  document.querySelectorAll(".swatch").forEach((button) => {
    button.classList.toggle("active", button.dataset.color === inkColor.value);
  });
}

documentInput.addEventListener("change", (event) => loadDocument(event.target.files[0]));
undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);
clearBtn.addEventListener("click", clearSignature);
fitBtn.addEventListener("click", resizeCanvases);
openSignaturePadBtn.addEventListener("click", openSignaturePad);
downloadSignatureBtn.addEventListener("click", exportSignature);
saveSignatureBtn.addEventListener("click", saveReusableSignature);
applySavedSignatureBtn.addEventListener("click", applySavedSignature);
downloadDocumentBtn.addEventListener("click", exportDocument);
prevPageBtn.addEventListener("click", () => goToPdfPage(state.pdfPage - 1));
nextPageBtn.addEventListener("click", () => goToPdfPage(state.pdfPage + 1));
inkColor.addEventListener("input", syncSwatches);

document.querySelectorAll(".swatch").forEach((button) => {
  button.addEventListener("click", () => {
    inkColor.value = button.dataset.color;
    syncSwatches();
  });
});

signatureCanvas.addEventListener("pointerdown", beginStroke);
signatureCanvas.addEventListener("pointermove", moveStroke);
signatureCanvas.addEventListener("pointerup", endStroke);
signatureCanvas.addEventListener("pointerleave", endStroke);
signatureCanvas.addEventListener("pointercancel", endStroke);
signaturePadCanvas.addEventListener("pointerdown", beginPadStroke);
signaturePadCanvas.addEventListener("pointermove", movePadStroke);
signaturePadCanvas.addEventListener("pointerup", endPadStroke);
signaturePadCanvas.addEventListener("pointerleave", endPadStroke);
signaturePadCanvas.addEventListener("pointercancel", endPadStroke);
padClearBtn.addEventListener("click", clearSignaturePad);
padCancelBtn.addEventListener("click", closeSignaturePad);
padApplyBtn.addEventListener("click", applySignaturePad);
signatureMoveHandle.addEventListener("pointerdown", beginMoveSignatureBox);
signatureMoveHandle.addEventListener("pointermove", moveSignatureBox);
signatureMoveHandle.addEventListener("pointerup", endMoveSignatureBox);
signatureMoveHandle.addEventListener("pointercancel", endMoveSignatureBox);
window.addEventListener("pointermove", moveSignatureBox);
window.addEventListener("pointerup", endMoveSignatureBox);
window.addEventListener("pointercancel", endMoveSignatureBox);

window.addEventListener("resize", () => {
  saveCurrentPageInk();
  resizeCanvases();
  if (!signaturePadModal.hidden) {
    resizeSignaturePad();
  }
});

setInitialDate();
resizeCanvases();
updateButtons();
