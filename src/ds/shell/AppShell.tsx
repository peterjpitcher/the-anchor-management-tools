'use client'

import { useState, useCallback, useMemo, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { filterNavGroupsForPermissions, NAV_GROUPS } from './SidebarNav'
import { Topbar } from './Topbar'
import { FohClockBand } from './FohClockBand'
import { MobileBottomNav, MobileDrawer, MobileTopbar } from './MobileChrome'
import { NavCountsProvider } from './NavCountsContext'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/contexts/PermissionContext'

interface AppShellProps {
  children: ReactNode
  showSidebar?: boolean
  fohMode?: boolean
  fohEmployeeId?: string
  userName: string
  userRole: string
  onSignOut: () => void
  isSigningOut: boolean
}

export function AppShell({
  children,
  showSidebar = true,
  fohMode = false,
  fohEmployeeId,
  userName,
  userRole,
  onSignOut,
  isSigningOut,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { hasPermission } = usePermissions()
  const navGroups = useMemo(
    () => filterNavGroupsForPermissions(NAV_GROUPS, hasPermission),
    [hasPermission],
  )

  const openMobile = useCallback(() => setMobileOpen(true), [])
  const closeMobile = useCallback(() => setMobileOpen(false), [])

  const shell = (
    <div className={cn('flex min-h-screen bg-bg', showSidebar && !fohMode && 'max-md:h-[100dvh] max-md:flex-col max-md:overflow-hidden')}>
      {/* Desktop sidebar. Its badges read the NavCountsProvider below, which is
          mounted on `showSidebar && !fohMode`. The caller keeps `showSidebar`
          and `!fohMode` equal, so the sidebar is always inside the provider; if
          that ever diverges, badges fall back to empty (no crash). */}
      {showSidebar && (
        <Sidebar
          navGroups={navGroups}
          userName={userName}
          userRole={userRole}
          onSignOut={onSignOut}
          isSigningOut={isSigningOut}
        />
      )}

      {/* Mobile drawer and tab chrome — hidden in FOH chromeless mode. */}
      {showSidebar && !fohMode && (
        <MobileDrawer
          open={mobileOpen}
          onClose={closeMobile}
          navGroups={navGroups}
          userName={userName}
          userRole={userRole}
          onSignOut={onSignOut}
          isSigningOut={isSigningOut}
        />
      )}

      {/* Main content area */}
      <div className="flex-1 min-w-0 flex flex-col max-md:min-h-0">
        {showSidebar && !fohMode ? (
          <MobileTopbar onMenuOpen={openMobile} />
        ) : (
          <Topbar
            onMenuOpen={undefined}
            fohMode={fohMode}
            userName={userName}
            onSignOut={onSignOut}
            isSigningOut={isSigningOut}
          />
        )}
        {fohMode && fohEmployeeId && (
          <FohClockBand employeeId={fohEmployeeId} />
        )}
        <main
          className={cn(
            'flex-1 overflow-auto bg-bg',
            showSidebar && !fohMode
              ? 'p-[12px_16px_calc(88px+env(safe-area-inset-bottom))] md:p-[22px_28px_40px]'
              : 'p-[12px_16px_40px] md:p-[22px_28px_40px]',
          )}
        >
          {children}
        </main>
      </div>

      {showSidebar && !fohMode && <MobileBottomNav navGroups={navGroups} onMore={openMobile} />}
    </div>
  )

  // Fetch the nav badge counts once for the whole shell. Only mount the
  // provider when the nav surfaces render (never in FOH/chromeless mode), so
  // FOH does no polling — matching the previous per-component behaviour.
  return showSidebar && !fohMode ? <NavCountsProvider>{shell}</NavCountsProvider> : shell
}
