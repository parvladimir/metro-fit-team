// Client-side image preparation for chat attachments. Pure sizing math lives
// in fitWithin() so it can be unit tested; the canvas parts only run in a
// browser.

export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const MAX_FULL_DIMENSION = 1800;
export const THUMB_DIMENSION = 480;
export const ACCEPTED_INPUT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export class ImageError extends Error {}

export interface PreparedImage {
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
  mime: 'image/webp' | 'image/jpeg';
  extension: 'webp' | 'jpg';
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function render(bitmap: ImageBitmap, dims: { width: number; height: number }, quality: number) {
  const canvas = document.createElement('canvas');
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageError('Bild konnte nicht verarbeitet werden.');
  ctx.drawImage(bitmap, 0, 0, dims.width, dims.height);

  // Safari < 17 cannot encode WebP and silently returns PNG — detect and fall back to JPEG.
  const webp = await canvasToBlob(canvas, 'image/webp', quality);
  if (webp && webp.type === 'image/webp') return { blob: webp, mime: 'image/webp' as const, extension: 'webp' as const };
  const jpeg = await canvasToBlob(canvas, 'image/jpeg', quality);
  if (!jpeg) throw new ImageError('Bild konnte nicht verarbeitet werden.');
  return { blob: jpeg, mime: 'image/jpeg' as const, extension: 'jpg' as const };
}

export async function prepareChatImage(file: File): Promise<PreparedImage> {
  const lower = file.name.toLowerCase();
  const isHeic = /hei[cf]$/.test(lower) || /hei[cf]/.test(file.type);
  if (!isHeic && !ACCEPTED_INPUT_TYPES.includes(file.type)) {
    throw new ImageError('Nur JPEG-, PNG- und WebP-Bilder werden unterstützt.');
  }
  if (file.size > MAX_INPUT_BYTES) throw new ImageError('Das Bild ist zu groß (max. 25 MB).');

  let bitmap: ImageBitmap;
  try {
    // imageOrientation: 'from-image' keeps iPhone photos upright.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageError(
      isHeic
        ? 'HEIC-Fotos werden hier nicht unterstützt. Bitte wähle ein JPEG oder PNG.'
        : 'Das Bild konnte nicht gelesen werden.'
    );
  }

  const fullDims = fitWithin(bitmap.width, bitmap.height, MAX_FULL_DIMENSION);
  const thumbDims = fitWithin(bitmap.width, bitmap.height, THUMB_DIMENSION);
  const full = await render(bitmap, fullDims, 0.82);
  const thumb = await render(bitmap, thumbDims, 0.72);
  bitmap.close();

  if (full.blob.size > 4.5 * 1024 * 1024) throw new ImageError('Das Bild ist auch nach der Komprimierung zu groß.');

  return { full: full.blob, thumb: thumb.blob, width: fullDims.width, height: fullDims.height, mime: full.mime, extension: full.extension };
}
