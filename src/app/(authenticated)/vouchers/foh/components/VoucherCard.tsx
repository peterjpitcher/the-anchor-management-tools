'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import {
  formatIsoDateLong,
  formatLondonTimestamp,
  formatPounds,
  type FohVoucherLookupItem
} from '../lib'
import { statusLabel, statusPillClass } from './voucher-status'

type VoucherCardMode = 'redeem' | 'handout'

type VoucherCardProps = {
  item: FohVoucherLookupItem
  mode: VoucherCardMode
  onViewReplacement?: (voucherNumber: string) => void
  children?: React.ReactNode
}

export function isActionable(item: FohVoucherLookupItem, mode: VoucherCardMode): boolean {
  if (mode === 'redeem') {
    return item.status === 'issued'
  }
  return item.storedStatus === 'generated' && item.batchReady
}

// Every blocked state renders its exact reason with who/when and no action
// button (spec section 4). Wording is text-first; colour is never the only cue.
function blockedReason(item: FohVoucherLookupItem, mode: VoucherCardMode): string | null {
  if (isActionable(item, mode)) {
    return null
  }

  switch (item.status) {
    case 'redeemed':
      return `Already used${item.redeemedAt ? ` on ${formatLondonTimestamp(item.redeemedAt)}` : ''}${
        item.redeemedByName ? ` by ${item.redeemedByName}` : ''
      }.`
    case 'expired':
      return `Expired${item.expiryDate ? ` on ${formatIsoDateLong(item.expiryDate)}` : ''}. Only a manager can override an expired voucher.`
    case 'cancelled':
      return `Cancelled${item.cancelledAt ? ` on ${formatLondonTimestamp(item.cancelledAt)}` : ''}${
        item.cancelledReason ? `. Reason: ${item.cancelledReason}` : ''
      }.`
    case 'replaced':
      return `Replaced${item.cancelledAt ? ` on ${formatLondonTimestamp(item.cancelledAt)}` : ''}${
        item.cancelledReason ? `. Reason: ${item.cancelledReason}` : ''
      }.${item.replacementNumber ? ` The new card is ${item.replacementNumber}.` : ''}`
    case 'generated':
      if (mode === 'redeem') {
        return 'Not handed out yet. Switch to the Hand out tab to issue this voucher first.'
      }
      return 'This batch is not ready to hand out yet (the print file has not finished). Ask a manager.'
    case 'issued':
      if (mode === 'handout') {
        return `Already handed out${item.issuedAt ? ` on ${formatLondonTimestamp(item.issuedAt)}` : ''}${
          item.issuedByName ? ` by ${item.issuedByName}` : ''
        }${item.wonAtLabel ? ` (${item.wonAtLabel})` : ''}.`
      }
      return null
    default:
      return null
  }
}

export function VoucherCard({ item, mode, onViewReplacement, children }: VoucherCardProps) {
  const actionable = isActionable(item, mode)
  const reason = blockedReason(item, mode)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xl font-bold text-gray-900">{item.number}</span>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold',
            statusPillClass(item.status)
          )}
        >
          {statusLabel(item.status)}
        </span>
      </div>

      <h3 className="mt-3 text-2xl font-extrabold leading-tight text-gray-900">{item.typeTitle}</h3>
      {/* Entitlement wording comes from our own printed-batch snapshot in the
          database (seeded by migration), never from user input. */}
      {item.entitlementHtml && (
        <div
          className="mt-1 text-lg leading-snug text-gray-800"
          dangerouslySetInnerHTML={{ __html: item.entitlementHtml }}
        />
      )}

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-base sm:grid-cols-2">
        {item.valuePence !== null && (
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-gray-500">Value</dt>
            <dd className="font-medium text-gray-900">{formatPounds(item.valuePence)}</dd>
          </div>
        )}
        {item.wonAtLabel && (
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-gray-500">Won at</dt>
            <dd className="font-medium text-gray-900">{item.wonAtLabel}</dd>
          </div>
        )}
        {item.status === 'issued' && item.ageLabel && (
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-gray-500">Handed out</dt>
            <dd className="font-medium text-gray-900">
              {item.ageLabel} ago{item.issuedByName ? ` by ${item.issuedByName}` : ''}
            </dd>
          </div>
        )}
        {item.expiryDate && (
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-gray-500">Expiry</dt>
            <dd className="font-medium text-gray-900">{formatIsoDateLong(item.expiryDate)}</dd>
          </div>
        )}
        {item.customer && (
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-gray-500">Customer</dt>
            <dd className="font-medium text-gray-900">{item.customer.name}</dd>
          </div>
        )}
      </dl>

      {actionable && mode === 'redeem' && item.alcohol && (
        <p className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-base font-medium text-blue-900">
          Includes alcohol: check the guest is 18 or over before serving.
        </p>
      )}

      {actionable && item.expiringSoon && item.expiresInDays !== null && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-base font-medium text-amber-900">
          {item.expiresInDays === 0
            ? 'Expires today.'
            : `Expires in ${item.expiresInDays} ${item.expiresInDays === 1 ? 'day' : 'days'}.`}
        </p>
      )}

      {reason && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-base font-medium text-red-900">{reason}</p>
          {item.status === 'replaced' && item.replacementNumber && onViewReplacement && (
            <button
              type="button"
              onClick={() => onViewReplacement(item.replacementNumber as string)}
              className="mt-2 min-h-[44px] rounded-md border border-red-300 bg-white px-4 py-2 text-base font-semibold text-red-900 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1"
            >
              View {item.replacementNumber}
            </button>
          )}
        </div>
      )}

      {children}
    </div>
  )
}
