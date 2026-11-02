/**
 * The November 2026 voucher card's two phone rules, as the designer asked for them.
 *
 * The voucher handover says to add `.vc-num` and `.vc-date` inside the shell's existing
 * `max-width:620px` media query. The shell is compared byte for byte against the Christmas
 * handover file, which predates the card, so the campaign fidelity test applies this exact
 * insertion to that file before comparing. Every other difference in the shell still fails.
 *
 * The anchor is the gutter rule, which the October 2026 pass put in the same media query. The
 * voucher handover file shows the two new rules immediately after it, in this order.
 */

const ANCHOR = '    .gutter{padding-left:20px !important;padding-right:20px !important;}\n'

export const VOUCHER_SHELL_RULES =
  '    .vc-num{font-size:32px !important;line-height:40px !important;letter-spacing:3px !important;}\n' +
  '    .vc-date{font-size:18px !important;line-height:26px !important;}\n'

export function applyVoucherShellRules(html: string): string {
  const occurrences = html.split(ANCHOR).length - 1
  if (occurrences !== 1) {
    throw new Error(`Expected the gutter rule exactly once in the shell, found ${occurrences}`)
  }
  if (html.includes('.vc-num{')) {
    throw new Error('The handover file already carries the voucher rules; delete this insertion')
  }
  return html.replace(ANCHOR, `${ANCHOR}${VOUCHER_SHELL_RULES}`)
}
