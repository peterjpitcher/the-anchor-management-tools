'use client'

import React from 'react'
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
      <label htmlFor={id} className="block text-sm font-medium text-gray-900">
        Your name
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block h-12 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 focus:border-sidebar focus:outline-none focus:ring-2 focus:ring-sidebar/40"
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
      </select>
    </div>
  )
}
