import type { ReceiptTransaction } from '@/types/database'

export const statusLabels: Record<ReceiptTransaction['status'], string> = {
  pending: 'Pending',
  completed: 'Completed',
  auto_completed: 'Auto completed',
  no_receipt_required: 'No receipt required',
  cant_find: "Can't find",
}

/** DS Badge tone for each receipt status: one map for the workspace, mobile cards and vendor history. */
export const statusTone: Record<ReceiptTransaction['status'], 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  pending: 'warning',
  completed: 'success',
  auto_completed: 'info',
  no_receipt_required: 'neutral',
  cant_find: 'danger',
}

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
