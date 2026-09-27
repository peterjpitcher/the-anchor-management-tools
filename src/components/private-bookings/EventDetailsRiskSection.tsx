'use client'

/**
 * Enquiry intake "Event details & risk" section (SOP pack §9), shared by the
 * new and edit private-booking forms.
 *
 * All inputs submit via native FormData with names matching the DB column
 * names. Boolean checkboxes submit the string 'true' when checked (a hidden
 * 'false' companion field is NOT needed by the create/update actions, which
 * treat a missing value as false). cleardown_time is an HH:MM time input.
 */

import { useState } from 'react'
import { Card, CardBody, CardHeader, Checkbox, Field, Input, Select, Textarea } from '@/ds'
import type { BookingLayout } from '@/types/private-bookings'

interface EventDetailsRiskSectionProps {
  defaults?: {
    layout?: BookingLayout | null
    guestCountAdults?: number | null
    guestCountUnder18?: number | null
    barTabRequired?: boolean | null
    barTabLimit?: number | null
    barTabPrepaidAmount?: number | null
    barTabPreauthReference?: string | null
    outsideFood?: boolean | null
    highPowerEquipment?: boolean | null
    decorationsPlan?: string | null
    dogsExpected?: boolean | null
    specialRiskNotes?: string | null
    communicationPreference?: string | null
    cleardownTime?: string | null
  }
}

const toDefaultString = (value: number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value)

export function EventDetailsRiskSection({ defaults }: EventDetailsRiskSectionProps) {
  const [barTabRequired, setBarTabRequired] = useState<boolean>(!!defaults?.barTabRequired)

  return (
    <Card>
      <CardHeader title="Event Details & Risk" />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Layout">
            <Select
              id="layout"
              name="layout"
              defaultValue={defaults?.layout ?? ''}
              options={[
                { value: '', label: 'Select layout…' },
                { value: 'seated', label: 'Seated' },
                { value: 'standing', label: 'Standing' },
                { value: 'mixed', label: 'Mixed' },
              ]}
            />
          </Field>
          <Field label="Adults">
            <Input
              type="number"
              id="guest_count_adults"
              name="guest_count_adults"
              min="0"
              defaultValue={toDefaultString(defaults?.guestCountAdults)}
              placeholder="0"
            />
          </Field>
          <Field label="Under 18s">
            <Input
              type="number"
              id="guest_count_under_18"
              name="guest_count_under_18"
              min="0"
              defaultValue={toDefaultString(defaults?.guestCountUnder18)}
              placeholder="0"
            />
          </Field>
        </div>

        <div className="space-y-3">
          <Checkbox
            id="bar_tab_required"
            name="bar_tab_required"
            value="true"
            checked={barTabRequired}
            onChange={setBarTabRequired}
            label="Bar tab required"
          />
          {barTabRequired && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Bar tab limit (£)">
                <Input
                  type="number"
                  id="bar_tab_limit"
                  name="bar_tab_limit"
                  min="0"
                  step="0.01"
                  defaultValue={toDefaultString(defaults?.barTabLimit)}
                  placeholder="e.g. 500"
                />
              </Field>
              <Field label="Pre-paid amount (£)">
                <Input
                  type="number"
                  id="bar_tab_prepaid_amount"
                  name="bar_tab_prepaid_amount"
                  min="0"
                  step="0.01"
                  defaultValue={toDefaultString(defaults?.barTabPrepaidAmount)}
                  placeholder="e.g. 200"
                />
              </Field>
              <Field label="Pre-auth reference">
                <Input
                  type="text"
                  id="bar_tab_preauth_reference"
                  name="bar_tab_preauth_reference"
                  defaultValue={defaults?.barTabPreauthReference ?? ''}
                  placeholder="Card pre-auth reference"
                />
              </Field>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Checkbox
            id="outside_food"
            name="outside_food"
            value="true"
            defaultChecked={!!defaults?.outsideFood}
            label="Outside food"
            description="Requires the self-catering waiver."
            className="rounded-default border border-border p-3"
          />
          <Checkbox
            id="high_power_equipment"
            name="high_power_equipment"
            value="true"
            defaultChecked={!!defaults?.highPowerEquipment}
            label="High-power / amplified equipment"
            description="£25 electricity charge applies; needs approval."
            className="rounded-default border border-border p-3"
          />
          <Checkbox
            id="dogs_expected"
            name="dogs_expected"
            value="true"
            defaultChecked={!!defaults?.dogsExpected}
            label="Dogs expected"
            className="rounded-default border border-border p-3"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Communication preference">
            <Select
              id="communication_preference"
              name="communication_preference"
              defaultValue={defaults?.communicationPreference ?? ''}
              options={[
                { value: '', label: 'Select preference…' },
                { value: 'phone', label: 'Phone' },
                { value: 'email', label: 'Email' },
                { value: 'whatsapp', label: 'WhatsApp' },
                { value: 'text', label: 'Text' },
              ]}
            />
          </Field>
          <Field label="Clear-down time" hint="Standard is one hour after the event.">
            <Input
              type="time"
              id="cleardown_time"
              name="cleardown_time"
              defaultValue={(defaults?.cleardownTime ?? '').slice(0, 5)}
            />
          </Field>
        </div>

        <Field label="Decorations plan">
          <Textarea
            id="decorations_plan"
            name="decorations_plan"
            rows={2}
            defaultValue={defaults?.decorationsPlan ?? ''}
            placeholder="Balloons, banners, who is putting them up and taking them down..."
          />
        </Field>

        <Field label="Special risk notes">
          <Textarea
            id="special_risk_notes"
            name="special_risk_notes"
            rows={2}
            defaultValue={defaults?.specialRiskNotes ?? ''}
            placeholder="Anything that needs a risk assessment or extra care on the day..."
          />
        </Field>
      </CardBody>
    </Card>
  )
}
