import React, { useSyncExternalStore, type AnchorHTMLAttributes } from 'react'

// Only the framework router and external data are replaced. All shell components
// and production CSS are used unchanged, without credentials or live writes.
const subscribe = (callback: () => void) => {
  window.addEventListener('popstate', callback)
  return () => window.removeEventListener('popstate', callback)
}
export function usePathname() {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => '/dashboard')
}
export default function Link({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} href={href} onClick={event => {
    onClick?.(event)
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    event.preventDefault()
    window.history.pushState(null, '', href)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }} />
}
export const usePermissions = () => ({ hasPermission: () => true })
export const useUnreadMessageCount = () => 3
export const useOutstandingCounts = () => ({ counts: null, loading: false, error: null })
export const FohClockBand = () => null
