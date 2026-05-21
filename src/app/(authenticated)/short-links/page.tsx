import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getShortLinks, getShortLinkVolumeAdvanced } from '@/app/actions/short-links'
import { ShortLinksClient } from './_components/ShortLinksClient'
import type { ShortLink } from '@/types/short-links'

export default async function ShortLinksPage() {
  const canView = await checkUserPermission('short_links', 'view')
  if (!canView) redirect('/unauthorized')

  const canManage = await checkUserPermission('short_links', 'manage')

  const now = new Date()
  const currentStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const previousStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

  const [listResult, volumeResult, previousVolumeResult] = await Promise.all([
    getShortLinks(1, 25),
    getShortLinkVolumeAdvanced({
      start_at: currentStart.toISOString(),
      end_at: now.toISOString(),
      granularity: 'day',
      include_bots: false,
      timezone: 'Europe/London',
    }),
    getShortLinkVolumeAdvanced({
      start_at: previousStart.toISOString(),
      end_at: currentStart.toISOString(),
      granularity: 'day',
      include_bots: false,
      timezone: 'Europe/London',
    }),
  ])

  const initialLinks: ShortLink[] =
    listResult && 'data' in listResult && Array.isArray(listResult.data)
      ? (listResult.data as ShortLink[])
      : []

  const initialTotal =
    listResult && 'total' in listResult && typeof listResult.total === 'number'
      ? listResult.total
      : initialLinks.length

  const initialLinkTotal =
    listResult && 'linkTotal' in listResult && typeof listResult.linkTotal === 'number'
      ? listResult.linkTotal
      : initialTotal

  return (
    <ShortLinksClient
      initialLinks={initialLinks}
      initialTotal={initialTotal}
      initialLinkTotal={initialLinkTotal}
      volume={volumeResult?.data ?? null}
      previousVolume={previousVolumeResult?.data ?? null}
      canManage={!!canManage}
    />
  )
}
