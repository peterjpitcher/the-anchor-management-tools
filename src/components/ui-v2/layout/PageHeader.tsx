'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { BackButton } from '../navigation/BackButton';
import { Breadcrumbs } from '../navigation/Breadcrumbs';

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
}

export function PageHeader({ 
  title, 
  subtitle, 
  backButton, 
  actions,
  breadcrumbs,
  className = ''
}: PageHeaderProps) {
  const router = useRouter();
  
  return (
    <div className={`bg-sidebar ${className}`}>
      <div className="px-6 sm:px-8 lg:px-12 pt-10 pb-6">
        {/* Header row with title/subtitle on left, back button on right */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-green-600">{title}</h1>
            {subtitle && (
              <p className="mt-1 text-sm text-white/90">{subtitle}</p>
            )}
          </div>
          
          {backButton && (
            <div className="ml-4 flex-shrink-0">
              <BackButton 
                label={backButton.label}
                onBack={backButton.onBack || (backButton.href ? () => router.push(backButton.href!) : undefined)}
                variant="ghost"
                className="text-white hover:text-white/80 hover:bg-white/10"
              />
            </div>
          )}
        </div>
        
        {/* Breadcrumbs if provided */}
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className="mt-4">
            <Breadcrumbs items={breadcrumbs} className="text-white/80" />
          </div>
        )}
      </div>
      
      {/* Sub-navigation row with action buttons */}
      {actions && (
        <div className="border-t border-white/20 bg-black/10">
          <div className="px-6 sm:px-8 lg:px-12 py-4">
            <div className="flex items-center space-x-6 text-sm">
              {actions}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}