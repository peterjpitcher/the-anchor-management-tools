'use client'

import { Checkbox, Fieldset, Input, Radio } from '@/ds'
import {
  STAFF_CANCELLED_BY_OPTIONS,
  type StaffCancelFormState,
} from '@/lib/table-bookings/staff-cancellation'

/**
 * "Who is cancelling?" on every staff cancel of a table booking (BK-046, owner decision D7), with
 * a manager's own refund amount when the booking holds a deposit.
 *
 * Required: nothing is preselected, so the person cancelling has to decide whether the guest
 * asked or the pub is cancelling, which sets the refund and the words the guest gets.
 */
export function StaffCancelChoice({
  value,
  onChange,
  heldGbp,
  canChooseAmount,
  disabled = false,
  name,
}: {
  value: StaffCancelFormState
  onChange: (next: StaffCancelFormState) => void
  /** What the guest paid and still has with us. Zero hides the amount field. */
  heldGbp: number
  /** table_bookings manage: only a manager chooses the refund amount. */
  canChooseAmount: boolean
  disabled?: boolean
  /** The radio group's name, unique on the page. */
  name: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <Fieldset legend="Who is cancelling?" required>
        {STAFF_CANCELLED_BY_OPTIONS.map((option) => (
          <Radio
            key={option.value}
            name={name}
            value={option.value}
            label={option.label}
            description={option.description}
            checked={value.cancelledBy === option.value}
            disabled={disabled}
            onChange={() => onChange({ ...value, cancelledBy: option.value })}
          />
        ))}
      </Fieldset>

      {heldGbp > 0 && canChooseAmount ? (
        <div className="flex flex-col gap-2">
          <Checkbox
            label="Choose the refund amount"
            description={`Starts from what the guest paid and still has with us: £${heldGbp.toFixed(2)}.`}
            checked={value.chooseAmount}
            disabled={disabled}
            onChange={(checked) => onChange({ ...value, chooseAmount: checked })}
          />
          {value.chooseAmount ? (
            <Input
              label="Refund (£)"
              type="number"
              inputMode="decimal"
              min="0.01"
              max={heldGbp.toFixed(2)}
              step="0.01"
              value={value.amountText}
              disabled={disabled}
              onChange={(event) => onChange({ ...value, amountText: event.target.value })}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
