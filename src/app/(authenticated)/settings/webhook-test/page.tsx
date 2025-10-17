import { ensureSuperAdmin } from '@/app/actions/webhooks'
import WebhookTestClient from './WebhookTestClient'

export default async function WebhookTestPage() {
  const access = await ensureSuperAdmin()

  return (
    <WebhookTestClient
      isAuthorized={access.isSuperAdmin ?? false}
      initialError={access.error ?? null}
    />
  )
}
