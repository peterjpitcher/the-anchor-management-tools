import { getWorkTypes } from '@/app/actions/oj-projects/work-types'
import { WorkTypesClient } from './_components/WorkTypesClient'

export default async function OJWorkTypesPage(): Promise<React.ReactElement> {
  const { workTypes } = await getWorkTypes()

  return <WorkTypesClient initialWorkTypes={workTypes ?? []} />
}
