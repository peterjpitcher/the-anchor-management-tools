import { getDocumentLogoDataUri } from '@/lib/pdf/document-logo'
import { generateCompactQuoteHTML } from '@/lib/quote-template-compact'
import type { QuoteWithDetails } from '@/types/invoices'
import type { SigningDocumentSource } from '../prepare'
import { signatureSlot } from '../signature-slots'

/**
 * A quote, for acceptance online. It is the quote exactly as its PDF prints it, with one panel
 * added above the footer where the client's acceptance is shown once they have accepted. The
 * quote's own wording, including its "How to Accept This Quote" section, is not changed.
 */

export const QUOTE_SLOT_CLIENT = 'quote:client'

const FOOTER_START = '  <div class="footer">'

export function buildQuoteSigningSource(quote: QuoteWithDetails): SigningDocumentSource {
  const html = generateCompactQuoteHTML({ quote, logoUrl: getDocumentLogoDataUri() })
  if (html.split(FOOTER_START).length !== 2) {
    // The panel goes just above the footer. If the footer has moved, stop, do not guess.
    throw new Error('Quote: the document footer was not found, so the acceptance panel could not be placed')
  }
  const panel = `  <div class="acceptance-section keep-together">
    <h3>Accepted Online</h3>
    <p>This quote can also be accepted online, using the personal link in our email. The acceptance is recorded here.</p>
    ${signatureSlot(QUOTE_SLOT_CLIENT)}
  </div>

`
  return {
    html: html.replace(FOOTER_START, `${panel}${FOOTER_START}`),
    // The quote PDF's own print settings (src/lib/pdf-generator.ts, generateQuotePDF).
    profile: 'a4_compact',
    slots: { [QUOTE_SLOT_CLIENT]: 'client' },
  }
}
