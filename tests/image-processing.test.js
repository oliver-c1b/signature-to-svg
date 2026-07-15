import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boxBlur,
  findInkBounds,
  fitWithinLimits,
  makeBinaryRaster,
  otsuThreshold,
  rgbaToGrayscale,
} from '../src/image-processing.js';

test('transparent pixels remain white in normal and inverted modes', () => {
  const transparentBlack = new Uint8ClampedArray([0, 0, 0, 0]);
  assert.deepEqual([...rgbaToGrayscale(transparentBlack, false)], [255]);
  assert.deepEqual([...rgbaToGrayscale(transparentBlack, true)], [255]);
});

test('inversion turns opaque white ink dark', () => {
  const white = new Uint8ClampedArray([255, 255, 255, 255]);
  assert.deepEqual([...rgbaToGrayscale(white, true)], [0]);
});

test('box blur retains dimensions and spreads a dark pixel', () => {
  const source = new Uint8ClampedArray([255, 255, 255, 255, 0, 255, 255, 255, 255]);
  const output = boxBlur(source, 3, 3, 1);
  assert.equal(output.length, source.length);
  assert.ok(output[4] > 0 && output[4] < 255);
  assert.ok(output[1] < 255);
});

test('Otsu separates a simple black and white image', () => {
  const pixels = new Uint8ClampedArray([0, 0, 0, 255, 255, 255]);
  assert.ok(otsuThreshold(pixels) < 255);
});

test('ink bounds enclose all black pixels', () => {
  const binary = new Uint8ClampedArray([
    255, 255, 255, 255,
    255, 0, 0, 255,
    255, 255, 0, 255,
  ]);
  assert.deepEqual(findInkBounds(binary, 4, 3), {
    minX: 1,
    minY: 1,
    maxX: 2,
    maxY: 2,
    inkPixels: 3,
  });
});

test('binary raster crops around ink and adds padding', () => {
  const rgba = new Uint8ClampedArray(5 * 5 * 4).fill(255);
  const center = (2 * 5 + 2) * 4;
  rgba[center] = 0;
  rgba[center + 1] = 0;
  rgba[center + 2] = 0;
  const raster = makeBinaryRaster(rgba, 5, 5, {
    threshold: 128,
    smoothing: 0,
    crop: true,
    padding: 1,
  });
  assert.equal(raster.width, 3);
  assert.equal(raster.height, 3);
  assert.equal(raster.inkPixels, 1);
  assert.equal(raster.data[(1 * 3 + 1) * 4], 0);
});

test('dimension fitting caps huge images without distortion', () => {
  const result = fitWithinLimits(10_000, 5_000);
  assert.equal(result.width / result.height, 2);
  assert.ok(result.width <= 5_000);
  assert.ok(result.width * result.height <= 20_000_000);
});
