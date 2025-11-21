'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface SidebarGroupProps {
  children: React.ReactNode;
  className?: string;
  showDivider?: boolean;
  title?: string;
}

export function SidebarGroup({
  children,
  className,
  showDivider = false,
  title,
}: SidebarGroupProps) {
  if (React.Children.count(children) === 0) {
    return null;
  }

  return (
    <div className={cn(showDivider && 'pt-2 pb-1', className)}>
      {showDivider && (
        <hr className="border-t border-green-600 opacity-75 mb-2 mx-2" />
      )}
      {title && (
        <h3 className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          {title}
        </h3>
      )}
      <div className="space-y-1">
        {children}
      </div>
    </div>
  );
}
