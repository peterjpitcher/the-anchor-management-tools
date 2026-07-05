import { describe, it, expect } from 'vitest'
import {
  generateEventGuestListPdf,
  pdfSafeText,
  type GuestListEventHeader,
} from '@/lib/events/guest-list-pdf'
import type { GuestGroup } from '@/lib/events/guest-list-model'

const header: GuestListEventHeader = {
  name: 'Quiz Night',
  dateLabel: 'Friday 5 July 2026',
  timeLabel: '7:00 pm',
}

describe('pdfSafeText', () => {
  it('keeps cp1252 accented characters intact', () => {
    expect(pdfSafeText('José Müller Niño Çelik')).toBe('José Müller Niño Çelik')
    expect(pdfSafeText('é')).toBe('é')
    expect(pdfSafeText('ñ')).toBe('ñ')
    expect(pdfSafeText('ü')).toBe('ü')
    expect(pdfSafeText('ç')).toBe('ç')
  })

  it('folds Latin characters outside cp1252 to their base letter', () => {
    // Polish ł is not in cp1252 → folds to l (or ? if it cannot be folded)
    expect(['l', '?']).toContain(pdfSafeText('ł'))
    // Romanian ș/ț fold to s/t
    expect(['s', '?']).toContain(pdfSafeText('ș'))
    expect(['t', '?']).toContain(pdfSafeText('ț'))
  })

  it('replaces CJK characters and emoji with ?', () => {
    expect(pdfSafeText('王')).toBe('?')
    expect(pdfSafeText('小明')).toBe('??')
    expect(pdfSafeText('😀')).toBe('?')
  })

  it('preserves plain ASCII', () => {
    expect(pdfSafeText('Jane Smith')).toBe('Jane Smith')
  })

  it('handles empty and whitespace input without throwing', () => {
    expect(pdfSafeText('')).toBe('')
    expect(pdfSafeText('   ')).toBe('   ')
  })

  it('never throws on a mixed exotic string', () => {
    expect(() => pdfSafeText('Łukasz Œ 王小明 😀 é')).not.toThrow()
  })
})

describe('generateEventGuestListPdf (Unicode safety)', () => {
  const groupsWith = (names: string[]): GuestGroup[] => [
    { bookerName: names[0], lines: names.map((name, i) => ({ name, isBooker: i === 0 })) },
  ]

  it('resolves to a Buffer for a CJK guest name (does not throw)', async () => {
    const buf = await generateEventGuestListPdf(header, groupsWith(['王小明']))
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('resolves to a Buffer for mixed non-Latin / emoji names (does not throw)', async () => {
    const buf = await generateEventGuestListPdf(header, groupsWith(['Łukasz Œ 😀', 'José Müller']))
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('resolves to a Buffer when the event name itself is non-Latin', async () => {
    const exoticHeader: GuestListEventHeader = { ...header, name: 'クイズナイト 🎉' }
    const buf = await generateEventGuestListPdf(exoticHeader, groupsWith(['Jane Smith']))
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('resolves to a Buffer for a very long name (clipped, not wrapped)', async () => {
    const longName = 'Alexander Bartholomew Christopherson-Wetherby the Third of Someplace Far'
    const buf = await generateEventGuestListPdf(header, groupsWith([longName]))
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })
})
