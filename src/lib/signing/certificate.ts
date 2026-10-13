import { PDFDocument } from 'pdf-lib'
import { STAFF } from '@/lib/brand/palette'
import { COMPANY_DETAILS } from '@/lib/company-details'
import { formatDateTimeInLondon } from '@/lib/dateUtils'
import { describeDevice, describeLocation } from './evidence'
import { signingRoleLabel } from './kinds'
import { escapeHtml } from './template-render'
import type { SigningDocumentRow, SigningMethod, SigningPartyRow } from './types'

/**
 * The signing record: one page added to the end of the signed PDF, setting out who signed, when,
 * how, and the fingerprint of the document they were shown. The same facts live in the database;
 * this page is what travels with the PDF when someone forwards or prints it.
 */

const METHOD_LABELS: Record<SigningMethod, string> = {
  link: 'Personal link sent by email',
  portal: 'Signed in to the staff portal',
  in_person: 'In person, on a device handed over by a manager',
  sender: 'Signed on sending, signed in to the management app',
}

/** "12 October 2026 at 14:05:09 BST". Seconds and the zone name, because this is evidence. */
export function formatSigningInstant(iso: string): string {
  const date = formatDateTimeInLondon(iso, { day: 'numeric', month: 'long', year: 'numeric' })
  const time = formatDateTimeInLondon(iso, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // h23, not hour12: false, which can print midnight as 24:00.
    hourCycle: 'h23',
    timeZoneName: 'short',
  })
  return `${date} at ${time}`
}

export interface CertificateParty extends SigningPartyRow {
  /** The manager who was present for an in-person signing, by name. */
  witnessName?: string | null
}

function row(label: string, value: string): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
}

function partyBlock(party: CertificateParty): string {
  if (party.status !== 'signed' || !party.signed_at || !party.method) {
    return ''
  }
  const rows = [
    row('Name on our records', party.name),
    row('Name typed', party.typed_name ?? ''),
    row('Signed', formatSigningInstant(party.signed_at)),
    row('How', METHOD_LABELS[party.method]),
  ]
  if (party.email) rows.push(row('Link sent to', party.email))
  if (party.method === 'in_person' && party.witnessName) rows.push(row('Manager present', party.witnessName))
  if (party.identity_checked_at) rows.push(row('Identity check', 'Date of birth matched our records'))
  if (party.document_viewed_at) rows.push(row('Document opened', formatSigningInstant(party.document_viewed_at)))
  rows.push(row('Internet address', party.signed_ip ?? 'Not available'))
  rows.push(row('Approximate location', describeLocation({
    city: party.signed_city,
    region: party.signed_region,
    country: party.signed_country,
  })))
  rows.push(row('Device', describeDevice(party.signed_user_agent)))
  rows.push(row('Agreed to', party.agreed_text ?? ''))

  return `<section class="party">
    <h2>${escapeHtml(signingRoleLabel(party.role))}</h2>
    <table>${rows.join('')}</table>
  </section>`
}

export function renderCertificateHtml(input: {
  document: Pick<SigningDocumentRow, 'id' | 'title' | 'version' | 'source_sha256' | 'sent_at' | 'completed_at'>
  parties: CertificateParty[]
  /** True when the pages before this one show each signature in its place. */
  signedInPlace?: boolean
}): string {
  const { document } = input
  const signed = input.parties.filter((party) => party.status === 'signed')

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<title>Signing record</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; line-height: 1.45; color: ${STAFF.text}; }
  h1 { font-size: 16pt; margin: 0 0 4px; }
  .lede { margin: 0 0 14px; color: ${STAFF.textMuted}; }
  h2 { font-size: 11pt; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 12px; }
  th, td { text-align: left; vertical-align: top; padding: 3px 0; border-bottom: 1px solid ${STAFF.border}; }
  th { width: 34%; font-weight: normal; color: ${STAFF.textMuted}; padding-right: 10px; }
  td { word-break: break-word; }
  .party { break-inside: avoid; margin-top: 12px; }
  .fingerprint { font-family: 'Courier New', Courier, monospace; font-size: 8.5pt; }
  .note { margin-top: 14px; font-size: 8pt; color: ${STAFF.textMuted}; break-inside: avoid; }
</style>
</head>
<body>
  <h1>Signing record</h1>
  <p class="lede">This page records how the document before it was signed. It was added automatically by ${escapeHtml(COMPANY_DETAILS.legalName)}.</p>
  <table>
    ${row('Document', document.title)}
    ${row('Version', String(document.version))}
    ${row('Reference', document.id)}
    ${row('Sent', formatSigningInstant(document.sent_at))}
    ${document.completed_at ? row('Completed', formatSigningInstant(document.completed_at)) : ''}
    <tr><th>Fingerprint of the document (SHA-256)</th><td class="fingerprint">${escapeHtml(document.source_sha256)}</td></tr>
  </table>
  ${signed.map(partyBlock).join('\n')}
  <p class="note">
    All times are UK time. The fingerprint is calculated from the exact file each person was shown
    before signing: any change to that file, however small, produces a different fingerprint.
    ${input.signedInPlace
      ? 'The pages before this one are that same document with each signature panel completed; nothing else in it was changed.'
      : 'The pages before this one are that file.'}
    The location is approximate, worked out from the internet address, and is usually the nearest town.
  </p>
</body>
</html>`
}

/** Add the signing record pages to the end of the document everyone was shown. */
export async function appendCertificate(sourcePdf: Uint8Array, certificatePdf: Uint8Array): Promise<Uint8Array> {
  const merged = await PDFDocument.load(sourcePdf)
  const certificate = await PDFDocument.load(certificatePdf)
  const pages = await merged.copyPages(certificate, certificate.getPageIndices())
  for (const page of pages) {
    merged.addPage(page)
  }
  return merged.save()
}
