import type { VoucherStatus } from '@/types/vouchers'

// Status is always conveyed as text as well as colour (F46).
export function statusLabel(status: VoucherStatus): string {
  switch (status) {
    case 'generated':
      return 'In stock'
    case 'issued':
      return 'Active'
    case 'redeemed':
      return 'Used'
    case 'expired':
      return 'Expired'
    case 'cancelled':
      return 'Cancelled'
    case 'replaced':
      return 'Replaced'
    default:
      return status
  }
}

// Static class maps only (no dynamic Tailwind construction).
export function statusPillClass(status: VoucherStatus): string {
  switch (status) {
    case 'generated':
      return 'bg-gray-100 text-gray-800 border border-gray-300'
    case 'issued':
      return 'bg-green-100 text-green-900 border border-green-300'
    case 'redeemed':
      return 'bg-slate-200 text-slate-800 border border-slate-300'
    case 'expired':
      return 'bg-red-100 text-red-900 border border-red-300'
    case 'cancelled':
      return 'bg-red-100 text-red-900 border border-red-300'
    case 'replaced':
      return 'bg-amber-100 text-amber-900 border border-amber-300'
    default:
      return 'bg-gray-100 text-gray-800 border border-gray-300'
  }
}
