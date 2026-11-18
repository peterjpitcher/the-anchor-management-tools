import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getShortLinks, getShortLinkVolumeAdvanced } from '@/app/actions/short-links'
import { summariseShortLinkVolume } from '@/lib/short-links/volume-summary'
import { ShortLinksClient } from './_components/ShortLinksClient'
import type { ShortLink } from '@/types/short-links'

export default async function ShortLinksPage() {
  const now = new Date()
  const currentStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const previousStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

  // One wave: the list and volume actions each check short_links:view themselves, so they
  // run beside the permission checks rather than after them. A refused read is never shown,
  // because the redirect below still comes first.
  //
  // Month buckets: the page only shows totals, which the analytics function works out per
  // link whatever the granularity, so the smallest buckets keep the result small (see
  // src/lib/short-links/volume-summary.ts for the production check).
  const [canView, canManage, listResult, volumeResult, previousVolumeResult] = await Promise.all([
    checkUserPermission('short_links', 'view'),
    checkUserPermission('short_links', 'manage'),
    getShortLinks(1, 25),
    getShortLinkVolumeAdvanced({
      start_at: currentStart.toISOString(),
      end_at: now.toISOString(),
      granularity: 'month',
      include_bots: false,
      timezone: 'Europe/London',
    }),
    getShortLinkVolumeAdvanced({
      start_at: previousStart.toISOString(),
      end_at: currentStart.toISOString(),
      granularity: 'month',
      include_bots: false,
      timezone: 'Europe/London',
    }),
  ])
  if (!canView) redirect('/unauthorized')

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

  // A failed read is passed on rather than shown as an empty list of links.
  const initialError =
    !listResult
      ? 'Failed to load short links'
      : 'error' in listResult && listResult.error
        ? listResult.error
        : null

  // Reduced here so the browser gets three figures, not every clicked link's row.
  const volumeSummary = summariseShortLinkVolume(volumeResult?.data ?? null)
  const previousTotalClicks = summariseShortLinkVolume(previousVolumeResult?.data ?? null).totalClicks

  return (
    <ShortLinksClient
      initialLinks={initialLinks}
      initialTotal={initialTotal}
      initialLinkTotal={initialLinkTotal}
      initialError={initialError}
      volumeSummary={volumeSummary}
      previousTotalClicks={previousTotalClicks}
      canManage={!!canManage}
    />
  )
}
