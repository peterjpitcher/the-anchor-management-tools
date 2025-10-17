import { redirect } from 'next/navigation'
import ShortLinksClient from './ShortLinksClient'
import { checkUserPermission } from '@/app/actions/rbac'
import { getShortLinks } from '@/app/actions/short-links'

type ShortLinkRecord = {
  id: string
  name?: string | null
  short_code: string
  destination_url: string
  link_type: string
  click_count: number
  created_at: string
  expires_at: string | null
  last_clicked_at: string | null
}

export default async function ShortLinksPage() {
  const canView = await checkUserPermission('short_links', 'view')
  if (!canView) {
    redirect('/unauthorized')
  }

  const canManage = await checkUserPermission('short_links', 'manage')

  const listResult = await getShortLinks()

  if (!listResult || 'error' in listResult) {
    console.error('Failed to load short links:', listResult?.error)
  }

  const initialLinks: ShortLinkRecord[] =
    listResult && 'data' in listResult && Array.isArray(listResult.data)
      ? (listResult.data as ShortLinkRecord[])
      : []

  return (
    <ShortLinksClient initialLinks={initialLinks} canManage={!!canManage} />
  )
}
