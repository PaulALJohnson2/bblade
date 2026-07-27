/**
 * documentCapture — turn a photographed or uploaded document into something
 * small enough to both send to the model and keep as proof of delivery.
 *
 * A phone camera photo of a delivery note is 3–8 MB, which is fine to send but
 * far too big to keep: the note lives in its Firestore doc (no Storage bucket in
 * this project), and a Firestore document is capped at 1 MB total — including
 * the extracted lines and base64's ~33% overhead. So photos are downscaled and
 * re-encoded until they fit the budget, biasing towards keeping RESOLUTION over
 * fidelity: a delivery note is dense small print, and legibility of the item
 * codes matters more than clean gradients.
 *
 * PDFs pass through untouched (rendering one would mean pulling in pdf.js for a
 * file that's usually already tiny). An oversized PDF is still parsed — it just
 * isn't kept, and says so.
 */

/** Comfortably inside the 1 MB doc limit once lines + metadata are added. */
const MAX_STORED_BYTES = 600_000;
/** List thumbnail: rides on the note's metadata doc, so it must stay tiny. */
const THUMB_DIMENSION = 220;
const THUMB_QUALITY = 0.6;
/** Wide enough that 8pt item codes survive; the note is landscape A4. */
const MAX_DIMENSION = 1800;
const QUALITY_STEPS = [0.75, 0.6, 0.5, 0.4];
const DIMENSION_STEPS = [1800, 1500, 1200];

export const ACCEPTED_TYPES = 'image/*,application/pdf';

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');

/**
 * Some Android gallery pickers hand back a File with an empty `type`, so the
 * MIME type alone would reject a perfectly good screenshot. Fall back to the
 * extension, same as the PDF check.
 */
const isImage = (file) => (file.type || '').startsWith('image/')
  || /\.(jpe?g|png|heic|heif|webp|gif|bmp|avif)$/i.test(file.name || '');

/** base64 payload of a data: URL. */
const payloadOf = (dataUrl) => dataUrl.slice(dataUrl.indexOf(',') + 1);

/** Decoded byte length of a base64 string. */
const bytesOf = (b64) => Math.floor(b64.length * 3 / 4);

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Draw an already-decoded bitmap at a bounded size and encode as JPEG.
 * Decoding is done once by the caller — re-decoding an 8-megapixel phone photo
 * for every quality attempt is slow enough to feel broken on a mid-range phone.
 */
function encodeAtSize(bitmap, maxDim, quality) {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // White ground: a transparent PNG flattened onto black would lose the text.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);

  return { dataUrl: canvas.toDataURL('image/jpeg', quality), width, height };
}

/**
 * Prepare a captured document for parsing and storage.
 *
 * @param {File} file
 * @returns {Promise<{ base64, mimeType, dataUrl, bytes, fileName, storable, width?, height? }>}
 *   base64/mimeType feed the model; dataUrl is kept when `storable`.
 */
export async function prepareDocument(file) {
  if (!file) throw new Error('No file');

  if (isPdf(file)) {
    const dataUrl = await readAsDataUrl(file);
    const base64 = payloadOf(dataUrl);
    const bytes = bytesOf(base64);
    return {
      base64,
      mimeType: 'application/pdf',
      dataUrl,
      bytes,
      fileName: file.name || 'delivery-note.pdf',
      storable: bytes <= MAX_STORED_BYTES,
    };
  }

  if (!isImage(file)) {
    throw new Error('Please choose a photo or a PDF');
  }

  // imageOrientation:'from-image' applies the EXIF rotation a phone writes, so
  // notes photographed in portrait don't arrive sideways.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const thumb = encodeAtSize(bitmap, THUMB_DIMENSION, THUMB_QUALITY);

  let best = null;
  for (const maxDim of DIMENSION_STEPS) {
    for (const quality of QUALITY_STEPS) {
      const encoded = encodeAtSize(bitmap, maxDim, quality);
      const base64 = payloadOf(encoded.dataUrl);
      best = { ...encoded, base64, bytes: bytesOf(base64) };
      if (best.bytes <= MAX_STORED_BYTES) break;
    }
    if (best.bytes <= MAX_STORED_BYTES) break;
  }
  bitmap.close?.();

  // If nothing got under budget (a very large, very detailed scan) the document
  // is still parsed — it just isn't kept.
  return {
    base64: best.base64,
    mimeType: 'image/jpeg',
    dataUrl: best.dataUrl,
    thumbDataUrl: thumb.dataUrl,
    bytes: best.bytes,
    width: best.width,
    height: best.height,
    fileName: file.name || 'delivery-note.jpg',
    storable: best.bytes <= MAX_STORED_BYTES,
  };
}

/** True on devices with a rear camera worth offering ("Take photo"). */
export function supportsCameraCapture() {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}
