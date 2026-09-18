'use client'

import React from 'react'
import { Select } from '@/ds'
import type { FohStaffMember } from '../lib'

type StaffPickerProps = {
  staff: FohStaffMember[]
  value: string | null
  onChange: (employeeId: string) => void
  id?: string
}

// Staff attribution picker (spec section 4 / F29): clocked-in staff first,
// remembered per device by the parent via localStorage. Native select keeps it
// accessible and easy to hit on the iPad.
export function StaffPicker({ staff, value, onChange, id = 'foh-voucher-staff' }: StaffPickerProps) {
  const clockedIn = staff.filter((member) => member.clockedIn)
  const others = staff.filter((member) => !member.clockedIn)

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-text">
        Your name
      </label>
      <Select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 text-base"
      >
        <option value="" disabled>
          Choose who is doing this
        </option>
        {clockedIn.length > 0 && (
          <optgroup label="Clocked in">
            {clockedIn.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label={clockedIn.length > 0 ? 'Other staff' : 'Staff'}>
            {others.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
    </div>
  )
}
