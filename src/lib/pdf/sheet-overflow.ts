/**
 * Thrown when a document made of fixed-size sheets has more on a sheet than fits.
 *
 * The contract and the worker agreement are fixed A4 sheets that hide anything past the bottom
 * edge. Text that overflowed would simply be missing from the PDF, with the page count unchanged
 * and nothing to show for it. A render that asks for this check stops instead.
 *
 * In its own file so that code which only needs to recognise the error does not load the PDF
 * generator.
 */
export class PdfSheetOverflowError extends Error {
  constructor(public readonly sheets: number[]) {
    super(
      `The document does not fit on its pages (page ${sheets.join(', ')}). Shorten what is on ${sheets.length === 1 ? 'that page' : 'those pages'}, then try again.`
    )
    this.name = 'PdfSheetOverflowError'
  }
}

/**
 * Run in the page: the 1-based numbers of the sheets whose content does not fit.
 *
 * Three things are measured on each sheet: the sheet, its inner frame, and each part directly
 * inside that frame (header, body, footer). The last matters because the body of a sheet is
 * allowed to shrink: text a little too long does not push past the bottom of the sheet, it runs
 * over the footer, and neither of the first two measurements moves.
 */
export const FIND_CLIPPED_SHEETS = `(function () {
  var clipped = [];
  var tall = function (el) { return el.scrollHeight > el.clientHeight + 2; };
  var sheets = document.querySelectorAll('.sheet');
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var inner = sheet.querySelector('.sheet-inner') || sheet;
    var over = tall(sheet) || tall(inner);
    for (var j = 0; !over && j < inner.children.length; j++) {
      if (tall(inner.children[j])) over = true;
    }
    if (over) clipped.push(i + 1);
  }
  return clipped;
})()`
