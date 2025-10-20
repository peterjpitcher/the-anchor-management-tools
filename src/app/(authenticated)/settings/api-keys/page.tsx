import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import ApiKeysManager from './ApiKeysManager'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
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
  const errorMessage = 'error' in apiKeysResult ? apiKeysResult.error : null
  const apiKeys = 'data' in apiKeysResult ? apiKeysResult.data : []

  return (
    <PageLayout
      title="API Key Management"
      subtitle="Manage API keys for external integrations"
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      {errorMessage ? (
        <Alert variant="error" title="Failed to load API keys" description={errorMessage} />
      ) : (
        <ApiKeysManager initialKeys={apiKeys} canManage={!!canManage} />
      )}
    </PageLayout>
  )
}
