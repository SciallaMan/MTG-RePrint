/** pdf-lib cannot embed WebP, so those images are re-encoded as PNG with a canvas. */
export async function webpToPng(data: Uint8Array): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/webp' }));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('The browser cannot convert WebP images');
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The browser could not convert a WebP image to PNG');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}
