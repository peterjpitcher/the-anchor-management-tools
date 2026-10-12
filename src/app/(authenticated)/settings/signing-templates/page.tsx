import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getSigningTemplates } from '@/app/actions/signing'
import SigningTemplatesManager from './SigningTemplatesManager'

export const dynamic = 'force-dynamic'

export default async function SigningTemplatesPage(): Promise<React.JSX.Element> {
  const canManage = await checkUserPermission('settings', 'manage')
  if (!canManage) redirect('/unauthorized')

  const result = await getSigningTemplates()
  return (
    <SigningTemplatesManager
      initialTemplates={result.data ?? []}
      loadError={result.error ?? null}
    />
  )
}
