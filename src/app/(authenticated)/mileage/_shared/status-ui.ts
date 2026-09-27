import type { MileageReportTrip } from '@/lib/mileage/report/dataset'

/**
 * How a trip's source looks on staff screens. Pure module, safe to import from server and client
 * components. A trip logged here is neutral; one that came from OJ Projects wears the brand colour,
 * because it is edited in OJ Projects rather than here.
 */
export const MILEAGE_TRIP_SOURCE_TONE: Record<MileageReportTrip['source'], 'primary' | 'neutral'> = {
  manual: 'neutral',
  oj_projects: 'primary',
}

export const MILEAGE_TRIP_SOURCE_LABEL: Record<MileageReportTrip['source'], string> = {
  manual: 'Logged',
  oj_projects: 'OJ Projects',
}
