import { getChecklistProblems } from '@/app/actions/checklists-spotcheck'
import { ProblemsClient } from '../_components/ProblemsClient'

export default async function ChecklistsProblemsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const { from, to } = await searchParams
  const res = await getChecklistProblems(from, to)
  return <ProblemsClient data={res.data} error={res.error} />
}
