'use client'

import { Checkbox } from '@/ds'
import { STAFF_MARKETING_READ_OUT } from '@/lib/consent/constants'

type Props = {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  idPrefix?: string
}

/**
 * The notice staff read to a guest they are booking in person or by phone, and the box they tick
 * only when the guest says yes (owner decision D32, BK-079). Without a recorded yes a guest booked
 * by staff gets booking texts only, never the regulars promotions.
 */
export function StaffMarketingConsentField({ checked, onChange, disabled, idPrefix = 'staff-marketing' }: Props) {
  return (
    <div className="space-y-2 rounded-default border border-border bg-bg p-3">
      <p className="text-sm text-text-muted">
        Read this to the guest: <span className="text-text">&ldquo;{STAFF_MARKETING_READ_OUT}&rdquo;</span>
      </p>
      <Checkbox
        id={`${idPrefix}-yes`}
        label="They said yes to texts about what's on"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  )
}
