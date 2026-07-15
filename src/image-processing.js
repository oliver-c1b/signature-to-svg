export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 20_000_000;
export const MAX_IMAGE_EDGE = 5_000;

/**
 * Flatten RGBA pixels onto white and convert them to perceptual greyscale.
 * Fully transparent pixels remain white, including in inverted mode.
 */
export function rgbaToGrayscale(rgba, invert = false) {
  const grayscale = new Uint8ClampedArray(rgba.length / 4);

  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < rgba.length; sourceIndex += 4, targetIndex += 1) {
    const alpha = rgba[sourceIndex + 3] / 255;
    const luma =
      rgba[sourceIndex] * 0.2126 +
      rgba[sourceIndex + 1] * 0.7152 +
      rgba[sourceIndex + 2] * 0.0722;
    const inkValue = invert ? 255 - luma : luma;

    grayscale[targetIndex] = Math.round(inkValue * alpha + 255 * (1 - alpha));
  }

  return grayscale;
}

/** A fast two-pass box blur for softening noisy bitmap edges before thresholding. */
export function boxBlur(source, width, height, radius) {
  const safeRadius = Math.max(0, Math.round(radius));
  if (safeRadius === 0) return new Uint8ClampedArray(source);

  const horizontal = new Float32Array(source.length);
  const output = new Uint8ClampedArray(source.length);
  const diameter = safeRadius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    let sum = 0;

    for (let x = -safeRadius; x <= safeRadius; x += 1) {
      sum += source[rowOffset + Math.min(width - 1, Math.max(0, x))];
    }

    for (let x = 0; x < width; x += 1) {
      horizontal[rowOffset + x] = sum / diameter;
      const outgoingX = Math.max(0, x - safeRadius);
      const incomingX = Math.min(width - 1, x + safeRadius + 1);
      sum += source[rowOffset + incomingX] - source[rowOffset + outgoingX];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0;

    for (let y = -safeRadius; y <= safeRadius; y += 1) {
      sum += horizontal[Math.min(height - 1, Math.max(0, y)) * width + x];
    }

    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = Math.round(sum / diameter);
      const outgoingY = Math.max(0, y - safeRadius);
      const incomingY = Math.min(height - 1, y + safeRadius + 1);
      sum += horizontal[incomingY * width + x] - horizontal[outgoingY * width + x];
    }
  }

  return output;
}

/** Return an Otsu threshold that best separates a two-tone image histogram. */
export function otsuThreshold(grayscale) {
  if (!grayscale.length) return 128;

  const histogram = new Uint32Array(256);
  let totalLuma = 0;

  for (const value of grayscale) {
    histogram[value] += 1;
    totalLuma += value;
  }

  let backgroundWeight = 0;
  let backgroundLuma = 0;
  let bestVariance = -1;
  let bestThreshold = 128;

  for (let threshold = 0; threshold < 256; threshold += 1) {
    backgroundWeight += histogram[threshold];
    if (backgroundWeight === 0) continue;

    const foregroundWeight = grayscale.length - backgroundWeight;
    if (foregroundWeight === 0) break;

    backgroundLuma += threshold * histogram[threshold];
    const backgroundMean = backgroundLuma / backgroundWeight;
    const foregroundMean = (totalLuma - backgroundLuma) / foregroundWeight;
    const meanDifference = backgroundMean - foregroundMean;
    const betweenClassVariance = backgroundWeight * foregroundWeight * meanDifference * meanDifference;

    if (betweenClassVariance > bestVariance) {
      bestVariance = betweenClassVariance;
      bestThreshold = threshold;
    }
  }

  return bestThreshold;
}

export function findInkBounds(binary, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let inkPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (binary[y * width + x] >= 128) continue;

      inkPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (inkPixels === 0) return null;
  return { minX, minY, maxX, maxY, inkPixels };
}

/**
 * Prepare an exact black/white raster for Potrace and optionally crop it around ink.
 * Returns raw RGBA data so the function remains testable outside a browser.
 */
export function makeBinaryRaster(
  rgba,
  width,
  height,
  { threshold, invert = false, smoothing = 0, crop = true, padding = 12 },
) {
  const grayscale = boxBlur(rgbaToGrayscale(rgba, invert), width, height, smoothing);
  const binary = new Uint8ClampedArray(grayscale.length);

  for (let index = 0; index < grayscale.length; index += 1) {
    binary[index] = grayscale[index] <= threshold ? 0 : 255;
  }

  const bounds = findInkBounds(binary, width, height);
  if (!bounds) return null;

  const cropBounds = crop
    ? {
        minX: Math.max(0, bounds.minX - padding),
        minY: Math.max(0, bounds.minY - padding),
        maxX: Math.min(width - 1, bounds.maxX + padding),
        maxY: Math.min(height - 1, bounds.maxY + padding),
      }
    : { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };

  const outputWidth = cropBounds.maxX - cropBounds.minX + 1;
  const outputHeight = cropBounds.maxY - cropBounds.minY + 1;
  const output = new Uint8ClampedArray(outputWidth * outputHeight * 4);

  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const value = binary[(y + cropBounds.minY) * width + x + cropBounds.minX];
      const outputIndex = (y * outputWidth + x) * 4;
      output[outputIndex] = value;
      output[outputIndex + 1] = value;
      output[outputIndex + 2] = value;
      output[outputIndex + 3] = 255;
    }
  }

  return {
    data: output,
    width: outputWidth,
    height: outputHeight,
    inkPixels: bounds.inkPixels,
    bounds: cropBounds,
    grayscale,
  };
}

export function fitWithinLimits(width, height) {
  const edgeScale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  const pixelScale = Math.min(1, Math.sqrt(MAX_IMAGE_PIXELS / (width * height)));
  const scale = Math.min(edgeScale, pixelScale);

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}
