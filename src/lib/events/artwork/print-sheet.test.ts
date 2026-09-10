import { describe, expect, it } from 'vitest'
import {
  CROP_MARK_LENGTH_MM,
  CROP_MARK_OFFSET_MM,
  DL_HEIGHT_MM,
  DL_WIDTH_MM,
  MIN_PRINT_DPI,
  MIN_PRINT_WIDTH_PX,
  PANEL_GAP_MM,
  PANELS_PER_SHEET,
  SHEET_HEIGHT_MM,
  SHEET_MARGIN_MM,
  SHEET_WIDTH_MM,
  TABLE_TALKER_PANEL_HEIGHT_MM,
  TABLE_TALKER_PANEL_WIDTH_MM,
  tableTalkerSheetLayout,
  type CropMark,
  type SheetRect,
} from './print-sheet'

/** The designed DL panel at 300dpi, as the upload tile asks for it. */
const DESIGNED = { width: 1169, height: 2480 }

const EPSILON = 1e-9

function markTouchesRect(mark: CropMark, rect: SheetRect): boolean {
  const left = rect.x - EPSILON
  const right = rect.x + rect.width + EPSILON
  const top = rect.y - EPSILON
  const bottom = rect.y + rect.height + EPSILON
  const minX = Math.min(mark.x1, mark.x2)
  const maxX = Math.max(mark.x1, mark.x2)
  const minY = Math.min(mark.y1, mark.y2)
  const maxY = Math.max(mark.y1, mark.y2)
  return minX < right && maxX > left && minY < bottom && maxY > top
}

describe('the sheet geometry', () => {
  it('is three 92.33mm panels, two margins and two gaps, exactly filling A4 landscape', () => {
    expect(SHEET_WIDTH_MM).toBe(297)
    expect(SHEET_HEIGHT_MM).toBe(210)
    expect(TABLE_TALKER_PANEL_WIDTH_MM).toBeCloseTo(92.3333, 4)
    expect(
      2 * SHEET_MARGIN_MM + PANELS_PER_SHEET * TABLE_TALKER_PANEL_WIDTH_MM + (PANELS_PER_SHEET - 1) * PANEL_GAP_MM
    ).toBeCloseTo(SHEET_WIDTH_MM, 9)
  })

  it('keeps the panel at DL proportions and inside the printable height', () => {
    expect(TABLE_TALKER_PANEL_HEIGHT_MM / TABLE_TALKER_PANEL_WIDTH_MM).toBeCloseTo(DL_HEIGHT_MM / DL_WIDTH_MM, 9)
    expect(TABLE_TALKER_PANEL_HEIGHT_MM).toBeCloseTo(195.86, 2)
    expect(TABLE_TALKER_PANEL_HEIGHT_MM).toBeLessThanOrEqual(SHEET_HEIGHT_MM - 2 * SHEET_MARGIN_MM)
  })

  it('is a little under DL, so a panel fits a DL holder', () => {
    expect(TABLE_TALKER_PANEL_WIDTH_MM).toBeLessThan(DL_WIDTH_MM)
    expect(TABLE_TALKER_PANEL_HEIGHT_MM).toBeLessThan(DL_HEIGHT_MM)
  })
})

