/**
 * Shared Puppeteer options for the recruitment printables.
 *
 * Two things worth knowing:
 *
 * A4, always. UK paper is 210mm x 297mm. The interview kit used to ask for US
 * Letter, which is 6mm wider, so printers either scaled it down or clipped the
 * right edge.
 *
 * Margins are per-page, set here and in the templates' `@page` rule, not as
 * padding on the document body. Padding applies once to the whole flowed block,
 * so only the first page gets a top margin and only the last gets a bottom one.
 * Every page in between then runs into the paper edge, which most printers
 * physically cannot print.
 *
 * The venue strapline is a running footer rather than a block at the end of the
 * markup. As a block it could orphan onto a near-empty final page whenever the
 * content happened to fill the previous one, and it gave the reader no way to
 * tell whether a stapled printout was complete. It now repeats on every page with
 * a page count.
 */

const FOOTER_MARGIN_BOTTOM = '18mm'

export function recruitmentKitPdfOptions() {
  return {
    format: 'A4' as const,
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '14mm', right: '16mm', bottom: FOOTER_MARGIN_BOTTOM, left: '16mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    // Chrome renders these templates in an isolated document with no page styles,
    // so every rule has to be inline and the font size stated explicitly.
    footerTemplate: `
      <div style="width:100%;padding:0 16mm;font-family:Arial,Helvetica,sans-serif;font-size:8px;color:#6b7280;display:flex;justify-content:space-between;align-items:center;">
        <span>The Anchor, Stanwell Moor Village, a village pub since 1751</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    `,
  }
}
