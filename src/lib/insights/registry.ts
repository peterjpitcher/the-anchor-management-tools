import { buildInsightsReport, type BuildInsightsOptions } from './engine'
import { cashingUpSection } from './sections/cashing-up'
import { checklistsSection } from './sections/checklists'
import { customersSection } from './sections/customers'
import { employeesSection } from './sections/employees'
import { eventsSection } from './sections/events'
import { feedbackSection } from './sections/feedback'
import { invoicesSection } from './sections/invoices'
import { maintenanceSection } from './sections/maintenance'
import { marketingSection } from './sections/marketing'
import { parkingSection } from './sections/parking'
import { privateHireSection } from './sections/private-hire'
import { recruitmentSection } from './sections/recruitment'
import { rotaSection } from './sections/rota'
import { shortLinksSection } from './sections/short-links'
import { tableBookingsSection } from './sections/table-bookings'
import type { InsightsReport, SectionDefinition } from './types'

/** Report order (spec section 5). Recruitment is last, before Manager actions. */
export const INSIGHT_SECTIONS: readonly SectionDefinition[] = [
  eventsSection,
  customersSection,
  marketingSection,
  feedbackSection,
  tableBookingsSection,
  privateHireSection,
  parkingSection,
  maintenanceSection,
  employeesSection,
  rotaSection,
  checklistsSection,
  invoicesSection,
  cashingUpSection,
  shortLinksSection,
  recruitmentSection,
]

/** Builds the full report with every section in report order. */
export function buildWeeklyInsights(options: Omit<BuildInsightsOptions, 'sections'>): Promise<InsightsReport> {
  return buildInsightsReport({ ...options, sections: INSIGHT_SECTIONS })
}