describe('tableTalkerSheetLayout', () => {
  const layout = tableTalkerSheetLayout(DESIGNED.width, DESIGNED.height)

  it('lays three identical slots left to right with a 5mm gap and a centred row', () => {
    expect(layout.slots).toHaveLength(3)
    const top = (SHEET_HEIGHT_MM - TABLE_TALKER_PANEL_HEIGHT_MM) / 2
    layout.slots.forEach((slot, index) => {
      expect(slot.x).toBeCloseTo(5 + index * (TABLE_TALKER_PANEL_WIDTH_MM + 5), 9)
      expect(slot.y).toBeCloseTo(top, 9)
      expect(slot.width).toBeCloseTo(TABLE_TALKER_PANEL_WIDTH_MM, 9)
      expect(slot.height).toBeCloseTo(TABLE_TALKER_PANEL_HEIGHT_MM, 9)
    })
    expect(layout.slots[1].x - (layout.slots[0].x + layout.slots[0].width)).toBeCloseTo(PANEL_GAP_MM, 9)
    // About 7mm above and below.
    expect(top).toBeCloseTo(7.071, 3)
  })

  it('draws the same artwork, the same size, in every slot', () => {
    const [first, ...rest] = layout.artwork
    for (const rect of rest) {
      expect(rect.width).toBeCloseTo(first.width, 9)
      expect(rect.height).toBeCloseTo(first.height, 9)
      expect(rect.y).toBeCloseTo(first.y, 9)
    }
  })

  it('fills the slot with a full size DL upload, near enough exactly', () => {
    const [artwork] = layout.artwork
    const [slot] = layout.slots
    // 1169x2480 is DL to within a hundredth of a per cent.
    expect(Math.abs(artwork.width - slot.width)).toBeLessThan(0.05)
    expect(Math.abs(artwork.height - slot.height)).toBeLessThan(0.05)
  })

  it('keeps every piece of artwork inside the area an office printer can print', () => {
    for (const rect of layout.artwork) {
      expect(rect.x).toBeGreaterThanOrEqual(SHEET_MARGIN_MM - EPSILON)
      expect(rect.y).toBeGreaterThanOrEqual(SHEET_MARGIN_MM - EPSILON)
      expect(rect.x + rect.width).toBeLessThanOrEqual(SHEET_WIDTH_MM - SHEET_MARGIN_MM + EPSILON)
      expect(rect.y + rect.height).toBeLessThanOrEqual(SHEET_HEIGHT_MM - SHEET_MARGIN_MM + EPSILON)
    }
  })

  it('centres a slightly wide export in its slot rather than cropping it', () => {
    // 5% wider than DL: the most the upload check lets through.
    const wide = tableTalkerSheetLayout(1227, 2480)
    wide.artwork.forEach((rect, index) => {
      const slot = wide.slots[index]
      expect(rect.width).toBeCloseTo(slot.width, 9)
      expect(rect.height).toBeLessThan(slot.height)
      expect(rect.y - slot.y).toBeCloseTo(slot.y + slot.height - (rect.y + rect.height), 9)
      expect(rect.width / rect.height).toBeCloseTo(1227 / 2480, 9)
    })
  })

  it('centres a slightly tall export in its slot rather than cropping it', () => {
    const tall = tableTalkerSheetLayout(1111, 2480)
    tall.artwork.forEach((rect, index) => {
      const slot = tall.slots[index]
      expect(rect.height).toBeCloseTo(slot.height, 9)
      expect(rect.width).toBeLessThan(slot.width)
      expect(rect.x - slot.x).toBeCloseTo(slot.x + slot.width - (rect.x + rect.width), 9)
    })
  })
})

describe('crop marks', () => {
  for (const [name, size] of [
    ['a full size upload', DESIGNED],
    ['a wide export', { width: 1227, height: 2480 }],
    ['a tall export', { width: 1111, height: 2480 }],
  ] as const) {
    it(`never lands on any panel, for ${name}`, () => {
      const layout = tableTalkerSheetLayout(size.width, size.height)
      expect(layout.cropMarks).toHaveLength(24)
      for (const mark of layout.cropMarks) {
        for (const rect of layout.artwork) {
          expect(markTouchesRect(mark, rect)).toBe(false)
        }
      }
    })

    it(`stays on the sheet, for ${name}`, () => {
      for (const mark of tableTalkerSheetLayout(size.width, size.height).cropMarks) {
        for (const x of [mark.x1, mark.x2]) {
          expect(x).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThanOrEqual(SHEET_WIDTH_MM)
        }
        for (const y of [mark.y1, mark.y2]) {
          expect(y).toBeGreaterThanOrEqual(0)
          expect(y).toBeLessThanOrEqual(SHEET_HEIGHT_MM)
        }
      }
    })
  }

  it('marks each artwork corner on both edges, 1mm clear and 3mm long', () => {
    const layout = tableTalkerSheetLayout(DESIGNED.width, DESIGNED.height)
    const [first] = layout.artwork
    // The top-left corner's horizontal mark ends 1mm short of the artwork.
    expect(layout.cropMarks).toContainEqual({
      x1: first.x - CROP_MARK_OFFSET_MM - CROP_MARK_LENGTH_MM,
      y1: first.y,
      x2: first.x - CROP_MARK_OFFSET_MM,
      y2: first.y,
    })
    for (const mark of layout.cropMarks) {
      expect(Math.hypot(mark.x2 - mark.x1, mark.y2 - mark.y1)).toBeCloseTo(CROP_MARK_LENGTH_MM, 9)
    }
  })
})

describe('print resolution', () => {
  it('prints the designed 1169px panel at about 321dpi', () => {
    expect(tableTalkerSheetLayout(1169, 2480).dpi).toBeCloseTo(321.6, 1)
  })

  it('puts the 150dpi floor at 546px across', () => {
    expect(MIN_PRINT_WIDTH_PX).toBe(546)
    expect(tableTalkerSheetLayout(546, 1158).dpi).toBeGreaterThanOrEqual(MIN_PRINT_DPI)
    expect(tableTalkerSheetLayout(545, 1156).dpi).toBeLessThan(MIN_PRINT_DPI)
  })

  it('refuses an image with no area', () => {
    expect(() => tableTalkerSheetLayout(0, 2480)).toThrow(/area/)
    expect(() => tableTalkerSheetLayout(1169, Number.NaN)).toThrow(/area/)
  })
})
