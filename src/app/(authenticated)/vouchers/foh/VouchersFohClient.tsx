'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Card, Segmented, Stat, StatGrid } from '@/ds'
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
    // data-touch-targets lifts every control on this screen to 44px on the bar iPad
    // (globals.css, pointer: coarse). The wrapper exists for that scope; it spaces its blocks
    // the way PageLayout spaces a page.
    <div data-touch-targets="" className="space-y-6">
      <StatGrid columns={3}>
        <Stat label="In stock" value={counts ? counts.inStock : '-'} />
        <Stat label="Out with guests" value={counts ? counts.out : '-'} />
        <Stat label="Redeemed today" value={counts ? counts.redeemedToday : '-'} />
      </StatGrid>

      <Card>
        <StaffPicker staff={staff} value={staffId} onChange={handleStaffChange} />
      </Card>

      {/* Redeem or hand out: two views of the same voucher lookup. Full width, so each half is
          an easy target on the iPad. Segmented takes no aria-label, so the group around it
          carries the name the toggle had before ("Voucher actions"). */}
      <div role="group" aria-label="Voucher actions">
        <Segmented
          options={[
            { id: 'redeem', label: 'Redeem' },
            { id: 'handout', label: 'Hand Out' },
          ]}
          value={tab}
          onChange={(id) => setTab(id as VoucherTab)}
          className="w-full [&>button]:min-h-touch [&>button]:flex-1 [&>button]:text-base"
        />
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
