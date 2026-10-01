import { describe, expect, it, vi } from 'vitest'
import { composeReceiptNote, splitReceiptNote } from './note-format'
import { HEIC_UNREADABLE_MESSAGE, ReceiptPhotoError, isHeicFile, prepareReceiptFileForUpload } from './heic-convert'
import {
  MISSING_VENDOR_LABEL,
  paymentValue,
  totalVendorGroups,
  vendorGroupKey,
  vendorGroupLabel,
} from './vendor-group-key'
import { isAllowedReceiptMimeType, sniffReceiptMimeType } from './upload-constraints'
import { escapeCsvCell } from './export/csv-helpers'
import type { DecodedPhoto, PhotoNormaliseDeps } from '@/lib/maintenance/photo-normalise'

// The long dash older notes used. Built from its code point: the character is not allowed in
// source here.
const LONG_DASH = String.fromCharCode(0x2014)

describe('receipt note format', () => {
  it('stamps a note with London time and a plain bar', () => {
    // 13:30 UTC on 1 October is 14:30 in London (summer time).
    const note = composeReceiptNote('  Paid by card  ', new Date('2026-10-01T13:30:00Z'))

    expect(note).toBe('01 Oct 2026, 14:30 | Paid by card')
    expect(note).not.toContain(LONG_DASH)
  })

  it('uses the London clock in winter too', () => {
    expect(composeReceiptNote('x', new Date('2026-12-01T09:05:00Z'))).toBe('01 Dec 2026, 09:05 | x')
  })

  it('stores an empty note as nothing', () => {
    expect(composeReceiptNote('   ')).toBe('')
  })

  it('reads back what it wrote', () => {
    const stored = composeReceiptNote('Split with the bar | see invoice', new Date('2026-10-01T13:30:00Z'))

    expect(splitReceiptNote(stored)).toEqual({ stamp: '01 Oct 2026, 14:30', text: 'Split with the bar | see invoice' })
  })

  it('still reads a note written with the old long dash', () => {
    const legacy = `14 Aug 2026, 09:12 ${LONG_DASH} Refund expected`

    expect(splitReceiptNote(legacy)).toEqual({ stamp: '14 Aug 2026, 09:12', text: 'Refund expected' })
  })

  it('leaves a note whole when the text before the bar is not a timestamp', () => {
    expect(splitReceiptNote('Card | personal')).toEqual({ stamp: null, text: 'Card | personal' })
    expect(splitReceiptNote(`Bar ${LONG_DASH} cellar`)).toEqual({ stamp: null, text: `Bar ${LONG_DASH} cellar` })
  })

  it('treats nothing as an empty note', () => {
    expect(splitReceiptNote(null)).toEqual({ stamp: null, text: '' })
    expect(splitReceiptNote('   ')).toEqual({ stamp: null, text: '' })
  })
})

function photoDeps(overrides: Partial<PhotoNormaliseDeps> = {}): PhotoNormaliseDeps {
  const decoded: DecodedPhoto = { width: 4032, height: 3024, source: {} as unknown as CanvasImageSource, release: vi.fn() }
  return {
    decode: vi.fn(async () => decoded),
    encodeJpeg: vi.fn(async () => new Blob([new Uint8Array(2048)], { type: 'image/jpeg' })),
    ...overrides,
  }
}

