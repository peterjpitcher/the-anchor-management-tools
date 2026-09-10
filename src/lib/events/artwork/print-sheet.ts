/**
 * The A4 print sheet for table talkers: one branded DL panel, laid out three
 * times across a landscape sheet with a gap between each so they can be cut
 * apart and dropped into the table holders.
 *
 * Pure geometry in millimetres, with the origin at the top left of the sheet and
 * y growing downwards, the way a person looks at the page. No imports, no I/O,
 * no state. The PDF builder (`table-talker-pdf.ts`) converts to points and
 * flips to PDF's bottom-left origin at the last moment, and the variant config
 * reads the printed panel width from here for the QR minimum, so the two can
 * never disagree about how big a panel really is.
 *
 * The numbers, all owner decisions of 2026-09-10:
 *
 * - The sheet is printed on the office printer, which cannot print to the edge,
 *   so 5mm is held clear all round.
 * - 5mm between neighbouring panels, so each can be cut out without trimming
 *   into its neighbour.
 * - Everything else goes to the panels: three across what is left, at DL
 *   proportions. That is 92.33 x 195.86mm, a little under DL itself, which sits
 *   in a DL holder with a small reveal each side.
 */

export const SHEET_WIDTH_MM = 297
export const SHEET_HEIGHT_MM = 210

/** Held clear on every edge, because an office printer cannot print to the edge. */
export const SHEET_MARGIN_MM = 5

/** Between neighbouring panels, so each can be cut out cleanly. */
export const PANEL_GAP_MM = 5

export const PANELS_PER_SHEET = 3

/** DL portrait: the size the panel is designed at and the size its holders take. */
export const DL_WIDTH_MM = 99
export const DL_HEIGHT_MM = 210

/**
 * The printed panel width: the sheet less its two margins and the gaps between
 * panels, split three ways. 92.333...mm.
 */
export const TABLE_TALKER_PANEL_WIDTH_MM =
  (SHEET_WIDTH_MM - 2 * SHEET_MARGIN_MM - (PANELS_PER_SHEET - 1) * PANEL_GAP_MM) / PANELS_PER_SHEET

/** The printed panel height at DL proportions. 195.86mm, inside the 200mm printable height. */
export const TABLE_TALKER_PANEL_HEIGHT_MM = TABLE_TALKER_PANEL_WIDTH_MM * (DL_HEIGHT_MM / DL_WIDTH_MM)

/** How far a crop mark starts from the artwork's edge, so a mark never prints on a panel. */
export const CROP_MARK_OFFSET_MM = 1

/**
 * How long each crop mark is. With the 5mm gap and the 1mm offset, the marks a
 * pair of neighbours draw into the gap between them land on the same 3mm line,
 * stopping 1mm short of each panel.
 */
export const CROP_MARK_LENGTH_MM = 3

/**
 * Below this the printed panel is visibly soft. 150dpi across the 92.33mm panel
 * is 546px wide; the designed size, 1169px, prints at about 321dpi.
 */
export const MIN_PRINT_DPI = 150

const MM_PER_INCH = 25.4

/** The narrowest DL panel that still prints at `MIN_PRINT_DPI`: 546px. */
export const MIN_PRINT_WIDTH_PX = Math.ceil((TABLE_TALKER_PANEL_WIDTH_MM / MM_PER_INCH) * MIN_PRINT_DPI)

/** A rectangle on the sheet in millimetres. x and y are its top-left corner. */
export interface SheetRect {
  x: number
  y: number
  width: number
  height: number
}

/** A straight crop mark on the sheet, in millimetres. */
export interface CropMark {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface TableTalkerSheetLayout {
  /** Where each panel may sit: exact DL proportions, left to right. */
  slots: SheetRect[]
  /**
   * Where the artwork is actually drawn: the whole image fitted inside its slot
   * and centred, never cropped and never stretched. The upload check allows a
   * file to sit up to 5% off the DL shape, so an off-shape file comes out a
   * little smaller than its slot rather than losing an edge, and cropping could
   * cut into the QR code or the logo, both of which sit close to the edges.
   */
  artwork: SheetRect[]
  /** Two marks at each corner of each artwork rect, pointing away from it. */
  cropMarks: CropMark[]
  /** The resolution the artwork prints at, given its real pixel width. */
  dpi: number
}

/** The three slots, left to right, with the row centred top to bottom. */
function panelSlots(): SheetRect[] {
  const top = (SHEET_HEIGHT_MM - TABLE_TALKER_PANEL_HEIGHT_MM) / 2
  return Array.from({ length: PANELS_PER_SHEET }, (_, index) => ({
    x: SHEET_MARGIN_MM + index * (TABLE_TALKER_PANEL_WIDTH_MM + PANEL_GAP_MM),
    y: top,
    width: TABLE_TALKER_PANEL_WIDTH_MM,
    height: TABLE_TALKER_PANEL_HEIGHT_MM,
  }))
}

/** The image fitted inside a slot, keeping its own proportions, centred. */
function fitInside(slot: SheetRect, imageWidthPx: number, imageHeightPx: number): SheetRect {
  const imageAspect = imageWidthPx / imageHeightPx
  const slotAspect = slot.width / slot.height
  const width = imageAspect > slotAspect ? slot.width : slot.height * imageAspect
  const height = imageAspect > slotAspect ? slot.width / imageAspect : slot.height
  return {
    x: slot.x + (slot.width - width) / 2,
    y: slot.y + (slot.height - height) / 2,
    width,
    height,
  }
}

/** The eight crop marks around one piece of artwork. */
function cropMarksFor(rect: SheetRect): CropMark[] {
  const left = rect.x
  const right = rect.x + rect.width
  const top = rect.y
  const bottom = rect.y + rect.height
  const near = CROP_MARK_OFFSET_MM
  const far = CROP_MARK_OFFSET_MM + CROP_MARK_LENGTH_MM

  return [
    // Horizontal marks, level with the top and bottom edges, pointing outwards.
    { x1: left - far, y1: top, x2: left - near, y2: top },
    { x1: right + near, y1: top, x2: right + far, y2: top },
    { x1: left - far, y1: bottom, x2: left - near, y2: bottom },
    { x1: right + near, y1: bottom, x2: right + far, y2: bottom },
    // Vertical marks, in line with the left and right edges, pointing outwards.
    { x1: left, y1: top - far, x2: left, y2: top - near },
    { x1: right, y1: top - far, x2: right, y2: top - near },
    { x1: left, y1: bottom + near, x2: left, y2: bottom + far },
    { x1: right, y1: bottom + near, x2: right, y2: bottom + far },
  ]
}

/**
 * The whole sheet for an image of the given pixel size.
 *
 * Throws on a size that has no area, which is a programming error: the route
 * reads real dimensions from the decoded file before it gets here.
 */
export function tableTalkerSheetLayout(
  imageWidthPx: number,
  imageHeightPx: number
): TableTalkerSheetLayout {
  if (!(imageWidthPx > 0) || !(imageHeightPx > 0)) {
    throw new Error(`A table talker sheet needs an image with area, not ${imageWidthPx}x${imageHeightPx}.`)
  }

  const slots = panelSlots()
  const artwork = slots.map((slot) => fitInside(slot, imageWidthPx, imageHeightPx))

  return {
    slots,
    artwork,
    cropMarks: artwork.flatMap(cropMarksFor),
    dpi: imageWidthPx / (artwork[0].width / MM_PER_INCH),
  }
}
