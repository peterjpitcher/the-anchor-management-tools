import { getProjects } from '@/app/actions/oj-projects/projects'
import { getBillableUnbilledCount, getEntries, getEntryHoursByDate } from '@/app/actions/oj-projects/entries'
import { getWorkTypes } from '@/app/actions/oj-projects/work-types'
import { getOJClients } from '@/app/actions/oj-projects/clients'
import {
  buildWorkHistorySeries,
  getCurrentMonthEntryDateRange,
  getWorkHistoryDateRange,
  getWorkHistoryRange,
  parseWorkHistoryDays,
} from '@/lib/oj-projects/date-ranges'
import { ProjectsOverview } from './_components/ProjectsOverview'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The client filter and the work history window live in the URL rather than in component
 * state, so neither is lost when a mutation re-renders the page. Arriving at /oj-projects
 * without a query string is what resets them.
 */
export default async function OJProjectsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; range?: string }>
}): Promise<React.ReactElement> {
  const params = await searchParams
  const selectedVendorId = typeof params.client === 'string' && UUID_PATTERN.test(params.client)
    ? params.client
    : ''
  const workHistoryDays = parseWorkHistoryDays(params.range)
  const workHistoryRange = getWorkHistoryRange(workHistoryDays)
  const workHistoryDates = getWorkHistoryDateRange(workHistoryDays)
  const currentMonthRange = getCurrentMonthEntryDateRange()
  const vendorFilter = selectedVendorId ? { vendorId: selectedVendorId } : {}

  const [projectsRes, entriesRes, workTypesRes, clientsRes, hoursRes, unbilledRes] = await Promise.all([
    getProjects(),
    getEntries({ ...currentMonthRange, ...vendorFilter }),
    getWorkTypes(),
    getOJClients(),
    getEntryHoursByDate({ ...workHistoryDates, ...vendorFilter }),
    getBillableUnbilledCount(vendorFilter),
  ])

  const workHistory = buildWorkHistorySeries(hoursRes.points ?? [], {
    ...workHistoryDates,
    granularity: workHistoryRange.granularity,
  })

  return (
    <ProjectsOverview
      projects={projectsRes.projects ?? []}
      entries={entriesRes.entries ?? []}
      workTypes={workTypesRes.workTypes ?? []}
      clients={clientsRes.clients ?? []}
      selectedVendorId={selectedVendorId}
      workHistory={workHistory}
      workHistoryDays={workHistoryDays}
      billableUnbilledCount={unbilledRes.count ?? 0}
    />
  )
}