describe('iPhone photos on receipt upload', () => {
  it('knows a HEIC by its type, or by its name when the type is blank', () => {
    expect(isHeicFile({ name: 'IMG_1.HEIC', type: '' })).toBe(true)
    expect(isHeicFile({ name: 'photo', type: 'image/heic' })).toBe(true)
    expect(isHeicFile({ name: 'photo', type: 'IMAGE/HEIF' })).toBe(true)
    expect(isHeicFile({ name: 'photo.heif', type: 'application/octet-stream' })).toBe(true)
    expect(isHeicFile({ name: 'receipt.jpg', type: 'image/jpeg' })).toBe(false)
    expect(isHeicFile({ name: 'heic-notes.pdf', type: 'application/pdf' })).toBe(false)
  })

  it('passes anything that is not a HEIC through untouched', async () => {
    const deps = photoDeps()
    const pdf = new File([new Uint8Array(10)], 'invoice.pdf', { type: 'application/pdf' })

    expect(await prepareReceiptFileForUpload(pdf, deps)).toBe(pdf)
    expect(deps.decode).not.toHaveBeenCalled()
  })

  it('turns a HEIC into a JPEG with a .jpg name, keeping small print readable', async () => {
    const deps = photoDeps()
    const heic = new File([new Uint8Array(5000)], 'IMG_0042.HEIC', { type: 'image/heic' })

    const result = await prepareReceiptFileForUpload(heic, deps)

    expect(result).not.toBe(heic)
    expect(result.type).toBe('image/jpeg')
    expect(result.name).toMatch(/^IMG_0042\.jpe?g$/i)
    // Longest edge capped at 3000, not the 2000 used for maintenance photos.
    expect(deps.encodeJpeg).toHaveBeenCalledWith(expect.anything(), 3000, 2250, 0.85)
  })

  it('stops with a message that says what to do when the browser cannot read the photo', async () => {
    const cause = new Error('codec said no')
    const deps = photoDeps({ decode: vi.fn(async () => Promise.reject(cause)) })
    const heic = new File([new Uint8Array(5000)], 'IMG_0042.heic', { type: '' })

    const failure = await prepareReceiptFileForUpload(heic, deps).catch((error) => error)

    expect(failure).toBeInstanceOf(ReceiptPhotoError)
    expect(failure.userMessage).toBe(HEIC_UNREADABLE_MESSAGE)
    expect(failure.userMessage).toContain('Most Compatible')
    expect(failure.cause).toBe(cause)
    expect(deps.encodeJpeg).not.toHaveBeenCalled()
  })

  it('refuses an empty HEIC and never returns the original', async () => {
    const deps = photoDeps()
    const heic = new File([], 'IMG_0042.heic', { type: 'image/heic' })

    await expect(prepareReceiptFileForUpload(heic, deps)).rejects.toBeInstanceOf(ReceiptPhotoError)
  })
})

describe('vendor groups', () => {
  it('puts a payment with no vendor, or only spaces, under "Missing vendor"', () => {
    expect(vendorGroupLabel(null)).toBe(MISSING_VENDOR_LABEL)
    expect(vendorGroupLabel('   ')).toBe(MISSING_VENDOR_LABEL)
    expect(vendorGroupLabel(' Tesco ')).toBe('Tesco')
  })

  it('does not split one vendor by case or stray spaces', () => {
    expect(vendorGroupKey('TESCO')).toBe(vendorGroupKey(' tesco '))
    expect(vendorGroupKey(undefined)).toBe(vendorGroupKey(''))
    expect(vendorGroupKey('Tesco')).not.toBe(vendorGroupKey('Tesco Express'))
  })

  it('values a payment by its total, or by in plus out when there is none', () => {
    expect(paymentValue({ amount_total: 12.5, amount_in: 1, amount_out: 2 })).toBe(12.5)
    expect(paymentValue({ amount_in: '3.10', amount_out: null })).toBeCloseTo(3.1)
    expect(paymentValue({ amount_out: 40 })).toBe(40)
    expect(paymentValue({})).toBe(0)
    // A total of zero is a total: it is not replaced by in plus out.
    expect(paymentValue({ amount_total: 0, amount_out: 9 })).toBe(0)
  })

  it('totals every group across the payments it is given', () => {
    const totals = totalVendorGroups([
      { vendor_name: 'Tesco', amount_out: 10, amount_total: 10 },
      { vendor_name: 'tesco', amount_out: '5.50', amount_total: '5.50' },
      { vendor_name: 'Tesco', amount_in: 2, amount_total: 2 },
      { vendor_name: null, amount_out: 7 },
    ])

    expect(Object.keys(totals).sort()).toEqual(['missing vendor', 'tesco'])
    expect(totals.tesco).toEqual({ count: 3, totalIn: 2, totalOut: 15.5, totalAmount: 17.5 })
    expect(totals['missing vendor']).toEqual({ count: 1, totalIn: 0, totalOut: 7, totalAmount: 7 })
  })
})

