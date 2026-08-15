import type { ReceiptTransaction } from '@/types/database'

export const statusLabels: Record<ReceiptTransaction['status'], string> = {
  pending: 'Pending',
  completed: 'Completed',
  auto_completed: 'Auto completed',
  no_receipt_required: 'No receipt required',
  cant_find: "Can't find",
}

export const statusToneClasses: Record<ReceiptTransaction['status'], string> = {
  pending: 'bg-warning-soft text-warning-fg',
  completed: 'bg-success-soft text-success-fg',
  auto_completed: 'bg-info-soft text-info-fg',
  no_receipt_required: 'bg-surface-hover text-text',
  cant_find: 'bg-danger-soft text-danger-fg',
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
