'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Button } from '@/ds'
import {
  fetchVoucherCounts,
  type FohStaffMember,
  type FohVoucherCounts
} from './lib'
import { StaffPicker } from './components/StaffPicker'
import { RedeemPanel } from './components/RedeemPanel'
import { HandOutPanel } from './components/HandOutPanel'

type VouchersFohClientProps = {
  canEdit: boolean
  staff: FohStaffMember[]
  todayIso: string
}

type VoucherTab = 'redeem' | 'handout'

// The chosen staff member is remembered per device (spec section 4).
const STAFF_STORAGE_KEY = 'foh-vouchers-staff-id'

export function VouchersFohClient({ canEdit, staff, todayIso }: VouchersFohClientProps) {
  const [tab, setTab] = useState<VoucherTab>('redeem')
  const [counts, setCounts] = useState<FohVoucherCounts | null>(null)
  const [staffId, setStaffId] = useState<string | null>(null)

  const loadCounts = useCallback(async () => {
    const data = await fetchVoucherCounts()
    if (data) {
      setCounts(data)
    }
  }, [])

  useEffect(() => {
    loadCounts()
  }, [loadCounts])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STAFF_STORAGE_KEY)
      if (stored && staff.some((member) => member.id === stored)) {
        setStaffId(stored)
      }
    } catch {
      // Storage unavailable; the picker just starts empty.
    }
  }, [staff])

  function handleStaffChange(employeeId: string) {
    setStaffId(employeeId)
    try {
      window.localStorage.setItem(STAFF_STORAGE_KEY, employeeId)
    } catch {
      // Storage unavailable; selection still applies for this visit.
    }
  }

  const staffName = staffId ? staff.find((member) => member.id === staffId)?.name ?? null : null

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <dl className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="min-w-0 rounded-lg border border-border bg-surface p-3 text-center">
          <dd className="text-3xl font-extrabold text-text">{counts ? counts.inStock : '-'}</dd>
          <dt className="mt-1 text-sm font-medium text-text-muted">In stock</dt>
        </div>
        <div className="min-w-0 rounded-lg border border-border bg-surface p-3 text-center">
          <dd className="text-3xl font-extrabold text-text">{counts ? counts.out : '-'}</dd>
          <dt className="mt-1 text-sm font-medium text-text-muted">Out with guests</dt>
        </div>
        <div className="min-w-0 rounded-lg border border-border bg-surface p-3 text-center">
          <dd className="text-3xl font-extrabold text-text">
            {counts ? counts.redeemedToday : '-'}
          </dd>
          <dt className="mt-1 text-sm font-medium text-text-muted">Redeemed today</dt>
        </div>
      </dl>

      <div className="rounded-lg border border-border bg-surface p-4">
        <StaffPicker staff={staff} value={staffId} onChange={handleStaffChange} />
      </div>

      {/* The chosen mode is a filled primary button, the other a secondary one. */}
      <div className="flex gap-2" role="group" aria-label="Voucher actions">
        <Button
          type="button"
          variant={tab === 'redeem' ? 'primary' : 'secondary'}
          size="lg"
          onClick={() => setTab('redeem')}
          aria-pressed={tab === 'redeem'}
          className="h-14 flex-1 text-lg font-bold"
        >
          Redeem
        </Button>
        <Button
          type="button"
          variant={tab === 'handout' ? 'primary' : 'secondary'}
          size="lg"
          onClick={() => setTab('handout')}
          aria-pressed={tab === 'handout'}
          className="h-14 flex-1 text-lg font-bold"
        >
          Hand out
        </Button>
      </div>

      {tab === 'redeem' ? (
        <RedeemPanel canEdit={canEdit} staffId={staffId} todayIso={todayIso} onMutated={loadCounts} />
      ) : (
        <HandOutPanel
          canEdit={canEdit}
          staffId={staffId}
          staffName={staffName}
          todayIso={todayIso}
          onMutated={loadCounts}
        />
      )}
    </div>
  )
}
