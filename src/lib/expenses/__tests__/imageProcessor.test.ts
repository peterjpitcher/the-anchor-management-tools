import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateFileType, extensionForMimeType, optimiseImage } from '../imageProcessor'

// ---------------------------------------------------------------------------
// Mock sharp — we don't want to invoke the native binary in unit tests
// ---------------------------------------------------------------------------

const mockToBuffer = vi.fn().mockResolvedValue(Buffer.alloc(100))
const mockMetadata = vi.fn().mockResolvedValue({ width: 800, height: 600 })

const mockSharpInstance = {
  metadata: mockMetadata,
  resize: vi.fn().mockReturnThis(),
  rotate: vi.fn().mockReturnThis(),
  jpeg: vi.fn().mockReturnThis(),
  png: vi.fn().mockReturnThis(),
  webp: vi.fn().mockReturnThis(),
  toBuffer: mockToBuffer,
}

vi.mock('sharp', () => ({
  default: vi.fn(() => mockSharpInstance),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockMetadata.mockResolvedValue({ width: 800, height: 600 })
  mockToBuffer.mockResolvedValue(Buffer.alloc(100))
})

// ---------------------------------------------------------------------------
// validateFileType
// ---------------------------------------------------------------------------

describe('validateFileType', () => {
  it('should detect JPEG files by magic bytes', () => {
    const buf = Buffer.alloc(16)
    buf[0] = 0xff
    buf[1] = 0xd8
    buf[2] = 0xff
    const result = validateFileType(buf)
    expect(result.valid).toBe(true)
    expect(result.mimeType).toBe('image/jpeg')
  })

  it('should detect PNG files by magic bytes', () => {
    const buf = Buffer.alloc(16)
    buf[0] = 0x89
    buf[1] = 0x50
    buf[2] = 0x4e
    buf[3] = 0x47
    const result = validateFileType(buf)
    expect(result.valid).toBe(true)
    expect(result.mimeType).toBe('image/png')
  })

  it('should detect PDF files by magic bytes', () => {
    const buf = Buffer.from('%PDF-1.4 rest of data here')
    const result = validateFileType(buf)
    expect(result.valid).toBe(true)
    expect(result.mimeType).toBe('application/pdf')
  })

  it('should detect WebP files by magic bytes', () => {
    // RIFF....WEBP
    const buf = Buffer.alloc(16)
    buf.write('RIFF', 0, 'ascii')
    buf.writeUInt32LE(1234, 4) // file size
    buf.write('WEBP', 8, 'ascii')
    const result = validateFileType(buf)
    expect(result.valid).toBe(true)
    expect(result.mimeType).toBe('image/webp')
  })

  it('should detect HEIC files by ftyp box', () => {
    const buf = Buffer.alloc(16)
    buf.writeUInt32BE(24, 0) // box size
    buf.write('ftyp', 4, 'ascii')
    buf.write('heic', 8, 'ascii')
    const result = validateFileType(buf)
    expect(result.valid).toBe(true)
    expect(result.mimeType).toBe('image/heic')
  })

  it('should reject unknown file types', () => {
    const buf = Buffer.from('this is just random text data here')
    const result = validateFileType(buf)
    expect(result.valid).toBe(false)
    expect(result.mimeType).toBeNull()
  })

  it('should reject buffers that are too short', () => {
    const buf = Buffer.alloc(4)
    const result = validateFileType(buf)
    expect(result.valid).toBe(false)
    expect(result.mimeType).toBeNull()
  })

  it('should reject RIFF files that are not WebP', () => {
    const buf = Buffer.alloc(16)
    buf.write('RIFF', 0, 'ascii')
    buf.writeUInt32LE(1234, 4)
    buf.write('AVI ', 8, 'ascii') // AVI, not WebP
    const result = validateFileType(buf)
    // Should not match WebP and also not match HEIC or other types
    expect(result.valid).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// extensionForMimeType
// ---------------------------------------------------------------------------

describe('extensionForMimeType', () => {
  it('should return jpg for image/jpeg', () => {
    expect(extensionForMimeType('image/jpeg')).toBe('jpg')
  })

  it('should return png for image/png', () => {
    expect(extensionForMimeType('image/png')).toBe('png')
  })

  it('should return webp for image/webp', () => {
    expect(extensionForMimeType('image/webp')).toBe('webp')
  })

  it('should return jpg for image/heic (converted)', () => {
    expect(extensionForMimeType('image/heic')).toBe('jpg')
  })

  it('should return pdf for application/pdf', () => {
    expect(extensionForMimeType('application/pdf')).toBe('pdf')
  })

  it('should return bin for unknown types', () => {
    expect(extensionForMimeType('application/octet-stream')).toBe('bin')
  })
})

// ---------------------------------------------------------------------------
// optimiseImage
// ---------------------------------------------------------------------------

describe('optimiseImage', () => {
  it('should pass PDFs through without processing', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 test content')
    const result = await optimiseImage(pdfBuffer, 'application/pdf')
    expect(result.mimeType).toBe('application/pdf')
    expect(result.buffer).toBe(pdfBuffer)
    expect(result.width).toBe(0)
    expect(result.height).toBe(0)
  })

  it('should process JPEG images through sharp', async () => {
    const jpegBuffer = Buffer.alloc(200)
    const result = await optimiseImage(jpegBuffer, 'image/jpeg')
    expect(result.mimeType).toBe('image/jpeg')
    expect(mockSharpInstance.jpeg).toHaveBeenCalledWith(
      expect.objectContaining({ quality: 80 })
    )
  })

  it('should convert HEIC to JPEG', async () => {
    const heicBuffer = Buffer.alloc(200)
    const result = await optimiseImage(heicBuffer, 'image/heic')
    expect(result.mimeType).toBe('image/jpeg')
    expect(mockSharpInstance.jpeg).toHaveBeenCalled()
  })

  it('should resize images exceeding max dimension', async () => {
    mockMetadata.mockResolvedValue({ width: 4000, height: 3000 })
    const largeBuffer = Buffer.alloc(200)
    await optimiseImage(largeBuffer, 'image/jpeg')
    expect(mockSharpInstance.resize).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 2000,
        height: 2000,
        fit: 'inside',
        withoutEnlargement: true,
      })
    )
  })

  it('should not resize images within max dimension', async () => {
    mockMetadata.mockResolvedValue({ width: 1000, height: 800 })
    const smallBuffer = Buffer.alloc(200)
    await optimiseImage(smallBuffer, 'image/jpeg')
    expect(mockSharpInstance.resize).not.toHaveBeenCalled()
  })

  it('should process PNG images with compression', async () => {
    const pngBuffer = Buffer.alloc(200)
    const result = await optimiseImage(pngBuffer, 'image/png')
    expect(result.mimeType).toBe('image/png')
    expect(mockSharpInstance.png).toHaveBeenCalledWith(
      expect.objectContaining({ compressionLevel: 6 })
    )
  })

  it('should process WebP images', async () => {
    const webpBuffer = Buffer.alloc(200)
    const result = await optimiseImage(webpBuffer, 'image/webp')
    expect(result.mimeType).toBe('image/webp')
    expect(mockSharpInstance.webp).toHaveBeenCalledWith(
      expect.objectContaining({ quality: 80 })
    )
  })
})
