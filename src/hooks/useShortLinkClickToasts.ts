import { useEffect, useRef } from 'react'
import type { RealtimeChannel, RealtimePostgresUpdatePayload } from '@supabase/supabase-js'
import toast from 'react-hot-toast'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import type { Database } from '@/types/database'

type ShortLinkRow = Database['public']['Tables']['short_links']['Row']
type SeedLink = Pick<ShortLinkRow, 'id' | 'click_count'>

type Options = {
  enabled?: boolean
  seedLinks?: SeedLink[]
  onClickRegistered?: (updated: ShortLinkRow, delta: number) => void
}

export function useShortLinkClickToasts({
  enabled = true,
  seedLinks,
  onClickRegistered,
}: Options = {}) {
  const supabase = useSupabase()
  const clickCountsRef = useRef<Map<string, number>>(new Map())
  const onClickRegisteredRef = useRef(onClickRegistered)

  useEffect(() => {
    onClickRegisteredRef.current = onClickRegistered
  }, [onClickRegistered])

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let channel: RealtimeChannel | null = null

    const start = async () => {
      if (seedLinks?.length) {
        clickCountsRef.current = new Map(seedLinks.map((link) => [link.id, link.click_count ?? 0]))
      } else {
        const { data } = await supabase
          .from('short_links')
          .select('id,click_count')

        if (!cancelled && data) {
          const rows = data as unknown as SeedLink[]
          clickCountsRef.current = new Map(rows.map((link) => [link.id, link.click_count ?? 0]))
        }
      }

      if (cancelled) return

      channel = supabase
        .channel('short-links-click-updates')
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'short_links' },
          (payload: RealtimePostgresUpdatePayload<ShortLinkRow>) => {
            const updated = payload.new
            if (!updated?.id) return

            const nextCount = updated.click_count ?? 0
            const previousCount = clickCountsRef.current.get(updated.id) ?? 0

            const delta = nextCount - previousCount

            if (delta > 0) {
              const label =
                updated.name?.trim() ||
                (updated.short_code ? `/${updated.short_code}` : 'Short link')
              const message =
                delta === 1
                  ? `Click registered for ${label}`
                  : `${delta} clicks registered for ${label}`

              toast.success(message)
              onClickRegisteredRef.current?.(updated, delta)
            }

            clickCountsRef.current.set(updated.id, nextCount)
          }
        )
        .subscribe()
    }

    start().catch((error) => {
      console.error('Failed to start short link click toasts', error)
    })

    return () => {
      cancelled = true
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [enabled, seedLinks, supabase])
}