function bytes(...parts: Array<string | number[]>): Uint8Array {
  const out: number[] = []
  for (const part of parts) {
    if (typeof part === 'string') out.push(...[...part].map((char) => char.charCodeAt(0)))
    else out.push(...part)
  }
  return Uint8Array.from(out)
}

describe('what a stored receipt file really is', () => {
  it('reads the common kinds from their first bytes', () => {
    expect(sniffReceiptMimeType(bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF'))).toBe('image/jpeg')
    expect(sniffReceiptMimeType(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(sniffReceiptMimeType(bytes('GIF89a'))).toBe('image/gif')
    expect(sniffReceiptMimeType(bytes('GIF87a'))).toBe('image/gif')
    expect(sniffReceiptMimeType(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))).toBe('image/webp')
    expect(sniffReceiptMimeType(bytes('%PDF-1.7'))).toBe('application/pdf')
  })

  it('finds a PDF header that has stray bytes in front of it', () => {
    expect(sniffReceiptMimeType(bytes([0xef, 0xbb, 0xbf, 0x0a], '%PDF-1.4'))).toBe('application/pdf')
  })

  it('does not search the whole file for a PDF header', () => {
    expect(sniffReceiptMimeType(bytes(new Array(2000).fill(0x20), '%PDF-1.4'))).toBeNull()
  })

  it('knows an iPhone photo whatever it was called', () => {
    for (const brand of ['heic', 'heix', 'mif1', 'HEIC']) {
      expect(sniffReceiptMimeType(bytes([0, 0, 0, 0x18], 'ftyp', brand))).toBe('image/heic')
    }
    // An MP4 has the same box but another brand.
    expect(sniffReceiptMimeType(bytes([0, 0, 0, 0x18], 'ftyp', 'isom'))).toBeNull()
  })

  it('says nothing about bytes it does not know, or about an empty file', () => {
    expect(sniffReceiptMimeType(bytes('PK', [3, 4], 'word/document.xml'))).toBeNull()
    expect(sniffReceiptMimeType(new Uint8Array())).toBeNull()
    expect(sniffReceiptMimeType(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))).toBeNull()
  })

  it('accepts only the listed kinds as a declared type', () => {
    expect(isAllowedReceiptMimeType('application/pdf')).toBe(true)
    expect(isAllowedReceiptMimeType('image/heic')).toBe(true)
    expect(isAllowedReceiptMimeType('text/html')).toBe(false)
    expect(isAllowedReceiptMimeType('application/zip')).toBe(false)
  })
})

describe('free text in an exported spreadsheet', () => {
  it('treats a formula hidden behind spaces, tabs or line breaks as a formula', () => {
    expect(escapeCsvCell(' =1+1')).toBe('\t=1+1')
    expect(escapeCsvCell('\r=HYPERLINK("x")')).toBe('\t=HYPERLINK("x")')
    expect(escapeCsvCell('\t@cmd')).toBe('\t@cmd')
    expect(escapeCsvCell('\n\n-2+3')).toBe('\t-2+3')
  })

  it('drops a leading tab or carriage return from text that is not a formula', () => {
    expect(escapeCsvCell('\tTesco')).toBe('Tesco')
    expect(escapeCsvCell('\r\nTesco')).toBe('Tesco')
  })

  it('leaves ordinary text, and text with a space in front, as it is', () => {
    expect(escapeCsvCell('Tesco = cheap')).toBe('Tesco = cheap')
    expect(escapeCsvCell(' Tesco')).toBe(' Tesco')
  })
})
