/**
 * Image processing utilities for expense receipt files.
 *
 * Handles magic-byte validation, HEIC→JPEG conversion, and image
 * optimisation (resize + compress) via sharp.
 */

// ---------------------------------------------------------------------------
// Magic-byte signatures
// ---------------------------------------------------------------------------

const MAGIC_BYTES: Array<{ mimeType: string; bytes: number[]; offset?: number }> = [
  { mimeType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mimeType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  // WebP: starts with RIFF....WEBP
  { mimeType: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
  { mimeType: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
]

/** Allowed MIME types after validation. */
export type ValidMimeType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/heic'
  | 'image/heif'
  | 'application/pdf'

export interface FileTypeResult {
  valid: boolean
  mimeType: ValidMimeType | null
}

/**
 * Validate a file buffer by checking magic bytes.
 * Returns the detected MIME type if valid, or null if the file type is
 * not in the allow-list.
 */
export function validateFileType(buffer: Buffer): FileTypeResult {
  if (buffer.length < 12) {
    return { valid: false, mimeType: null }
  }

  // Check standard magic bytes
  for (const sig of MAGIC_BYTES) {
    const offset = sig.offset ?? 0
    const match = sig.bytes.every((b, i) => buffer[offset + i] === b)
    if (match) {
      // Extra check: WebP needs bytes 8-11 to be "WEBP"
      if (sig.mimeType === 'image/webp') {
        const webpTag = buffer.slice(8, 12).toString('ascii')
        if (webpTag !== 'WEBP') {
          continue
        }
      }
      return { valid: true, mimeType: sig.mimeType as ValidMimeType }
    }
  }

  // HEIC/HEIF: ftyp box at offset 4
  if (isHeicBuffer(buffer)) {
    return { valid: true, mimeType: 'image/heic' }
  }

  return { valid: false, mimeType: null }
}

/**
 * Detect HEIC/HEIF by searching for the 'ftyp' box marker and known
 * HEIC brand codes.
 */
function isHeicBuffer(buffer: Buffer): boolean {
  // ftyp box: bytes 4-7 should be "ftyp"
  if (buffer.length < 12) return false
  const ftyp = buffer.slice(4, 8).toString('ascii')
  if (ftyp !== 'ftyp') return false

  // Brand at bytes 8-11
  const brand = buffer.slice(8, 12).toString('ascii')
  const heicBrands = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']
  return heicBrands.includes(brand)
}

// ---------------------------------------------------------------------------
// Image optimisation
// ---------------------------------------------------------------------------

export interface OptimiseResult {
  buffer: Buffer
  mimeType: string
  width: number
  height: number
  originalSizeBytes: number
  optimisedSizeBytes: number
}

const MAX_DIMENSION = 2000
const MAX_MEGAPIXELS = 50_000_000
const JPEG_QUALITY = 80
const WEBP_QUALITY = 80
const PNG_COMPRESSION_LEVEL = 6

/**
 * Resize and compress an image buffer.
 *
 * - Images are resized so the longest edge is at most 2000px.
 * - HEIC/HEIF images are converted to JPEG.
 * - PDFs are returned as-is (no processing).
 * - sharp is imported dynamically to handle environments where it may
 *   not be available.
 */
export async function optimiseImage(
  buffer: Buffer,
  mimeType: ValidMimeType
): Promise<OptimiseResult> {
  if (mimeType === 'application/pdf') {
    return {
      buffer,
      mimeType: 'application/pdf',
      width: 0,
      height: 0,
      originalSizeBytes: buffer.length,
      optimisedSizeBytes: buffer.length,
    }
  }

  // Dynamic import — sharp is a native module that may not be available
  // in all environments (e.g. edge runtime).
  const sharp = (await import('sharp')).default

  const originalSize = buffer.length
  let pipeline = sharp(buffer, { failOn: 'none' })

  // Get metadata for dimension check
  const metadata = await pipeline.metadata()
  const { width = 0, height = 0 } = metadata

  // Reject images over 50 megapixels to prevent decompression bombs
  if (width * height > MAX_MEGAPIXELS) {
    throw new Error(
      `Image is too large (${Math.round((width * height) / 1_000_000)}MP). Maximum is 50MP.`
    )
  }

  // Resize if either dimension exceeds the max
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    pipeline = pipeline.resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  // Rotate based on EXIF orientation, then strip metadata
  pipeline = pipeline.rotate()

  // Convert / compress based on type
  let outputMimeType: string
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    // Convert HEIC → JPEG
    pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    outputMimeType = 'image/jpeg'
  } else if (mimeType === 'image/jpeg') {
    pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    outputMimeType = 'image/jpeg'
  } else if (mimeType === 'image/png') {
    pipeline = pipeline.png({ compressionLevel: PNG_COMPRESSION_LEVEL })
    outputMimeType = 'image/png'
  } else if (mimeType === 'image/webp') {
    pipeline = pipeline.webp({ quality: WEBP_QUALITY })
    outputMimeType = 'image/webp'
  } else {
    // Fallback to JPEG
    pipeline = pipeline.jpeg({ quality: JPEG_QUALITY })
    outputMimeType = 'image/jpeg'
  }

  const optimisedBuffer = await pipeline.toBuffer()
  const finalMeta = await sharp(optimisedBuffer).metadata()

  return {
    buffer: optimisedBuffer,
    mimeType: outputMimeType,
    width: finalMeta.width ?? 0,
    height: finalMeta.height ?? 0,
    originalSizeBytes: originalSize,
    optimisedSizeBytes: optimisedBuffer.length,
  }
}

/**
 * Get the file extension for a given MIME type.
 * HEIC/HEIF files are converted to JPEG, so return .jpg.
 */
export function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/heic':
    case 'image/heif':
      return 'jpg' // HEIC converted to JPEG
    case 'application/pdf':
      return 'pdf'
    default:
      return 'bin'
  }
}
