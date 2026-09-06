/**
 * Client-side photo normalisation for the maintenance tracker.
 *
 * Why the work happens in the browser rather than on the server, where resizing
 * would obviously belong:
 *
 * 1. Vercel rejects request bodies over about 4.49MB at the proxy, before the
 *    function is invoked. Verified live against production: 4,492,000 bytes
 *    accepted, 4,494,000 bytes returns 413 FUNCTION_PAYLOAD_TOO_LARGE.
 *    `next.config.mjs` sets `bodySizeLimit: '20mb'`, but that only raises the
 *    Next.js framework cap and cannot raise the platform cap. Server-side
 *    resizing can never help, because the code never runs.
 * 2. sharp's prebuilt binaries bundle libheif without the libde265 HEVC decoder,
 *    so a real iPhone HEIC throws "Support for this compression format has not
 *    been built in". `sharp.format.heif.input === true` refers to AVIF, not HEIC.
 *    Do not route HEIC through `optimiseImage()` in
 *    `src/lib/expenses/imageProcessor.ts`, and do not try to make server-side
 *    HEIC work.
 * 3. iOS cannot be relied on to transcode for us either. WebKit's
 *    accept-attribute HEIC logic is `#if PLATFORM(MAC)`, the iOS JPEG conversion
 *    comes from PHPicker "Compatible" mode which is not keyed to `accept`, and
 *    Files-app picks deliver raw HEIC.
 *
 * So the browser draws the chosen file onto a canvas. That bounds the pixel size,
 * applies EXIF orientation as it draws, strips the remaining metadata and
 * normalises the format to JPEG. On iOS Safari, which decodes HEIC natively, this
 * is also where HEIC becomes JPEG, which is where the conversion belongs.
 *
 * If the browser cannot decode the file, the decode or the draw throws. That is
 * caught and turned into plain English. A raw codec error is never shown.
 */

/** The private bucket created by 20260905210000_maintenance_tracker.sql. */
export const MAINTENANCE_PHOTO_BUCKET = 'maintenance-photos'

/**
 * HEIC is deliberately absent. It also stops Safari 17+ converting a JPEG into
 * HEIC on the way out of the picker.
 */
export const MAINTENANCE_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp'

/** Mime types the bucket and the CHECK constraint will accept. */
export const MAINTENANCE_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type MaintenancePhotoMimeType = (typeof MAINTENANCE_PHOTO_MIME_TYPES)[number]

export const MAINTENANCE_PHOTO_MAX_EDGE = 2000
export const MAINTENANCE_PHOTO_JPEG_QUALITY = 0.8
export const MAINTENANCE_PHOTO_OUTPUT_MIME: MaintenancePhotoMimeType = 'image/jpeg'

/** Matches storage.buckets.file_size_limit for maintenance-photos. */
export const MAINTENANCE_PHOTO_MAX_BYTES = 10 * 1024 * 1024

/**
 * The one message shown when the browser cannot read the chosen file. Exported so
 * the component and the tests assert on the same string rather than on a copy.
 */
export const UNREADABLE_PHOTO_MESSAGE =
  'That photo could not be read. On an iPhone, try Settings, Camera, Formats, Most Compatible, or choose a different photo.'

export const OVERSIZE_PHOTO_MESSAGE =
  'That photo is still too large after resizing. Please choose a different photo.'

/**
 * An error carrying a message that is safe to show a person. Anything thrown by a
 * codec is kept in `cause` for the console and never surfaced.
 */
export class MaintenancePhotoError extends Error {
  readonly userMessage: string

  constructor(userMessage: string, cause?: unknown) {
    super(userMessage)
    this.name = 'MaintenancePhotoError'
    this.userMessage = userMessage
    if (cause !== undefined) {
      this.cause = cause
    }
  }
}

/** Turn anything thrown into a message fit for the screen. */
export function maintenancePhotoErrorMessage(error: unknown): string {
  if (error instanceof MaintenancePhotoError) return error.userMessage
  return 'Something went wrong with that photo. Please try again.'
}

export interface DecodedPhoto {
  width: number
  height: number
  source: CanvasImageSource
  /** Releases the decoded bitmap or object URL. Always called, success or not. */
  release?: () => void
}

export interface PhotoNormaliseDeps {
  /** Decode a file into something drawable. Throws if the browser cannot read it. */
  decode(file: Blob): Promise<DecodedPhoto>
  /** Draw the decoded image at the target size and encode it as JPEG. */
  encodeJpeg(photo: DecodedPhoto, width: number, height: number, quality: number): Promise<Blob>
}

export interface NormalisedMaintenancePhoto {
  /** JPEG bytes ready for uploadToSignedUrl. */
  file: File
  width: number
  height: number
  mimeType: MaintenancePhotoMimeType
  byteSize: number
  /** The name the person chose, kept for the file_name column only. */
  originalFileName: string
  originalByteSize: number
}

/**
 * Scale the longest edge down to `maxEdge`. Never upscales: a small photo is left
 * at its own size rather than being blown up and re-encoded.
 */
