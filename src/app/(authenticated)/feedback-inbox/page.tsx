import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getReviewFeedbackList } from '@/app/actions/feedback'
import { FeedbackInboxClient } from './FeedbackInboxClient'

export default async function FeedbackInboxPage() {
  const canView = await checkUserPermission('feedback', 'view')
  if (!canView) redirect('/unauthorized')

  const canManage = await checkUserPermission('feedback', 'manage')

  const result = await getReviewFeedbackList()
  const loaded = result && 'success' in result ? result.data : null

  return (
    <FeedbackInboxClient
      initialItems={loaded?.items ?? []}
      initialHasMore={loaded?.hasMore ?? false}
      initialNewCount={loaded?.newCount ?? 0}
      canManage={!!canManage}
      loadError={result && 'error' in result ? result.error : null}
    />
  )
}
