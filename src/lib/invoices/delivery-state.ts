export function buildInvoiceSentUpdate(recipient: string, sentAtIso = new Date().toISOString()) {
  return {
    status: 'sent' as const,
    sent_at: sentAtIso,
    sent_to: recipient,
    updated_at: sentAtIso,
  }
}
