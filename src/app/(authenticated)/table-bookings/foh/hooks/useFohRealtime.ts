'use client'

import { useEffect, useRef } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RealtimeChannel } from '@supabase/supabase-js'

/**
 * The ONE mechanism that keeps the FOH schedule up to date (owner decision, 22 November 2026):
 *
 *  1. a Supabase realtime subscription on the floor-plan tables, so a change made on another
 *     device appears within about half a second;
 *  2. a 60 second refetch as the safety net, for the tables that are not watched live and for a
 *     realtime connection that has quietly dropped;
 *  3. a refetch the moment the tab becomes visible again or the network returns, which is when an
 *     iPad that slept or lost wifi is most out of date.
 *
 * All three go through one debounced refresh, so they can never stack. There is no other timer
 * that refetches the schedule. Refreshes are held back while a drag is in flight, and one runs as
 * soon as the drag ends.
 */
export function useFohRealtime(input: {
  supabase: SupabaseClient
  date: string
  isDragging: boolean
  reloadSchedule: (opts?: { requestedDate?: string; surfaceError?: boolean }) => Promise<void>
}): void {
  const { supabase, date, isDragging, reloadSchedule } = input

  // Keep a ref in sync with isDragging so the realtime subscription callback
  // can check drag state without stale closure issues.
  const isDraggingRef = useRef(false)
  useEffect(() => {
    isDraggingRef.current = isDragging
  }, [isDragging])

  // Stable ref to reloadSchedule so the effect closure doesn't go stale.
  const reloadScheduleRef = useRef(reloadSchedule)
  useEffect(() => {
    reloadScheduleRef.current = reloadSchedule
  }, [reloadSchedule])

  // When drag ends, trigger a schedule refresh to pick up any server changes.
  const prevIsDraggingRef = useRef(false)
  useEffect(() => {
    if (prevIsDraggingRef.current && !isDragging) {
      void reloadScheduleRef.current?.({ requestedDate: date, surfaceError: false }).catch(() => {})
    }
    prevIsDraggingRef.current = isDragging
  }, [isDragging, date])

  useEffect(() => {
    let cancelled = false
    let refreshTimeoutId: number | null = null
    let pollIntervalId: number | null = null
    let channel: RealtimeChannel | null = null

    const queueRefresh = () => {
      if (cancelled) return
      // Suppress realtime refresh while a drag is in flight to avoid disrupting the drag ghost
      if (isDraggingRef.current) return
      if (refreshTimeoutId != null) {
        window.clearTimeout(refreshTimeoutId)
      }

      refreshTimeoutId = window.setTimeout(() => {
        refreshTimeoutId = null
        void reloadScheduleRef.current?.({ requestedDate: date, surfaceError: false }).catch(() => {
          // Best-effort realtime refresh; date-based loader handles surfaced errors.
        })
      }, 500)
    }

    // Only the floor-plan tables are watched live. customers, private_bookings and
    // private_booking_items were dropped (spec D1, owner approval 18 November 2026): customers is
    // written by every booking, message and marketing send, and the Realtime WAL polling for these
    // tables cost more database time than anything else. A renamed customer or a new private hire
    // now appears on the 60-second poll below instead of instantly. The tables were also taken out
    // of the supabase_realtime publication (migration 20261118120300), so do not add them back here
    // without re-adding them there.
    channel = supabase
      .channel(`foh-schedule-live-${date}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'table_bookings', filter: `booking_date=eq.${date}` },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'booking_table_assignments' },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tables' },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'venue_space_table_areas' },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'table_areas' },
        queueRefresh
      )
      .subscribe()

    pollIntervalId = window.setInterval(queueRefresh, 60_000)

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') queueRefresh()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('online', queueRefresh)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('online', queueRefresh)
      if (refreshTimeoutId != null) {
        window.clearTimeout(refreshTimeoutId)
      }
      if (pollIntervalId != null) {
        window.clearInterval(pollIntervalId)
      }
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [date, supabase])
}
