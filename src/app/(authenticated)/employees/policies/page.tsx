import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getPolicyOverview, getPolicyTemplates } from '@/app/actions/signing-staff'
import PoliciesClient from './PoliciesClient'

export const dynamic = 'force-dynamic'

type PageProps = { searchParams: Promise<{ policy?: string }> }

export default async function EmployeePoliciesPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const [canView, canSend] = await Promise.all([
    checkUserPermission('employees', 'view'),
    checkUserPermission('employees', 'edit'),
  ])
  if (!canView) redirect('/unauthorized')

  const { policy } = await searchParams
  const templatesResult = await getPolicyTemplates()
  const templates = templatesResult.data ?? []
  const selected = templates.find((template) => template.slug === policy) ?? templates[0] ?? null
  const overviewResult = selected ? await getPolicyOverview(selected.slug) : null

  return (
    <PoliciesClient
      templates={templates}
      overview={overviewResult?.data ?? null}
      loadError={templatesResult.error ?? overviewResult?.error ?? null}
      canSend={canSend}
    />
  )
}
