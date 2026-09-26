'use client'

import React from 'react'
import { Alert, Badge, Button, Card, CardBody, CardHeader } from '@/ds'
import {
  formatIsoDateLong,
  formatLondonTimestamp,
  formatPounds,
  type FohVoucherLookupItem
} from '../lib'
import { statusLabel, statusTone } from './voucher-status'

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
        return 'Not handed out yet. Switch to the Hand Out tab to issue this voucher first.'
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
    <Card>
      <CardHeader
        title={item.number}
        action={
          // Kiosk-sized: read at arm's length on the bar iPad.
          <Badge tone={statusTone(item.status)} className="px-3 py-1 text-sm font-semibold">
            {statusLabel(item.status)}
          </Badge>
        }
      />
      <CardBody>
        {/* What the guest won, large enough to read across the bar. */}
        <p className="text-2xl font-extrabold leading-tight text-text">{item.typeTitle}</p>
        {/* Entitlement wording comes from our own printed-batch snapshot in the
            database (seeded by migration), never from user input. */}
        {item.entitlementHtml && (
          <div
            className="mt-1 text-lg leading-snug text-text"
            dangerouslySetInnerHTML={{ __html: item.entitlementHtml }}
          />
        )}

        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-base sm:grid-cols-2">
          {item.valuePence !== null && (
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-text-muted">Value</dt>
              <dd className="font-medium text-text">{formatPounds(item.valuePence)}</dd>
            </div>
          )}
          {item.wonAtLabel && (
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-text-muted">Won at</dt>
              <dd className="font-medium text-text">{item.wonAtLabel}</dd>
            </div>
          )}
          {item.status === 'issued' && item.ageLabel && (
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-text-muted">Handed out</dt>
              <dd className="font-medium text-text">
                {item.ageLabel} ago{item.issuedByName ? ` by ${item.issuedByName}` : ''}
              </dd>
            </div>
          )}
          {item.expiryDate && (
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-text-muted">Expiry</dt>
              <dd className="font-medium text-text">{formatIsoDateLong(item.expiryDate)}</dd>
            </div>
          )}
          {item.customer && (
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-text-muted">Customer</dt>
              <dd className="font-medium text-text">{item.customer.name}</dd>
            </div>
          )}
        </dl>

        {actionable && mode === 'redeem' && item.alcohol && (
          <Alert tone="info" role="status" className="mt-3">
            Includes alcohol: check the guest is 18 or over before serving.
          </Alert>
        )}

        {actionable && item.expiringSoon && item.expiresInDays !== null && (
          <Alert tone="warning" role="status" className="mt-3">
            {item.expiresInDays === 0
              ? 'Expires today.'
              : `Expires in ${item.expiresInDays} ${item.expiresInDays === 1 ? 'day' : 'days'}.`}
          </Alert>
        )}

        {reason && (
          <Alert
            tone="danger"
            role="status"
            className="mt-3"
            actions={
              item.status === 'replaced' && item.replacementNumber && onViewReplacement ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  onClick={() => onViewReplacement(item.replacementNumber as string)}
                  className="min-h-touch text-base"
                >
                  View {item.replacementNumber}
                </Button>
              ) : undefined
            }
          >
            {reason}
          </Alert>
        )}

        {children}
      </CardBody>
    </Card>
  )
}
