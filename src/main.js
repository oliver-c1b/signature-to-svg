import { init, potrace } from 'esm-potrace-wasm';
import {
  MAX_FILE_BYTES,
  fitWithinLimits,
  makeBinaryRaster,
  otsuThreshold,
  rgbaToGrayscale,
} from './image-processing.js';
import './styles.css';

const elements = Object.fromEntries(
  [
    'fileInput',
    'pasteButton',
    'clearButton',
    'compactDrop',
    'fileName',
    'fileMeta',
    'threshold',
    'thresholdValue',
    'autoThresholdButton',
    'smoothing',
    'smoothingValue',
    'speckles',
    'specklesValue',
    'trimMargins',
    'invertImage',
    'inkColor',
    'inkColorValue',
    'cornerSmoothing',
    'cornerSmoothingValue',
    'curveTolerance',
    'curveToleranceValue',
    'viewSwitcher',
    'dropStage',
    'emptyState',
    'loadedState',
    'previewGrid',
    'sourcePreview',
    'vectorPreview',
    'traceStatus',
    'busyOverlay',
    'resultBar',
    'dimensionsStat',
    'pathsStat',
    'sizeStat',
    'showCodeButton',
    'copyButton',
    'downloadButton',
    'codeDrawer',
    'closeCodeButton',
    'svgCode',
    'copyFallback',
    'engineStatus',
    'toast',
  ].map((id) => [id, document.getElementById(id)]),
);

const state = {
  sourceCanvas: null,
  sourceName: 'signature',
  sourceBytes: 0,
  sourceUrl: null,
  vectorUrl: null,
  rawSvg: '',
  finalSvg: '',
  outputWidth: 0,
  outputHeight: 0,
  traceSequence: 0,
  traceTimer: null,
  toastTimer: null,
};

const engineReady = init()
  .then(() => {
    elements.engineStatus.classList.add('ready');
    elements.engineStatus.innerHTML = '<i></i> WebAssembly engine ready';
  })
  .catch((error) => {
    console.error(error);
    elements.engineStatus.classList.add('error');
    elements.engineStatus.innerHTML = '<i></i> Tracing engine unavailable';
    throw error;
  });

function showToast(message, type = 'info') {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.type = type;
  elements.toast.classList.add('visible');
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove('visible'), 3200);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeBaseName(filename) {
  const withoutExtension = filename.replace(/\.[^/.]+$/, '');
  return (
    withoutExtension
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9-_ ]/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'signature'
  );
}

function revokeUrl(key) {
  if (state[key]) {
    URL.revokeObjectURL(state[key]);
    state[key] = null;
  }
}

async function decodeImage(file) {
  let source;

  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;

    try {
      await image.decode();
      source = image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const naturalWidth = source.naturalWidth || source.width;
  const naturalHeight = source.naturalHeight || source.height;
  if (!naturalWidth || !naturalHeight) throw new Error('This image has no readable dimensions.');

  const fitted = fitWithinLimits(naturalWidth, naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = fitted.width;
  canvas.height = fitted.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is not available in this browser.');

  context.drawImage(source, 0, 0, canvas.width, canvas.height);

  if (typeof source.close === 'function') source.close();

  return { canvas, naturalWidth, naturalHeight, fitted };
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the preview.'))), 'image/png');
  });
}

