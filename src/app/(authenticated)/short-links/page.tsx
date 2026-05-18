import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getShortLinks, getShortLinkVolume } from '@/app/actions/short-links'
import { ShortLinksClient } from './_components/ShortLinksClient'
import type { ShortLink } from '@/types/short-links'

export default async function ShortLinksPage() {
  const canView = await checkUserPermission('short_links', 'view')
  if (!canView) redirect('/unauthorized')

  const canManage = await checkUserPermission('short_links', 'manage')

  const [listResult, volumeResult] = await Promise.all([
    getShortLinks(1, 25),
    getShortLinkVolume(30),
  ])

  const initialLinks: ShortLink[] =
    listResult && 'data' in listResult && Array.isArray(listResult.data)
      ? (listResult.data as ShortLink[])
      : []

  const initialTotal =
    listResult && 'total' in listResult && typeof listResult.total === 'number'
      ? listResult.total
      : initialLinks.length

  return (
    <ShortLinksClient
      initialLinks={initialLinks}
      initialTotal={initialTotal}
      volume={volumeResult?.data ?? null}
      canManage={!!canManage}
    />
  )
}
