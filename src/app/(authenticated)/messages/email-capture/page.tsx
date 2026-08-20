import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import EmailCaptureClient from './EmailCaptureClient'

export const metadata = {
  title: 'Ask for email addresses | The Anchor',
}

export default async function EmailCapturePage() {
  const canSendMessages = await checkUserPermission('messages', 'send_marketing')
  if (!canSendMessages) {
    redirect('/unauthorized')
  }

  return <EmailCaptureClient />
}
