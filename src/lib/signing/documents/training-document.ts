import { STAFF } from '@/lib/brand/palette'
import { COMPANY_DETAILS } from '@/lib/company-details'
import { isValidIsoDate } from '@/lib/dateUtils'
import { getDocumentLogoDataUri } from '@/lib/pdf/document-logo'
import { escapeHtml } from '../template-text'
import { trainingDateText } from '../training-wording'

/**
 * What the two training documents share: who issues them, where the person works, the fixed
 * disclaimer, and one placeholder look until the owner's certificate design arrives.
 *
 * Staff documents are Orange Jelly documents, with The Anchor named as the workplace
 * (docs/design/brief-orange-jelly.md): the Orange Jelly palette (STAFF) and wordmark. System
 * fonts only, so the second render of the signed copy never waits on, or differs by, a font
 * download. Flowing A4 with the standard margins (profile `a4_margins`): a long name or a long
 * task list runs on rather than being cut off.
 */

/** Who issues a training certificate. */
const TRAINING_CERTIFICATE_ISSUER = COMPANY_DETAILS.legalName

/** The person named as signatory on every training certificate. One place, so it can change. */
const TRAINING_CERTIFICATE_SIGNATORY = { name: 'Peter Pitcher', position: 'Director' } as const

/** Where the person works. */
export const TRAINING_WORKPLACE = 'The Anchor, Stanwell Moor'

/** Printed on every certificate: the training is not, and must not look like, a qualification. */
export const TRAINING_DISCLAIMER = 'In-house training, not an accredited qualification.'

export function esc(value: string): string {
  return escapeHtml(value)
}

/** A London date for print, refusing anything that is not a real date. */
export function printDate(isoDate: string, what: string): string {
  if (!isValidIsoDate(isoDate)) throw new Error(`Training document: ${what} is not a date (${isoDate})`)
  return trainingDateText(isoDate)
}

/** Stops a document going out with a blank where a name or title belongs. */
export function required(value: string | null | undefined, what: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) throw new Error(`Training document: ${what} is missing`)
  return trimmed
}

function trainingDocumentStyles(): string {
  return `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.45; color: ${STAFF.text}; }
  .sheet { border: 1.2mm solid ${STAFF.primary}; padding: 9mm 11mm; }
  .page-break { break-after: page; page-break-after: always; }
  .brand { text-align: center; margin: 0 0 6mm; }
  .brand img { max-width: 62mm; max-height: 14mm; }
  .brand strong { font-size: 14pt; }
  .kicker { text-align: center; font-size: 8.5pt; font-weight: bold; letter-spacing: .14em; text-transform: uppercase; color: ${STAFF.primary}; margin: 0 0 4mm; }
  .lead { text-align: center; margin: 0 0 2mm; color: ${STAFF.textMuted}; }
  .holder { text-align: center; font-size: 24pt; line-height: 1.15; font-weight: bold; margin: 0 0 4mm; overflow-wrap: anywhere; }
  .course { text-align: center; font-size: 17pt; line-height: 1.2; font-weight: bold; color: ${STAFF.primaryHover}; margin: 0 0 1.5mm; overflow-wrap: anywhere; }
  .version { text-align: center; margin: 0 0 3mm; color: ${STAFF.textMuted}; }
  .how { text-align: center; margin: 0 0 6mm; }
  .facts { width: 100%; border-collapse: collapse; margin: 0 0 6mm; }
  .facts th, .facts td { text-align: left; vertical-align: top; padding: 1.8mm 2.5mm; border-bottom: 0.3mm solid ${STAFF.border}; }
  .facts th { width: 42%; font-weight: normal; color: ${STAFF.textMuted}; }
  .facts td { font-weight: bold; overflow-wrap: anywhere; }
  .notice { border: 0.4mm solid ${STAFF.warningBorder}; background: ${STAFF.warningSoft}; color: ${STAFF.warningFg}; padding: 2.5mm 3mm; margin: 0 0 5mm; font-weight: bold; }
  .slots { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; margin: 0 0 6mm; break-inside: avoid; }
  .slots.single { grid-template-columns: 1fr; }
  .slot { border: 0.3mm solid ${STAFF.borderStrong}; padding: 3mm; break-inside: avoid; }
  .slot-h { font-size: 7.5pt; font-weight: bold; letter-spacing: .1em; text-transform: uppercase; margin: 0 0 2mm; }
  .issuer { display: flex; justify-content: space-between; gap: 6mm; font-size: 9.5pt; margin: 0 0 4mm; }
  .issuer p { margin: 0; }
  .disclaimer { text-align: center; font-size: 9pt; font-weight: bold; color: ${STAFF.textMuted}; margin: 0; }
  h1 { font-size: 16pt; margin: 0 0 2mm; }
  h2 { font-size: 11.5pt; color: ${STAFF.primary}; margin: 6mm 0 2mm; break-after: avoid; }
  .sub { color: ${STAFF.textMuted}; margin: 0 0 5mm; }
  .record { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  .record th, .record td { text-align: left; vertical-align: top; padding: 1.6mm 2mm; border: 0.3mm solid ${STAFF.border}; overflow-wrap: anywhere; }
  .record thead th { background: ${STAFF.surface2}; font-weight: bold; }
  .record tr { break-inside: avoid; }
  .tasks { margin: 0 0 5mm; padding-left: 6mm; }
  .tasks li { margin: 0 0 1.5mm; }
  .foot { margin-top: 6mm; padding-top: 2.5mm; border-top: 0.3mm solid ${STAFF.border}; font-size: 8pt; color: ${STAFF.textMuted}; break-inside: avoid; }
  .foot p { margin: 0 0 1mm; }
`
}

/** The Orange Jelly wordmark, or the company name in type if the file cannot be read. */
export function brandMark(): string {
  const logo = getDocumentLogoDataUri()
  return logo
    ? `<div class="brand"><img src="${logo}" alt="${esc(TRAINING_CERTIFICATE_ISSUER)}"></div>`
    : `<div class="brand"><strong>${esc(TRAINING_CERTIFICATE_ISSUER)}</strong></div>`
}

/** Issuer and signatory, as printed on page 1. */
export function issuerBlock(): string {
  return `<div class="issuer">
      <p>Issued by <strong>${esc(TRAINING_CERTIFICATE_ISSUER)}</strong><br>Workplace: ${esc(TRAINING_WORKPLACE)}</p>
      <p style="text-align:right">Signatory<br><strong>${esc(`${TRAINING_CERTIFICATE_SIGNATORY.name}, ${TRAINING_CERTIFICATE_SIGNATORY.position}`)}</strong></p>
    </div>`
}

/** The company line and how the document was signed. A sign-off is signed; a certificate is confirmed. */
export function companyFooter(reference: string, how: 'Confirmed' | 'Signed' = 'Confirmed'): string {
  return `<div class="foot">
    <p>${esc(COMPANY_DETAILS.legalName)}, company number ${esc(COMPANY_DETAILS.companyNumber)}. ${esc(COMPANY_DETAILS.fullAddress)}.</p>
    <p>Certificate number ${esc(reference)}. ${how} electronically: the signing record is the last page.</p>
  </div>`
}

/** The refresher, as printed beside "Refresher". */
export function refresherText(expiresOn: string | null): string {
  return expiresOn ? `Due by ${printDate(expiresOn, 'the refresher date')}` : 'No refresher'
}

export function wrapTrainingDocument(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>${trainingDocumentStyles()}</style>
</head>
<body>
${body}
</body>
</html>`
}
