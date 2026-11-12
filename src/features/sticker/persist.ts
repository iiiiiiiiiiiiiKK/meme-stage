/** Read intrinsic pixel size from a generated blob. */
export async function measureBlob(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    // Fall back to decoding through a canvas, which also covers browsers without
    // createImageBitmap for this format.
    try {
      const url = URL.createObjectURL(blob);
      try {
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("decode failed"));
          image.src = url;
        });
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          return { width: image.naturalWidth, height: image.naturalHeight };
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      /* ignore */
    }
    return { width: 1024, height: 1024 };
  }
}
