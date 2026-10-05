import { describe, expect, it } from 'vitest'
import { generateEmployeeStarterHTML } from '@/lib/employee-starter-template'
import { generateEventSheetHTML, type EventSheetData } from '@/lib/private-bookings/event-sheet'

/**
 * The starter pack and the private booking event sheet each close with their own footer, outside
 * the shared document chrome. Left as an ordinary block it printed alone on a last page whenever
 * the body ended near the foot of the one before, as the customer documents did until
 * 5 October 2026.
 */

const EVENT_SHEET: EventSheetData = {
  bookingId: '3f2a9c1e-0000-4000-8000-000000000001',
  bookingStatus: 'confirmed',
  hostName: 'Alex Example',
  contactPhone: '07700 900123',
  eventType: 'Birthday party',
  eventDate: '2026-11-14',
  startTime: '18:00',
  endTime: '23:30',
  endTimeNextDay: false,
  setupDate: null,
  setupTime: null,
  cleardownTime: null,
  guestCount: 40,
  guestCountAdults: 38,
  guestCountUnder18: 2,
  layout: null,
  items: [],
  barTabRequired: false,
  barTabLimit: null,
  barTabPrepaidAmount: null,
  barTabPreauthReference: null,
  accessibilityNotes: null,
  dietaryNotes: null,
  outsideFood: false,
  waiverStatus: 'not_required',
  supplierStatus: 'none',
  suppliers: [],
  highPowerEquipment: false,
  highPowerEquipmentApprovedAt: null,
  decorationsPlan: null,
  dogsExpected: false,
  riskStatus: 'standard',
  specialRiskNotes: null,
}

const STARTER_PACK = generateEmployeeStarterHTML({
  employee: {
    employee_id: 'employee-1',
    first_name: 'Sam',
    last_name: 'Example',
    email_address: null,
    job_title: 'Bar staff',
    status: 'Active',
    employment_start_date: '2026-10-12',
    first_shift_date: null,
    date_of_birth: null,
    address: null,
    post_code: null,
    phone_number: null,
    mobile_number: null,
  },
  niDetails: null,
  rightToWork: null,
  generatedDate: '5 October 2026',
})

const footerRuleOf = (html: string): string => html.match(/\.footer \{([^}]*)\}/)?.[1] ?? ''

describe('staff documents keep their closing footer with the block above it', () => {
  it.each([
    ['event sheet', generateEventSheetHTML(EVENT_SHEET)],
    ['starter pack', STARTER_PACK],
  ])('%s', (_name, html) => {
    expect(html).toContain('<div class="footer">')
    expect(footerRuleOf(html)).toContain('page-break-inside: avoid;')
    expect(footerRuleOf(html)).toContain('page-break-before: avoid;')
  })
})
