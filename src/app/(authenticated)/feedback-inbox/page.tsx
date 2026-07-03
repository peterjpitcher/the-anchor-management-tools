import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getReviewFeedbackList } from '@/app/actions/feedback'
import type { ReviewFeedbackItem } from '@/app/actions/feedback'
import { FeedbackInboxClient } from './FeedbackInboxClient'

export default async function FeedbackInboxPage() {
  const canView = await checkUserPermission('feedback', 'view')
  if (!canView) redirect('/unauthorized')

  const canManage = await checkUserPermission('feedback', 'manage')

  const result = await getReviewFeedbackList()

  const initialItems: ReviewFeedbackItem[] =
    result && 'success' in result && Array.isArray(result.data) ? result.data : []

  const loadError = result && 'error' in result ? result.error : null

  return (
    <FeedbackInboxClient
      initialItems={initialItems}
      canManage={!!canManage}
      loadError={loadError}
    />
  )
}