export function computeScaledDimensions(
  width: number,
  height: number,
  maxEdge: number = MAINTENANCE_PHOTO_MAX_EDGE
): { width: number; height: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new MaintenancePhotoError(UNREADABLE_PHOTO_MESSAGE)
  }

  const longest = Math.max(width, height)
  if (longest <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height) }
  }

  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Replace whatever extension the file had with .jpg, since the output is JPEG. */
export function jpegFileName(originalName: string): string {
  const trimmed = (originalName ?? '').trim()
  const base = trimmed.replace(/\.[^./\\]+$/, '').replace(/[\\/]/g, '-')
  return `${base.length > 0 ? base.slice(0, 100) : 'photo'}.jpg`
}

function releaseQuietly(photo: DecodedPhoto | null): void {
  try {
    photo?.release?.()
  } catch {
    // Releasing a bitmap or revoking an object URL must never mask a real error.
  }
}

/**
 * The browser implementation. `createImageBitmap` is preferred because
 * `imageOrientation: 'from-image'` makes EXIF orientation explicit rather than
 * leaving it to per-browser `<img>` behaviour. The `<img>` route is the fallback
 * for anything that does not implement it.
 */
export const browserPhotoNormaliseDeps: PhotoNormaliseDeps = {
  async decode(file: Blob): Promise<DecodedPhoto> {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
        if (bitmap.width > 0 && bitmap.height > 0) {
          return {
            width: bitmap.width,
            height: bitmap.height,
            source: bitmap,
            release: () => bitmap.close?.(),
          }
        }
        bitmap.close?.()
      } catch {
        // Fall through to the <img> route, which some browsers decode when
        // createImageBitmap refuses.
      }
    }

    return new Promise<DecodedPhoto>((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file)
      const probe = new Image()
      probe.onload = () => {
        if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
          resolve({
            width: probe.naturalWidth,
            height: probe.naturalHeight,
            source: probe,
            release: () => URL.revokeObjectURL(objectUrl),
          })
          return
        }
        URL.revokeObjectURL(objectUrl)
        reject(new MaintenancePhotoError(UNREADABLE_PHOTO_MESSAGE))
      }
      probe.onerror = (event) => {
        URL.revokeObjectURL(objectUrl)
        reject(new MaintenancePhotoError(UNREADABLE_PHOTO_MESSAGE, event))
      }
      probe.src = objectUrl
    })
  },

  async encodeJpeg(photo, width, height, quality): Promise<Blob> {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) {
      throw new MaintenancePhotoError(UNREADABLE_PHOTO_MESSAGE)
    }

    // JPEG has no alpha channel, so a transparent PNG would otherwise come out
    // with black where it was see-through.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(photo.source, 0, 0, width, height)

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob && blob.size > 0) {
            resolve(blob)
            return
          }
          reject(new MaintenancePhotoError(UNREADABLE_PHOTO_MESSAGE))
        },
        MAINTENANCE_PHOTO_OUTPUT_MIME,
        quality
      )
    })
  },
}

export interface NormaliseOptions {
  maxEdge?: number
  quality?: number
  maxBytes?: number
}

/**
 * Normalise a chosen file into an uploadable JPEG.
 *
 * The file's declared mime type is deliberately not checked here. `accept` already
 * filters the picker, and a HEIC that arrives anyway should be converted on iOS
 * rather than refused. Whether the browser can read it is decided by trying, not
 * by trusting the label.
 */
export async function normaliseMaintenancePhoto(
  file: File,
  deps: PhotoNormaliseDeps = browserPhotoNormaliseDeps,
  options: NormaliseOptions = {}
): Promise<NormalisedMaintenancePhoto> {
  const maxEdge = options.maxEdge ?? MAINTENANCE_PHOTO_MAX_EDGE
  const quality = options.quality ?? MAINTENANCE_PHOTO_JPEG_QUALITY
  const maxBytes = options.maxBytes ?? MAINTENANCE_PHOTO_MAX_BYTES

  if (!file || file.size === 0) {
    throw new MaintenancePhotoError(UNREADABLE_PHOTO_MESSAGE)
  }

  let decoded: DecodedPhoto | null = null
  let blob: Blob

  try {
    decoded = await deps.decode(file)
    const target = computeScaledDimensions(decoded.width, decoded.height, maxEdge)
    blob = await deps.encodeJpeg(decoded, target.width, target.height, quality)

    if (!blob || blob.size === 0) {
      throw new MaintenancePhotoError(UNREADABLE_PHOTO_MESSAGE)
    }

    if (blob.size > maxBytes) {
      throw new MaintenancePhotoError(OVERSIZE_PHOTO_MESSAGE)
    }

    const name = jpegFileName(file.name)
    return {
      file: new File([blob], name, {
        type: MAINTENANCE_PHOTO_OUTPUT_MIME,
        lastModified: Date.now(),
      }),
      width: target.width,
      height: target.height,
      mimeType: MAINTENANCE_PHOTO_OUTPUT_MIME,
      byteSize: blob.size,
      originalFileName: file.name,
      originalByteSize: file.size,
    }
  } catch (error) {
    if (error instanceof MaintenancePhotoError) throw error
    // Anything a codec threw stays in cause and out of the interface.
    throw new MaintenancePhotoError(UNREADABLE_PHOTO_MESSAGE, error)
  } finally {
    releaseQuietly(decoded)
  }
}
