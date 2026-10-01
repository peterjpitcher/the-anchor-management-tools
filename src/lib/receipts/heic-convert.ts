/**
 * iPhone photos (HEIC) turned into JPEG in the browser before a receipt is uploaded.
 *
 * A HEIC used to be accepted and stored as it was. The accountant's computer may not open one,
 * and the server cannot convert it: its image library is built without the decoder iPhone
 * photos need (see src/lib/maintenance/photo-normalise.ts, which found that out). The browser
 * that chose the photo can usually read it, so the conversion happens there, on a canvas.
 *
 * If the browser cannot read the photo, the upload stops with a plain message. A file is never
 * stored in a form we cannot show.
 */

import {
  MaintenancePhotoError,
  browserPhotoNormaliseDeps,
  normaliseMaintenancePhoto,
  type PhotoNormaliseDeps,
} from '@/lib/maintenance/photo-normalise'
import { MAX_RECEIPT_FILE_UPLOAD_BYTES } from './upload-constraints'

/** Large enough for small print on a till receipt to stay readable. */
const RECEIPT_PHOTO_MAX_EDGE = 3000
const RECEIPT_PHOTO_JPEG_QUALITY = 0.85

export const HEIC_UNREADABLE_MESSAGE =
  'This iPhone photo (HEIC) could not be converted here. Take a screenshot of it and upload that, or on the iPhone choose Settings, Camera, Formats, Most Compatible.'

export class ReceiptPhotoError extends Error {
  constructor(readonly userMessage: string, cause?: unknown) {
    super(userMessage)
    this.name = 'ReceiptPhotoError'
    if (cause !== undefined) this.cause = cause
  }
}

/** Whether the file is an iPhone HEIC or HEIF photo, by its type or, failing that, its name. */
export function isHeicFile(file: Pick<File, 'name' | 'type'>): boolean {
  const type = (file.type ?? '').toLowerCase()
  if (type === 'image/heic' || type === 'image/heif' || type === 'image/heic-sequence' || type === 'image/heif-sequence') {
    return true
  }
  return /\.(heic|heif)$/i.test(file.name ?? '')
}

/**
 * The file to upload. Anything that is not HEIC is returned as it is. A HEIC comes back as a
 * JPEG with the same name and a `.jpg` ending.
 *
 * @throws ReceiptPhotoError with a message fit for the screen when the browser cannot read it.
 */
export async function prepareReceiptFileForUpload(
  file: File,
  deps: PhotoNormaliseDeps = browserPhotoNormaliseDeps
): Promise<File> {
  if (!isHeicFile(file)) return file

  try {
    const converted = await normaliseMaintenancePhoto(file, deps, {
      maxEdge: RECEIPT_PHOTO_MAX_EDGE,
      quality: RECEIPT_PHOTO_JPEG_QUALITY,
      maxBytes: MAX_RECEIPT_FILE_UPLOAD_BYTES,
    })
    return converted.file
  } catch (error) {
    // The maintenance messages talk about "that photo" in its own words. Receipts say what to do.
    throw new ReceiptPhotoError(HEIC_UNREADABLE_MESSAGE, error instanceof MaintenancePhotoError ? error.cause ?? error : error)
  }
}