async function loadFile(file, label = file.name || 'Pasted image') {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    showToast('That image is larger than 40 MB. Try a smaller copy.', 'error');
    return;
  }
  if (file.type && !file.type.startsWith('image/')) {
    showToast('The pasted item is not an image.', 'error');
    return;
  }

  elements.dropStage.classList.add('loading');

  try {
    const decoded = await decodeImage(file);
    const previewBlob = await canvasToBlob(decoded.canvas);

    revokeUrl('sourceUrl');
    state.sourceUrl = URL.createObjectURL(previewBlob);
    state.sourceCanvas = decoded.canvas;
    state.sourceName = safeBaseName(file.name || 'signature');
    state.sourceBytes = file.size;
    state.rawSvg = '';
    state.finalSvg = '';

    elements.sourcePreview.src = state.sourceUrl;
    elements.fileName.textContent = label;
    const resizedNote = decoded.fitted.scale < 1 ? ` · resized from ${decoded.naturalWidth}×${decoded.naturalHeight}` : '';
    elements.fileMeta.textContent = `${decoded.canvas.width}×${decoded.canvas.height} · ${formatBytes(file.size)}${resizedNote}`;

    elements.emptyState.hidden = true;
    elements.loadedState.hidden = false;
    elements.compactDrop.hidden = false;
    elements.clearButton.hidden = false;
    elements.viewSwitcher.hidden = false;
    elements.resultBar.hidden = false;
    elements.codeDrawer.hidden = true;

    setAutoThreshold(false);
    await traceImage();
    showToast('Image ready — adjust the controls or export the SVG.', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'This image could not be opened.', 'error');
  } finally {
    elements.fileInput.value = '';
    elements.dropStage.classList.remove('loading');
  }
}

function setAutoThreshold(retrace = true) {
  if (!state.sourceCanvas) return;
  const context = state.sourceCanvas.getContext('2d', { willReadFrequently: true });
  const rgba = context.getImageData(0, 0, state.sourceCanvas.width, state.sourceCanvas.height).data;
  const grayscale = rgbaToGrayscale(rgba, elements.invertImage.checked);
  const suggested = Math.min(245, otsuThreshold(grayscale) + 8);
  elements.threshold.value = String(suggested);
  elements.thresholdValue.textContent = String(suggested);
  if (retrace) scheduleTrace(0);
}

function getTraceOptions() {
  return {
    threshold: Number(elements.threshold.value),
    invert: elements.invertImage.checked,
    smoothing: Number(elements.smoothing.value),
    crop: elements.trimMargins.checked,
    padding: 12,
  };
}

