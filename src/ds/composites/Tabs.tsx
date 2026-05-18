'use client'

import React from 'react'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/*  Tabs — underline-style tabs with optional count pills             */
/* ------------------------------------------------------------------ */

interface Tab {
  id: string
  label: string
  count?: number
}

interface TabsProps {
  tabs: Tab[]
  activeTab: string
  onTabChange: (id: string) => void
  className?: string
}

export function Tabs({ tabs, activeTab, onTabChange, className }: TabsProps) {
  return (
    <div className={cn('flex items-center border-b border-border', className)}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={cn(
              'px-4 py-2.5 text-[13px] font-medium whitespace-nowrap relative transition-colors',
              isActive ? 'text-primary' : 'text-text-muted hover:text-text',
            )}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}

            {/* Count pill */}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'ml-2 text-xs rounded-[9999px] px-1.5 inline-flex items-center min-w-5 justify-center',
                  isActive
                    ? 'bg-primary-soft text-primary-soft-fg'
                    : 'bg-surface-2 text-text-muted',
                )}
              >
                {tab.count}
              </span>
            )}

            {/* Active indicator — 2px bottom border */}
            {isActive && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary rounded-full" />
            )}
          </button>
        )
      })}
    </div>
  )
}
