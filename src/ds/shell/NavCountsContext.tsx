'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useUnreadMessageCount } from '@/hooks/useUnreadMessageCount'
import { useOutstandingCounts } from '@/hooks/useOutstandingCounts'
import type { OutstandingCounts } from '@/actions/get-outstanding-counts'

export interface NavCountsValue {
  unreadCount: number
  counts: OutstandingCounts | null
}

const DEFAULT_VALUE: NavCountsValue = { unreadCount: 0, counts: null }

const NavCountsContext = createContext<NavCountsValue>(DEFAULT_VALUE)

/**
 * Fetches the nav badge counts once — unread messages and outstanding counts —
 * and shares them with every nav surface (desktop sidebar, mobile drawer,
 * mobile bottom nav) so the endpoints are polled once rather than once per
 * surface. Mount this only around the authenticated chrome; when it is not
 * mounted, consumers fall back to zero/null and no polling happens (FOH mode).
 */
export function NavCountsProvider({ children }: { children: ReactNode }) {
  const unreadCount = useUnreadMessageCount()
  const { counts } = useOutstandingCounts()

  const value = useMemo<NavCountsValue>(() => ({ unreadCount, counts }), [unreadCount, counts])

  return <NavCountsContext.Provider value={value}>{children}</NavCountsContext.Provider>
}

export function useNavCounts(): NavCountsValue {
  return useContext(NavCountsContext)
}
