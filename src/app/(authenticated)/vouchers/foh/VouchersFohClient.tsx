'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
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

  const tabButtonClass = (active: boolean) =>
    cn(
      'min-h-[56px] flex-1 rounded-lg border px-4 py-3 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-sidebar/40 focus:ring-offset-2',
      active
        ? 'border-sidebar bg-sidebar text-white'
        : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
    )

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <dl className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-3 text-center">
          <dd className="text-3xl font-extrabold text-gray-900">{counts ? counts.inStock : '-'}</dd>
          <dt className="mt-1 text-sm font-medium text-gray-600">In stock</dt>
        </div>
        <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-3 text-center">
          <dd className="text-3xl font-extrabold text-gray-900">{counts ? counts.out : '-'}</dd>
          <dt className="mt-1 text-sm font-medium text-gray-600">Out with guests</dt>
        </div>
        <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-3 text-center">
          <dd className="text-3xl font-extrabold text-gray-900">
            {counts ? counts.redeemedToday : '-'}
          </dd>
          <dt className="mt-1 text-sm font-medium text-gray-600">Redeemed today</dt>
        </div>
      </dl>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <StaffPicker staff={staff} value={staffId} onChange={handleStaffChange} />
      </div>

      <div className="flex gap-2" role="group" aria-label="Voucher actions">
        <button
          type="button"
          onClick={() => setTab('redeem')}
          aria-pressed={tab === 'redeem'}
          className={tabButtonClass(tab === 'redeem')}
        >
          Redeem
        </button>
        <button
          type="button"
          onClick={() => setTab('handout')}
          aria-pressed={tab === 'handout'}
          className={tabButtonClass(tab === 'handout')}
        >
          Hand out
        </button>
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
