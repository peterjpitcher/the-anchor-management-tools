'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BackButton } from '../navigation/BackButton';
import { Breadcrumbs } from '../navigation/Breadcrumbs';
import { Bars3Icon } from '@heroicons/react/24/outline';
import { getUnreadMessageCount } from '@/app/actions/messagesActions';

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
    href: string;
  }>;
  className?: string;
  onMenuClick?: () => void;
}

export function PageHeader({ 
  title, 
  subtitle, 
  backButton, 
  actions,
  breadcrumbs,
  className = '',
  onMenuClick
}: PageHeaderProps) {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  
  // Fetch unread message count on mount
  useEffect(() => {
    const fetchUnreadCount = async () => {
      try {
        const result = await getUnreadMessageCount();
        setUnreadCount(result.badge || 0);
      } catch (error) {
        console.error('Failed to fetch unread message count:', error);
      }
    };
    
    fetchUnreadCount();
    
    // Refresh count every 30 seconds
    const interval = setInterval(fetchUnreadCount, 30000);
    
    return () => clearInterval(interval);
  }, []);
  
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
    <div className={`bg-sidebar ${className}`}>
      <div className="px-4 sm:px-6 lg:px-12 pt-3 sm:pt-8 pb-3 sm:pb-6">
        {/* Mobile: Compact header with back button, title, and hamburger in one row */}
        <div className="flex items-center gap-2 sm:hidden">
          {/* Back button if provided */}
          {backButton && (
            <button
              onClick={backButton.onBack || (backButton.href ? () => router.push(backButton.href!) : undefined)}
              className="rounded-md text-white hover:text-white/80 hover:bg-white/10 p-2 focus:outline-none focus:ring-2 focus:ring-white/50"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          
          {/* Title and subtitle */}
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white truncate">{title}</h1>
            {subtitle && (
              <p className="text-xs text-white/70 truncate">{subtitle}</p>
            )}
          </div>
          
          {/* Hamburger menu button on the right - mobile only */}
          <button
            type="button"
            className="relative rounded-md text-white hover:text-white/80 hover:bg-white/10 p-2 focus:outline-none focus:ring-2 focus:ring-white/50"
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
        </div>
        
        {/* Desktop: Original layout */}
        <div className="hidden sm:flex sm:flex-col sm:gap-3">
          <div className="flex flex-row items-start justify-between gap-4">
            <div className="flex-1">
              <h1 className="text-2xl lg:text-3xl font-bold text-white">{title}</h1>
              {subtitle && (
                <p className="mt-1 text-sm text-white/80">{subtitle}</p>
              )}
            </div>
            
            {backButton && (
              <div className="flex-shrink-0">
                <BackButton 
                  label={backButton.label}
                  onBack={backButton.onBack || (backButton.href ? () => router.push(backButton.href!) : undefined)}
                  variant="ghost"
                  className="text-white hover:text-white/80 hover:bg-white/10"
                />
              </div>
            )}
          </div>
        </div>
        
        {/* Breadcrumbs if provided */}
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className="mt-4">
            <Breadcrumbs items={breadcrumbs} theme="light" />
          </div>
        )}
      </div>
      
      {/* Sub-navigation row with action buttons */}
      {actions && (
        <div className="border-t border-white/20 bg-black/10">
          <div className="px-4 sm:px-6 lg:px-12 py-3 sm:py-4">
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs sm:text-sm">
              {actions}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}