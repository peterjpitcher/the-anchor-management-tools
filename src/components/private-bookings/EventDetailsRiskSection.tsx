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
import { ShieldExclamationIcon } from '@heroicons/react/24/outline'
import { Section, FormGroup, Input, Select, Textarea } from '@/ds'
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
    <Section title="Event details & risk" icon={<ShieldExclamationIcon className="h-5 w-5" />}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-4">
          <FormGroup label="Layout">
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
          </FormGroup>
          <FormGroup label="Adults">
            <Input
              type="number"
              id="guest_count_adults"
              name="guest_count_adults"
              min="0"
              defaultValue={toDefaultString(defaults?.guestCountAdults)}
              placeholder="0"
            />
          </FormGroup>
          <FormGroup label="Under 18s">
            <Input
              type="number"
              id="guest_count_under_18"
              name="guest_count_under_18"
              min="0"
              defaultValue={toDefaultString(defaults?.guestCountUnder18)}
              placeholder="0"
            />
          </FormGroup>
        </div>

        <div className="rounded-md border border-border bg-surface-2 p-3 space-y-3">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              id="bar_tab_required"
              name="bar_tab_required"
              value="true"
              checked={barTabRequired}
              onChange={(e) => setBarTabRequired(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span>Bar tab required</span>
          </label>
          {barTabRequired && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-4">
              <FormGroup label="Bar tab limit (£)">
                <Input
                  type="number"
                  id="bar_tab_limit"
                  name="bar_tab_limit"
                  min="0"
                  step="0.01"
                  defaultValue={toDefaultString(defaults?.barTabLimit)}
                  placeholder="e.g. 500"
                />
              </FormGroup>
              <FormGroup label="Pre-paid amount (£)">
                <Input
                  type="number"
                  id="bar_tab_prepaid_amount"
                  name="bar_tab_prepaid_amount"
                  min="0"
                  step="0.01"
                  defaultValue={toDefaultString(defaults?.barTabPrepaidAmount)}
                  placeholder="e.g. 200"
                />
              </FormGroup>
              <FormGroup label="Pre-auth reference">
                <Input
                  type="text"
                  id="bar_tab_preauth_reference"
                  name="bar_tab_preauth_reference"
                  defaultValue={defaults?.barTabPreauthReference ?? ''}
                  placeholder="Card pre-auth reference"
                />
              </FormGroup>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm text-gray-700">
            <input
              type="checkbox"
              id="outside_food"
              name="outside_food"
              value="true"
              defaultChecked={!!defaults?.outsideFood}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span>
              <span className="font-medium">Outside food</span>
              <span className="block text-xs text-gray-500">Requires the self-catering waiver.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm text-gray-700">
            <input
              type="checkbox"
              id="high_power_equipment"
              name="high_power_equipment"
              value="true"
              defaultChecked={!!defaults?.highPowerEquipment}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span>
              <span className="font-medium">High-power / amplified equipment</span>
              <span className="block text-xs text-gray-500">£25 electricity charge applies; needs approval.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm text-gray-700">
            <input
              type="checkbox"
              id="dogs_expected"
              name="dogs_expected"
              value="true"
              defaultChecked={!!defaults?.dogsExpected}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span>
              <span className="font-medium">Dogs expected</span>
            </span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-4">
          <FormGroup label="Communication preference">
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
          </FormGroup>
          <FormGroup label="Clear-down time" help="Standard is one hour after the event.">
            <Input
              type="time"
              id="cleardown_time"
              name="cleardown_time"
              defaultValue={(defaults?.cleardownTime ?? '').slice(0, 5)}
            />
          </FormGroup>
        </div>

        <FormGroup label="Decorations plan">
          <Textarea
            id="decorations_plan"
            name="decorations_plan"
            rows={2}
            defaultValue={defaults?.decorationsPlan ?? ''}
            placeholder="Balloons, banners, who is putting them up and taking them down..."
          />
        </FormGroup>

        <FormGroup label="Special risk notes">
          <Textarea
            id="special_risk_notes"
            name="special_risk_notes"
            rows={2}
            defaultValue={defaults?.specialRiskNotes ?? ''}
            placeholder="Anything that needs a risk assessment or extra care on the day..."
          />
        </FormGroup>
      </div>
    </Section>
  )
}
