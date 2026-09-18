/** Issued credits reduce the collectible balance, never the original invoice total. */
export interface InvoiceBalanceInput {
  total_amount?: number | string | null
  paid_amount?: number | string | null
  credits?: Array<{ status: string; amount_inc_vat: number | string }> | null
}

export function invoiceIssuedCreditTotal(invoice: InvoiceBalanceInput): number {
  return Math.round((invoice.credits ?? []).filter(credit => credit.status === 'issued').reduce((sum, credit) => {
    const amount = Number(credit.amount_inc_vat)
    if (!Number.isFinite(amount) || amount < 0) throw new Error('An invoice credit has an invalid amount.')
    return sum + amount
  }, 0) * 100) / 100
}

export function invoiceBalanceDue(invoice: InvoiceBalanceInput): number {
  const total = Number(invoice.total_amount ?? 0)
  const paid = Number(invoice.paid_amount ?? 0)
  if (!Number.isFinite(total) || !Number.isFinite(paid)) throw new Error('An invoice balance has an invalid amount.')
  return Math.max(0, Math.round((total - invoiceIssuedCreditTotal(invoice) - paid) * 100) / 100)
}
