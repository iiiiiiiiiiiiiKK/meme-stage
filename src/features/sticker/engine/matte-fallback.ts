import { createCanvas, ctx2d } from './image';

/**
 * Deterministic, dependency-free fallback matte.
 *
 * It is only used when the neural matte (RVM) cannot run in the current browser
 * (no WebGL/WASM support, model file missing, memory pressure). It estimates the
 * background colour from the image border and removes connected regions that are
 * close to it, which works well for studio/screenshot-style images and is clearly
 * labelled in the UI as a fallback rather than as a neural result.
 */
export function colorMatte(canvas: HTMLCanvasElement): {
  alpha: Uint8ClampedArray;
  width: number;
  height: number;
  note: string;
} {
  const { width, height } = canvas;
  const data = ctx2d(canvas).getImageData(0, 0, width, height).data;
  const border: Array<[number, number, number]> = [];
  const stepX = Math.max(1, Math.floor(width / 48));
  const stepY = Math.max(1, Math.floor(height / 48));
  for (let x = 0; x < width; x += stepX) {
    for (const y of [0, 1, height - 2, height - 1]) {
      const p = (y * width + x) * 4;
      border.push([data[p], data[p + 1], data[p + 2]]);
    }
  }
  for (let y = 0; y < height; y += stepY) {
    for (const x of [0, 1, width - 2, width - 1]) {
      const p = (y * width + x) * 4;
      border.push([data[p], data[p + 1], data[p + 2]]);
    }
  }
  const mean = border.reduce(
    (acc, [r, g, b]) => [acc[0] + r / border.length, acc[1] + g / border.length, acc[2] + b / border.length],
    [0, 0, 0],
  );
  const variance =
    border.reduce((acc, [r, g, b]) => {
      const d = (r - mean[0]) ** 2 + (g - mean[1]) ** 2 + (b - mean[2]) ** 2;
      return acc + d / border.length;
    }, 0) / 3;
  const spread = Math.sqrt(variance);

  // If the border is very busy, plain colour keying would eat the subject.
  if (spread > 62) {
    return {
      alpha: new Uint8ClampedArray(width * height).fill(255),
      width,
      height,
      note: 'Background is too complex for the colour fallback; only neural matting can separate it.',
    };
  }

  const tolerance = Math.max(26, spread * 1.9);
  const alpha = new Uint8ClampedArray(width * height).fill(255);
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  const matches = (idx: number) => {
    const p = idx * 4;
    const dr = data[p] - mean[0];
    const dg = data[p + 1] - mean[1];
    const db = data[p + 2] - mean[2];
    return Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance;
  };

  const pushSeeds = (idx: number) => {
    if (idx >= 0 && idx < width * height && !visited[idx] && matches(idx)) {
      visited[idx] = 1;
      stack.push(idx);
    }
  };
  for (let x = 0; x < width; x++) {
    pushSeeds(x);
    pushSeeds((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    pushSeeds(y * width);
    pushSeeds(y * width + width - 1);
  }

  while (stack.length) {
    const idx = stack.pop() as number;
    alpha[idx] = 0;
    const x = idx % width;
    const y = (idx - x) / width;
    if (x > 0) pushSeeds(idx - 1);
    if (x < width - 1) pushSeeds(idx + 1);
    if (y > 0) pushSeeds(idx - width);
    if (y < height - 1) pushSeeds(idx + width);
  }

  return {
    alpha,
    width,
    height,
    note: `Colour fallback used (background spread ${spread.toFixed(0)}). Neural matting was not available.`,
  };
}

/** Renders an alpha channel as a visible mask preview canvas. */
export function alphaPreview(alpha: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const ctx = ctx2d(canvas);
  const image = ctx.createImageData(width, height);
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    image.data[p] = image.data[p + 1] = image.data[p + 2] = alpha[i];
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
