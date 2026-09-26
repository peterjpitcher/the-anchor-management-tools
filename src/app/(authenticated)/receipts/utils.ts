export function formatCurrency(value: number | null) {
  if (value === null || value === undefined) return ''
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

export function formatDate(value: string) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-GB', { timeZone: 'UTC' })
}

function buildReceiptName(details: string, amount: number | null) {
  const safeDetails = details
    .trim()
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
  const amountLabel = amount ? amount.toFixed(2) : '0.00'
  return `${safeDetails} · £${amountLabel}`
}
