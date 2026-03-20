import { redirect } from 'next/navigation'
import ShortLinksClient from './ShortLinksClient'
import { checkUserPermission } from '@/app/actions/rbac'
import { getShortLinks } from '@/app/actions/short-links'
import type { ShortLink } from '@/types/short-links'

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

  const initialLinks: ShortLink[] =
    listResult && 'data' in listResult && Array.isArray(listResult.data)
      ? (listResult.data as ShortLink[])
      : []

  return (
    <ShortLinksClient initialLinks={initialLinks} canManage={!!canManage} />
  )
}
