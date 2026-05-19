'use client'

/**
 * SidebarGroup — visual grouping for sidebar nav items
 * @deprecated Use navGroups prop on Sidebar/SidebarNav instead
 */

export interface SidebarGroupProps {
  children: React.ReactNode
  showDivider?: boolean
}

export function SidebarGroup({ children, showDivider }: SidebarGroupProps) {
  return (
    <div>
      {showDivider && (
        <div className="ds-group-divider border-t border-sidebar-border my-2 mx-2" />
      )}
      <div className="flex flex-col gap-0.5">
        {children}
      </div>
    </div>
  )
}