function colorizeSvg(svg, color) {
  const documentNode = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (documentNode.querySelector('parsererror')) throw new Error('The tracing engine returned invalid SVG.');

  const root = documentNode.documentElement;
  root.removeAttribute('xmlns:xlink');
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', 'Traced signature');
  root.setAttribute('data-generated-by', 'DXSolutions Signature Trace');

  const filledElements = root.querySelectorAll('[fill]');
  if (filledElements.length === 0) {
    root.setAttribute('fill', color);
  } else {
    for (const node of filledElements) {
      if (node.getAttribute('fill') !== 'none') node.setAttribute('fill', color);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(root)}`;
}

function setBusy(isBusy) {
  elements.busyOverlay.hidden = !isBusy;
  if (isBusy) elements.traceStatus.textContent = 'Tracing…';
  elements.traceStatus.classList.toggle('busy', isBusy);
  elements.copyButton.disabled = isBusy || !state.finalSvg;
  elements.downloadButton.disabled = isBusy || !state.finalSvg;
  elements.showCodeButton.disabled = isBusy || !state.finalSvg;
}

async function traceImage() {
  if (!state.sourceCanvas) return;
  const sequence = ++state.traceSequence;
  setBusy(true);

  try {
    await engineReady;
    const context = state.sourceCanvas.getContext('2d', { willReadFrequently: true });
    const sourceImage = context.getImageData(0, 0, state.sourceCanvas.width, state.sourceCanvas.height);
    const raster = makeBinaryRaster(
      sourceImage.data,
      sourceImage.width,
      sourceImage.height,
      getTraceOptions(),
    );

    if (!raster) {
      throw new Error('No ink is visible at this threshold. Move the threshold toward “More ink”.');
    }

    const imageData = new ImageData(raster.data, raster.width, raster.height);
    const rawSvg = await potrace(imageData, {
      turdsize: Number(elements.speckles.value),
      turnpolicy: 4,
      alphamax: Number(elements.cornerSmoothing.value),
      opticurve: 1,
      opttolerance: Number(elements.curveTolerance.value),
      pathonly: false,
      extractcolors: false,
      posterizelevel: 1,
      posterizationalgorithm: 0,
    });

    if (sequence !== state.traceSequence) return;

    state.rawSvg = rawSvg;
    state.outputWidth = raster.width;
    state.outputHeight = raster.height;
    renderFinalSvg();
    elements.traceStatus.textContent = 'Ready';
    elements.traceStatus.classList.remove('error');
  } catch (error) {
    if (sequence !== state.traceSequence) return;
    console.error(error);
    state.rawSvg = '';
    state.finalSvg = '';
    revokeUrl('vectorUrl');
    elements.vectorPreview.removeAttribute('src');
    elements.svgCode.value = '';
    elements.traceStatus.textContent = 'Needs adjustment';
    elements.traceStatus.classList.add('error');
    showToast(error.message || 'The image could not be traced.', 'error');
  } finally {
    if (sequence === state.traceSequence) setBusy(false);
  }
}

function renderFinalSvg() {
  if (!state.rawSvg) return;
  state.finalSvg = colorizeSvg(state.rawSvg, elements.inkColor.value);
  revokeUrl('vectorUrl');
  state.vectorUrl = URL.createObjectURL(new Blob([state.finalSvg], { type: 'image/svg+xml' }));
  elements.vectorPreview.src = state.vectorUrl;
  elements.svgCode.value = state.finalSvg;

  const svgDocument = new DOMParser().parseFromString(state.finalSvg, 'image/svg+xml');
  const pathCount = svgDocument.querySelectorAll('path').length;
  const byteCount = new Blob([state.finalSvg]).size;
  elements.dimensionsStat.textContent = `${state.outputWidth}×${state.outputHeight} viewBox`;
  elements.pathsStat.textContent = `${pathCount} ${pathCount === 1 ? 'path' : 'paths'}`;
  elements.sizeStat.textContent = formatBytes(byteCount);
}

function scheduleTrace(delay = 180) {
  if (!state.sourceCanvas) return;
  window.clearTimeout(state.traceTimer);
  state.traceTimer = window.setTimeout(traceImage, delay);
}

function resetApp() {
  window.clearTimeout(state.traceTimer);
  state.traceSequence += 1;
  revokeUrl('sourceUrl');
  revokeUrl('vectorUrl');
  state.sourceCanvas = null;
  state.rawSvg = '';
  state.finalSvg = '';
  elements.sourcePreview.removeAttribute('src');
  elements.vectorPreview.removeAttribute('src');
  elements.emptyState.hidden = false;
  elements.loadedState.hidden = true;
  elements.compactDrop.hidden = true;
  elements.clearButton.hidden = true;
  elements.viewSwitcher.hidden = true;
  elements.resultBar.hidden = true;
  elements.codeDrawer.hidden = true;
  elements.fileInput.value = '';
}

async function pasteFromClipboard() {
  if (!navigator.clipboard?.read) {
    showToast('Press Ctrl+V (or ⌘V on Mac) to paste an image here.');
    return;
  }

  try {
    const clipboardItems = await navigator.clipboard.read();
    for (const item of clipboardItems) {
      const imageType = item.types.find((type) => type.startsWith('image/'));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      await loadFile(new File([blob], 'pasted-signature.png', { type: imageType }), 'Pasted image');
      return;
    }
    showToast('There is no image on the clipboard.', 'error');
  } catch (error) {
    if (error.name === 'NotAllowedError') {
      showToast('Clipboard access was blocked. Press Ctrl+V or choose an image instead.');
    } else {
      console.error(error);
      showToast('Could not read the clipboard. Press Ctrl+V instead.', 'error');
    }
  }
}

async function copySvg() {
  if (!state.finalSvg) return;

  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(state.finalSvg);
    } else {
      elements.copyFallback.value = state.finalSvg;
      elements.copyFallback.focus();
      elements.copyFallback.select();
      if (!document.execCommand('copy')) throw new Error('Copy command failed');
      elements.copyFallback.blur();
    }
    showToast('SVG copied to the clipboard.', 'success');
  } catch (error) {
    console.error(error);
    elements.codeDrawer.hidden = false;
    elements.svgCode.focus();
    elements.svgCode.select();
    showToast('Automatic copy was blocked. The SVG code is selected for you.', 'error');
  }
}

function downloadSvg() {
  if (!state.finalSvg) return;
  const url = URL.createObjectURL(new Blob([state.finalSvg], { type: 'image/svg+xml;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${state.sourceName}.svg`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
  showToast(`${state.sourceName}.svg downloaded.`, 'success');
}

function updateControlLabels() {
  elements.thresholdValue.textContent = elements.threshold.value;
  elements.smoothingValue.textContent = `${elements.smoothing.value} px`;
  elements.specklesValue.textContent = `${elements.speckles.value} px²`;
  elements.cornerSmoothingValue.textContent = Number(elements.cornerSmoothing.value).toFixed(2);
  elements.curveToleranceValue.textContent = Number(elements.curveTolerance.value).toFixed(2);
}

elements.fileInput.addEventListener('change', () => loadFile(elements.fileInput.files[0]));
elements.pasteButton.addEventListener('click', pasteFromClipboard);
elements.clearButton.addEventListener('click', resetApp);
elements.autoThresholdButton.addEventListener('click', () => setAutoThreshold(true));
elements.copyButton.addEventListener('click', copySvg);
elements.downloadButton.addEventListener('click', downloadSvg);
elements.showCodeButton.addEventListener('click', () => {
  elements.codeDrawer.hidden = !elements.codeDrawer.hidden;
  elements.showCodeButton.textContent = elements.codeDrawer.hidden ? 'View code' : 'Hide code';
});
elements.closeCodeButton.addEventListener('click', () => {
  elements.codeDrawer.hidden = true;
  elements.showCodeButton.textContent = 'View code';
});

for (const input of [
  elements.threshold,
  elements.smoothing,
  elements.speckles,
  elements.cornerSmoothing,
  elements.curveTolerance,
]) {
  input.addEventListener('input', () => {
    updateControlLabels();
    scheduleTrace();
  });
}

for (const input of [elements.trimMargins, elements.invertImage]) {
  input.addEventListener('change', () => scheduleTrace(0));
}

elements.inkColor.addEventListener('input', () => {
  elements.inkColorValue.textContent = elements.inkColor.value.toUpperCase();
  renderFinalSvg();
});

elements.viewSwitcher.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-view]');
  if (!button) return;
  elements.previewGrid.dataset.view = button.dataset.view;
  for (const option of elements.viewSwitcher.querySelectorAll('button')) {
    option.setAttribute('aria-pressed', String(option === button));
  }
});

document.addEventListener('paste', (event) => {
  const imageItem = [...event.clipboardData.items].find((item) => item.type.startsWith('image/'));
  if (!imageItem) return;
  event.preventDefault();
  const file = imageItem.getAsFile();
  if (file) loadFile(file, 'Pasted image');
});

let dragDepth = 0;
document.addEventListener('dragenter', (event) => {
  if (![...event.dataTransfer.types].includes('Files')) return;
  event.preventDefault();
  dragDepth += 1;
  elements.dropStage.classList.add('dragging');
});
document.addEventListener('dragover', (event) => {
  if (![...event.dataTransfer.types].includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', (event) => {
  if (![...event.dataTransfer.types].includes('Files')) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) elements.dropStage.classList.remove('dragging');
});
document.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  elements.dropStage.classList.remove('dragging');
  const imageFile = [...event.dataTransfer.files].find((file) => !file.type || file.type.startsWith('image/'));
  if (imageFile) loadFile(imageFile);
  else showToast('Drop a PNG, JPEG, WebP, GIF or BMP image.', 'error');
});

window.addEventListener('beforeunload', () => {
  revokeUrl('sourceUrl');
  revokeUrl('vectorUrl');
});

updateControlLabels();
