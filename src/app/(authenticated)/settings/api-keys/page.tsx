import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import ApiKeysManager from './ApiKeysManager'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { checkUserPermission } from '@/app/actions/rbac'
import { getApiKeys } from './actions'

export const metadata: Metadata = {
  title: 'API Keys',
  description: 'Manage API keys for external integrations',
}

export default async function ApiKeysPage() {
  const [canView, canManage] = await Promise.all([
    checkUserPermission('settings', 'view'),
    checkUserPermission('settings', 'manage'),
  ])

  if (!canView) {
    redirect('/unauthorized')
  }

  const apiKeysResult = await getApiKeys()

  return (
    <div>
      <PageHeader
        title="API Key Management"
        subtitle="Manage API keys for external integrations"
        backButton={{
          label: 'Back to Settings',
          href: '/settings',
        }}
      />

      {'error' in apiKeysResult ? (
        <Alert
          variant="error"
          title="Failed to load API keys"
          description={apiKeysResult.error}
        />
      ) : (
        <ApiKeysManager
          initialKeys={apiKeysResult.data}
          canManage={!!canManage}
        />
      )}
    </div>
  )
}
