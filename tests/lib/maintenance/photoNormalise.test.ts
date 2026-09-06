import { describe, expect, it, vi } from 'vitest'
import {
  MAINTENANCE_PHOTO_ACCEPT,
  MAINTENANCE_PHOTO_MAX_EDGE,
  MaintenancePhotoError,
  OVERSIZE_PHOTO_MESSAGE,
  UNREADABLE_PHOTO_MESSAGE,
  computeScaledDimensions,
  jpegFileName,
  maintenancePhotoErrorMessage,
  normaliseMaintenancePhoto,
  type DecodedPhoto,
  type PhotoNormaliseDeps,
} from '@/lib/maintenance/photo-normalise'

function decodedAt(width: number, height: number, release = vi.fn()): DecodedPhoto {
  return { width, height, source: {} as unknown as CanvasImageSource, release }
}

function depsFor(
  decoded: DecodedPhoto,
  encoded: Blob,
  captured?: { width?: number; height?: number; quality?: number }
): PhotoNormaliseDeps {
  return {
    decode: vi.fn(async () => decoded),
    encodeJpeg: vi.fn(async (_photo, width, height, quality) => {
      if (captured) {
        captured.width = width
        captured.height = height
        captured.quality = quality
      }
      return encoded
    }),
  }
}

describe('maintenance photo normalisation', () => {
  it('excludes HEIC from the accept attribute', () => {
    // Deliberate. Server-side HEIC decoding does not work on the production
    // runtime, and this also stops Safari 17+ turning a JPEG into HEIC.
    expect(MAINTENANCE_PHOTO_ACCEPT).toBe('image/jpeg,image/png,image/webp')
    expect(MAINTENANCE_PHOTO_ACCEPT).not.toContain('heic')
    expect(MAINTENANCE_PHOTO_ACCEPT).not.toContain('heif')
  })

  describe('computeScaledDimensions', () => {
    it('scales the longest edge down to the cap and keeps the aspect ratio', () => {
      expect(computeScaledDimensions(4032, 3024)).toEqual({ width: 2000, height: 1500 })
      expect(computeScaledDimensions(3024, 4032)).toEqual({ width: 1500, height: 2000 })
    })

    it('never upscales a photo that is already small', () => {
      expect(computeScaledDimensions(640, 480)).toEqual({ width: 640, height: 480 })
    })

    it('leaves a photo exactly on the cap alone', () => {
      expect(computeScaledDimensions(MAINTENANCE_PHOTO_MAX_EDGE, 1000)).toEqual({
        width: MAINTENANCE_PHOTO_MAX_EDGE,
        height: 1000,
      })
    })

    it('never collapses an extreme panorama to a zero edge', () => {
      const scaled = computeScaledDimensions(40000, 100)
      expect(scaled.width).toBe(2000)
      expect(scaled.height).toBeGreaterThanOrEqual(1)
    })

    it('refuses dimensions that mean the browser did not read the file', () => {
      expect(() => computeScaledDimensions(0, 0)).toThrow(MaintenancePhotoError)
      expect(() => computeScaledDimensions(Number.NaN, 100)).toThrow(UNREADABLE_PHOTO_MESSAGE)
    })
  })

  describe('jpegFileName', () => {
    it('replaces the original extension with jpg', () => {
      expect(jpegFileName('IMG_0042.HEIC')).toBe('IMG_0042.jpg')
      expect(jpegFileName('kitchen tap.png')).toBe('kitchen tap.jpg')
    })

    it('falls back to a safe name when there is nothing usable', () => {
      expect(jpegFileName('')).toBe('photo.jpg')
      expect(jpegFileName('.jpeg')).toBe('photo.jpg')
    })

    it('strips path separators so a name cannot shape a path', () => {
      expect(jpegFileName('../../etc/passwd.png')).toBe('..-..-etc-passwd.jpg')
    })
  })

  describe('normaliseMaintenancePhoto', () => {
    it('turns a large photo into a bounded JPEG and reports the real dimensions', async () => {
      const captured: { width?: number; height?: number; quality?: number } = {}
      const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], {
        type: 'image/jpeg',
      })
      const deps = depsFor(decodedAt(4032, 3024), blob, captured)

      const file = new File([new Uint8Array(2048)], 'IMG_0042.JPG', { type: 'image/jpeg' })
      const result = await normaliseMaintenancePhoto(file, deps)

      expect(captured).toEqual({ width: 2000, height: 1500, quality: 0.8 })
      expect(result.width).toBe(2000)
      expect(result.height).toBe(1500)
      expect(result.mimeType).toBe('image/jpeg')
      expect(result.byteSize).toBe(blob.size)
      expect(result.file.name).toBe('IMG_0042.jpg')
      expect(result.file.type).toBe('image/jpeg')
      expect(result.originalFileName).toBe('IMG_0042.JPG')
      expect(result.originalByteSize).toBe(2048)
    })

    it('shows the plain English message and hides the codec error when decoding fails', async () => {
      const release = vi.fn()
      const deps: PhotoNormaliseDeps = {
        decode: vi.fn(async () => {
          throw new Error(
            'heif: Error while loading plugin: Support for this compression format has not been built in'
          )
        }),
        encodeJpeg: vi.fn(async () => new Blob([new Uint8Array([1])])),
      }

      const file = new File([new Uint8Array(64)], 'IMG_0001.HEIC', { type: 'image/heic' })
      const error = await normaliseMaintenancePhoto(file, deps).catch((thrown) => thrown)

      expect(error).toBeInstanceOf(MaintenancePhotoError)
      expect(maintenancePhotoErrorMessage(error)).toBe(UNREADABLE_PHOTO_MESSAGE)
      expect((error as MaintenancePhotoError).message).not.toContain('heif')
      expect((error as MaintenancePhotoError).cause).toBeInstanceOf(Error)
      expect(deps.encodeJpeg).not.toHaveBeenCalled()
      expect(release).not.toHaveBeenCalled()
    })

    it('shows the same message when the canvas draw fails', async () => {
      const release = vi.fn()
      const deps: PhotoNormaliseDeps = {
        decode: vi.fn(async () => decodedAt(1200, 900, release)),
        encodeJpeg: vi.fn(async () => {
          throw new Error('SecurityError: tainted canvas')
        }),
      }

      const file = new File([new Uint8Array(64)], 'photo.png', { type: 'image/png' })
      await expect(normaliseMaintenancePhoto(file, deps)).rejects.toThrow(UNREADABLE_PHOTO_MESSAGE)
      // The decoded bitmap is released whether or not the encode worked.
      expect(release).toHaveBeenCalledTimes(1)
    })

    it('refuses an empty file without asking the browser to decode it', async () => {
      const deps = depsFor(decodedAt(100, 100), new Blob([new Uint8Array([1])]))
      const file = new File([], 'empty.jpg', { type: 'image/jpeg' })

      await expect(normaliseMaintenancePhoto(file, deps)).rejects.toThrow(UNREADABLE_PHOTO_MESSAGE)
      expect(deps.decode).not.toHaveBeenCalled()
    })

    it('refuses an encoded result that is still over the bucket limit', async () => {
      const deps = depsFor(decodedAt(2000, 2000), new Blob([new Uint8Array(64)]))
      const file = new File([new Uint8Array(64)], 'huge.jpg', { type: 'image/jpeg' })

      await expect(
        normaliseMaintenancePhoto(file, deps, { maxBytes: 32 })
      ).rejects.toThrow(OVERSIZE_PHOTO_MESSAGE)
    })

    it('releases the decoded bitmap on the happy path too', async () => {
      const release = vi.fn()
      const deps = depsFor(decodedAt(800, 600, release), new Blob([new Uint8Array([0xff, 0xd8, 0xff])]))
      const file = new File([new Uint8Array(16)], 'ok.jpg', { type: 'image/jpeg' })

      await normaliseMaintenancePhoto(file, deps)
      expect(release).toHaveBeenCalledTimes(1)
    })
  })

  describe('maintenancePhotoErrorMessage', () => {
    it('never leaks an unexpected error to the screen', () => {
      expect(maintenancePhotoErrorMessage(new Error('ENOENT /var/task/node_modules/sharp'))).toBe(
        'Something went wrong with that photo. Please try again.'
      )
    })
  })
})
