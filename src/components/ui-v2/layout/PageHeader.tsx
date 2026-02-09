'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BackButton } from '../navigation/BackButton';
import { Breadcrumbs } from '../navigation/Breadcrumbs';
import { Bars3Icon } from '@heroicons/react/24/outline';
import { useUnreadMessageCount } from '@/hooks/useUnreadMessageCount';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  backButton?: {
    label: string;
    href?: string;
    onBack?: () => void;
  };
  actions?: React.ReactNode;
  breadcrumbs?: Array<{
    label: string;
    href?: string;
  }>;
  className?: string;
  onMenuClick?: () => void;
  headerActions?: React.ReactNode;
  showHeaderActionsOnMobile?: boolean;
  hideMobileMenuButton?: boolean;
  compact?: boolean;
}

export function PageHeader({
  title, 
  subtitle, 
  backButton, 
  actions,
  breadcrumbs,
  className = '',
  onMenuClick,
  headerActions,
  showHeaderActionsOnMobile = false,
  hideMobileMenuButton = false,
  compact = false
}: PageHeaderProps) {
  const router = useRouter();
  const unreadCount = useUnreadMessageCount();
  
  // Get the onMenuClick from context if available
  const handleMenuClick = () => {
    if (onMenuClick) {
      onMenuClick();
    } else if (typeof window !== 'undefined') {
      // Dispatch event for layout to handle
      window.dispatchEvent(new CustomEvent('open-mobile-menu'));
    }
  };
  
  return (
    <div className={`bg-white border-b border-gray-200 ${className}`}>
      <div className={compact ? 'px-3 py-2 md:px-4 md:py-3 lg:px-6' : 'px-4 pt-3 pb-3 md:px-6 md:pt-8 md:pb-6 lg:px-12'}>
        {/* Mobile: Compact header with back button, title, and hamburger in one row */}
        <div className={compact ? 'flex items-center gap-1.5 md:hidden' : 'flex items-center gap-2 md:hidden'}>
          {/* Back button if provided */}
          {backButton && (
            <button
              onClick={backButton.onBack || (backButton.href ? () => router.push(backButton.href!) : undefined)}
              className="rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 p-2 focus:outline-none focus:ring-2 focus:ring-gray-500/50"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          
          {/* Title and subtitle */}
          <div className="flex-1 min-w-0">
            <h1 className={compact ? 'text-base font-bold text-gray-900 truncate' : 'text-lg font-bold text-gray-900 truncate'}>{title}</h1>
            {subtitle && (
              <p className="text-xs text-gray-500 truncate">{subtitle}</p>
            )}
          </div>
          
          {showHeaderActionsOnMobile && headerActions && (
            <div className="ml-1 flex items-center gap-2">
              {headerActions}
            </div>
          )}

          {/* Hamburger menu button on the right - mobile only */}
          {!hideMobileMenuButton && (
            <button
              type="button"
              className="relative rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 p-2 focus:outline-none focus:ring-2 focus:ring-gray-500/50"
              onClick={handleMenuClick}
            >
              <span className="sr-only">Open menu</span>
              <Bars3Icon className="h-6 w-6" aria-hidden="true" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-600 text-white text-xs rounded-full flex items-center justify-center font-bold">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          )}
        </div>
        
        {/* Desktop: Original layout */}
        <div className={compact ? 'hidden md:flex md:flex-col md:gap-1.5' : 'hidden md:flex md:flex-col md:gap-3'}>
          <div className="flex flex-row items-start justify-between gap-4">
            <div className="flex-1">
              <h1 className={compact ? 'text-xl lg:text-2xl font-bold text-gray-900' : 'text-2xl lg:text-3xl font-bold text-gray-900'}>{title}</h1>
              {subtitle && (
                <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
              )}
            </div>
            
            {(headerActions || backButton) && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {headerActions}
                {backButton && (
                  <BackButton 
                    label={backButton.label}
                    onBack={backButton.onBack || (backButton.href ? () => router.push(backButton.href!) : undefined)}
                    variant="outline"
                    className="text-gray-700 hover:text-gray-900 hover:bg-gray-50"
                  />
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Breadcrumbs if provided */}
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className={compact ? 'mt-2' : 'mt-4'}>
            <Breadcrumbs items={breadcrumbs} theme="default" />
          </div>
        )}
      </div>
      
      {/* Sub-navigation row with action buttons */}
      {actions && (
        <div className="">
          <div className={compact ? 'px-3 md:px-4 lg:px-6' : 'px-4 md:px-6 lg:px-12'}>
            <div className={compact ? 'flex flex-wrap items-center gap-2 text-xs md:gap-3 md:text-sm' : 'flex flex-wrap items-center gap-3 text-xs md:gap-4 md:text-sm'}>
              {actions}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
